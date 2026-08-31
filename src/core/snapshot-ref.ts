import { createHash } from 'node:crypto';
import { CoreError } from './errors.js';
import { isWorkspaceId, type WorkspaceId } from './workspace-ref.js';

export const SNAPSHOT_REF_SCHEMA = 'semantic-code-intelligence.snapshot_ref.v1' as const;
export const SNAPSHOT_CHECK_RECEIPT_SCHEMA = 'semantic-code-intelligence.snapshot_check_receipt.v1' as const;

const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type SnapshotRefV1 = Readonly<{
    schema: typeof SNAPSHOT_REF_SCHEMA;
    workspaceId: WorkspaceId;
    snapshotId: string;
    revision: number;
    baseDigest: `sha256:${string}`;
    overlayDigest: `sha256:${string}`;
}>;

export type SnapshotCheckReceiptV1 = Readonly<{
    schema: typeof SNAPSHOT_CHECK_RECEIPT_SCHEMA;
    workspaceId: WorkspaceId;
    snapshotId: string;
    revision: number;
    baseDigest: `sha256:${string}`;
    overlayDigest: `sha256:${string}`;
    commandsDigest: `sha256:${string}`;
    ok: boolean;
    completedAt: string;
}>;

export type SnapshotReferenceReason = 'snapshot_ref_required' | 'stale_snapshot_ref' | 'legacy_unbound_snapshot';

const MESSAGES: Record<SnapshotReferenceReason, string> = {
    snapshot_ref_required: 'An exact snapshot reference is required for this operation',
    stale_snapshot_ref: 'The snapshot reference is not the current immutable revision',
    legacy_unbound_snapshot: 'The snapshot predates workspace-bound revision semantics',
};

const REMEDIATION: Record<SnapshotReferenceReason, string> = {
    snapshot_ref_required: 'Use the complete snapshot reference returned by the preceding NEXUS operation.',
    stale_snapshot_ref: 'Restart from the current snapshot reference and rerun checks before apply.',
    legacy_unbound_snapshot: 'Create a fresh workspace-bound snapshot instead of continuing the legacy snapshot.',
};

export function snapshotReferenceError(reason: SnapshotReferenceReason): CoreError {
    return new CoreError('InvalidParams', MESSAGES[reason], { reason, remediation: REMEDIATION[reason] });
}

export function isSnapshotRefV1(value: unknown): value is SnapshotRefV1 {
    const record = plainRecord(value);
    return (
        !!record &&
        hasExactKeys(record, ['schema', 'workspaceId', 'snapshotId', 'revision', 'baseDigest', 'overlayDigest']) &&
        record.schema === SNAPSHOT_REF_SCHEMA &&
        isWorkspaceId(record.workspaceId) &&
        typeof record.snapshotId === 'string' &&
        SNAPSHOT_ID_PATTERN.test(record.snapshotId) &&
        Number.isSafeInteger(record.revision) &&
        Number(record.revision) >= 0 &&
        typeof record.baseDigest === 'string' &&
        DIGEST_PATTERN.test(record.baseDigest) &&
        typeof record.overlayDigest === 'string' &&
        DIGEST_PATTERN.test(record.overlayDigest)
    );
}

export function assertSnapshotRef(value: unknown, current: SnapshotRefV1): SnapshotRefV1 {
    if (value === undefined || value === null) throw snapshotReferenceError('snapshot_ref_required');
    if (!isSnapshotRefV1(value) || !sameSnapshotRef(value, current)) {
        throw snapshotReferenceError('stale_snapshot_ref');
    }
    return value;
}

export function sameSnapshotRef(left: SnapshotRefV1, right: SnapshotRefV1): boolean {
    return (
        left.workspaceId === right.workspaceId &&
        left.snapshotId === right.snapshotId &&
        left.revision === right.revision &&
        left.baseDigest === right.baseDigest &&
        left.overlayDigest === right.overlayDigest
    );
}

