import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CoreError } from '../errors.js';
import { workspaceInputToPath } from '../workspace-input.js';
import { isOutsideWorkspaceRelative, resolveWorkspacePath } from '../workspace-path.js';
import { CodeAnalysisWorkflowService } from './code-analysis-workflow.js';
import { GraphExpandWorkflowService } from './graph-expand-workflow.js';
import { LearningWorkflowService } from './learning-workflow.js';
import { NavigationWorkflowService } from './navigation-workflow.js';
import { RenameWorkflowService } from './rename-workflow.js';
import {
    recommendChecksPayload,
    SnapshotPatchWorkflowService,
    type SnapshotWorkflowResult,
} from './snapshot-patch-workflow.js';
import { StructuralWorkflowService } from './structural-workflow.js';
import { SymbolWorkflowService } from './symbol-workflow.js';
import type { WorkflowCoreAnalyzer } from './types.js';
import { WorkspaceQueryWorkflowService } from './workspace-query-workflow.js';

type WorkspaceFileContext = { path: string; uri: string; relativePath: string };

export interface ToolWorkflowRouterConfig {
    maxResults?: number | (() => number);
    workspaceRoot?: () => string;
}

export class ToolWorkflowRouter {
    private snapshotWorkflows: SnapshotPatchWorkflowService;
    private structuralWorkflows: StructuralWorkflowService;
    private graphWorkflows: GraphExpandWorkflowService;
    private workspaceQueries: WorkspaceQueryWorkflowService;
    private renameWorkflows: RenameWorkflowService;
    private navigationWorkflows: NavigationWorkflowService;
    private symbolWorkflows: SymbolWorkflowService;
    private codeAnalysisWorkflows: CodeAnalysisWorkflowService;
    private learningWorkflows: LearningWorkflowService;

