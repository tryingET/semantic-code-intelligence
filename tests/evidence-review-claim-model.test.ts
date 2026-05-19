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

function clonePlan(overrides: Record<string, unknown> = {}) {
  return { ...JSON.parse(JSON.stringify(sampleValidationPlan())), ...overrides };
}

function artifactById(review: any, id: string) {
  return review.evidenceArtifacts.find((artifact: any) => artifact.id === id);
}

function claimById(review: any, id: string) {
  return review.claims.find((claim: any) => claim.id === id);
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
  expect(durabilities).toContain('reproducible_local');
  expect(artifactById(review, 'validation-execution')?.durability).not.toBe('authority_durable');
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

  test('checks cannot be supported without observed selected command evidence', () => {
    const plan = clonePlan({
      commands: { selected: [], recommendedMinimum: ['bun run typecheck'], recommendedBroader: [], recommendationsAppliedToSelected: false },
      checks: { ok: true, elapsedMs: 42 },
    });
    const { stdout } = runSummary(plan, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(artifactById(review, 'validation-execution')?.observedStatus).toBe('unavailable');
    expect(artifactById(review, 'validation-execution')?.durability).toBe('ephemeral');
    expect(claimById(review, 'checks-result')?.status).toBe('unresolved');
    expect(claimById(review, 'checks-result')?.limitedBy).toContain('validation-execution');
  });

  test('validation execution is not authority durable without explicit AK evidence', () => {
    const { stdout } = runSummary(sampleValidationPlan(), ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(artifactById(review, 'validation-execution')?.observedStatus).toBe('observed');
    expect(artifactById(review, 'validation-execution')?.durability).toBe('reproducible_local');
    expect(artifactById(review, 'validation-execution')?.citationRequirement).toContain('local summary output alone is not authority-durable evidence');
  });

  test('selected recommendations remain structurally distinct when command strings overlap', () => {
    const plan = clonePlan({
      commands: {
        selected: ['bun run typecheck'],
        recommendedMinimum: ['bun run typecheck'],
        recommendedBroader: ['bun run typecheck', 'bun test'],
        recommendationsAppliedToSelected: true,
      },
    });
    const { stdout } = runSummary(plan, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(review.commands.selected).toEqual(['bun run typecheck']);
    expect(review.commands.recommendedMinimum).toEqual(['bun run typecheck']);
    expect(review.commands.recommendationsAppliedToSelected).toBe(true);
    expect(claimById(review, 'command-distinction')?.status).toBe('supported');
  });

  test('absent graph evidence is rendered as a visible limitation', () => {
    const plan = clonePlan({
      graphImpact: { hasImpactEvidence: false, counts: {}, limitations: [], planningHints: [] },
    });
    const { stdout } = runSummary(plan, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(review.graphImpact.limitations).toContain('graph impact evidence unavailable or not observed; do not infer no impact from absence');
    expect(claimById(review, 'graph-limitations')?.status).toBe('weakened');

    const { stdout: markdown } = runSummary(plan, ['--format', 'markdown']);
    expect(markdown).toContain('graph impact evidence unavailable or not observed; do not infer no impact from absence');
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
