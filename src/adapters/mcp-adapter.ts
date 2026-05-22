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

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreError } from '../core/errors.js';
import {
    SnapshotPatchWorkflowService,
    type SnapshotWorkflowResult,
    recommendChecksPayload,
} from '../core/workflows/snapshot-patch-workflow.js';
import { StructuralWorkflowService } from '../core/workflows/structural-workflow.js';
import { GraphExpandWorkflowService } from '../core/workflows/graph-expand-workflow.js';
import { WorkspaceQueryWorkflowService } from '../core/workflows/workspace-query-workflow.js';
import { RenameWorkflowService } from '../core/workflows/rename-workflow.js';
import { NavigationWorkflowService } from '../core/workflows/navigation-workflow.js';
import { SymbolWorkflowService } from '../core/workflows/symbol-workflow.js';
import { CodeAnalysisWorkflowService } from '../core/workflows/code-analysis-workflow.js';
import { LearningWorkflowService } from '../core/workflows/learning-workflow.js';
import { ToolRegistry } from '../core/tools/registry.js';
import { resolveWorkspacePath } from '../core/workspace-path.js';
import { type ErrorContext, type RecoveryOptions, withMcpErrorHandling } from '../core/utils/error-handler.js';
import { adapterLogger, mcpLogger } from '../core/utils/file-logger.js';
import { handleAdapterError, normalizeUri } from './utils.js';

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
    private navigationWorkflows: NavigationWorkflowService;
    private symbolWorkflows: SymbolWorkflowService;
    private codeAnalysisWorkflows: CodeAnalysisWorkflowService;
    private learningWorkflows: LearningWorkflowService;

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
            coreAnalyzer: this.coreAnalyzer,
            pickOntologySeedFile: (symbol) => this.pickOntologySeedFile(symbol),
        });
        this.navigationWorkflows = new NavigationWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            coreAnalyzer: this.coreAnalyzer,
            maxResults: () => this.config.maxResults || 100,
            resolveWorkspaceFile: (value, inputLabel) => this.resolveMcpWorkspaceFile(value, inputLabel),
            containedUriOrNull: (value, inputLabel) => this.containedMcpUriOrNull(value, inputLabel),
        });
        this.codeAnalysisWorkflows = new CodeAnalysisWorkflowService({
            coreAnalyzer: this.coreAnalyzer,
            maxResults: () => this.config.maxResults || 100,
            resolveWorkspaceFile: (value, inputLabel) => this.resolveMcpWorkspaceFile(value, inputLabel),
            filterWorkspaceItemsByUri: (items, inputLabel) => this.filterMcpWorkspaceItemsByUri(items, inputLabel),
        });
        this.learningWorkflows = new LearningWorkflowService({ coreAnalyzer: this.coreAnalyzer });
        this.symbolWorkflows = new SymbolWorkflowService({
            pickOntologySeedFile: (symbol) => this.pickOntologySeedFile(symbol),
            findDefinition: (args) => this.navigationWorkflows.findDefinition(args),
            buildSymbolMap: (args) => this.codeAnalysisWorkflows.buildSymbolMap(args),
            graphExpand: (args) => this.graphWorkflows.graphExpand(args),
            safeRename: (args) => this.renameWorkflows.safeRename(args),
            patchChecksInSnapshot: (args) => this.snapshotWorkflows.patchChecksInSnapshot(args),
            applySnapshot: (args) => this.snapshotWorkflows.applySnapshot(args),
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
    private async handleListPipelines() {
        return this.formatSnapshotWorkflowResult(await this.learningWorkflows.listPipelines());
    }

    private async handlePipelineStatus(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.learningWorkflows.pipelineStatus(args));
    }

    private async handleRunPipeline(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.learningWorkflows.runPipeline(args));
    }

    private async handleListPipelineRuns(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.learningWorkflows.listPipelineRuns(args));
    }

    private async handleExecuteIntent(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.symbolWorkflows.executeIntent(args));
    }

    private async handleExtractSnapshotArtifacts(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.extractSnapshotArtifacts(args));
    }

    private async handleSafeWrite(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.safeWrite(args));
    }

    private async handleApplyAfterChecks(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.applyAfterChecks(args));
    }

    // --- New handlers: snapshots/patches/checks ---
    private async handlePatternStats() {
        return this.formatSnapshotWorkflowResult(await this.learningWorkflows.patternStats());
    }

    private async handleWorkflowExploreSymbol(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.symbolWorkflows.exploreSymbol(args));
    }

    private async handleWorkflowQuickPatchChecks(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.snapshotWorkflows.patchChecksInSnapshot(args));
    }

    private async handleWorkflowSafeRename(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.renameWorkflows.safeRename(args));
    }
    private async handleWorkflowLocateConfirmDefinition(args: Record<string, any>) {
        return this.formatSnapshotWorkflowResult(await this.symbolWorkflows.locateConfirmDefinition(args));
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

    /**
     * Handle find_definition tool call with validation
     */
    private async handleFindDefinition(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.navigationWorkflows.findDefinition(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle find_references tool call with validation
     */
    private async handleFindReferences(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.navigationWorkflows.findReferences(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    private async handleGetCompletions(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.codeAnalysisWorkflows.getCompletions(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle rename_symbol tool call with validation
     */
    private async handleRenameSymbol(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.renameWorkflows.renameSymbol(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle plan_rename tool call
     */
    private async handlePlanRename(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.renameWorkflows.planRename(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle apply_rename tool call
     */
    private async handleApplyRename(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.renameWorkflows.applyRename(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle build_symbol_map tool call
     */
    private async handleBuildSymbolMap(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.codeAnalysisWorkflows.buildSymbolMap(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle generate_tests tool call with validation (stub - not implemented in core yet)
     */
    private async handleGenerateTests(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.codeAnalysisWorkflows.generateTests(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle explore_codebase tool call
     */
    private async handleExploreCodebase(args: Record<string, any>, _context: ErrorContext) {
        try {
            return this.formatSnapshotWorkflowResult(await this.codeAnalysisWorkflows.exploreCodebase(args));
        } catch (error) {
            return handleAdapterError(error, 'mcp');
        }
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
