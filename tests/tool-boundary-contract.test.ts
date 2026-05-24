import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OverlayStore } from '../src/core/overlay-store';
import { getConfig, validatePorts } from '../src/core/config/server-config';
import { ToolRegistry } from '../src/core/tools/registry';

const roots: string[] = [];
const originalEnv: Record<string, string | undefined> = {};

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-tool-boundary-'));
    roots.push(root);
    return root;
}

function tool(name: string) {
    const found = ToolRegistry.list().find((item) => item.name === name);
    expect(found).toBeDefined();
    return found!;
}

function rememberEnv(name: string) {
    if (!(name in originalEnv)) originalEnv[name] = process.env[name];
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
    for (const [name, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
        delete originalEnv[name];
    }
});

describe('tool boundary contract', () => {
    test('MCP registry advertises workflow arguments consumed by navigation workflows', () => {
        const refs = tool('find_references').inputSchema.properties;
        expect(refs.file).toBeDefined();
        expect(refs.uri).toBeDefined();
        expect(refs.maxResults).toBeDefined();

        const explore = tool('explore_codebase').inputSchema.properties;
        expect(explore.conceptual).toBeDefined();
    });

    test('run_checks accepts common validation command shapes without shell execution', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        writeFileSync(join(root, 'sample.txt'), 'foo\nbar\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });

        const result = await store.runChecks(snap.id, ['BUN_JOBS=1 true', 'grep -E "foo|bar" sample.txt'], 5, { workspaceRoot: root });

        expect(result.ok).toBe(true);
        expect(result.commands.map((command) => command.ok)).toEqual([true, true]);
    });

    test('run_checks rejects non-validation and arbitrary-code commands before execution', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });

        const envResult = await store.runChecks(snap.id, ['env'], 5, { workspaceRoot: root });
        const evalResult = await store.runChecks(snap.id, ['bun -e "console.log(1)"'], 5, { workspaceRoot: root });

        expect(envResult.ok).toBe(false);
        expect(envResult.output).toContain('Rejected check command');
        expect(envResult.commands[0]).toMatchObject({ command: 'env', ok: false, exitCode: null, timedOut: false });
        expect(evalResult.ok).toBe(false);
        expect(evalResult.output).toContain('unsupported bun validation subcommand');
    });

    test('snapshot artifacts fail closed when .ontology is a symlink', async () => {
        const root = tempRoot();
        const outside = tempRoot();
        symlinkSync(outside, join(root, '.ontology'));
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });

        await expect(store.runChecks(snap.id, ['true'], 5, { workspaceRoot: root })).rejects.toThrow('.ontology must not be a symlink');
    });

    test('server config rejects non-numeric ports and NaN validation', () => {
        rememberEnv('HTTP_API_PORT');
        process.env.HTTP_API_PORT = 'abc';
        expect(() => getConfig()).toThrow('Invalid numeric environment variable HTTP_API_PORT');

        expect(() => validatePorts({
            ports: { httpAPI: Number.NaN, mcpHTTP: 7001, lspServer: 7002, testAPI: 7010, testMCP: 7011, testLSP: 7012 },
            host: 'localhost',
            timeout: 1,
            maxRetries: 1,
            cacheEnabled: false,
            cacheTTL: 1,
            circuitBreakerThreshold: 1,
            circuitBreakerResetTimeout: 1,
        })).toThrow('Invalid port number: NaN');
    });
});
