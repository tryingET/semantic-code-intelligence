import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = 'scripts/capture-target-dogfood-issue.ts';
const testArtifactRoot = join(process.cwd(), '.test-results', 'target-dogfood-issue-tests');

function cleanupTestArtifacts() {
  rmSync(testArtifactRoot, { recursive: true, force: true });
}

cleanupTestArtifacts();
afterAll(cleanupTestArtifacts);

function workspaceTempDir(prefix: string) {
  mkdirSync(testArtifactRoot, { recursive: true });
  return mkdtempSync(join(testArtifactRoot, prefix));
}

function failedEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'semantic-code-intelligence.target_validation_plan_dogfood.v1',
    ok: false,
    target: {
      label: 'example-target',
      nonSciRepo: true,
      cleanBefore: true,
      cleanAfter: true,
      dirtyAllowed: false,
      statusPreserved: true,
      languageCounts: { typescript: 1, javascript: 0, python: 0, rust: 0, clojure: 0 },
    },
    selectedPaths: { readPath: 'README.md', sourceFile: 'src/example.ts', sourceKind: 'typescript' },
    cli: { command: 'semantic-code-intelligence', cwdModel: 'target_repo_cwd', argsUseTargetRelativePaths: true },
    assertions: { validationPlanPresent: false, targetStatusPreserved: true },
    calls: [
      {
        name: 'read_file',
        exitCode: 0,
        success: true,
        elapsedMs: 4,
        stderrClean: true,
        observation: 'bounded read succeeded',
        payload: { workflow: 'read_file', ok: true },
      },
      {
        name: 'patch_checks_in_snapshot',
        exitCode: 1,
        success: false,
        elapsedMs: 42,
        stderrClean: false,
        observation: `failed in ${process.cwd()} with API_TOKEN=super-secret-token and /tmp/outside-target`,
        payload: { workflow: 'patch_checks_in_snapshot', ok: false, checks: { ok: false } },
      },
    ],
    interpretation: { does_not_prove: ['Production readiness.'] },
    ...overrides,
  };
}

function successfulEvidence(overrides: Record<string, unknown> = {}) {
  return failedEvidence({
    ok: true,
    assertions: { validationPlanPresent: true, targetStatusPreserved: true },
    calls: [
      { name: 'read_file', exitCode: 0, success: true, elapsedMs: 4, stderrClean: true, observation: 'bounded read succeeded', payload: { workflow: 'read_file', ok: true } },
      { name: 'patch_checks_in_snapshot', exitCode: 0, success: true, elapsedMs: 20, stderrClean: true, observation: 'preview/check succeeded', payload: { workflow: 'patch_checks_in_snapshot', ok: true, validationPlan: { schema: 'semantic-code-intelligence.validation_plan.v1', status: 'checks_passed' }, checks: { ok: true } } },
    ],
    ...overrides,
  });
}

function writeInput(input: unknown, dir = workspaceTempDir('case-')) {
  const inputPath = join(dir, 'input.json');
  writeFileSync(inputPath, JSON.stringify(input, null, 2));
  return { dir, inputPath };
}

function runCapture(input: unknown, args: string[] = []) {
  const { inputPath, dir } = writeInput(input);
  const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--stdout-only', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return { result, issue: JSON.parse(result.stdout), dir, inputPath };
}

