import { classifyPatchRisk, shellQuote } from './patch-analysis.js';
import { snapshotArtifactLinks } from './snapshot-artifacts.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';
import { buildValidationPlan, recommendChecksPayload } from './validation-plan.js';

interface AppliedSnapshotVerification {
    appliedDiffMatchesSnapshot: boolean;
    method: string;
    diagnostics: Record<string, unknown>;
}

export interface SafeWriteWorkflowDependencies {
    workspaceRoot: () => string;
    getSnapshot: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    proposePatch: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    runChecks: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    applySnapshot: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    verifyAppliedSnapshotDiff: (snapshot: string) => Promise<AppliedSnapshotVerification>;
}

function stageFailureReason(stage: any): string {
    const message = String(stage?.message || '').toLowerCase();
    if (message.includes('no workspace files found in diff')) return 'invalid_patch';
    return 'patch_stage_failed';
}

function asPayload(result: SnapshotWorkflowResult | undefined): any {
    if (!result) return result;
    return 'payload' in result ? result.payload : result;
}

export async function safeWriteWorkflow(
    args: Record<string, any>,
    dependencies: SafeWriteWorkflowDependencies
): Promise<SnapshotWorkflowResult> {
    const patch = typeof args?.patch === 'string' ? args.patch : '';
    if (!patch.trim()) return { text: 'patch required', isError: true };
    const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
    const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
    const apply = args?.apply === true;
    const brief = args?.brief === true;
    const risk = classifyPatchRisk(patch);
    const impactSummary = args?.impactSummary && typeof args.impactSummary === 'object' ? args.impactSummary : null;
    const checkRecommendations =
        args?.recommendChecks === true
            ? recommendChecksPayload({
                  patch,
                  files: risk.files,
                  impactSummary,
                  mode: 'minimum',
              })
            : null;
    const requested = typeof args?.snapshot === 'string' ? String(args.snapshot).trim() : '';
    let snapshot: string | undefined = requested || undefined;
    if (!snapshot) {
        const snapRes = await dependencies.getSnapshot({ preferExisting: false });
        const snapTxt = asPayload(snapRes);
        snapshot = (snapTxt?.snapshot || snapTxt?.id) as string | undefined;
    }
    if (!snapshot) return { text: 'failed to create snapshot', isError: true };

    const stage = await dependencies.proposePatch({ snapshot, patch });
    const stageOut = asPayload(stage) || {};
    if (stage?.isError || stageOut?.accepted !== true) {
        const snapshotArtifacts = snapshotArtifactLinks(snapshot);
        const reason = stageFailureReason(stageOut);
        const verification = {
            staged: false,
            checksPassed: false,
            applyGuardSatisfied: !apply || process.env.ALLOW_SNAPSHOT_APPLY === '1',
            applied: false,
            appliedDiffMatchesSnapshot: null,
            method: null,
            diagnostics: { reason },
        };
        const validationPlan = buildValidationPlan({
            workflow: 'safe_write',
            mode: apply ? 'apply_after_checks' : 'preview_validate',
            snapshot,
            snapshotArtifacts,
            risk,
            commands,
            checksOk: false,
            checksElapsedMs: null,
            checkCommands: [],
            checkRecommendations,
            impactSummary,
            applied: false,
            applyGuardSatisfied: verification.applyGuardSatisfied,
            rollback: null,
            verification,
        });
        const payload = {
            ok: false,
            workflow: 'safe_write',
            mode: apply ? 'apply_after_checks' : 'preview_validate',
            reason,
            risk,
            snapshot,
            stage: stageOut,
            checkRecommendations,
            validationPlan,
            checks: null,
            verification,
            applied: false,
            snapshotArtifacts,
            next: 'fix patch staging errors before running checks',
            next_actions: ['Fix patch staging errors', `Open snapshot status: ${snapshotArtifacts.status}`],
        };
        return {
            payload: brief
                ? {
                      ok: false,
                      workflow: 'safe_write',
                      reason,
                      snapshot,
                      validationPlan,
                      verification,
                      applied: false,
                  }
                : payload,
            isError: false,
        };
    }
    const checks = await dependencies.runChecks({ snapshot, commands, timeoutSec });
    const checksOut = asPayload(checks) || {};
    let applied = false;
    let applyResult: any = null;
    if (apply) {
        if (process.env.ALLOW_SNAPSHOT_APPLY === '1' && checksOut?.ok) {
            const app = await dependencies.applySnapshot({ snapshot, check: false });
            applyResult = asPayload(app) || {};
            applied = !!applyResult?.ok;
        } else {
            applyResult = {
                ok: false,
                message: process.env.ALLOW_SNAPSHOT_APPLY === '1' ? 'checks_failed' : 'ALLOW_SNAPSHOT_APPLY=1 required',
            };
        }
    }
    const snapshotArtifacts = snapshotArtifactLinks(snapshot);
    const applyVerification = applied ? await dependencies.verifyAppliedSnapshotDiff(snapshot) : null;
    const applyGuardSatisfied = !apply || process.env.ALLOW_SNAPSHOT_APPLY === '1';
    const appliedDiffMatchesSnapshot = applied ? applyVerification?.appliedDiffMatchesSnapshot === true : null;
    const failureReason =
        apply && !applyGuardSatisfied
            ? 'apply_guard_required'
            : !checksOut?.ok
              ? 'checks_failed'
              : apply && !applied
                ? 'apply_failed'
                : apply && appliedDiffMatchesSnapshot !== true
                  ? 'apply_verification_failed'
                  : null;
    const verification = {
        staged: !!stageOut?.accepted,
        checksPassed: !!checksOut?.ok,
        applyGuardSatisfied,
        applied,
        appliedDiffMatchesSnapshot,
        method: applied ? applyVerification?.method || 'git_apply_reverse_check_vs_snapshot_overlay' : null,
        diagnostics: applied
            ? applyVerification?.diagnostics || null
            : failureReason
              ? { reason: failureReason, applyResultMessage: applyResult?.message || null }
              : null,
    };
    const ok =
        !!stageOut?.accepted && !!checksOut?.ok && (apply ? applied && appliedDiffMatchesSnapshot === true : true);
    const rollbackArgs = JSON.stringify({ snapshot, reverse: true });
    const rollback = {
        available: applied,
        notNeeded: !applied && !apply,
        status: applied
            ? 'available_after_apply'
            : apply
              ? 'unavailable_apply_failed_or_refused'
              : 'not_needed_preview',
        strategy: 'reverse_snapshot_apply',
        command: `cd ${shellQuote(dependencies.workspaceRoot())} && ALLOW_SNAPSHOT_APPLY=1 semantic-code-intelligence workflow apply_snapshot --args ${shellQuote(rollbackArgs)} --json`,
        artifact: snapshotArtifacts.overlayDiff,
    };
    const validationPlan = buildValidationPlan({
        workflow: 'safe_write',
        mode: apply ? 'apply_after_checks' : 'preview_validate',
        snapshot,
        snapshotArtifacts,
        risk,
        commands,
        checksOk: !!checksOut?.ok,
        checksElapsedMs: checksOut?.elapsedMs || null,
        checkCommands: Array.isArray(checksOut?.commands) ? checksOut.commands : [],
        checkRecommendations,
        impactSummary,
        applied,
        applyGuardSatisfied: verification.applyGuardSatisfied,
        rollback,
        verification,
    });
    const summary = {
        ok,
        ...(ok ? {} : { reason: failureReason || 'unknown_failure' }),
        workflow: 'safe_write',
        mode: apply ? 'apply_after_checks' : 'preview_validate',
        risk,
        snapshot,
        checkRecommendations,
        validationPlan,
        checks: {
            ok: !!checksOut?.ok,
            commands: Array.isArray(checksOut?.commands) ? checksOut.commands : [],
            elapsedMs: checksOut?.elapsedMs || null,
        },
        verification,
        applied,
        next: applied
            ? 'review git diff; rollback artifact available'
            : 'inspect snapshot artifact; set apply:true with ALLOW_SNAPSHOT_APPLY=1 only when ready',
    };
    const payload = brief
        ? summary
        : {
              ...summary,
              stage: stageOut,
              verification,
              snapshotArtifacts,
              rollback,
              applyResult,
              checks: {
                  ...summary.checks,
                  output: String(checksOut?.output || '').slice(-4000),
              },
              next_actions: applied
                  ? ['Review working tree diff', `Rollback if needed: ${rollback.command}`]
                  : [
                        `Open snapshot diff: ${snapshotArtifacts.overlayDiff}`,
                        'Re-run safe_write with apply:true only after review and with ALLOW_SNAPSHOT_APPLY=1',
                    ],
          };
    return { payload, isError: false };
}
