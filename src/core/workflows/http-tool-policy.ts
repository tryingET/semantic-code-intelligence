import { CoreError } from '../errors.js';

const BASE_HTTP_TOOL_NAMES = [
    'get_snapshot',
    'read_file',
    'text_search',
    'symbol_search',
    'ast_query',
    'find_definition',
    'find_references',
    'locate_confirm_definition',
    'graph_expand',
    'recommend_checks',
    'plan_rename',
    'rename_safely',
    'propose_patch',
    'patch_checks_in_snapshot',
    'run_checks',
    'structural_search',
    'structural_patch_checks',
    'safe_write',
    'list_files',
    'list_symbols',
    'run_pipeline',
    'pipeline_status',
    'list_pipeline_runs',
    'list_pipelines',
    'cache_controls',
] as const;

const MUTATING_HTTP_TOOL_NAMES = ['apply_snapshot', 'apply_after_checks'] as const;

const KNOWN_WORKFLOW_TOOL_NAMES = [
    'list_pipelines',
    'run_pipeline',
    'list_pipeline_runs',
    'pipeline_status',
    'list_symbols',
    'execute_intent',
    'extract_snapshot_artifacts',
    'apply_after_checks',
    'safe_write',
    'workflow_explore_symbol',
    'explore_symbol_impact',
    'workflow_quick_patch_checks',
    'patch_checks_in_snapshot',
    'workflow_safe_rename',
    'rename_safely',
    'workflow_locate_confirm_definition',
    'locate_confirm_definition',
    'diagnostics',
    'knowledge_insights',
    'cache_controls',
    'pattern_stats',
    'get_snapshot',
    'read_file',
    'list_files',
    'propose_patch',
    'run_checks',
    'apply_snapshot',
    'text_search',
    'symbol_search',
    'structural_search',
    'structural_patch_checks',
    'ast_query',
    'graph_expand',
    'recommend_checks',
    'find_definition',
    'find_references',
    'get_completions',
    'rename_symbol',
    'plan_rename',
    'apply_rename',
    'build_symbol_map',
    'generate_tests',
    'suggest_refactoring',
    'explore_codebase',
] as const;

export type HttpToolSurface = 'HTTP tools/call surface' | 'HTTP adapter surface' | string;

export function mutationToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ALLOW_SNAPSHOT_APPLY === '1';
}

export function defaultHttpToolNames(env: NodeJS.ProcessEnv = process.env): Set<string> {
    const allowed = new Set<string>(BASE_HTTP_TOOL_NAMES);
    if (mutationToolsEnabled(env)) {
        for (const name of MUTATING_HTTP_TOOL_NAMES) allowed.add(name);
    }
    return allowed;
}

export function knownWorkflowToolNames(): Set<string> {
    return new Set<string>(KNOWN_WORKFLOW_TOOL_NAMES);
}

export function assertHttpToolAllowed(
    name: string,
    args: Record<string, any>,
    opts: { surface?: HttpToolSurface; allowedToolNames?: string[]; env?: NodeJS.ProcessEnv } = {}
): void {
    const surface = opts.surface || 'HTTP tools/call surface';
    const env = opts.env || process.env;
    const mutationEnvEnabled = mutationToolsEnabled(env);
    const allowed = opts.allowedToolNames ? new Set<string>(opts.allowedToolNames) : defaultHttpToolNames(env);
    const isMutationTool = (MUTATING_HTTP_TOOL_NAMES as readonly string[]).includes(name);

    if (!allowed.has(name)) {
        if (!knownWorkflowToolNames().has(name)) {
            throw new CoreError('UnknownTool', `Unknown tool: ${name}`, { tool: name });
        }
        if (isMutationTool && !mutationEnvEnabled) {
            throw new CoreError('InvalidParams', `Tool '${name}' requires ALLOW_SNAPSHOT_APPLY=1 through ${surface}`);
        }
        throw new CoreError('InvalidParams', `Tool '${name}' is not available through this ${surface}`);
    }

    if (isMutationTool && !mutationEnvEnabled) {
        throw new CoreError('InvalidParams', `Tool '${name}' requires ALLOW_SNAPSHOT_APPLY=1 through ${surface}`);
    }
    if (name === 'safe_write' && args?.apply === true && !mutationEnvEnabled) {
        throw new CoreError('InvalidParams', `safe_write apply requires ALLOW_SNAPSHOT_APPLY=1 through ${surface}`);
    }
}
