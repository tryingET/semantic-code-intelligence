import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = 'scripts/summarize-evidence-review.ts';
const sampleOutputFixture = 'tests/fixtures/evidence-review-claim-model-sample.json';

function sampleValidationPlan() {
  return {
    schema: 'semantic-code-intelligence.validation_plan.v1',
    workflow: 'patch_checks_in_snapshot',
    status: 'checks_passed',
    touchedFiles: ['src/example.ts'],
    risk: { level: 'low', category: 'source_change' },
    commands: {
      selected: ['bun test tests/example.test.ts'],
      recommendedMinimum: ['bun run typecheck'],
      recommendedBroader: ['bun run typecheck', 'bun test'],
      recommendationsAppliedToSelected: false,
    },
    checks: { ok: true, elapsedMs: 42, commands: [{ command: 'bun test tests/example.test.ts', ok: true }] },
    graphImpact: {
      hasImpactEvidence: false,
      counts: { imports: 0, exports: 0, callers: 0, callees: 0 },
      limitations: ['fallback: graph expand unavailable'],
      planningHints: ['inspect callers manually if risk increases'],
    },
    artifacts: { overlayDiff: 'snapshot://example/overlay.diff', status: 'snapshot://example/status' },
    rollback: {},
    apply: { applied: false },
  };
}

function runSummary(input: unknown, args: string[], dir = mkdtempSync(join(tmpdir(), 'sci-evidence-review-'))) {
  const inputPath = join(dir, 'input.json');
  writeFileSync(inputPath, JSON.stringify(input, null, 2));
  const result = spawnSync('bun', ['run', script, '--input', inputPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return { stdout: result.stdout, dir };
}

function assertClaimModel(review: any) {
  expect(review.schema).toBe('semantic-code-intelligence.evidence_review.v1');
  expect(review.claims.length).toBeGreaterThanOrEqual(4);
  expect(review.authorityBoundaries.length).toBeGreaterThanOrEqual(3);
  expect(review.operatorDecisionPoints.length).toBeGreaterThanOrEqual(2);

  expect(review.claims.map((claim: any) => claim.id)).toContain('checks-result');
  expect(review.claims.map((claim: any) => claim.id)).toContain('command-distinction');
  expect(review.authorityBoundaries.map((boundary: any) => boundary.id)).toContain('not-production-readiness');
  expect(review.operatorDecisionPoints.map((point: any) => point.id)).toContain('continue-or-stop');

  const statuses = review.evidenceArtifacts.map((artifact: any) => artifact.observedStatus);
  expect(statuses).toContain('observed');
  expect(statuses).toContain('unknown');
  expect(statuses).toContain('unavailable');
  for (const status of statuses) {
    expect(['observed', 'failed', 'unavailable', 'unknown', 'inapplicable']).toContain(status);
  }

  const durabilities = review.evidenceArtifacts.map((artifact: any) => artifact.durability);
  expect(durabilities).toContain('ephemeral');
  expect(durabilities).toContain('authority_durable');
  for (const artifact of review.evidenceArtifacts) {
    expect(['ephemeral', 'reproducible_local', 'materialized_local', 'repo_durable', 'authority_durable']).toContain(artifact.durability);
    expect(typeof artifact.citationRequirement).toBe('string');
    expect(artifact.citationRequirement.length).toBeGreaterThan(0);
  }
}

describe('evidence review claim model', () => {
  test('JSON output exposes first-class claims, boundaries, decision points, and absence states', () => {
    const { stdout } = runSummary(sampleValidationPlan(), ['--format', 'json']);
    const review = JSON.parse(stdout);

    assertClaimModel(review);
  });

  test('committed sample normalized JSON proves the claim model', () => {
    const review = JSON.parse(readFileSync(sampleOutputFixture, 'utf8'));
    assertClaimModel(review);
    expect(review.source.kind).toBe('validation_plan');
    expect(review.claims.find((claim: any) => claim.id === 'preview-boundary')?.status).toBe('weakened');
  });

  test('markdown output renders claim model sections', () => {
    const { stdout: output } = runSummary(sampleValidationPlan(), ['--format', 'markdown']);

    expect(output).toContain('### Review claims');
    expect(output).toContain('checks-result: supported');
    expect(output).toContain('### Authority boundaries');
    expect(output).toContain('not-production-readiness');
    expect(output).toContain('### Operator decision points');
    expect(output).toContain('continue-or-stop');
    expect(output).toContain('### Evidence artifact durability');
    expect(output).toContain('snapshot:// references are pointers, not durable proof');
  });

  test('summary renderer is read-only for workspace and input directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sci-evidence-review-readonly-'));
    const beforeDir = readdirSync(dir).sort();
    const beforeGit = spawnSync('git', ['status', '--short'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;

    runSummary(sampleValidationPlan(), ['--format', 'json'], dir);
    runSummary(sampleValidationPlan(), ['--format', 'markdown'], dir);

    const afterDir = readdirSync(dir).sort();
    const afterGit = spawnSync('git', ['status', '--short'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;

    expect(afterDir).toEqual(beforeDir.concat('input.json').sort());
    expect(afterGit).toBe(beforeGit);
  });

  test('summary implementation does not import mutation-capable runtime surfaces', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).not.toContain('writeFileSync');
    expect(source).not.toContain('appendFileSync');
    expect(source).not.toContain('spawnSync');
    expect(source).not.toContain('child_process');
    expect(source).not.toContain('bun:sqlite');
  });
});
