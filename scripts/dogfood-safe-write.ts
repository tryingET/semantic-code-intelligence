#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const target = 'tests/fixtures/safe-write-target.md';
const outputPath = '.test-results/safe-write-dogfood.json';
const marker = 'SAFE_WRITE_DOGFOOD_MARKER';
const dirtyMarker = 'SAFE_WRITE_PREEXISTING_DIRTY_MARKER';
const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');

type CallEvidence = {
  name: string;
  scenario: string;
  args: Record<string, unknown>;
  exitCode: number | null;
  success: boolean;
  elapsedMs: number;
  payload: any;
  stderrTail: string;
};

function run(command: string, env: Record<string, string | undefined> = {}) {
  return spawnSync('bash', ['-lc', command], { encoding: 'utf8', env: { ...process.env, ...env } });
}

function parseWorkflowStdout(stdout: string) {
  const raw = JSON.parse(stdout.trim() || '{}');
  const text = raw?.content?.[0]?.text;
  return typeof text === 'string' ? JSON.parse(text) : raw;
}

function callSafeWrite(args: Record<string, unknown>, env: Record<string, string | undefined> = {}, scenario = 'unspecified'): CallEvidence {
  const started = Date.now();
  const proc = spawnSync('bun', ['run', 'src/servers/cli.ts', 'workflow', 'safe_write', '--args', JSON.stringify(args), '--json'], {
    encoding: 'utf8',
    env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true', ...env },
  });
  let payload: any = null;
  try {
    payload = parseWorkflowStdout(String(proc.stdout || ''));
  } catch {
    payload = { stdout: String(proc.stdout || '').slice(0, 1000) };
  }
  return {
    name: 'safe_write',
    scenario,
    args: { ...args, patch: '<diff omitted>' },
    exitCode: proc.status,
    success: proc.status === 0,
    elapsedMs: Date.now() - started,
    payload,
    stderrTail: String(proc.stderr || '').slice(-1000),
  };
}

