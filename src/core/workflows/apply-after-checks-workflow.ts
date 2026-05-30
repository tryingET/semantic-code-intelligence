import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

type SnapshotWorkflowDeps = {
    getSnapshot(args: Record<string, any>): Promise<SnapshotWorkflowResult>;
    proposePatch(args: Record<string, any>): Promise<SnapshotWorkflowResult>;
    runChecks(args: Record<string, any>): Promise<SnapshotWorkflowResult>;
    applySnapshot(args: Record<string, any>): Promise<SnapshotWorkflowResult>;
};

export async function applyAfterChecks(
    args: Record<string, any>,
    deps: SnapshotWorkflowDeps
): Promise<SnapshotWorkflowResult> {
    const patch = typeof args?.patch === 'string' ? args.patch : '';
    if (!patch.trim()) return { text: 'patch required', isError: true };
    const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
    const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
    const reverse = !!args?.reverse;
    const apply = args?.apply === true;
    const requested = typeof args?.snapshot === 'string' ? String(args.snapshot).trim() : '';
    let snapshot: string | undefined = requested || undefined;
    if (!snapshot) {
        const snapRes = await deps.getSnapshot({ preferExisting: false });
        const snapTxt = asPayload(snapRes);
        snapshot = (snapTxt?.snapshot || snapTxt?.id) as string | undefined;
    }
    if (!snapshot) return { text: 'failed to create snapshot', isError: true };

    const stage = await deps.proposePatch({ snapshot, patch });
    const stageOut = asPayload(stage) || {};
    if (stage?.isError || stageOut?.accepted !== true) {
        return {
            payload: {
                ok: false,
                reason: 'patch_stage_failed',
                snapshot,
                applied: false,
                stage: stageOut,
                output_tail: '',
            },
            isError: false,
        };
    }
    const checks = await deps.runChecks({ snapshot, commands, timeoutSec });
    const chk = asPayload(checks) || {};
    if (chk?.ok && apply && process.env.ALLOW_SNAPSHOT_APPLY === '1') {
        const app = await deps.applySnapshot({ snapshot, check: false, reverse });
        const appOut = asPayload(app) || {};
        const applied = !!appOut?.ok;
        return {
            payload: {
                ok: !!chk?.ok && applied,
                snapshot,
                applied,
                apply: appOut,
                output_tail: [chk?.output?.slice?.(-4000) || '', appOut?.output?.slice?.(-4000) || '']
                    .filter(Boolean)
                    .join('\n'),
            },
            isError: false,
        };
    }
    const reason = !chk?.ok ? 'checks_failed' : !apply ? 'apply_not_requested' : 'ALLOW_SNAPSHOT_APPLY=1 required';
    return {
        payload: {
            ok: false,
            reason,
            snapshot,
            applied: false,
            checks: chk,
            output_tail: chk?.output?.slice?.(-4000) || '',
        },
        isError: false,
    };
}

function asPayload(result: SnapshotWorkflowResult | undefined): any {
    if (!result) return result;
    return 'payload' in result ? result.payload : result;
}
