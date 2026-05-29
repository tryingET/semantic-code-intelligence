import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const tempRoots: string[] = [];
let workspaceFixtureCounter = 0;

const evidenceNames = {
    alpha: 'alpha-mvp-dogfood.json',
    selfHosted: 'self-hosted-cli-dogfood.json',
    structural: 'structural-workflow-dogfood.json',
    graph: 'graph-impact-dogfood.json',
    recommendChecks: 'recommend-checks-dogfood.json',
    safeWrite: 'safe-write-dogfood.json',
    gate: 'alpha-evidence-check.json',
};

function writeJson(path: string, value: unknown) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeEvidenceRoot(
    overrides: Record<string, unknown> = {},
    baselineOverrides: Record<string, unknown> = {},
    options: { insideWorkspace?: boolean } = {}
) {
    const root = options.insideWorkspace
        ? resolve(process.cwd(), '.test-results', `alpha-history-fixture-${Date.now()}-${workspaceFixtureCounter++}`)
        : mkdtempSync(join(tmpdir(), 'sci-alpha-history-'));
    if (options.insideWorkspace) mkdirSync(root, { recursive: true });
    tempRoots.push(root);
    const baselinePath = join(root, 'baseline.json');
    const baseline = {
        schema: 'semantic-code-intelligence.alpha_evidence_latency_baseline.v1',
        label: 'fixture baseline',
        capturedAt: '2026-01-01T00:00:00.000Z',
        commit: 'fixture',
        note: 'fixture baseline; not production SLO evidence',
        baselines: {
            alpha: { maxElapsedMs: 1000 },
            selfHosted: { maxElapsedMs: 1000 },
            structural: { maxElapsedMs: 1000 },
            graph: { maxElapsedMs: 1000 },
            recommendChecks: { maxElapsedMs: 1000 },
            safeWrite: { maxElapsedMs: 1000 },
            ...baselineOverrides,
        },
    };
    writeJson(baselinePath, baseline);

    const defaults: Record<string, unknown> = {
        [evidenceNames.alpha]: {
            ok: true,
            summary: [{ name: 'read_file', success: true, elapsedMs: 10, observation: 'bounded read' }],
        },
        [evidenceNames.selfHosted]: {
            ok: true,
            calls: [{ name: 'read_file', success: true, elapsedMs: 10, observation: 'bounded read' }],
        },
        [evidenceNames.structural]: {
            ok: true,
            calls: [{ name: 'structural_search', success: true, elapsedMs: 10, observation: 'structural query' }],
        },
        [evidenceNames.graph]: {
            ok: true,
            calls: [{ name: 'graph_expand', success: true, elapsedMs: 10, observation: 'graph query' }],
        },
        [evidenceNames.recommendChecks]: {
            ok: true,
            calls: [{ name: 'recommend_checks', success: true, elapsedMs: 10, observation: 'check recommendation' }],
        },
        [evidenceNames.safeWrite]: {
            ok: true,
            calls: [{ name: 'safe_write', success: true, elapsedMs: 10, observation: 'safe write preview' }],
        },
        [evidenceNames.gate]: {
            ok: true,
            checks: [{ name: 'fixture', ok: true }],
            budgetsMs: {
                alphaCall: 15000,
                selfHostedCall: 15000,
                structuralCall: 20000,
                graphCall: 15000,
                recommendChecksCall: 15000,
                safeWriteCall: 15000,
            },
        },
    };

    for (const [name, value] of Object.entries({ ...defaults, ...overrides })) {
        writeJson(join(root, name), value);
    }
    return { root, baselinePath };
}

function runHistory(root: string, baselinePath: string) {
    return spawnSync('bun', ['run', 'scripts/compare-alpha-evidence-history.ts'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, SCI_ALPHA_EVIDENCE_ROOT: root, SCI_ALPHA_EVIDENCE_BASELINE: baselinePath },
    });
}

