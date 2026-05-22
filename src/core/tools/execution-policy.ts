import type { ToolSpec } from './registry.js';

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const DEFAULT_LONG_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;
export const MIN_LONG_RUNNING_TIMEOUT_MS = 60_000;
export const MAX_LONG_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;

export interface ResolvedToolExecutionPolicy {
    longRunning: boolean;
    disableRetries: boolean;
    timeoutMs: number;
}

export interface ResolveToolExecutionPolicyOptions {
    defaultTimeoutMs?: number;
}

export function resolveToolExecutionPolicy(
    spec: ToolSpec | undefined,
    args: Record<string, any> = {},
    options: ResolveToolExecutionPolicyOptions = {}
): ResolvedToolExecutionPolicy {
    const configuredDefaultTimeoutMs = Number(options.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS);
    const defaultTimeoutMs = Number.isFinite(configuredDefaultTimeoutMs)
        ? Math.max(1_000, configuredDefaultTimeoutMs)
        : DEFAULT_TOOL_TIMEOUT_MS;
    const execution = spec?.execution;

    if (!execution?.longRunning) {
        return {
            longRunning: false,
            disableRetries: execution?.disableRetries === true,
            timeoutMs: defaultTimeoutMs,
        };
    }

    return {
        longRunning: true,
        disableRetries: execution.disableRetries === true,
        timeoutMs: resolveLongRunningTimeoutMs(args),
    };
}

function resolveLongRunningTimeoutMs(args: Record<string, any>): number {
    const timeoutSec = Number(args?.timeoutSec || 0);
    const commandCount = Array.isArray(args?.commands) ? Math.max(1, args.commands.length) : 1;
    const derivedMs = timeoutSec > 0 ? (timeoutSec * commandCount + 30) * 1000 : DEFAULT_LONG_RUNNING_TIMEOUT_MS;
    return Math.max(MIN_LONG_RUNNING_TIMEOUT_MS, Math.min(MAX_LONG_RUNNING_TIMEOUT_MS, derivedMs));
}
