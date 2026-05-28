import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];
const requiredAlphaTools = [
    'get_snapshot',
    'read_file',
    'text_search',
    'symbol_search',
    'find_definition',
    'find_references',
    'ast_query',
    'graph_expand',
    'recommend_checks',
    'propose_patch',
    'run_checks',
];

function writeJson(path: string, value: unknown) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function goodEvidenceFiles() {
    return {
        'alpha-mvp-dogfood.json': {
            ok: true,
            schema: 'fixture-alpha',
            summary: requiredAlphaTools.map((name) => ({ name, success: true, elapsedMs: 1 })),
        },
        'self-hosted-cli-dogfood.json': {
            ok: true,
            schema: 'fixture-self-hosted',
            selfHosting: {
                sciFirstDiscovery: {
                    complete: true,
                    expectedFirstTools: ['read_file'],
                    actualFirstTools: ['read_file'],
                },
                workspaceUnchanged: true,
            },
            calls: [{ name: 'read_file', success: true, elapsedMs: 1 }],
        },
        'structural-workflow-dogfood.json': {
            ok: true,
            schema: 'fixture-structural',
            calls: [
                { name: 'structural_search', success: true, elapsedMs: 1 },
                {
                    name: 'structural_patch_checks',
                    success: true,
                    elapsedMs: 1,
                    sample: { payload: { applied: false } },
                },
            ],
        },
        'graph-impact-dogfood.json': {
            ok: true,
            schema: 'fixture-graph',
            assertions: {
                fileImpactHasImports: true,
                fileImpactHasCallees: true,
                fileImpactHasPlanningHints: true,
                symbolImpactHasCallerStatus: true,
                symbolImpactHasCallees: true,
                symbolImpactHasLimitations: true,
                callerContextPresent: true,
                pythonLanguageCharacterized: true,
                pythonExportsCharacterized: true,
                pythonExportLimitationVisible: true,
                rustLanguageCharacterized: true,
                rustLimitationsVisible: true,
                goLanguageCharacterized: true,
                goLimitationsVisible: true,
                unsupportedExtensionCharacterized: true,
                backendProvenancePresent: true,
                summariesHaveRequestedEdges: true,
            },
            calls: [{ name: 'graph_expand', success: true, elapsedMs: 1 }],
        },
        'recommend-checks-dogfood.json': {
            ok: true,
            schema: 'fixture-recommend',
            assertions: {
                docsOnlyMinimumNoop: true,
                tsSourceTypecheck: true,
                testFileNarrowTest: true,
                graphImpactBroaderRationale: true,
                patchChecksThreadRecommendations: true,
                patchChecksValidationPlanPresent: true,
            },
            calls: [{ name: 'recommend_checks', success: true, elapsedMs: 1 }],
        },
        'safe-write-dogfood.json': {
            ok: true,
            schema: 'fixture-safe-write',
            assertions: {
                dirtyTouchedFileVerificationPreservesBase: true,
                validationPlanDirtyTouchedFileVerificationPreservesBase: true,
            },
            calls: [
                {
                    payload: {
                        mode: 'preview_validate',
                        applied: false,
                        checkRecommendations: { workflow: 'recommend_checks' },
                        validationPlan: { schema: 'semantic-code-intelligence.validation_plan.v1' },
                    },
                    elapsedMs: 1,
                },
                {
                    scenario: 'clean_apply',
                    payload: {
                        applied: true,
                        ok: true,
                        verification: { appliedDiffMatchesSnapshot: true },
                        validationPlan: { verification: { appliedDiffMatchesSnapshot: true } },
                    },
                    elapsedMs: 1,
                },
                {
                    scenario: 'dirty_base_apply',
                    payload: {
                        applied: true,
                        ok: true,
                        verification: { appliedDiffMatchesSnapshot: true },
                        validationPlan: { verification: { appliedDiffMatchesSnapshot: true } },
                    },
                    elapsedMs: 1,
                },
            ],
        },
        'validation-plan-comparison.json': {
            ok: true,
            schema: 'fixture-validation-plan-comparison',
            comparedPlanCount: 2,
            drift: [],
        },
    };
}

