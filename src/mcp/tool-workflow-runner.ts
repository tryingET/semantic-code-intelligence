import { resolveToolExecutionPolicy } from '../core/tools/execution-policy.js';
import type { ToolAdapter, ToolExecutor } from '../core/tools/executor.js';
import { ToolExecutor as DefaultToolExecutor } from '../core/tools/executor.js';
import { ToolWorkflowRouter } from '../core/workflows/tool-workflow-router.js';
import type { WorkflowCoreAnalyzer } from '../core/workflows/types.js';
import type { RecoveryOptions } from './error-handler.js';
import { formatMcpWorkflowResult } from './tool-result.js';

type ToolExecutionDelegate = Pick<ToolExecutor, 'execute' | 'getSpec'>;

export interface McpToolWorkflowRunnerConfig {
    maxResults?: number | (() => number);
    toolRouter?: ToolAdapter;
    toolExecutor?: ToolExecutionDelegate;
}

export class McpToolWorkflowRunner {
    private readonly toolRouter: ToolAdapter;
    private readonly toolExecutor: ToolExecutionDelegate;

    constructor(
        private readonly coreAnalyzer: WorkflowCoreAnalyzer,
        private readonly config: McpToolWorkflowRunnerConfig = {}
    ) {
        this.toolRouter =
            config.toolRouter ??
            new ToolWorkflowRouter(this.coreAnalyzer, {
                maxResults: () => this.getMaxResults(),
            });
        this.toolExecutor = config.toolExecutor ?? new DefaultToolExecutor();
    }

    async execute(name: string, args: Record<string, any>) {
        return formatMcpWorkflowResult(await this.toolExecutor.execute(this.toolRouter, name, args));
    }

    errorHandlingOptionsForTool(name: string, args: Record<string, any>): Partial<RecoveryOptions> | undefined {
        const policy = resolveToolExecutionPolicy(this.toolExecutor.getSpec(name), args);
        if (!policy.longRunning) return undefined;

        return {
            timeoutMs: policy.timeoutMs,
            ...(policy.disableRetries ? { maxRetries: 0 } : {}),
        } satisfies Partial<RecoveryOptions>;
    }

    private getMaxResults(): number {
        const configured = this.config.maxResults;
        return typeof configured === 'function' ? configured() : configured || 100;
    }
}
