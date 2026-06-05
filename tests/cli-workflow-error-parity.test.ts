import { afterEach, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type CliResult = { code: number | null; stdout: string; stderr: string };

const roots: string[] = [];

function tempWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-cli-workflow-error-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{"scripts":{}}\n', 'utf8');
    return root;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    return new Promise((resolve) => {
        const proc = spawn(bun, ['run', 'src/servers/cli.ts', ...args], {
            env: { ...process.env, ...env },
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

function parseJson(output: string) {
    return JSON.parse(output.trim() || '{}');
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('CLI workflow error envelopes', () => {
    test('invalid JSON maps to InvalidParams', async () => {
        const res = await runCli(['workflow', 'find_definition', '--args', '{bad', '--json']);
        expect(res.code).toBe(1);
        const body = parseJson(res.stdout);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(String(body.error?.message || '')).toContain('Invalid JSON');
    });

    test('missing params maps to InvalidParams', async () => {
        const res = await runCli(['workflow', 'find_definition', '--args', '{}', '--json']);
        expect(res.code).toBe(1);
        const body = parseJson(res.stdout);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(String(body.error?.message || '')).toContain('Missing required parameters');
    });

    test('unknown tool maps to UnknownTool', async () => {
        const res = await runCli(['workflow', 'no_such_tool', '--args', '{}', '--json']);
        expect(res.code).toBe(1);
        const body = parseJson(res.stdout);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('UnknownTool');
        expect(String(body.error?.message || '')).toContain('Unknown tool');
    });

    test('run-checks json mode stays machine-readable for invalid snapshots', async () => {
        const res = await runCli(['run-checks', '--snapshot', 'not-a-real-snapshot', '--json']);
        expect(res.code).toBe(1);
        expect(res.stderr.trim()).toBe('');
        const body = parseJson(res.stdout);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(String(body.error?.message || '')).toContain('Invalid snapshot id');
    });

    test('generic workflow run_checks preserves InvalidParams for invalid snapshots', async () => {
        const res = await runCli(['workflow', 'run_checks', '--args', '{"snapshot":"not-a-real-snapshot"}', '--json']);
        expect(res.code).toBe(1);
        expect(res.stderr.trim()).toBe('');
        const body = parseJson(res.stdout);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(String(body.error?.message || '')).toContain('Invalid snapshot id');
    });

    test('run-checks exits nonzero while preserving failed check JSON outcome', async () => {
        const root = tempWorkspace();
        const env = { SEMANTIC_CODE_WORKSPACE: root };
        const snapshotRes = await runCli(['get-snapshot', '--json'], env);
        expect(snapshotRes.code).toBe(0);
        const snapshot = parseJson(snapshotRes.stdout).snapshot;

        const res = await runCli(['run-checks', '--snapshot', snapshot, '--cmd', 'false', '--json'], env);
        expect(res.code).toBe(1);
        expect(res.stderr.trim()).toBe('');
        const body = parseJson(res.stdout);
        expect(body.ok).toBe(false);
        expect(body.commands?.[0]?.ok).toBe(false);
    });

    test('propose-patch --run-checks exits nonzero when staged checks fail', async () => {
        const root = tempWorkspace();
        writeFileSync(join(root, 'a.txt'), 'old\n', 'utf8');
        writeFileSync(
            join(root, 'patch.diff'),
            ['--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-old', '+new', ''].join('\n'),
            'utf8'
        );
        const env = { SEMANTIC_CODE_WORKSPACE: root };
        const snapshotRes = await runCli(['get-snapshot', '--json'], env);
        expect(snapshotRes.code).toBe(0);
        const snapshot = parseJson(snapshotRes.stdout).snapshot;

        const res = await runCli(
            [
                'propose-patch',
                '--snapshot',
                snapshot,
                '--file',
                'patch.diff',
                '--run-checks',
                '--cmd',
                'false',
                '--json',
            ],
            env
        );
        expect(res.code).toBe(1);
        expect(res.stderr.trim()).toBe('');
        const body = parseJson(res.stdout);
        expect(body.accepted).toBe(true);
        expect(body.checks?.ok).toBe(false);
    });

    test('workflow run_checks exits nonzero while remaining a domain outcome', async () => {
        const root = tempWorkspace();
        const env = { SEMANTIC_CODE_WORKSPACE: root };
        const snapshotRes = await runCli(['get-snapshot', '--json'], env);
        expect(snapshotRes.code).toBe(0);
        const snapshot = parseJson(snapshotRes.stdout).snapshot;

        const res = await runCli(
            ['workflow', 'run_checks', '--args', JSON.stringify({ snapshot, commands: ['false'] }), '--json'],
            env
        );
        expect(res.code).toBe(1);
        expect(res.stderr.trim()).toBe('');
        const body = parseJson(res.stdout);
        expect(body.isError).toBe(false);
        const payload = JSON.parse(body.content?.[0]?.text || '{}');
        expect(payload.ok).toBe(false);
        expect(payload.commands?.[0]?.ok).toBe(false);
    });
});
