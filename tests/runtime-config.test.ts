import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultCoreConfig } from '../src/adapters/utils.js';
import { getConfig } from '../src/core/config/server-config.js';
import { createRuntimeCoreConfig } from '../src/core/runtime-config.js';
import { resolveConfiguredWorkspaceRoot } from '../src/core/workspace-root.js';

const roots: string[] = [];
const originalCwd = process.cwd();
const originalWorkspace = process.env.SEMANTIC_CODE_WORKSPACE;
const originalLegacyWorkspace = process.env.WORKSPACE_ROOT;
const originalHttpPort = process.env.HTTP_API_PORT;
const originalMcpPort = process.env.MCP_HTTP_PORT;
const originalLspPort = process.env.LSP_SERVER_PORT;

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
    if (originalHttpPort === undefined) delete process.env.HTTP_API_PORT;
    else process.env.HTTP_API_PORT = originalHttpPort;
    if (originalMcpPort === undefined) delete process.env.MCP_HTTP_PORT;
    else process.env.MCP_HTTP_PORT = originalMcpPort;
    if (originalLspPort === undefined) delete process.env.LSP_SERVER_PORT;
    else process.env.LSP_SERVER_PORT = originalLspPort;
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

    test('documented server ports load from runtime config and environment keeps precedence', () => {
        delete process.env.HTTP_API_PORT;
        delete process.env.MCP_HTTP_PORT;
        delete process.env.LSP_SERVER_PORT;
        const root = tempWorkspace();
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            [
                'server:',
                '  host: 127.0.0.1',
                '  ports:',
                '    httpAPI: 7998',
                '    mcpHTTP: 7999',
                '    lspServer: 8000',
                '',
            ].join('\n'),
            'utf8'
        );

        expect(getConfig(root).host).toBe('127.0.0.1');
        expect(getConfig(root).ports).toMatchObject({ httpAPI: 7998, mcpHTTP: 7999, lspServer: 8000 });

        process.env.MCP_HTTP_PORT = '8001';
        expect(getConfig(root).ports.mcpHTTP).toBe(8001);
    });

    test('server cacheEnabled runtime config is parsed strictly', () => {
        const root = tempWorkspace();
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            'server:\n  cacheEnabled: "true"\n',
            'utf8'
        );
        expect(getConfig(root).cacheEnabled).toBe(true);

        const invalid = tempWorkspace('sci-runtime-config-invalid-bool-');
        writeFileSync(
            join(invalid, '.semantic-code-intelligence-config.yaml'),
            'server:\n  cacheEnabled: tru\n',
            'utf8'
        );
        expect(() => getConfig(invalid)).toThrow('Invalid boolean runtime configuration server.cacheEnabled');
    });

    test('legacy documented layer aliases normalize to canonical runtime layers', () => {
        const root = tempWorkspace();
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            [
                'layers:',
                '  layer1_fast:',
                '    timeout: 111',
                '  tree_sitter:',
                '    timeout: 222',
                '  ontology:',
                '    dbPath: .ontology/concepts.db',
                '    cacheSize: 333',
                '  patterns:',
                '    learningThreshold: 4',
                '  propagation:',
                '    maxDepth: 5',
                '',
            ].join('\n'),
            'utf8'
        );

        const config = createRuntimeCoreConfig(root);
        expect(config.layers.layer1.timeout).toBe(111);
        expect(config.layers.layer2.timeout).toBe(222);
        expect(config.layers.layer4.dbPath).toBe(join(root, '.ontology', 'concepts.db'));
        expect(config.layers.layer4.cacheSize).toBe(333);
        expect(config.layers.layer5.learningThreshold).toBe(4);
        expect(config.layers.layer5.maxDepth).toBe(5);
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