function makeEvidenceRoot(overrides: Record<string, unknown> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'sci-alpha-check-'));
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    const files = { ...goodEvidenceFiles(), ...overrides };
    for (const [name, value] of Object.entries(files)) writeJson(join(root, name), value);
    return root;
}

function runCheck(root: string) {
    return spawnSync('bun', ['run', 'scripts/check-alpha-evidence.ts'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, SCI_ALPHA_EVIDENCE_ROOT: root },
    });
}

afterAll(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('alpha evidence gate', () => {
    test('uses an isolated evidence root and keeps the generated gate passing', () => {
        const result = runCheck(makeEvidenceRoot());
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);

        expect(report.ok).toBe(true);
        expect(report.checks.map((check: any) => check.name)).toContain('alpha_required_tools_present');
        expect(report.checks.every((check: any) => check.ok === true)).toBe(true);
    });

    test('redacts malicious evidence detail strings in operator-facing JSON', () => {
        const root = makeEvidenceRoot({
            'alpha-mvp-dogfood.json': {
                ok: true,
                schema: `fixture SECRET_KEY=alpha-secret ${process.cwd()} /tmp/private-alpha`,
                summary: requiredAlphaTools
                    .concat('TOKEN_SECRET=tool-secret')
                    .map((name) => ({ name, success: true, elapsedMs: 1 })),
            },
            'validation-plan-comparison.json': {
                ok: true,
                schema: 'fixture-validation-plan-comparison',
                comparedPlanCount: 2,
                drift: [`SECRET_KEY=drift-secret ${process.cwd()} /tmp/private-drift`],
            },
        });

        const result = runCheck(root);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain('SECRET_KEY=alpha-secret');
        expect(result.stdout).not.toContain('TOKEN_SECRET=tool-secret');
        expect(result.stdout).not.toContain('SECRET_KEY=drift-secret');
        expect(result.stdout).not.toContain(process.cwd());
        expect(result.stdout).not.toContain('/tmp/private-alpha');
        expect(result.stdout).not.toContain('/tmp/private-drift');
        const report = JSON.parse(result.stdout);
        const alphaCheck = report.checks.find((check: any) => check.name === 'alpha_dogfood_ok');
        expect(alphaCheck.detail.schema).toContain('<redacted-secret>');
    });

    test('shared maxElapsed handles huge and mixed evidence-controlled values iteratively', async () => {
        const { maxElapsed } = await import('../scripts/evidence-summary-utils');
        const calls = Array.from({ length: 1_000_000 }, (_, index) => ({ elapsedMs: index === 999_999 ? '42' : -1 }));
        calls.push({ elapsedMs: Number.NaN }, { elapsedMs: 'not-a-number' } as any);

        expect(maxElapsed(calls)).toBe(42);
    });

    test('huge but under-limit evidence arrays do not crash elapsed-time summarization', () => {
        const root = makeEvidenceRoot();
        writeFileSync(
            join(root, 'alpha-mvp-dogfood.json'),
            `{"ok":true,"summary":[${Array.from({ length: 1_000_000 }, () => '{}').join(',')}]}`
        );

        const result = runCheck(root);
        expect(result.status).toBe(1);
        expect(result.stderr).not.toContain('RangeError');
        expect(result.stderr).not.toContain('Maximum call stack size exceeded');
        const report = JSON.parse(result.stdout);
        expect(report.ok).toBe(false);
        expect(report.checks.find((check: any) => check.name === 'alpha_latency_budget')).toMatchObject({ ok: true });
        expect(report.checks.find((check: any) => check.name === 'alpha_required_tools_present')?.ok).toBe(false);
    });

    test('oversized generated evidence fails closed with sanitized detail', () => {
        const root = makeEvidenceRoot();
        writeFileSync(join(root, 'alpha-mvp-dogfood.json'), `{"ok":true,"padding":"${'x'.repeat(10 * 1024 * 1024)}"}`);

        const result = runCheck(root);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Evidence input too large');
        expect(result.stdout).not.toContain(root);
        const report = JSON.parse(result.stdout);
        expect(report.ok).toBe(false);
        expect(report.checks[0]).toMatchObject({ name: 'evidence_files_readable', ok: false });
    });
});
