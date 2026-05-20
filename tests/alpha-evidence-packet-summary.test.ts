import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const files: Record<string, any> = {
  '.test-results/alpha-mvp-dogfood.json': { ok: true, summary: [{ name: 'read_file', success: true, elapsedMs: 1 }] },
  '.test-results/self-hosted-cli-dogfood.json': {
    ok: true,
    selfHosting: { sciFirstDiscovery: { complete: true, expectedFirstTools: ['read_file'], actualFirstTools: ['read_file'] }, workspaceUnchanged: true },
    calls: [{ name: 'read_file', success: true, elapsedMs: 1 }],
  },
  '.test-results/structural-workflow-dogfood.json': { ok: true, calls: [{ name: 'structural_search', success: true, elapsedMs: 1 }] },
  '.test-results/graph-impact-dogfood.json': {
    ok: true,
    target: 'fixture',
    symbol: 'fixtureSymbol',
    assertions: { limitationsVisible: true },
    impact: { file: { hasImpactEvidence: true, counts: { imports: 1 }, planningHints: [] }, symbol: { limitations: [] } },
    calls: [{ name: 'graph_expand', success: true, elapsedMs: 1 }],
  },
  '.test-results/recommend-checks-dogfood.json': { ok: true, assertions: { recommendationsPresent: true }, calls: [{ name: 'recommend_checks', success: true, elapsedMs: 1 }] },
  '.test-results/safe-write-dogfood.json': {
    ok: true,
    assertions: { fixtureCleanAfterRollback: true, rollbackRestoredExactly: true, mismatchRollbackPreservedPreexistingDirtyChange: true },
    calls: [
      { payload: { mode: 'preview_validate', applied: false, checkRecommendations: { workflow: 'recommend_checks' }, validationPlan: { schema: 'semantic-code-intelligence.validation_plan.v1' } } },
      { payload: { applied: true, verification: { appliedDiffMatchesSnapshot: true, method: 'reverse_git_apply_check' } } },
      { payload: { applied: true, ok: false, verification: { appliedDiffMatchesSnapshot: false, method: 'reverse_git_apply_check' } } },
    ],
  },
  '.test-results/validation-plan-comparison.json': { ok: true, comparedPlanCount: 1, stableFields: [], ignoredVolatileFields: [], drift: [], operatorSummary: {} },
  '.test-results/alpha-evidence-history.json': { ok: true, baseline: {}, comparisonPolicy: {}, comparisons: [], warnings: [], overBudget: [], operatorSummary: {} },
  '.test-results/alpha-evidence-check.json': { ok: true, checks: [{ name: 'fixture', ok: true }], budgetsMs: {} },
};

const backups = new Map<string, string | null>();

function installFixtureFiles() {
  for (const [path, value] of Object.entries(files)) {
    if (!backups.has(path)) backups.set(path, existsSync(path) ? readFileSync(path, 'utf8') : null);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }
}

function restoreFixtureFiles() {
  for (const [path, content] of backups.entries()) {
    if (content === null) rmSync(path, { force: true });
    else writeFileSync(path, content);
  }
  backups.clear();
}

afterAll(restoreFixtureFiles);

describe('alpha evidence packet operator summary', () => {
  test('uses post-closure next-step guidance instead of stale Phase 1 closure guidance', () => {
    installFixtureFiles();
    try {
      const result = spawnSync('bun', ['run', 'scripts/build-alpha-evidence-packet.ts'], { cwd: process.cwd(), encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const packet = JSON.parse(result.stdout);

      expect(packet.operatorSummary.nextRecommendedWave).toContain('Phase 1 is closed');
      expect(packet.operatorSummary.nextRecommendedWave).toContain('Alpha maintenance');
      expect(packet.operatorSummary.nextRecommendedWave).toContain('explicit Phase 2');
      expect(packet.operatorSummary.nextRecommendedWave).not.toContain('before broad Phase 1 closure');
      expect(packet.operatorSummary.nextRecommendedWave).not.toContain('external-repo diversity');
      expect(packet.operatorSummary.doesNotProve).toContain('Authority to reopen Phase 1 dogfood accumulation by default.');
    } finally {
      restoreFixtureFiles();
    }
  });

  test('alpha default validation does not include target dogfood issue capture', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(packageJson.scripts['alpha:mvp:check']).not.toContain('target-dogfood:issue');
    expect(packageJson.scripts['alpha:mvp:check']).not.toContain('target-validation-plan:dogfood');
  });
});
