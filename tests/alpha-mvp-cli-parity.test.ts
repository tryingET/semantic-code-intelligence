import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';

type CliResult = { code: number | null; stdout: string; stderr: string };

const patchPlanningMarker = '<!-- alpha cli patch-planning snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -9,1 +9,2 @@
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
`;

function runCli(args: string[]): Promise<CliResult> {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    return new Promise((resolve) => {
        const proc = spawn(bun, ['run', 'src/servers/cli.ts', ...args], {
            env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (chunk) => {
            stdout += String(chunk);
        });
        proc.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
        });
        proc.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });
    });
}

function parseWorkflow(stdout: string): { raw: any; payload: any } {
    const raw = JSON.parse(stdout.trim() || '{}');
    const text = raw?.content?.[0]?.text;
    const payload = typeof text === 'string' ? JSON.parse(text) : raw;
    return { raw, payload };
}

async function workflow(name: string, args: Record<string, unknown>) {
    const res = await runCli(['workflow', name, '--args', JSON.stringify(args), '--json']);
    expect(res.code, `${name} stderr: ${res.stderr}`).toBe(0);
    expect(res.stderr).not.toContain('[HTTP Server]');
    expect(res.stderr).not.toContain('Error:');
    return parseWorkflow(res.stdout);
}

describe('Alpha MVP CLI fallback parity', () => {
    test('generic workflow command executes read/navigation tools with machine-readable stdout', async () => {
        const read = await workflow('read_file', {
            path: 'docs/project/alpha-mvp-contract.md',
            range: { startLine: 1, endLine: 8 },
        });
        expect(read.payload.path).toBe('docs/project/alpha-mvp-contract.md');
        expect(read.payload.content).toContain('Alpha MVP contract');

        const search = await workflow('text_search', { query: 'handleReadFile', path: 'src', maxResults: 5 });
        expect(search.payload.count).toBeGreaterThan(0);
        expect(search.payload.results.length).toBeLessThanOrEqual(5);
    }, 60000);

    test('generic workflow command executes preview-first patch checks without mutating workspace', async () => {
        const before = await Bun.file(patchPlanningTarget).text();
        expect(before).not.toContain(patchPlanningMarker);

        const checked = await workflow('patch_checks_in_snapshot', {
            patch: patchPlanningDiff,
            commands: ['true'],
            timeoutSec: 30,
        });
        expect(checked.payload.workflow).toBe('patch_checks_in_snapshot');
        expect(checked.payload.ok).toBe(true);
        expect(checked.payload.stage?.accepted).toBe(true);
        expect(checked.payload.checks?.ok).toBe(true);

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
    }, 60000);
});
