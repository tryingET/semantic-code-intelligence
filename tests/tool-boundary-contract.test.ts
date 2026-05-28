import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

        const applyRename = tool('apply_rename').inputSchema;
        expect(applyRename.required).toEqual(['oldName', 'newName']);
        expect(applyRename.properties.oldName).toBeDefined();
        expect(applyRename.properties.changes).toBeUndefined();

        const applySnapshot = tool('apply_snapshot').inputSchema;
        expect(applySnapshot.properties.reverse).toEqual({ type: 'boolean', default: false });
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
        const outsideReadResult = await store.runChecks(snap.id, ['grep root /etc/passwd'], 5, { workspaceRoot: root });
        const traversalReadResult = await store.runChecks(snap.id, ['grep root ../../../../etc/passwd'], 5, { workspaceRoot: root });
        const nodeOptionsResult = await store.runChecks(snap.id, ['NODE_OPTIONS=--require=/tmp/pwn.cjs true'], 5, { workspaceRoot: root });
        const npmConfigResult = await store.runChecks(snap.id, ['npm_config_userconfig=/tmp/npmrc true'], 5, { workspaceRoot: root });

        expect(envResult.ok).toBe(false);
        expect(envResult.output).toContain('Rejected check command');
        expect(envResult.commands[0]).toMatchObject({ command: 'env', ok: false, exitCode: null, timedOut: false });
        expect(evalResult.ok).toBe(false);
        expect(evalResult.output).toContain('unsupported bun validation subcommand');
        expect(outsideReadResult.ok).toBe(false);
        expect(outsideReadResult.output).toContain('workspace-relative paths');
        expect(outsideReadResult.output).not.toContain('root:x:0:0');
        expect(traversalReadResult.ok).toBe(false);
        expect(traversalReadResult.output).toContain('workspace-relative paths');
        expect(traversalReadResult.output).not.toContain('root:x:0:0');
        expect(nodeOptionsResult.ok).toBe(false);
        expect(nodeOptionsResult.output).toContain('unsupported validation environment variable: NODE_OPTIONS');
        expect(npmConfigResult.ok).toBe(false);
        expect(npmConfigResult.output).toContain('unsupported validation environment variable: npm_config_userconfig');
    });

    test('snapshot patches and checks reject symlink escapes and unsafe git apply', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });

        const symlinkDiff = `diff --git a/leak b/leak\nnew file mode 120000\nindex 0000000..39cd576\n--- /dev/null\n+++ b/leak\n@@ -0,0 +1 @@\n+/etc/passwd\n\\ No newline at end of file\n`;
        const stagedSymlink = store.stagePatch(snap.id, symlinkDiff);
        expect(stagedSymlink.accepted).toBe(false);
        expect(stagedSymlink.message).toContain('symlink file modes');

        const evilDiff = `diff --git a/evil.diff b/evil.diff\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/evil.diff\n@@ -0,0 +1,4 @@\n+--- /dev/null\n++++ ../../pwned-sci-unsafe\n+@@ -0,0 +1 @@\n++PWNED\n`;
        expect(store.stagePatch(snap.id, evilDiff).accepted).toBe(true);
        const unsafeApply = await store.runChecks(snap.id, ['git apply --unsafe-paths evil.diff'], 5, { workspaceRoot: root });
        expect(unsafeApply.ok).toBe(false);
        expect(unsafeApply.output).toContain('unsupported git apply option: --unsafe-paths');

        const mutatingApply = await store.runChecks(snap.id, ['git apply evil.diff'], 5, { workspaceRoot: root });
        expect(mutatingApply.ok).toBe(false);
        expect(mutatingApply.output).toContain('git apply validation commands must include --check');
    });

    test('run_checks rejects oversized command lists before execution', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });

        const result = await store.runChecks(snap.id, Array.from({ length: 21 }, () => 'true'), 5, { workspaceRoot: root });
        expect(result.ok).toBe(false);
        expect(result.output).toContain('at most 20 commands');
        expect(result.commands).toEqual([]);
    });

    test('run_checks command cap does not reject exactly twenty explicit commands when touched quick check is enabled', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });
        const diff = `diff --git a/sample.ts b/sample.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/sample.ts\n@@ -0,0 +1 @@\n+export const sample = 1;\n`;
        expect(store.stagePatch(snap.id, diff).accepted).toBe(true);

        const result = await store.runChecks(snap.id, Array.from({ length: 20 }, () => 'true'), 5, { workspaceRoot: root, onlyTouched: true });
        expect(result.ok).toBe(true);
        expect(result.commands).toHaveLength(20);
    });

    test('run_checks rejects oversized individual command strings before execution', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });

        const result = await store.runChecks(snap.id, [`true ${'x'.repeat(9000)}`], 5, { workspaceRoot: root });
        expect(result.ok).toBe(false);
        expect(result.output).toContain('command length must be at most 8192 characters');
    });

    test('reverse snapshot apply preserves pre-existing empty directories', async () => {
        const root = tempRoot();
        mkdirSync(join(root, 'keepdir'), { recursive: true });
        writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot: root });
        const diff = `diff --git a/keepdir/new.txt b/keepdir/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/keepdir/new.txt\n@@ -0,0 +1 @@\n+hello\n`;

        expect(store.stagePatch(snap.id, diff).accepted).toBe(true);
        expect((await store.applyToWorkingTree(snap.id, { workspaceRoot: root })).ok).toBe(true);
        expect((await store.applyToWorkingTree(snap.id, { workspaceRoot: root, reverse: true })).ok).toBe(true);

        expect(existsSync(join(root, 'keepdir'))).toBe(true);
        expect(existsSync(join(root, 'keepdir', 'new.txt'))).toBe(false);
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
