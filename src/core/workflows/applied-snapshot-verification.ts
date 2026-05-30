import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../overlay-store.js';

async function readRegularFileNoFollow(
    filePath: string
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
    const stat = await fs.lstat(filePath).catch(() => null);
    if (!stat) return { ok: false, reason: 'missing' };
    if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, reason: 'not_regular_file' };
    const noFollow = typeof nodeFs.constants.O_NOFOLLOW === 'number' ? nodeFs.constants.O_NOFOLLOW : 0;
    const handle = await fs.open(filePath, nodeFs.constants.O_RDONLY | noFollow).catch(() => null);
    if (!handle) return { ok: false, reason: 'open_failed' };
    try {
        return { ok: true, text: await handle.readFile('utf8') };
    } finally {
        await handle.close();
    }
}

export async function verifyAppliedSnapshotDiff(
    snapshot: string,
    workspaceRoot: string
): Promise<{
    appliedDiffMatchesSnapshot: boolean;
    method: string;
    diagnostics: Record<string, unknown>;
}> {
    const method = 'materialized_content_and_reverse_check_vs_snapshot_overlay';
    try {
        const existingDiff = (overlayStore as any).getExistingMaterializedDiffPath?.bind(overlayStore);
        const currentMaterializedDiffFile = existingDiff ? existingDiff(snapshot, { workspaceRoot }) : null;
        const overlayDiffFile =
            currentMaterializedDiffFile ??
            path.resolve(workspaceRoot, '.ontology', 'snapshots', snapshot, 'overlay.diff');
        const squashedDiffFile = path.join(path.dirname(overlayDiffFile), 'squashed-overlay.diff');
        let squashedStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
        if (currentMaterializedDiffFile) {
            squashedStat = await fs.lstat(squashedDiffFile).catch(() => null);
            if (squashedStat && (!squashedStat.isFile() || squashedStat.isSymbolicLink())) {
                return {
                    appliedDiffMatchesSnapshot: false,
                    method,
                    diagnostics: {
                        reason: 'snapshot_squashed_diff_unsafe',
                        snapshot,
                        diffFile: squashedDiffFile,
                    },
                };
            }
        }
        const diffFile = squashedStat?.isFile() ? squashedDiffFile : overlayDiffFile;
        const diffRead = await readRegularFileNoFollow(diffFile);
        if (!diffRead.ok) {
            return {
                appliedDiffMatchesSnapshot: false,
                method,
                diagnostics: {
                    reason: 'snapshot_overlay_diff_unavailable',
                    detail: diffRead.reason,
                    snapshot,
                    diffFile,
                },
            };
        }

        const overlayDiff = diffRead.text;
        const status = overlayStore.getStatus(snapshot, {
            workspaceRoot: workspaceRoot,
        });
        const touchedFiles = Array.isArray(status?.touchedFiles)
            ? status.touchedFiles.filter((file: unknown): file is string => typeof file === 'string' && file.length > 0)
            : [];
        if (touchedFiles.length === 0) {
            return {
                appliedDiffMatchesSnapshot: false,
                method,
                diagnostics: {
                    reason: 'snapshot_touched_files_unavailable',
                    snapshot,
                    diffFile,
                },
            };
        }

        const validatedTouchedFiles: string[] = [];
        for (const file of touchedFiles) {
            const absolute = path.resolve(workspaceRoot, file);
            const relative = path.relative(workspaceRoot, absolute);
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
                return {
                    appliedDiffMatchesSnapshot: false,
                    method,
                    diagnostics: {
                        reason: 'working_tree_diff_path_escape',
                        snapshot,
                        file,
                    },
                };
            }
            validatedTouchedFiles.push(relative);
        }

        const workingDiffProc = spawnSync('git', ['diff', '--no-ext-diff', '--', ...validatedTouchedFiles], {
            cwd: workspaceRoot,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        let workingDiff = String(workingDiffProc.stdout || '');
        if (workingDiffProc.status !== 0) {
            return {
                appliedDiffMatchesSnapshot: false,
                method,
                diagnostics: {
                    reason: 'working_tree_diff_failed',
                    snapshot,
                    files: validatedTouchedFiles,
                    exitCode: workingDiffProc.status,
                    stderr: String(workingDiffProc.stderr || '').slice(-2000),
                },
            };
        }

        const untrackedAddedFiles: string[] = [];
        for (const file of validatedTouchedFiles) {
            const absolute = path.resolve(workspaceRoot, file);
            const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], {
                cwd: workspaceRoot,
                stdio: 'pipe',
                encoding: 'utf8',
            });
            if (tracked.status === 0) continue;
            const stat = await fs.lstat(absolute).catch(() => null);
            if (!stat) continue;
            if (stat.isSymbolicLink()) {
                return {
                    appliedDiffMatchesSnapshot: false,
                    method,
                    diagnostics: {
                        reason: 'working_tree_untracked_symlink_unsafe',
                        snapshot,
                        file,
                    },
                };
            }
            if (!stat.isFile()) continue;
            const added = spawnSync('git', ['diff', '--no-ext-diff', '--no-index', '--', '/dev/null', file], {
                cwd: workspaceRoot,
                stdio: 'pipe',
                encoding: 'utf8',
            });
            if (added.status !== 0 && added.status !== 1) {
                return {
                    appliedDiffMatchesSnapshot: false,
                    method,
                    diagnostics: {
                        reason: 'working_tree_untracked_diff_failed',
                        snapshot,
                        file,
                        exitCode: added.status,
                        stderr: String(added.stderr || '').slice(-2000),
                    },
                };
            }
            const addedDiff = String(added.stdout || '');
            if (addedDiff) {
                untrackedAddedFiles.push(file);
                workingDiff += `${workingDiff.endsWith('\n') || !workingDiff ? '' : '\n'}${addedDiff}`;
            }
        }

        const materializedRoot = path.dirname(diffFile);
        const fileMismatches: Array<{ file: string; reason: string }> = [];
        for (const file of validatedTouchedFiles) {
            const materializedPath = path.resolve(materializedRoot, file);
            const workingPath = path.resolve(workspaceRoot, file);
            const materializedRelative = path.relative(materializedRoot, materializedPath);
            const workingRelative = path.relative(workspaceRoot, workingPath);
            if (
                !materializedRelative ||
                materializedRelative.startsWith('..') ||
                path.isAbsolute(materializedRelative) ||
                !workingRelative ||
                workingRelative.startsWith('..') ||
                path.isAbsolute(workingRelative)
            ) {
                fileMismatches.push({ file, reason: 'path_escape' });
                continue;
            }
            const [materializedStat, workingStat] = await Promise.all([
                fs.lstat(materializedPath).catch(() => null),
                fs.lstat(workingPath).catch(() => null),
            ]);
            if (!materializedStat && !workingStat) continue;
            if (!materializedStat || !workingStat) {
                fileMismatches.push({ file, reason: 'existence_mismatch' });
                continue;
            }
            if (materializedStat.isSymbolicLink() || workingStat.isSymbolicLink()) {
                if (!materializedStat.isSymbolicLink() || !workingStat.isSymbolicLink()) {
                    fileMismatches.push({ file, reason: 'symlink_type_mismatch' });
                    continue;
                }
                const [materializedLink, workingLink] = await Promise.all([
                    fs.readlink(materializedPath),
                    fs.readlink(workingPath),
                ]);
                if (materializedLink !== workingLink) fileMismatches.push({ file, reason: 'symlink_target_mismatch' });
                continue;
            }
            if (!materializedStat.isFile() || !workingStat.isFile()) {
                fileMismatches.push({ file, reason: 'file_type_mismatch' });
                continue;
            }
            const [materializedBytes, workingBytes] = await Promise.all([
                fs.readFile(materializedPath),
                fs.readFile(workingPath),
            ]);
            if (!materializedBytes.equals(workingBytes)) fileMismatches.push({ file, reason: 'content_mismatch' });
        }
        const fileContentsMatch = fileMismatches.length === 0;

        const patchId = (diff: string) => {
            const proc = spawnSync('git', ['patch-id', '--stable'], {
                cwd: workspaceRoot,
                input: diff,
                stdio: ['pipe', 'pipe', 'pipe'],
                encoding: 'utf8',
            });
            const output = `${proc.stdout || ''}${proc.stderr || ''}`;
            const ids = String(proc.stdout || '')
                .trim()
                .split(/\r?\n/)
                .map((line) => line.trim().split(/\s+/)[0])
                .filter(Boolean);
            return {
                ok: proc.status === 0 && ids.length > 0,
                ids,
                outputTail: output.slice(-2000),
            };
        };

        const overlayPatchId = patchId(overlayDiff);
        const workingPatchId = patchId(workingDiff);
        const patchIdsMatch =
            overlayPatchId.ok &&
            workingPatchId.ok &&
            overlayPatchId.ids.length === workingPatchId.ids.length &&
            overlayPatchId.ids.every((id, index) => id === workingPatchId.ids[index]);

        const reverse = spawnSync('git', ['apply', '--check', '-R', '--whitespace=nowarn'], {
            cwd: workspaceRoot,
            input: overlayDiff,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf8',
        });
        const reverseOk = reverse.status === 0;
        const exactDiffMatches = overlayPatchId.ids.length > 1 ? fileContentsMatch : patchIdsMatch;
        return {
            appliedDiffMatchesSnapshot: reverseOk && fileContentsMatch,
            method,
            diagnostics: {
                snapshot,
                diffFile,
                files: validatedTouchedFiles,
                untrackedAddedFiles,
                reverseApplyCheckOk: reverseOk,
                fileContentsMatch,
                exactDiffMatches,
                fileMismatches,
                overlayPatchIds: overlayPatchId.ids,
                workingPatchIds: workingPatchId.ids,
                patchIdsMatch,
                workingDiffBytes: Buffer.byteLength(workingDiff, 'utf8'),
                overlayDiffBytes: Buffer.byteLength(overlayDiff, 'utf8'),
                reverseCheckTail: `${reverse.stdout || ''}${reverse.stderr || ''}`.slice(-2000),
                patchIdOutputTail: !overlayPatchId.ok
                    ? overlayPatchId.outputTail
                    : !workingPatchId.ok
                      ? workingPatchId.outputTail
                      : '',
            },
        };
    } catch (error) {
        return {
            appliedDiffMatchesSnapshot: false,
            method,
            diagnostics: {
                reason: 'verification_exception',
                snapshot,
                message: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
