import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    copyFileSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    defaultCaptureCommand,
    runRepositoryCloseoutReceipt,
    type CloseoutDependencies,
} from '../scripts/repository-closeout-receipt';

function git(cwd: string, args: string[]): Buffer {
    const result = spawnSync('git', args, { cwd, encoding: 'buffer' });
    expect(result.status, result.stderr.toString()).toBe(0);
    return result.stdout;
}

function fixture(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sci-repository-closeout-'));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync('scripts/git-tree-fingerprint.sh', join(dir, 'scripts/git-tree-fingerprint.sh'));
    chmodSync(join(dir, 'scripts/git-tree-fingerprint.sh'), 0o755);
    writeFileSync(join(dir, '.gitignore'), '.test-results/\n');
    writeFileSync(join(dir, 'tracked.txt'), 'initial\n');
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 'test@example.invalid']);
    git(dir, ['config', 'user.name', 'Test User']);
    git(dir, ['config', 'commit.gpgSign', 'false']);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'fixture']);
    return dir;
}

function writeGateLogs(stdoutPath: string, stderrPath: string, stdout = 'gate stdout\n', stderr = ''): void {
    writeFileSync(stdoutPath, stdout, { flag: 'wx', mode: 0o600 });
    writeFileSync(stderrPath, stderr, { flag: 'wx', mode: 0o600 });
}

function dependencies(runId: string, runGate: NonNullable<CloseoutDependencies['runGate']>): CloseoutDependencies {
    let tick = 0;
    return {
        runId: () => runId,
        now: () => new Date(Date.UTC(2026, 6, 25, 0, 0, tick++)),
        runGate,
    };
}

function receiptAt(dir: string, receiptPath: string): any {
    return JSON.parse(readFileSync(join(dir, receiptPath), 'utf8'));
}

function artifactBytes(dir: string, ref: { path: string }): Buffer {
    return readFileSync(join(dir, ref.path));
}

function digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