    constructor(
        private readonly coreAnalyzer: WorkflowCoreAnalyzer,
        private readonly config: ToolWorkflowRouterConfig = {}
    ) {
        this.snapshotWorkflows = new SnapshotPatchWorkflowService({ workspaceRoot: () => this.getWorkspaceRoot() });
        this.structuralWorkflows = new StructuralWorkflowService({ workspaceRoot: () => this.getWorkspaceRoot() });
        this.graphWorkflows = new GraphExpandWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            resolveWorkspaceFile: (value, inputLabel) => this.resolveToolWorkspaceFile(value, inputLabel),
            resolveWorkspaceLexicalPath: (value, inputLabel) => this.resolveToolWorkspaceLexicalPath(value, inputLabel),
            containedUriOrNull: (uri, inputLabel) => this.containedToolUriOrNull(uri, inputLabel),
            buildSymbolMap: (req) => (this.coreAnalyzer as any).buildSymbolMap?.(req),
        });
        this.workspaceQueries = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            coreAnalyzer: this.coreAnalyzer,
            pathInputFromToolFile: (value, workspaceRoot) => this.pathInputFromToolFile(value, workspaceRoot),
        });
        this.renameWorkflows = new RenameWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            coreAnalyzer: this.coreAnalyzer,
            pickOntologySeedFile: (symbol) => this.pickOntologySeedFile(symbol),
        });
        this.navigationWorkflows = new NavigationWorkflowService({
            workspaceRoot: () => this.getWorkspaceRoot(),
            coreAnalyzer: this.coreAnalyzer,
            maxResults: () => this.getMaxResults(),
            resolveWorkspaceFile: (value, inputLabel) => this.resolveToolWorkspaceFile(value, inputLabel),
            containedUriOrNull: (value, inputLabel) => this.containedToolUriOrNull(value, inputLabel),
        });
        this.codeAnalysisWorkflows = new CodeAnalysisWorkflowService({
            coreAnalyzer: this.coreAnalyzer,
            maxResults: () => this.getMaxResults(),
            resolveWorkspaceFile: (value, inputLabel) => this.resolveToolWorkspaceFile(value, inputLabel),
            resolveWorkspaceLexicalPath: (value, inputLabel) => this.resolveToolWorkspaceLexicalPath(value, inputLabel),
            filterWorkspaceItemsByUri: (items, inputLabel) => this.filterToolWorkspaceItemsByUri(items, inputLabel),
            workspaceRoot: () => this.getWorkspaceRoot(),
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
    }

    async handleToolCall(name: string, args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        return this.execute(name, args);
    }

    async execute(name: string, args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        switch (name) {
            case 'list_pipelines':
                return this.learningWorkflows.listPipelines();
            case 'run_pipeline':
                return this.learningWorkflows.runPipeline(args);
            case 'list_pipeline_runs':
                return this.learningWorkflows.listPipelineRuns(args);
            case 'pipeline_status':
                return this.learningWorkflows.pipelineStatus(args);
            case 'list_symbols':
                return this.workspaceQueries.listSymbols(args);
            case 'execute_intent':
                return this.symbolWorkflows.executeIntent(args);
            case 'extract_snapshot_artifacts':
                return this.snapshotWorkflows.extractSnapshotArtifacts(args);
            case 'apply_after_checks':
                return this.snapshotWorkflows.applyAfterChecks(args);
            case 'safe_write':
                return this.snapshotWorkflows.safeWrite(args);
            case 'workflow_explore_symbol':
            case 'explore_symbol_impact':
                return this.symbolWorkflows.exploreSymbol(args);
            case 'workflow_quick_patch_checks':
            case 'patch_checks_in_snapshot':
                return this.snapshotWorkflows.patchChecksInSnapshot(args);
            case 'workflow_safe_rename':
            case 'rename_safely':
                return this.renameWorkflows.safeRename(args);
            case 'workflow_locate_confirm_definition':
            case 'locate_confirm_definition':
                return this.symbolWorkflows.locateConfirmDefinition(args);
            case 'diagnostics':
                return this.diagnostics();
            case 'knowledge_insights':
                return this.knowledgeInsights();
            case 'cache_controls':
                return this.cacheControls(args);
            case 'pattern_stats':
                return this.learningWorkflows.patternStats();
            case 'get_snapshot':
                return this.snapshotWorkflows.getSnapshot(args);
            case 'read_file':
                return this.workspaceQueries.readFile(args);
            case 'list_files':
                return this.workspaceQueries.listFiles(args);
            case 'propose_patch':
                return this.snapshotWorkflows.proposePatch(args);
            case 'run_checks':
                return this.snapshotWorkflows.runChecks(args);
            case 'apply_snapshot':
                return this.snapshotWorkflows.applySnapshot(args);
            case 'text_search':
                return this.workspaceQueries.textSearch(args);
            case 'symbol_search':
                return this.workspaceQueries.symbolSearch(args);
            case 'structural_search':
                return this.structuralWorkflows.structuralSearch(args);
            case 'structural_patch_checks':
                return this.structuralWorkflows.structuralPatchChecks(args);
            case 'ast_query':
                return this.workspaceQueries.astQuery(args);
            case 'graph_expand':
                return this.graphWorkflows.graphExpand(args);
            case 'recommend_checks':
                return { payload: recommendChecksPayload(args), isError: false };
            case 'find_definition':
                return this.navigationWorkflows.findDefinition(args);
            case 'find_references':
                return this.navigationWorkflows.findReferences(args);
            case 'get_completions':
                return this.codeAnalysisWorkflows.getCompletions(args);
            case 'rename_symbol':
                return this.renameWorkflows.renameSymbol(args);
            case 'plan_rename':
                return this.renameWorkflows.planRename(args);
            case 'apply_rename':
                return this.renameWorkflows.applyRename(args);
            case 'build_symbol_map':
                return this.codeAnalysisWorkflows.buildSymbolMap(args);
            case 'generate_tests':
                return this.codeAnalysisWorkflows.generateTests(args);
            case 'suggest_refactoring':
                return { payload: { suggestions: [] }, isError: false };
            case 'explore_codebase':
                return this.codeAnalysisWorkflows.exploreCodebase(args);
            default:
                throw new CoreError('UnknownTool', `Unknown tool: ${name}`, { tool: name });
        }
    }

    private async diagnostics(): Promise<SnapshotWorkflowResult> {
        const analyzer = this.coreAnalyzer as any;
        const diagnostics =
            typeof analyzer?.getDiagnostics === 'function'
                ? await analyzer.getDiagnostics()
                : typeof analyzer?.getStats === 'function'
                  ? await analyzer.getStats()
                  : { available: false };
        return {
            payload: {
                schemaVersion: 1,
                tool: 'diagnostics',
                workspaceRoot: this.getWorkspaceRoot(),
                diagnostics,
            },
            isError: false,
        };
    }

    private async knowledgeInsights(): Promise<SnapshotWorkflowResult> {
        const analyzer = this.coreAnalyzer as any;
        const insights =
            typeof analyzer?.getKnowledgeInsights === 'function'
                ? await analyzer.getKnowledgeInsights()
                : typeof analyzer?.learningOrchestrator?.getStats === 'function'
                  ? await analyzer.learningOrchestrator.getStats()
                  : { available: false };
        return { payload: { schemaVersion: 1, tool: 'knowledge_insights', insights }, isError: false };
    }

    private async cacheControls(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const action = String(args?.action || '').trim();
        if (!['warm', 'clear'].includes(action))
            throw new CoreError('InvalidParams', 'Missing or invalid required parameter: action', { action });
        const analyzer = this.coreAnalyzer as any;
        if (action === 'clear') {
            const handlers = [
                { fn: analyzer?.clearCache, thisArg: analyzer },
                { fn: analyzer?.cache?.clear, thisArg: analyzer?.cache },
            ].filter((handler) => typeof handler.fn === 'function');
            if (!handlers.length)
                throw new CoreError('InvalidParams', 'cache clear is not supported by the current analyzer');
            for (const handler of handlers) await handler.fn.call(handler.thisArg);
        } else {
            if (typeof analyzer?.warmCache !== 'function')
                throw new CoreError('InvalidParams', 'cache warm is not supported by the current analyzer');
            await analyzer.warmCache();
        }
        return { payload: { schemaVersion: 1, tool: 'cache_controls', action, ok: true }, isError: false };
    }

    private getMaxResults(): number {
        const value = typeof this.config.maxResults === 'function' ? this.config.maxResults() : this.config.maxResults;
        return typeof value === 'number' && Number.isFinite(value) ? value : 100;
    }

    private getWorkspaceRoot(): string {
        if (this.config.workspaceRoot) return path.resolve(this.config.workspaceRoot());
        const configuredRoot = (this.coreAnalyzer as any)?.config?.workspaceRoot;
        return path.resolve(
            typeof configuredRoot === 'string' && configuredRoot.trim() ? configuredRoot : process.cwd()
        );
    }

    private pathInputFromToolFile(value: string, workspaceRoot: string): string {
        return workspaceInputToPath(value, workspaceRoot);
    }

    private async resolveToolWorkspaceFile(value: string, inputLabel: string): Promise<WorkspaceFileContext> {
        const workspaceRoot = this.getWorkspaceRoot();
        const requestedPath = this.pathInputFromToolFile(value, workspaceRoot);
        const resolved = await resolveWorkspacePath(requestedPath, { workspaceRoot, inputLabel });
        return {
            path: resolved.realPath,
            uri: normalizeUri(resolved.realPath),
            relativePath: resolved.relativePath,
        };
    }

    private resolveToolWorkspaceLexicalPath(value: string, inputLabel: string) {
        const workspaceRoot = this.getWorkspaceRoot();
        const requestedPath = this.pathInputFromToolFile(value, workspaceRoot);
        const candidate = path.resolve(workspaceRoot, requestedPath);
        const relativePath = path.relative(workspaceRoot, candidate);
        if (isOutsideWorkspaceRelative(relativePath)) {
            throw new CoreError('InvalidParams', `${inputLabel} must stay within the workspace`, { path: value });
        }
        return {
            path: candidate,
            relativePath: relativePath.split(path.sep).join('/'),
        };
    }

    private async containedToolUriOrNull(value: string, inputLabel: string): Promise<string | null> {
        try {
            return (await this.resolveToolWorkspaceFile(value, inputLabel)).uri;
        } catch (error) {
            if (error instanceof CoreError) return null;
            throw error;
        }
    }

    private async filterToolWorkspaceItemsByUri<T extends { uri?: unknown }>(
        items: T[],
        inputLabel: string
    ): Promise<T[]> {
        const contained: T[] = [];
        for (const item of items) {
            const uri = typeof item?.uri === 'string' ? item.uri : '';
            if (uri && (await this.containedToolUriOrNull(uri, inputLabel))) contained.push(item);
        }
        return contained;
    }

    private getOntologyEngine(): any | null {
        try {
            const layerManager: any = (this.coreAnalyzer as any).layerManager;
            const layer4 = layerManager?.getLayer?.('layer4');
            if (layer4 && typeof layer4.getOntologyEngine === 'function') return layer4.getOntologyEngine();
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
            const concept = await (engine.findConcept?.(symbol) ?? engine.findConceptStrict?.(symbol));
            if (!concept) return undefined;
            let bestUri: string | undefined;
            let bestCount = -1;
            const anchors =
                typeof engine.listConceptAnchors === 'function' ? engine.listConceptAnchors(concept.id) : [];
            for (const anchor of anchors) {
                const uri = (anchor as any)?.location?.uri as string | undefined;
                const occurrences = (anchor as any)?.occurrences ?? 0;
                if (uri && occurrences >= bestCount) {
                    bestCount = occurrences;
                    bestUri = uri;
                }
            }
            return bestUri;
        } catch {
            return undefined;
        }
    }
}

function normalizeUri(value: string): string {
    try {
        if (value.startsWith('file://')) return pathToFileURL(fileURLToPath(value)).href;
        return pathToFileURL(value).href;
    } catch {
        return value.startsWith('file://') ? value : '';
    }
}
