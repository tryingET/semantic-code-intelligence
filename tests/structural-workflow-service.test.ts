import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    normalizeStructuralPaths,
    runStructuralProcess,
    StructuralWorkflowService,
} from '../src/core/workflows/structural-workflow.js';

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

    test('kills a resistant descendant even when the direct child closes on SIGTERM', async () => {
        const workspaceRoot = tempWorkspace();
        const descendant = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
        const parent = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(
            descendant
        )}],{stdio:['ignore','ignore','ignore']});console.log(c.pid);setInterval(()=>{},1000)`;
        const result = await runStructuralProcess(process.execPath, ['-e', parent], {
            cwd: workspaceRoot,
            timeoutMs: 100,
            maxBuffer: 64 * 1024,
        });

        expect(result.timedOut).toBe(true);
        const descendantPid = Number(result.stdout.trim());
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        expect(() => process.kill(descendantPid, 0)).toThrow();
    });
});
