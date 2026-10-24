import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStructuralEvidenceProcess } from '../src/core/workflows/structural-evidence-process.js';
import { normalizeStructuralPaths, StructuralWorkflowService } from '../src/core/workflows/structural-workflow.js';

const roots: string[] = [];

function fixturePid(output: string): number {
    const text = output.trim();
    const pid = Number(text);
    if (!/^[1-9][0-9]*$/u.test(text) || !Number.isSafeInteger(pid) || pid <= 1) {
        throw new Error('invalid fixture PID');
    }
    return pid;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fixtureReady(file: string, pending: Promise<unknown>): Promise<number> {
    let settled = false;
    void pending.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        }
    );
    const deadline = Date.now() + 2_000;
    for (;;) {
        try {
            return fixturePid(readFileSync(file, 'utf8'));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (settled) throw new Error('fixture process settled before readiness');
        if (Date.now() >= deadline) throw new Error('fixture readiness deadline exceeded');
        await pause(10);
    }
}

function fixtureGone(pid: number): boolean {
    // Validate before any signal call: zero means the caller's process group.
    fixturePid(String(pid));
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
        throw error;
    }
}

async function fixtureStopped(pid: number, timeoutMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!fixtureGone(pid)) {
        if (Date.now() >= deadline) throw new Error('fixture descendant still exists');
        await pause(10);
    }
}

