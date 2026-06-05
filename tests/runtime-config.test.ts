import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultCoreConfig } from '../src/adapters/utils.js';
import { DEFAULT_CONFIG, getConfig, getEnvironmentConfig, getServiceUrl } from '../src/core/config/server-config.js';
import { createRuntimeCoreConfig } from '../src/core/runtime-config.js';
import { resolveConfiguredWorkspaceRoot } from '../src/core/workspace-root.js';
import { resolveLspInitializeWorkspaceRoot } from '../src/servers/lsp.js';

const roots: string[] = [];
const originalCwd = process.cwd();
const originalWorkspace = process.env.SEMANTIC_CODE_WORKSPACE;
const originalLegacyWorkspace = process.env.WORKSPACE_ROOT;
const originalHttpPort = process.env.HTTP_API_PORT;
const originalMcpPort = process.env.MCP_HTTP_PORT;
const originalLspPort = process.env.LSP_SERVER_PORT;
const originalLspHost = process.env.LSP_HOST;
const originalCacheEnabled = process.env.LSP_CACHE_ENABLED;
const originalCircuitBreakerThreshold = process.env.CIRCUIT_BREAKER_THRESHOLD;
const originalCircuitBreakerResetTimeout = process.env.CIRCUIT_BREAKER_RESET_TIMEOUT;
const originalDbPath = process.env.SEMANTIC_CODE_DB_PATH;
const originalLayer4DbPath = process.env.LAYER4_DB_PATH;
const originalNodeEnv = process.env.NODE_ENV;
const originalBunEnv = process.env.BUN_ENV;

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
    if (originalLspHost === undefined) delete process.env.LSP_HOST;
    else process.env.LSP_HOST = originalLspHost;
    if (originalCacheEnabled === undefined) delete process.env.LSP_CACHE_ENABLED;
    else process.env.LSP_CACHE_ENABLED = originalCacheEnabled;
    if (originalCircuitBreakerThreshold === undefined) delete process.env.CIRCUIT_BREAKER_THRESHOLD;
    else process.env.CIRCUIT_BREAKER_THRESHOLD = originalCircuitBreakerThreshold;
    if (originalCircuitBreakerResetTimeout === undefined) delete process.env.CIRCUIT_BREAKER_RESET_TIMEOUT;
    else process.env.CIRCUIT_BREAKER_RESET_TIMEOUT = originalCircuitBreakerResetTimeout;
    if (originalDbPath === undefined) delete process.env.SEMANTIC_CODE_DB_PATH;
    else process.env.SEMANTIC_CODE_DB_PATH = originalDbPath;
    if (originalLayer4DbPath === undefined) delete process.env.LAYER4_DB_PATH;
    else process.env.LAYER4_DB_PATH = originalLayer4DbPath;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalBunEnv === undefined) delete process.env.BUN_ENV;
    else process.env.BUN_ENV = originalBunEnv;
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

    test('default core config loads target runtime config from WORKSPACE_ROOT when launched elsewhere', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        const target = tempWorkspace('sci-runtime-config-target-');
        const supervisor = tempWorkspace('sci-runtime-config-supervisor-');
        writeFileSync(
            join(target, '.semantic-code-intelligence-config.yaml'),
            'database:\n  path: .ontology/custom.db\n',
            'utf8'
        );
        process.env.WORKSPACE_ROOT = target;
        process.chdir(supervisor);

        const config = createDefaultCoreConfig();
        expect(config.database?.path).toBe(join(target, '.ontology', 'custom.db'));
        expect(config.layers.layer4.dbPath).toBe(join(target, '.ontology', 'custom.db'));
    });

    test('default core config anchors default ontology storage to the effective workspace root', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        delete process.env.WORKSPACE_ROOT;
        delete process.env.SEMANTIC_CODE_DB_PATH;
        delete process.env.LAYER4_DB_PATH;
        const root = tempWorkspace();
        const config = createDefaultCoreConfig(root);

        expect(config.workspaceRoot).toBe(root);
        expect(config.layers.layer3.dbPath).toBe(join(root, '.ontology', 'ontology.db'));
        expect(config.layers.layer4.dbPath).toBe(join(root, '.ontology', 'ontology.db'));
        expect(config.layers.layer5.dbPath).toBe(join(root, '.ontology', 'ontology.db'));
    });

    test('runtime config preserves distinct per-layer database paths', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        delete process.env.WORKSPACE_ROOT;
        delete process.env.SEMANTIC_CODE_DB_PATH;
        delete process.env.LAYER4_DB_PATH;
        const root = tempWorkspace();
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            [
                'layers:',
                '  layer3:',
                '    dbPath: .ontology/layer3.db',
                '  layer4:',
                '    dbPath: .ontology/layer4.db',
                '  layer5:',
                '    dbPath: .ontology/layer5.db',
                '',
            ].join('\n'),
            'utf8'
        );

        const config = createRuntimeCoreConfig(root);
        expect(config.database?.path).toBe(join(root, '.ontology', 'layer4.db'));
        expect(config.layers.layer3.dbPath).toBe(join(root, '.ontology', 'layer3.db'));
        expect(config.layers.layer4.dbPath).toBe(join(root, '.ontology', 'layer4.db'));
        expect(config.layers.layer5.dbPath).toBe(join(root, '.ontology', 'layer5.db'));
    });

    test('environment database path cannot escape the effective workspace root', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        delete process.env.WORKSPACE_ROOT;
        delete process.env.LAYER4_DB_PATH;
        const root = tempWorkspace();
        const outside = tempWorkspace('sci-runtime-config-env-db-outside-');
        process.env.SEMANTIC_CODE_DB_PATH = join(outside, 'ontology.db');

        expect(() => createDefaultCoreConfig(root)).toThrow('environment database path must stay within the workspace');
    });

    test('runtime database path cannot escape the config directory lexically', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        delete process.env.WORKSPACE_ROOT;
        const root = tempWorkspace();
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            'database:\n  path: ../outside/ontology.db\n',
            'utf8'
        );

        expect(() => createRuntimeCoreConfig(root)).toThrow('database.path must stay within the config directory');
    });

    test('runtime database path cannot escape the config directory through an existing symlink parent', () => {
        delete process.env.SEMANTIC_CODE_WORKSPACE;
        delete process.env.WORKSPACE_ROOT;
        const root = tempWorkspace();
        const outside = tempWorkspace('sci-runtime-config-db-outside-');
        symlinkSync(outside, join(root, 'data'), 'dir');
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            'database:\n  path: data/ontology.db\n',
            'utf8'
        );

        expect(() => createRuntimeCoreConfig(root)).toThrow(
            'database.path realpath must stay within the config directory'
        );
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

    test('environment server config can load from target workspace when launch cwd differs', () => {
        delete process.env.NODE_ENV;
        delete process.env.BUN_ENV;
        delete process.env.HTTP_API_PORT;
        delete process.env.MCP_HTTP_PORT;
        delete process.env.LSP_SERVER_PORT;
        const target = tempWorkspace('sci-runtime-server-target-');
        const supervisor = tempWorkspace('sci-runtime-server-supervisor-');
        writeFileSync(
            join(target, '.semantic-code-intelligence-config.yaml'),
            'server:\n  host: 127.0.0.42\n  ports:\n    httpAPI: 7996\n    mcpHTTP: 7997\n    lspServer: 7998\n',
            'utf8'
        );
        process.chdir(supervisor);

        expect(getEnvironmentConfig(target)).toMatchObject({
            host: '127.0.0.42',
            ports: { httpAPI: 7996, mcpHTTP: 7997, lspServer: 7998 },
        });
    });

    test('LSP initialization workspace root prefers rootUri over deprecated rootPath', () => {
        const rootUriWorkspace = tempWorkspace('sci-runtime-root-uri-');
        const rootPathWorkspace = tempWorkspace('sci-runtime-root-path-');
        expect(
            resolveLspInitializeWorkspaceRoot({
                capabilities: {},
                rootUri: `file://${rootUriWorkspace}`,
                rootPath: rootPathWorkspace,
            } as any)
        ).toBe(rootUriWorkspace);
    });

    test('documented server environment overrides are applied and parsed strictly', () => {
        delete process.env.HTTP_API_PORT;
        delete process.env.MCP_HTTP_PORT;
        delete process.env.LSP_SERVER_PORT;
        process.env.LSP_HOST = '127.0.0.42';
        process.env.LSP_CACHE_ENABLED = 'false';
        process.env.CIRCUIT_BREAKER_THRESHOLD = '9';
        process.env.CIRCUIT_BREAKER_RESET_TIMEOUT = '12345';

        expect(getConfig(tempWorkspace())).toMatchObject({
            host: '127.0.0.42',
            cacheEnabled: false,
            circuitBreakerThreshold: 9,
            circuitBreakerResetTimeout: 12345,
        });

        process.env.LSP_CACHE_ENABLED = 'tru';
        expect(() => getConfig(tempWorkspace())).toThrow('Invalid boolean environment variable LSP_CACHE_ENABLED');

        process.env.LSP_CACHE_ENABLED = 'false';
        process.env.LSP_HOST = '';
        expect(() => getConfig(tempWorkspace())).toThrow('Invalid host environment variable LSP_HOST');

        process.env.LSP_HOST = '127.0.0.42';
        process.env.CIRCUIT_BREAKER_THRESHOLD = '0';
        expect(() => getConfig(tempWorkspace())).toThrow(
            'Invalid positive numeric environment variable CIRCUIT_BREAKER_THRESHOLD'
        );
    });

    test('runtime server circuit breaker config requires positive values', () => {
        const root = tempWorkspace();
        writeFileSync(
            join(root, '.semantic-code-intelligence-config.yaml'),
            'server:\n  circuitBreakerThreshold: 0\n',
            'utf8'
        );
        expect(() => getConfig(root)).toThrow(
            'Invalid positive numeric runtime configuration server.circuitBreakerThreshold'
        );
    });

    test('service URLs bracket IPv6 hosts', () => {
        expect(getServiceUrl('mcpHTTP', { ...DEFAULT_CONFIG, host: '::1' })).toBe('http://[::1]:7001');
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
        expect(createDefaultCoreConfig(root).workspaceRoot).toBe(envRoot);
    });
});
