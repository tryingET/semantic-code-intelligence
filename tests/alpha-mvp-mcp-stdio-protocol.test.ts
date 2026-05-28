import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

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

describe('Alpha MVP MCP stdio protocol', () => {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    let proc: ChildProcessWithoutNullStreams;
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
        const port = 19500 + Math.floor(Math.random() * 1000);
        proc = spawn(bun, ['run', 'src/servers/mcp.ts'], {
            env: {
                ...process.env,
                SILENT_MODE: 'true',
                STDIO_MODE: 'true',
                WORKSPACE_ROOT: process.cwd(),
                MCP_STDIO_PROM_PORT: String(port),
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
