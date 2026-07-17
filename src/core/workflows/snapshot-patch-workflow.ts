import { overlayStore } from '../overlay-store.js';
import { verifyAppliedSnapshotDiff as verifyAppliedSnapshotDiffForWorkspace } from './applied-snapshot-verification.js';
import { applyAfterChecks as applyAfterChecksWorkflow } from './apply-after-checks-workflow.js';
import { convertApplyPatchToUnified as convertApplyPatchToUnifiedForWorkspace } from './apply-patch-converter.js';
import { classifyPatchRisk, extractFilesFromPatch } from './patch-analysis.js';
import { extractSnapshotArtifacts as extractSnapshotArtifactsForWorkspace } from './snapshot-artifact-reader.js';
import { safeWriteWorkflow } from './safe-write-workflow.js';
import { snapshotArtifactLinks } from './snapshot-artifacts.js';
import { workflowErrorResult } from './tool-result-normalizer.js';
import { buildValidationPlan, recommendChecksPayload } from './validation-plan.js';

export {
    classifyPatchRisk,
    extractFilesFromPatch,
    hasGraphImpact,
    normalizeRecommendationFiles,
} from './patch-analysis.js';
export { clampMaxBytes, snapshotArtifactLinks, truncateUtf8WholeCodePoints } from './snapshot-artifacts.js';
export { buildValidationPlan, recommendChecksPayload } from './validation-plan.js';

export type SnapshotWorkflowResult = { payload: unknown; isError?: boolean } | { text: string; isError?: boolean };

function stageFailureReason(stage: any): string {
    const message = String(stage?.message || '').toLowerCase();
    if (message.includes('no workspace files found in diff')) return 'invalid_patch';
    return 'patch_stage_failed';
}

export class SnapshotPatchWorkflowService {
    constructor(private readonly options: { workspaceRoot: () => string }) {}

    get workspaceRoot(): string {
        return this.options.workspaceRoot();
    }

    async getSnapshot(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const snap = overlayStore.createSnapshot(!!args?.preferExisting, {
            workspaceRoot: this.workspaceRoot,
        });
        return { payload: { snapshot: snap.id }, isError: false };
    }

    async extractSnapshotArtifacts(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        return extractSnapshotArtifactsForWorkspace(args, this.workspaceRoot);
    }

