import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../overlay-store.js';

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
        const overlayDiffFile = existingDiff
            ? existingDiff(snapshot, { workspaceRoot })
            : path.resolve(workspaceRoot, '.ontology', 'snapshots', snapshot, 'overlay.diff');
        const squashedDiffFile = path.join(path.dirname(overlayDiffFile), 'squashed-overlay.diff');
        const squashedStat = await fs.stat(squashedDiffFile).catch(() => null);
        const diffFile = squashedStat?.isFile() ? squashedDiffFile : overlayDiffFile;
        const diffStat = await fs.stat(diffFile).catch(() => null);
        if (!diffStat?.isFile()) {
            return {
                appliedDiffMatchesSnapshot: false,
                method,
                diagnostics: {
                    reason: 'snapshot_overlay_diff_unavailable',
                    snapshot,
                    diffFile,
                },
            };
        }

        const overlayDiff = await fs.readFile(diffFile, 'utf8');
        const status = overlayStore.getStatus(snapshot, {
            workspaceRoot: workspaceRoot,
        });
        const touchedFiles = Array.isArray(status?.touchedFiles)
            ? status.touchedFiles.filter(
                  (file: unknown): file is string => typeof file === 'string' && file.length > 0
              )
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

        const workingDiffProc = spawnSync('git', ['diff', '--no-ext-diff', '--', ...touchedFiles], {
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
                    files: touchedFiles,
                    exitCode: workingDiffProc.status,
                    stderr: String(workingDiffProc.stderr || '').slice(-2000),
                },
            };
        }

        const untrackedAddedFiles: string[] = [];
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
            const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], {
                cwd: workspaceRoot,
                stdio: 'pipe',
                encoding: 'utf8',
            });
            if (tracked.status === 0) continue;
            const stat = await fs.stat(absolute).catch(() => null);
            if (!stat?.isFile()) continue;
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
        for (const file of touchedFiles) {
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
                if (materializedLink !== workingLink)
                    fileMismatches.push({ file, reason: 'symlink_target_mismatch' });
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

        const reverse = spawnSync('git', ['apply', '--check', '-R', '--whitespace=nowarn', diffFile], {
            cwd: workspaceRoot,
            stdio: 'pipe',
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
                files: touchedFiles,
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
