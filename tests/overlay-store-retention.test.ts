import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OverlayStore } from '../src/core/overlay-store.js';

const roots: string[] = [];
const savedEnv = new Map<string, string | undefined>();
const originalDateNow = Date.now;
const originalCwd = process.cwd();
const envKeys = [
    'SCI_SNAPSHOT_AUTO_CLEANUP',
    'SCI_SNAPSHOT_MAX_KEEP',
    'SCI_SNAPSHOT_MAX_AGE_MS',
    'SCI_SNAPSHOT_MAX_AGE_DAYS',
    'SCI_SNAPSHOT_CLEANUP_INTERVAL_MS',
    'SCI_SNAPSHOT_CLEANUP_EVERY',
];

function rememberEnv() {
    for (const key of envKeys) {
        if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    }
}

function restoreEnv() {
    for (const key of envKeys) {
        const value = savedEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    savedEnv.clear();
}

function tempWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-overlay-retention-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
    return root;
}

function snapshotRoot(workspaceRoot: string): string {
    return join(workspaceRoot, '.ontology', 'snapshots');
}

function snapshotDirs(workspaceRoot: string): string[] {
    return readdirSync(snapshotRoot(workspaceRoot), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
}

afterEach(() => {
    process.chdir(originalCwd);
    Date.now = originalDateNow;
    restoreEnv();
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('OverlayStore snapshot retention', () => {
    test('auto-cleanup bounds snapshot count during creation', () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_MAX_KEEP = '2';
        process.env.SCI_SNAPSHOT_MAX_AGE_MS = String(24 * 60 * 60 * 1000);
        process.env.SCI_SNAPSHOT_CLEANUP_INTERVAL_MS = String(24 * 60 * 60 * 1000);
        process.env.SCI_SNAPSHOT_CLEANUP_EVERY = '25';

        const workspaceRoot = tempWorkspace();
        const store = new OverlayStore();
        for (let i = 0; i < 5; i++) store.createSnapshot(false, { workspaceRoot });

        expect(snapshotDirs(workspaceRoot)).toHaveLength(2);
    });

    test('auto-cleanup can be disabled for diagnostic retention', () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '0';
        process.env.SCI_SNAPSHOT_MAX_KEEP = '2';

        const workspaceRoot = tempWorkspace();
        const store = new OverlayStore();
        for (let i = 0; i < 5; i++) store.createSnapshot(false, { workspaceRoot });

        expect(snapshotDirs(workspaceRoot)).toHaveLength(5);
    });

    test('returned snapshot remains persisted and usable when creation timestamps tie', () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_MAX_KEEP = '2';
        process.env.SCI_SNAPSHOT_CLEANUP_INTERVAL_MS = '0';
        process.env.SCI_SNAPSHOT_CLEANUP_EVERY = '1';
        Date.now = () => 1_700_000_000_000;

        const workspaceRoot = tempWorkspace();
        const store = new OverlayStore();
        store.createSnapshot(false, { workspaceRoot });
        store.createSnapshot(false, { workspaceRoot });
        const latest = store.createSnapshot(false, { workspaceRoot });

        expect(snapshotDirs(workspaceRoot)).toHaveLength(2);
        expect(existsSync(join(snapshotRoot(workspaceRoot), latest.id, 'metadata.json'))).toBe(true);
        expect(store.ensureSnapshot(latest.id, { workspaceRoot }).id).toBe(latest.id);
    });

    test('cleanup throttling and count bounds are isolated by explicit workspace', () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_MAX_KEEP = '2';
        process.env.SCI_SNAPSHOT_CLEANUP_INTERVAL_MS = String(24 * 60 * 60 * 1000);
        process.env.SCI_SNAPSHOT_CLEANUP_EVERY = '25';

        const workspaceA = tempWorkspace();
        const workspaceB = tempWorkspace();
        const store = new OverlayStore();
        for (let i = 0; i < 5; i++) store.createSnapshot(false, { workspaceRoot: workspaceA });
        for (let i = 0; i < 5; i++) store.createSnapshot(false, { workspaceRoot: workspaceB });

        expect(snapshotDirs(workspaceA)).toHaveLength(2);
        expect(snapshotDirs(workspaceB)).toHaveLength(2);
    });

    test('implicit workspace cleanup cannot delete explicit snapshots from another workspace', () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '0';
        process.env.SCI_SNAPSHOT_MAX_KEEP = '1';
        process.env.SCI_SNAPSHOT_CLEANUP_INTERVAL_MS = '0';
        process.env.SCI_SNAPSHOT_CLEANUP_EVERY = '1';

        const workspaceA = tempWorkspace();
        const workspaceB = tempWorkspace();
        const store = new OverlayStore();
        store.createSnapshot(false, { workspaceRoot: workspaceB });
        store.createSnapshot(false, { workspaceRoot: workspaceB });
        expect(snapshotDirs(workspaceB)).toHaveLength(2);

        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '1';
        process.chdir(workspaceA);
        store.createSnapshot(false);

        expect(snapshotDirs(workspaceA)).toHaveLength(1);
        expect(snapshotDirs(workspaceB)).toHaveLength(2);
    });

    test('auto-cleanup preserves a snapshot with an active materialization lock', () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '0';
        const workspaceRoot = tempWorkspace();
        const store = new OverlayStore();
        const locked = store.createSnapshot(false, { workspaceRoot });
        const lockDir = join(snapshotRoot(workspaceRoot), `${locked.id}.lock`);
        mkdirSync(lockDir);
        writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid }), 'utf8');
        utimesSync(lockDir, new Date(0), new Date(0));

        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '1';
        process.env.SCI_SNAPSHOT_MAX_KEEP = '1';
        process.env.SCI_SNAPSHOT_CLEANUP_INTERVAL_MS = '0';
        process.env.SCI_SNAPSHOT_CLEANUP_EVERY = '1';
        store.createSnapshot(false, { workspaceRoot });

        expect(existsSync(lockDir)).toBe(true);
        expect(existsSync(join(snapshotRoot(workspaceRoot), locked.id, 'metadata.json'))).toBe(true);
        expect(store.ensureSnapshot(locked.id, { workspaceRoot }).id).toBe(locked.id);
    });

    test('auto-cleanup removes an abandoned stale lock and resumes retention', () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '0';
        const workspaceRoot = tempWorkspace();
        const store = new OverlayStore();
        const stale = store.createSnapshot(false, { workspaceRoot });
        const lockDir = join(snapshotRoot(workspaceRoot), `${stale.id}.lock`);
        mkdirSync(lockDir);
        utimesSync(lockDir, new Date(0), new Date(0));

        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '1';
        process.env.SCI_SNAPSHOT_MAX_KEEP = '1';
        process.env.SCI_SNAPSHOT_CLEANUP_INTERVAL_MS = '0';
        process.env.SCI_SNAPSHOT_CLEANUP_EVERY = '1';
        store.createSnapshot(false, { workspaceRoot });

        expect(existsSync(lockDir)).toBe(false);
        expect(snapshotDirs(workspaceRoot)).toHaveLength(1);
        expect(existsSync(join(snapshotRoot(workspaceRoot), stale.id))).toBe(false);
    });

    test('manual cleanup removes stale transient workspaces without touching current snapshots', async () => {
        rememberEnv();
        process.env.SCI_SNAPSHOT_AUTO_CLEANUP = '0';
        const workspaceRoot = tempWorkspace();
        const store = new OverlayStore();
        const snap = store.createSnapshot(false, { workspaceRoot });
        const transient = join(snapshotRoot(workspaceRoot), `.${snap.id}.1.1.tmp`);
        mkdirSync(transient);
        utimesSync(transient, new Date(0), new Date(0));

        await store.cleanup(25, 1_000, { workspaceRoot });

        expect(existsSync(transient)).toBe(false);
        expect(store.ensureSnapshot(snap.id, { workspaceRoot }).id).toBe(snap.id);
    });
});
