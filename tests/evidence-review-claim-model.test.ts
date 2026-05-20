import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = 'scripts/summarize-evidence-review.ts';
const sampleOutputFixture = 'tests/fixtures/evidence-review-claim-model-sample.json';
const testArtifactRoot = join(process.cwd(), '.test-results', 'evidence-review-tests');

function cleanupTestArtifacts() {
  rmSync(testArtifactRoot, { recursive: true, force: true });
}

cleanupTestArtifacts();
afterAll(cleanupTestArtifacts);

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
      seed: { kind: 'file', value: 'src/example.ts' },
      languageSupport: { language: 'typescript', support: 'tree_sitter_best_effort', supportedEdges: ['imports', 'exports', 'callers', 'callees'] },
      backend: 'tree_sitter',
      freshness: 'current',
      requestedEdges: ['imports', 'exports', 'callers'],
      hasImpactEvidence: false,
      counts: { imports: 0, exports: 0, callers: 0, callees: 0 },
      evidence: [
        { edge: 'imports', count: 0, status: 'empty_or_unavailable', limitations: [] },
        { edge: 'exports', count: 0, status: 'empty_or_unavailable', limitations: [] },
        { edge: 'callers', count: 0, status: 'limited', limitations: ['callers: fallback-shaped evidence'] },
      ],
      limitations: ['fallback: graph expand unavailable'],
      callerContextCount: 0,
      planningHints: ['inspect callers manually if risk increases'],
    },
    artifacts: { overlayDiff: 'snapshot://example/overlay.diff', status: 'snapshot://example/status' },
    rollback: {},
    apply: { applied: false },
  };
}

function workspaceTempDir(prefix: string) {
  mkdirSync(testArtifactRoot, { recursive: true });
  return mkdtempSync(join(testArtifactRoot, prefix));
}

