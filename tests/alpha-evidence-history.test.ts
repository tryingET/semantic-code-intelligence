import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tempRoots: string[] = [];

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

function makeEvidenceRoot(overrides: Record<string, unknown> = {}, baselineOverrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sci-alpha-history-'));
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
