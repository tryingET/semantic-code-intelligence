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

function makeEvidenceRoot(overrides: Record<string, unknown> = {}, baselineOverrides: Record<string, unknown> = {}, options: { insideWorkspace?: boolean } = {}) {
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
    [evidenceNames.alpha]: { ok: true, summary: [{ name: 'read_file', success: true, elapsedMs: 10, observation: 'bounded read' }] },
    [evidenceNames.selfHosted]: { ok: true, calls: [{ name: 'read_file', success: true, elapsedMs: 10, observation: 'bounded read' }] },
    [evidenceNames.structural]: { ok: true, calls: [{ name: 'structural_search', success: true, elapsedMs: 10, observation: 'structural query' }] },
    [evidenceNames.graph]: { ok: true, calls: [{ name: 'graph_expand', success: true, elapsedMs: 10, observation: 'graph query' }] },
    [evidenceNames.recommendChecks]: { ok: true, calls: [{ name: 'recommend_checks', success: true, elapsedMs: 10, observation: 'check recommendation' }] },
    [evidenceNames.safeWrite]: { ok: true, calls: [{ name: 'safe_write', success: true, elapsedMs: 10, observation: 'safe write preview' }] },
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
          { name: 'find_definition', success: true, elapsedMs: 1800, observation: 'Resolve definition without /tmp/secret-token SECRET_KEY=abc' },
        ],
      },
    });

    const result = runHistory(root, baselinePath);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);

    expect(report.ok).toBe(true);
    expect(report.operatorSummary.status).toBe('historical_latency_warning');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({ key: 'alpha', status: 'slower_than_baseline', likelyArea: 'navigation_resolution' });
    expect(report.warnings[0].slowestCall).toMatchObject({ name: 'find_definition', elapsedMs: 1800 });
    expect(report.warnings[0].slowestCall.observation).toContain('<redacted-secret>');
    expect(report.operatorSummary.warningDetails[0]).toMatchObject({ key: 'alpha', call: 'find_definition', likelyArea: 'navigation_resolution' });
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
        summary: [{ name: maliciousCallName, success: true, elapsedMs: 1800, observation: 'slow malicious name' }],
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

  test('overlapping structural check workflow names classify as validation rather than structural matching', () => {
    const { root, baselinePath } = makeEvidenceRoot({
      [evidenceNames.structural]: {
        ok: true,
        calls: [
          { name: 'structural_search', success: true, elapsedMs: 1200, observation: 'pure ast-grep query' },
          { name: 'structural_patch_checks', success: true, elapsedMs: 1900, observation: 'Verify omitted commands default to the tsgo-primary bun run typecheck lane.' },
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
        calls: [{ name: 'structural_search', success: true, elapsedMs: 1800, observation: 'pure ast-grep query' }],
      },
      [evidenceNames.recommendChecks]: {
        ok: true,
        calls: [{ name: 'recommend_checks', success: true, elapsedMs: 1700, observation: 'large caller-provided patch summary' }],
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
    expect(report.comparisons[0].sourceFile).toMatch(/^\.test-results\/alpha-history-fixture-.+\/alpha-mvp-dogfood\.json$/);
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
});
