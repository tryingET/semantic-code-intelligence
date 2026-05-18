#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const outputPath = '.test-results/target-validation-plan-dogfood.json';

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : null;
}

const targetCwdArg = argValue('--target-cwd');
const command = argValue('--command') || process.env.SCI_DOGFOOD_COMMAND || 'semantic-code-intelligence';
const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');

if (!targetCwdArg) {
  console.error('Usage: bun run scripts/dogfood-target-validation-plan.ts --target-cwd <non-SCI-repo> [--command semantic-code-intelligence]');
  process.exit(2);
}

const sciRepo = resolve(process.cwd());
const targetCwd = resolve(targetCwdArg);
if (targetCwd === sciRepo) {
  console.error('target cwd must be a non-SCI repository');
  process.exit(2);
}

function run(commandLine: string, cwd = targetCwd) {
  return spawnSync('bash', ['-lc', commandLine], { cwd, encoding: 'utf8', env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true' } });
}

function git(args: string) {
  const proc = run(`git ${args}`);
  return { status: proc.status, stdout: String(proc.stdout || ''), stderr: String(proc.stderr || '') };
}

function gitFiles(patterns = ''): string[] {
  const proc = git(`ls-files ${patterns}`);
  return proc.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseWorkflowStdout(stdout: string) {
  const raw = JSON.parse(stdout.trim() || '{}');
  const text = raw?.content?.[0]?.text;
  return typeof text === 'string' ? JSON.parse(text) : raw;
}

function workflow(name: string, args: Record<string, unknown>, observation: string) {
  const started = Date.now();
  const proc = spawnSync(command, ['workflow', name, '--args', JSON.stringify(args), '--json'], {
    cwd: targetCwd,
    encoding: 'utf8',
    env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true' },
  });
  let payload: any = null;
  try {
    payload = parseWorkflowStdout(String(proc.stdout || ''));
  } catch {
    payload = { stdout: String(proc.stdout || '').slice(0, 1000), stderr: String(proc.stderr || '').slice(0, 1000) };
  }
  const stderr = String(proc.stderr || '');
  return {
    name,
    args: { ...args, patch: typeof args.patch === 'string' ? '<diff omitted>' : args.patch },
    exitCode: proc.status,
    success: proc.status === 0 && payload && typeof payload === 'object' && !stderr.includes('Error:'),
    elapsedMs: Date.now() - started,
    stderrClean: !stderr.includes('[HTTP Server]') && !stderr.includes('Error:'),
    observation,
    payload,
  };
}

function unifiedPatch(file: string, original: string, modified: string) {
  const before = '/tmp/sci-target-dogfood-before';
  const after = '/tmp/sci-target-dogfood-after';
  writeFileSync(before, original);
  writeFileSync(after, modified);
  const diff = spawnSync('diff', ['-u', '--label', `a/${file}`, '--label', `b/${file}`, before, after], { encoding: 'utf8' });
  const body = String(diff.stdout || '');
  return `diff --git a/${file} b/${file}\n${body.endsWith('\n') ? body : `${body}\n`}`;
}

function cleanupSnapshot(snapshot: string | undefined, removeOntologyRoot: boolean) {
  if (removeOntologyRoot) {
    rmSync(resolve(targetCwd, '.ontology'), { recursive: true, force: true });
    return;
  }
  if (!snapshot || !/^[a-f0-9-]+$/i.test(snapshot)) return;
  const snapshotDir = resolve(targetCwd, '.ontology', 'snapshots', snapshot);
  rmSync(snapshotDir, { recursive: true, force: true });
  const snapshotsDir = resolve(targetCwd, '.ontology', 'snapshots');
  try { rmSync(snapshotsDir, { recursive: false }); } catch {}
}

const beforeStatus = git('status --short').stdout.trim();
const isGitRepo = git('rev-parse --is-inside-work-tree').stdout.trim() === 'true';
const targetLabel = basename(targetCwd);
const beforeOntologyExists = existsSync(resolve(targetCwd, '.ontology'));

const markdown = gitFiles('README.md docs/*.md *.md');
const readPath = markdown.find((file) => file === 'README.md') || markdown[0] || gitFiles('package.json')[0];
const sourceFile = gitFiles("'*.ts' 'src/**/*.ts' 'packages/**/*.ts'").find((file) => !file.endsWith('.d.ts'));

const calls: any[] = [];
let patchSnapshot: string | undefined;
let cleanupAttempted = false;

if (!isGitRepo || beforeStatus || !readPath || !sourceFile) {
  const evidence = {
    schema: 'semantic-code-intelligence.target_validation_plan_dogfood.v1',
    ok: false,
    target: { label: targetLabel, nonSciRepo: targetCwd !== sciRepo, cleanBefore: beforeStatus === '', hasReadPath: !!readPath, hasSourceFile: !!sourceFile },
    failure: !isGitRepo ? 'target_not_git_repo' : beforeStatus ? 'target_not_clean' : !readPath ? 'no_read_path' : 'no_source_file',
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, pretty ? 2 : 0));
  process.exit(1);
}

const read = workflow('read_file', { path: readPath, range: { startLine: 1, endLine: 20 } }, 'Read bounded context from the target repo using installed/global SCI from target cwd.');
calls.push(read);

const graph = workflow('graph_expand', { file: sourceFile, edges: ['imports', 'exports', 'callers', 'callees'], depth: 1, limit: 30 }, 'Collect graph impact evidence from a target-relative source file.');
calls.push(graph);

const recommend = workflow('recommend_checks', { files: [sourceFile], impactSummary: graph.payload?.impactSummary, mode: 'broader' }, 'Recommend validation checks from target-relative touched files and graph impact.');
calls.push(recommend);

const original = readFileSync(resolve(targetCwd, sourceFile), 'utf8');
const marker = '// SCI_TARGET_VALIDATION_PLAN_DOGFOOD_PREVIEW_ONLY';
const patch = unifiedPatch(sourceFile, original, `${original.trimEnd()}\n${marker}\n`);
const patchChecks = workflow('patch_checks_in_snapshot', { patch, commands: ['true'], timeoutSec: 30, recommendChecks: true, impactSummary: graph.payload?.impactSummary }, 'Preview/check a target-relative patch and return validationPlan evidence without mutating target source.');
calls.push(patchChecks);
patchSnapshot = typeof patchChecks.payload?.snapshot === 'string' ? patchChecks.payload.snapshot : undefined;
cleanupSnapshot(patchSnapshot, !beforeOntologyExists);
cleanupAttempted = true;

const afterStatus = git('status --short').stdout.trim();
const afterOntologyExists = existsSync(resolve(targetCwd, '.ontology'));
const validationPlan = patchChecks.payload?.validationPlan;
const evidence = {
  schema: 'semantic-code-intelligence.target_validation_plan_dogfood.v1',
  ok:
    calls.every((call) => call.success) &&
    beforeStatus === '' &&
    afterStatus === '' &&
    validationPlan?.schema === 'semantic-code-intelligence.validation_plan.v1' &&
    validationPlan?.commands?.recommendationsAppliedToSelected === false &&
    validationPlan?.checks?.ok === true &&
    patchChecks.payload?.checkRecommendations?.workflow === 'recommend_checks' &&
    graph.payload?.impactSummary?.requestedEdges?.includes('imports'),
  target: {
    label: targetLabel,
    nonSciRepo: targetCwd !== sciRepo,
    cleanBefore: beforeStatus === '',
    cleanAfter: afterStatus === '',
    beforeOntologyExists,
    afterOntologyExists,
    cleanupAttempted,
  },
  selectedPaths: { readPath, sourceFile },
  cli: { command, cwdModel: 'target_repo_cwd', argsUseTargetRelativePaths: true },
  assertions: {
    graphImpactPresent: !!graph.payload?.impactSummary,
    recommendationsPresent: patchChecks.payload?.checkRecommendations?.workflow === 'recommend_checks',
    validationPlanPresent: validationPlan?.schema === 'semantic-code-intelligence.validation_plan.v1',
    recommendationsAdvisory: validationPlan?.commands?.recommendationsAppliedToSelected === false,
    previewChecksPassed: validationPlan?.checks?.ok === true,
    targetCleanAfter: afterStatus === '',
  },
  calls: calls.map((call) => ({
    name: call.name,
    args: call.args,
    exitCode: call.exitCode,
    success: call.success,
    elapsedMs: call.elapsedMs,
    stderrClean: call.stderrClean,
    observation: call.observation,
    payload: {
      workflow: call.payload?.workflow,
      ok: call.payload?.ok,
      schemaVersion: call.payload?.schemaVersion,
      impactSummary: call.payload?.impactSummary,
      checkRecommendations: call.payload?.checkRecommendations,
      validationPlan: call.payload?.validationPlan,
      checks: call.payload?.checks ? { ok: call.payload.checks.ok, commands: call.payload.checks.commands, elapsedMs: call.payload.checks.elapsedMs } : undefined,
    },
  })),
  interpretation: {
    proves: [
      'Installed/global SCI can be invoked from a non-SCI target repository cwd.',
      'Target-relative discovery, graph impact, check recommendation, preview/check, and validationPlan evidence compose without mutating target source.',
      'Target working tree remains clean after snapshot artifact cleanup.',
    ],
    does_not_prove: ['Broad external-repository coverage.', 'Production readiness.'],
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
if (jsonMode) process.stdout.write(`${output}\n`);
else console.log(output);
if (!evidence.ok) process.exitCode = 1;