function runSummary(input: unknown, args: string[], dir = workspaceTempDir('case-')) {
  const inputPath = join(dir, 'input.json');
  writeFileSync(inputPath, JSON.stringify(input, null, 2));
  const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return { stdout: result.stdout, dir, inputPath };
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
  expect(review.limitations.length).toBeGreaterThanOrEqual(1);
  expect(review.authorityBoundaries.length).toBeGreaterThanOrEqual(3);
  expect(review.operatorDecisionPoints.length).toBeGreaterThanOrEqual(2);

  expect(review.limitations.map((limitation: any) => limitation.id)).toContain('graph-impact-limitation-1');
  expect(review.limitations[0].sourceArtifact).toBe('graph-impact');
  expect(review.limitations[0].affectsClaims).toContain('graph-limitations');
  expect(review.limitations[0].affectsDecisionPoints).toContain('continue-or-stop');
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

  test('committed sample normalized JSON proves and matches the current claim model', () => {
    const review = JSON.parse(readFileSync(sampleOutputFixture, 'utf8'));
    const { stdout } = runSummary(sampleValidationPlan(), ['--format', 'json']);
    const currentReview = JSON.parse(stdout);

    assertClaimModel(review);
    expect(review).toEqual(currentReview);
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
    expect(output).toContain('### First-class limitations');
    expect(output).toContain('graph-impact-limitation-1');
    expect(output).toContain('Selected commands declared for validation:');
    expect(output).not.toContain('Selected commands actually run:');
    expect(output).toContain('Command receipts:');
    expect(output).toContain('bun test tests/example.test.ts — ok=true; exitCode=not recorded; timedOut=false; elapsedMs=not recorded');
    expect(output).toContain('Requested edges:');
    expect(output).toContain('- callers');
    expect(output).toContain('Edge evidence/status:');
    expect(output).toContain('callers — status=limited; count=0; limitations=callers: fallback-shaped evidence');
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
    expect(claimById(review, 'command-distinction')?.supportedBy).toEqual(['source']);
    expect(claimById(review, 'checks-result')?.limitedBy).toContain('validation-execution-limitation-1');
    expect(review.limitations.find((item: any) => item.id === 'validation-execution-limitation-1')).toMatchObject({
      sourceArtifact: 'validation-execution',
      affectsClaims: ['checks-result'],
    });
  });

  test('alpha packet bundle gate does not masquerade as selected command execution', () => {
    const packet = {
      schema: 'semantic-code-intelligence.alpha_evidence_packet.v1',
      ok: true,
      evidenceGate: { ok: true, failedChecks: [] },
      previewFirstMutation: {
        validationPlanSample: {
          schema: 'semantic-code-intelligence.validation_plan.v1',
          workflow: 'patch_checks_in_snapshot',
          commands: { selected: ['echo claimed but not evidenced'], recommendedMinimum: [], recommendedBroader: [], recommendationsAppliedToSelected: false },
          checks: {},
          apply: { applied: false },
        },
      },
    };
    const { stdout } = runSummary(packet, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(review.outcome.ok).toBe(true);
    expect(review.checks.bundleGateOk).toBe(true);
    expect(review.checks.ok).toBeNull();
    expect(artifactById(review, 'validation-execution')?.observedStatus).toBe('unavailable');
    expect(claimById(review, 'checks-result')?.status).toBe('unresolved');
  });

  test('alpha packet does not erase embedded applied validation plan posture', () => {
    const packet = {
      schema: 'semantic-code-intelligence.alpha_evidence_packet.v1',
      ok: true,
      previewFirstMutation: {
        validationPlanSample: clonePlan({
          status: 'applied',
          apply: { applied: true },
          rollback: { command: 'git apply -R .test-results/example.patch' },
        }),
      },
    };
    const { stdout } = runSummary(packet, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(review.outcome.applied).toBe(true);
    expect(review.outcome.previewOnly).toBe(false);
    expect(review.safety.sourceMutated).toBe(true);
    expect(review.rollback.available).toBe(true);
  });

  test('selected checks require concrete executed command entries before support', () => {
    const plan = clonePlan({
      commands: { selected: ['bun test tests/example.test.ts'], recommendedMinimum: [], recommendedBroader: [], recommendationsAppliedToSelected: false },
      checks: { ok: true, elapsedMs: 42 },
    });
    const { stdout } = runSummary(plan, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(artifactById(review, 'validation-execution')?.observedStatus).toBe('unavailable');
    expect(claimById(review, 'checks-result')?.status).toBe('unresolved');
  });

  test('selected check command failure contradicts aggregate clean-pass claims', () => {
    const plan = clonePlan({
      commands: { selected: ['bun test tests/example.test.ts'], recommendedMinimum: [], recommendedBroader: [], recommendationsAppliedToSelected: false },
      checks: { ok: true, elapsedMs: 42, commands: [{ command: 'bun test tests/example.test.ts', ok: false }] },
    });
    const { stdout } = runSummary(plan, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(artifactById(review, 'validation-execution')?.observedStatus).toBe('failed');
    expect(claimById(review, 'checks-result')?.status).toBe('contradicted');
    expect(review.limitations.find((item: any) => item.id === 'validation-execution-limitation-1')?.severity).toBe('blocking');
  });

  test('duplicate selected commands consume distinct execution evidence entries', () => {
    const plan = clonePlan({
      commands: { selected: ['bun test tests/example.test.ts', 'bun test tests/example.test.ts'], recommendedMinimum: [], recommendedBroader: [], recommendationsAppliedToSelected: false },
      checks: {
        ok: true,
        elapsedMs: 42,
        commands: [
          { command: 'bun test tests/example.test.ts', ok: true },
          { command: 'bun test tests/example.test.ts', ok: false },
        ],
      },
    });
    const { stdout } = runSummary(plan, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(artifactById(review, 'validation-execution')?.observedStatus).toBe('failed');
    expect(claimById(review, 'checks-result')?.status).toBe('contradicted');
  });

  test('missing check result is unavailable rather than failed', () => {
    const plan = clonePlan({
      commands: { selected: ['echo claimed'], recommendedMinimum: [], recommendedBroader: [], recommendationsAppliedToSelected: false },
      checks: {},
      graphImpact: { hasImpactEvidence: true, counts: {}, limitations: [], planningHints: [] },
    });
    const { stdout } = runSummary(plan, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(artifactById(review, 'validation-execution')?.observedStatus).toBe('unavailable');
    expect(claimById(review, 'checks-result')?.status).toBe('unresolved');
    expect(claimById(review, 'checks-result')?.status).not.toBe('contradicted');
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
    expect(review.limitations[0]).toMatchObject({
      id: 'graph-impact-limitation-1',
      limitation: 'graph impact evidence unavailable or not observed; do not infer no impact from absence',
      sourceArtifact: 'graph-impact',
      severity: 'warning',
    });
    expect(claimById(review, 'graph-limitations')?.status).toBe('weakened');
    expect(claimById(review, 'graph-limitations')?.limitedBy).toEqual(['graph-impact-limitation-1']);

    const { stdout: markdown } = runSummary(plan, ['--format', 'markdown']);
    expect(markdown).toContain('graph impact evidence unavailable or not observed; do not infer no impact from absence');
  });

  test('alpha packet preserves file-impact graph limitations in review output', () => {
    const packet = {
      schema: 'semantic-code-intelligence.alpha_evidence_packet.v1',
      ok: true,
      graphImpact: {
        fileImpact: { hasImpactEvidence: false, counts: {}, limitations: ['file fallback limitation'], planningHints: [] },
        symbolImpact: { limitations: ['symbol fallback limitation'] },
      },
      previewFirstMutation: { validationPlanSample: sampleValidationPlan() },
    };
    const { stdout } = runSummary(packet, ['--format', 'json']);
    const review = JSON.parse(stdout);

    expect(review.graphImpact.limitations).toContain('file fallback limitation');
    expect(review.graphImpact.limitations).toContain('symbol fallback limitation');
  });

  test('markdown output neutralizes forged headings and links in caller-controlled command text', () => {
    const forgedCommand = 'true\n## FORGED CHECK STATUS\n[secret](file:///tmp/secret)';
    const plan = clonePlan({
      commands: { selected: [forgedCommand], recommendedMinimum: [forgedCommand], recommendedBroader: [], recommendationsAppliedToSelected: false },
      checks: { ok: true, elapsedMs: 42, commands: [{ command: forgedCommand, ok: true }] },
    });
    const { stdout: output } = runSummary(plan, ['--format', 'markdown']);

    expect(output).toContain('true ⏎ ## FORGED CHECK STATUS ⏎ \\[secret\\]\\(file:///tmp/secret\\)');
    expect(output).toContain('true ⏎ ## FORGED CHECK STATUS ⏎ \\[secret\\]\\(file:///tmp/secret\\) — ok=true; exitCode=not recorded; timedOut=false; elapsedMs=not recorded');
    expect(output).not.toContain('[secret](file:///tmp/secret)');
  });

  test('markdown output neutralizes forged headings and inline markdown in untrusted limitation text', () => {
    const plan = clonePlan({
      graphImpact: {
        hasImpactEvidence: false,
        counts: {},
        limitations: ['</li>\n\n## FORGED GREEN STATUS\n- **Production-ready: true**\n- [Applied](file:///tmp/secret)'],
        planningHints: [],
      },
    });
    const { stdout: markdown } = runSummary(plan, ['--format', 'markdown']);

    expect(markdown).toContain('&lt;/li&gt; ⏎  ⏎ ## FORGED GREEN STATUS ⏎ - \\*\\*Production-ready: true\\*\\* ⏎ - \\[Applied\\]\\(file:///tmp/secret\\)');
    expect(markdown).not.toContain('\n## FORGED GREEN STATUS');
    expect(markdown).not.toContain('**Production-ready: true**');
    expect(markdown).not.toContain('[Applied](file:///tmp/secret)');
  });

  test('markdown output neutralizes graph seed and edge evidence text', () => {
    const plan = clonePlan({
      graphImpact: {
        seed: { kind: 'file', value: 'src/example.ts\n## FORGED GRAPH SEED\n[secret](file:///tmp/secret)' },
        languageSupport: { language: 'typescript', support: 'tree_sitter_best_effort', supportedEdges: ['imports\n## FORGED EDGE'] },
        backend: 'tree_sitter\n## FORGED BACKEND',
        freshness: 'current',
        requestedEdges: ['imports\n## FORGED REQUESTED EDGE\n[secret](file:///tmp/secret)'],
        counts: {},
        evidence: [{ edge: 'imports\n## FORGED EDGE STATUS', count: 0, status: 'limited\n## GREEN', limitations: ['**safe**\n[secret](file:///tmp/secret)'] }],
        limitations: [],
        callerContextCount: 0,
        planningHints: [],
      },
    });
    const { stdout: markdown } = runSummary(plan, ['--format', 'markdown']);

    expect(markdown).toContain('src/example.ts ⏎ ## FORGED GRAPH SEED ⏎ \\[secret\\]\\(file:///tmp/secret\\)');
    expect(markdown).toContain('imports ⏎ ## FORGED REQUESTED EDGE ⏎ \\[secret\\]\\(file:///tmp/secret\\)');
    expect(markdown).toContain('imports ⏎ ## FORGED EDGE STATUS — status=limited ⏎ ## GREEN; count=0; limitations=\\*\\*safe\\*\\* ⏎ \\[secret\\]\\(file:///tmp/secret\\)');
    expect(markdown).not.toContain('\n## FORGED GRAPH SEED');
    expect(markdown).not.toContain('\n## FORGED REQUESTED EDGE');
    expect(markdown).not.toContain('[secret](file:///tmp/secret)');
    expect(markdown).not.toContain('**safe**');
  });

  test('markdown output neutralizes target status preserved text', () => {
    const packet = {
      schema: 'semantic-code-intelligence.alpha_evidence_packet.v1',
      ok: true,
      target: { statusPreserved: 'yes\n## TARGET FORGED STATUS\n[secret](file:///tmp/secret)' },
      previewFirstMutation: { validationPlanSample: sampleValidationPlan() },
    };
    const { stdout: markdown } = runSummary(packet, ['--format', 'markdown']);

    expect(markdown).toContain('yes ⏎ ## TARGET FORGED STATUS ⏎ \\[secret\\]\\(file:///tmp/secret\\)');
    expect(markdown).not.toContain('\n## TARGET FORGED STATUS');
    expect(markdown).not.toContain('[secret](file:///tmp/secret)');
  });

  test('summary rejects oversized evidence inputs before parsing', () => {
    const dir = workspaceTempDir('large-');
    const inputPath = join(dir, 'large.json');
    writeFileSync(inputPath, `{"schema":"semantic-code-intelligence.validation_plan.v1","padding":"${'x'.repeat(10 * 1024 * 1024)}"}`);

    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Evidence input too large');
  });

  test('summary rejects evidence inputs outside the workspace without leaking contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sci-evidence-review-outside-'));
    const inputPath = join(dir, 'outside.json');
    writeFileSync(inputPath, JSON.stringify({ ...sampleValidationPlan(), graphImpact: { limitations: ['outside-secret-marker'] } }));

    const result = spawnSync('bun', ['run', script, '--input', inputPath, '--format', 'markdown'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Evidence input must stay within the workspace');
    expect(result.stdout + result.stderr).not.toContain('outside-secret-marker');
  });

  test('summary rejects workspace symlink escapes without leaking target contents', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'sci-evidence-review-symlink-outside-'));
    const outsidePath = join(outsideDir, 'outside.json');
    writeFileSync(outsidePath, JSON.stringify({ ...sampleValidationPlan(), graphImpact: { limitations: ['symlink-secret-marker'] } }));
    const dir = workspaceTempDir('symlink-');
    const linkPath = join(dir, 'input.json');
    symlinkSync(outsidePath, linkPath);

    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), linkPath), '--format', 'markdown'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Evidence input must stay within the workspace');
    expect(result.stdout + result.stderr).not.toContain('symlink-secret-marker');
  });

  test('read boundary succeeds through stat-identity fallback when fd-link paths are unavailable', async () => {
    const { readJson } = await import('../scripts/summarize-evidence-review.ts');
    const dir = workspaceTempDir('fdlink-fallback-');
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, JSON.stringify(sampleValidationPlan()));

    const evidence = readJson(relative(process.cwd(), inputPath), { fdLinkCandidates: [] });

    expect(evidence.schema).toBe('semantic-code-intelligence.validation_plan.v1');
  });

  test('read boundary rejects evidence input replaced after stat before open', async () => {
    const { readJson } = await import('../scripts/summarize-evidence-review.ts');
    const dir = workspaceTempDir('toctou-replace-');
    const inputPath = join(dir, 'input.json');
    const replacementPath = join(dir, 'replacement.json');
    writeFileSync(inputPath, JSON.stringify(sampleValidationPlan()));
    writeFileSync(replacementPath, JSON.stringify({ ...sampleValidationPlan(), graphImpact: { limitations: ['replacement-secret-marker'] } }));

    expect(() => readJson(relative(process.cwd(), inputPath), {
      afterInitialStat: () => renameSync(replacementPath, inputPath),
    })).toThrow('Evidence input changed while it was being opened');
  });

  test('read boundary rejects evidence input mutated after open before read', async () => {
    const { readJson } = await import('../scripts/summarize-evidence-review.ts');
    const dir = workspaceTempDir('toctou-mutate-');
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, JSON.stringify(sampleValidationPlan()));

    expect(() => readJson(relative(process.cwd(), inputPath), {
      afterOpenStat: () => writeFileSync(inputPath, JSON.stringify({ ...sampleValidationPlan(), padding: 'mutated-after-open' })),
    })).toThrow('Evidence input changed while it was being read');
  });

  test('read boundary keeps post-open growth bounded before parsing', async () => {
    const { readJson } = await import('../scripts/summarize-evidence-review.ts');
    const dir = workspaceTempDir('toctou-grow-');
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, JSON.stringify(sampleValidationPlan()));

    expect(() => readJson(relative(process.cwd(), inputPath), {
      afterOpenStat: () => writeFileSync(inputPath, `{"schema":"semantic-code-intelligence.validation_plan.v1","padding":"${'x'.repeat(10 * 1024 * 1024)}"}`),
    })).toThrow('Evidence input too large');
  });

  test('summary rejects missing, unreadable, and non-regular evidence inputs before parsing', () => {
    const dir = workspaceTempDir('nonregular-');
    const missing = join(dir, 'missing.json');
    const missingResult = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), missing), '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(missingResult.status).not.toBe(0);
    expect(missingResult.stderr).toContain('Evidence input is unavailable or unreadable');

    if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
      const unreadable = join(dir, 'unreadable.json');
      writeFileSync(unreadable, JSON.stringify(sampleValidationPlan()));
      chmodSync(unreadable, 0o000);
      const unreadableResult = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), unreadable), '--format', 'json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      chmodSync(unreadable, 0o600);
      expect(unreadableResult.status).not.toBe(0);
      expect(unreadableResult.stderr).toContain('Evidence input is unavailable or unreadable');
    }

    const inputDir = join(dir, 'input-dir.json');
    mkdirSync(inputDir);
    const dirResult = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputDir), '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(dirResult.status).not.toBe(0);
    expect(dirResult.stderr).toContain('Evidence input must be a regular file');
  });

  test('summary rejects FIFO evidence inputs without blocking when mkfifo is available', () => {
    const dir = workspaceTempDir('fifo-');
    const fifoPath = join(dir, 'input.json');
    const mkfifo = spawnSync('mkfifo', [fifoPath], { cwd: process.cwd(), encoding: 'utf8' });
    if (mkfifo.status !== 0) return;

    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), fifoPath), '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 2000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Evidence input must be a regular file');
  });

  test('summary rejects unsupported evidence schemas without reflecting untrusted schema text', () => {
    const dir = workspaceTempDir('bad-schema-');
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, JSON.stringify({ schema: 'schema-secret-marker\n## forged status', ok: true }));

    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('evidence-review: Unsupported evidence schema');
    expect(result.stdout + result.stderr).not.toContain('schema-secret-marker');
    expect(result.stdout + result.stderr).not.toContain('forged status');
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toContain(' at ');
  });

  test('summary rejects missing option values before reading evidence input', () => {
    const result = spawnSync('bun', ['run', script, '--input', '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('evidence-review: Missing value for --input');
    expect(result.stderr).not.toContain('Evidence input is unavailable or unreadable');
  });

  test('summary rejects unsupported formats before parsing input and without reflecting untrusted format text', () => {
    const dir = workspaceTempDir('bad-format-');
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, '{"schema":"semantic-code-intelligence.validation_plan.v1","secret":"format-before-parse-marker", BAD');

    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--format', 'json\n## format-secret-marker'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('evidence-review: Unsupported --format; expected markdown or json');
    expect(result.stdout + result.stderr).not.toContain('format-secret-marker');
    expect(result.stdout + result.stderr).not.toContain('format-before-parse-marker');
    expect(result.stderr).not.toContain(process.cwd());
  });

  test('summary rejects unsupported extract modes before parsing input and without reflecting untrusted extract text', () => {
    const dir = workspaceTempDir('bad-extract-');
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, '{"schema":"semantic-code-intelligence.alpha_evidence_packet.v1","secret":"extract-before-parse-marker", BAD');

    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--extract', 'validationplan\n## extract-secret-marker', '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('evidence-review: Unsupported --extract; expected validationPlan');
    expect(result.stdout + result.stderr).not.toContain('extract-secret-marker');
    expect(result.stdout + result.stderr).not.toContain('extract-before-parse-marker');
    expect(result.stderr).not.toContain(process.cwd());
  });

  test('target dogfood validationPlan extraction uses the same embedded plan search as normalization', () => {
    const evidence = {
      schema: 'semantic-code-intelligence.target_validation_plan_dogfood.v1',
      ok: true,
      target: { label: 'external-target', cleanAfter: true },
      calls: [{ payload: { validationPlan: sampleValidationPlan() } }],
    };
    const { stdout } = runSummary(evidence, ['--extract', 'validationPlan', '--format', 'json']);
    const review = JSON.parse(stdout);

    expect(review.source.kind).toBe('validation_plan');
    expect(review.scope.target.label).toBe('external-target');
    expect(review.outcome.ok).toBe(true);
  });

  test('summary reports malformed JSON without source paths, code frames, or input content', () => {
    const dir = workspaceTempDir('bad-json-');
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, '{"schema":"semantic-code-intelligence.validation_plan.v1","secret":"json-secret-marker", BAD');

    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--format', 'json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('evidence-review: Evidence input is not valid JSON');
    expect(result.stdout + result.stderr).not.toContain('json-secret-marker');
    expect(result.stderr).not.toContain(process.cwd());
    expect(result.stderr).not.toContain('readJson');
  });

  test('summary renderer is read-only for workspace and input directory', () => {
    const dir = workspaceTempDir('readonly-');
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