afterAll(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('alpha evidence history comparison', () => {
    test('warning-level drift identifies the slowest call and likely latency area without failing', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: {
                ok: true,
                summary: [
                    { name: 'read_file', success: true, elapsedMs: 50, observation: 'bounded read' },
                    {
                        name: 'find_definition',
                        success: true,
                        elapsedMs: 1800,
                        observation: 'Resolve definition without /tmp/secret-token SECRET_KEY=abc',
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);

        expect(report.ok).toBe(true);
        expect(report.operatorSummary.status).toBe('historical_latency_warning');
        expect(report.warnings).toHaveLength(1);
        expect(report.warnings[0]).toMatchObject({
            key: 'alpha',
            status: 'slower_than_baseline',
            likelyArea: 'navigation_resolution',
        });
        expect(report.warnings[0].slowestCall).toMatchObject({ name: 'find_definition', elapsedMs: 1800 });
        expect(report.warnings[0].slowestCall.observation).toContain('<redacted-secret>');
        expect(report.operatorSummary.warningDetails[0]).toMatchObject({
            key: 'alpha',
            call: 'find_definition',
            likelyArea: 'navigation_resolution',
        });
        expect(report.baseline.path).toBe('<external-path>/baseline.json');
        expect(report.warnings[0].sourceFile).toBe('<external-path>/alpha-mvp-dogfood.json');
        expect(result.stdout).not.toContain(root);
        expect(result.stdout).not.toContain(baselinePath);
        expect(result.stdout).not.toContain('/tmp/secret-token');
    });

    test('call names and remediation hints are redacted before reaching operator-facing output', () => {
        const maliciousCallName = `find_definition SECRET_KEY=call-secret ${process.cwd()} /tmp/private-call`;
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: {
                ok: true,
                summary: [
                    { name: maliciousCallName, success: true, elapsedMs: 1800, observation: 'slow malicious name' },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain('SECRET_KEY=call-secret');
        expect(result.stdout).not.toContain(process.cwd());
        expect(result.stdout).not.toContain('/tmp/private-call');
        const report = JSON.parse(result.stdout);
        expect(report.warnings[0].slowestCall.name).toContain('<redacted-secret>');
        expect(report.warnings[0].remediationHint).toContain('<redacted-secret>');
    });

    test('validation warnings include sanitized selected-command receipt summaries when residual tool overhead still drifts', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: {
                ok: true,
                summary: [
                    { name: 'run_checks', success: true, elapsedMs: 1900, observation: 'Run explicit selected checks' },
                ],
                calls: [
                    {
                        name: 'run_checks',
                        success: true,
                        elapsedMs: 1900,
                        observation: 'Run explicit selected checks',
                        sample: {
                            result: {
                                ok: true,
                                elapsedMs: 1800,
                                commands: [
                                    {
                                        command: `echo SECRET_KEY=command-secret ${process.cwd()} /tmp/private-check`,
                                        ok: true,
                                        elapsedMs: 300,
                                        exitCode: 0,
                                        timedOut: false,
                                        stdout: 'do not copy stdout',
                                    },
                                ],
                                output: 'do not copy aggregate output',
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain('SECRET_KEY=command-secret');
        expect(result.stdout).not.toContain(process.cwd());
        expect(result.stdout).not.toContain('/tmp/private-check');
        expect(result.stdout).not.toContain('do not copy stdout');
        expect(result.stdout).not.toContain('do not copy aggregate output');
        const report = JSON.parse(result.stdout);

        expect(report.warnings[0].slowestCall.commandReceiptSummary).toMatchObject({
            count: 1,
            totalElapsedMs: 300,
            slowest: {
                elapsedMs: 300,
                ok: true,
                exitCode: 0,
                timedOut: false,
            },
        });
        expect(report.warnings[0].latencyAttribution).toMatchObject({
            kind: 'selected_command_runtime',
            selectedCommandElapsedMs: 300,
            toolOverheadElapsedMs: 1600,
            overheadStatus: 'slower_than_baseline',
        });
        expect(report.operatorSummary.warningDetails[0].commandReceiptSummary).toEqual(
            report.warnings[0].slowestCall.commandReceiptSummary
        );
        expect(report.operatorSummary.warningDetails[0].callIndex).toBe(0);
        expect(report.warnings[0].slowestCall.commandReceiptSummary.slowest.command).toContain(
            'echo <redacted-secret>'
        );
        expect(report.warnings[0].slowestCall.commandReceiptSummary.slowest.command).toContain('<absolute-path>');
    });

    test('multi-command selected runtime is summed before suppressing command-dominated drift', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.structural]: {
                ok: true,
                calls: [
                    {
                        name: 'structural_patch_checks',
                        success: true,
                        elapsedMs: 2100,
                        observation: 'Run multiple selected checks',
                        sample: {
                            result: {
                                commands: [
                                    {
                                        command: 'bun run typecheck',
                                        ok: true,
                                        elapsedMs: 600,
                                        exitCode: 0,
                                        timedOut: false,
                                    },
                                    {
                                        command: 'bun test tests/example.test.ts',
                                        ok: true,
                                        elapsedMs: 600,
                                        exitCode: 0,
                                        timedOut: false,
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        const structural = report.comparisons.find((item: any) => item.key === 'structural');

        expect(structural).toMatchObject({
            status: 'within_noise_band_command_dominated',
            rawStatus: 'slower_than_baseline',
            slowestCall: { commandReceiptSummary: { count: 2, totalElapsedMs: 1200, slowest: { elapsedMs: 600 } } },
            latencyAttribution: {
                kind: 'selected_command_runtime',
                selectedCommandElapsedMs: 1200,
                toolOverheadElapsedMs: 900,
                commandRuntimeShare: 0.571,
                overheadStatus: 'within_noise_band',
            },
        });
        expect(report.warnings.find((item: any) => item.key === 'structural')).toBeUndefined();
    });

    test('tiny selected-command share does not suppress raw tool-overhead drift', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: {
                ok: true,
                summary: [{ name: 'run_checks', success: true, elapsedMs: 1500, observation: 'Mostly tool overhead' }],
                calls: [
                    {
                        name: 'run_checks',
                        success: true,
                        elapsedMs: 1500,
                        observation: 'Mostly tool overhead',
                        sample: {
                            result: {
                                commands: [{ command: 'true', ok: true, elapsedMs: 10, exitCode: 0, timedOut: false }],
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);

        expect(report.warnings[0]).toMatchObject({
            key: 'alpha',
            status: 'slower_than_baseline',
            rawStatus: 'slower_than_baseline',
            latencyAttribution: {
                kind: 'selected_command_runtime',
                selectedCommandElapsedMs: 10,
                toolOverheadElapsedMs: 1490,
                commandRuntimeShare: 0.007,
                overheadStatus: 'within_noise_band',
            },
        });
        expect(report.comparisons.find((item: any) => item.key === 'alpha').status).toBe('slower_than_baseline');
    });

    test('empty earlier command arrays do not mask later populated receipt paths', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.structural]: {
                ok: true,
                calls: [
                    {
                        name: 'structural_patch_checks',
                        success: true,
                        elapsedMs: 2400,
                        observation: 'Run validation plan checks',
                        sample: {
                            result: { commands: [] },
                            payload: {
                                validationPlan: {
                                    checks: {
                                        commands: [
                                            {
                                                command: 'bun run typecheck',
                                                ok: true,
                                                elapsedMs: 1700,
                                                exitCode: 0,
                                                timedOut: false,
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        const structural = report.comparisons.find((item: any) => item.key === 'structural');

        expect(structural).toMatchObject({
            status: 'within_noise_band_command_dominated',
            slowestCall: { commandReceiptSummary: { count: 1, totalElapsedMs: 1700 } },
            latencyAttribution: {
                kind: 'selected_command_runtime',
                selectedCommandElapsedMs: 1700,
                toolOverheadElapsedMs: 700,
            },
        });
    });

    test('inconsistent command receipts greater than call elapsed do not suppress raw drift', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: {
                ok: true,
                summary: [{ name: 'run_checks', success: true, elapsedMs: 1500, observation: 'Inconsistent receipt' }],
                calls: [
                    {
                        name: 'run_checks',
                        success: true,
                        elapsedMs: 1500,
                        observation: 'Inconsistent receipt',
                        sample: {
                            result: {
                                commands: [
                                    { command: 'true', ok: true, elapsedMs: 2000, exitCode: 0, timedOut: false },
                                ],
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);

        expect(report.warnings[0]).toMatchObject({
            key: 'alpha',
            status: 'slower_than_baseline',
            rawStatus: 'slower_than_baseline',
            latencyAttribution: {
                kind: 'inconsistent_selected_command_runtime',
                selectedCommandElapsedMs: 2000,
                toolOverheadElapsedMs: 1500,
                commandRuntimeShare: 1.333,
                evidenceConsistent: false,
                overheadStatus: 'slower_than_baseline',
            },
        });
    });

    test('selected-command-dominated baseline drift is attributed without becoming a warning', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.structural]: {
                ok: true,
                calls: [
                    {
                        name: 'structural_patch_checks',
                        success: true,
                        elapsedMs: 2400,
                        observation: 'Run default typecheck validation',
                        sample: {
                            payload: {
                                validationPlan: {
                                    checks: {
                                        commands: [
                                            {
                                                command: 'bun run typecheck',
                                                ok: true,
                                                elapsedMs: 1700,
                                                exitCode: 0,
                                                timedOut: false,
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        const structural = report.comparisons.find((item: any) => item.key === 'structural');

        expect(structural).toMatchObject({
            status: 'within_noise_band_command_dominated',
            rawStatus: 'slower_than_baseline',
            latencyAttribution: {
                kind: 'selected_command_runtime',
                totalElapsedMs: 2400,
                selectedCommandElapsedMs: 1700,
                toolOverheadElapsedMs: 700,
                overheadStatus: 'within_noise_band',
            },
        });
        expect(report.warnings.find((item: any) => item.key === 'structural')).toBeUndefined();
        expect(report.operatorSummary.status).toBe('historical_latency_within_alpha_bounds');
        expect(report.operatorSummary.warningDetails).toEqual([]);
    });

    test('duplicate same-name calls join command receipts by stable index instead of max raw elapsed time', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: {
                ok: true,
                summary: [
                    { name: 'run_checks', success: true, elapsedMs: 1500, observation: 'first same-name call' },
                    { name: 'run_checks', success: true, elapsedMs: 1900, observation: 'second same-name call' },
                ],
                calls: [
                    {
                        name: 'run_checks',
                        success: true,
                        elapsedMs: 3000,
                        observation: 'first raw call should not be selected for second summary row',
                        sample: { result: { commands: [{ command: 'wrong-command', elapsedMs: 3000, ok: true }] } },
                    },
                    {
                        name: 'run_checks',
                        success: true,
                        elapsedMs: 1900,
                        observation: 'second raw call should be selected by index',
                        sample: {
                            result: {
                                commands: [null, 'bad-shape', { command: 'right-command', elapsedMs: 300, ok: true }],
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);

        expect(report.warnings[0].slowestCall).toMatchObject({ name: 'run_checks', index: 1, elapsedMs: 1900 });
        expect(report.warnings[0].slowestCall.commandReceiptSummary).toMatchObject({
            count: 1,
            totalElapsedMs: 300,
            slowest: { command: 'right-command', elapsedMs: 300, ok: true },
        });
        expect(report.operatorSummary.warningDetails[0].commandReceiptSummary).toEqual(
            report.warnings[0].slowestCall.commandReceiptSummary
        );
        expect(JSON.stringify(report)).not.toContain('wrong-command');
    });

    test('overlapping structural check workflow names classify as validation rather than structural matching', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.structural]: {
                ok: true,
                calls: [
                    { name: 'structural_search', success: true, elapsedMs: 1200, observation: 'pure ast-grep query' },
                    {
                        name: 'structural_patch_checks',
                        success: true,
                        elapsedMs: 1900,
                        observation: 'Verify omitted commands default to the tsgo-primary bun run typecheck lane.',
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);

        expect(report.warnings[0]).toMatchObject({
            key: 'structural',
            status: 'slower_than_baseline',
            likelyArea: 'validation_or_snapshot_checks',
        });
        expect(report.warnings[0].slowestCall).toMatchObject({ name: 'structural_patch_checks', elapsedMs: 1900 });
        expect(report.warnings[0].remediationHint).toContain('selected commands');
        expect(report.warnings[0].remediationHint).not.toContain('pattern complexity');
    });

    test('pure structural and advisory recommendation calls keep distinct latency areas', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.structural]: {
                ok: true,
                calls: [
                    { name: 'structural_search', success: true, elapsedMs: 1800, observation: 'pure ast-grep query' },
                ],
            },
            [evidenceNames.recommendChecks]: {
                ok: true,
                calls: [
                    {
                        name: 'recommend_checks',
                        success: true,
                        elapsedMs: 1700,
                        observation: 'large caller-provided patch summary',
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        const structural = report.warnings.find((item: any) => item.key === 'structural');
        const recommendChecks = report.warnings.find((item: any) => item.key === 'recommendChecks');

        expect(structural).toMatchObject({ likelyArea: 'structural_analysis' });
        expect(structural.remediationHint).toContain('AST/ast-grep path scope');
        expect(recommendChecks).toMatchObject({ likelyArea: 'check_recommendation' });
        expect(recommendChecks.remediationHint).toContain('patch size');
        expect(recommendChecks.remediationHint).not.toContain('selected commands');
    });

    test('baseline metadata is redacted before reaching operator-facing output', () => {
        const { root, baselinePath } = makeEvidenceRoot();
        writeJson(baselinePath, {
            schema: 'semantic-code-intelligence.alpha_evidence_latency_baseline.v1',
            label: `fixture ${process.cwd()}`,
            capturedAt: '2026-01-01T00:00:00.000Z',
            commit: 'SECRET_KEY=history-secret',
            note: 'stored under /tmp/private-baseline with TOKEN_SECRET=abc123',
            baselines: {
                alpha: { maxElapsedMs: 1000 },
                selfHosted: { maxElapsedMs: 1000 },
                structural: { maxElapsedMs: 1000 },
                graph: { maxElapsedMs: 1000 },
                recommendChecks: { maxElapsedMs: 1000 },
                safeWrite: { maxElapsedMs: 1000 },
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain(process.cwd());
        expect(result.stdout).not.toContain('SECRET_KEY=history-secret');
        expect(result.stdout).not.toContain('/tmp/private-baseline');
        expect(result.stdout).not.toContain('TOKEN_SECRET=abc123');
        const report = JSON.parse(result.stdout);
        expect(report.baseline.label).toMatch(/<workspace>|<home>/);
        expect(report.baseline.commit).toContain('<redacted-secret>');
    });

    test('oversized generated evidence fails closed before parsing', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: `{"ok":true,"padding":"${'x'.repeat(10 * 1024 * 1024)}"}`,
        } as any);
        writeFileSync(join(root, evidenceNames.alpha), `{"ok":true,"padding":"${'x'.repeat(10 * 1024 * 1024)}"}`);

        const result = runHistory(root, baselinePath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('alpha-evidence-history: Evidence input too large');
        expect(result.stderr).not.toContain(root);
    });

    test('history output refuses symlink clobbering', () => {
        const { root, baselinePath } = makeEvidenceRoot();
        const outsideRoot = mkdtempSync(join(tmpdir(), 'sci-alpha-history-outside-'));
        tempRoots.push(outsideRoot);
        symlinkSync(join(outsideRoot, 'outside-history.json'), join(root, 'alpha-evidence-history.json'));

        const result = runHistory(root, baselinePath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('alpha-evidence-history: Evidence output must be a regular file');
        expect(result.stderr).not.toContain(outsideRoot);
    });

    test('workspace-contained absolute evidence paths are reported as repo-relative labels', () => {
        const { root, baselinePath } = makeEvidenceRoot({}, {}, { insideWorkspace: true });

        const result = runHistory(root, baselinePath);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);

        expect(report.baseline.path).toMatch(/^\.test-results\/alpha-history-fixture-.+\/baseline\.json$/);
        expect(report.comparisons[0].sourceFile).toMatch(
            /^\.test-results\/alpha-history-fixture-.+\/alpha-mvp-dogfood\.json$/
        );
        expect(report.baseline.path).not.toContain(process.cwd());
        expect(result.stdout).not.toContain(process.cwd());
    });

    test('over-budget evidence remains the fail-closed condition', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.alpha]: {
                ok: true,
                summary: [{ name: 'text_search', success: true, elapsedMs: 16000, observation: 'search too broad' }],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status).toBe(1);
        const report = JSON.parse(result.stdout);

        expect(report.ok).toBe(false);
        expect(report.operatorSummary.status).toBe('elapsed_time_over_budget');
        expect(report.overBudget[0]).toMatchObject({ key: 'alpha', status: 'over_budget', likelyArea: 'search' });
        expect(report.overBudget[0].slowestCall).toMatchObject({ name: 'text_search', elapsedMs: 16000 });
    });

    test('selected-command attribution never suppresses over-budget failure', () => {
        const { root, baselinePath } = makeEvidenceRoot({
            [evidenceNames.structural]: {
                ok: true,
                calls: [
                    {
                        name: 'structural_patch_checks',
                        success: true,
                        elapsedMs: 21000,
                        observation: 'Run very slow selected command',
                        sample: {
                            payload: {
                                checks: { commands: [{ command: 'bun run typecheck', ok: true, elapsedMs: 20000 }] },
                            },
                        },
                    },
                ],
            },
        });

        const result = runHistory(root, baselinePath);
        expect(result.status).toBe(1);
        const report = JSON.parse(result.stdout);

        expect(report.ok).toBe(false);
        expect(report.operatorSummary.status).toBe('elapsed_time_over_budget');
        expect(report.overBudget[0]).toMatchObject({
            key: 'structural',
            status: 'over_budget',
            rawStatus: 'over_budget',
            latencyAttribution: {
                kind: 'selected_command_runtime',
                selectedCommandElapsedMs: 20000,
                toolOverheadElapsedMs: 1000,
                commandRuntimeShare: 0.952,
            },
        });
    });
});
