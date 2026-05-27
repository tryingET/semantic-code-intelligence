/**
 * LSP Server - Thin wrapper around unified core
 *
 * This server only handles LSP protocol concerns:
 * - Connection management
 * - Document synchronization
 * - Capability negotiation
 *
 * All analysis work is delegated to the LSP adapter and core analyzer.
 */

import { serve } from 'bun';
import { fileURLToPath } from 'node:url';
import type { Location } from 'vscode-languageserver/node';
import {
    createConnection,
    DidChangeConfigurationNotification,
    type InitializeParams,
    type InitializeResult,
    ProposedFeatures,
    RequestType,
    TextDocumentSyncKind,
    TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LSPAdapter } from '../adapters/lsp-adapter.js';
import {
    buildFindDefinitionRequest,
    buildFindReferencesRequest,
    createDefaultCoreConfig,
    definitionToLspLocation,
    referenceToLspLocation,
} from '../adapters/utils.js';
import { createCodeAnalyzer } from '../core/index.js';
import type { CodeAnalyzer } from '../core/unified-analyzer.js';
import { metricsRegistry, recordLayerLatency, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';

export class LSPServer {
    private connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
    private documents = new TextDocuments(TextDocument);
    private hasConfigurationCapability = false;
    private coreAnalyzer!: CodeAnalyzer;
    private lspAdapter!: LSPAdapter;
    private initialized = false;

    constructor() {
        this.setupConnection();
    }

    private setupConnection(): void {
        const log = (...args: any[]) => {
            // Use stderr for logs to avoid contaminating LSP stdio channel
            try {
                console.error(...args);
            } catch {}
        };
        // Initialize request
        this.connection.onInitialize(async (params: InitializeParams) => {
            process.env.STDIO_MODE = process.env.STDIO_MODE || 'true';
            process.env.SILENT_MODE = process.env.SILENT_MODE || 'true';

            // Redirect non-error console output to stderr to avoid contaminating LSP stdio stream.
            try {
                const g: any = globalThis as any;
                if (!g.__SEMANTIC_CODE_INTELLIGENCE_CONSOLE_PATCHED) {
                    g.__SEMANTIC_CODE_INTELLIGENCE_CONSOLE_PATCHED = true;
                    const write = (label: string, args: any[]) => {
                        try {
                            const msg = args
                                .map((a) => {
                                    if (typeof a === 'string') return a;
                                    try {
                                        return JSON.stringify(a);
                                    } catch {
                                        return String(a);
                                    }
                                })
                                .join(' ');
                            process.stderr.write(`[${label}] ${msg}\n`);
                        } catch {}
                    };
                    console.log = (...args: any[]) => write('LOG', args);
                    console.info = (...args: any[]) => write('INFO', args);
                    console.warn = (...args: any[]) => write('WARN', args);
                }
            } catch {}

            this.hasConfigurationCapability = !!params.capabilities.workspace?.configuration;

            // Initialize core analyzer
            const config = createDefaultCoreConfig();
            const rawWorkspaceRoot = params.rootPath || params.workspaceFolders?.[0]?.uri || process.cwd();
            const workspaceRoot = rawWorkspaceRoot.startsWith('file://') ? fileURLToPath(rawWorkspaceRoot) : rawWorkspaceRoot;

            this.coreAnalyzer = await createCodeAnalyzer({
                ...config,
                workspaceRoot,
            });

            await this.coreAnalyzer.initialize();

            // Create LSP adapter
            this.lspAdapter = new LSPAdapter(this.coreAnalyzer, { workspaceRoot });

            this.initialized = true;

            const result: InitializeResult = {
                capabilities: this.lspAdapter.getCapabilities(),
            };

            return result;
        });

        // Initialized notification
        this.connection.onInitialized(() => {
            if (this.hasConfigurationCapability) {
                this.connection.client.register(DidChangeConfigurationNotification.type, undefined);
            }
            log('Semantic Code Intelligence Server initialized');

            // Start metrics endpoint for LSP on loopback
            try {
                const port = Number(process.env.LSP_PROM_PORT || 9467);
                serve({
                    hostname: '127.0.0.1',
                    port,
                    fetch: async (req) => {
                        const url = new URL(req.url);
                        if (url.pathname === '/metrics' && req.method === 'GET') {
                            const text = metricsRegistry.renderPrometheusText();
                            return new Response(text, {
                                status: 200,
                                headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-cache' },
                            });
                        }
                        return new Response('Not found', { status: 404 });
                    },
                });
                log(`[LSP] Metrics on http://127.0.0.1:${port}/metrics`);
            } catch (err) {
                log('[LSP] Metrics server failed to start:', (err as Error)?.message || String(err));
            }

            // Bridge layer performance events to metrics histograms
            try {
                const ss: any = (this.coreAnalyzer as any).sharedServices;
                const bus: any = ss?.eventBus;
                bus?.on?.('layer-manager:performance-recorded', (perf: any) => {
                    try {
                        recordLayerLatency('lsp', String(perf?.layer || 'unknown'), Number(perf?.duration || 0));
                    } catch {}
                });
            } catch {}
        });

        // Document sync
        this.documents.onDidOpen((e) => {
            log(`Document opened: ${e.document.uri}`);
            this.lspAdapter.handleDidOpenTextDocument({
                textDocument: { uri: e.document.uri, text: e.document.getText() },
            });
        });

        this.documents.onDidChangeContent((change) => {
            this.lspAdapter.handleDidChangeTextDocument({
                textDocument: { uri: change.document.uri },
                contentChanges: [{ text: change.document.getText() }],
            });
        });

        this.documents.onDidClose((e) => {
            this.lspAdapter.handleDidCloseTextDocument({
                textDocument: { uri: e.document.uri },
            });
        });

        this.documents.onDidSave((e) => {
            this.lspAdapter.handleDidSaveTextDocument({
                textDocument: { uri: e.document.uri },
            });
        });

        // LSP method handlers - delegate to adapter
        this.connection.onDefinition(async (params) => {
            if (!this.initialized) {
                throw new Error('Server not initialized');
            }
            const t0 = Date.now();
            recordToolStart('lsp');
            try {
                const out = await this.lspAdapter.handleDefinition(params);
                recordToolEnd('lsp', 'definition', Date.now() - t0, true);
                return out;
            } catch (e) {
                try {
                    recordToolEnd('lsp', 'definition', Date.now() - t0, false);
                } catch {}
                throw e;
            }
        });

        this.connection.onReferences(async (params) => {
            if (!this.initialized) {
                throw new Error('Server not initialized');
            }
            const t0 = Date.now();
            recordToolStart('lsp');
            try {
                const out = await this.lspAdapter.handleReferences(params);
                recordToolEnd('lsp', 'references', Date.now() - t0, true);
                return out;
            } catch (e) {
                try {
                    recordToolEnd('lsp', 'references', Date.now() - t0, false);
                } catch {}
                throw e;
            }
        });

        this.connection.onPrepareRename(async (params) => {
            if (!this.initialized) {
                return null;
            }
            return await this.lspAdapter.handlePrepareRename(params);
        });

        this.connection.onRenameRequest(async (params) => {
            if (!this.initialized) {
                throw new Error('Server not initialized');
            }
            const t0 = Date.now();
            recordToolStart('lsp');
            try {
                const out = await this.lspAdapter.handleRename(params);
                recordToolEnd('lsp', 'rename', Date.now() - t0, true);
                return out;
            } catch (e) {
                try {
                    recordToolEnd('lsp', 'rename', Date.now() - t0, false);
                } catch {}
                throw e;
            }
        });

        // Graceful no-op handlers for features we don't implement yet but
        // some clients may probe regardless of advertised capabilities
        this.connection.onFoldingRanges?.(async () => {
            // Return empty list instead of -32601 to avoid noisy errors
            return [] as any;
        });
        this.connection.onCodeLens?.(async () => {
            return [] as any;
        });
        this.connection.onImplementation?.(async () => {
            return [] as any;
        });

        // Custom precise references request
        const PreciseReferencesRequest = new RequestType<
            {
                uri: string;
                position?: { line: number; character: number };
                symbol?: string;
                maxResults?: number;
                includeDeclaration?: boolean;
            },
            { locations: Location[]; count: number },
            void
        >('ontology/preciseReferences');

        this.connection.onRequest(PreciseReferencesRequest, async (params) => {
            if (!this.initialized) throw new Error('Server not initialized');
            const uri = params.uri;
            const position = params.position || { line: 0, character: 0 };
            const identifier = params.symbol || (await this.lspAdapter.resolveIdentifierAtPosition(uri, position));
            const t0 = Date.now();
            recordToolStart('lsp');
            const req = buildFindReferencesRequest({
                uri,
                position,
                identifier,
                maxResults: params.maxResults ?? this.lspAdapter.getMaxResults(),
                includeDeclaration: params.includeDeclaration ?? false,
                precise: true,
            } as any);
            const result = await (this.coreAnalyzer as any).findReferencesAsync(req);
            try {
                recordToolEnd('lsp', 'preciseReferences', Date.now() - t0, true);
            } catch {}
            return {
                locations: result.data.map((r: any) => referenceToLspLocation(r)),
                count: result.data.length,
            } as any;
        });

        // Custom precise definition request
        const PreciseDefinitionRequest = new RequestType<
            { uri: string; position?: { line: number; character: number }; symbol?: string; maxResults?: number },
            { locations: Location[]; count: number },
            void
        >('ontology/preciseDefinition');

        this.connection.onRequest(PreciseDefinitionRequest, async (params) => {
            if (!this.initialized) throw new Error('Server not initialized');
            const uri = params.uri;
            const position = params.position || { line: 0, character: 0 };
            const identifier = params.symbol || (await this.lspAdapter.resolveIdentifierAtPosition(uri, position));
            const t0 = Date.now();
            recordToolStart('lsp');
            const req = buildFindDefinitionRequest({
                uri,
                position,
                identifier,
                maxResults: params.maxResults ?? this.lspAdapter.getMaxResults(),
                includeDeclaration: true,
                precise: true,
            } as any);
            const result = await (this.coreAnalyzer as any).findDefinitionAsync(req);
            try {
                recordToolEnd('lsp', 'preciseDefinition', Date.now() - t0, true);
            } catch {}
            return {
                locations: result.data.map((d: any) => definitionToLspLocation(d)),
                count: result.data.length,
            } as any;
        });

        this.connection.onCompletion(async (params) => {
            if (!this.initialized) {
                return [];
            }
            const t0 = Date.now();
            recordToolStart('lsp');
            try {
                const out = await this.lspAdapter.handleCompletion(params);
                recordToolEnd('lsp', 'completion', Date.now() - t0, true);
                return out;
            } catch (e) {
                try {
                    recordToolEnd('lsp', 'completion', Date.now() - t0, false);
                } catch {}
                return [];
            }
        });

        // Expose workspace/executeCommand for 'ontology.explore'
        this.connection.onExecuteCommand?.(async (params: { command: string; arguments?: any[] }) => {
            if (!this.initialized) {
                throw new Error('Server not initialized');
            }
            try {
                if (params.command !== 'ontology.explore') {
                    // Unknown command: return empty result to avoid -32601 noise
                    return null as any;
                }
                const arg = (params.arguments && params.arguments[0]) || {};
                if (!arg || typeof arg !== 'object' || typeof arg.identifier !== 'string' || !arg.identifier.trim()) {
                    throw new Error(
                        'Invalid arguments: expected { identifier: string, uri?, includeDeclaration?, maxResults? }'
                    );
                }
                const result = await (this.coreAnalyzer as any).exploreCodebase({
                    uri: arg.uri || arg.file || (this.coreAnalyzer as any)?.config?.workspaceRoot || 'file://workspace',
                    identifier: arg.identifier,
                    includeDeclaration: arg.includeDeclaration ?? true,
                    maxResults: arg.maxResults ?? 100,
                    precise: !!arg.precise,
                    conceptual: !!arg.conceptual,
                });
                return result as any;
            } catch (err) {
                // Return a lightweight error to client; do not throw protocol errors
                return { error: (err as Error)?.message || String(err) } as any;
            }
        });

        // Custom requests
        const OntologyStatsRequest = new RequestType<{}, { schemaVersion: number; ontology: any; patterns: any }, void>(
            'ontology/getStatistics'
        );
        this.connection.onRequest(OntologyStatsRequest, async () => {
            if (!this.initialized) throw new Error('Server not initialized');
            const t0 = Date.now();
            recordToolStart('lsp');
            try {
                const lm: any = (this.coreAnalyzer as any).layerManager;
                const layer4: any = lm?.getLayer?.('layer4');
                const engine: any =
                    layer4 && typeof layer4.getOntologyEngine === 'function' ? layer4.getOntologyEngine() : null;

                let ontology: any = { concepts: 0, relations: 0 };
                if (engine) {
                    await Promise.race([
                        typeof engine.ensureInitialized === 'function' ? engine.ensureInitialized() : Promise.resolve(),
                        new Promise((resolve) => setTimeout(resolve, 750)),
                    ]);
                    if (typeof engine.getStatistics === 'function') {
                        const s = engine.getStatistics();
                        ontology = {
                            concepts: Number(s?.totalConcepts || 0),
                            relations: Number(s?.totalRelations || 0),
                            symbols: Number(s?.totalSymbols || 0),
                            things: Number(s?.totalThings || 0),
                            averageAnchorsPerConcept: Number(s?.averageAnchorsPerConcept || 0),
                        };
                    }
                }

                const layer5: any = lm?.getLayer?.('layer5');
                let patterns: any = { total: 0, strong: 0, weak: 0 };
                if (layer5 && typeof layer5.getPatternStatistics === 'function') {
                    const ps = await Promise.race([
                        layer5.getPatternStatistics(),
                        new Promise((resolve) => setTimeout(() => resolve({}), 750)),
                    ]);
                    patterns = {
                        total: Number((ps as any)?.totalPatterns ?? (ps as any)?.total ?? 0),
                        strong: Number((ps as any)?.strongPatterns ?? (ps as any)?.strong ?? 0),
                        weak: Number((ps as any)?.weakPatterns ?? (ps as any)?.weak ?? 0),
                    };
                }

                try {
                    recordToolEnd('lsp', 'ontology/getStatistics', Date.now() - t0, true);
                } catch {}
                return { schemaVersion: 2, ontology, patterns };
            } catch {
                try {
                    recordToolEnd('lsp', 'ontology/getStatistics', Date.now() - t0, false);
                } catch {}
                return {
                    schemaVersion: 2,
                    ontology: { concepts: 0, relations: 0 },
                    patterns: { total: 0, strong: 0, weak: 0 },
                };
            }
        });

        const OntologyGraphRequest = new RequestType<
            { maxNodes?: number; maxEdges?: number },
            { schemaVersion: number; nodes: any[]; edges: any[] },
            void
        >('ontology/getConceptGraph');
        this.connection.onRequest(OntologyGraphRequest, async (params) => {
            if (!this.initialized) throw new Error('Server not initialized');
            const t0 = Date.now();
            recordToolStart('lsp');
            try {
                const maxNodes = Math.max(0, Math.min(2000, Number((params as any)?.maxNodes ?? 200)));
                const maxEdges = Math.max(0, Math.min(5000, Number((params as any)?.maxEdges ?? 500)));

                const lm: any = (this.coreAnalyzer as any).layerManager;
                const layer4: any = lm?.getLayer?.('layer4');
                const engine: any =
                    layer4 && typeof layer4.getOntologyEngine === 'function' ? layer4.getOntologyEngine() : null;
                if (!engine) {
                    return { schemaVersion: 2, nodes: [], edges: [] };
                }

                await Promise.race([
                    typeof engine.ensureInitialized === 'function' ? engine.ensureInitialized() : Promise.resolve(),
                    new Promise((resolve) => setTimeout(resolve, 750)),
                ]);

                const g =
                    typeof engine.getConceptGraphSnapshot === 'function'
                        ? engine.getConceptGraphSnapshot({ maxNodes, maxEdges })
                        : { nodes: [], edges: [] };

                try {
                    recordToolEnd('lsp', 'ontology/getConceptGraph', Date.now() - t0, true);
                } catch {}
                return { schemaVersion: 2, nodes: g.nodes || [], edges: g.edges || [] };
            } catch {
                try {
                    recordToolEnd('lsp', 'ontology/getConceptGraph', Date.now() - t0, false);
                } catch {}
                return { schemaVersion: 2, nodes: [], edges: [] };
            }
        });

        // New: Build Symbol Map (Layer 3 targeted map)
        const BuildSymbolMapRequest = new RequestType<
            { symbol: string; uri?: string; maxFiles?: number; astOnly?: boolean },
            {
                schemaVersion: number;
                identifier: string;
                files: number;
                declarations: any[];
                references: any[];
                imports: any[];
                exports: any[];
            },
            void
        >('symbol/buildSymbolMap');
        this.connection.onRequest(BuildSymbolMapRequest, async (params) => {
            const res = await (this.coreAnalyzer as any).buildSymbolMap({
                identifier: params.symbol,
                uri: params.uri,
                maxFiles: params.maxFiles ?? 10,
                astOnly: params.astOnly ?? true,
            });
            return { schemaVersion: 2, ...res };
        });

        // New: Plan Rename (preview WorkspaceEdit)
        const PlanRenameRequest = new RequestType<
            { oldName: string; newName: string; uri?: string },
            { schemaVersion: number; changes: Record<string, any[]>; summary?: { filesAffected: number; totalEdits: number } },
            void
        >('refactor/planRename');
        this.connection.onRequest(PlanRenameRequest, async (params) => {
            const result = await this.coreAnalyzer.rename({
                uri: params.uri || (this.coreAnalyzer as any)?.config?.workspaceRoot || 'file://workspace',
                position: { line: 0, character: 0 },
                identifier: params.oldName,
                newName: params.newName,
                dryRun: true,
            } as any);
            const changes = result.data.changes || {};
            const files = Object.keys(changes).length;
            const total = Object.values(changes).reduce((acc: number, arr: any) => acc + (arr as any[]).length, 0);
            return { schemaVersion: 2, changes, summary: { filesAffected: files, totalEdits: total } } as any;
        });

        // Lightweight: Refactoring suggestions (stub)
        // VS Code extension will use native CodeAction provider; this avoids -32601
        const SuggestRefactorRequest = new RequestType<
            { uri: string; position: { line: number; character: number } },
            Array<{ title: string; description?: string; confidence?: number; changes: any[] }>,
            void
        >('ontology/suggestRefactoring');
        this.connection.onRequest(SuggestRefactorRequest, async () => {
            return [];
        });

        // Configuration changes
        this.connection.onDidChangeConfiguration(() => {
            log('Configuration changed - reloading...');
            // Could reload configuration here
        });

        // Listen on documents
        this.documents.listen(this.connection);
        this.connection.listen();
    }

    /**
     * Start the LSP server
     */
    async start(): Promise<void> {
        // Avoid stdout logging in stdio mode
        console.error('Starting Semantic Code Intelligence Server...');
        // Connection starts listening automatically
    }

    /**
     * Shutdown the server
     */
    async shutdown(): Promise<void> {
        if (this.coreAnalyzer) {
            await this.coreAnalyzer.dispose();
        }
        console.error('Semantic Code Intelligence Server shut down');
    }
}

let serverInstance: LSPServer | null = null;

export function getLSPServer(): LSPServer {
    if (!serverInstance) {
        serverInstance = new LSPServer();
    }
    return serverInstance;
}

// Export lazy singleton proxy for compatibility without activating stdio listeners on import.
export const server = new Proxy({} as LSPServer, {
    get(_target, prop, receiver) {
        const instance = getLSPServer();
        const value = Reflect.get(instance, prop, receiver);
        return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(_target, prop, value, receiver) {
        const instance = getLSPServer();
        return Reflect.set(instance, prop, value, receiver);
    },
});

// Start server if run directly
if (import.meta.main) {
    getLSPServer().start().catch(console.error);
}
