import { describe, expect, test } from 'bun:test';
import { resolveToolExecutionPolicy } from '../src/core/tools/execution-policy';
import { ToolRegistry } from '../src/core/tools/registry';

function spec(name: string) {
    const found = ToolRegistry.list().find((tool) => tool.name === name);
    expect(found).toBeDefined();
    return found;
}

describe('tool execution policy', () => {
    test('keeps ordinary tools on the default bounded timeout', () => {
        const policy = resolveToolExecutionPolicy(spec('read_file'), {});

        expect(policy.longRunning).toBe(false);
        expect(policy.disableRetries).toBe(false);
        expect(policy.timeoutMs).toBe(30_000);
    });

    test('derives long-running timeouts from per-command timeout and command count', () => {
        const policy = resolveToolExecutionPolicy(spec('patch_checks_in_snapshot'), {
            commands: ['bun run typecheck', 'bun test tests/tool-execution-policy.test.ts'],
            timeoutSec: 120,
        });

        expect(policy.longRunning).toBe(true);
        expect(policy.disableRetries).toBe(true);
        expect(policy.timeoutMs).toBe(270_000);
    });

    test('clamps long-running tool timeout windows', () => {
        const minPolicy = resolveToolExecutionPolicy(spec('run_checks'), { commands: ['true'], timeoutSec: 1 });
        const maxPolicy = resolveToolExecutionPolicy(spec('run_checks'), { commands: ['true'], timeoutSec: 999999 });

        expect(minPolicy.timeoutMs).toBe(60_000);
        expect(maxPolicy.timeoutMs).toBe(30 * 60 * 1000);
    });
});
