import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLIAdapter } from '../src/adapters/cli-adapter';
import { toMcpError } from '../src/adapters/error-mapper';
import { HTTPAdapter } from '../src/adapters/http-adapter';
import { LSPAdapter } from '../src/adapters/lsp-adapter';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { createDefaultCoreConfig } from '../src/adapters/utils';
import { CoreError } from '../src/core/errors';
import { createCodeAnalyzer } from '../src/core/index';
import { OverlayStore } from '../src/core/overlay-store';
import { SnapshotPatchWorkflowService } from '../src/core/workflows/snapshot-patch-workflow';
import { normalizeStructuralPaths } from '../src/core/workflows/structural-workflow';
import { WorkspaceQueryWorkflowService } from '../src/core/workflows/workspace-query-workflow';
import { workspaceInputToPath } from '../src/core/workspace-input';
import { FastSearchLayer } from '../src/layers/layer1-fast-search';
import { TreeSitterLayer } from '../src/layers/tree-sitter';
import { PostgresStorageAdapter } from '../src/ontology/adapters/postgres-adapter';
import { TripleStoreStorageAdapter } from '../src/ontology/adapters/triple-adapter';
import { OntologyStorage } from '../src/ontology/storage';
import { PatternStorage } from '../src/patterns/pattern-storage';
import { HTTPServer } from '../src/servers/http';
import { ThingKind } from '../src/types/core';

const roots: string[] = [];

function tempWorkspace(prefix = 'sci-nexus-') {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function parseContent(res: any): any {
    const text = res?.content?.[0]?.text;
    if (typeof text === 'string') return JSON.parse(text);
    return res?.payload ?? res;
}

async function httpResponseBodyText(body: string | ReadableStream<Uint8Array>): Promise<string> {
    if (typeof body === 'string') return body;
    return await new Response(body).text();
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function runGit(workspaceRoot: string, args: string[]) {
    const proc = spawnSync('git', args, {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'sci-test',
            GIT_AUTHOR_EMAIL: 'sci-test@example.test',
            GIT_COMMITTER_NAME: 'sci-test',
            GIT_COMMITTER_EMAIL: 'sci-test@example.test',
        },
    });
    expect(proc.status, `git ${args.join(' ')} failed: ${proc.stderr || proc.stdout}`).toBe(0);
}

function initGitWorkspace(workspaceRoot: string, opts: { ignoreOntology?: boolean } = {}) {
    runGit(workspaceRoot, ['init', '-q']);
    if (opts.ignoreOntology) writeFileSync(join(workspaceRoot, '.gitignore'), '.ontology/\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'README.md'), 'base\n', 'utf8');
    runGit(workspaceRoot, ['add', '.']);
    runGit(workspaceRoot, ['commit', '-q', '-m', 'init']);
}

async function withMcp<T>(workspaceRoot: string, fn: (mcp: MCPAdapter) => Promise<T>): Promise<T> {
    const cfg = createDefaultCoreConfig();
    const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot });
    await analyzer.initialize();
    try {
        return await fn(new MCPAdapter(analyzer));
    } finally {
        await analyzer.dispose?.();
    }
}