function resistantFixture(mode: 'timeout' | 'parent-exits' | 'setup-fails') {
    const workspaceRoot = tempWorkspace();
    const readyFile = join(workspaceRoot, 'ready.pid');
    const ownedFile = join(workspaceRoot, 'spawned.pid');
    const termFile = join(workspaceRoot, 'ignored-term');
    const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{fs.appendFileSync(${JSON.stringify(termFile)},'ignored\\n')});console.log('READY');setInterval(()=>{},1000)`;
    const parent = `
        const fs=require('node:fs');
        const {spawn}=require('node:child_process');
        const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','pipe','ignore']});
        if(!Number.isSafeInteger(child.pid)||child.pid<=1)process.exit(8);
        fs.writeFileSync(${JSON.stringify(`${ownedFile}.tmp`)},String(child.pid));
        fs.renameSync(${JSON.stringify(`${ownedFile}.tmp`)},${JSON.stringify(ownedFile)});
        let received='';
        child.stdout.on('data',chunk=>{
            received+=chunk;
            if(!received.includes('\\n'))return;
            if(received!=='READY\\n')process.exit(7);
            child.stdout.destroy();
            ${mode === 'setup-fails' ? 'process.exit(9);' : ''}
            console.log(child.pid);
            fs.writeFileSync(${JSON.stringify(`${readyFile}.tmp`)},String(child.pid));
            fs.renameSync(${JSON.stringify(`${readyFile}.tmp`)},${JSON.stringify(readyFile)});
            ${mode === 'parent-exits' ? 'child.unref();' : 'setInterval(()=>{},1000);'}
        });`;
    const start = (dependencies: Parameters<typeof runStructuralEvidenceProcess>[3] = {}) => {
        const injectedProbe = dependencies.processTreeExists;
        // Never enable a deliberately dishonest probe before an independent
        // cleanup identity exists. An earlier setup failure retains real supervision.
        const guardedDependencies = injectedProbe
            ? {
                  processTreeExists(group: number) {
                      if (existsSync(ownedFile)) return injectedProbe(group);
                      try {
                          process.kill(-group, 0);
                          return true;
                      } catch (error) {
                          return (error as NodeJS.ErrnoException).code !== 'ESRCH';
                      }
                  },
              }
            : dependencies;
        return runStructuralEvidenceProcess(
            process.execPath,
            ['-e', parent],
            {
                cwd: workspaceRoot,
                timeoutMs: 3_000,
                maxBuffer: 64 * 1024,
                terminationGraceMs: 100,
                terminationDeadlineMs: 1_000,
            },
            guardedDependencies
        );
    };
    return { readyFile, ownedFile, termFile, start };
}

async function cleanupFixture(fixture: ReturnType<typeof resistantFixture>, pending: Promise<unknown>) {
    await pending;
    let pid: number;
    try {
        pid = fixturePid(readFileSync(fixture.ownedFile, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
    await stopOwnedFixturePid(fixture, pid);
}

async function stopOwnedFixturePid(fixture: ReturnType<typeof resistantFixture>, pid: number) {
    if (fixtureGone(pid)) return;
    // The negative controls deliberately leave an owned child alive. Never
    // signal a reused Linux PID, and tolerate only independently confirmed exit races.
    if (process.platform === 'linux') {
        let command: string;
        try {
            command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fixtureGone(pid)) return;
            throw error;
        }
        if (!command.includes(fixture.termFile)) {
            if (fixtureGone(pid)) return;
            throw new Error('fixture PID no longer belongs to this test');
        }
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await fixtureStopped(pid);
}

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

    test('Scenario: missing or unsafe PID output fails fixture setup', () => {
        // Given a fixture that did not report one valid child identity
        for (const output of ['', ' ', '0', '1', '-1', '1.5', 'abc', '12\n34', '9007199254740992']) {
            // When its output is interpreted, Then PID zero and other unsafe identities are refused
            expect(() => fixturePid(output)).toThrow('fixture PID');
        }
        expect(fixturePid('42\n')).toBe(42);
    });

    test('Scenario: a ready resistant descendant is stopped after the direct child times out', async () => {
        // Given a descendant whose SIGTERM handler is installed and has announced readiness
        const fixture = resistantFixture('timeout');
        const startedAt = Date.now();
        const pending = fixture.start();
        try {
            const pid = await fixtureReady(fixture.readyFile, pending);
            // When the real execution deadline terminates its direct parent
            const result = await pending;
            // Then escalation kills the actual descendant, not PID zero or an unstarted fixture
            expect(Date.now() - startedAt).toBeLessThan(4_500);
            expect(result.timedOut).toBe(true);
            expect(result.terminationConfirmed).toBe(true);
            expect(fixturePid(result.stdout)).toBe(pid);
            expect(readFileSync(fixture.termFile, 'utf8')).toContain('ignored');
            await fixtureStopped(pid);
            expect(() => process.kill(pid, 0)).toThrow();
        } finally {
            await cleanupFixture(fixture, pending);
        }
    }, 8_000);

    test('Scenario: a ready descendant is stopped even after its parent exits successfully', async () => {
        // Given a real resistant descendant and a parent that exits only after its readiness
        const fixture = resistantFixture('parent-exits');
        const pending = fixture.start();
        try {
            const pid = await fixtureReady(fixture.readyFile, pending);
            // When the parent exits, Then successful status cannot leave that descendant running
            const result = await pending;
            expect(result.status).toBe(0);
            expect(result.timedOut).toBe(false);
            expect(result.terminationConfirmed).toBe(true);
            expect(fixturePid(result.stdout)).toBe(pid);
            expect(readFileSync(fixture.termFile, 'utf8')).toContain('ignored');
            await fixtureStopped(pid);
            expect(() => process.kill(pid, 0)).toThrow();
        } finally {
            await cleanupFixture(fixture, pending);
        }
    }, 8_000);

    test('Scenario: settling before readiness is a setup failure, not cleanup evidence', async () => {
        const missing = join(tempWorkspace(), 'never-ready');
        await expect(fixtureReady(missing, Promise.resolve())).rejects.toThrow('settled before readiness');
    });

    test('Scenario: the independent exit oracle rejects a false termination report', async () => {
        // Given a deliberately dishonest process-group probe, not changed production behavior
        const fixture = resistantFixture('parent-exits');
        const pending = fixture.start({ processTreeExists: () => false });
        try {
            const pid = await fixtureReady(fixture.readyFile, pending);
            const result = await pending;
            expect(result.terminationConfirmed).toBe(true);
            // When the reported success is checked independently, Then the live child is detected
            await expect(fixtureStopped(pid, 100)).rejects.toThrow('descendant still exists');
        } finally {
            await cleanupFixture(fixture, pending);
        }
    }, 8_000);

    test('Scenario: failed readiness still cleans the independently recorded child', async () => {
        // Given a parent that fails after spawn but before publishing readiness
        const fixture = resistantFixture('setup-fails');
        const pending = fixture.start({ processTreeExists: () => false });
        try {
            await expect(fixtureReady(fixture.readyFile, pending)).rejects.toThrow('settled before readiness');
            const result = await pending;
            const pid = fixturePid(readFileSync(fixture.ownedFile, 'utf8'));
            expect(result.status).toBe(9);
            // When teardown runs, Then the missing readiness record cannot hide the child
            await cleanupFixture(fixture, pending);
            expect(fixtureGone(pid)).toBe(true);
        } finally {
            await pending;
            if (existsSync(fixture.ownedFile)) {
                await stopOwnedFixturePid(fixture, fixturePid(readFileSync(fixture.ownedFile, 'utf8')));
            }
        }
    }, 8_000);

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
