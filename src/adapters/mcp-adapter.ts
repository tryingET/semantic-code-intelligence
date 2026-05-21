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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreError } from '../core/errors.js';
import { overlayStore } from '../core/overlay-store.js';
import {
    SnapshotPatchWorkflowService,
    type SnapshotWorkflowResult,
    buildValidationPlan as buildSnapshotValidationPlan,
    extractFilesFromPatch as extractPatchFiles,
    recommendChecksPayload,
    snapshotArtifactLinks as createSnapshotArtifactLinks,
} from '../core/workflows/snapshot-patch-workflow.js';
import { StructuralWorkflowService } from '../core/workflows/structural-workflow.js';
import { GraphExpandWorkflowService } from '../core/workflows/graph-expand-workflow.js';
import { WorkspaceQueryWorkflowService } from '../core/workflows/workspace-query-workflow.js';
import { RenameWorkflowService } from '../core/workflows/rename-workflow.js';
import { ToolRegistry } from '../core/tools/registry.js';
import { openWorkspaceFileForRead, resolveWorkspacePath } from '../core/workspace-path.js';
import { DefinitionKind } from '../core/types.js';
import { createValidationError, type ErrorContext, type RecoveryOptions, withMcpErrorHandling } from '../core/utils/error-handler.js';
import { adapterLogger, mcpLogger } from '../core/utils/file-logger.js';
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
    private snapshotWorkflows: SnapshotPatchWorkflowService;
    private structuralWorkflows: StructuralWorkflowService;
    private graphWorkflows: GraphExpandWorkflowService;
    private workspaceQueries: WorkspaceQueryWorkflowService;
    private renameWorkflows: RenameWorkflowService;

    constructor(coreAnalyzer: CoreAnalyzer, config: MCPAdapterConfig = {}) {
        this.coreAnalyzer = coreAnalyzer;
        this.config = {
            maxResults: 100,
            timeout: 30000,
            enableSSE: true,
            ssePort: 7001,
            ...config,
        };
        this.snapshotWorkflows = new SnapshotPatchWorkflowService({ workspaceRoot: () => this.getWorkspaceRoot() });
        this.structuralWorkflows = new StructuralWorkflowService({ workspaceRoot: () => this.getWorkspaceRoot() });
        this.graphWorkflows = new GraphExpandWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            resolveWorkspaceFile: (value, inputLabel) => this.resolveMcpWorkspaceFile(value, inputLabel),
            resolveWorkspaceLexicalPath: (value, inputLabel) => this.resolveMcpWorkspaceLexicalPath(value, inputLabel),
            containedUriOrNull: (uri, inputLabel) => this.containedMcpUriOrNull(uri, inputLabel),
            buildSymbolMap: (req) => (this.coreAnalyzer as any).buildSymbolMap?.(req),
        });
        this.workspaceQueries = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            coreAnalyzer: this.coreAnalyzer,
            pathInputFromMcpFile: (value, workspaceRoot) => this.pathInputFromMcpFile(value, workspaceRoot),
        });
        this.renameWorkflows = new RenameWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            pickOntologySeedFile: (symbol) => this.pickOntologySeedFile(symbol),
            planRename: async (renameArgs) => {
                const result = await this.handlePlanRename(renameArgs, {
                    component: 'MCPAdapter',
                    operation: 'workflow_safe_rename',
                    timestamp: Date.now(),
                });
                return this.safeParseContent(result);
            },
        });

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

    private getWorkspaceRoot(): string {
        // Prefer the analyzer's configured workspace when present. Direct MCPAdapter
        // users (tests, embedded hosts, future harness integrations) may construct an
        // analyzer for a target repository while the adapter process cwd is SCI's own
        // repo. Falling back to cwd preserves CLI/HTTP behavior for analyzers without
        // an explicit workspaceRoot.
        const configuredRoot = (this.coreAnalyzer as any)?.config?.workspaceRoot;
        return path.resolve(typeof configuredRoot === 'string' && configuredRoot.trim() ? configuredRoot : process.cwd());
    }

    private pathInputFromMcpFile(value: string, workspaceRoot: string): string {
        const raw = String(value || '').trim();
        const workspacePrefix = 'file://workspace';
        if (raw.startsWith(workspacePrefix)) {
            const suffix = raw.slice(workspacePrefix.length).replace(/^\/+/, '');
            return suffix ? path.join(workspaceRoot, decodeURIComponent(suffix)) : workspaceRoot;
        }
        if (raw.startsWith('file://')) return fileURLToPath(raw);
        return raw;
    }

    private async resolveMcpWorkspaceFile(value: string, inputLabel: string) {
        const workspaceRoot = this.getWorkspaceRoot();
        const requestedPath = this.pathInputFromMcpFile(value, workspaceRoot);
        const resolved = await resolveWorkspacePath(requestedPath, { workspaceRoot, inputLabel });
        return {
            path: resolved.realPath,
            uri: normalizeUri(resolved.realPath),
            relativePath: resolved.relativePath,
        };
    }

    private resolveMcpWorkspaceLexicalPath(value: string, inputLabel: string) {
        const workspaceRoot = this.getWorkspaceRoot();
        const requestedPath = this.pathInputFromMcpFile(value, workspaceRoot);
        const candidate = path.resolve(workspaceRoot, requestedPath);
        const relativePath = path.relative(workspaceRoot, candidate);
        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new CoreError('InvalidParams', `${inputLabel} must stay within the workspace`, { path: value });
        }
        return {
            path: candidate,
            relativePath: relativePath.split(path.sep).join('/'),
        };
    }

    private async containedMcpUriOrNull(value: string, inputLabel: string): Promise<string | null> {
        try {
            return (await this.resolveMcpWorkspaceFile(value, inputLabel)).uri;
        } catch (error) {
            if (error instanceof CoreError) return null;
            throw error;
        }
    }

    private async filterMcpWorkspaceItemsByUri<T extends { uri?: unknown }>(items: T[], inputLabel: string): Promise<T[]> {
        const contained: T[] = [];
        for (const item of items) {
            const uri = typeof item?.uri === 'string' ? item.uri : '';
            if (uri && (await this.containedMcpUriOrNull(uri, inputLabel))) contained.push(item);
        }
        return contained;
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
                    name === 'safe_write' ||
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
                    case 'safe_write':
                        return this.handleSafeWrite(arguments_);
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
                    case 'recommend_checks':
                        return this.handleRecommendChecks(arguments_);
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
        try {
            return this.formatSnapshotWorkflowResult(await this.workspaceQueries.readFile(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    private async handleListSymbols(args: Record<string, any>) {
        try {
            return this.formatSnapshotWorkflowResult(await this.workspaceQueries.listSymbols(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
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
            const snap = overlayStore.ensureSnapshot(snapshot, { workspaceRoot: this.getWorkspaceRoot() });
            status = {
                id: snapshot,
                exists: true,
                diffCount: Array.isArray((snap as any).diffs) ? (snap as any).diffs.length : 0,
                createdAt: (snap as any).createdAt || null,
                touchedFiles: (snap as any).touchedFiles ? Array.from((snap as any).touchedFiles) : [],
                materialized: false,
            };
            const snapshotDir = (overlayStore as any).getSnapshotDirectory?.(snapshot, { workspaceRoot: this.getWorkspaceRoot() }) || path.resolve(this.getWorkspaceRoot(), '.ontology', 'snapshots', snapshot);
            const materializedMarker = path.join(snapshotDir, '.materialized');
            const hasMaterializedMarker = async () => {
                try {
                    return (await fs.stat(materializedMarker)).isFile();
                } catch {
                    return false;
                }
            };
            status.materialized = await hasMaterializedMarker();
            let dir: string | null = null;
            if (includeContent) {
                const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
                dir = ensure ? await ensure(snapshot, { workspaceRoot: this.getWorkspaceRoot() }) : status.materialized ? snapshotDir : null;
                status.materialized = !!dir && (await hasMaterializedMarker());
            }
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

    private async handleSafeWrite(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.safeWrite(args));
    }

    private async handleApplyAfterChecks(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.applyAfterChecks(args));
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
                ? { file, symbol, edges: ['imports', 'exports', 'callers', 'callees'], depth, limit }
                : { symbol, edges: ['callers', 'callees'], depth, limit }
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
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.patchChecksInSnapshot(args));
    }

    private async handleWorkflowSafeRename(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.renameWorkflows.safeRename(args));
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
    private formatSnapshotWorkflowResult(result: SnapshotWorkflowResult) {
        if ('text' in result) {
            return { content: [{ type: 'text', text: result.text }], isError: result.isError === true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.payload, null, 2) }], isError: result.isError === true };
    }

    private async handleGetSnapshot(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.getSnapshot(args));
    }

    private async handleProposePatch(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.proposePatch(args));
    }

    private async handleRunChecks(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.runChecks(args));
    }

    private async handleApplySnapshot(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.applySnapshot(args));
    }

    // --- New handlers: search ---
    private async handleTextSearch(args: Record<string, any>) {
        try {
            return this.formatSnapshotWorkflowResult(await this.workspaceQueries.textSearch(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    private async handleSymbolSearch(args: Record<string, any>) {
        try {
            return this.formatSnapshotWorkflowResult(await this.workspaceQueries.symbolSearch(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    private async handleStructuralSearch(args: Record<string, any>) {
        try {
            return this.formatSnapshotWorkflowResult(await this.structuralWorkflows.structuralSearch(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    private async handleStructuralPatchChecks(args: Record<string, any>) {
        try {
            return this.formatSnapshotWorkflowResult(await this.structuralWorkflows.structuralPatchChecks(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    private extractFilesFromPatch(patch: string): string[] {
        return extractPatchFiles(patch);
    }

    private buildValidationPlan(args: Parameters<typeof buildSnapshotValidationPlan>[0]) {
        return buildSnapshotValidationPlan(args);
    }

    private async handleRecommendChecks(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult({ payload: recommendChecksPayload(args), isError: false });
    }

    private async handleAstQuery(args: Record<string, any>) {
        try {
            return this.formatSnapshotWorkflowResult(await this.workspaceQueries.astQuery(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    private async handleGraphExpand(args: Record<string, any>) {
        try {
            return this.formatSnapshotWorkflowResult(await this.graphWorkflows.graphExpand(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
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
        // Try derive symbol from file+position when not provided. File contexts are
        // caller-controlled MCP input, so resolve them through workspace containment
        // before any stat/read or before forwarding a URI to core analyzers.
        let fileContext: { path: string; uri: string; relativePath: string } | null = null;
        try {
            fileContext = args.file ? await this.resolveMcpWorkspaceFile(args.file, 'find_definition file') : null;
        } catch (error) {
            if (error instanceof CoreError) return handleAdapterError(error, 'mcp');
            throw error;
        }
        const uri = fileContext?.uri || null;
        if (!symbol && fileContext) {
            let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
            try {
                opened = await openWorkspaceFileForRead(fileContext.path, { workspaceRoot: this.getWorkspaceRoot(), inputLabel: 'find_definition file' });
                const text = await opened.handle.readFile('utf8');
                const derived = this.wordAt(text, position);
                if (derived) symbol = derived;
            } catch {
            } finally {
                await opened?.handle.close().catch(() => undefined);
            }
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
                const wsRoot = this.getWorkspaceRoot();
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
                        const wsRoot = this.getWorkspaceRoot();
                        const fallbackDefs = await this.fallbackScanForDefinition(wsRoot, args.symbol, 300);
                        const match = fallbackDefs.find((d) => toBase(d.uri).toLowerCase().includes(name));
                        if (match) {
                            prioritized = [match, ...prioritized];
                        }
                        // As a final tie-breaker, inspect candidate lines to detect declarations
                        if (Array.isArray(prioritized) && prioritized.length) {
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
                                    const containedUri = await this.containedMcpUriOrNull(filePath, 'find_definition result uri');
                                    if (!containedUri) continue;
                                    const containedPath = fileURLToPath(containedUri);
                                    let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
                                    try {
                                        opened = await openWorkspaceFileForRead(containedPath, { workspaceRoot: this.getWorkspaceRoot(), inputLabel: 'find_definition result uri' });
                                        const text = await opened.handle.readFile('utf8');
                                        const lines = text.split(/\r?\n/);
                                        const line = lines[def.range?.start?.line ?? 0] || '';
                                        if (declRe.test(line)) {
                                            // Promote this as the top result
                                            prioritized = [def, ...prioritized.filter((d: any) => d !== def)];
                                            break;
                                        }
                                    } finally {
                                        await opened?.handle.close().catch(() => undefined);
                                    }
                                } catch {}
                            }
                        }
                    }
                } catch {}
                const containedPrioritized = await this.filterMcpWorkspaceItemsByUri(Array.isArray(prioritized) ? prioritized : [], 'find_definition result uri');
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    schemaVersion: 2,
                                    definitions: containedPrioritized.map((def: any) => definitionToApiResponse(def)),
                                    performance: result.performance,
                                    requestId: result.requestId,
                                    count: containedPrioritized.length,
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
                const wsRoot = this.getWorkspaceRoot();
                const fallbackDefs = await this.fallbackScanForDefinition(wsRoot, args.symbol, 200);
                const containedFallbackDefs = await this.filterMcpWorkspaceItemsByUri(fallbackDefs, 'find_definition fallback result uri');
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    schemaVersion: 2,
                                    definitions: containedFallbackDefs.map((def: any) => definitionToApiResponse(def)),
                                    performance: { layer1: 0, layer2: 0, layer3: 0, layer4: 0, layer5: 0, total: 0 },
                                    requestId: undefined,
                                    count: containedFallbackDefs.length,
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
            identifier: symbol,
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

        const containedPrioritized = await this.filterMcpWorkspaceItemsByUri(Array.isArray(prioritized) ? prioritized : [], 'find_definition result uri');
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            definitions: containedPrioritized.map((def: any) => definitionToApiResponse(def)),
                            performance: result.performance,
                            requestId: result.requestId,
                            count: containedPrioritized.length,
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
    private async scanForExplicitDeclaration(root: string, symbol: string, maxFiles = 300) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const queue: string[] = [root];
        const visited: Set<string> = new Set();
        const declRe = new RegExp(`\\b(class|function|interface|type)\\s+${symbol}\\b`);
        let filesScanned = 0;

        while (queue.length && filesScanned < maxFiles) {
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
        // Use symbol-based search at provided file context. The context path/URI is
        // caller-controlled and must be contained before delegating to core analyzers.
        let fileContext: { path: string; uri: string; relativePath: string };
        try {
            fileContext = await this.resolveMcpWorkspaceFile(String(args.file || args.uri), 'find_references file');
        } catch (error) {
            if (error instanceof CoreError) return handleAdapterError(error, 'mcp');
            throw error;
        }
        const request = buildFindReferencesRequest({
            uri: fileContext.uri,
            position: createPosition(0, 0),
            identifier: args.symbol,
            maxResults,
            includeDeclaration: args.includeDeclaration ?? false,
            precise: !!args.precise,
        });

        const result = await (this.coreAnalyzer as any).findReferencesAsync(request);
        const containedReferences = await this.filterMcpWorkspaceItemsByUri(Array.isArray(result.data) ? result.data : [], 'find_references result uri');

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            schemaVersion: 2,
                            references: containedReferences.map((ref: any) => referenceToApiResponse(ref)),
                            performance: result.performance,
                            requestId: result.requestId,
                            count: containedReferences.length,
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

        let uri: string;
        try {
            uri = args.file ? (await this.resolveMcpWorkspaceFile(args.file, 'explore_codebase file')).uri : normalizeUri('file://workspace');
        } catch (error) {
            if (error instanceof CoreError) return handleAdapterError(error, 'mcp');
            throw error;
        }
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

        const containedDefinitions = await this.filterMcpWorkspaceItemsByUri(Array.isArray(coreResult.definitions) ? coreResult.definitions : [], 'explore_codebase definition uri');
        const containedReferences = await this.filterMcpWorkspaceItemsByUri(Array.isArray(coreResult.references) ? coreResult.references : [], 'explore_codebase reference uri');

        // Map definitions/references for MCP output while preserving performance/diagnostics
        const mapped = {
            schemaVersion: 2,
            symbol: coreResult.symbol,
            contextUri: coreResult.contextUri,
            definitions: containedDefinitions.map((def: any) => definitionToApiResponse(def)),
            references: containedReferences.map((ref: any) => referenceToApiResponse(ref)),
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