describe('target dogfood issue capture', () => {
  test('captures failed target dogfood as a redacted issue candidate', () => {
    const { issue, result } = runCapture(failedEvidence(), ['--operator-note', `operator saw ${process.cwd()} and SECRET_KEY=abc123`]);

    expect(issue.schema).toBe('semantic-code-intelligence.target_dogfood_issue.v1');
    expect(issue.issueRequired).toBe(true);
    expect(issue.classification.category).toBe('validation_plan_path');
    expect(issue.classification.severity).toBe('blocking');
    expect(issue.symptoms.failedCallCount).toBe(1);
    expect(issue.symptoms.failedCalls[0].name).toBe('patch_checks_in_snapshot');
    expect(issue.safety.sourceMutated).toBe(false);
    expect(issue.safety.targetStatusPreserved).toBe(true);
    expect(issue.authorityBoundaries.join('\n')).toContain('not AK task/evidence authority');
    expect(result.stdout).not.toContain(process.cwd());
    expect(result.stdout).not.toContain('/tmp/outside-target');
    expect(result.stdout).not.toContain('super-secret-token');
    expect(result.stdout).not.toContain('SECRET_KEY=abc123');
    expect(result.stdout).not.toContain('diff --git');
  });

  test('successful target dogfood without operator note is a no-issue capture', () => {
    const { issue } = runCapture(successfulEvidence());

    expect(issue.issueRequired).toBe(false);
    expect(issue.trigger.kind).toBe('none');
    expect(issue.classification.category).toBe('no_issue_detected');
    expect(issue.nextActions.join('\n')).toContain('avoid adding confidence-only dogfood');
  });

  test('operator note can capture friction even when dogfood succeeds', () => {
    const { issue } = runCapture(successfulEvidence(), ['--operator-note', 'graph output was too sparse', '--scenario', 'target graph review']);

    expect(issue.issueRequired).toBe(true);
    expect(issue.trigger.kind).toBe('operator_reported_friction');
    expect(issue.trigger.scenario).toBe('target graph review');
    expect(issue.operatorReport).toBe('graph output was too sparse');
  });

  test('markdown output neutralizes forged headings and inline markdown from operator note', () => {
    const { inputPath } = writeInput(failedEvidence());
    const result = spawnSync('bun', [
      'run',
      script,
      '--input',
      relative(process.cwd(), inputPath),
      '--stdout-only',
      '--format',
      'markdown',
      '--operator-note',
      'ok\n# FORGED DONE [link](file:///tmp/secret)',
    ], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('SCI target dogfood issue candidate');
    expect(result.stdout).not.toContain('\n# FORGED DONE');
    expect(result.stdout).not.toContain('[link](file:///tmp/secret)');
    expect(result.stdout).toContain('FORGED DONE');
  });

  test('writes an output artifact inside the SCI workspace when requested', () => {
    const { inputPath, dir } = writeInput(failedEvidence());
    const outputPath = join(dir, 'issue.json');
    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--output', relative(process.cwd(), outputPath)], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).schema).toBe('semantic-code-intelligence.target_dogfood_issue.v1');
  });

  test('rejects unsupported input schema without reflecting untrusted schema text', () => {
    const { inputPath } = writeInput({ schema: 'evil\n# forged', ok: false });
    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--stdout-only'], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsupported target dogfood evidence schema');
    expect(result.stderr).not.toContain('forged');
  });

  test('rejects oversized evidence input before parsing', () => {
    const dir = workspaceTempDir('oversized-');
    const inputPath = join(dir, 'huge.json');
    writeFileSync(inputPath, `{"schema":"semantic-code-intelligence.target_validation_plan_dogfood.v1","padding":"${'x'.repeat(10 * 1024 * 1024)}"}`);
    const result = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--stdout-only'], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Evidence input too large');
    expect(result.stderr).not.toContain('padding');
  });

  test('rejects input path escapes and symlink escapes without leaking target contents', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'sci-target-issue-outside-'));
    const outsidePath = join(outsideDir, 'evidence.json');
    writeFileSync(outsidePath, JSON.stringify(failedEvidence({ secret: 'outside-secret-marker' })));
    const dir = workspaceTempDir('symlink-');
    const linkPath = join(dir, 'input-link.json');
    symlinkSync(outsidePath, linkPath);

    const symlinkResult = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), linkPath), '--stdout-only'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(symlinkResult.status).not.toBe(0);
    expect(symlinkResult.stderr).toContain('Evidence input must stay within the workspace');
    expect(symlinkResult.stderr).not.toContain('outside-secret-marker');

    const escapeResult = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), outsidePath), '--stdout-only'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(escapeResult.status).not.toBe(0);
    expect(escapeResult.stderr).toContain('Evidence input must stay within the workspace');
    expect(escapeResult.stderr).not.toContain('outside-secret-marker');

    rmSync(outsideDir, { recursive: true, force: true });
  });

  test('rejects output path escapes and output symlinks', () => {
    const { inputPath, dir } = writeInput(failedEvidence());
    const outsideDir = mkdtempSync(join(tmpdir(), 'sci-target-issue-output-'));
    const outsidePath = join(outsideDir, 'issue.json');
    const escapeResult = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--output', outsidePath], { cwd: process.cwd(), encoding: 'utf8' });
    expect(escapeResult.status).not.toBe(0);
    expect(escapeResult.stderr).toContain('Output path must stay within the workspace');

    const linkPath = join(dir, 'issue-link.json');
    writeFileSync(outsidePath, 'outside');
    symlinkSync(outsidePath, linkPath);
    const symlinkResult = spawnSync('bun', ['run', script, '--input', relative(process.cwd(), inputPath), '--output', relative(process.cwd(), linkPath)], { cwd: process.cwd(), encoding: 'utf8' });
    expect(symlinkResult.status).not.toBe(0);
    expect(symlinkResult.stderr).toContain('Output path must not be a symlink');

    rmSync(outsideDir, { recursive: true, force: true });
  });

  test('alpha default validation does not grow confidence-only target dogfood', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(packageJson.scripts['alpha:mvp:check']).not.toContain('target-validation-plan:dogfood');
    expect(packageJson.scripts['alpha:mvp:check']).not.toContain('target-dogfood:issue');
  });
});
