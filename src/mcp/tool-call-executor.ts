import type { ToolAdapter, ToolExecutor } from '../core/tools/executor.js';
import { ToolExecutor as DefaultToolExecutor } from '../core/tools/executor.js';
import { resolveToolExecutionPolicy } from '../core/tools/execution-policy.js';
export { isMcpToolResultSuccess } from './tool-result.js';

export interface McpServerToolCallOptions {
    timeout?: boolean;
    defaultTimeoutMs?: number;
    timeoutMessage?: string;
}

type ToolExecutionDelegate = Pick<ToolExecutor, 'execute' | 'getSpec'>;

export class McpServerToolCallExecutor {
    constructor(private readonly executor: ToolExecutionDelegate = new DefaultToolExecutor()) {}

    async execute(
        adapter: ToolAdapter,
        name: string,
        args: Record<string, any> = {},
        options: McpServerToolCallOptions = {}
    ): Promise<any> {
        const toolArgs = args || {};
        const operation = this.executor.execute(adapter, name, toolArgs);
        if (!options.timeout) return operation;

        const policy = resolveToolExecutionPolicy(this.executor.getSpec(name), toolArgs, {
            defaultTimeoutMs: options.defaultTimeoutMs,
        });
        return Promise.race([
            operation,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(options.timeoutMessage || 'Tool call timeout')), policy.timeoutMs)
            ),
        ]);
    }
}
