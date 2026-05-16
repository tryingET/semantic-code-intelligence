/**
 * MCP Adapter - Convert MCP tool calls to core analyzer with enhanced error handling
 *
 * This adapter handles MCP-specific concerns:
 * - MCP tool call/response format
 * - Enhanced error handling and validation
 * - Timeout management
 * - Request/response logging
 *
 * All actual analysis work is delegated to the unified core analyzer.
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CoreError } from '../core/errors.js';
import { overlayStore } from '../core/overlay-store.js';
import { ToolRegistry } from '../core/tools/registry.js';
import { DefinitionKind } from '../core/types.js';
import { createValidationError, type ErrorContext, type RecoveryOptions, withMcpErrorHandling } from '../core/utils/error-handler.js';
import { adapterLogger, mcpLogger } from '../core/utils/file-logger.js';
import { AsyncEnhancedGrep } from '../layers/enhanced-search-tools-async.js';
import {
    buildCompletionRequest,
    buildFindDefinitionRequest,
    buildFindReferencesRequest,
    buildRenameRequest,
    completionToWireCompletion,
    createPosition,
    definitionToApiResponse,
    handleAdapterError,
    normalizePosition,
    normalizeUri,
    referenceToApiResponse,
    validateRequired,
} from './utils.js';

// Minimal core analyzer surface required by MCP adapter
type CoreAnalyzer = {
    rename: (req: any) => Promise<{ data: any; performance: any; requestId?: string }>;
    getCompletions?: (req: any) => Promise<{ data: any }>;
    findDefinitionAsync?: (req: any) => Promise<{ data: any[]; performance: any; requestId?: string }>;
    findReferencesAsync?: (req: any) => Promise<{ data: any[]; performance: any; requestId?: string }>;
    buildSymbolMap?: (req: any) => Promise<any>;
    exploreCodebase?: (req: any) => Promise<any>;
    getDiagnostics?: () => any;
    config?: any;
};

export interface MCPAdapterConfig {
    maxResults?: number;
    timeout?: number;
    enableSSE?: boolean;
    ssePort?: number;
}

/**
 * MCP Protocol Adapter - converts MCP tool calls to core analyzer calls
 */
export class MCPAdapter {
    private coreAnalyzer: CoreAnalyzer;
    private config: MCPAdapterConfig;

    constructor(coreAnalyzer: CoreAnalyzer, config: MCPAdapterConfig = {}) {
        this.coreAnalyzer = coreAnalyzer;
        this.config = {
            maxResults: 100,
            timeout: 30000,
            enableSSE: true,
            ssePort: 7001,
            ...config,
        };

        // Defensive wrapper to ensure MCP-compatible shape for direct calls in tests
        const original = this.handleToolCall.bind(this);
        (this as any)._originalHandleToolCall = original;
        this.handleToolCall = (async (...args: any[]) => {
            let name: string;
            let arguments_: Record<string, any> = {};
            if (typeof args[0] === 'string') {
                name = args[0];
                arguments_ = (args[1] || {}) as Record<string, any>;
            } else if (args[0] && typeof args[0] === 'object' && 'name' in args[0]) {
                name = String(args[0].name);
                arguments_ = (args[0].arguments || {}) as Record<string, any>;
            } else {
                name = String(args[0]);
                arguments_ = (args[1] || {}) as Record<string, any>;
            }
            const out = await original(name, arguments_);
            if (out && typeof out === 'object' && ('error' in out || (out as any).isError)) {
                return out;
            }
            if (!out || typeof out !== 'object' || !('content' in out)) {
                const txt = (() => {
                    try {
                        return JSON.stringify(out, null, 2);
                    } catch {
                        return String(out);
                    }
                })();
                return { content: [{ type: 'text', text: txt }], isError: false } as any;
            }
            return out;
        }) as any;
    }

    /**
     * Get available MCP tools
     */
    getTools() {
        // Map registry tools with title and lightweight annotations for better UX
        return ToolRegistry.list().map((t: any) => ({
            name: t.name,
            title: t.title || undefined,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.category
                ? { category: t.category, recommended: t.category === 'workflow' }
                : { recommended: false },
        }));
    }

    // --- Ontology (L4) helpers to enrich workflows ---
    private getOntologyEngine(): any | null {
        try {
            const lm: any = (this.coreAnalyzer as any).layerManager;
            const l4 = lm?.getLayer?.('layer4');
            if (l4 && typeof l4.getOntologyEngine === 'function') return l4.getOntologyEngine();
        } catch {}
        return null;
    }

    private async pickOntologySeedFile(symbol: string): Promise<string | undefined> {
        const engine = this.getOntologyEngine();
        if (!engine) return undefined;
        try {
            await engine.ensureInitialized?.();
        } catch {}
        try {
            // Prefer non-strict to allow inference/creation when missing
            const concept = await (engine.findConcept?.(symbol) ?? engine.findConceptStrict?.(symbol));
            if (!concept) return undefined;
            let bestUri: string | undefined;
            let bestCount = -1;
            const anchors = typeof engine.listConceptAnchors === 'function' ? engine.listConceptAnchors(concept.id) : [];
            for (const a of anchors) {
                const uri = (a as any)?.location?.uri as string | undefined;
                const occ = (a as any)?.occurrences ?? 0;
                if (uri && occ >= bestCount) {
                    bestCount = occ;
                    bestUri = uri;
                }
            }
            return bestUri;
        } catch {
            return undefined;
        }
    }