describe('nexus contract regressions', () => {
    test('negative search bloom cache is scoped by path and file type', async () => {
        const workspaceRoot = tempWorkspace();
        mkdirSync(join(workspaceRoot, 'a'));
        mkdirSync(join(workspaceRoot, 'b'));
        writeFileSync(join(workspaceRoot, 'a', 'no-hit.ts'), 'export const Other = 1;\n', 'utf8');
        writeFileSync(join(workspaceRoot, 'b', 'hit.ts'), 'export const Target = 1;\n', 'utf8');
        const layer = new FastSearchLayer({
            grep: { defaultTimeout: 1000, maxResults: 20, caseSensitive: true, includeContext: false, contextLines: 0 },
            glob: { defaultTimeout: 1000, maxFiles: 100, ignorePatterns: [] },
            ls: { defaultTimeout: 1000, maxDepth: 5, followSymlinks: false, includeDotfiles: false },
            optimization: { parallelSearch: false, bloomFilter: true, maxConcurrency: 1 } as any,
            caching: { enabled: true, ttl: 60, maxEntries: 100 },
        });

        const first = await layer.process({
            identifier: 'Target',
            searchPath: join(workspaceRoot, 'a'),
            fileTypes: ['ts'],
        });
        const second = await layer.process({
            identifier: 'Target',
            searchPath: join(workspaceRoot, 'b'),
            fileTypes: ['ts'],
        });

        expect(first.exact).toHaveLength(0);
        expect(second.toolsUsed).not.toContain('bloomFilter');
        expect(second.exact.length).toBeGreaterThan(0);
        expect([...second.files].some((file) => file.endsWith('hit.ts'))).toBe(true);
    });

    test('fast search without explicit fileTypes does not silently narrow to TypeScript only', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'hit.js'), 'function JsOnlyTarget() { return 1; }\n', 'utf8');
        const layer = new FastSearchLayer({
            grep: { defaultTimeout: 1000, maxResults: 20, caseSensitive: true, includeContext: false, contextLines: 0 },
            glob: { defaultTimeout: 1000, maxFiles: 100, ignorePatterns: [] },
            ls: { defaultTimeout: 1000, maxDepth: 5, followSymlinks: false, includeDotfiles: false },
            optimization: { parallelSearch: false, bloomFilter: false, maxConcurrency: 1 } as any,
            caching: { enabled: false, ttl: 60, maxEntries: 100 },
        });

        const result = await layer.process({ identifier: 'JsOnlyTarget', searchPath: workspaceRoot });

        expect(result.exact.length).toBeGreaterThan(0);
        expect([...result.files].some((file) => file.endsWith('hit.js'))).toBe(true);
    });

    test('rename rejects missing symbols and does not edit comment-only text hits', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'sample.ts');
        writeFileSync(target, '// oldName only in comment\nexport const Other = 1;\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const uri = pathToFileURL(target).href;
            await expect(
                analyzer.prepareRename({ uri, position: { line: 0, character: 3 }, identifier: 'DefinitelyMissingXYZ' })
            ).rejects.toThrow("Symbol 'DefinitelyMissingXYZ' not found");
            await expect(
                analyzer.prepareRename({ uri, position: { line: 0, character: 3 }, identifier: 'oldName' })
            ).rejects.toThrow("Symbol 'oldName' not found");

            await expect(
                analyzer.rename({ uri, position: { line: 0, character: 3 }, identifier: 'oldName', newName: 'newName' })
            ).rejects.toThrow('text-only matches are unsafe to rename');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('pattern storage enables SQLite foreign keys, cascades deletes, and preserves metrics on save', async () => {
        const workspaceRoot = tempWorkspace();
        const store = new PatternStorage(join(workspaceRoot, 'patterns.db')) as any;
        await store.initialize();
        const pattern = {
            id: 'p1',
            from: [{ type: 'literal', value: 'a' }],
            to: [{ type: 'literal', value: 'b' }],
            confidence: 0.8,
            occurrences: 1,
            examples: [
                {
                    oldName: 'a',
                    newName: 'b',
                    confidence: 0.9,
                    context: { file: 'x.ts', surroundingSymbols: [], timestamp: new Date() },
                },
            ],
            lastApplied: new Date(),
            category: 'rename',
        };
        await store.savePattern(pattern);
        store.db.query('UPDATE pattern_metrics SET total_applications = 7 WHERE pattern_id = ?').run('p1');
        await store.savePattern({ ...pattern, confidence: 0.9 });
        expect(
            store.db.query('select total_applications from pattern_metrics where pattern_id = ?').get('p1')
                .total_applications
        ).toBe(7);

        await store.deletePattern('p1');

        expect(store.db.query('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
        expect(store.db.query('select count(*) as c from pattern_examples').get().c).toBe(0);
        expect(store.db.query('select count(*) as c from pattern_metrics').get().c).toBe(0);
    });

    test('ontology storage non-deleting upserts preserve links and handle symbol uniqueness', async () => {
        const workspaceRoot = tempWorkspace();
        const storage = new OntologyStorage(join(workspaceRoot, 'ontology.db'));
        await storage.initialize();
        await storage.upsertSymbol({ id: 's1', text: 'SharedName', language: 'ts', confidence: 0.5 });
        await storage.upsertSymbol({ id: 's2', text: 'SharedName', language: 'ts', confidence: 0.9 });
        const symbols = await storage.loadAllSymbols();
        expect(symbols.filter((symbol) => symbol.text === 'SharedName' && symbol.language === 'ts')).toHaveLength(1);
        expect(symbols.find((symbol) => symbol.text === 'SharedName')?.confidence).toBe(0.9);

        await storage.upsertConcept({
            id: 'c1',
            canonicalName: 'ConceptOne',
            relations: new Map(),
            signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'c1' },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.8,
        });
        const thing = {
            id: 't1',
            kind: ThingKind.Function,
            location: {
                uri: 'file:///workspace/a.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            },
            confidence: 0.5,
        };
        await storage.upsertThing(thing);
        await storage.upsertThingSymbol({ thingId: 't1', symbolId: 's1', role: 'declaration' });
        await storage.upsertThingConcept({ thingId: 't1', conceptId: 'c1', confidence: 0.8, evidence: [] });
        await storage.upsertThing({ ...thing, confidence: 0.95, occurrences: 2 });

        expect(await storage.loadAllThingSymbols()).toHaveLength(1);
        expect(await storage.loadAllThingConcepts()).toHaveLength(1);
        await storage.close();
    });

    test('direct HTTPAdapter routes advertised tools/call endpoint with bounded capability filtering', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const adapter = new HTTPAdapter(analyzer as any, { enableCors: false, enableOpenAPI: false });
            const response = await adapter.handleRequest({
                method: 'POST',
                url: '/api/v1/tools/call',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'read_file', arguments: { path: 'sample.ts', startLine: 1, endLine: 1 } }),
            });

            expect(response.status).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.success).toBe(true);
            expect(JSON.stringify(body.result)).toContain('export const value = 1');

            const snapshot = await adapter.handleRequest({
                method: 'POST',
                url: '/api/v1/tools/call',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'get_snapshot', arguments: { preferExisting: false } }),
            });
            expect(snapshot.status).toBe(200);
            const snapshotId = JSON.parse(snapshot.body).result.snapshot;

            const invalidApply = await adapter.handleRequest({
                method: 'POST',
                url: '/api/v1/tools/call',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'apply_snapshot', arguments: { snapshot: 'not-a-snapshot' } }),
            });
            expect(invalidApply.status).toBe(400);
            expect(JSON.parse(invalidApply.body).error.code).toBe('InvalidParams');

            const deniedApply = await adapter.handleRequest({
                method: 'POST',
                url: '/api/v1/tools/call',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'apply_snapshot', arguments: { snapshot: snapshotId } }),
            });
            expect(deniedApply.status).toBe(200);
            const deniedApplyBody = JSON.parse(deniedApply.body);
            expect(deniedApplyBody.success).toBe(true);
            expect(deniedApplyBody.result).toMatchObject({ ok: false, reason: 'apply_guard_required' });

            const safeWriteDiff = `diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n`;
            const deniedSafeWriteApply = await adapter.handleRequest({
                method: 'POST',
                url: '/api/v1/tools/call',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    name: 'safe_write',
                    arguments: { patch: safeWriteDiff, commands: ['true'], apply: true },
                }),
            });
            expect(deniedSafeWriteApply.status).toBe(200);
            const deniedSafeWriteBody = JSON.parse(deniedSafeWriteApply.body);
            expect(deniedSafeWriteBody.success).toBe(true);
            expect(deniedSafeWriteBody.result).toMatchObject({
                ok: false,
                reason: 'apply_guard_required',
                applied: false,
            });
            expect(deniedSafeWriteBody.result.applyResult?.message).toBe('ALLOW_SNAPSHOT_APPLY=1 required');

            const listed = await adapter.handleRequest({
                method: 'POST',
                url: '/api/v1/tools/call',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'list_files', arguments: { path: '.', maxFiles: 10, depth: 1 } }),
            });
            expect(listed.status).toBe(400);
            expect(JSON.parse(listed.body).error.message).toContain('not available');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('MCP CoreError data is exposed flat for JSON-RPC recovery', () => {
        const error = toMcpError(new CoreError('InvalidParams', 'bad input', { tool: 'read_file' })) as any;
        expect(error.data).toEqual({ tool: 'read_file' });
        expect(error.data?.data).toBeUndefined();
    });

    test('HTTPServer tools/call returns mutation guard refusals as domain outcomes', async () => {
        const workspaceRoot = tempWorkspace();
        const port = 7157;
        const previousPort = process.env.HTTP_API_PORT;
        const previousApply = process.env.ALLOW_SNAPSHOT_APPLY;
        delete process.env.ALLOW_SNAPSHOT_APPLY;
        process.env.HTTP_API_PORT = String(port);
        const server = new HTTPServer({ host: '127.0.0.1', port, workspaceRoot, enableOpenAPI: false });
        await server.start();
        try {
            const snapshot = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'get_snapshot', arguments: { preferExisting: false } }),
            });
            const snapshotBody = await snapshot.json();
            expect(snapshot.status).toBe(200);
            expect(snapshotBody.success).toBe(true);

            const response = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'apply_snapshot', arguments: { snapshot: snapshotBody.result.snapshot } }),
            });
            const body = await response.json();
            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.result).toMatchObject({ ok: false, reason: 'apply_guard_required' });

            const wrongContentType = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body: JSON.stringify({ name: 'read_file', arguments: { path: 'README.md' } }),
            });
            const wrongBody = await wrongContentType.json();
            expect(wrongContentType.status).toBe(400);
            expect(wrongBody.success).toBe(false);
            expect(wrongBody.error.message).toContain('Content-Type: application/json');
            expect(wrongBody.error.message).not.toContain('Missing tool name');
        } finally {
            await server.stop();
            if (previousPort === undefined) delete process.env.HTTP_API_PORT;
            else process.env.HTTP_API_PORT = previousPort;
            if (previousApply === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
            else process.env.ALLOW_SNAPSHOT_APPLY = previousApply;
        }
    });

    test('HTTP pipeline endpoints are explicit legacy surface, not default Alpha HTTP surface', async () => {
        const workspaceRoot = tempWorkspace();
        const port = 7159;
        const previousPort = process.env.HTTP_API_PORT;
        const previousLegacy = process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES;
        delete process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES;
        process.env.HTTP_API_PORT = String(port);
        const server = new HTTPServer({ host: '127.0.0.1', port, workspaceRoot });
        await server.start();
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/v1/pipelines`);
            const body = await response.json();
            expect(response.status).toBe(404);
            expect(body.success).toBe(false);
            expect(body.error.message).toContain('Legacy pipeline HTTP endpoints are disabled');
        } finally {
            await server.stop();
            if (previousPort === undefined) delete process.env.HTTP_API_PORT;
            else process.env.HTTP_API_PORT = previousPort;
            if (previousLegacy === undefined) delete process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES;
            else process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES = previousLegacy;
        }
    });

    test('HTTP pipeline runs rejects nonnumeric limit as caller input', async () => {
        const workspaceRoot = tempWorkspace();
        const port = 7158;
        const previousPort = process.env.HTTP_API_PORT;
        process.env.HTTP_API_PORT = String(port);
        const server = new HTTPServer({ host: '127.0.0.1', port, workspaceRoot, enableOpenAPI: false });
        await server.start();
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/v1/pipelines/runs?id=x&limit=abc`);
            const body = await response.json();
            expect(response.status).toBe(400);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('InvalidParams');
            expect(body.error.message).toContain('limit');
        } finally {
            await server.stop();
            if (previousPort === undefined) delete process.env.HTTP_API_PORT;
            else process.env.HTTP_API_PORT = previousPort;
        }
    });

    test('tree-sitter factory detection recognizes exported factory declarations', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'factory.ts');
        writeFileSync(target, 'export function createUser() {\n  return new User();\n}\nclass User {}\n', 'utf8');
        const layer = new TreeSitterLayer({
            enabled: true,
            timeout: 1000,
            languages: ['typescript'],
            maxFileSize: '1MB',
            projectPath: workspaceRoot,
        });

        const result = await layer.process({
            exact: [
                {
                    file: target,
                    line: 1,
                    column: 1,
                    text: 'createUser',
                    match: 'createUser',
                    confidence: 1,
                    context: { before: [], after: [] },
                    category: 'exact',
                },
            ],
            fuzzy: [],
            conceptual: [],
            files: new Set([target]),
            searchTime: 0,
            toolsUsed: [],
            confidence: 1,
        } as any);

        expect(result.patterns.some((pattern) => pattern.type === 'factory')).toBe(true);
    });

    test('registered list_files is not exposed through the Alpha MCP membrane', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const res = await mcp.handleToolCall('list_files', { path: '.', maxFiles: 10, depth: 1 });
            expect(res.isError).toBe(true);
            expect(String(res.error?.message || res.content?.[0]?.text || '')).toContain('not available');
        });
    });

    test('propose_patch rejects header-only diffs instead of staging unusable overlays', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const snap = parseContent(await mcp.handleToolCall('get_snapshot', { preferExisting: false })).snapshot;
            const patch = 'diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n';
            const res = await mcp.handleToolCall('propose_patch', { snapshot: snap, patch });
            const out = parseContent(res);
            expect(res.isError).toBe(true);
            expect(out.accepted).toBe(false);
            expect(String(out.message)).toContain('invalid_patch');
        });
    });

    test('timestamped unified diff headers do not become file names', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const patch =
                '--- a/sample.ts\t2026-05-24\n+++ b/sample.ts\t2026-05-24\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
            const res = await mcp.handleToolCall('recommend_checks', { patch });
            const out = parseContent(res);
            expect(out.inputs.files).toEqual(['sample.ts']);
        });
    });

    test('symbol-only find_references returns bounded workspace references instead of empty success', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'def.ts'), 'export function target() { return 1; }\n', 'utf8');
        writeFileSync(
            join(workspaceRoot, 'use.ts'),
            'import { target } from "./def";\nexport const value = target();\n',
            'utf8'
        );

        await withMcp(workspaceRoot, async (mcp) => {
            const res = await mcp.handleToolCall('find_references', { symbol: 'target', maxResults: 10 });
            const out = parseContent(res);
            expect(res.isError).toBe(false);
            expect(out.count).toBeGreaterThan(0);
            expect(JSON.stringify(out.references)).toContain('use.ts');
        });
    });

    test('symbol-only graph_expand finds callers outside declaration directories', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
        writeFileSync(
            join(workspaceRoot, 'tsconfig.json'),
            '{"compilerOptions":{"module":"ESNext","target":"ES2022"}}\n',
            'utf8'
        );
        mkdirSync(join(workspaceRoot, 'src'));
        mkdirSync(join(workspaceRoot, 'tests'));
        writeFileSync(
            join(workspaceRoot, 'src', 'def.ts'),
            'export function target() { helper(); }\nfunction helper() {}\n',
            'utf8'
        );
        writeFileSync(
            join(workspaceRoot, 'tests', 'use.test.ts'),
            'import { target } from "../src/def";\nexport function caller() { target(); }\n',
            'utf8'
        );

        await withMcp(workspaceRoot, async (mcp) => {
            const res = await mcp.handleToolCall('graph_expand', {
                symbol: 'target',
                edges: ['callers', 'callees'],
                limit: 20,
            });
            const out = parseContent(res);
            expect(res.isError).toBe(false);
            expect(JSON.stringify(out.neighbors.callers)).toContain('use.test.ts');
            const callerEvidence = out.impactSummary.evidence.find((item: any) => item.edge === 'callers');
            expect(callerEvidence.status).toBe('evidence');
        });
    });

    test('recommend_checks quotes shell-unsafe test filenames and blocks leading-dash option injection', async () => {
        const workspaceRoot = tempWorkspace();
        await withMcp(workspaceRoot, async (mcp) => {
            const injected = await mcp.handleToolCall('recommend_checks', {
                files: ['tests/foo.test.ts; echo PWNED >&2'],
                mode: 'minimum',
            });
            const injectedOut = parseContent(injected);
            expect(injectedOut.commands).toContain("bun test 'tests/foo.test.ts; echo PWNED >&2'");
            expect(injectedOut.commands).not.toContain('bun test tests/foo.test.ts; echo PWNED >&2');

            const leadingDash = await mcp.handleToolCall('recommend_checks', {
                files: ['--preload=evil.test.ts'],
                mode: 'minimum',
            });
            const leadingDashOut = parseContent(leadingDash);
            expect(leadingDashOut.commands).toContain("bun test -- '--preload=evil.test.ts'");
        });
    });

    test('CLI json mode exits nonzero with JSON for empty find and references identifiers', () => {
        for (const command of ['find', 'references']) {
            const proc = spawnSync(process.execPath, ['run', 'src/servers/cli.ts', command, '', '--json'], {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: { ...process.env, SILENT_MODE: 'true' },
            });
            expect(proc.status).not.toBe(0);
            const body = JSON.parse(proc.stdout || '{}');
            expect(body.success).toBe(false);
            expect(body.error?.message).toContain('identifier required');
        }
    });

    test('CLI workflow --json initialization failures return JSON error envelopes', () => {
        const proc = spawnSync(process.execPath, ['run', 'src/servers/cli.ts', 'workflow', 'get_snapshot', '--json'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, SILENT_MODE: 'true', SEMANTIC_CODE_WORKSPACE: '/definitely/not/exist' },
        });
        expect(proc.status).not.toBe(0);
        expect(proc.stderr.trim()).toBe('');
        const body = JSON.parse(proc.stdout || '{}');
        expect(body.success).toBe(false);
        expect(body.error?.message).toContain('Failed to initialize');
    });

    test('dogfood harden path does not self-enable snapshot apply guard', () => {
        const script = readFileSync(join(process.cwd(), 'scripts/dogfood-harden-path.ts'), 'utf8');
        expect(script).not.toContain("process.env.ALLOW_SNAPSHOT_APPLY = '1'");
        expect(script).toContain('Refusing to apply without ALLOW_SNAPSHOT_APPLY=1 already set by the caller');
    });

    test('CLI file URI word extraction decodes encoded paths', () => {
        const workspaceRoot = tempWorkspace('sci nexus uri-');
        const file = join(workspaceRoot, 'a file.ts');
        writeFileSync(file, 'const Alpha = 1;\n', 'utf8');
        const adapter = new CLIAdapter({ config: { workspaceRoot } } as any);
        expect((adapter as any).extractWordFromFile(pathToFileURL(file).href, 0, 6)).toBe('Alpha');
    });

    test('structural paths reject symlink escapes before ast-grep execution', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-outside-');
        writeFileSync(join(outsideRoot, 'secret.ts'), 'function OutsideSecret() { return 1; }\n', 'utf8');
        symlinkSync(outsideRoot, join(workspaceRoot, 'out'));

        await expect(normalizeStructuralPaths(['out'], workspaceRoot)).rejects.toThrow(
            'structural path must stay within the workspace'
        );
    });

    test('HTTP legacy endpoints reject existing files outside the configured workspace by default', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-http-outside-');
        const outsideFile = join(outsideRoot, 'outside.ts');
        writeFileSync(outsideFile, 'const OutsideHttpSecret = 1;\n', 'utf8');
        const core: any = {
            config: { workspaceRoot },
            findDefinition: async () => ({ data: [], performance: {}, requestId: 'unused', timestamp: Date.now() }),
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                identifier: 'OutsideHttpSecret',
                file: outsideFile,
                position: { line: 0, character: 6 },
            }),
        });

        expect(response.status).toBe(400);
        expect(response.body).not.toContain('OutsideHttpSecret = 1');
    });

    test('HTTP legacy plan-rename accepts MCP-style oldName alias', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'sample.ts');
        writeFileSync(target, 'export const OldHttpName = 1;\n', 'utf8');
        let seen: any = null;
        const core: any = {
            config: { workspaceRoot },
            rename: async (request: any) => {
                seen = request;
                return {
                    data: { changes: { [request.uri]: [] } },
                    performance: {},
                    requestId: 'rename-alias',
                };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/plan-rename',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ oldName: 'OldHttpName', newName: 'NewHttpName', file: target }),
        });

        expect(response.status).toBe(200);
        expect(seen.oldName).toBe('OldHttpName');
        expect(JSON.parse(response.body).success).toBe(true);
    });

    test('HTTP apply-rename rejects direct changes instead of reporting false success', async () => {
        const workspaceRoot = tempWorkspace();
        let renameCalled = false;
        const core: any = {
            config: { workspaceRoot },
            rename: async () => {
                renameCalled = true;
                return { data: { changes: {} }, performance: {}, requestId: 'unused' };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/apply-rename',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changes: { 'file:///tmp/a.ts': [] } }),
        });

        expect(response.status).toBe(400);
        expect(renameCalled).toBe(false);
        expect(response.body).toContain('Direct changes application is unsupported');
    });

    test('HTTP legacy rename endpoints cannot bypass preview-first mutation membrane', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const OldHttpName = 1;\n', 'utf8');
        const calls: any[] = [];
        const core: any = {
            config: { workspaceRoot },
            rename: async (request: any) => {
                calls.push(request);
                return { data: { changes: { [request.uri]: [] } }, performance: {}, requestId: 'rename-preview' };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const preview = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/rename',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ oldName: 'OldHttpName', newName: 'NewHttpName', file: 'sample.ts' }),
        });
        expect(preview.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].dryRun).toBe(true);
        expect(JSON.parse(preview.body).data.dryRun).toBe(true);

        const explicitMutation = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/rename',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ oldName: 'OldHttpName', newName: 'NewHttpName', file: 'sample.ts', dryRun: false }),
        });
        expect(explicitMutation.status).toBe(400);
        expect(calls).toHaveLength(1);
        expect(explicitMutation.body).toContain('preview-only');

        const applyRename = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/apply-rename',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ oldName: 'OldHttpName', newName: 'NewHttpName', file: 'sample.ts' }),
        });
        expect(applyRename.status).toBe(400);
        expect(calls).toHaveLength(1);
        expect(applyRename.body).toContain('disabled');
    });

    test('HTTP stream definition defaults omitted position to workspace origin', async () => {
        const workspaceRoot = tempWorkspace();
        const calls: any[] = [];
        const core: any = {
            config: { workspaceRoot },
            findDefinitionAsync: async (req: any) => {
                calls.push(req);
                return { data: [], performance: {}, requestId: 'stream-ok' };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/stream/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Anything' }),
        });

        expect(response.status).toBe(200);
        expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined();
        expect(calls[0].position).toEqual({ line: 0, character: 0 });
        expect(calls[0].uri).toContain(workspaceRoot);
    });

    test('HTTP stream definition returns before the definition lookup resolves', async () => {
        const workspaceRoot = tempWorkspace();
        let release!: () => void;
        const core: any = {
            config: { workspaceRoot },
            findDefinitionAsync: async () => {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                return { data: [], performance: {}, requestId: 'stream-delayed' };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const responsePromise = adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/stream/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Anything' }),
        });
        const early = await Promise.race([responsePromise.then(() => 'returned'), delay(25).then(() => 'blocked')]);
        expect(early).toBe('returned');

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(typeof response.body).not.toBe('string');
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        const first = await reader.read();
        expect(decoder.decode(first.value)).toContain('event: definition-start');
        release();
        let tail = '';
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            tail += decoder.decode(chunk.value);
        }
        expect(tail).toContain('event: definition-end');
    });

    test('HTTP stream definition reports async failures as structured SSE error events', async () => {
        const workspaceRoot = tempWorkspace();
        const core: any = {
            config: { workspaceRoot },
            findDefinitionAsync: async () => {
                await delay(30);
                return { data: [], performance: {}, requestId: 'stream-too-late' };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false, timeout: 1 });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/stream/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Anything' }),
        });
        const bodyText = await httpResponseBodyText(response.body);

        expect(response.status).toBe(200);
        expect(bodyText).toContain('event: definition-start');
        expect(bodyText).toContain('event: definition-error');
        expect(bodyText).toContain('"code":"Internal"');
        expect(bodyText).toContain('timed out');
    });

    test('HTTP stream definition rejects invalid maxResults before core delegation', async () => {
        const workspaceRoot = tempWorkspace();
        const core: any = {
            config: { workspaceRoot },
            findDefinitionAsync: async () => {
                throw new Error('core should not receive invalid maxResults');
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/stream/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Anything', maxResults: 'abc' }),
        });

        expect(response.status).toBe(400);
        expect(response.body).toContain('maxResults must be an integer');
    });

    test('HTTP explicit nonexistent file input fails closed instead of widening to workspace root', async () => {
        const workspaceRoot = tempWorkspace();
        const core: any = {
            config: { workspaceRoot },
            findDefinition: async () => ({ data: [], performance: {}, requestId: 'unused', timestamp: Date.now() }),
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Anything', file: 'missing.ts', position: { line: 0, character: 0 } }),
        });

        expect(response.status).toBe(400);
        expect(response.body).toContain('does not exist');
    });

    test('HTTP virtual file placeholders do not throw URL-host errors', async () => {
        const workspaceRoot = tempWorkspace();
        const calls: any[] = [];
        const core: any = {
            config: { workspaceRoot },
            findDefinition: async (req: any) => {
                calls.push(req);
                return { data: [], performance: {}, requestId: 'ok', timestamp: Date.now() };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                identifier: 'Anything',
                uri: 'file://workspace',
                position: { line: 0, character: 0 },
            }),
        });

        expect(response.status).toBe(200);
        expect(calls[0].uri).toContain(workspaceRoot);
    });

    test('propose_patch validates subsequent patches against the current staged snapshot state', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const snap = parseContent(await mcp.handleToolCall('get_snapshot', { preferExisting: false })).snapshot;
            const first =
                'diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
            const staleSecond =
                'diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 3;\n';
            expect(
                parseContent(await mcp.handleToolCall('propose_patch', { snapshot: snap, patch: first })).accepted
            ).toBe(true);
            const res = await mcp.handleToolCall('propose_patch', { snapshot: snap, patch: staleSecond });
            const out = parseContent(res);
            expect(res.isError).toBe(true);
            expect(out.accepted).toBe(false);
            expect(String(out.message)).toContain('invalid_patch');
        });
    });

    test('LSP identifier extraction uses synchronized in-memory content', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'sample.ts');
        writeFileSync(target, 'const DiskName = 1;\n', 'utf8');
        const seen: any[] = [];
        const core: any = {
            initialize: async () => {},
            findDefinitionAsync: async (req: any) => {
                seen.push(req);
                return { data: [] };
            },
            findReferencesAsync: async () => ({ data: [] }),
            prepareRename: async () => ({ data: null }),
            rename: async () => ({ data: { changes: {} } }),
            getCompletions: async () => ({ data: [] }),
            trackFileChange: async () => {},
            getDiagnostics: () => ({}),
            config: { workspaceRoot },
        };
        const adapter = new LSPAdapter(core, { workspaceRoot });
        const uri = pathToFileURL(target).href;

        await adapter.handleDidChangeTextDocument({
            textDocument: { uri },
            contentChanges: [{ text: 'const MemoryName = 1;\n' }],
        });
        await adapter.findDefinition(target, { line: 0, character: 8 });

        expect(seen[0].identifier).toBe('MemoryName');
    });

    test('LSP ranged incremental changes update full-document cache and close clears cached text', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'sample.ts');
        writeFileSync(target, 'const DiskName = 1;\n', 'utf8');
        const seen: any[] = [];
        const core: any = {
            initialize: async () => {},
            findDefinitionAsync: async (req: any) => {
                seen.push(req);
                return { data: [] };
            },
            findReferencesAsync: async () => ({ data: [] }),
            prepareRename: async () => ({ data: null }),
            rename: async () => ({ data: { changes: {} } }),
            getCompletions: async () => ({ data: [] }),
            trackFileChange: async () => {},
            getDiagnostics: () => ({}),
            config: { workspaceRoot },
        };
        const adapter = new LSPAdapter(core, { workspaceRoot });
        const uri = pathToFileURL(target).href;

        await adapter.handleDidChangeTextDocument({
            textDocument: { uri },
            contentChanges: [{ text: 'const MemoryName = 1;\n' }],
        });
        await adapter.handleDidChangeTextDocument({
            textDocument: { uri },
            contentChanges: [
                { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 16 } }, text: 'Partial' },
            ],
        });
        await adapter.findDefinition(target, { line: 0, character: 8 });
        await adapter.handleDidCloseTextDocument({ textDocument: { uri } });
        await adapter.findDefinition(target, { line: 0, character: 8 });

        expect(seen[0].identifier).toBe('Partial');
        expect(seen[1].identifier).toBe('DiskName');
    });

    test('unified analyzer fixed-string search handles escaped symbol characters', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'sample.ts');
        writeFileSync(target, 'export const $foo = 1;\nconsole.log($foo);\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const result = await analyzer.findDefinitionAsync({
                uri: pathToFileURL(target).href,
                position: { line: 0, character: 14 },
                identifier: '$foo',
                maxResults: 10,
                includeDeclaration: true,
                precise: true,
            } as any);
            expect(result.data.length).toBeGreaterThan(0);
            expect(result.data[0].name).toBe('$foo');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('LSP identifier extraction does not read or delegate outside-workspace file URIs', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-lsp-outside-');
        const outsideFile = join(outsideRoot, 'outside.ts');
        writeFileSync(outsideFile, 'const OutsideLspSecret = 1;\n', 'utf8');
        const seen: any[] = [];
        const core: any = {
            initialize: async () => {},
            findDefinitionAsync: async (req: any) => {
                seen.push(req);
                return { data: [] };
            },
            findReferencesAsync: async () => ({ data: [] }),
            prepareRename: async () => ({ data: null }),
            rename: async () => ({ data: { changes: {} } }),
            getCompletions: async () => ({ data: [] }),
            trackFileChange: async () => {},
            getDiagnostics: () => ({}),
            config: { workspaceRoot },
        };
        const adapter = new LSPAdapter(core, { workspaceRoot });

        const result = await adapter.findDefinition(outsideFile, { line: 0, character: 8 });
        expect(result).toEqual([]);
        expect(seen).toEqual([]);
    });

    test('LSP completion does not delegate outside-workspace file URIs', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-lsp-completion-outside-');
        const outsideFile = join(outsideRoot, 'outside.ts');
        writeFileSync(outsideFile, 'const OutsideCompletionSecret = 1;\n', 'utf8');
        const seen: any[] = [];
        const core: any = {
            prepareRename: async () => ({ data: null }),
            rename: async () => ({ data: { changes: {} } }),
            getCompletions: async (req: any) => {
                seen.push(req);
                return { data: [] };
            },
            trackFileChange: async () => {},
            getDiagnostics: () => ({}),
            config: { workspaceRoot },
        };
        const adapter = new LSPAdapter(core, { workspaceRoot });

        const result = await adapter.handleCompletion({
            textDocument: { uri: pathToFileURL(outsideFile).href },
            position: { line: 0, character: 8 },
        } as any);

        expect(result).toEqual([]);
        expect(seen).toEqual([]);
    });

    test('LSP completion allows cached unsaved in-workspace documents', async () => {
        const workspaceRoot = tempWorkspace();
        const unsavedFile = join(workspaceRoot, 'unsaved.ts');
        const uri = pathToFileURL(unsavedFile).href;
        const seen: any[] = [];
        const core: any = {
            prepareRename: async () => ({ data: null }),
            rename: async () => ({ data: { changes: {} } }),
            getCompletions: async (req: any) => {
                seen.push(req);
                return { data: [] };
            },
            trackFileChange: async () => {},
            getDiagnostics: () => ({}),
            config: { workspaceRoot },
        };
        const adapter = new LSPAdapter(core, { workspaceRoot });

        await adapter.handleDidChangeTextDocument({
            textDocument: { uri },
            contentChanges: [{ text: 'const UnsavedCompletionName = 1;\n' }],
        });
        const result = await adapter.handleCompletion({
            textDocument: { uri },
            position: { line: 0, character: 8 },
        } as any);

        expect(result).toEqual([]);
        expect(seen).toHaveLength(1);
        expect(seen[0].uri).toBe(uri);
    });

    test('snapshot patching ignores its own persisted artifacts in fresh target repos', async () => {
        const workspaceRoot = tempWorkspace();
        initGitWorkspace(workspaceRoot);
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snapshot = (await service.getSnapshot({ preferExisting: false })).payload.snapshot;
        const patch =
            'diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..1269488\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n';

        const result = await service.proposePatch({ snapshot, patch });

        expect(result.isError).not.toBe(true);
        expect(result.payload).toMatchObject({ accepted: true, snapshot });
    });

    test('snapshot fingerprints do not follow untracked symlink targets outside the workspace', () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-symlink-outside-');
        initGitWorkspace(workspaceRoot, { ignoreOntology: true });
        const outside = join(outsideRoot, 'secret.txt');
        writeFileSync(outside, 'secret-v1\n', 'utf8');
        symlinkSync(outside, join(workspaceRoot, 'link-secret'));

        const store = new OverlayStore();
        const first = store.createSnapshot(false, { workspaceRoot }).baseFingerprint;
        writeFileSync(outside, 'secret-v2\n', 'utf8');
        const second = store.createSnapshot(false, { workspaceRoot }).baseFingerprint;

        expect(second).toBe(first);
    });

    test('run_checks rejects check workspaces containing outbound symlinks', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-check-outside-');
        initGitWorkspace(workspaceRoot, { ignoreOntology: true });
        writeFileSync(join(outsideRoot, 'secret.txt'), 'outside-secret\n', 'utf8');
        symlinkSync(outsideRoot, join(workspaceRoot, 'linkout'), 'dir');

        const store = new OverlayStore();
        const snapshot = store.createSnapshot(false, { workspaceRoot });
        const result = await store.runChecks(snapshot.id, ['true'], 5, { workspaceRoot });

        expect(result.ok).toBe(false);
        expect(result.output).toContain('symlink escape');
        expect(result.output).not.toContain('outside-secret');
    });

    test('apply_after_checks ok reflects apply failure, not just check success', async () => {
        const workspaceRoot = tempWorkspace();
        initGitWorkspace(workspaceRoot, { ignoreOntology: true });
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const patch =
            'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-base\n+changed\n';
        const previousAllow = process.env.ALLOW_SNAPSHOT_APPLY;
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        try {
            const result = await service.applyAfterChecks({
                patch,
                commands: ['true'],
                timeoutSec: 5,
                reverse: true,
                apply: true,
            });
            expect(result.payload).toMatchObject({ ok: false, applied: false });
        } finally {
            if (previousAllow === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
            else process.env.ALLOW_SNAPSHOT_APPLY = previousAllow;
        }
    });

    test('apply_after_checks requires explicit per-call apply intent even when env guard is set', async () => {
        const workspaceRoot = tempWorkspace();
        initGitWorkspace(workspaceRoot, { ignoreOntology: true });
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const patch =
            'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-base\n+changed\n';
        const previousAllow = process.env.ALLOW_SNAPSHOT_APPLY;
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        try {
            const result = await service.applyAfterChecks({ patch, commands: ['true'], timeoutSec: 5 });
            expect(result.payload).toMatchObject({ ok: false, applied: false, reason: 'apply_not_requested' });
            expect(readFileSync(join(workspaceRoot, 'README.md'), 'utf8')).toBe('base\n');
        } finally {
            if (previousAllow === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
            else process.env.ALLOW_SNAPSHOT_APPLY = previousAllow;
        }
    });

    test('validationPlan selected commands reflect actual run_checks receipts after touched-file injection', async () => {
        const workspaceRoot = tempWorkspace();
        initGitWorkspace(workspaceRoot, { ignoreOntology: true });
        writeFileSync(join(workspaceRoot, 'a.ts'), 'export const x = 1;\n', 'utf8');
        runGit(workspaceRoot, ['add', '.']);
        runGit(workspaceRoot, ['commit', '-q', '-m', 'add-ts']);
        const fakeBin = join(tempWorkspace('sci-fake-bin-'), 'bin');
        mkdirSync(fakeBin, { recursive: true });
        writeFileSync(join(fakeBin, 'bunx'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
        chmodSync(join(fakeBin, 'bunx'), 0o755);
        const previousPath = process.env.PATH;
        process.env.PATH = `${fakeBin}:${previousPath || ''}`;
        try {
            const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
            const patch =
                'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-export const x = 1;\n+export const x = 2;\n';
            const result = await service.patchChecksInSnapshot({
                patch,
                commands: ['true'],
                onlyTouched: true,
                timeoutSec: 5,
            });
            const payload: any = result.payload;
            expect(payload.checks.commands[0].command).toContain('bunx tsgo');
            expect(payload.validationPlan.commands.selected[0]).toContain('bunx tsgo');
            expect(payload.validationPlan.commands.requested).toEqual(['true']);
        } finally {
            if (previousPath === undefined) delete process.env.PATH;
            else process.env.PATH = previousPath;
        }
    });

    test('snapshot text_search defaults to the materialized snapshot root', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'a.txt'), 'needle\n', 'utf8');
        const snapshotService = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snapshot = (await snapshotService.getSnapshot({ preferExisting: false })).payload.snapshot;
        const queryService = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: { initialize: async () => {} },
            pathInputFromToolFile: (value, root) => workspaceInputToPath(value, root),
        });

        const result = await queryService.textSearch({ query: 'needle', snapshot });

        expect(result.isError).toBe(false);
        expect(result.payload.count).toBeGreaterThan(0);
    });

    test('multi-diff same-file snapshots apply, verify, and roll back as a squashed change', async () => {
        const workspaceRoot = tempWorkspace();
        initGitWorkspace(workspaceRoot, { ignoreOntology: true });
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snapshot = (await service.getSnapshot({ preferExisting: false })).payload.snapshot;
        const first =
            'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-base\n+middle\n';
        const second =
            'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-middle\n+final\n';
        const previousAllow = process.env.ALLOW_SNAPSHOT_APPLY;
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        try {
            expect((await service.proposePatch({ snapshot, patch: first })).payload).toMatchObject({ accepted: true });
            expect((await service.proposePatch({ snapshot, patch: second })).payload).toMatchObject({ accepted: true });
            expect((await service.applySnapshot({ snapshot, check: false })).payload).toMatchObject({ ok: true });
            expect(await Bun.file(join(workspaceRoot, 'README.md')).text()).toBe('final\n');
            const verification = await service.verifyAppliedSnapshotDiff(snapshot);
            expect(verification.appliedDiffMatchesSnapshot).toBe(true);
            expect(verification.diagnostics.fileContentsMatch).toBe(true);
            expect((await service.applySnapshot({ snapshot, check: false, reverse: true })).payload).toMatchObject({
                ok: true,
            });
            expect(await Bun.file(join(workspaceRoot, 'README.md')).text()).toBe('base\n');
        } finally {
            if (previousAllow === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
            else process.env.ALLOW_SNAPSHOT_APPLY = previousAllow;
        }
    });

    test('applied snapshot verification accounts for newly added untracked files', async () => {
        const workspaceRoot = tempWorkspace();
        initGitWorkspace(workspaceRoot, { ignoreOntology: true });
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snapshot = (await service.getSnapshot({ preferExisting: false })).payload.snapshot;
        const patch =
            'diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..1269488\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n';
        const previousAllow = process.env.ALLOW_SNAPSHOT_APPLY;
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        try {
            expect((await service.proposePatch({ snapshot, patch })).payload).toMatchObject({ accepted: true });
            expect((await service.applySnapshot({ snapshot, check: false })).payload).toMatchObject({ ok: true });
            const verification = await service.verifyAppliedSnapshotDiff(snapshot);
            expect(verification.appliedDiffMatchesSnapshot).toBe(true);
            expect(verification.diagnostics.untrackedAddedFiles).toContain('new.txt');
        } finally {
            if (previousAllow === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
            else process.env.ALLOW_SNAPSHOT_APPLY = previousAllow;
        }
    });

    test('HTTP definition separates client position errors from untyped core failures', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'const Target = 1;\n', 'utf8');
        const okCore = {
            config: { workspaceRoot },
            findDefinition: async () => ({ data: [], performance: {}, timestamp: Date.now(), cacheHit: false }),
            sharedServices: {},
        } as any;
        const badPosition = await new HTTPAdapter(okCore, { enableCors: false, enableOpenAPI: false }).handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Target', file: 'sample.ts', position: { row: 'nope' } }),
        });
        expect(badPosition.status).toBe(400);
        expect(JSON.parse(badPosition.body).details?.code).toBe('InvalidParams');

        const adapter = new HTTPAdapter(
            {
                config: { workspaceRoot },
                findDefinition: async () => {
                    throw new Error('boom');
                },
                sharedServices: {},
            } as any,
            { enableCors: false, enableOpenAPI: false }
        );

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Target', file: 'sample.ts', position: { line: 0, character: 6 } }),
        });

        expect(response.status).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ success: false, error: 'Internal server error' });
    });

    test('HTTP stream search rejects outside paths before opening the SSE stream', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-outside-');
        const adapter = new HTTPAdapter(
            {
                config: { workspaceRoot },
                async initialize() {},
                sharedServices: {},
            } as any,
            { enableCors: false, enableOpenAPI: false }
        );

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/stream/search',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pattern: 'needle', path: outsideRoot, maxResults: 5 }),
        });

        expect(response.status).toBe(400);
        expect(typeof response.body).toBe('string');
        expect(response.body).toContain('workspace');
    });

    test('HTTP stream search uses bounded search rather than definition lookup', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'const haystack = "needle";\n', 'utf8');
        const adapter = new HTTPAdapter(
            {
                config: { workspaceRoot },
                async initialize() {},
                findDefinitionAsync: async () => {
                    throw new Error('definition lookup should not be used for stream search');
                },
                sharedServices: {},
            } as any,
            { enableCors: false, enableOpenAPI: false }
        );

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/stream/search',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pattern: 'needle', path: '.', maxResults: 5 }),
        });

        expect(response.status).toBe(200);
        expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined();
        const bodyText = await httpResponseBodyText(response.body);
        expect(bodyText).toContain('event: search-data');
        expect(bodyText).toContain('needle');
    });

    test('HTTP and LSP adapters enforce configured operation timeouts', async () => {
        const workspaceRoot = tempWorkspace();
        const file = join(workspaceRoot, 'sample.ts');
        writeFileSync(file, 'const SlowName = 1;\n', 'utf8');
        const slow = () =>
            new Promise((resolve) =>
                setTimeout(() => resolve({ data: [], performance: {}, timestamp: Date.now(), cacheHit: false }), 30)
            );
        const http = new HTTPAdapter({ config: { workspaceRoot }, findDefinition: slow, sharedServices: {} } as any, {
            enableCors: false,
            enableOpenAPI: false,
            timeout: 1,
        });

        const httpResponse = await http.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'SlowName', file: 'sample.ts', position: { line: 0, character: 6 } }),
        });
        expect(httpResponse.status).toBe(500);
        expect(JSON.parse(httpResponse.body).details?.message).toContain('timed out');

        const lsp = new LSPAdapter(
            {
                config: { workspaceRoot },
                findDefinitionAsync: slow,
                trackFileChange: async () => {},
                getDiagnostics: () => ({}),
            } as any,
            { workspaceRoot, timeout: 1 }
        );
        await expect(
            lsp.handleDefinition({
                textDocument: { uri: pathToFileURL(file).href },
                position: { line: 0, character: 7 },
            } as any)
        ).rejects.toThrow('timed out');
    });

    test('HTTP rename reports client input failures as bad requests', async () => {
        const adapter = new HTTPAdapter({
            config: { workspaceRoot: process.cwd() },
            rename: async () => ({ data: { changes: {} }, performance: {}, requestId: 'rename-should-not-run' }),
            sharedServices: {},
        } as any);

        const missing = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/rename',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'OnlyOldName' }),
        });
        expect(missing.status).toBe(400);
        expect(JSON.parse(missing.body)).toMatchObject({ success: false, error: 'Bad Request' });

        const malformed = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/rename',
            headers: { 'content-type': 'application/json' },
            body: '{not-json',
        });
        expect(malformed.status).toBe(400);
        expect(JSON.parse(malformed.body)).toMatchObject({ success: false, error: 'Bad Request' });
        expect(JSON.parse(malformed.body).details?.message).toBe('Invalid JSON');
    });

    test('rename file-position overload resolves the actual identifier instead of a placeholder', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'sample.ts');
        writeFileSync(target, 'export const oldName = 1;\nconsole.log(oldName);\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const result = await analyzer.rename(pathToFileURL(target).href, { line: 0, character: 14 }, 'newName');
            expect(Object.keys(result.changes)).toContain(pathToFileURL(target).href);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('rename file-position overload handles dollar-prefixed JavaScript identifiers', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'sample.ts');
        writeFileSync(target, 'export const $oldName = 1;\nconsole.log($oldName);\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const result = await analyzer.rename(pathToFileURL(target).href, { line: 0, character: 14 }, '$newName');
            expect(Object.keys(result.changes)).toContain(pathToFileURL(target).href);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('rename file-position overload rejects outside-workspace files', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-outside-');
        const outside = join(outsideRoot, 'outside.ts');
        writeFileSync(outside, 'export const OutsideName = 1;\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            await expect(
                analyzer.rename(pathToFileURL(outside).href, { line: 0, character: 14 }, 'newName')
            ).rejects.toThrow('must stay within the workspace');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('astOnly definition search does not fall back to unvalidated text hits', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'target.ts'), '// TargetOnlyInComment is not a declaration\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const result = await analyzer.findDefinitionAsync({
                identifier: 'TargetOnlyInComment',
                uri: 'file://workspace',
                position: { line: 0, character: 3 },
                astOnly: true,
                precise: true,
                maxResults: 10,
            } as any);
            expect(result.data).toEqual([]);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('workspace-wide symbol map candidate scan includes non-TypeScript supported files', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'target.py'), 'def target_symbol():\n    return 1\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const result = await analyzer.buildSymbolMap({
                identifier: 'target_symbol',
                uri: 'file://workspace',
                maxFiles: 10,
            });
            expect(result.files).toBe(1);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('symbol map parsing preserves file paths containing colons', async () => {
        const workspaceRoot = tempWorkspace('sci:colon-');
        writeFileSync(join(workspaceRoot, 'a.ts'), "import { Foo } from './b';\nexport const Foo = 1;\n", 'utf8');
        writeFileSync(join(workspaceRoot, 'b.ts'), 'export const Other = 1;\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ ...createDefaultCoreConfig(), workspaceRoot });
        await analyzer.initialize();
        try {
            const result = await analyzer.buildSymbolMap({ identifier: 'Foo', uri: 'file://workspace', maxFiles: 10 });
            expect(result.imports.some((entry: any) => entry.uri.includes('sci:colon-'))).toBe(true);
            expect(result.imports.some((entry: any) => entry.uri.endsWith('/a.ts'))).toBe(true);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('ontology storage adapters share malformed Thing location rejection', async () => {
        const triple = new TripleStoreStorageAdapter();
        await triple.initialize();
        await triple.upsertThing({ id: 'bad', kind: ThingKind.Type } as any);
        expect(await triple.loadAllThings()).toHaveLength(0);

        const queries: any[] = [];
        const pg = new PostgresStorageAdapter() as any;
        pg.connected = true;
        pg.client = {
            query: async (sql: string, params?: any[]) => {
                queries.push({ sql, params });
                return {
                    rows: [
                        { id: 'bad', kind: ThingKind.Type, location_uri: null, location_range: null },
                        {
                            id: 'good',
                            kind: ThingKind.Type,
                            location_uri: pathToFileURL(join(process.cwd(), 'good.ts')).href,
                            location_range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                            confidence: 0.7,
                            first_seen: 1,
                            last_seen: 1,
                            occurrences: 1,
                        },
                    ],
                };
            },
        };
        await pg.upsertThing({ id: 'bad', kind: ThingKind.Type } as any);
        expect(queries).toHaveLength(0);
        const loaded = await pg.loadAllThings();
        expect(loaded.map((thing: any) => thing.id)).toEqual(['good']);
    });

    test('HTTP rename preserves internal failures as server errors', async () => {
        const adapter = new HTTPAdapter({
            config: { workspaceRoot: process.cwd() },
            rename: async () => {
                throw new Error('rename exploded');
            },
            sharedServices: {},
        } as any);

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/rename',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'OldName', newName: 'NewName' }),
        });

        expect(response.status).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ success: false, error: 'Rename failed' });
    });
});
