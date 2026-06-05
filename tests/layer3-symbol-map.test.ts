import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodeAnalyzer } from '../src/core/index';

describe('Layer 3 - buildSymbolMap robustness', () => {
    const workspaceRoot = path.resolve(__dirname, 'fixtures');
    let analyzer: any;

    beforeAll(async () => {
        analyzer = await createCodeAnalyzer({ workspaceRoot });
        await analyzer.initialize();
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
    });

    test('does not report call sites as definitions or symbol-map declarations', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'sci-symbol-map-decls-'));
        const file = path.join(dir, 'a.ts');
        await writeFile(file, 'export function real() { return 1; }\nreal();\n', 'utf8');
        const localAnalyzer = await createCodeAnalyzer({
            workspaceRoot: dir,
            monitoring: { enabled: false } as any,
            layers: { layer5: { enabled: false } as any } as any,
        });
        try {
            const uri = pathToFileURL(file).href;
            const definitions = await localAnalyzer.findDefinitionAsync({
                uri,
                position: { line: 1, character: 0 },
                identifier: 'real',
                includeDeclaration: true,
                precise: true,
                maxResults: 10,
            } as any);
            expect(definitions.data.map((d: any) => d.range.start.line)).not.toContain(1);

            const symbolMap = await (localAnalyzer as any).buildSymbolMap({ identifier: 'real', uri, maxFiles: 5 });
            expect(symbolMap.declarations.map((d: any) => d.range.start.line)).toEqual([0]);
        } finally {
            await localAnalyzer?.dispose?.();
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('returns exports for an exported class even without parsers', async () => {
        const result = await (analyzer as any).buildSymbolMap({
            identifier: 'TestClass',
            uri: 'file://workspace',
            maxFiles: 5,
        });

        expect(result).toBeDefined();
        expect(result.identifier).toBe('TestClass');
        // At minimum, we should discover an export entry for TestClass in fixtures
        expect(Array.isArray(result.exports)).toBe(true);
        const hasExport = (result.exports || []).some((e: any) => (e.name || '').toLowerCase() === 'testclass');
        expect(hasExport).toBe(true);
    });
});