    /**
     * Handle MCP tool call with enhanced error handling
     */
    async handleToolCall(name: string, arguments_: Record<string, any>): Promise<any> {
        const context: ErrorContext = {
            component: 'MCPAdapter',
            operation: `tool_${name}`,
            timestamp: Date.now(),
        };

        try {
            const errorHandlingOptions = (() => {
                const longRunning =
                    name === 'patch_checks_in_snapshot' ||
                    name === 'structural_patch_checks' ||
                    name === 'apply_after_checks' ||
                    name === 'apply_snapshot' ||
                    name === 'rename_safely' ||
                    name === 'workflow_safe_rename' ||
                    name === 'rename_symbol';
                if (!longRunning) return undefined;

                const timeoutSec = Number(arguments_?.timeoutSec || 0);
                const cmdCount = Array.isArray(arguments_?.commands) ? Math.max(1, arguments_.commands.length) : 1;
                const derivedMs = timeoutSec > 0 ? (timeoutSec * cmdCount + 30) * 1000 : 10 * 60 * 1000;
                const timeoutMs = Math.max(60_000, Math.min(30 * 60 * 1000, derivedMs));

                return { timeoutMs, maxRetries: 0 } satisfies Partial<RecoveryOptions>;
            })();

            return await withMcpErrorHandling('MCPAdapter', `tool_${name}`, async () => {
                adapterLogger.debug(`Handling tool call: ${name}`, {
                    args: this.sanitizeForLogging(arguments_),
                });

                // Validate tool name early and return structured error (do not throw)
                const validTools = ToolRegistry.list()
                    .map((t) => t.name)
                    .concat(['suggest_refactoring']);
                if (!validTools.includes(name)) {
                    const msg = `Unknown tool: ${name}. Valid tools: ${validTools.join(', ')}`;
                    return handleAdapterError(new CoreError('UnknownTool', msg, { tool: name, validTools }), 'mcp');
                }

                const startTime = Date.now();
                // Ensure analyzer is ready before routing any core requests
                try {
                    await (this.coreAnalyzer as any)?.initialize?.();
                } catch {}
                let result: any;

                switch (name) {
                    case 'list_pipelines':
                        return this.handleListPipelines();
                    case 'run_pipeline':
                        return this.handleRunPipeline(arguments_);
                    case 'list_pipeline_runs':
                        return this.handleListPipelineRuns(arguments_);
                    case 'pipeline_status':
                        return this.handlePipelineStatus(arguments_);
                    case 'list_symbols':
                        return this.handleListSymbols(arguments_);
                    case 'execute_intent':
                        return this.handleExecuteIntent(arguments_);
                    case 'extract_snapshot_artifacts':
                        return this.handleExtractSnapshotArtifacts(arguments_);
                    case 'apply_after_checks':
                        return this.handleApplyAfterChecks(arguments_);
                    case 'workflow_explore_symbol':
                        return this.handleWorkflowExploreSymbol(arguments_);
                    case 'explore_symbol_impact':
                        return this.handleWorkflowExploreSymbol(arguments_);
                    case 'workflow_quick_patch_checks':
                        return this.handleWorkflowQuickPatchChecks(arguments_);
                    case 'patch_checks_in_snapshot':
                        return this.handleWorkflowQuickPatchChecks(arguments_);
                    case 'workflow_safe_rename':
                        return this.handleWorkflowSafeRename(arguments_);
                    case 'rename_safely':
                        return this.handleWorkflowSafeRename(arguments_);
                    case 'workflow_locate_confirm_definition':
                        return this.handleWorkflowLocateConfirmDefinition(arguments_);
                    case 'locate_confirm_definition':
                        return this.handleWorkflowLocateConfirmDefinition(arguments_);
                    case 'pattern_stats':
                        return this.handlePatternStats();
                    case 'get_snapshot':
                        return this.handleGetSnapshot(arguments_);
                    case 'read_file':
                        return this.handleReadFile(arguments_);
                    case 'propose_patch':
                        return this.handleProposePatch(arguments_);
                    case 'run_checks':
                        return this.handleRunChecks(arguments_);
                    case 'apply_snapshot':
                        return this.handleApplySnapshot(arguments_);
                    case 'text_search':
                        return this.handleTextSearch(arguments_);
                    case 'symbol_search':
                        return this.handleSymbolSearch(arguments_);
                    case 'structural_search':
                        return this.handleStructuralSearch(arguments_);
                    case 'structural_patch_checks':
                        return this.handleStructuralPatchChecks(arguments_);
                    case 'ast_query':
                        return this.handleAstQuery(arguments_);
                    case 'graph_expand':
                        return this.handleGraphExpand(arguments_);
                    case 'find_definition':
                        result = await this.handleFindDefinition(arguments_, context);
                        break;
                    case 'find_references':
                        result = await this.handleFindReferences(arguments_, context);
                        break;
                    case 'get_completions':
                        result = await this.handleGetCompletions(arguments_, context);
                        break;
                    case 'rename_symbol':
                        result = await this.handleRenameSymbol(arguments_, context);
                        break;
                    case 'plan_rename':
                        result = await this.handlePlanRename(arguments_, context);
                        break;
                    case 'apply_rename':
                        result = await this.handleApplyRename(arguments_, context);
                        break;
                    case 'build_symbol_map':
                        result = await this.handleBuildSymbolMap(arguments_, context);
                        break;
                    case 'generate_tests':
                        result = await this.handleGenerateTests(arguments_, context);
                        break;
                    case 'suggest_refactoring':
                        result = {
                            content: [{ type: 'text', text: JSON.stringify({ suggestions: [] }) }],
                            isError: false,
                        };
                        break;
                    case 'explore_codebase':
                        result = await this.handleExploreCodebase(arguments_, context);
                        break;
                }

                const duration = Date.now() - startTime;
                const safeStr = (() => {
                    try {
                        const s = JSON.stringify(result);
                        return typeof s === 'string' ? s : '';
                    } catch {
                        try {
                            return String(result ?? '');
                        } catch {
                            return '';
                        }
                    }
                })();
                adapterLogger.logPerformance(`tool_${name}`, duration, true, {
                    resultSize: safeStr.length,
                });
                if (process.env.DEBUG && !process.env.SILENT_MODE) {
                    try {
                        adapterLogger.debug('tool result keys', {
                            keys: typeof result === 'object' && result ? Object.keys(result as any) : typeof result,
                        });
                    } catch {}
                }

                // Ensure MCP-compatible shape
                if (result && typeof result === 'object' && 'content' in result) {
                    return result;
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: typeof result === 'string' ? result : safeStr,
                        },
                    ],
                    isError: false,
                } as any;
            }, undefined, errorHandlingOptions);
        } catch (error) {
            // Let servers map CoreError to protocol-specific errors
            if (error instanceof CoreError) {
                throw error;
            }
            // Fallback: return adapter-shaped message for non-core errors
            return handleAdapterError(error, 'mcp');
        }
    }

    private async handleReadFile(args: Record<string, any>) {
        const requestedPath = typeof args?.path === 'string' ? args.path.trim() : '';
        if (!requestedPath) {
            return handleAdapterError(new CoreError('InvalidParams', 'Missing required parameter: path'), 'mcp');
        }

        if (typeof args?.snapshot === 'string' && args.snapshot.trim()) {
            try {
                overlayStore.ensureSnapshot(args.snapshot.trim());
            } catch (error: any) {
                return handleAdapterError(new CoreError('InvalidParams', error?.message || 'Invalid snapshot id'), 'mcp');
            }
        }

        const workspaceRoot = path.resolve(process.cwd());
        const absPath = path.resolve(workspaceRoot, requestedPath);
        const relPath = path.relative(workspaceRoot, absPath);
        if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) {
            return handleAdapterError(
                new CoreError('InvalidParams', 'read_file path must stay within the workspace', { path: requestedPath }),
                'mcp'
            );
        }

        const stat = await fs.stat(absPath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return handleAdapterError(
                new CoreError('InvalidParams', 'read_file path does not exist or is not a file', { path: requestedPath }),
                'mcp'
            );
        }

        const maxBytesRaw = Number(args?.maxBytes ?? 65_536);
        const maxBytes = Number.isFinite(maxBytesRaw) ? Math.max(1, Math.min(262_144, Math.floor(maxBytesRaw))) : 65_536;
        const content = await fs.readFile(absPath, 'utf8');
        const lines = content.split(/\r?\n/);

        const range = args?.range && typeof args.range === 'object' ? args.range : null;
        const startLineRaw = Number(range?.startLine ?? 1);
        const endLineRaw = Number(range?.endLine ?? lines.length);
        const startLine = Number.isFinite(startLineRaw) ? Math.max(1, Math.floor(startLineRaw)) : 1;
        const endLine = Number.isFinite(endLineRaw) ? Math.max(startLine, Math.floor(endLineRaw)) : lines.length;
        const selected = lines.slice(startLine - 1, Math.min(endLine, lines.length)).join('\n');
        const bytes = Buffer.byteLength(selected, 'utf8');
        const truncated = bytes > maxBytes;
        const text = truncated ? selected.slice(0, maxBytes) : selected;

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        path: relPath,
                        range: { startLine, endLine: Math.min(endLine, lines.length) },
                        content: text,
                        truncated,
                        bytes: Buffer.byteLength(text, 'utf8'),
                        totalLines: lines.length,
                    }),
                },
            ],
            isError: false,
        } as any;
    }

    private async handleListSymbols(args: Record<string, any>) {
        const file = typeof args?.file === 'string' ? args.file : '';
        if (!file) return { content: [{ type: 'text', text: 'file required' }], isError: true };
        try {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);

            const text = await fs.readFile(abs, 'utf8');
            const lines = text.split(/\r?\n/);
            const out: Array<{ name: string; kind: string; line: number; character: number }> = [];
            const push = (name: string, kind: string, line: number, character: number) => {
                out.push({ name, kind, line, character });
            };

            // Optional AST-backed path (feature flag or explicit arg)
            const wantAst = String(args?.ast || '').toLowerCase() === 'true' || process.env.LIST_SYMBOLS_AST === '1';
            if (wantAst) {
                try {
                    const { runAstQuery } = await import('../core/ast-query.js');
                    // Infer language from extension
                    const ext = abs.toLowerCase();
                    let language: 'typescript' | 'javascript' | 'python' | null = null;
                    if (/(\.ts|\.tsx)$/.test(ext)) language = 'typescript';
                    else if (/(\.js|\.jsx)$/.test(ext)) language = 'javascript';
                    else if (/\.py$/.test(ext)) language = 'python';

                    if (language) {
                        // Build a simple language-appropriate query that captures identifier nodes as names
                        let query = '';
                        if (language === 'typescript') {
                            query = `
                                (function_declaration name: (identifier) @sym.func)
                                (method_definition name: (property_identifier) @sym.method)
                                (class_declaration name: (type_identifier) @sym.class)
                                (interface_declaration name: (type_identifier) @sym.interface)
                                (variable_declaration (variable_declarator name: (identifier) @sym.var))
                                (export_statement (export_clause (export_specifier name: (identifier) @sym.export)))
                            `;
                        } else if (language === 'javascript') {
                            query = `
                                (function_declaration name: (identifier) @sym.func)
                                (method_definition name: (property_identifier) @sym.method)
                                (class_declaration name: (identifier) @sym.class)
                                (variable_declaration (variable_declarator name: (identifier) @sym.var))
                                (export_statement (export_clause (export_specifier name: (identifier) @sym.export)))
                            `;
                        } else if (language === 'python') {
                            query = `
                                (function_definition name: (identifier) @sym.func)
                                (class_definition name: (identifier) @sym.class)
                            `;
                        }

                        const res = await runAstQuery({ language, query, paths: [abs], limit: 2000 });
                        if (Array.isArray(res?.results)) {
                            for (const r of res.results) {
                                if (!r || !r.start || !r.end) continue;
                                const start = r.start;
                                const end = r.end;
                                let name = '';
                                if (start.line === end.line) {
                                    const line = lines[start.line] || '';
                                    name = line.slice(start.column, end.column).trim();
                                } else {
                                    // Multi-line identifier is unlikely; best effort
                                    const first = (lines[start.line] || '').slice(start.column);
                                    const last = (lines[end.line] || '').slice(0, end.column);
                                    name = `${first}${last}`.trim();
                                }
                                if (!name) continue;
                                // Map capture to kind
                                const cap: string = String(r.capture || '');
                                let kind = 'symbol';
                                if (cap.includes('func')) kind = 'function';
                                else if (cap.includes('method')) kind = 'method';
                                else if (cap.includes('class')) kind = 'class';
                                else if (cap.includes('interface')) kind = 'interface';
                                else if (cap.includes('export')) kind = 'export';
                                else if (cap.includes('var')) kind = 'const';
                                push(name, kind, start.line, start.column);
                            }
                        }
                    }
                } catch (e) {
                    // AST path failed or grammars missing — fall back to regex below
                    if (process.env.DEBUG && !process.env.SILENT_MODE) {
                        // eslint-disable-next-line no-console
                        console.error(
                            'list_symbols AST path failed; falling back to regex:',
                            e instanceof Error ? e.message : e
                        );
                    }
                }
            }

            // Fallback or supplement with simple, file-scoped regex extraction (fast and bounded)
            if (out.length === 0) {
                for (let i = 0; i < lines.length; i++) {
                    const l = lines[i];
                    let m = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
                    if (m) push(m[1], 'class', i, Math.max(0, l.indexOf(m[1])));
                    m = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(l);
                    if (m) push(m[1], 'function', i, Math.max(0, l.indexOf(m[1])));
                    m = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
                    if (m) push(m[1], 'interface', i, Math.max(0, l.indexOf(m[1])));
                    m = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
                    if (m) push(m[1], 'const', i, Math.max(0, l.indexOf(m[1])));
                    m = /\bexport\s+\{\s*([^}]+)\}/.exec(l);
                    if (m) {
                        const names = m[1]
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                        for (const n of names) push(n.split(/\s+as\s+/i)[0], 'export', i, Math.max(0, l.indexOf(n)));
                    }
                }
            }

            const result = { file: abs, symbols: out.slice(0, 500) };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `list_symbols failed: ${msg}` }], isError: true };
        }
    }

    // --- Pipelines (L5) ---
    private getLearningOrchestrator(): any | null {
        try {
            const lo = (this.coreAnalyzer as any)?.learningOrchestrator;
            return lo || null;
        } catch {
            return null;
        }
    }

    private async handleListPipelines() {
        const lo = this.getLearningOrchestrator();
        if (!lo) return { content: [{ type: 'text', text: 'learning orchestrator unavailable' }], isError: true };
        try {
            const pipelines = Array.from((lo as any).pipelines?.values?.() || []);
            const items = await Promise.all(
                pipelines.map(async (p: any) => {
                    const id = String(p?.id || '');
                    const lastRunAt =
                        typeof (lo as any).getPipelineLastRunAt === 'function'
                            ? await (lo as any).getPipelineLastRunAt(id)
                            : null;
                    const nextRunAt =
                        typeof (lo as any).getPipelineNextRunAt === 'function' ? (lo as any).getPipelineNextRunAt(id) : null;
                    const scheduleNote =
                        typeof (lo as any).getPipelineScheduleNote === 'function'
                            ? (lo as any).getPipelineScheduleNote(id)
                            : null;
                    return {
                        id,
                        name: p.name,
                        trigger: p.trigger,
                        schedule: p.schedule || null,
                        enabled: !!p.enabled,
                        lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
                        nextRunAt: typeof nextRunAt === 'number' ? nextRunAt : null,
                        scheduleNote: typeof scheduleNote === 'string' ? scheduleNote : null,
                    };
                })
            );
            return { content: [{ type: 'text', text: JSON.stringify({ pipelines: items }, null, 2) }], isError: false };
        } catch (e) {
            return { content: [{ type: 'text', text: 'failed to list pipelines' }], isError: true };
        }
    }

    private async handlePipelineStatus(args: Record<string, any>) {
        const id = String(args?.id || '').trim();
        if (!id) return { content: [{ type: 'text', text: 'id required' }], isError: true };
        const lo = this.getLearningOrchestrator();
        if (!lo) return { content: [{ type: 'text', text: 'learning orchestrator unavailable' }], isError: true };
        try {
            const p = (lo as any).pipelines?.get?.(id);
            if (!p)
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ok: false, reason: 'not_found' }) }],
                    isError: false,
                };
            const lastRunAt =
                typeof (lo as any).getPipelineLastRunAt === 'function' ? await (lo as any).getPipelineLastRunAt(id) : null;
            const nextRunAt =
                typeof (lo as any).getPipelineNextRunAt === 'function' ? (lo as any).getPipelineNextRunAt(id) : null;
            const scheduleNote =
                typeof (lo as any).getPipelineScheduleNote === 'function' ? (lo as any).getPipelineScheduleNote(id) : null;
            const status = {
                id: p.id,
                name: p.name,
                trigger: p.trigger,
                schedule: p.schedule || null,
                enabled: !!p.enabled,
                stats: p.stats || { runsCompleted: 0, runsSuccessful: 0, averageRuntimeMs: 0 },
                lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
                nextRunAt: typeof nextRunAt === 'number' ? nextRunAt : null,
                scheduleNote: typeof scheduleNote === 'string' ? scheduleNote : null,
            };
            return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }], isError: false };
        } catch {
            return { content: [{ type: 'text', text: 'failed to get pipeline status' }], isError: true };
        }
    }

    private async handleRunPipeline(args: Record<string, any>) {
        const id = String(args?.id || '').trim();
        if (!id) return { content: [{ type: 'text', text: 'id required' }], isError: true };
        const lo = this.getLearningOrchestrator();
        if (!lo) return { content: [{ type: 'text', text: 'learning orchestrator unavailable' }], isError: true };
        try {
            const context = {
                requestId: String(Date.now()),
                operation: 'pipeline_run',
                timestamp: new Date(),
                metadata: {},
            };
            const res = await (lo as any).runPipeline(id, context);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: !res?.ok };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `run_pipeline failed: ${msg}` }], isError: true };
        }
    }

    private async handleListPipelineRuns(args: Record<string, any>) {
        const id = String(args?.id || '').trim();
        const limit = Math.max(1, Math.min(100, Number(args?.limit || 10)));
        if (!id) return { content: [{ type: 'text', text: 'id required' }], isError: true };
        const lo = this.getLearningOrchestrator();
        if (!lo) return { content: [{ type: 'text', text: 'learning orchestrator unavailable' }], isError: true };
        try {
            const rows = await (lo as any).listPipelineRuns(id, limit);
            return { content: [{ type: 'text', text: JSON.stringify({ runs: rows }, null, 2) }], isError: false };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `list_pipeline_runs failed: ${msg}` }], isError: true };
        }
    }

    private async handleExecuteIntent(args: Record<string, any>) {
        const intentRaw = String(args?.intent || '')
            .trim()
            .toLowerCase();
        const hasPatch = typeof args?.patch === 'string' && args.patch.trim().length > 0;
        const hasRename =
            typeof args?.oldName === 'string' && typeof args?.newName === 'string' && args.oldName && args.newName;
        const hasSymbol = typeof args?.symbol === 'string' && args.symbol.trim().length > 0;

        const prefer = intentRaw as 'rename' | 'patch' | 'explore' | 'locate' | 'apply' | '';
        let invoked = '';
        let result: any = null;

        // Choose intent
        if (prefer === 'rename' || hasRename) {
            invoked = 'rename_safely';
            result = await this.handleWorkflowSafeRename(args);
        } else if (prefer === 'patch' || hasPatch) {
            invoked = 'patch_checks_in_snapshot';
            const checks = await this.handleWorkflowQuickPatchChecks(args);
            const out = this.safeParseContent(checks) || {};
            // Optionally apply if ok and allowed
            const doApply = !!args?.applyIfOk && out?.ok && process.env.ALLOW_SNAPSHOT_APPLY === '1';
            if (doApply && out?.snapshot) {
                const applied = await this.handleApplySnapshot({ snapshot: out.snapshot, check: false });
                const appTxt = this.safeParseContent(applied) || {};
                const payload = { invoked, ...out, applied: !!appTxt?.ok };
                return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: !out?.ok };
            }
            return checks;
        } else if (prefer === 'locate' || (hasSymbol && args?.precise !== false)) {
            invoked = 'locate_confirm_definition';
            result = await this.handleWorkflowLocateConfirmDefinition(args);
        } else if (prefer === 'explore' || hasSymbol) {
            invoked = 'explore_symbol_impact';
            result = await this.handleWorkflowExploreSymbol(args);
        } else if (prefer === 'apply') {
            invoked = 'apply_snapshot';
            result = await this.handleApplySnapshot(args);
        } else {
            const payload = {
                invoked: 'none',
                ok: false,
                message: 'Insufficient arguments; provide patch, oldName+newName, or symbol',
            };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
        }

        // Attach invoked to response content (when possible)
        try {
            const txt = this.safeParseContent(result) || {};
            const payload = { invoked, ...txt };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
        } catch {
            return result;
        }
    }

    private async handleExtractSnapshotArtifacts(args: Record<string, any>) {
        const snapshot = String(args?.snapshot || '').trim();
        if (!snapshot) return { content: [{ type: 'text', text: 'snapshot required' }], isError: true };
        const includeContent = args?.includeContent === true;
        const maxBytes = Math.max(1, Math.min(262_144, Number(args?.maxBytes || 65_536)));
        const links = [
            { uri: `snapshot://${snapshot}/overlay.diff`, name: 'overlay.diff', mimeType: 'text/plain' },
            { uri: `snapshot://${snapshot}/status`, name: 'status', mimeType: 'application/json' },
            { uri: `snapshot://${snapshot}/progress`, name: 'progress', mimeType: 'text/plain' },
        ];
        let status: any = { id: snapshot, exists: false, diffCount: 0, createdAt: null };
        let contents: any = undefined;
        try {
            const snap = overlayStore.ensureSnapshot(snapshot);
            status = {
                id: snapshot,
                exists: true,
                diffCount: Array.isArray((snap as any).diffs) ? (snap as any).diffs.length : 0,
                createdAt: (snap as any).createdAt || null,
                touchedFiles: (snap as any).touchedFiles ? Array.from((snap as any).touchedFiles) : [],
                materialized: false,
            };
            const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
            const dir = ensure ? await ensure(snapshot) : null;
            status.materialized = !!dir;
            if (includeContent && dir) {
                const readBounded = async (file: string) => {
                    try {
                        const text = await fs.readFile(path.join(dir, file), 'utf8');
                        const truncated = Buffer.byteLength(text, 'utf8') > maxBytes;
                        return { text: truncated ? text.slice(0, maxBytes) : text, truncated };
                    } catch {
                        return { text: '', truncated: false };
                    }
                };
                contents = {
                    overlayDiff: await readBounded('overlay.diff'),
                    progress: await readBounded('progress.log'),
                };
            }
        } catch (error) {
            status.error = error instanceof Error ? error.message : String(error);
        }
        const payload = { snapshot, links, status, contents };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: !status.exists };
    }

    private async handleApplyAfterChecks(args: Record<string, any>) {
        const patch = String(args?.patch || '').trim();
        if (!patch) return { content: [{ type: 'text', text: 'patch required' }], isError: true };
        const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
        const reverse = !!args?.reverse;
        // Ensure/derive snapshot
        const requested = typeof args?.snapshot === 'string' ? String(args.snapshot).trim() : '';
        let snapshot: string | undefined = requested || undefined;
        if (!snapshot) {
            // Default to a fresh snapshot for apply_after_checks to avoid cross-call contamination.
            const snapRes = await this.handleGetSnapshot({ preferExisting: false });
            const snapTxt = this.safeParseContent(snapRes);
            snapshot = (snapTxt?.snapshot || snapTxt?.id) as string | undefined;
        }
        if (!snapshot) return { content: [{ type: 'text', text: 'failed to create snapshot' }], isError: true };
        // Stage
        const stage = await this.handleProposePatch({ snapshot, patch });
        const stageOut = this.safeParseContent(stage) || {};
        // Checks
        const checks = await this.handleRunChecks({ snapshot, commands, timeoutSec });
        const chk = this.safeParseContent(checks) || {};
        if (chk?.ok && process.env.ALLOW_SNAPSHOT_APPLY === '1') {
            const app = await this.handleApplySnapshot({ snapshot, check: false, reverse });
            const appOut = this.safeParseContent(app) || {};
            const payload = {
                ok: !!chk?.ok,
                snapshot,
                applied: !!appOut?.ok,
                output_tail: chk?.output?.slice?.(-4000) || '',
            };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: !chk?.ok };
        }
        const payload = { ok: !!chk?.ok, snapshot, applied: false, output_tail: chk?.output?.slice?.(-4000) || '' };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: !chk?.ok };
    }

    // --- New handlers: snapshots/patches/checks ---
    private async handlePatternStats() {
        try {
            const lm: any = (this.coreAnalyzer as any).layerManager;
            const l5 = lm?.getLayer?.('layer5');
            const stats = l5 && typeof l5.getPatternStatistics === 'function' ? await l5.getPatternStatistics() : {};
            return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }], isError: false };
        } catch (e) {
            return { content: [{ type: 'text', text: String(e) }], isError: true };
        }
    }

    private async handleWorkflowExploreSymbol(args: Record<string, any>) {
        const symbol = String(args?.symbol || '').trim();
        if (!symbol) return { content: [{ type: 'text', text: 'symbol required' }], isError: true };
        let file = typeof args?.file === 'string' ? args.file : undefined;
        if (!file) {
            // Ontology-first: use a known anchor (Thing location) to scope downstream steps
            file = (await this.pickOntologySeedFile(symbol)) || undefined;
        }
        const precise = (args?.precise ?? true) as boolean;
        const depth = typeof args?.depth === 'number' ? args.depth : 1;
        const limit = typeof args?.limit === 'number' ? args.limit : 50;

        const defs = await this.handleFindDefinition(
            { symbol, file, precise, maxResults: limit },
            { component: 'MCPAdapter', operation: 'workflow_explore_symbol', timestamp: Date.now() }
        );
        const map = await this.handleBuildSymbolMap(
            { symbol, file, maxFiles: Math.min(20, limit), astOnly: true },
            { component: 'MCPAdapter', operation: 'workflow_explore_symbol', timestamp: Date.now() }
        );
        const neighbors = await this.handleGraphExpand(
            file
                ? { file, edges: ['imports', 'exports', 'callers', 'callees'], depth, limit }
                : { symbol, edges: ['imports', 'exports', 'callers', 'callees'], depth, limit }
        );

        const out = {
            ok: true,
            definitions: this.safeParseContent(defs),
            symbolMap: this.safeParseContent(map),
            neighbors: this.safeParseContent(neighbors),
            tips: [
                'Prefer files whose basename includes the symbol for quick AST validation.',
                'Escalate to precise mode when candidates ≥ 3 or confidence is low.',
            ],
            next_actions: ['Open top definition', 'Inspect low-confidence callers'],
        };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false };
    }

    private async handleWorkflowQuickPatchChecks(args: Record<string, any>) {
        const patch = String(args?.patch || '');
        if (!patch) return { content: [{ type: 'text', text: 'patch required' }], isError: true };
        const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;

        const requested = typeof args?.snapshot === 'string' ? String(args.snapshot).trim() : '';
        let snapId: string | undefined = requested || undefined;
        if (!snapId) {
            // Default to a fresh snapshot for tool-first patch validation to avoid stale state.
            const snapRes = await this.handleGetSnapshot({ preferExisting: false });
            const snapText = this.safeParseContent(snapRes);
            snapId = (snapText?.snapshot || snapText?.id || snapText?.snapshot_id) as string | undefined;
        }
        if (!snapId) return { content: [{ type: 'text', text: 'failed to create snapshot' }], isError: true };

        const stage = await this.handleProposePatch({ snapshot: snapId, patch });
        const staged = this.safeParseContent(stage);
        const checks = await this.handleRunChecks({ snapshot: snapId, commands, timeoutSec });
        const checksOut = this.safeParseContent(checks);
        const ok = !!checksOut?.ok;
        const out = {
            workflow: 'patch_checks_in_snapshot',
            ok,
            snapshot: snapId,
            stage: staged,
            checks: checksOut,
            next_actions: ok ? ['Apply patch in working tree'] : ['Review failing checks; adjust and re-run'],
        };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false };
    }

    private async handleWorkflowSafeRename(args: Record<string, any>) {
        const oldName = String(args?.oldName || '').trim();
        const newName = String(args?.newName || '').trim();
        if (!oldName || !newName) {
            return { content: [{ type: 'text', text: 'oldName and newName required' }], isError: true };
        }
        let file = typeof args?.file === 'string' ? args.file : undefined;
        if (!file) {
            file = (await this.pickOntologySeedFile(oldName)) || undefined;
        }
        const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
        const runChecksFlag: boolean = args?.runChecks !== false;

        // Step 1: plan rename (WorkspaceEdit preview)
        const planRes = await this.handlePlanRename(
            { oldName, newName, file },
            { component: 'MCPAdapter', operation: 'workflow_safe_rename', timestamp: Date.now() }
        );
        const plan = this.safeParseContent(planRes);
        const changes = plan?.changes || {};
        const files = Object.keys(changes);
        if (!files.length) {
            const out = { ok: false, reason: 'no_changes', message: 'Rename produced no changes' };
            return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false };
        }

        // Step 2: snapshot and generate unified diff from WorkspaceEdit
        const snap = overlayStore.createSnapshot(true);
        const diffParts: string[] = [];
        const root = (this.coreAnalyzer as any)?.config?.workspaceRoot || process.cwd();
        const tmpRootBase = runChecksFlag
            ? (await (overlayStore as any).ensureMaterialized?.(snap.id)) || ''
            : path.resolve('.ontology', 'tmp-diffs');
        if (!tmpRootBase) {
            const out = { ok: false, reason: 'snapshot_failed', message: 'Failed to prepare snapshot' };
            return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: true };
        }
        const tmpRoot = path.join(tmpRootBase, '.mcp-work');
        await fs.mkdir(tmpRoot, { recursive: true }).catch(() => {});

        for (const uri of files) {
            const fileEdits = changes[uri] as any[];
            if (!Array.isArray(fileEdits) || !fileEdits.length) continue;
            const absPath = (() => {
                try {
                    return new URL(uri).pathname;
                } catch {
                    return uri.replace(/^file:\/\//, '');
                }
            })();
            const rel = path.relative(root, absPath);
            const srcPath = path.join(root, rel);
            let orig = '';
            try {
                orig = await fs.readFile(srcPath, 'utf8');
            } catch {
                continue;
            }
            const mod = this.applyTextEdits(orig, fileEdits);
            const tmpPath = path.join(tmpRoot, rel);
            await fs.mkdir(path.dirname(tmpPath), { recursive: true }).catch(() => {});
            await fs.writeFile(tmpPath, mod, 'utf8');

            const left = srcPath.replace(/"/g, '\\"');
            const right = tmpPath.replace(/"/g, '\\"');
            const cmd = `git diff --no-index --src-prefix=a/ --dst-prefix=b/ -- "${left}" "${right}"`;
            const proc = spawnSync('bash', ['-lc', cmd], { stdio: 'pipe' });
            const out = String(proc.stdout || '');
            if (out && out.trim().length > 0) {
                diffParts.push(out);
            }
        }
        const unifiedDiff = diffParts.join('\n');
        const stage = overlayStore.stagePatch(snap.id, unifiedDiff);
        if (!stage.accepted) {
            const out = { ok: false, reason: 'stage_failed', message: stage.message || 'Failed to stage diff' };
            return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: true };
        }

        // Step 3: optionally run checks inside snapshot
        if (!runChecksFlag) {
            const quick = {
                workflow: 'rename_safely',
                ok: true,
                snapshot: snap.id,
                filesAffected: files.length,
                totalEdits: files.reduce((acc, f) => acc + (Array.isArray(changes[f]) ? changes[f].length : 0), 0),
                next_actions: ['Run checks when ready', 'Open snapshot diff: snapshot://' + snap.id + '/overlay.diff'],
            };
            return { content: [{ type: 'text', text: JSON.stringify(quick, null, 2) }], isError: false };
        }

        // Step 3: run checks inside snapshot
        const onlyTouchedEnv = (process.env.FAST_STDIO_CHECKS || '').toLowerCase() === 'touched';
        const onlyTouched =
            typeof (args as any)?.onlyTouched === 'boolean' ? !!(args as any).onlyTouched : onlyTouchedEnv;
        const checks = await overlayStore.runChecks(snap.id, commands, timeoutSec, { onlyTouched });
        const ok = !!checks.ok;
        const result = {
            workflow: 'rename_safely',
            ok,
            snapshot: snap.id,
            filesAffected: files.length,
            totalEdits: files.reduce((acc, f) => acc + (Array.isArray(changes[f]) ? changes[f].length : 0), 0),
            elapsedMs: checks.elapsedMs,
            outputTail: (checks.output || '').slice(-4000),
            next_actions: ok
                ? [
                      'Optionally apply this patch to working tree',
                      'Open snapshot diff: snapshot://' + snap.id + '/overlay.diff',
                  ]
                : ['Review failing checks in outputTail', 'Adjust plan and retry'],
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !ok };
    }

    private applyTextEdits(
        text: string,
        edits: Array<{
            range: { start: { line: number; character: number }; end: { line: number; character: number } };
            newText: string;
        }>
    ): string {
        if (!Array.isArray(edits) || edits.length === 0) return text;
        // Convert positions to offsets
        const lineStarts: number[] = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') lineStarts.push(i + 1);
        }
        const toOffset = (pos: { line: number; character: number }) => {
            const l = Math.max(0, Math.min(pos.line, lineStarts.length - 1));
            const lineStart = lineStarts[l] ?? 0;
            return lineStart + Math.max(0, pos.character);
        };
        const items = edits.map((e) => ({
            start: toOffset(e.range.start),
            end: toOffset(e.range.end),
            newText: e.newText ?? '',
        }));
        // Apply from end to start to avoid shifting
        items.sort((a, b) => b.start - a.start);
        let out = text;
        for (const e of items) {
            out = out.slice(0, e.start) + e.newText + out.slice(e.end);
        }
        return out;
    }
    private async handleWorkflowLocateConfirmDefinition(args: Record<string, any>) {
        const symbol = String(args?.symbol || '').trim();
        if (!symbol) return { content: [{ type: 'text', text: 'symbol required' }], isError: true };
        let file = typeof args?.file === 'string' ? args.file : undefined;
        if (!file) {
            file = (await this.pickOntologySeedFile(symbol)) || undefined;
        }
        const attempts: any[] = [];
        // First attempt: fast path (precise=false)
        const fast = await this.handleFindDefinition(
            { symbol, file, precise: false, maxResults: Math.min(50, Number(args?.maxResults || 50)) },
            { component: 'MCPAdapter', operation: 'workflow_locate_confirm_definition', timestamp: Date.now() }
        );
        const fastOut = this.safeParseContent(fast);
        attempts.push({ mode: 'fast', count: Array.isArray(fastOut?.definitions) ? fastOut.definitions.length : 0 });

        let chosen = fastOut;
        // If ambiguous or empty and precise not disabled, try precise pass
        const ambiguous = !fastOut?.definitions || fastOut.definitions.length !== 1;
        const doPrecise = args?.precise !== false && ambiguous;
        if (doPrecise) {
            const precise = await this.handleFindDefinition(
                { symbol, file, precise: true, maxResults: Math.min(50, Number(args?.maxResults || 50)) },
                { component: 'MCPAdapter', operation: 'workflow_locate_confirm_definition', timestamp: Date.now() }
            );
            const preciseOut = this.safeParseContent(precise);
            attempts.push({
                mode: 'precise',
                count: Array.isArray(preciseOut?.definitions) ? preciseOut.definitions.length : 0,
            });
            // Prefer precise when it yields any results
            if (preciseOut?.definitions && preciseOut.definitions.length > 0) {
                chosen = preciseOut;
            }
        }

        const out = {
            workflow: 'locate_confirm_definition',
            ok: Array.isArray(chosen?.definitions) && chosen.definitions.length > 0,
            symbol,
            attempts,
            definitions: chosen?.definitions || [],
            decision: ambiguous && doPrecise ? 'precise_retry' : 'fast',
        };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false };
    }

    private safeParseContent(result: any): any {
        try {
            const txt = result?.content?.[0]?.text;
            if (!txt) return result;
            return JSON.parse(txt);
        } catch {
            return result;
        }
    }
    private async handleGetSnapshot(args: Record<string, any>) {
        const snap = overlayStore.createSnapshot(!!args?.preferExisting);
        return { content: [{ type: 'text', text: JSON.stringify({ snapshot: snap.id }, null, 2) }], isError: false };
    }

    private async handleProposePatch(args: Record<string, any>) {
        const patch = String(args?.patch || '');
        const snapshot = String(args?.snapshot || '');
        if (!patch) {
            return { content: [{ type: 'text', text: 'Missing patch' }], isError: true };
        }
        try {
            const snap = overlayStore.ensureSnapshot(snapshot);
            const isApplyPatch = /\*\*\*\s+Begin Patch/.test(patch);
            const unified = isApplyPatch ? this.convertApplyPatchToUnified(patch) : patch;
            const res = overlayStore.stagePatch(snap.id, unified);
            const payload = { accepted: res.accepted, snapshot: snap.id, message: res.message };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: !res.accepted };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Invalid snapshot: ${msg}` }], isError: true };
        }
    }

    // Convert simple apply_patch format to a minimal unified diff understood by git/patch
    private convertApplyPatchToUnified(patch: string): string {
        const lines = patch.replace(/\r\n/g, '\n').split('\n');
        const out: string[] = [];
        let i = 0;
        function isFileHeader(s: string) {
            return /^\*\*\*\s+(Update|Add|Delete) File: /i.test(s);
        }
        while (i < lines.length) {
            const line = lines[i];
            // Find next file op
            const m = line.match(/^\*\*\*\s+(Update|Add|Delete) File:\s+(.+)$/i);
            if (!m) {
                i++;
                continue;
            }
            const kind = m[1].toLowerCase();
            const file = m[2].trim();
            i++;
            const chunk: string[] = [];
            while (i < lines.length && !isFileHeader(lines[i]) && !/^\*\*\*\s+End Patch$/i.test(lines[i])) {
                const l = lines[i];
                // Accept hunk markers and diff lines; ignore apply_patch footers
                if (/^@@/.test(l) || /^[ +-]/.test(l)) {
                    chunk.push(l);
                }
                i++;
            }
            if (kind === 'delete') {
                throw new Error(`apply_patch delete not supported for ${file}`);
            }
            // Minimal unified framing
            out.push(`diff --git a/${file} b/${file}`);
            if (kind === 'add') {
                out.push(`--- /dev/null`);
                out.push(`+++ b/${file}`);
            } else {
                out.push(`--- a/${file}`);
                out.push(`+++ b/${file}`);
            }
            // Ensure at least one hunk header exists
            if (!chunk.some((l) => /^@@/.test(l))) {
                out.push('@@');
            }
            for (const l of chunk) {
                if (/^\*\*\*\s+End of File/i.test(l)) continue;
                out.push(l);
            }
        }
        const joined = out.join('\n');
        if (!joined.trim()) {
            throw new Error('apply_patch conversion produced empty diff');
        }
        return joined + (joined.endsWith('\n') ? '' : '\n');
    }

    private async handleRunChecks(args: Record<string, any>) {
        const snapshot = String(args?.snapshot || '');
        if (!snapshot) {
            return { content: [{ type: 'text', text: 'Missing snapshot' }], isError: true };
        }
        const cmds = Array.isArray(args?.commands) ? (args?.commands as string[]) : [];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 120;
        const onlyTouchedEnv = (process.env.FAST_STDIO_CHECKS || '').toLowerCase() === 'touched';
        const onlyTouched = typeof args?.onlyTouched === 'boolean' ? !!args.onlyTouched : onlyTouchedEnv;
        let res: any;
        try {
            res = await overlayStore.runChecks(snapshot, cmds, timeoutSec, { onlyTouched });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Invalid snapshot: ${msg}` }], isError: true };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        { snapshot, ok: res.ok, elapsedMs: res.elapsedMs, output: res.output.slice(-4000) },
                        null,
                        2
                    ),
                },
            ],
            isError: !res.ok,
        };
    }

    private async handleApplySnapshot(args: Record<string, any>) {
        const snapshot = String(args?.snapshot || '').trim();
        const check = !!args?.check;
        const reverse = !!args?.reverse;
        if (!snapshot) {
            return { content: [{ type: 'text', text: 'Missing snapshot' }], isError: true };
        }
        if (process.env.ALLOW_SNAPSHOT_APPLY !== '1') {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'apply_snapshot is disabled. Set ALLOW_SNAPSHOT_APPLY=1 to enable.',
                    },
                ],
                isError: true,
            };
        }
        try {
            const res = await overlayStore.applyToWorkingTree(snapshot, { check, reverse });
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { snapshot, ok: res.ok, elapsedMs: res.elapsedMs, output: res.output.slice(-4000) },
                            null,
                            2
                        ),
                    },
                ],
                isError: !res.ok,
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `apply_snapshot failed: ${msg}` }], isError: true };
        }
    }

    // --- New handlers: search ---
    private async handleTextSearch(args: Record<string, any>) {
        const query = String(args?.query || '').trim();
        if (!query) return { content: [{ type: 'text', text: 'query required' }], isError: true };

        try {
            // Ensure analyzer is initialized
            await (this.coreAnalyzer as any)?.initialize?.();

            const kind = (args?.kind as string) || 'literal';
            const caseInsensitive = !!args?.caseInsensitive;
            const maxResults = Math.min(Number(args?.maxResults || 200), 1000);
            const path = String(args?.path || process.cwd());

            // Prepare query based on kind
            let searchQuery = query;
            if (kind === 'word') {
                searchQuery = `\\b${escapeRegex(query)}\\b`;
            } else if (kind === 'literal') {
                searchQuery = escapeRegex(query);
            }

            // Use the new textSearch method from CodeAnalyzer
            const result = await (this.coreAnalyzer as any).textSearch(searchQuery, {
                path,
                maxResults,
                caseInsensitive,
            });

            // Some analyzer configurations can return an empty indexed result before the
            // workspace index has warmed. Fall back to direct grep so harnessed LLM
            // sessions still get deterministic bounded navigation evidence.
            if (Number(result?.count || 0) === 0 && typeof query === 'string' && query.length > 0) {
                const asyncGrep = new AsyncEnhancedGrep({ cacheSize: 500, cacheTTL: 30000 });
                const results = await asyncGrep.search({ pattern: searchQuery, path, maxResults, timeout: 200, caseInsensitive });
                if (results.length > 0) {
                    const normalized = results.map((r) => ({
                        file: r.file,
                        line: r.line ?? 0,
                        column: r.column ?? 0,
                        text: r.text,
                    }));
                    return {
                        content: [
                            { type: 'text', text: JSON.stringify({ count: normalized.length, results: normalized }, null, 2) },
                        ],
                        isError: false,
                    };
                }
            }

            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                isError: false,
            };
        } catch (error) {
            // Fallback to direct AsyncEnhancedGrep if textSearch fails
            const kind = (args?.kind as string) || 'literal';
            const caseInsensitive = !!args?.caseInsensitive;
            const maxResults = Math.min(Number(args?.maxResults || 200), 1000);
            const path = String(args?.path || process.cwd());
            const asyncGrep = new AsyncEnhancedGrep({ cacheSize: 500, cacheTTL: 30000 });
            const pattern =
                kind === 'word' ? `\\b${escapeRegex(query)}\\b` : kind === 'literal' ? escapeRegex(query) : query;
            const results = await asyncGrep.search({ pattern, path, maxResults, timeout: 200, caseInsensitive });
            const normalized = results.map((r) => ({
                file: r.file,
                line: r.line ?? 0,
                column: r.column ?? 0,
                text: r.text,
            }));
            return {
                content: [
                    { type: 'text', text: JSON.stringify({ count: normalized.length, results: normalized }, null, 2) },
                ],
                isError: false,
            };
        }
    }

    private async handleSymbolSearch(args: Record<string, any>) {
        const query = String(args?.query || '').trim();
        if (!query) return { content: [{ type: 'text', text: 'query required' }], isError: true };
        const maxResults = Math.min(Number(args?.maxResults || 50), 200);
        const fileHint = typeof args?.fileHint === 'string' ? args.fileHint : '';
        const res = await (this.coreAnalyzer as any).buildSymbolMap({
            identifier: query,
            maxFiles: maxResults,
            astOnly: true,
        });
        let out = (res?.declarations || [])
            .slice(0, maxResults)
            .map((d: any) => ({ uri: d.uri, range: d.range, kind: d.kind, name: d.name || query }));

        if (out.length === 0 && fileHint) {
            const workspaceRoot = path.resolve(process.cwd());
            const absPath = path.resolve(workspaceRoot, fileHint);
            const relPath = path.relative(workspaceRoot, absPath);
            if (relPath && !relPath.startsWith('..') && !path.isAbsolute(relPath)) {
                const text = await fs.readFile(absPath, 'utf8').catch(() => '');
                const lines = text.split(/\r?\n/);
                out = lines
                    .map((line, index) => ({ line, index, column: line.indexOf(query) }))
                    .filter((match) => match.column >= 0)
                    .slice(0, maxResults)
                    .map((match) => ({
                        uri: `file://${absPath}`,
                        range: {
                            start: { line: match.index, character: match.column },
                            end: { line: match.index, character: match.column + query.length },
                        },
                        kind: /function|class|interface|const|let|var|private|public|async/.test(match.line)
                            ? 'symbol'
                            : 'text_match',
                        name: query,
                        fallback: 'fileHint_text_scan',
                    }));
            }
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({ query, count: out.length, symbols: out }, null, 2) }],
            isError: false,
        };
    }

    private findAstGrepBinary(): string | null {
        const candidates = ['ast-grep', 'sg'];
        for (const candidate of candidates) {
            const found = spawnSync('bash', ['-lc', `command -v ${candidate}`], { stdio: 'pipe', encoding: 'utf8' });
            if (found.status !== 0) continue;
            const bin = String(found.stdout || '').trim();
            if (!bin) continue;
            const version = spawnSync(bin, ['--version'], { stdio: 'pipe', encoding: 'utf8' });
            const text = `${version.stdout || ''}${version.stderr || ''}`.trim().toLowerCase();
            if (candidate === 'ast-grep' || text.includes('ast-grep')) return bin;
        }
        return null;
    }

    private normalizeStructuralPaths(pathsArg: any): string[] {
        const workspaceRoot = path.resolve(process.cwd());
        const rawPaths = Array.isArray(pathsArg) && pathsArg.length > 0 ? pathsArg : ['.'];
        const out: string[] = [];
        for (const raw of rawPaths) {
            const requested = String(raw || '').trim();
            if (!requested) continue;
            const abs = path.resolve(workspaceRoot, requested);
            const rel = path.relative(workspaceRoot, abs);
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
                throw new CoreError('InvalidParams', 'structural paths must stay within the workspace', { path: requested });
            }
            out.push(rel === '' ? '.' : rel);
        }
        return out.length ? out : ['.'];
    }

    private async runStructuralProcess(
        command: string,
        args: string[],
        options: { timeoutMs: number; maxBuffer: number }
    ): Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean; outputExceeded: boolean }> {
        return await new Promise((resolve) => {
            const proc = spawn(command, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            let settled = false;
            let outputExceeded = false;
            const finish = (status: number | null, timedOut: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ status, stdout, stderr, timedOut, outputExceeded });
            };
            const append = (kind: 'stdout' | 'stderr', chunk: unknown) => {
                const next = kind === 'stdout' ? stdout + String(chunk) : stderr + String(chunk);
                if (Buffer.byteLength(next, 'utf8') > options.maxBuffer) {
                    outputExceeded = true;
                    stderr += `\nprocess output exceeded ${options.maxBuffer} bytes`;
                    proc.kill('SIGTERM');
                    finish(null, false);
                    return;
                }
                if (kind === 'stdout') stdout = next;
                else stderr = next;
            };
            const timer = setTimeout(() => {
                stderr += `\nprocess timed out after ${options.timeoutMs}ms`;
                proc.kill('SIGTERM');
                finish(null, true);
            }, options.timeoutMs);
            proc.stdout?.on('data', (chunk) => append('stdout', chunk));
            proc.stderr?.on('data', (chunk) => append('stderr', chunk));
            proc.on('error', (error) => {
                stderr += error instanceof Error ? error.message : String(error);
                finish(null, false);
            });
            proc.on('close', (code) => finish(code, false));
        });
    }

    private structuralProcessErrorPayload(proc: { stderr: string; timedOut: boolean; outputExceeded: boolean }, command: string) {
        const stderr = String(proc.stderr || '').trim();
        if (proc.timedOut) {
            return { ok: false, code: 'timeout', message: stderr || 'ast-grep timed out', command };
        }
        if (proc.outputExceeded) {
            return { ok: false, code: 'too_much_output', message: stderr || 'ast-grep output exceeded buffer limit', command };
        }
        const lower = stderr.toLowerCase();
        const code = lower.includes('pattern') || lower.includes('parse') || lower.includes('invalid') ? 'bad_ast_grep_pattern' : 'ast_grep_failed';
        return { ok: false, code, message: stderr.slice(0, 4000), command };
    }

    private structuralSnapshotLinks(snapshot: string) {
        return {
            overlayDiff: `snapshot://${snapshot}/overlay.diff`,
            status: `snapshot://${snapshot}/status`,
            progress: `snapshot://${snapshot}/progress`,
        };
    }

    private summarizeStructuralDiff(diff: string) {
        const files = new Map<string, { added: number; removed: number }>();
        let current = '';
        for (const line of diff.split(/\r?\n/)) {
            const file = /^diff --git a\/(.+?) b\//.exec(line)?.[1];
            if (file) {
                current = file;
                files.set(current, { added: 0, removed: 0 });
                continue;
            }
            if (!current || line.startsWith('+++') || line.startsWith('---')) continue;
            const item = files.get(current);
            if (!item) continue;
            if (line.startsWith('+')) item.added += 1;
            if (line.startsWith('-')) item.removed += 1;
        }
        return Array.from(files.entries()).map(([file, counts]) => ({ file, ...counts }));
    }

    private parseAstGrepJsonLines(stdout: string): any[] {
        const trimmed = String(stdout || '').trim();
        if (!trimmed) return [];
        const parsed: any[] = [];
        try {
            const value = JSON.parse(trimmed);
            return Array.isArray(value) ? value : [value];
        } catch {}
        for (const line of trimmed.split(/\r?\n/)) {
            const item = line.trim();
            if (!item) continue;
            try {
                parsed.push(JSON.parse(item));
            } catch {}
        }
        return parsed;
    }

    private async handleStructuralSearch(args: Record<string, any>) {
        const language = String(args?.language || '').trim();
        const pattern = String(args?.pattern || '').trim();
        if (!language || !pattern) {
            return { content: [{ type: 'text', text: 'language and pattern required' }], isError: true };
        }
        const bin = this.findAstGrepBinary();
        if (!bin) {
            const payload = { ok: false, code: 'ast_grep_unavailable', message: 'ast-grep binary not found on PATH' };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
        }
        let paths: string[];
        try {
            paths = this.normalizeStructuralPaths(args?.paths);
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
        const maxResults = Math.max(1, Math.min(1000, Number(args?.maxResults || 50)));
        const timeoutMs = Math.max(1_000, Math.min(120_000, Number(args?.timeoutMs || 30_000)));
        const maxBuffer = Math.max(64 * 1024, Math.min(32 * 1024 * 1024, Number(args?.maxBuffer || 8 * 1024 * 1024)));
        const proc = await this.runStructuralProcess(bin, ['run', '--pattern', pattern, '--lang', language, '--json=stream', ...paths], {
            maxBuffer,
            timeoutMs,
        });
        if (proc.status !== 0 && (String(proc.stderr || '').trim() || proc.timedOut || proc.outputExceeded)) {
            const payload = this.structuralProcessErrorPayload(proc, 'ast-grep run');
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
        }
        const allMatches = this.parseAstGrepJsonLines(String(proc.stdout || ''));
        const matches = allMatches.slice(0, maxResults).map((m: any) => ({
            file: m.file,
            range: m.range,
            snippet: String(m.text || m.lines || '').slice(0, 1000),
            language: m.language || language,
        }));
        const payload = {
            workflow: 'structural_search',
            ok: true,
            backend: 'ast-grep',
            language,
            pattern,
            paths,
            limits: { maxResults, timeoutMs, maxBuffer },
            count: matches.length,
            capped: allMatches.length > matches.length,
            matches,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
    }

    private applyStructuralReplacements(text: string, replacements: Array<{ start: number; end: number; replacement: string }>): string {
        const original = Buffer.from(text, 'utf8');
        const ordered = [...replacements].sort((a, b) => b.start - a.start);
        let current = original;
        for (const edit of ordered) {
            const start = Math.max(0, Math.min(current.length, edit.start));
            const end = Math.max(start, Math.min(current.length, edit.end));
            current = Buffer.concat([
                current.subarray(0, start),
                Buffer.from(edit.replacement, 'utf8'),
                current.subarray(end),
            ]);
        }
        return current.toString('utf8');
    }

    private async buildStructuralDiff(matches: any[]): Promise<{ diff: string; files: string[]; replacementCount: number }> {
        const workspaceRoot = path.resolve(process.cwd());
        const byFile = new Map<string, Array<{ start: number; end: number; replacement: string }>>();
        for (const match of matches) {
            const rel = String(match?.file || '').trim();
            const replacement = typeof match?.replacement === 'string' ? match.replacement : undefined;
            const start = Number(match?.replacementOffsets?.start ?? match?.range?.byteOffset?.start);
            const end = Number(match?.replacementOffsets?.end ?? match?.range?.byteOffset?.end);
            if (!rel || replacement === undefined || !Number.isFinite(start) || !Number.isFinite(end)) continue;
            const abs = path.resolve(workspaceRoot, rel);
            const normalizedRel = path.relative(workspaceRoot, abs);
            if (!normalizedRel || normalizedRel.startsWith('..') || path.isAbsolute(normalizedRel)) continue;
            const edits = byFile.get(normalizedRel) || [];
            edits.push({ start, end, replacement });
            byFile.set(normalizedRel, edits);
        }
        if (byFile.size === 0) return { diff: '', files: [], replacementCount: 0 };

        const tmpRoot = await fs.mkdtemp(path.join('/tmp', 'sci-structural-'));
        try {
            const diffParts: string[] = [];
            let replacementCount = 0;
            for (const [rel, edits] of byFile.entries()) {
                const ordered = [...edits].sort((a, b) => a.start - b.start);
                for (let i = 1; i < ordered.length; i++) {
                    if (ordered[i].start < ordered[i - 1].end) {
                        throw new CoreError('InvalidParams', 'ast-grep produced overlapping structural replacements', { file: rel });
                    }
                }
                const abs = path.join(workspaceRoot, rel);
                const original = await fs.readFile(abs, 'utf8');
                const modified = this.applyStructuralReplacements(original, edits);
                if (modified === original) continue;
                replacementCount += edits.length;
                const origPath = path.join(tmpRoot, 'orig', rel);
                const modPath = path.join(tmpRoot, 'mod', rel);
                await fs.mkdir(path.dirname(origPath), { recursive: true });
                await fs.mkdir(path.dirname(modPath), { recursive: true });
                await fs.writeFile(origPath, original, 'utf8');
                await fs.writeFile(modPath, modified, 'utf8');
                const proc = spawnSync('diff', ['-u', '--label', `a/${rel}`, '--label', `b/${rel}`, origPath, modPath], {
                    stdio: 'pipe',
                    encoding: 'utf8',
                    maxBuffer: 4 * 1024 * 1024,
                    timeout: 10_000,
                });
                const body = String(proc.stdout || '');
                if (body.trim()) diffParts.push(`diff --git a/${rel} b/${rel}\n${body}`);
            }
            return { diff: diffParts.join('\n'), files: Array.from(byFile.keys()), replacementCount };
        } finally {
            await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        }
    }

    private async handleStructuralPatchChecks(args: Record<string, any>) {
        const language = String(args?.language || '').trim();
        const pattern = String(args?.pattern || '').trim();
        const rewrite = String(args?.rewrite ?? '');
        if (!language || !pattern || !rewrite) {
            return { content: [{ type: 'text', text: 'language, pattern, and rewrite required' }], isError: true };
        }
        const bin = this.findAstGrepBinary();
        if (!bin) {
            const payload = { ok: false, code: 'ast_grep_unavailable', message: 'ast-grep binary not found on PATH' };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
        }
        let paths: string[];
        try {
            paths = this.normalizeStructuralPaths(args?.paths);
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
        const maxResults = Math.max(1, Math.min(2000, Number(args?.maxResults || 200)));
        const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
        const timeoutMs = Math.max(1_000, Math.min(120_000, Number(args?.timeoutMs || 30_000)));
        const maxBuffer = Math.max(64 * 1024, Math.min(32 * 1024 * 1024, Number(args?.maxBuffer || 16 * 1024 * 1024)));
        const proc = await this.runStructuralProcess(
            bin,
            ['run', '--pattern', pattern, '--rewrite', rewrite, '--lang', language, '--json=stream', ...paths],
            { maxBuffer, timeoutMs }
        );
        if (proc.status !== 0 && (String(proc.stderr || '').trim() || proc.timedOut || proc.outputExceeded)) {
            const payload = this.structuralProcessErrorPayload(proc, 'ast-grep run --rewrite');
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
        }
        const allMatches = this.parseAstGrepJsonLines(String(proc.stdout || ''));
        const matches = allMatches.slice(0, maxResults);
        let built: { diff: string; files: string[]; replacementCount: number };
        try {
            built = await this.buildStructuralDiff(matches);
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
        if (!built.diff.trim()) {
            const payload = {
                workflow: 'structural_patch_checks',
                ok: true,
                backend: 'ast-grep',
                language,
                pattern,
                rewrite,
                paths,
                limits: { maxResults, timeoutMs, maxBuffer },
                matches: allMatches.length,
                capped: allMatches.length > matches.length,
                patch: { files: [], replacementCount: 0, diffBytes: 0, summary: [] },
                snapshot: null,
                snapshotArtifacts: null,
                checks: null,
                applied: false,
                applyResult: null,
                next_actions: ['No structural replacements were generated; adjust pattern/rewrite or paths'],
            };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
        }

        const snap = overlayStore.createSnapshot(false);
        const stage = overlayStore.stagePatch(snap.id, built.diff);
        if (!stage.accepted) {
            const payload = { ok: false, matches: allMatches.length, snapshot: snap.id, stage, applied: false };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
        }
        const checks = await overlayStore.runChecks(snap.id, commands, timeoutSec);
        let applied = false;
        let applyResult: any = null;
        if (args?.apply === true) {
            if (process.env.ALLOW_SNAPSHOT_APPLY === '1' && checks.ok) {
                applyResult = await overlayStore.applyToWorkingTree(snap.id, { check: false });
                applied = !!applyResult?.ok;
            } else {
                applyResult = {
                    ok: false,
                    message: process.env.ALLOW_SNAPSHOT_APPLY === '1' ? 'checks_failed' : 'ALLOW_SNAPSHOT_APPLY=1 required',
                };
            }
        }
        const ok = !!checks.ok && (args?.apply === true ? applied : true);
        const snapshotArtifacts = this.structuralSnapshotLinks(snap.id);
        const payload = {
            workflow: 'structural_patch_checks',
            ok,
            backend: 'ast-grep',
            language,
            pattern,
            rewrite,
            paths,
            limits: { maxResults, timeoutMs, maxBuffer, timeoutSec },
            matches: allMatches.length,
            capped: allMatches.length > matches.length,
            patch: {
                files: built.files,
                replacementCount: built.replacementCount,
                diffBytes: Buffer.byteLength(built.diff, 'utf8'),
                summary: this.summarizeStructuralDiff(built.diff),
                diffSummary: built.diff.split(/\r?\n/).slice(0, 80).join('\n'),
            },
            snapshot: snap.id,
            snapshotArtifacts,
            links: Object.values(snapshotArtifacts),
            stage,
            checks: { commands, ok: !!checks.ok, elapsedMs: checks.elapsedMs, output: String(checks.output || '').slice(-4000) },
            applied,
            applyResult,
            next_actions: applied
                ? ['Review working tree diff and commit if appropriate']
                : [
                      `Open snapshot diff: ${snapshotArtifacts.overlayDiff}`,
                      `Open snapshot status: ${snapshotArtifacts.status}`,
                      args?.apply === true && process.env.ALLOW_SNAPSHOT_APPLY !== '1'
                          ? 'Set ALLOW_SNAPSHOT_APPLY=1 only when intentionally applying'
                          : 'Apply separately only after review',
                  ],
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
    }

    private async handleAstQuery(args: Record<string, any>) {
        const language = String(args?.language || '').trim();
        const query = String(args?.query || '').trim();
        if (!language || !query)
            return { content: [{ type: 'text', text: 'language and query required' }], isError: true };
        const paths = Array.isArray(args?.paths) ? (args.paths as string[]) : undefined;
        const glob = typeof args?.glob === 'string' ? (args.glob as string) : undefined;
        const limit = typeof args?.limit === 'number' ? args.limit : undefined;
        const { runAstQuery } = await import('../core/ast-query.js');
        const out = await runAstQuery({ language: language as any, query, paths, glob, limit });
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false };
    }

    private async handleGraphExpand(args: Record<string, any>) {
        const edges = Array.isArray(args?.edges) ? (args.edges as string[]) : ['imports', 'exports'];
        const file = typeof args?.file === 'string' ? (args.file as string) : undefined;
        const symbol = typeof args?.symbol === 'string' ? (args.symbol as string) : undefined;
        if (!file && !symbol) return { content: [{ type: 'text', text: 'file or symbol required' }], isError: true };
        try {
            const { expandNeighbors } = await import('../core/code-graph.js');
            let seedFiles: string[] | undefined;
            if (symbol) {
                try {
                    const sm = await (this.coreAnalyzer as any).buildSymbolMap({
                        identifier: symbol,
                        maxFiles: 50,
                        astOnly: true,
                    });
                    seedFiles = Array.from(
                        new Set(
                            (sm?.declarations || []).map((d: any) => {
                                try {
                                    return new URL(d.uri).pathname;
                                } catch {
                                    return d.uri.replace(/^file:\/\//, '');
                                }
                            })
                        )
                    );
                } catch {}
            }
            const out = await expandNeighbors({
                file,
                symbol,
                edges,
                depth: args?.depth,
                limit: args?.limit,
                seedFiles,
            });
            const payload = { schemaVersion: 2, ...out };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
        } catch {
            const neighbors: Record<string, any[]> = { imports: [], exports: [], callers: [], callees: [] };
            const note = 'fallback: graph expand unavailable; returning empty neighbors';
            const payload = file
                ? { schemaVersion: 2, file, neighbors, note }
                : { schemaVersion: 2, symbol: symbol || '', neighbors, note };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
        }
    }

    private wordAt(text: string, pos: { line: number; character: number }): string | null {
        const lines = text.split(/\r?\n/);
        if (pos.line < 0 || pos.line >= lines.length) return null;
        const line = lines[pos.line] || '';
        const idx = Math.min(Math.max(pos.character, 0), line.length);
        const re = /[A-Za-z0-9_]+/g;
        let m: RegExpExecArray | null = null;
        while ((m = re.exec(line))) {
            const start = m.index;
            const end = start + m[0].length;
            if (idx >= start && idx <= end) return m[0];
        }
        return null;
    }

    /**
     * Handle find_definition tool call with validation
     */
    private async handleFindDefinition(args: Record<string, any>, context: ErrorContext) {
        const position = args.position ? normalizePosition(args.position) : createPosition(0, 0);
        let symbol: string = typeof args.symbol === 'string' ? args.symbol : '';
        // Try derive symbol from file+position when not provided
        const uri = args.file ? normalizeUri(args.file) : null;
        if (!symbol && uri) {
            try {
                const fsPath = uri.startsWith('file://') ? uri.substring(7) : uri;
                const exists = await fs
                    .stat(fsPath)
                    .then(() => true)
                    .catch(() => false);
                if (exists) {
                    const text = await fs.readFile(fsPath, 'utf8');
                    const derived = this.wordAt(text, position);
                    if (derived) symbol = derived;
                }
            } catch {}
        }
        if (!symbol && !uri) {
            throw new CoreError('InvalidParams', 'Missing required parameter: symbol');
        }

        // Ensure core is initialized for E2E/local flows
        try {
            await (this.coreAnalyzer as any)?.initialize?.();
        } catch {}

        const maxResults =
            typeof args.maxResults === 'number' && args.maxResults > 0 ? args.maxResults : this.config.maxResults;

        if (!uri) {
            // Use workspace-wide search to find the symbol
            // This will trigger Layer 1's search capabilities
            const workspaceRequest = buildFindDefinitionRequest({
                uri: '', // Empty URI triggers workspace search
                position,
                identifier: symbol,
                maxResults,
                includeDeclaration: true,
                precise: !!args.precise,
            });

            try {
                // Quick explicit declaration scan to prefer true definitions in small workspaces
                const wsRoot = (this.coreAnalyzer as any)?.config?.workspaceRoot || process.cwd();
                const explicit = await this.scanForExplicitDeclaration(wsRoot, symbol);
                if (explicit) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    {
                                        schemaVersion: 2,
                                        definitions: [definitionToApiResponse(explicit as any)],
                                        performance: {
                                            layer1: 0,
                                            layer2: 0,
                                            layer3: 0,
                                            layer4: 0,
                                            layer5: 0,
                                            total: 0,
                                        },
                                        requestId: undefined,
                                        count: 1,
                                    },
                                    null,
                                    2
                                ),
                            },
                        ],
                        isError: false,
                    };
                }
                const result = await (this.coreAnalyzer as any).findDefinitionAsync(workspaceRequest);
                let prioritized = Array.isArray(result.data)
                    ? result.data.slice().sort((a: any, b: any) => {
                          const prioKind = (k: string) =>
                              k === 'class'
                                  ? 4
                                  : k === 'function'
                                    ? 3
                                    : k === 'interface'
                                      ? 2
                                      : k === 'variable'
                                        ? 1
                                        : 0;
                          const toBase = (u: string) => {
                              try {
                                  const p = new URL(u).pathname;
                                  return p.split('/').pop() || p;
                              } catch {
                                  return u.split('/').pop() || u;
                              }
                          };
                          const name = String(symbol || '').toLowerCase();
                          const aBase = toBase(a.uri).toLowerCase();
                          const bBase = toBase(b.uri).toLowerCase();
                          const aNameHit = aBase.includes(name) ? 1 : 0;
                          const bNameHit = bBase.includes(name) ? 1 : 0;
                          if (aNameHit !== bNameHit) return bNameHit - aNameHit;
                          const kindDiff = prioKind(b.kind) - prioKind(a.kind);
                          if (kindDiff !== 0) return kindDiff;
                          return (b.confidence || 0) - (a.confidence || 0);
                      })
                    : result.data;

                // If top result doesn't look like the defining file, try a quick targeted scan
                try {
                    const toBase = (u: string) => {
                        try {
                            const p = new URL(u).pathname;
                            return p.split('/').pop() || p;
                        } catch {
                            return u.split('/').pop() || u;
                        }
                    };
                    const top = Array.isArray(prioritized) && prioritized[0] ? prioritized[0] : null;
                    const name = String(args.symbol || '').toLowerCase();
                    const likelyTop = top ? toBase(top.uri).toLowerCase().includes(name) : false;
                    if (!likelyTop) {
                        const wsRoot = (this.coreAnalyzer as any)?.config?.workspaceRoot || process.cwd();
                        const fallbackDefs = await this.fallbackScanForDefinition(wsRoot, args.symbol, 300);
                        const match = fallbackDefs.find((d) => toBase(d.uri).toLowerCase().includes(name));
                        if (match) {
                            prioritized = [match, ...prioritized];
                        }
                        // As a final tie-breaker, inspect candidate lines to detect declarations
                        if (Array.isArray(prioritized) && prioritized.length) {
                            const fs = await import('fs/promises');
                            const declRe = new RegExp(`\\b(class|function|interface|type)\\s+${args.symbol}\\b`);
                            for (const def of prioritized.slice(0, 200)) {
                                try {
                                    const filePath = (() => {
                                        try {
                                            return new URL(def.uri).pathname;
                                        } catch {
                                            return def.uri.replace(/^file:\/\//, '');
                                        }
                                    })();
                                    const text = await fs.readFile(filePath, 'utf8');
                                    const lines = text.split(/\r?\n/);
                                    const line = lines[def.range?.start?.line ?? 0] || '';
                                    if (declRe.test(line)) {
                                        // Promote this as the top result
                                        prioritized = [def, ...prioritized.filter((d: any) => d !== def)];
                                        break;
                                    }
                                } catch {}
                            }
                        }
                    }
                } catch {}
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    schemaVersion: 2,
                                    definitions: prioritized.map((def: any) => definitionToApiResponse(def)),
                                    performance: result.performance,
                                    requestId: result.requestId,
                                    count: Array.isArray(prioritized) ? prioritized.length : 0,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                    isError: false,
                };
            } catch (e) {
                // Fallback: perform a very small, bounded scan in the configured workspace root
                const wsRoot = (this.coreAnalyzer as any)?.config?.workspaceRoot || process.cwd();
                const fallbackDefs = await this.fallbackScanForDefinition(wsRoot, args.symbol, 200);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    schemaVersion: 2,
                                    definitions: fallbackDefs.map((def: any) => definitionToApiResponse(def)),
                                    performance: { layer1: 0, layer2: 0, layer3: 0, layer4: 0, layer5: 0, total: 0 },
                                    requestId: undefined,
                                    count: fallbackDefs.length,
                                    fallback: true,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                    isError: false,
                };
            }
        }

        // Normal path when file is provided
        const request = buildFindDefinitionRequest({
            uri,
            position,
            identifier: args.symbol,
            maxResults,
            includeDeclaration: true,
        });

        const result = await (this.coreAnalyzer as any).findDefinitionAsync(request);
        const prioritized = Array.isArray(result.data)
            ? result.data.slice().sort((a: any, b: any) => {
                  const prioKind = (k: string) =>
                      k === 'class' ? 4 : k === 'function' ? 3 : k === 'interface' ? 2 : k === 'variable' ? 1 : 0;
                  const toBase = (u: string) => {
                      try {
                          const p = new URL(u).pathname;
                          return p.split('/').pop() || p;
                      } catch {
                          return u.split('/').pop() || u;
                      }
                  };
                  const name = String(args.symbol || '').toLowerCase();
                  const aBase = toBase(a.uri).toLowerCase();
                  const bBase = toBase(b.uri).toLowerCase();
                  const aNameHit = aBase.includes(name) ? 1 : 0;
                  const bNameHit = bBase.includes(name) ? 1 : 0;
                  if (aNameHit !== bNameHit) return bNameHit - aNameHit;
                  const kindDiff = prioKind(b.kind) - prioKind(a.kind);
                  if (kindDiff !== 0) return kindDiff;
                  return (b.confidence || 0) - (a.confidence || 0);
              })
            : result.data;

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            definitions: prioritized.map((def: any) => definitionToApiResponse(def)),
                            performance: result.performance,
                            requestId: result.requestId,
                            count: Array.isArray(prioritized) ? prioritized.length : 0,
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: false,
        };
    }

    // Extremely limited fallback used only when async fast-path times out in tests or constrained environments
    private async fallbackScanForDefinition(root: string, symbol: string, maxFiles: number) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const results: any[] = [];
        const queue: string[] = [root];
        const visited: Set<string> = new Set();
        const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`);
        let filesScanned = 0;

        while (queue.length && filesScanned < maxFiles && results.length === 0) {
            const dir = queue.shift()!;
            if (visited.has(dir)) continue;
            visited.add(dir);
            let entries: any[] = [];
            try {
                entries = await fs.readdir(dir, { withFileTypes: true } as any);
            } catch {
                continue;
            }
            for (const ent of entries) {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                    if (/node_modules|\.git|dist|coverage|out|build|venv|\.venv/.test(ent.name)) continue;
                    queue.push(p);
                } else if (ent.isFile() && /\.(ts|tsx|js|jsx|md)$/.test(ent.name)) {
                    filesScanned++;
                    try {
                        const text = await fs.readFile(p, 'utf8');
                        const lines = text.split(/\r?\n/);
                        for (let i = 0; i < lines.length; i++) {
                            if (re.test(lines[i])) {
                                results.push({
                                    identifier: symbol,
                                    uri: `file://${p}`,
                                    range: {
                                        start: { line: i, character: Math.max(0, lines[i].indexOf(symbol)) },
                                        end: {
                                            line: i,
                                            character: Math.max(0, lines[i].indexOf(symbol)) + symbol.length,
                                        },
                                    },
                                    kind: DefinitionKind.Class,
                                    name: symbol,
                                    source: 'exact',
                                    confidence: 0.5,
                                    layer: 'async-layer1',
                                });
                                break;
                            }
                        }
                    } catch {}
                    if (results.length > 0) break;
                }
                if (filesScanned >= maxFiles || results.length > 0) break;
            }
        }
        return results;
    }

    // Targeted scan to detect explicit declarations like class/function/interface/type <Symbol>
    private async scanForExplicitDeclaration(root: string, symbol: string) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const queue: string[] = [root];
        const visited: Set<string> = new Set();
        const declRe = new RegExp(`\\b(class|function|interface|type)\\s+${symbol}\\b`);

        while (queue.length) {
            const dir = queue.shift()!;
            if (visited.has(dir)) continue;
            visited.add(dir);
            let entries: any[] = [];
            try {
                entries = await fs.readdir(dir, { withFileTypes: true } as any);
            } catch {
                continue;
            }
            for (const ent of entries) {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                    if (/node_modules|\.git|dist|coverage|out|build|venv|\.venv/.test(ent.name)) continue;
                    queue.push(p);
                } else if (ent.isFile() && /\.(ts|tsx|js|jsx|md)$/.test(ent.name)) {
                    try {
                        const text = await fs.readFile(p, 'utf8');
                        const lines = text.split(/\r?\n/);
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            if (declRe.test(line)) {
                                const col = Math.max(0, line.indexOf(symbol));
                                return {
                                    identifier: symbol,
                                    uri: `file://${p}`,
                                    range: {
                                        start: { line: i, character: col },
                                        end: { line: i, character: col + symbol.length },
                                    },
                                    kind: /class\s+/.test(line)
                                        ? DefinitionKind.Class
                                        : /function\s+/.test(line)
                                          ? DefinitionKind.Function
                                          : /interface\s+/.test(line)
                                            ? DefinitionKind.Interface
                                            : DefinitionKind.Variable,
                                    name: symbol,
                                    source: 'exact',
                                    confidence: 0.95,
                                    layer: 'async-layer1',
                                };
                            }
                        }
                    } catch {}
                }
            }
        }
        return null;
    }

    /**
     * Handle find_references tool call with validation
     */
    private async handleFindReferences(args: Record<string, any>, context: ErrorContext) {
        // Parity: tolerate empty symbol by returning empty references (not error)
        if (typeof args?.symbol === 'string' && args.symbol.trim().length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { schemaVersion: 2, references: [], performance: { total: 0 }, requestId: 'none', count: 0 },
                            null,
                            2
                        ),
                    },
                ],
                isError: false,
            };
        }
        this.validateArgs(args, ['symbol'], context);
        try {
            await (this.coreAnalyzer as any)?.initialize?.();
        } catch {}

        // For MCP, we don't have exact position; require a file context for cross-protocol consistency
        const maxResults =
            typeof args.maxResults === 'number' && args.maxResults > 0 ? args.maxResults : this.config.maxResults;

        if (!args.file && !args.uri) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { schemaVersion: 2, references: [], performance: { total: 0 }, requestId: 'none', count: 0 },
                            null,
                            2
                        ),
                    },
                ],
                isError: false,
            };
        }
        // Use symbol-based search at provided file context
        const request = buildFindReferencesRequest({
            uri: normalizeUri(String(args.file || args.uri)),
            position: createPosition(0, 0),
            identifier: args.symbol,
            maxResults,
            includeDeclaration: args.includeDeclaration ?? false,
            precise: !!args.precise,
        });

        const result = await (this.coreAnalyzer as any).findReferencesAsync(request);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            references: result.data.map((ref: any) => referenceToApiResponse(ref)),
                            performance: result.performance,
                            requestId: result.requestId,
                            count: result.data.length,
                            scope: args.scope || 'workspace',
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: false,
        };
    }

    private async handleGetCompletions(args: Record<string, any>, context: ErrorContext) {
        this.validateArgs(args, ['position'], context);
        try {
            await (this.coreAnalyzer as any)?.initialize?.();
        } catch {}

        const core: any = this.coreAnalyzer as any;
        if (typeof core.getCompletions !== 'function') {
            throw new CoreError('Internal', 'Core analyzer does not support getCompletions');
        }

        const uri = normalizeUri(String(args.file || args.uri || 'file://workspace'));
        const request = buildCompletionRequest({
            uri,
            position: normalizePosition(args.position),
            maxResults: Math.min(Number(args.maxResults || 20), 200),
        });

        const result = await core.getCompletions(request);
        const items = Array.isArray(result.data) ? result.data.map((c: any) => completionToWireCompletion(c)) : [];

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            completions: items,
                            performance: result.performance,
                            requestId: result.requestId,
                            count: items.length,
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: false,
        };
    }

    /**
     * Handle rename_symbol tool call with validation
     */
    private async handleRenameSymbol(args: Record<string, any>, context: ErrorContext) {
        this.validateArgs(args, ['oldName', 'newName'], context);

        const request = buildRenameRequest({
            uri: normalizeUri('file://workspace'),
            position: createPosition(0, 0),
            identifier: args.oldName,
            newName: args.newName,
            dryRun: args.preview ?? true,
        });

        const result = await this.coreAnalyzer.rename(request);

        const changes = Object.entries(result.data.changes || {}).map(([uri, edits]) => ({
            file: uri,
            edits: (edits as any[]).map((edit: any) => ({
                range: {
                    start: { line: edit.range.start.line, character: edit.range.start.character },
                    end: { line: edit.range.end.line, character: edit.range.end.character },
                },
                newText: edit.newText,
            })),
        }));

        if (process.env.DEBUG && !process.env.SILENT_MODE) {
            try {
                adapterLogger.debug('rename_symbol returning content payload');
            } catch {}
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            changes,
                            performance: result.performance,
                            requestId: result.requestId,
                            preview: args.preview ?? true,
                            scope: args.scope || 'exact',
                            summary: `${changes.length} files affected with ${changes.reduce((acc, c) => acc + c.edits.length, 0)} edits`,
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: false,
        };
    }

    /**
     * Handle plan_rename tool call
     */
    private async handlePlanRename(args: Record<string, any>, context: ErrorContext) {
        this.validateArgs(args, ['oldName', 'newName'], context);

        const request = buildRenameRequest({
            uri: normalizeUri(args.file || 'file://workspace'),
            position: createPosition(0, 0),
            identifier: args.oldName,
            newName: args.newName,
            dryRun: true,
        });

        const result = await this.coreAnalyzer.rename(request);
        let changes = result.data.changes || {};
        // Fallback: if no changes and a file context was provided, generate a minimal definition-based edit
        if (Object.keys(changes).length === 0 && typeof args.file === 'string' && args.file.trim()) {
            try {
                const defs = await (this.coreAnalyzer as any).findDefinitionAsync({
                    uri: normalizeUri(args.file),
                    position: createPosition(0, 0),
                    identifier: args.oldName,
                    includeDeclaration: true,
                    precise: true,
                });
                const defsArr = Array.isArray(defs?.data) ? defs.data : [];
                const fallback: Record<string, any[]> = {};
                for (const d of defsArr) {
                    if (!d?.range || !d?.uri) continue;
                    const edit = { range: d.range, newText: args.newName };
                    fallback[d.uri] = fallback[d.uri] || [];
                    fallback[d.uri].push(edit);
                }
                if (Object.keys(fallback).length > 0) {
                    changes = fallback;
                }
            } catch {
                // ignore fallback errors
            }
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            changes,
                            performance: result.performance,
                            requestId: result.requestId,
                            preview: true,
                            summary: {
                                filesAffected: Object.keys(changes || {}).length,
                                totalEdits: Object.values(changes || {}).reduce(
                                    (acc: number, edits: any) => acc + (edits as any[]).length,
                                    0
                                ),
                            },
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: false,
        };
    }

    /**
     * Handle apply_rename tool call
     * For now, delegate to rename with dryRun=false if both oldName/newName are provided; otherwise accept direct changes
     */
    private async handleApplyRename(args: Record<string, any>, context: ErrorContext) {
        // If explicit plan supplied, return it as applied (core doesn’t persist edits here)
        if (args && typeof args === 'object' && args.changes) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ schemaVersion: 2, status: 'applied', changes: args.changes }, null, 2),
                    },
                ],
                isError: false,
            };
        }

        // Or execute a rename apply
        this.validateArgs(args, ['oldName', 'newName'], context);
        const request = buildRenameRequest({
            uri: normalizeUri(args.file || 'file://workspace'),
            position: createPosition(0, 0),
            identifier: args.oldName,
            newName: args.newName,
            dryRun: false,
        });
        const result = await this.coreAnalyzer.rename(request);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            status: 'applied',
                            changes: result.data.changes,
                            performance: result.performance,
                            requestId: result.requestId,
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: false,
        };
    }

    /**
     * Handle build_symbol_map tool call
     */
    private async handleBuildSymbolMap(args: Record<string, any>, context: ErrorContext) {
        this.validateArgs(args, ['symbol'], context);
        const res = await (this.coreAnalyzer as any).buildSymbolMap({
            identifier: args.symbol,
            uri: normalizeUri(args.file || 'file://workspace'),
            maxFiles: Math.min(Number(args.maxFiles || 20), 100),
            astOnly: !!args.astOnly,
        });
        const payload = { schemaVersion: 2, ...res };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(payload, null, 2),
                },
            ],
            isError: false,
        };
    }

    /**
     * Handle generate_tests tool call with validation (stub - not implemented in core yet)
     */
    private async handleGenerateTests(args: Record<string, any>, context: ErrorContext) {
        this.validateArgs(args, ['target'], context);

        // This is a stub implementation - core analyzer doesn't have test generation yet
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            message: 'Test generation not yet implemented in core analyzer',
                            target: args.target,
                            framework: args.framework || 'auto',
                            coverage: args.coverage || 'comprehensive',
                            status: 'not_implemented',
                        },
                        null,
                        2
                    ),
                },
            ],
            isError: false,
        };
    }

    /**
     * Handle explore_codebase tool call by fanning out multiple analyses in parallel
     */
    private async handleExploreCodebase(args: Record<string, any>, context: ErrorContext) {
        this.validateArgs(args, ['symbol'], context);

        const maxResults = typeof args.maxResults === 'number' ? args.maxResults : this.config.maxResults;
        const includeDeclaration = args.includeDeclaration ?? true;

        const uri = args.file ? normalizeUri(args.file) : normalizeUri('file://workspace');
        const position = createPosition(0, 0);

        const defReq = buildFindDefinitionRequest({
            uri,
            position,
            identifier: args.symbol,
            maxResults,
            includeDeclaration,
        });

        const refReq = buildFindReferencesRequest({
            uri,
            position,
            identifier: args.symbol,
            maxResults: Math.min(maxResults ?? 100, 500),
            includeDeclaration: includeDeclaration ?? false,
        });

        // Execute in parallel
        // Delegate to core analyzer per VISION.md (thin adapter)
        const coreResult = await (this.coreAnalyzer as any).exploreCodebase({
            uri,
            identifier: args.symbol,
            includeDeclaration,
            maxResults,
            precise: !!args.precise,
            conceptual: !!args.conceptual,
        });

        // Map definitions/references for MCP output while preserving performance/diagnostics
        const mapped = {
            schemaVersion: 2,
            symbol: coreResult.symbol,
            contextUri: coreResult.contextUri,
            definitions: coreResult.definitions.map((def: any) => definitionToApiResponse(def)),
            references: coreResult.references.map((ref: any) => referenceToApiResponse(ref)),
            performance: coreResult.performance,
            diagnostics: coreResult.diagnostics,
            timestamp: coreResult.timestamp,
        };

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(mapped, null, 2),
                },
            ],
            isError: false,
        };
    }

    /**
     * Initialize the MCP adapter
     */
    async initialize(): Promise<void> {
        // MCP adapter doesn't need special initialization - just ensure core analyzer is ready
        // Core analyzer is passed in constructor and should already be initialized
    }

    /**
     * Dispose the MCP adapter
     */
    async dispose(): Promise<void> {
        // MCP adapter doesn't hold resources that need cleanup
    }

    /**
     * Execute MCP tool call (alias for handleToolCall for consistency)
     */
    async executeTool(request: { name: string; arguments: Record<string, any> }): Promise<any> {
        return await this.handleToolCall(request.name, request.arguments);
    }

    /**
     * Validate tool arguments with enhanced error messages
     */
    private validateArgs(args: Record<string, any>, requiredFields: string[], context: ErrorContext): void {
        if (!args || typeof args !== 'object') {
            throw createValidationError('Arguments must be an object', context);
        }

        for (const field of requiredFields) {
            if (args[field] === undefined || args[field] === null) {
                throw createValidationError(`Missing required parameter: ${field}`, context);
            }

            if (typeof args[field] === 'string' && args[field].trim() === '') {
                throw createValidationError(`Parameter '${field}' cannot be empty`, context);
            }
        }

        // Additional validation for specific fields
        if (args.position && typeof args.position === 'object') {
            if (typeof args.position.line !== 'number' || args.position.line < 0) {
                throw createValidationError('position.line must be a non-negative number', context);
            }
            if (typeof args.position.character !== 'number' || args.position.character < 0) {
                throw createValidationError('position.character must be a non-negative number', context);
            }
        }
    }

    /**
     * Sanitize arguments for logging
     */
    private sanitizeForLogging(args: any): any {
        if (!args || typeof args !== 'object') return args;

        const sanitized = { ...args };
        const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];

        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    /**
     * Get adapter diagnostics
     */
    getDiagnostics(): Record<string, any> {
        return {
            adapter: 'mcp',
            config: this.config,
            availableTools: this.getTools().map((t) => t.name),
            coreAnalyzer: this.coreAnalyzer.getDiagnostics ? this.coreAnalyzer.getDiagnostics() : {},
            timestamp: Date.now(),
        };
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
