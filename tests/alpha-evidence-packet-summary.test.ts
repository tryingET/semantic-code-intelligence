import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files: Record<string, any> = {
  'alpha-mvp-dogfood.json': { ok: true, summary: [{ name: 'read_file', success: true, elapsedMs: 1 }] },
  'self-hosted-cli-dogfood.json': {
    ok: true,
    selfHosting: { sciFirstDiscovery: { complete: true, expectedFirstTools: ['read_file'], actualFirstTools: ['read_file'] }, workspaceUnchanged: true },
    calls: [{ name: 'read_file', success: true, elapsedMs: 1 }],
  },
  'structural-workflow-dogfood.json': { ok: true, calls: [{ name: 'structural_search', success: true, elapsedMs: 1 }] },
  'graph-impact-dogfood.json': {
    ok: true,
    target: 'fixture',
    symbol: 'fixtureSymbol',
    assertions: { limitationsVisible: true },
    impact: { file: { hasImpactEvidence: true, counts: { imports: 1 }, planningHints: [] }, symbol: { limitations: [] }, callerContext: { callerContextCount: 2 } },
    calls: [{ name: 'graph_expand', success: true, elapsedMs: 1 }],
  },
  'recommend-checks-dogfood.json': { ok: true, assertions: { recommendationsPresent: true }, calls: [{ name: 'recommend_checks', success: true, elapsedMs: 1 }] },
  'safe-write-dogfood.json': {
    ok: true,
    assertions: { fixtureCleanAfterRollback: true, rollbackRestoredExactly: true, mismatchRollbackPreservedPreexistingDirtyChange: true },
    calls: [
      { success: true, payload: { mode: 'preview_validate', applied: false, checkRecommendations: { workflow: 'recommend_checks' }, validationPlan: { schema: 'semantic-code-intelligence.validation_plan.v1' } } },
      { success: true, payload: { applied: true, verification: { appliedDiffMatchesSnapshot: true, method: 'reverse_git_apply_check' } } },
      { success: true, payload: { applied: true, ok: false, verification: { appliedDiffMatchesSnapshot: false, method: 'reverse_git_apply_check' } } },
    ],
  },
  'validation-plan-comparison.json': { ok: true, comparedPlanCount: 1, stableFields: [], ignoredVolatileFields: [], drift: [], operatorSummary: {} },
  'alpha-evidence-history.json': { ok: true, baseline: {}, comparisonPolicy: {}, comparisons: [], warnings: [], overBudget: [], operatorSummary: {} },
  'alpha-evidence-check.json': { ok: true, checks: [{ name: 'fixture', ok: true }], budgetsMs: {} },
};

const tempRoots: string[] = [];

function makeFixtureRoot(overrides: Record<string, any> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sci-alpha-packet-fixture-'));
  tempRoots.push(root);
  const merged = { ...files, ...overrides };
  for (const [name, value] of Object.entries(merged)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

function runPacket(root: string) {
  return spawnSync('bun', ['run', 'scripts/build-alpha-evidence-packet.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SCI_ALPHA_EVIDENCE_ROOT: root },
  });
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('alpha evidence packet operator summary', () => {
  test('uses post-closure next-step guidance instead of stale Phase 1 closure guidance', () => {
    const result = runPacket(makeFixtureRoot());
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);

    expect(packet.operatorSummary.nextRecommendedWave).toContain('Phase 1 is closed');
    expect(packet.operatorSummary.nextRecommendedWave).toContain('Alpha maintenance');
    expect(packet.operatorSummary.nextRecommendedWave).toContain('explicit Phase 2');
    expect(packet.operatorSummary.nextRecommendedWave).not.toContain('before broad Phase 1 closure');
    expect(packet.operatorSummary.nextRecommendedWave).not.toContain('external-repo diversity');
    expect(packet.operatorSummary.doesNotProve).toContain('Authority to reopen Phase 1 dogfood accumulation by default.');
  });

  test('packet preserves caller context for evidence review summaries', () => {
    const result = runPacket(makeFixtureRoot());
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);

    expect(packet.graphImpact.impact.callerContext.callerContextCount).toBe(2);
  });

  test('packet fails closed when top-level source ok flags lack derived safety evidence', () => {
    const hollowOk = Object.fromEntries(Object.keys(files).map((name) => [name, { ok: true }]));
    const result = runPacket(makeFixtureRoot(hollowOk));
    expect(result.status).toBe(1);
    const packet = JSON.parse(result.stdout);

    expect(packet.ok).toBe(false);
    expect(packet.sciFirstDiscovery.ok).toBe(false);
    expect(packet.previewFirstMutation.safeWritePreviewPresent).toBe(false);
    expect(packet.safeWriteVerification.cleanApplyVerified).toBe(false);
    expect(packet.safeWriteVerification.mismatchFailsClosed).toBe(false);
  });

  test('packet fails closed when safe-write evidence payloads exist only on failed calls', () => {
    const failedSafeWrite = JSON.parse(JSON.stringify(files['safe-write-dogfood.json']));
    failedSafeWrite.calls = failedSafeWrite.calls.map((call: any) => ({ ...call, success: false }));
    const result = runPacket(makeFixtureRoot({ 'safe-write-dogfood.json': failedSafeWrite }));
    expect(result.status).toBe(1);
    const packet = JSON.parse(result.stdout);

    expect(packet.ok).toBe(false);
    expect(packet.previewFirstMutation.safeWritePreviewPresent).toBe(false);
    expect(packet.safeWriteVerification.cleanApplyVerified).toBe(false);
    expect(packet.safeWriteVerification.mismatchFailsClosed).toBe(false);
  });

  test('redacts observation strings and source-file paths in generated packet output', () => {
    const result = runPacket(makeFixtureRoot({
      'recommend-checks-dogfood.json': {
        ok: true,
        assertions: { recommendationsPresent: true },
        calls: [{ name: 'recommend_checks', success: true, elapsedMs: 1, observation: `SECRET_KEY=abc123 ${process.cwd()} /tmp/private-target` }],
      },
    }));
    expect(result.status, result.stderr).toBe(0);

    expect(result.stdout).not.toContain('SECRET_KEY=abc123');
    expect(result.stdout).not.toContain(process.cwd());
    expect(result.stdout).not.toContain('/tmp/private-target');
    const packet = JSON.parse(result.stdout);
    expect(packet.checkRecommendations.calls[0].observation).toContain('<redacted-secret>');
  });

  test('alpha default validation does not include target dogfood issue capture', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(packageJson.scripts['alpha:mvp:check']).not.toContain('target-dogfood:issue');
    expect(packageJson.scripts['alpha:mvp:check']).not.toContain('target-validation-plan:dogfood');
  });
});
