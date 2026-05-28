import { alphaMvpToolNameSet } from '../core/tools/alpha-surface.js';
import { ToolRegistry, type ToolSpec } from '../core/tools/registry.js';

export interface ListMcpToolsOptions {
    mode?: string;
    preferRenamed?: boolean;
    surface?: 'alpha' | 'registry';
}

export function fastStdioToolListOptions(env: NodeJS.ProcessEnv = process.env): ListMcpToolsOptions {
    const mode = String(env.FAST_STDIO_LIST_MODE || '').trim();
    return {
        mode: mode || undefined,
        preferRenamed: env.FAST_STDIO_PREFER_RENAMED === '1',
    };
}

export function listMcpTools(options: ListMcpToolsOptions = {}) {
    const allowed = options.surface === 'registry' ? undefined : alphaMvpToolNameSet();
    let tools = ToolRegistry.list().filter((tool) => !allowed || allowed.has(tool.name));
    if (options.mode === 'workflows') {
        tools = tools.filter((tool) => tool.category === 'workflow');
        if (options.preferRenamed) {
            tools = tools.filter((tool) => !tool.name.startsWith('workflow_'));
        }
    }
    return tools.map(toMcpTool);
}

export function toMcpTool(tool: ToolSpec) {
    return {
        name: tool.name,
        title: tool.title || undefined,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.category
            ? { category: tool.category, recommended: tool.category === 'workflow' }
            : { recommended: false },
    };
}
