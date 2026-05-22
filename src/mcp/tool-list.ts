import { ToolRegistry, type ToolSpec } from '../core/tools/registry.js';

export interface ListMcpToolsOptions {
    mode?: string;
    preferRenamed?: boolean;
}

export function listMcpTools(options: ListMcpToolsOptions = {}) {
    let tools = ToolRegistry.list();
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
