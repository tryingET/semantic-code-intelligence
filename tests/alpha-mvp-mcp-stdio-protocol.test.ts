import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { join } from 'node:path';
import {
    WORKSPACE_BOUNDARY_MESSAGE,
    WORKSPACE_BOUNDARY_REASON,
    WORKSPACE_BOUNDARY_REMEDIATION,
} from '../src/core/errors';

type Pending = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

const patchPlanningMarker = '<!-- alpha stdio patch-planning snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -7,6 +7,7 @@ type: "reference"
 ---
${' '}
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
${' '}
 ## User and job
${' '}
`;

function parseToolContent(response: any) {
    const text = response?.result?.content?.[0]?.text;
    expect(text).toBeDefined();
    return JSON.parse(text);
}

describe('MCP stdio lifecycle', () => {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;

    test('exits when stdin reaches EOF', async () => {
        const proc = spawn(bun, ['run', 'src/servers/mcp-stdio-entry.ts'], {
            env: {
                ...process.env,
                SILENT_MODE: 'true',
                STDIO_MODE: 'true',
                WORKSPACE_ROOT: process.cwd(),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stderr = '';
        proc.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });
        proc.stdin.end();

        const code = await new Promise<number | null>((resolve, reject) => {
            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`MCP stdio server did not exit after stdin EOF. stderr=${stderr.slice(-1000)}`));
            }, 5000);
            proc.on('close', (exitCode) => {
                clearTimeout(timer);
                resolve(exitCode);
            });
            proc.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });

        expect(code).toBe(0);
    }, 10000);
});

describe('Alpha MVP MCP stdio protocol', () => {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    let proc: ChildProcessWithoutNullStreams;
    let metricsPort = 0;
    let nextId = 1;
    let stdoutBuffer = '';
    let stderr = '';
    const pending = new Map<number, Pending>();
    const stdoutPollution: string[] = [];

    function send(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000) {
        const id = nextId++;
        const message = { jsonrpc: '2.0', id, method, params };
        const promise = new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timed out waiting for ${method} response ${id}. stderr=${stderr.slice(-2000)}`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
        });
        proc.stdin.write(`${JSON.stringify(message)}\n`);
        return promise;
    }

    function notify(method: string, params: Record<string, unknown> = {}) {
        proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    }

    beforeAll(async () => {
        metricsPort = 19500 + Math.floor(Math.random() * 1000);
        proc = spawn(bun, ['run', 'src/servers/mcp-stdio-entry.ts'], {
            env: {
                ...process.env,
                SILENT_MODE: 'true',
                STDIO_MODE: 'true',
                WORKSPACE_ROOT: process.cwd(),
                MCP_STDIO_PROM_PORT: String(metricsPort),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        proc.stdout.on('data', (chunk) => {
            stdoutBuffer += String(chunk);
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                let msg: any;
                try {
                    msg = JSON.parse(line);
                } catch {
                    stdoutPollution.push(line);
                    continue;
                }
                if (typeof msg?.id === 'number') {
                    const waiter = pending.get(msg.id);
                    if (waiter) {
                        pending.delete(msg.id);
                        clearTimeout(waiter.timer);
                        waiter.resolve(msg);
                    }
                }
            }
        });

        proc.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        proc.on('close', (code) => {
            for (const [id, waiter] of pending.entries()) {
                clearTimeout(waiter.timer);
                waiter.reject(new Error(`MCP stdio server exited with ${code} while waiting for response ${id}`));
            }
            pending.clear();
        });

        const init = await send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'alpha-mvp-stdio-test', version: '1.0.0' },
        });
        expect(init.error).toBeUndefined();
        expect(init.result?.serverInfo?.name || init.result?.protocolVersion).toBeDefined();
        notify('notifications/initialized');
    }, 45000);

    afterAll(async () => {
        for (const waiter of pending.values()) clearTimeout(waiter.timer);
        pending.clear();
        proc?.kill('SIGTERM');
    });

    test('tools/list advertises the Alpha MVP tool surface with clean stdout', async () => {
        const response = await send('tools/list');
        expect(response.error).toBeUndefined();
        const tools = response.result?.tools || [];
        const names = new Set(tools.map((tool: any) => tool.name));
        for (const name of [
            'get_snapshot',
            'read_file',
            'text_search',
            'symbol_search',
            'ast_query',
            'find_definition',
            'find_references',
            'graph_expand',
            'propose_patch',
            'run_checks',
        ]) {
            expect(names.has(name), `${name} should be discoverable over MCP stdio`).toBe(true);
        }
        expect(stdoutPollution).toEqual([]);
    });

    test('raw MCP definition matrix keeps boundary errors safe and failure metrics truthful', async () => {
        for (const file of ['tests/fixtures/example.ts', join(process.cwd(), 'tests/fixtures/example.ts')]) {
            const direct = await send('tools/call', {
                name: 'find_definition',
                arguments: { symbol: 'TestClass', file },
            });
            expect(direct.error).toBeUndefined();
            expect(direct.result?.isError).toBe(false);
            expect(parseToolContent(direct)).toMatchObject({ count: 1, definitions: [{ name: 'TestClass' }] });

            const located = await send('tools/call', {
                name: 'locate_confirm_definition',
                arguments: { symbol: 'TestClass', file },
            });
            expect(located.error).toBeUndefined();
            expect(located.result?.isError).toBe(false);
            expect(parseToolContent(located)).toMatchObject({ ok: true, definitions: [{ name: 'TestClass' }] });
        }

        const missing = await send('tools/call', {
            name: 'locate_confirm_definition',
            arguments: { symbol: 'MissingForAk4862', file: 'tests/fixtures/example.ts' },
        });
        expect(missing.error).toBeUndefined();
        expect(missing.result?.isError).toBe(false);
        expect(parseToolContent(missing)).toMatchObject({ ok: false, definitions: [] });

        const outsidePath = join(process.cwd(), '..', 'ak4862-outside.ts');
        for (const tool of ['find_definition', 'locate_confirm_definition']) {
            const rejected = await send('tools/call', {
                name: tool,
                arguments: { symbol: 'TestClass', file: outsidePath },
            });
            expect(rejected.error).toBeUndefined();
            expect(rejected.result?.isError).toBe(true);
            expect(rejected.result?.content?.[0]?.text).toBe(WORKSPACE_BOUNDARY_MESSAGE);
            expect(rejected.result?.error?.message).toBe(WORKSPACE_BOUNDARY_MESSAGE);
            expect(rejected.result?.error?.data).toEqual({
                reason: WORKSPACE_BOUNDARY_REASON,
                remediation: WORKSPACE_BOUNDARY_REMEDIATION,
            });
            const serialized = JSON.stringify(rejected);
            expect(serialized).not.toContain(outsidePath);
            expect(serialized).not.toContain(process.cwd());
            expect(serialized).not.toContain('stack');
            expect(serialized).not.toContain('cause');
        }

        const metrics = await fetch(`http://127.0.0.1:${metricsPort}/metrics`).then((response) => response.text());
        expect(metrics).toContain('tool_calls_total{adapter="mcp_stdio",result="error",tool="find_definition"} 1');
        expect(metrics).toContain(
            'tool_calls_total{adapter="mcp_stdio",result="error",tool="locate_confirm_definition"} 1'
        );
        expect(metrics).toContain('inflight_requests{adapter="mcp_stdio"} 0');
        expect(stdoutPollution).toEqual([]);
    }, 45000);

    test('read/navigation and preview-first patch checks work over MCP stdio without mutating workspace', async () => {
        const before = await Bun.file(patchPlanningTarget).text();
        expect(before).not.toContain(patchPlanningMarker);

        const readResponse = await send('tools/call', {
            name: 'read_file',
            arguments: { path: patchPlanningTarget, range: { startLine: 1, endLine: 8 } },
        });
        expect(readResponse.error).toBeUndefined();
        const read = parseToolContent(readResponse);
        expect(read.path).toBe(patchPlanningTarget);
        expect(read.content).toContain('Alpha MVP contract');

        const searchResponse = await send('tools/call', {
            name: 'text_search',
            arguments: { query: 'handleToolCall', path: 'src', maxResults: 5 },
        });
        expect(searchResponse.error).toBeUndefined();
        const search = parseToolContent(searchResponse);
        expect(search.count).toBeGreaterThan(0);
        expect(search.results.length).toBeLessThanOrEqual(5);

        const patchResponse = await send(
            'tools/call',
            {
                name: 'patch_checks_in_snapshot',
                arguments: { patch: patchPlanningDiff, commands: ['true'], timeoutSec: 30 },
            },
            45000
        );
        expect(patchResponse.error).toBeUndefined();
        const patch = parseToolContent(patchResponse);
        expect(patch.workflow).toBe('patch_checks_in_snapshot');
        expect(patch.ok).toBe(true);
        expect(patch.stage?.accepted).toBe(true);
        expect(patch.checks?.ok).toBe(true);

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
        expect(stdoutPollution).toEqual([]);
    }, 90000);
});