function unifiedPatch(original: string, modified: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sci-safe-write-'));
  try {
    const before = join(dir, 'before.md');
    const after = join(dir, 'after.md');
    writeFileSync(before, original, { flag: 'wx' });
    writeFileSync(after, modified, { flag: 'wx' });
    const diff = spawnSync('diff', ['-u', '--label', `a/${target}`, '--label', `b/${target}`, before, after], {
      encoding: 'utf8',
    });
    const body = String(diff.stdout || '');
    return `diff --git a/${target} b/${target}\n${body.endsWith('\n') ? body : `${body}\n`}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const original = await Bun.file(target).text();
process.on('exit', () => {
  try {
    writeFileSync(target, original);
  } catch {
    // Best-effort fixture cleanup for dogfood safety.
  }
});
const modified = `${original.trimEnd()}\n\n${marker}\n`;
const patch = unifiedPatch(original, modified);
const dirtyBaseMarker = 'Safe Write Dogfood Fixture Verified';
const dirtyBasePatch = unifiedPatch(original, original.replace('Safe Write Dogfood Fixture', dirtyBaseMarker));
const calls: CallEvidence[] = [];

const preview = callSafeWrite({ patch, commands: ['true'], timeoutSec: 30, recommendChecks: true, brief: true }, {}, 'preview');
calls.push(preview);
const afterPreview = await Bun.file(target).text();

const failedApply = callSafeWrite(
  { patch, commands: ['false'], timeoutSec: 30, apply: true, brief: false },
  { ALLOW_SNAPSHOT_APPLY: '1' },
  'failed_checks_apply',
);
calls.push(failedApply);
const afterFailedApply = await Bun.file(target).text();

const applied = callSafeWrite(
  { patch, commands: ['true'], timeoutSec: 30, apply: true, brief: false },
  { ALLOW_SNAPSHOT_APPLY: '1' },
  'clean_apply',
);
calls.push(applied);
const afterApply = await Bun.file(target).text();

let rollbackResult: { status: number | null; stdout: string; stderr: string } | null = null;
const rollbackCommand = applied.payload?.rollback?.command;
if (typeof rollbackCommand === 'string' && rollbackCommand.trim()) {
  const proc = run(rollbackCommand);
  rollbackResult = { status: proc.status, stdout: String(proc.stdout || ''), stderr: String(proc.stderr || '') };
}
const afterRollback = await Bun.file(target).text();

const dirtyOriginal = `${original.trimEnd()}\n\n${dirtyMarker}\n`;
writeFileSync(target, dirtyOriginal);
const dirtyBaseApply = callSafeWrite(
  { patch: dirtyBasePatch, commands: ['true'], timeoutSec: 30, apply: true, brief: false },
  { ALLOW_SNAPSHOT_APPLY: '1' },
  'dirty_base_apply',
);
calls.push(dirtyBaseApply);
const afterDirtyBaseApply = await Bun.file(target).text();
let dirtyBaseRollbackResult: { status: number | null; stdout: string; stderr: string } | null = null;
const dirtyBaseRollbackCommand = dirtyBaseApply.payload?.rollback?.command;
if (typeof dirtyBaseRollbackCommand === 'string' && dirtyBaseRollbackCommand.trim()) {
  const proc = run(dirtyBaseRollbackCommand);
  dirtyBaseRollbackResult = { status: proc.status, stdout: String(proc.stdout || ''), stderr: String(proc.stderr || '') };
}
const afterDirtyBaseRollback = await Bun.file(target).text();
writeFileSync(target, original);
const afterFinalRestore = await Bun.file(target).text();

const dirty = run(`git status --short -- ${target}`).stdout.trim();
const fixtureHasNoPostRollbackModification = dirty === '' || dirty.startsWith('?? ');

const evidence = {
  schema: 'semantic-code-intelligence.safe_write_dogfood.v1',
  ok:
    preview.payload?.ok === true &&
    preview.payload?.applied === false &&
    preview.payload?.checkRecommendations?.workflow === 'recommend_checks' &&
    preview.payload?.validationPlan?.schema === 'semantic-code-intelligence.validation_plan.v1' &&
    afterPreview === original &&
    failedApply.payload?.ok === false &&
    failedApply.payload?.applied === false &&
    afterFailedApply === original &&
    applied.payload?.ok === true &&
    applied.payload?.applied === true &&
    applied.payload?.verification?.appliedDiffMatchesSnapshot === true &&
    applied.payload?.validationPlan?.verification?.appliedDiffMatchesSnapshot === true &&
    afterApply.includes(marker) &&
    rollbackResult?.status === 0 &&
    afterRollback === original &&
    dirtyBaseApply.payload?.ok === true &&
    dirtyBaseApply.payload?.applied === true &&
    dirtyBaseApply.payload?.verification?.appliedDiffMatchesSnapshot === true &&
    dirtyBaseApply.payload?.validationPlan?.verification?.appliedDiffMatchesSnapshot === true &&
    afterDirtyBaseApply.includes(dirtyBaseMarker) &&
    afterDirtyBaseApply.includes(dirtyMarker) &&
    dirtyBaseRollbackResult?.status === 0 &&
    afterDirtyBaseRollback === dirtyOriginal &&
    afterFinalRestore === original &&
    fixtureHasNoPostRollbackModification,
  target,
  assertions: {
    previewUnchanged: afterPreview === original,
    previewIncludesAdvisoryRecommendations: preview.payload?.checkRecommendations?.workflow === 'recommend_checks',
    previewIncludesValidationPlan: preview.payload?.validationPlan?.schema === 'semantic-code-intelligence.validation_plan.v1',
    failedChecksBlockedApply: failedApply.payload?.ok === false && afterFailedApply === original,
    guardedApplyChangedFixture: applied.payload?.applied === true && afterApply.includes(marker),
    appliedDiffMatchesSnapshot: applied.payload?.verification?.appliedDiffMatchesSnapshot === true,
    validationPlanAppliedDiffMatchesSnapshot: applied.payload?.validationPlan?.verification?.appliedDiffMatchesSnapshot === true,
    rollbackRestoredExactly: afterRollback === original,
    dirtyTouchedFileVerificationPreservesBase:
      dirtyBaseApply.scenario === 'dirty_base_apply' &&
      dirtyBaseApply.payload?.ok === true &&
      dirtyBaseApply.payload?.applied === true &&
      dirtyBaseApply.payload?.verification?.appliedDiffMatchesSnapshot === true,
    validationPlanDirtyTouchedFileVerificationPreservesBase:
      dirtyBaseApply.scenario === 'dirty_base_apply' &&
      dirtyBaseApply.payload?.validationPlan?.verification?.appliedDiffMatchesSnapshot === true,
    dirtyBaseRollbackPreservedPreexistingDirtyChange: afterDirtyBaseRollback === dirtyOriginal,
    finalRestoreExact: afterFinalRestore === original,
    fixtureCleanAfterRollback: fixtureHasNoPostRollbackModification,
  },
  calls: calls.map((call) => ({
    ...call,
    payload: {
      ok: call.payload?.ok,
      workflow: call.payload?.workflow,
      mode: call.payload?.mode,
      risk: call.payload?.risk,
      applied: call.payload?.applied,
      checkRecommendations: call.payload?.checkRecommendations,
      validationPlan: call.payload?.validationPlan,
      checks: call.payload?.checks,
      verification: call.payload?.verification,
      applyResult: call.payload?.applyResult,
      rollback: call.payload?.rollback,
      next: call.payload?.next,
    },
  })),
  rollback: rollbackResult,
  dirtyBaseRollback: dirtyBaseRollbackResult,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
if (jsonMode) process.stdout.write(`${output}\n`);
else console.log(output);
if (!evidence.ok) process.exitCode = 1;
