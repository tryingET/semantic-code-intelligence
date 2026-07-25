import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStructuralEvidenceProcess } from '../src/core/workflows/structural-evidence-process.js';
import { normalizeStructuralPaths, StructuralWorkflowService } from '../src/core/workflows/structural-workflow.js';

const roots: string[] = [];
function tempWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'sci-structural-workflow-'));
    roots.push(root);
    return root;
}

afterEach(() => {
    while (roots.length) {
        const root = roots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

describe('StructuralWorkflowService', () => {
    test('builds structural diffs without MCP protocol objects', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'const value = 1;\n', 'utf8');
        const service = new StructuralWorkflowService({ workspaceRoot: () => workspaceRoot });

        const built = await service.buildStructuralDiff([
            {
                file: 'sample.ts',
                replacement: 'const renamed',
                range: { byteOffset: { start: 0, end: 'const value'.length } },
            },
        ]);

        expect(built.files).toEqual(['sample.ts']);
        expect(built.replacementCount).toBe(1);
        expect(built.diff).toContain('diff --git a/sample.ts b/sample.ts');
        expect(built.diff).toContain('-const value = 1;');
        expect(built.diff).toContain('+const renamed = 1;');
    });

    test('rejects structural diff files that escape through symlinks', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace();
        writeFileSync(join(outsideRoot, 'secret.ts'), 'const secret = 1;\n', 'utf8');
        symlinkSync(join(outsideRoot, 'secret.ts'), join(workspaceRoot, 'linked-secret.ts'));
        const service = new StructuralWorkflowService({ workspaceRoot: () => workspaceRoot });

        await expect(
            service.buildStructuralDiff([
                {
                    file: 'linked-secret.ts',
                    replacement: 'const exposed',
                    range: { byteOffset: { start: 0, end: 'const secret'.length } },
                },
            ])
        ).rejects.toThrow('workspace');
    });

    test('normalizes workspace URI structural paths before containment checks', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'const value = 1;\n', 'utf8');

        await expect(normalizeStructuralPaths(['file://workspace/sample.ts'], workspaceRoot)).resolves.toEqual([
            'sample.ts',
        ]);
    });

    test('rejects structural paths outside the configured workspace', async () => {
        const workspaceRoot = tempWorkspace();
        await expect(normalizeStructuralPaths(['../outside'], workspaceRoot)).rejects.toThrow(
            'structural path must stay within the workspace'
        );
    });

    test('rejects structural path symlinks that escape the workspace', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace();
        writeFileSync(join(outsideRoot, 'secret.ts'), 'function OutsideSecret() { return 1; }\n', 'utf8');
        symlinkSync(outsideRoot, join(workspaceRoot, 'out'));

        await expect(normalizeStructuralPaths(['out'], workspaceRoot)).rejects.toThrow(
            'structural path must stay within the workspace'
        );
    });

    test('treats option-shaped paths as operands in shared search and rewrite workflows', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, '--help.ts'), 'const optionValue = 1;\n', 'utf8');
        const service = new StructuralWorkflowService({ workspaceRoot: () => workspaceRoot });

        const searched = await service.structuralSearch({
            language: 'ts',
            pattern: 'const $A = $B',
            paths: ['--help.ts'],
        });
        expect(searched.isError).toBe(false);
        expect((searched.payload as any).matches[0].file).toBe('--help.ts');

        const checked = await service.structuralPatchChecks({
            language: 'ts',
            pattern: 'const $A = $B',
            rewrite: 'let $A = $B',
            paths: ['--help.ts'],
            commands: ['true'],
            timeoutSec: 10,
            apply: false,
        });
        expect(checked.isError).toBe(false);
        expect((checked.payload as any).patch.files).toEqual(['--help.ts']);
    });

    test('kills a resistant descendant even when the direct child closes on SIGTERM', async () => {
        const workspaceRoot = tempWorkspace();
        const descendant = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
        const parent = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(
            descendant
        )}],{stdio:['ignore','ignore','ignore']});console.log(c.pid);setInterval(()=>{},1000)`;
        const startedAt = Date.now();
        const result = await runStructuralEvidenceProcess(process.execPath, ['-e', parent], {
            cwd: workspaceRoot,
            timeoutMs: 100,
            maxBuffer: 64 * 1024,
            terminationGraceMs: 100,
            terminationDeadlineMs: 1_000,
        });

        expect(Date.now() - startedAt).toBeLessThan(1_500);
        expect(result.timedOut).toBe(true);
        expect(result.terminationConfirmed).toBe(true);
        const descendantPid = Number(result.stdout.trim());
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        expect(() => process.kill(descendantPid, 0)).toThrow();
    });

    test('supervises a same-group descendant left behind by a successful direct child', async () => {
        const workspaceRoot = tempWorkspace();
        const descendant = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
        const parent = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(
            descendant
        )}],{stdio:['ignore','ignore','ignore']});console.log(c.pid);c.unref()`;
        const result = await runStructuralEvidenceProcess(process.execPath, ['-e', parent], {
            cwd: workspaceRoot,
            timeoutMs: 2_000,
            maxBuffer: 64 * 1024,
            terminationGraceMs: 100,
            terminationDeadlineMs: 1_000,
        });

        expect(result.status).toBe(0);
        expect(result.timedOut).toBe(false);
        expect(result.terminationConfirmed).toBe(true);
        const descendantPid = Number(result.stdout.trim());
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        expect(() => process.kill(descendantPid, 0)).toThrow();
    });

    test('returns an unconfirmed result within the hard termination deadline when the tree probe persists', async () => {
        const workspaceRoot = tempWorkspace();
        const startedAt = Date.now();
        const result = await runStructuralEvidenceProcess(
            process.execPath,
            ['-e', 'setInterval(()=>{},1000)'],
            {
                cwd: workspaceRoot,
                timeoutMs: 20,
                maxBuffer: 64 * 1024,
                terminationGraceMs: 25,
                terminationDeadlineMs: 100,
            },
            { processTreeExists: () => true }
        );

        expect(Date.now() - startedAt).toBeLessThan(500);
        expect(result.timedOut).toBe(true);
        expect(result.terminationConfirmed).toBe(false);
        expect(result.stderr).toContain('termination was not confirmed within 100ms');
    });
});
