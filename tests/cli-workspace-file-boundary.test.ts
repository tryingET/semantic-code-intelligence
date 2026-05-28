import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const roots: string[] = [];
function tempDir(prefix: string) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    roots.push(dir);
    return dir;
}

function tempWorkspaceDir(prefix: string) {
    const parent = join(repoRoot, '.test-results');
    mkdirSync(parent, { recursive: true });
    const dir = mkdtempSync(join(parent, prefix));
    roots.push(dir);
    return dir;
}

function runCli(args: string[], cwd = repoRoot) {
    return spawnSync('bun', ['run', join(repoRoot, 'src/servers/cli.ts'), ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
    });
}

describe('CLI workspace file boundary', () => {
    test('workflow --args-file rejects files outside the detected workspace', () => {
        const outside = tempDir('sci-cli-args-outside-');
        const argsFile = join(outside, 'args.json');
        writeFileSync(argsFile, JSON.stringify({ files: ['outside.ts'], mode: 'minimum' }), 'utf8');

        const result = runCli(['workflow', 'recommend_checks', '-F', argsFile, '--json']);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('must stay within the workspace');
    });

    test('workflow --args-file accepts cwd-relative files from a nested workspace directory', () => {
        const nested = tempWorkspaceDir('sci-cli-args-inside-');
        writeFileSync(
            join(nested, 'args.json'),
            JSON.stringify({ files: ['src/servers/cli.ts'], mode: 'minimum' }),
            'utf8'
        );

        const result = runCli(['workflow', 'recommend_checks', '-F', 'args.json', '--json'], nested);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('src/servers/cli.ts');
    });

    test('symbol commands accept cwd-relative context files from a nested workspace directory', () => {
        const result = runCli(['find', 'TestClass', '-f', 'fixtures/example.ts', '--json'], join(repoRoot, 'tests'));

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('TestClass');
    });

    test('patch file options accept cwd-relative files from a nested workspace directory', () => {
        const nested = tempWorkspaceDir('sci-cli-patch-inside-');
        mkdirSync(join(nested, 'tests', 'fixtures'), { recursive: true });
        writeFileSync(
            join(nested, 'tests', 'fixtures', 'safe-write-target.md'),
            `---
type: "fixture"
---

# Safe Write Dogfood Fixture

This file is intentionally small and stable.
The safe-write dogfood harness may temporarily patch it and must restore it exactly.
`,
            'utf8'
        );
        writeFileSync(
            join(nested, 'patch.diff'),
            `diff --git a/tests/fixtures/safe-write-target.md b/tests/fixtures/safe-write-target.md
--- a/tests/fixtures/safe-write-target.md
+++ b/tests/fixtures/safe-write-target.md
@@ -4,5 +4,5 @@ type: "fixture"
${' '}
 # Safe Write Dogfood Fixture
${' '}
-This file is intentionally small and stable.
+This file is intentionally small, stable, and checked.
 The safe-write dogfood harness may temporarily patch it and must restore it exactly.
`,
            'utf8'
        );

        const patchChecks = runCli(['patch-checks-in-snapshot', '-p', 'patch.diff', '--cmd', 'true', '--json'], nested);
        expect(patchChecks.status).toBe(0);

        const proposePatch = runCli(['propose-patch', '-f', 'patch.diff', '--json'], nested);
        expect(proposePatch.status).toBe(0);
    });

    test('propose-patch accepts apply_patch format through the shared workflow conversion', () => {
        const nested = tempWorkspaceDir('sci-cli-apply-patch-');
        mkdirSync(join(nested, 'tests', 'fixtures'), { recursive: true });
        writeFileSync(
            join(nested, 'tests', 'fixtures', 'safe-write-target.md'),
            `---
type: "fixture"
---

# Safe Write Dogfood Fixture

This file is intentionally small and stable.
The safe-write dogfood harness may temporarily patch it and must restore it exactly.
`,
            'utf8'
        );
        writeFileSync(
            join(nested, 'patch.apply'),
            `*** Begin Patch
*** Update File: tests/fixtures/safe-write-target.md
@@
 # Safe Write Dogfood Fixture
${' '}
-This file is intentionally small and stable.
+This file is intentionally small, stable, and staged.
 The safe-write dogfood harness may temporarily patch it and must restore it exactly.
*** End Patch
`,
            'utf8'
        );

        const result = runCli(['propose-patch', '-f', 'patch.apply', '--json'], nested);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('"accepted": true');
    });

    test('patch-checks-in-snapshot --patch-file rejects files outside the detected workspace', () => {
        const outside = tempDir('sci-cli-patch-outside-');
        const patchFile = join(outside, 'patch.diff');
        writeFileSync(
            patchFile,
            'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-export const x = 1;\n+export const x = 2;\n',
            'utf8'
        );

        const result = runCli(['patch-checks-in-snapshot', '-p', patchFile, '--cmd', 'true', '--json']);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('must stay within the workspace');
    });
});

afterAll(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});
