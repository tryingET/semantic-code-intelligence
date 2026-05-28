import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OverlayStore } from '../src/core/overlay-store';
import { runAstQuery } from '../src/core/ast-query';
import { fallbackScanForDefinition, scanForExplicitDeclaration } from '../src/core/workflows/navigation-workflow';

const roots: string[] = [];

function tempWorkspace(prefix = 'sci-nexus-membrane-') {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('nexus contract membrane regressions', () => {
    test('snapshot patches reject reserved workspace control paths before tool fallback can apply them', () => {
        const workspaceRoot = tempWorkspace();
        mkdirSync(join(workspaceRoot, '.git'));
        writeFileSync(join(workspaceRoot, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n', 'utf8');
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot });
        const patch = [
            'diff --git a/.git/config b/.git/config',
            '--- a/.git/config',
            '+++ b/.git/config',
            '@@ -1,2 +1,3 @@',
            ' [core]',
            ' \trepositoryformatversion = 0',
            '+\tbare = false',
            '',
        ].join('\n');

        const result = store.stagePatch(snap.id, patch);

        expect(result.accepted).toBe(false);
        expect(String(result.message || '')).toContain('reserved workspace control path');
    });

    test('snapshot patches reject materialized snapshot artifact name collisions', () => {
        const workspaceRoot = tempWorkspace();
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot });
        const patch = [
            'diff --git a/metadata.json b/metadata.json',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/metadata.json',
            '@@ -0,0 +1 @@',
            '+{"user":"expected"}',
            '',
        ].join('\n');

        const result = store.stagePatch(snap.id, patch);

        expect(result.accepted).toBe(false);
        expect(String(result.message || '')).toContain('reserved snapshot artifact name');
    });

    test('ast_query limit caps results without truncating file discovery first', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'empty.ts'), 'export const noMatch = 1;\n', 'utf8');
        writeFileSync(join(workspaceRoot, 'has.ts'), 'function target() { return 1; }\nfunction second() { return 2; }\n', 'utf8');

        const skippedFirstFile = await runAstQuery({
            language: 'typescript',
            query: '(function_declaration name: (identifier) @name)',
            paths: ['empty.ts', 'has.ts'],
            limit: 1,
            workspaceRoot,
        });
        const manyCaptures = await runAstQuery({
            language: 'typescript',
            query: '(identifier) @id',
            paths: ['has.ts'],
            limit: 1,
            workspaceRoot,
        });

        expect(skippedFirstFile.count).toBe(1);
        expect(skippedFirstFile.results[0]?.file).toBe('has.ts');
        expect(manyCaptures.count).toBe(1);
    });

    test('find_definition explicit declaration regex treats symbol text literally', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'function fooXbar() { return 1; }\n', 'utf8');

        await expect(scanForExplicitDeclaration(workspaceRoot, 'foo(')).resolves.toBeNull();
        const dotSymbol = await scanForExplicitDeclaration(workspaceRoot, 'foo.bar');
        expect(dotSymbol).toBeNull();
    });

    test('fallback definition scan ignores prose mentions and returns declaration-shaped code hits', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'README.md'), 'ImportantSymbol is mentioned here, but this is prose.\n', 'utf8');
        writeFileSync(join(workspaceRoot, 'target.ts'), 'export const ImportantSymbol = () => 1;\n', 'utf8');

        const result = await fallbackScanForDefinition(workspaceRoot, 'ImportantSymbol', 300);

        expect(result).toHaveLength(1);
        expect(String(result[0]?.uri || '')).toContain('target.ts');
        expect(result[0]?.kind).toBe('variable');
    });
});