export function createSnapshotRef(args: {
    workspaceId: WorkspaceId;
    snapshotId: string;
    revision: number;
    baseFingerprint: string;
    diffs: readonly string[];
}): SnapshotRefV1 {
    const baseDigest = snapshotBaseDigest(args.workspaceId, args.baseFingerprint);
    return Object.freeze({
        schema: SNAPSHOT_REF_SCHEMA,
        workspaceId: args.workspaceId,
        snapshotId: args.snapshotId,
        revision: args.revision,
        baseDigest,
        overlayDigest: snapshotOverlayDigest(args.workspaceId, args.snapshotId, args.revision, args.diffs),
    });
}

export function snapshotBaseDigest(workspaceId: WorkspaceId, baseFingerprint: string): `sha256:${string}` {
    return digestStrings(['snapshot-base-v1', workspaceId, baseFingerprint]);
}

export function snapshotOverlayDigest(
    workspaceId: WorkspaceId,
    snapshotId: string,
    revision: number,
    diffs: readonly string[]
): `sha256:${string}` {
    const parts = ['snapshot-overlay-v1', workspaceId, snapshotId, String(revision)];
    for (const diff of diffs) parts.push(String(Buffer.byteLength(diff, 'utf8')), diff);
    return digestStrings(parts);
}

export function createSnapshotCheckReceipt(
    snapshot: SnapshotRefV1,
    commands: readonly string[],
    ok: boolean
): SnapshotCheckReceiptV1 {
    return Object.freeze({
        schema: SNAPSHOT_CHECK_RECEIPT_SCHEMA,
        workspaceId: snapshot.workspaceId,
        snapshotId: snapshot.snapshotId,
        revision: snapshot.revision,
        baseDigest: snapshot.baseDigest,
        overlayDigest: snapshot.overlayDigest,
        commandsDigest: digestStrings(['snapshot-check-commands-v1', ...commands]),
        ok,
        completedAt: new Date().toISOString(),
    });
}

export function isSnapshotCheckReceiptV1(value: unknown): value is SnapshotCheckReceiptV1 {
    const record = plainRecord(value);
    return (
        !!record &&
        hasExactKeys(record, [
            'schema',
            'workspaceId',
            'snapshotId',
            'revision',
            'baseDigest',
            'overlayDigest',
            'commandsDigest',
            'ok',
            'completedAt',
        ]) &&
        record.schema === SNAPSHOT_CHECK_RECEIPT_SCHEMA &&
        isWorkspaceId(record.workspaceId) &&
        typeof record.snapshotId === 'string' &&
        SNAPSHOT_ID_PATTERN.test(record.snapshotId) &&
        Number.isSafeInteger(record.revision) &&
        Number(record.revision) >= 0 &&
        typeof record.baseDigest === 'string' &&
        DIGEST_PATTERN.test(record.baseDigest) &&
        typeof record.overlayDigest === 'string' &&
        DIGEST_PATTERN.test(record.overlayDigest) &&
        typeof record.commandsDigest === 'string' &&
        DIGEST_PATTERN.test(record.commandsDigest) &&
        typeof record.ok === 'boolean' &&
        typeof record.completedAt === 'string'
    );
}

export function checkReceiptMatchesSnapshot(
    receipt: SnapshotCheckReceiptV1 | undefined,
    snapshot: SnapshotRefV1
): boolean {
    return Boolean(
        receipt &&
            receipt.ok &&
            receipt.workspaceId === snapshot.workspaceId &&
            receipt.snapshotId === snapshot.snapshotId &&
            receipt.revision === snapshot.revision &&
            receipt.baseDigest === snapshot.baseDigest &&
            receipt.overlayDigest === snapshot.overlayDigest
    );
}

function digestStrings(parts: readonly string[]): `sha256:${string}` {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(String(Buffer.byteLength(part, 'utf8')));
        hash.update('\0');
        hash.update(part);
        hash.update('\0');
    }
    return `sha256:${hash.digest('hex')}`;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : undefined;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
