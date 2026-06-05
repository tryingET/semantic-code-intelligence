import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodeAnalyzer } from '../src/core/index.js';

const tempRoots: string[] = [];

function tempWorkspace(prefix = 'sci-nexus-membrane-'): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
}

afterEach(() => {
    while (tempRoots.length) {
        rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
});

describe('nexus request membrane regressions', () => {
    test('core navigation rejects missing outside file URIs instead of widening to workspace search', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'inside.ts'), 'export function InsideOnlySymbol() { return 1; }\n', 'utf8');
        const outsideRoot = tempWorkspace('sci-nexus-membrane-outside-');
        const missingOutside = join(outsideRoot, 'missing.ts');
        const analyzer = await createCodeAnalyzer({ workspaceRoot });

        try {
            await expect(
                analyzer.findDefinitionAsync({
                    uri: pathToFileURL(missingOutside).href,
                    position: { line: 0, character: 0 },
                    identifier: 'InsideOnlySymbol',
                    maxResults: 1,
                })
            ).rejects.toThrow('workspace');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('reference cache is read on repeated identical requests', async () => {
        const workspaceRoot = tempWorkspace();
        const file = join(workspaceRoot, 'refs.ts');
        writeFileSync(file, 'export function ReferenceCacheTarget() { return 1; }\nReferenceCacheTarget();\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        const request = {
            uri: pathToFileURL(file).href,
            position: { line: 0, character: 16 },
            identifier: 'ReferenceCacheTarget',
            maxResults: 5,
        };

        try {
            const first = await analyzer.findReferencesAsync(request);
            const second = await analyzer.findReferencesAsync(request);

            expect(first.cacheHit).toBe(false);
            expect(second.cacheHit).toBe(true);
            expect(second.performance.total).toBe(0);
            expect(second.data).toEqual(first.data);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('reference cache invalidates by file URI', async () => {
        const workspaceRoot = tempWorkspace();
        const file = join(workspaceRoot, 'invalidate.ts');
        const uri = pathToFileURL(file).href;
        writeFileSync(
            file,
            'export function ReferenceInvalidationTarget() { return 1; }\nReferenceInvalidationTarget();\n',
            'utf8'
        );
        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        const request = {
            uri,
            position: { line: 0, character: 16 },
            identifier: 'ReferenceInvalidationTarget',
            maxResults: 5,
        };

        try {
            const first = await analyzer.findReferencesAsync(request);
            const second = await analyzer.findReferencesAsync(request);
            await analyzer.invalidateCacheForFile(uri);
            const third = await analyzer.findReferencesAsync(request);

            expect(first.cacheHit).toBe(false);
            expect(second.cacheHit).toBe(true);
            expect(third.cacheHit).toBe(false);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('cached navigation requests still fail closed after scoped file deletion', async () => {
        const workspaceRoot = tempWorkspace();
        const file = join(workspaceRoot, 'deleted.ts');
        const uri = pathToFileURL(file).href;
        writeFileSync(
            file,
            'export function DeletedNavigationTarget() { return 1; }\nDeletedNavigationTarget();\n',
            'utf8'
        );
        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        const definitionRequest = {
            uri,
            position: { line: 0, character: 16 },
            identifier: 'DeletedNavigationTarget',
            maxResults: 5,
        };
        const referenceRequest = { ...definitionRequest };

        try {
            expect((await analyzer.findDefinitionAsync(definitionRequest)).cacheHit).toBe(false);
            expect((await analyzer.findDefinitionAsync(definitionRequest)).cacheHit).toBe(true);
            expect((await analyzer.findReferencesAsync(referenceRequest)).cacheHit).toBe(false);
            expect((await analyzer.findReferencesAsync(referenceRequest)).cacheHit).toBe(true);

            rmSync(file, { force: true });

            await expect(analyzer.findDefinitionAsync(definitionRequest)).rejects.toThrow('unavailable');
            await expect(analyzer.findReferencesAsync(referenceRequest)).rejects.toThrow('unavailable');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('file invalidation clears directory-scoped navigation cache entries', async () => {
        const workspaceRoot = tempWorkspace();
        const srcDir = join(workspaceRoot, 'src');
        const file = join(srcDir, 'target.ts');
        const directoryUri = pathToFileURL(srcDir).href;
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(file, 'export function DirectoryInvalidationTarget() { return 1; }\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        const request = {
            uri: directoryUri,
            position: { line: 0, character: 16 },
            identifier: 'DirectoryInvalidationTarget',
            maxResults: 5,
        };

        try {
            const first = await analyzer.findDefinitionAsync(request);
            const second = await analyzer.findDefinitionAsync(request);
            await analyzer.invalidateCacheForFile(pathToFileURL(file).href);
            const third = await analyzer.findDefinitionAsync(request);

            expect(first.cacheHit).toBe(false);
            expect(second.cacheHit).toBe(true);
            expect(third.cacheHit).toBe(false);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('core navigation rejects unsupported URI schemes instead of widening to workspace search', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(
            join(workspaceRoot, 'scheme.ts'),
            'export function UnsupportedSchemeTarget() { return 1; }\n',
            'utf8'
        );
        const analyzer = await createCodeAnalyzer({ workspaceRoot });

        try {
            await expect(
                analyzer.findDefinitionAsync({
                    uri: 'https://example.com/outside.ts',
                    position: { line: 0, character: 0 },
                    identifier: 'UnsupportedSchemeTarget',
                    maxResults: 1,
                })
            ).rejects.toThrow('file URI');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('core cache identity includes nested position fields through public requests', async () => {
        const workspaceRoot = tempWorkspace();
        const file = join(workspaceRoot, 'identity.ts');
        const uri = pathToFileURL(file).href;
        writeFileSync(file, 'export const CacheIdentityTarget = 1;\n', 'utf8');
        const analyzer = await createCodeAnalyzer({ workspaceRoot });

        try {
            const first = await analyzer.findDefinitionAsync({
                uri,
                position: { line: 0, character: 1 },
                identifier: 'CacheIdentityTarget',
                maxResults: 1,
            });
            const second = await analyzer.findDefinitionAsync({
                uri,
                position: { line: 0, character: 2 },
                identifier: 'CacheIdentityTarget',
                maxResults: 1,
            });
            const third = await analyzer.findDefinitionAsync({
                uri,
                position: { line: 0, character: 1 },
                identifier: 'CacheIdentityTarget',
                maxResults: 1,
            });

            expect(first.cacheHit).toBe(false);
            expect(second.cacheHit).toBe(false);
            expect(third.cacheHit).toBe(true);
        } finally {
            await analyzer.dispose?.();
        }
    });
});