describe('repository closeout receipt', () => {
    test('preserves pre-existing dirty and rename inventory while delegating exactly once', async () => {
        const dir = fixture();
        try {
            writeFileSync(join(dir, 'tracked.txt'), 'dirty before gate\n');
            writeFileSync(join(dir, 'untracked file.txt'), 'untracked\n');
            git(dir, ['mv', 'tracked.txt', 'renamed tracked.txt']);
            let invocations = 0;
            const result = await runRepositoryCloseoutReceipt(
                dir,
                dependencies('happy', async (_cwd, stdoutPath, stderrPath) => {
                    invocations += 1;
                    writeGateLogs(stdoutPath, stderrPath, 'x'.repeat(8_500), 'y'.repeat(9_000));
                    return { exitCode: 0, signal: null, spawnError: null };
                })
            );

            expect(result.exitCode).toBe(0);
            expect(invocations).toBe(1);
            const receipt = receiptAt(dir, result.receiptPath);
            expect(receipt.schema).toBe('semantic-code-intelligence.repository_closeout_receipt.v1');
            expect(receipt.delegatedGate.invocationCount).toBe(1);
            expect(receipt.delegatedGate.status).toBe('passed');
            expect(receipt.workspaceInventory.unchanged).toBe(true);
            expect(receipt.outcome.status).toBe('passed_workspace_unchanged');
            const before = artifactBytes(dir, receipt.workspaceInventory.before.status);
            const after = artifactBytes(dir, receipt.workspaceInventory.after.status);
            expect(before.equals(after)).toBe(true);
            expect(before.includes(0)).toBe(true);
            expect(before.toString('utf8')).toContain('untracked file.txt');
            expect(before.toString('utf8')).toContain('renamed tracked.txt');
            expect(receipt.workspaceInventory.before.entryCount).toBe(2);
            expect(receipt.workspaceInventory.before.status.sha256).toBe(digest(before));
            expect(artifactBytes(dir, receipt.delegatedGate.stdoutLog).byteLength).toBe(8_500);
            expect(artifactBytes(dir, receipt.delegatedGate.stderrLog).byteLength).toBe(9_000);
            expect(receipt.authorityBoundary.observationOnly).toBe(true);
            expect(receipt.authorityBoundary.doesNotAssert).toContain('ak_task_closure');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('records a nonzero delegated gate and exits nonzero without losing logs', async () => {
        const dir = fixture();
        try {
            const result = await runRepositoryCloseoutReceipt(
                dir,
                dependencies('gate-failed', async (_cwd, stdoutPath, stderrPath) => {
                    writeGateLogs(stdoutPath, stderrPath, 'partial output', 'failure detail');
                    return { exitCode: 7, signal: null, spawnError: null };
                })
            );
            const receipt = receiptAt(dir, result.receiptPath);
            expect(result.exitCode).toBe(1);
            expect(receipt.delegatedGate.status).toBe('failed');
            expect(receipt.delegatedGate.exitCode).toBe(7);
            expect(receipt.outcome.status).toBe('gate_failed');
            expect(artifactBytes(dir, receipt.delegatedGate.stderrLog).toString()).toBe('failure detail');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('detects content mutation even when porcelain status shape is unchanged', async () => {
        const dir = fixture();
        try {
            writeFileSync(join(dir, 'tracked.txt'), 'dirty version one\n');
            const result = await runRepositoryCloseoutReceipt(
                dir,
                dependencies('workspace-mutated', async (_cwd, stdoutPath, stderrPath) => {
                    writeFileSync(join(dir, 'tracked.txt'), 'dirty version two\n');
                    writeGateLogs(stdoutPath, stderrPath);
                    return { exitCode: 0, signal: null, spawnError: null };
                })
            );
            const receipt = receiptAt(dir, result.receiptPath);
            expect(receipt.workspaceInventory.before.status.sha256).toBe(
                receipt.workspaceInventory.after.status.sha256
            );
            expect(receipt.workspaceInventory.before.contentFingerprint).not.toBe(
                receipt.workspaceInventory.after.contentFingerprint
            );
            expect(receipt.workspaceInventory.unchanged).toBe(false);
            expect(receipt.outcome.status).toBe('workspace_changed');
            expect(result.exitCode).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails closed for observation and gate spawn failures while still materializing receipts', async () => {
        const observationDir = fixture();
        const spawnDir = fixture();
        try {
            const observation = await runRepositoryCloseoutReceipt(observationDir, {
                ...dependencies('observation-failed', async () => {
                    throw new Error('gate must not run');
                }),
                captureCommand: async (command, args, cwd) => {
                    if (command === 'scripts/git-tree-fingerprint.sh') {
                        return {
                            exitCode: 9,
                            signal: null,
                            stdout: Buffer.alloc(0),
                            stderr: Buffer.from('fingerprint unavailable'),
                            spawnError: null,
                        };
                    }
                    return defaultCaptureCommand(command, args, cwd);
                },
            });
            const observationReceipt = receiptAt(observationDir, observation.receiptPath);
            expect(observation.exitCode).toBe(1);
            expect(observationReceipt.delegatedGate.invocationCount).toBe(0);
            expect(observationReceipt.delegatedGate.status).toBe('not_run');
            expect(observationReceipt.outcome.status).toBe('observation_failed');
            expect(observationReceipt.workspaceInventory.errors.length).toBeGreaterThan(0);

            const spawnFailure = await runRepositoryCloseoutReceipt(
                spawnDir,
                dependencies('spawn-failed', async (_cwd, stdoutPath, stderrPath) => {
                    writeGateLogs(stdoutPath, stderrPath);
                    return { exitCode: null, signal: null, spawnError: 'ENOENT' };
                })
            );
            const spawnReceipt = receiptAt(spawnDir, spawnFailure.receiptPath);
            expect(spawnReceipt.delegatedGate.invocationCount).toBe(1);
            expect(spawnReceipt.delegatedGate.status).toBe('spawn_failed');
            expect(spawnReceipt.outcome.status).toBe('gate_failed');
        } finally {
            rmSync(observationDir, { recursive: true, force: true });
            rmSync(spawnDir, { recursive: true, force: true });
        }
    });

    test('fails closed when the real fingerprint helper masks a poisoned git diff exit', async () => {
        const dir = fixture();
        const originalPath = process.env.PATH ?? '';
        let gateInvocations = 0;
        try {
            const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
            const poisonBin = join(dir, 'poison-bin');
            mkdirSync(poisonBin);
            const poisonGit = join(poisonBin, 'git');
            writeFileSync(
                poisonGit,
                `#!/usr/bin/env bash\nif [[ "\${1:-}" == "diff" && "\${2:-}" == "--binary" ]]; then\n  printf 'fatal: poisoned git diff\\n' >&2\n  exit 86\nfi\nexec ${JSON.stringify(realGit)} "$@"\n`
            );
            chmodSync(poisonGit, 0o755);
            process.env.PATH = `${poisonBin}:${originalPath}`;

            const maskedFailure = await defaultCaptureCommand('scripts/git-tree-fingerprint.sh', [], dir);
            expect(maskedFailure.exitCode).toBe(0);
            expect(maskedFailure.stdout.toString('utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
            expect(maskedFailure.stderr.toString('utf8')).toContain('fatal: poisoned git diff');

            const result = await runRepositoryCloseoutReceipt(
                dir,
                dependencies('poisoned-git-diff', async (_cwd, stdoutPath, stderrPath) => {
                    gateInvocations += 1;
                    writeGateLogs(stdoutPath, stderrPath);
                    return { exitCode: 0, signal: null, spawnError: null };
                })
            );
            const receipt = receiptAt(dir, result.receiptPath);
            expect(result.exitCode).toBe(1);
            expect(gateInvocations).toBe(0);
            expect(receipt.delegatedGate.invocationCount).toBe(0);
            expect(receipt.outcome.status).toBe('observation_failed');
            expect(receipt.workspaceInventory.before.contentFingerprint).toBeNull();
            expect(receipt.workspaceInventory.errors.join('\n')).toContain('fatal: poisoned git diff');
        } finally {
            process.env.PATH = originalPath;
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('uses unique atomic run directories, restrictive files, and rejects symlinked evidence roots', async () => {
        const dir = fixture();
        const symlinkDir = fixture();
        const outside = mkdtempSync(join(tmpdir(), 'sci-closeout-outside-'));
        try {
            const deps = dependencies('same-run', async (_cwd, stdoutPath, stderrPath) => {
                writeGateLogs(stdoutPath, stderrPath);
                return { exitCode: 0, signal: null, spawnError: null };
            });
            const first = await runRepositoryCloseoutReceipt(dir, deps);
            const second = await runRepositoryCloseoutReceipt(dir, deps);
            expect(first.receiptPath).not.toBe(second.receiptPath);
            for (const receiptPath of [first.receiptPath, second.receiptPath]) {
                const runDirectory = join(dir, receiptPath, '..');
                expect(lstatSync(join(dir, receiptPath)).mode & 0o777).toBe(0o600);
                expect(readdirSync(runDirectory).some((name) => name.endsWith('.tmp'))).toBe(false);
            }

            symlinkSync(outside, join(symlinkDir, '.test-results'));
            await expect(
                runRepositoryCloseoutReceipt(
                    symlinkDir,
                    dependencies('unsafe', async (_cwd, stdoutPath, stderrPath) => {
                        writeGateLogs(stdoutPath, stderrPath);
                        return { exitCode: 0, signal: null, spawnError: null };
                    })
                )
            ).rejects.toThrow('refusing symlinked evidence path');
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(symlinkDir, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    });
});