    async proposePatch(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const patch = String(args?.patch || '');
        const snapshot = String(args?.snapshot || '');
        if (!patch) {
            return {
                payload: {
                    code: 'InvalidParams',
                    accepted: false,
                    snapshot,
                    reason: 'missing_patch',
                    message: 'Missing patch',
                },
                isError: true,
            };
        }

        let snap: ReturnType<typeof overlayStore.ensureSnapshot>;
        try {
            snap = overlayStore.ensureSnapshot(snapshot, {
                workspaceRoot: this.workspaceRoot,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                payload: {
                    code: 'InvalidParams',
                    accepted: false,
                    snapshot,
                    reason: 'invalid_snapshot',
                    message: msg,
                },
                isError: true,
            };
        }

        try {
            const isApplyPatch = /\*\*\*\s+Begin Patch/.test(patch);
            const unified = isApplyPatch
                ? await this.convertApplyPatchToUnified(patch, { snapshotId: snap.id })
                : patch;
            const res = overlayStore.stagePatch(snap.id, unified);
            return {
                payload: {
                    ...(res.accepted ? {} : { code: 'InvalidParams' }),
                    accepted: res.accepted,
                    snapshot: snap.id,
                    ...(res.accepted
                        ? {}
                        : {
                              reason: String(res.message || '').includes('invalid_patch')
                                  ? 'invalid_patch'
                                  : 'patch_stage_failed',
                          }),
                    message: res.message,
                },
                isError: !res.accepted,
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                payload: {
                    code: 'InvalidParams',
                    accepted: false,
                    snapshot: snap.id,
                    reason: 'invalid_patch',
                    message: msg,
                },
                isError: true,
            };
        }
    }

    async convertApplyPatchToUnified(patch: string, options: { snapshotId?: string } = {}): Promise<string> {
        return convertApplyPatchToUnifiedForWorkspace(patch, {
            snapshotId: options.snapshotId,
            workspaceRoot: this.workspaceRoot,
        });
    }

    async runChecks(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const snapshot = String(args?.snapshot || '');
        if (!snapshot) {
            return workflowErrorResult('InvalidParams', 'Missing snapshot');
        }
        const cmds = Array.isArray(args?.commands) ? (args?.commands as string[]) : [];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 120;
        const onlyTouchedEnv = (process.env.FAST_STDIO_CHECKS || '').toLowerCase() === 'touched';
        const onlyTouched = typeof args?.onlyTouched === 'boolean' ? !!args.onlyTouched : onlyTouchedEnv;
        let res: any;
        try {
            res = await overlayStore.runChecks(snapshot, cmds, timeoutSec, {
                onlyTouched,
                workspaceRoot: this.workspaceRoot,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return workflowErrorResult('InvalidParams', `Invalid snapshot: ${msg}`);
        }
        return {
            payload: {
                snapshot,
                ok: res.ok,
                elapsedMs: res.elapsedMs,
                commands: res.commands || [],
                output: res.output.slice(-4000),
            },
            isError: false,
        };
    }

    async applySnapshot(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const snapshot = String(args?.snapshot || '').trim();
        const check = !!args?.check;
        const reverse = !!args?.reverse;
        if (!snapshot) {
            return workflowErrorResult('InvalidParams', 'Missing snapshot');
        }
        try {
            overlayStore.ensureSnapshot(snapshot, { workspaceRoot: this.workspaceRoot });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return workflowErrorResult('InvalidParams', `Invalid snapshot: ${msg}`);
        }
        if (!check && process.env.ALLOW_SNAPSHOT_APPLY !== '1') {
            return {
                payload: {
                    workflow: 'apply_snapshot',
                    snapshot,
                    ok: false,
                    applied: false,
                    reverse,
                    check,
                    applyGuardSatisfied: false,
                    reason: 'apply_guard_required',
                    message: 'ALLOW_SNAPSHOT_APPLY=1 required',
                    diagnostics: {
                        guard: 'ALLOW_SNAPSHOT_APPLY',
                        requiredValue: '1',
                    },
                },
                isError: false,
            };
        }
        try {
            const res = await overlayStore.applyToWorkingTree(snapshot, {
                check,
                reverse,
                workspaceRoot: this.workspaceRoot,
            });
            return {
                payload: {
                    snapshot,
                    ok: res.ok,
                    elapsedMs: res.elapsedMs,
                    output: res.output.slice(-4000),
                },
                isError: !res.ok,
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { text: `apply_snapshot failed: ${msg}`, isError: true };
        }
    }

    async patchChecksInSnapshot(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const patch = String(args?.patch || '');
        if (!patch) return { text: 'patch required', isError: true };
        const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
        const files = extractFilesFromPatch(patch);
        const impactSummary = args?.impactSummary && typeof args.impactSummary === 'object' ? args.impactSummary : null;
        const checkRecommendations =
            args?.recommendChecks === true
                ? recommendChecksPayload({
                      patch,
                      files,
                      impactSummary,
                      mode: 'minimum',
                  })
                : null;

        const requested = typeof args?.snapshot === 'string' ? String(args.snapshot).trim() : '';
        let snapId: string | undefined = requested || undefined;
        if (!snapId) {
            const snap = await this.getSnapshot({ preferExisting: false });
            snapId = (asPayload(snap)?.snapshot || asPayload(snap)?.id || asPayload(snap)?.snapshot_id) as
                | string
                | undefined;
        }
        if (!snapId) return { text: 'failed to create snapshot', isError: true };

        const stage = await this.proposePatch({ snapshot: snapId, patch });
        const staged = asPayload(stage);
        if (stage?.isError || staged?.accepted !== true) {
            const snapshotArtifacts = snapshotArtifactLinks(snapId);
            const reason = stageFailureReason(staged);
            const validationPlan = buildValidationPlan({
                workflow: 'patch_checks_in_snapshot',
                mode: 'preview_validate',
                snapshot: snapId,
                snapshotArtifacts,
                risk: classifyPatchRisk(patch),
                commands,
                checksOk: false,
                checksElapsedMs: null,
                checkCommands: [],
                checkRecommendations,
                impactSummary,
                applied: false,
                applyGuardSatisfied: false,
            });
            return {
                payload: {
                    workflow: 'patch_checks_in_snapshot',
                    ok: false,
                    reason,
                    snapshot: snapId,
                    stage: staged,
                    checkRecommendations,
                    validationPlan,
                    checks: null,
                    next_actions: ['Fix patch staging errors; checks were not run'],
                },
                isError: false,
            };
        }
        const checks = await this.runChecks({
            snapshot: snapId,
            commands,
            timeoutSec,
            ...(typeof args?.onlyTouched === 'boolean' ? { onlyTouched: !!args.onlyTouched } : {}),
        });
        const checksOut = asPayload(checks);
        const ok = !!checksOut?.ok;
        const snapshotArtifacts = snapshotArtifactLinks(snapId);
        const validationPlan = buildValidationPlan({
            workflow: 'patch_checks_in_snapshot',
            mode: 'preview_validate',
            snapshot: snapId,
            snapshotArtifacts,
            risk: classifyPatchRisk(patch),
            commands,
            checksOk: ok,
            checksElapsedMs: checksOut?.elapsedMs || null,
            checkCommands: Array.isArray(checksOut?.commands) ? checksOut.commands : [],
            checkRecommendations,
            impactSummary,
            applied: false,
            applyGuardSatisfied: false,
        });
        return {
            payload: {
                workflow: 'patch_checks_in_snapshot',
                ok,
                snapshot: snapId,
                stage: staged,
                checkRecommendations,
                validationPlan,
                checks: checksOut,
                next_actions: ok ? ['Apply patch in working tree'] : ['Review failing checks; adjust and re-run'],
            },
            isError: false,
        };
    }

    async applyAfterChecks(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        return applyAfterChecksWorkflow(args, {
            getSnapshot: (nextArgs) => this.getSnapshot(nextArgs),
            proposePatch: (nextArgs) => this.proposePatch(nextArgs),
            runChecks: (nextArgs) => this.runChecks(nextArgs),
            applySnapshot: (nextArgs) => this.applySnapshot(nextArgs),
        });
    }

    async safeWrite(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        return safeWriteWorkflow(args, {
            workspaceRoot: () => this.workspaceRoot,
            getSnapshot: (nextArgs) => this.getSnapshot(nextArgs),
            proposePatch: (nextArgs) => this.proposePatch(nextArgs),
            runChecks: (nextArgs) => this.runChecks(nextArgs),
            applySnapshot: (nextArgs) => this.applySnapshot(nextArgs),
            verifyAppliedSnapshotDiff: (snapshot) => this.verifyAppliedSnapshotDiff(snapshot),
        });
    }

    async verifyAppliedSnapshotDiff(snapshot: string): Promise<{
        appliedDiffMatchesSnapshot: boolean;
        method: string;
        diagnostics: Record<string, unknown>;
    }> {
        return verifyAppliedSnapshotDiffForWorkspace(snapshot, this.workspaceRoot);
    }
}

function asPayload(result: SnapshotWorkflowResult | undefined): any {
    if (!result) return result;
    return 'payload' in result ? result.payload : result;
}
