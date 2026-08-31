import * as fs from 'node:fs';
import { constants } from 'node:fs';
import * as path from 'node:path';
import type { SnapshotRefV1 } from './snapshot-ref.js';
import { isSnapshotRefV1, sameSnapshotRef, snapshotOverlayDigest, snapshotReferenceError } from './snapshot-ref.js';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const READ_NOFOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export type SnapshotRevisionArtifact = {
    snapshotRef: SnapshotRefV1;
    touchedFiles: string[];
    overlayDiff: string;
};

export function persistSnapshotRevision(args: {
    snapshotDirectory: string;
    snapshotRef: SnapshotRefV1;
    touchedFiles: readonly string[];
    diffs: readonly string[];
}): void {
    const revisions = ensureDirectory(path.join(args.snapshotDirectory, 'revisions'));
    const finalDirectory = path.join(revisions, String(args.snapshotRef.revision));
    const overlayDiff = args.diffs.join('\n');
    const manifest = `${JSON.stringify(
        {
            schema: 'semantic-code-intelligence.snapshot_revision.v1',
            snapshotRef: args.snapshotRef,
            touchedFiles: [...args.touchedFiles].sort(),
            diffs: [...args.diffs],
        },
        null,
        2
    )}\n`;

    if (fs.existsSync(finalDirectory)) {
        const existing = readSnapshotRevision(args.snapshotDirectory, args.snapshotRef.revision);
        if (
            !sameSnapshotRef(existing.snapshotRef, args.snapshotRef) ||
            existing.overlayDiff !== overlayDiff ||
            JSON.stringify(existing.touchedFiles) !== JSON.stringify([...args.touchedFiles].sort())
        ) {
            throw snapshotReferenceError('stale_snapshot_ref');
        }
        return;
    }

    const temporary = path.join(
        revisions,
        `.revision-${args.snapshotRef.revision}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );
    try {
        fs.mkdirSync(temporary, { mode: DIRECTORY_MODE });
        writeFileExclusive(path.join(temporary, 'manifest.json'), manifest);
        writeFileExclusive(path.join(temporary, 'overlay.diff'), overlayDiff);
        syncDirectory(temporary);
        fs.renameSync(temporary, finalDirectory);
        syncDirectory(revisions);
    } catch (error: any) {
        if (error?.code === 'EEXIST' && fs.existsSync(finalDirectory)) {
            const existing = readSnapshotRevision(args.snapshotDirectory, args.snapshotRef.revision);
            if (
                sameSnapshotRef(existing.snapshotRef, args.snapshotRef) &&
                existing.overlayDiff === overlayDiff &&
                JSON.stringify(existing.touchedFiles) === JSON.stringify([...args.touchedFiles].sort())
            ) {
                return;
            }
        }
        throw error;
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

export function readSnapshotRevision(snapshotDirectory: string, revision: number): SnapshotRevisionArtifact {
    if (!Number.isSafeInteger(revision) || revision < 0) throw snapshotReferenceError('stale_snapshot_ref');
    const revisions = assertDirectory(path.join(snapshotDirectory, 'revisions'));
    const directory = assertDirectory(path.join(revisions, String(revision)));
    const manifest = readFileNoFollow(path.join(directory, 'manifest.json'));
    const overlayDiff = readFileNoFollow(path.join(directory, 'overlay.diff'));
    let value: any;
    try {
        value = JSON.parse(manifest);
    } catch {
        throw snapshotReferenceError('stale_snapshot_ref');
    }
    if (
        value?.schema !== 'semantic-code-intelligence.snapshot_revision.v1' ||
        !isSnapshotRefV1(value?.snapshotRef) ||
        !Array.isArray(value?.touchedFiles) ||
        !value.touchedFiles.every((item: unknown) => typeof item === 'string') ||
        !Array.isArray(value?.diffs) ||
        !value.diffs.every((item: unknown) => typeof item === 'string') ||
        value.diffs.join('\n') !== overlayDiff ||
        snapshotOverlayDigest(
            value.snapshotRef.workspaceId,
            value.snapshotRef.snapshotId,
            value.snapshotRef.revision,
            value.diffs
        ) !== value.snapshotRef.overlayDigest
    ) {
        throw snapshotReferenceError('stale_snapshot_ref');
    }
    return { snapshotRef: value.snapshotRef, touchedFiles: value.touchedFiles, overlayDiff };
}

function ensureDirectory(directory: string): string {
    try {
        fs.mkdirSync(directory, { mode: DIRECTORY_MODE });
    } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
    }
    return assertDirectory(directory);
}

function assertDirectory(directory: string): string {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw snapshotReferenceError('stale_snapshot_ref');
    return fs.realpathSync(directory);
}

function writeFileExclusive(file: string, content: string): void {
    const fd = fs.openSync(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        FILE_MODE
    );
    try {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

function readFileNoFollow(file: string): string {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw snapshotReferenceError('stale_snapshot_ref');
    const fd = fs.openSync(file, READ_NOFOLLOW);
    try {
        return fs.readFileSync(fd, 'utf8');
    } finally {
        fs.closeSync(fd);
    }
}

function syncDirectory(directory: string): void {
    const fd = fs.openSync(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}
