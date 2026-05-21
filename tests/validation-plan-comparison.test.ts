import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = 'scripts/compare-validation-plans.ts';
const tempRoots: string[] = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'sci-validation-plan-comparison-'));
  tempRoots.push(root);
  return root;
}

function validationPlan(overrides: Record<string, any> = {}) {
  return {
    schema: 'semantic-code-intelligence.validation_plan.v1',
    workflow: 'patch_checks_in_snapshot',
    mode: 'preview_validate',
    commands: { selected: ['true'], recommendedMinimum: ['bun run typecheck'], recommendationsAppliedToSelected: false },
    checks: { ok: true },
    artifacts: { overlayDiff: 'snapshot://example/overlay.diff' },
    graphImpact: {
      seed: { kind: 'file', value: 'src/example.ts' },
      requestedEdges: ['imports', 'callers'],
      evidence: [
        { edge: 'imports', count: 1, status: 'evidence' },
        { edge: 'callers', count: 0, status: 'empty_or_unavailable' },
      ],
      limitations: [],
    },
    ...overrides,
  };
}

function safeWritePlan(overrides: Record<string, any> = {}) {
  return validationPlan({
    workflow: 'safe_write',
    graphImpact: null,
    rollback: { command: 'git apply -R .ontology/snapshots/example/overlay.diff' },
    apply: { applied: false, guardSatisfied: true },
    verification: { staged: true, checksPassed: true, applyGuardSatisfied: true, applied: false, appliedDiffMatchesSnapshot: null },
    ...overrides,
  });
}

function writeEvidence(root: string, recommendPlan: any, safePlans: any | any[] = [
  safeWritePlan(),
  safeWritePlan({ mode: 'apply_after_checks', apply: { applied: true, guardSatisfied: true }, verification: { staged: true, checksPassed: true, applyGuardSatisfied: true, applied: true, appliedDiffMatchesSnapshot: true } }),
  safeWritePlan({ mode: 'apply_after_checks', apply: { applied: true, guardSatisfied: true }, verification: { staged: true, checksPassed: true, applyGuardSatisfied: true, applied: true, appliedDiffMatchesSnapshot: false } }),
]) {
  const plans = Array.isArray(safePlans) ? safePlans : [safePlans];
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'recommend-checks-dogfood.json'), JSON.stringify({
    schema: 'semantic-code-intelligence.recommend_checks_dogfood.v1',
    ok: true,
    calls: [{ caseName: 'patch_checks_recommendations_threaded', payload: { validationPlan: recommendPlan } }],
  }, null, 2));
  writeFileSync(join(root, 'safe-write-dogfood.json'), JSON.stringify({
    schema: 'semantic-code-intelligence.safe_write_dogfood.v1',
    ok: true,
    calls: plans.map((plan) => ({ payload: { mode: plan.mode || 'preview_validate', validationPlan: plan } })),
  }, null, 2));
}

