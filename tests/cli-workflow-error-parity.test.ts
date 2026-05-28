import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';

type CliResult = { code: number | null; stdout: string; stderr: string };

function runCli(args: string[]): Promise<CliResult> {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    return new Promise((resolve) => {
        const proc = spawn(bun, ['run', 'src/servers/cli.ts', ...args], {
            env: { ...process.env },
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
});
