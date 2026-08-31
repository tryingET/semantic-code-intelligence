import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { OverlayStore } from '../src/core/overlay-store.js';
import { type SnapshotRefV1, sameSnapshotRef } from '../src/core/snapshot-ref.js';
import { loadOrCreateWorkspaceBinding } from '../src/core/workspace-binding.js';

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function fixture(
    label: string
): Promise<{ root: string; store: OverlayStore; binding: Awaited<ReturnType<typeof loadOrCreateWorkspaceBinding>> }> {
    const root = await mkdtemp(path.join(tmpdir(), `sci-snapshot-ref-${label}-`));
    roots.push(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'sci-test@example.invalid');
    git(root, 'config', 'user.name', 'SCI Test');
    await writeFile(path.join(root, '.gitignore'), '.ontology/\n', 'utf8');
    await writeFile(path.join(root, 'target.txt'), 'one\n', 'utf8');
    git(root, 'add', '.gitignore', 'target.txt');
    git(root, 'commit', '-qm', 'fixture');
    const binding = await loadOrCreateWorkspaceBinding(root);
    return { root, store: new OverlayStore(), binding };
}

function patch(from: string, to: string): string {
    return `--- a/target.txt\n+++ b/target.txt\n@@ -1 +1 @@\n-${from}\n+${to}\n`;
}

function reason(error: unknown): string | undefined {
    return (error as any)?.data?.reason;
}

function requireSnapshotRef(value: SnapshotRefV1 | undefined): SnapshotRefV1 {
    if (!value) throw new Error('expected snapshot reference');
    return value;
}

async function expectReason(promise: Promise<unknown>, expected: string): Promise<void> {
    try {
        await promise;
        throw new Error(`expected rejection reason ${expected}`);
    } catch (error) {
        expect(reason(error)).toBe(expected);
    }
}

describe('NEXUS snapshot references', () => {
    test('persist immutable revision artifacts and reject legacy mutation of a bound snapshot', async () => {
        const { root, store, binding } = await fixture('immutable');
        const snapshot = store.createSnapshot(false, { workspaceRoot: root, workspace: binding.workspace });
        const initial = store.getSnapshotRef(snapshot.id, { workspaceRoot: root });
        expect(initial.revision).toBe(0);
        expect(store.stagePatch(snapshot.id, patch('one', 'two')).accepted).toBe(false);

        const staged = await store.stagePatchExact(initial, patch('one', 'two'), undefined, { workspaceRoot: root });
        expect(staged.accepted).toBe(true);
        expect(staged.snapshotRef?.revision).toBe(1);
        const stagedRef = requireSnapshotRef(staged.snapshotRef);
        const revisionZero = store.getSnapshotRevision(initial, { workspaceRoot: root });
        const revisionOne = store.getSnapshotRevision(stagedRef, { workspaceRoot: root });
        expect(revisionZero.overlayDiff).toBe('');
        expect(revisionOne.overlayDiff).toContain('+two');
        const immutableOverlay = path.join(
            root,
            '.ontology',
            'snapshots',
            stagedRef.snapshotId,
            'revisions',
            String(stagedRef.revision),
            'overlay.diff'
        );
        await writeFile(immutableOverlay, 'tampered\n', 'utf8');
        await expectReason(
            Promise.resolve().then(() => store.getSnapshotRevision(stagedRef, { workspaceRoot: root })),
            'stale_snapshot_ref'
        );
    });

    test('allows only one concurrent stage from the same exact revision', async () => {
        const { root, store, binding } = await fixture('concurrent-stage');
        const snapshot = store.createSnapshot(false, { workspaceRoot: root, workspace: binding.workspace });
        const initial = store.getSnapshotRef(snapshot.id, { workspaceRoot: root });
        const competingStore = new OverlayStore();
        const results = await Promise.allSettled([
            store.stagePatchExact(initial, patch('one', 'two'), undefined, { workspaceRoot: root }),
            competingStore.stagePatchExact(initial, patch('one', 'three'), undefined, { workspaceRoot: root }),
        ]);
        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const rejected = results.filter((result) => result.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((fulfilled[0] as PromiseFulfilledResult<any>).value.accepted).toBe(true);
        expect(reason((rejected[0] as PromiseRejectedResult).reason)).toBe('stale_snapshot_ref');
    });

    test('binds checks and apply to the same revision across an interleaved later stage', async () => {
        const previousUnsafeChecks = process.env.SCI_ALLOW_UNSAFE_CHECK_COMMANDS;
        process.env.SCI_ALLOW_UNSAFE_CHECK_COMMANDS = '1';
        try {
            const { root, store, binding } = await fixture('check-stage-apply');
            const snapshot = store.createSnapshot(false, { workspaceRoot: root, workspace: binding.workspace });
            const initial = store.getSnapshotRef(snapshot.id, { workspaceRoot: root });
            const firstStage = await store.stagePatchExact(initial, patch('one', 'two'), undefined, {
                workspaceRoot: root,
            });
            const revisionOne = requireSnapshotRef(firstStage.snapshotRef);
            const competingStore = new OverlayStore();

            const checkPromise = store.runChecksExact(revisionOne, ['sleep 0.15'], 5, { workspaceRoot: root });
            await new Promise((resolve) => setTimeout(resolve, 30));
            const stagePromise = competingStore.stagePatchExact(revisionOne, patch('two', 'three'), undefined, {
                workspaceRoot: root,
            });
            const checked = await checkPromise;
            const secondStage = await stagePromise;
            expect(checked.ok).toBe(true);
            expect(sameSnapshotRef(checked.snapshotRef, revisionOne)).toBe(true);
            expect(secondStage.snapshotRef?.revision).toBe(2);

            await expectReason(
                store.applyToWorkingTreeExact(checked.snapshotRef, { workspaceRoot: root }),
                'stale_snapshot_ref'
            );
            const revisionTwo = requireSnapshotRef(secondStage.snapshotRef);
            const uncheckedApply = await store.applyToWorkingTreeExact(revisionTwo, {
                workspaceRoot: root,
            });
            expect(uncheckedApply.ok).toBe(false);
            expect(uncheckedApply.output).toContain('requires passing checks');

            const currentChecks = await store.runChecksExact(revisionTwo, ['true'], 5, {
                workspaceRoot: root,
            });
            const applied = await store.applyToWorkingTreeExact(currentChecks.snapshotRef, { workspaceRoot: root });
            expect(applied.ok).toBe(true);
            expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('three\n');
        } finally {
            if (previousUnsafeChecks === undefined) delete process.env.SCI_ALLOW_UNSAFE_CHECK_COMMANDS;
            else process.env.SCI_ALLOW_UNSAFE_CHECK_COMMANDS = previousUnsafeChecks;
        }
    });

    test('quarantines legacy snapshots from exact continuation', async () => {
        const { root, store } = await fixture('legacy');
        const legacy = store.createSnapshot(false, { workspaceRoot: root });
        expect(() => store.getSnapshotRef(legacy.id, { workspaceRoot: root })).toThrow();
        await expectReason(
            Promise.resolve().then(() => store.getSnapshotRef(legacy.id, { workspaceRoot: root })),
            'legacy_unbound_snapshot'
        );
    });
});