function runComparison(root: string) {
  return spawnSync('bun', ['run', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SCI_VALIDATION_PLAN_EVIDENCE_ROOT: root },
  });
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('validation plan comparison graph context', () => {
  test('passes when generated evidence includes stable graph review context', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan());

    const result = runComparison(root);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(true);
    expect(report.graphContextPlanCount).toBe(1);
    expect(report.stableFields).toContain('graphImpactRequestedEdges');
    expect(report.stableFields).toContain('verificationAppliedDiffMatchesSnapshot');
    expect(report.interpretation.proves).toContain('At least one generated validationPlan preserves graph seed, requested edges, per-edge status, and limitations for evidence review.');
    expect(report.interpretation.proves).toContain('safe_write validationPlan evidence preserves exact apply verification posture for downstream evidence review.');
  });

  test('fails closed when safe_write validationPlan omits verification posture', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan(), validationPlan({
      workflow: 'safe_write',
      graphImpact: null,
      rollback: { command: 'git apply -R .ontology/snapshots/example/overlay.diff' },
      apply: { applied: false },
    }));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(false);
    expect(report.drift.some((item: any) => item.failures.includes('safe_write_verification_missing'))).toBe(true);
    expect(result.stdout + result.stderr).toContain('safe_write_verification_missing');
  });

  test('fails closed when applied safe_write validationPlan omits applied-diff match state', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan(), safeWritePlan({
      mode: 'apply_after_checks',
      apply: { applied: true, guardSatisfied: true },
      verification: { staged: true, checksPassed: true, applyGuardSatisfied: true, applied: true, appliedDiffMatchesSnapshot: null },
    }));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(false);
    expect(report.drift.some((item: any) => item.failures.includes('safe_write_verification_incomplete'))).toBe(true);
  });

  test('fails closed when safe_write bundle lacks clean apply and mismatch verification coverage', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan(), safeWritePlan());

    const result = runComparison(root);
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(false);
    expect(report.drift.some((item: any) => item.failures.includes('safe_write_verification_coverage_missing'))).toBe(true);
  });

  test('fails closed when no generated validationPlan carries graph context', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan({ graphImpact: null }));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(false);
    expect(report.drift.some((item: any) => item.failures.includes('graph_impact_context_missing'))).toBe(true);
    expect(result.stdout + result.stderr).toContain('graph_impact_context_missing');
  });

  test('fails closed when graph-bearing validationPlan omits evidence for a requested edge', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan({
      graphImpact: {
        seed: { kind: 'file', value: 'src/example.ts' },
        requestedEdges: ['imports', 'callers'],
        evidence: [{ edge: 'imports', count: 1, status: 'evidence' }],
        limitations: [],
      },
    }));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(false);
    expect(report.drift.some((item: any) => item.failures.includes('graph_impact_context_incomplete'))).toBe(true);
    expect(report.drift.some((item: any) => item.failures.includes('graph_impact_context_missing'))).toBe(true);
  });

  test('fails closed when limited graph edge evidence has no visible limitation', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan({
      graphImpact: {
        seed: { kind: 'file', value: 'src/example.ts' },
        requestedEdges: ['imports', 'callers'],
        evidence: [
          { edge: 'imports', count: 1, status: 'evidence' },
          { edge: 'callers', count: 0, status: 'limited', limitations: [] },
        ],
        limitations: [],
      },
    }));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(false);
    expect(report.drift.some((item: any) => item.failures.includes('graph_impact_context_incomplete'))).toBe(true);
  });

  test('redacts evidence-controlled strings in stdout and generated comparison output', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan({
      workflow: `patch_checks_in_snapshot TOKEN_SECRET=workflow-secret ${process.cwd()} /tmp/private-workflow`,
      commands: {
        selected: [`true SECRET_KEY=command-secret ${process.cwd()} /tmp/private-command`],
        recommendedMinimum: [],
        recommendationsAppliedToSelected: false,
      },
      graphImpact: {
        seed: { kind: 'file', value: `src/example.ts SECRET_KEY=graph-secret ${process.cwd()} /tmp/private-graph` },
        requestedEdges: ['imports'],
        evidence: [{ edge: `imports TOKEN_SECRET=edge-secret ${process.cwd()} /tmp/private-edge`, count: 1, status: 'evidence' }],
        limitations: [],
      },
    }));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('TOKEN_SECRET=workflow-secret');
    expect(result.stdout).not.toContain('SECRET_KEY=command-secret');
    expect(result.stdout).not.toContain('SECRET_KEY=graph-secret');
    expect(result.stdout).not.toContain('TOKEN_SECRET=edge-secret');
    expect(result.stdout).not.toContain(process.cwd());
    expect(result.stdout).not.toContain('/tmp/private-workflow');
    expect(result.stdout).not.toContain('/tmp/private-command');
    const reportText = readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8');
    expect(reportText).toContain('<redacted-secret>');
    expect(reportText).not.toContain('/tmp/private-graph');
  });

  test('rejects oversized and symlinked generated evidence inputs without leaking contents', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan());
    writeFileSync(join(root, 'recommend-checks-dogfood.json'), `{"schema":"semantic-code-intelligence.recommend_checks_dogfood.v1","padding":"${'x'.repeat(10 * 1024 * 1024)}"}`);

    const oversized = runComparison(root);
    expect(oversized.status).toBe(1);
    expect(oversized.stderr).toContain('validation-plan-compare: Evidence input too large');
    expect(oversized.stderr).not.toContain(root);

    const symlinkRoot = makeRoot();
    writeEvidence(symlinkRoot, validationPlan());
    const outsideRoot = makeRoot();
    const outsidePath = join(outsideRoot, 'safe-write-dogfood.json');
    writeFileSync(outsidePath, JSON.stringify({ ok: true, secret: 'outside-safe-write-secret' }));
    rmSync(join(symlinkRoot, 'safe-write-dogfood.json'));
    symlinkSync(outsidePath, join(symlinkRoot, 'safe-write-dogfood.json'));

    const symlinked = runComparison(symlinkRoot);
    expect(symlinked.status).toBe(1);
    expect(symlinked.stderr).toContain('validation-plan-compare: Evidence input must be a regular file');
    expect(symlinked.stdout + symlinked.stderr).not.toContain('outside-safe-write-secret');
    expect(symlinked.stderr).not.toContain(outsideRoot);
  });

  test('refuses to write comparison output through a symlink', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan());
    const outsideRoot = makeRoot();
    symlinkSync(join(outsideRoot, 'validation-plan-comparison.json'), join(root, 'validation-plan-comparison.json'));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('validation-plan-compare: Evidence output must be a regular file');
    expect(result.stderr).not.toContain(outsideRoot);
  });

  test('fails closed when graph edge count is missing', () => {
    const root = makeRoot();
    writeEvidence(root, validationPlan({
      graphImpact: {
        seed: { kind: 'file', value: 'src/example.ts' },
        requestedEdges: ['imports', 'callers'],
        evidence: [
          { edge: 'imports', status: 'evidence' },
          { edge: 'callers', count: 0, status: 'empty_or_unavailable' },
        ],
        limitations: [],
      },
    }));

    const result = runComparison(root);
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'validation-plan-comparison.json'), 'utf8'));

    expect(report.ok).toBe(false);
    expect(report.drift.some((item: any) => item.actual.graphImpactValidationFailures.includes('graph_edge_count_invalid'))).toBe(true);
  });
});
