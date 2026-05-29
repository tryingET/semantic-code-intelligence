import { CoreError } from '../errors.js';
import { ToolRegistry } from './registry.js';

export const ALPHA_MVP_TOOL_NAMES = [
    'get_snapshot',
    'read_file',
    'text_search',
    'symbol_search',
    'ast_query',
    'find_definition',
    'find_references',
    'graph_expand',
    'recommend_checks',
    'propose_patch',
    'apply_snapshot',
    'patch_checks_in_snapshot',
    'extract_snapshot_artifacts',
    'run_checks',
    'structural_search',
    'structural_patch_checks',
    'safe_write',
    'rename_safely',
] as const;

export type AlphaMvpToolName = (typeof ALPHA_MVP_TOOL_NAMES)[number];

const ALPHA_MVP_TOOL_NAME_SET = new Set<string>(ALPHA_MVP_TOOL_NAMES);

export function alphaMvpToolNames(): string[] {
    return [...ALPHA_MVP_TOOL_NAMES];
}

export function isAlphaMvpToolName(name: string): name is AlphaMvpToolName {
    return ALPHA_MVP_TOOL_NAME_SET.has(String(name || '').trim());
}

export function alphaMvpToolNameSet(): Set<string> {
    return new Set(ALPHA_MVP_TOOL_NAME_SET);
}

export function assertAlphaMvpToolAllowed(
    name: string,
    args: Record<string, any> = {},
    opts: { surface?: string; env?: NodeJS.ProcessEnv; allowedToolNames?: Iterable<string> } = {}
): void {
    const normalized = String(name || '').trim();
    const surface = opts.surface || 'Alpha MVP tool surface';
    const allowed = opts.allowedToolNames
        ? new Set(
              [...opts.allowedToolNames].filter((toolName) =>
                  ALPHA_MVP_TOOL_NAME_SET.has(String(toolName || '').trim())
              )
          )
        : ALPHA_MVP_TOOL_NAME_SET;
    if (!allowed.has(normalized)) {
        const known = ToolRegistry.list().some((tool) => tool.name === normalized);
        if (!known) {
            throw new CoreError('UnknownTool', `Unknown tool: ${normalized || '<empty>'}`, { tool: normalized });
        }
        throw new CoreError('InvalidParams', `Tool '${normalized}' is not available through this ${surface}`, {
            tool: normalized,
            supportedTools: [...allowed].sort(),
        });
    }

    const env = opts.env || process.env;
    if (normalized === 'apply_snapshot' && env.ALLOW_SNAPSHOT_APPLY !== '1') {
        throw new CoreError(
            'InvalidParams',
            `Tool 'apply_snapshot' requires ALLOW_SNAPSHOT_APPLY=1 through ${surface}`
        );
    }
    if (normalized === 'safe_write' && args?.apply === true && env.ALLOW_SNAPSHOT_APPLY !== '1') {
        throw new CoreError('InvalidParams', `safe_write apply requires ALLOW_SNAPSHOT_APPLY=1 through ${surface}`);
    }
}
