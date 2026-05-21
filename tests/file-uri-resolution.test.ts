/**
 * File URI and configured-workspace resolution coverage for MCP navigation.
 *
 * These tests guard the embedded-host case where an MCPAdapter is constructed
 * with an analyzer for a target workspace while the process cwd remains SCI's
 * own repo. In that posture, find_definition must not search or report
 * incidental symbols from the adapter process cwd.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CodeAnalyzer } from '../src/core/unified-analyzer';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { AnalyzerFactory } from '../src/core/analyzer-factory';

describe('File URI Resolution', () => {
    let analyzer: CodeAnalyzer;
    let mcpAdapter: MCPAdapter;
    let testDir: string;

    beforeAll(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-file-uri-resolution-'));

        await fs.writeFile(
            path.join(testDir, 'async-grep.ts'),
            `export class AsyncEnhancedGrep {
  constructor() {}
  async search(pattern: string) {
    return [];
  }
}
`
        );

        await fs.writeFile(
            path.join(testDir, 'user.ts'),
            `import { AsyncEnhancedGrep } from './async-grep';
const grep = new AsyncEnhancedGrep();
`
        );

        const created = await AnalyzerFactory.createWorkspaceAnalyzer(testDir, undefined);
        analyzer = created.analyzer;
        mcpAdapter = new MCPAdapter(analyzer);
    });

    afterAll(async () => {
        await (analyzer as any)?.dispose?.().catch(() => undefined);
        if (testDir) await fs.rm(testDir, { recursive: true, force: true });
    });

    async function callToolJson(name: string, args: Record<string, unknown>) {
        const result = await mcpAdapter.handleToolCall(name, args);
        expect(result.isError).toBe(false);
        const text = result.content?.[0]?.text || '{}';
        return JSON.parse(text);
    }

    async function callDefinition(args: Record<string, unknown>) {
        return callToolJson('find_definition', args);
    }

    test('uses the analyzer configured workspace for direct MCP read and search calls', async () => {
        const read = await callToolJson('read_file', { path: 'async-grep.ts' });
        expect(read.path).toBe('async-grep.ts');
        expect(read.content).toContain('export class AsyncEnhancedGrep');

        const search = await callToolJson('text_search', { query: 'AsyncEnhancedGrep', path: '.', maxResults: 10 });
        expect(search.count).toBeGreaterThan(0);
        const files = (search.results || []).map((item: any) => String(item.file || ''));
        expect(files.some((file: string) => file.includes('async-grep.ts'))).toBe(true);
        expect(files.every((file: string) => file.includes(testDir))).toBe(true);
    });

    test('discovers definitions in the analyzer configured workspace when no file context is provided', async () => {
        const payload = await callDefinition({ symbol: 'AsyncEnhancedGrep' });

        expect(payload.definitions).toBeDefined();
        expect(payload.definitions.length).toBeGreaterThan(0);
        expect(payload.definitions[0].uri).toMatch(/^file:\/\//);
        expect(payload.definitions[0].uri).toContain('async-grep.ts');
        expect(payload.definitions[0].uri).toContain(testDir);
        expect(payload.definitions[0].uri).not.toContain('tests/file-uri-resolution.test.ts');
        expect(payload.definitions[0].uri).not.toBe('file://unknown');
    });

    test('uses caller-provided workspace-contained file context without falling back to process cwd', async () => {
        const payload = await callDefinition({
            symbol: 'AsyncEnhancedGrep',
            file: path.join(testDir, 'user.ts'),
        });

        expect(payload.count).toBeGreaterThan(0);
        expect(payload.definitions[0].uri).toContain('async-grep.ts');
        expect(payload.definitions[0].uri).toContain(testDir);
        expect(payload.definitions[0].uri).not.toBe('file://unknown');
    });

    test('returns a structured empty result when the symbol is absent', async () => {
        const payload = await callDefinition({
            symbol: 'NonExistentSymbol',
            file: path.join(testDir, 'user.ts'),
            precise: true,
        });

        expect(payload.definitions || []).toEqual([]);
        expect(payload.count).toBe(0);
    });

    test('filters invalid or unknown core definition URIs instead of returning file://unknown', async () => {
        const result = await analyzer.findDefinition({
            uri: 'file://unknown',
            position: { line: 0, character: 0 },
            identifier: 'SomeSymbol',
        } as any);

        const definitions = Array.isArray((result as any).data) ? (result as any).data : (result as any).definitions || [];
        for (const def of definitions) {
            expect(def.uri).toMatch(/^file:\/\//);
            expect(def.uri).not.toBe('file://unknown');
        }
    });

    test('rejects caller-controlled file contexts outside the configured workspace', async () => {
        const outsideFile = path.join(os.tmpdir(), `sci-outside-${Date.now()}.ts`);
        await fs.writeFile(outsideFile, 'export class AsyncEnhancedGrep {}\n');
        try {
            const result = await mcpAdapter.handleToolCall('find_definition', {
                symbol: 'AsyncEnhancedGrep',
                file: outsideFile,
            });

            expect(result.isError).toBe(true);
            const text = String(result.content?.[0]?.text || '');
            expect(text).toContain('workspace');
            expect(text).not.toContain('export class AsyncEnhancedGrep');
        } finally {
            await fs.rm(outsideFile, { force: true });
        }
    });

    test('exposes stable symbol-locator results inside the configured workspace', async () => {
        const locator = (analyzer as any).getSymbolLocator?.() || analyzer;
        const locations = (await locator.locateSymbol?.('AsyncEnhancedGrep')) || [];

        expect(locations.length).toBeGreaterThan(0);
        expect(locations[0].uri).toContain('async-grep.ts');
        expect(locations[0].uri).toContain(testDir);
    });
});
