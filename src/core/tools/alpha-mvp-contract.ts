export const ALPHA_MVP_TOOL_CONTRACT = [
    { name: 'get_snapshot', category: 'snapshot' },
    { name: 'read_file', category: 'read' },
    { name: 'text_search', category: 'search' },
    { name: 'symbol_search', category: 'search' },
    { name: 'ast_query', category: 'navigation' },
    { name: 'find_definition', category: 'navigation' },
    { name: 'find_references', category: 'navigation' },
    { name: 'graph_expand', category: 'impact' },
    { name: 'recommend_checks', category: 'validation' },
    { name: 'propose_patch', category: 'patch' },
    { name: 'apply_snapshot', category: 'patch' },
    { name: 'patch_checks_in_snapshot', category: 'patch' },
    { name: 'extract_snapshot_artifacts', category: 'snapshot' },
    { name: 'run_checks', category: 'validation' },
    { name: 'structural_search', category: 'structural' },
    { name: 'structural_patch_checks', category: 'structural' },
    { name: 'safe_write', category: 'patch' },
    { name: 'explore_symbol_impact', category: 'impact' },
    { name: 'locate_confirm_definition', category: 'navigation' },
    { name: 'rename_safely', category: 'rename' },
] as const;

export type AlphaMvpToolContractEntry = (typeof ALPHA_MVP_TOOL_CONTRACT)[number];
export type AlphaMvpToolName = AlphaMvpToolContractEntry['name'];

export const ALPHA_MVP_TOOL_NAMES = Object.freeze(
    ALPHA_MVP_TOOL_CONTRACT.map((entry) => entry.name)
) as readonly AlphaMvpToolName[];
