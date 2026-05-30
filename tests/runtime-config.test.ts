import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultCoreConfig } from '../src/adapters/utils.js';
import { resolveConfiguredWorkspaceRoot } from '../src/core/workspace-root.js';

const roots: string[] = [];
const originalCwd = process.cwd();
const originalWorkspace = process.env.SEMANTIC_CODE_WORKSPACE;
const originalLegacyWorkspace = process.env.WORKSPACE_ROOT;

function tempWorkspace(prefix = 'sci-runtime-config-') {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

afterEach(() => {
    process.chdir(originalCwd);
    if (originalWorkspace === undefined) delete process.env.SEMANTIC_CODE_WORKSPACE;
    else process.env.SEMANTIC_CODE_WORKSPACE = originalWorkspace;
    if (originalLegacyWorkspace === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = originalLegacyWorkspace;
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('runtime config contract', () => {
    test('CLI/server runtime config resolves workspace and database paths relative to the config file', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        delete process.env.WORKSPACE_ROOT;
        const root = tempWorkspace();
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            [
                'workspaceRoot: app',
                'database:',
                '  path: data/ontology.db',
                'cache:',
                '  maxSize: 2048',
                '  ttlMs: 10000',
                '',
            ].join('\n'),
            'utf8'
        );
        process.chdir(root);

        expect(resolveConfiguredWorkspaceRoot()).toBe(join(root, 'app'));
        const config = createDefaultCoreConfig();
        expect(config.workspaceRoot).toBe(join(root, 'app'));
        expect(config.database?.path).toBe(join(root, 'data', 'ontology.db'));
        expect(config.layers.layer4.dbPath).toBe(join(root, 'data', 'ontology.db'));
        expect(config.cache.memory.maxSize).toBe(2048);
        expect(config.cache.memory.ttl).toBe(10);
    });

    test('config-file workspaceRoot cannot escape the config directory through a symlink', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        delete process.env.WORKSPACE_ROOT;
        const root = tempWorkspace();
        const outside = tempWorkspace('sci-runtime-config-outside-');
        mkdirSync(join(root, 'repo'));
        symlinkSync(outside, join(root, 'repo', 'ws'), 'dir');
        writeFileSync(join(root, 'repo', '.semantic-code-intelligence-config.yaml'), 'workspaceRoot: ws\n', 'utf8');
        process.chdir(join(root, 'repo'));

        expect(() => resolveConfiguredWorkspaceRoot()).toThrow('realpath must stay within the config directory');
    });

    test('explicit and environment workspace roots override config-file workspaceRoot', () => {
        delete process.env.WORKSPACE_ROOT;
        const root = tempWorkspace();
        const envRoot = join(root, 'env-root');
        const explicitRoot = join(root, 'explicit-root');
        writeFileSync(join(root, '.semantic-code-intelligence-config.yaml'), 'workspaceRoot: config-root\n', 'utf8');
        process.chdir(root);

        process.env.SEMANTIC_CODE_WORKSPACE = envRoot;
        expect(resolveConfiguredWorkspaceRoot()).toBe(envRoot);
        expect(resolveConfiguredWorkspaceRoot(explicitRoot)).toBe(explicitRoot);
    });
});
