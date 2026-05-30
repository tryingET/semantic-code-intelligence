import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../overlay-store.js';
import { clampMaxBytes, truncateUtf8WholeCodePoints } from './snapshot-artifacts.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

export async function extractSnapshotArtifacts(
    args: Record<string, any>,
    workspaceRoot: string
): Promise<SnapshotWorkflowResult> {
    const snapshot = String(args?.snapshot || '').trim();
    if (!snapshot) return { text: 'snapshot required', isError: true };

    const includeContent = args?.includeContent === true;
    const maxBytes = clampMaxBytes(args?.maxBytes);
    const links = [
        { uri: `snapshot://${snapshot}/overlay.diff`, name: 'overlay.diff', mimeType: 'text/plain' },
        { uri: `snapshot://${snapshot}/status`, name: 'status', mimeType: 'application/json' },
        { uri: `snapshot://${snapshot}/progress`, name: 'progress', mimeType: 'text/plain' },
    ];
    let status: any = { id: snapshot, exists: false, diffCount: 0, createdAt: null };
    let contents: any;

    try {
        const snap = overlayStore.ensureSnapshot(snapshot, {
            workspaceRoot: workspaceRoot,
        });
        status = {
            id: snapshot,
            exists: true,
            diffCount: Array.isArray((snap as any).diffs) ? (snap as any).diffs.length : 0,
            createdAt: (snap as any).createdAt || null,
            touchedFiles: (snap as any).touchedFiles ? Array.from((snap as any).touchedFiles) : [],
            materialized: false,
        };

        const snapshotDir =
            (overlayStore as any).getSnapshotDirectory?.(snapshot, {
                workspaceRoot: workspaceRoot,
            }) || path.resolve(workspaceRoot, '.ontology', 'snapshots', snapshot);
        const materializedMarker = path.join(snapshotDir, '.materialized');
        const hasMaterializedMarker = async () => {
            try {
                const stat = await fs.lstat(materializedMarker);
                return stat.isFile() && !stat.isSymbolicLink();
            } catch {
                return false;
            }
        };

        status.materialized = await hasMaterializedMarker();
        let dir: string | null = null;
        if (includeContent) {
            const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
            dir = ensure
                ? await ensure(snapshot, { workspaceRoot })
                : status.materialized
                  ? snapshotDir
                  : null;
            status.materialized = !!dir && (await hasMaterializedMarker());
        }

        if (includeContent && dir) {
            const readBounded = async (file: string) => {
                let handle: fs.FileHandle | null = null;
                try {
                    const realDir = await fs.realpath(dir);
                    const filePath = path.join(realDir, file);
                    handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
                    const stat = await handle.stat();
                    if (!stat.isFile()) {
                        return { text: '', truncated: false };
                    }
                    const openedPath = await fs.realpath(`/proc/self/fd/${handle.fd}`).catch(() => filePath);
                    const relative = path.relative(realDir, openedPath);
                    if (relative.startsWith('..') || path.isAbsolute(relative)) {
                        return { text: '', truncated: false };
                    }
                    const text = await handle.readFile('utf8');
                    return truncateUtf8WholeCodePoints(text, maxBytes);
                } catch {
                    return { text: '', truncated: false };
                } finally {
                    await handle?.close().catch(() => undefined);
                }
            };
            contents = {
                overlayDiff: await readBounded('overlay.diff'),
                progress: await readBounded('progress.log'),
            };
        }
    } catch (error) {
        status.error = error instanceof Error ? error.message : String(error);
    }

    return {
        payload: { snapshot, links, status, contents },
        isError: !status.exists || !!status.error,
    };
}
