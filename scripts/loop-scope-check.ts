#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { minimatch } from 'minimatch';

type SnapshotPayload = {
  commit_sha?: unknown;
  scope?: {
    allowed_paths?: unknown[];
    required_paths?: unknown[];
    forbidden_paths?: unknown[];
  };
};

function argValue(name: string, fallback = ''): string {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || fallback;
  return fallback;
}

const failOnBlocker = ['1', 'true', 'yes'].includes(argValue('--fail-on-blocker', '0').toLowerCase());
const snapshotDir = argValue('--snapshot-dir', 'governance/task-scopes');
const selectedTaskId = process.env.LOOP_TASK_ID || process.env.AK_TASK_ID || '';

function exitForBlocker(): never {
  process.exit(failOnBlocker ? 2 : 0);
}

function normalizedTaskId(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(?:AK-)?(\d+)$/.exec(trimmed);
  return match ? match[1] : null;
}

function displayValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '?');
}

function dirtyPaths(): string[] {
  const proc = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (proc.status !== 0) {
    process.stdout.write(`scope_check=blocker reason=git-status-failed detail=${String(proc.stderr || '').trim()}\n`);
    exitForBlocker();
  }
  const raw = Buffer.from(proc.stdout || '').toString('utf8').split('\0');
  const paths: string[] = [];
  let index = 0;
  while (index < raw.length) {
    const entry = raw[index];
    if (!entry) {
      index += 1;
      continue;
    }
    const status = entry.slice(0, 2);
    const filePath = entry.length > 3 ? entry.slice(3) : '';
    if (filePath) paths.push(filePath);
    index += status.includes('R') || status.includes('C') ? 2 : 1;
  }
  return paths;
}

function snapshotPaths(): string[] {
  if (!existsSync(snapshotDir)) return [];
  return readdirSync(snapshotDir)
    .filter((name) => /^AK-\d+\.snapshot\.json$/.test(name))
    .sort()
    .map((name) => join(snapshotDir, name));
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function matches(patterns: string[], filePath: string): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/\/+$/, '');
    return filePath === pattern || minimatch(filePath, pattern) || (!!normalized && filePath.startsWith(`${normalized}/`));
  });
}

const dirty = dirtyPaths();

if (dirty.length === 0) {
  const snapshots = snapshotPaths();
  if (snapshots.length > 0) {
    const selectedSuffix = selectedTaskId ? ` selected_ignored=${displayValue(selectedTaskId)}` : '';
    process.stdout.write(`task_scope_snapshot=not-required reason=no-dirty-paths${selectedSuffix}\n`);
    for (const snapshot of snapshots) process.stdout.write(`- ${snapshot}\n`);
  } else {
    const selectedSuffix = selectedTaskId ? ` selected_ignored=${displayValue(selectedTaskId)}` : '';
    process.stdout.write(`task_scope_snapshot=absent reason=no-dirty-paths${selectedSuffix}\n`);
  }
  process.stdout.write('scope_check=pass\n');
  process.exit(0);
}

let selectedSnapshots: string[];
if (selectedTaskId) {
  const taskId = normalizedTaskId(selectedTaskId);
  if (!taskId) {
    process.stdout.write(`task_scope_snapshot=invalid selected=${displayValue(selectedTaskId)}\n`);
    process.stdout.write('scope_check=blocker reason=invalid-task-id-format\n');
    exitForBlocker();
  }
  selectedSnapshots = [join(snapshotDir, `AK-${taskId}.snapshot.json`)];
  if (!existsSync(selectedSnapshots[0])) {
    process.stdout.write(`task_scope_snapshot=missing selected=AK-${taskId}\n`);
    process.stdout.write('scope_check=blocker reason=selected-snapshot-missing\n');
    exitForBlocker();
  }
} else {
  selectedSnapshots = snapshotPaths();
  if (selectedSnapshots.length === 0) {
    process.stdout.write('task_scope_snapshot=absent\n');
    if (failOnBlocker) {
      process.stdout.write('scope_check=blocker reason=snapshot-required-for-dirty-paths\n');
      process.exit(2);
    }
    process.stdout.write('scope_check=not-run reason=no-snapshot-for-dirty-paths\n');
    process.exit(0);
  }
  if (selectedSnapshots.length > 1) {
    process.stdout.write('task_scope_snapshot=ambiguous\n');
    for (const snapshot of selectedSnapshots) process.stdout.write(`- ${snapshot}\n`);
    process.stdout.write('scope_check=blocker reason=multiple-snapshots-set-LOOP_TASK_ID\n');
    exitForBlocker();
  }
}

const snapshot = selectedSnapshots[0];
process.stdout.write(`task_scope_snapshot=${snapshot}\n`);
let payload: SnapshotPayload;
try {
  payload = JSON.parse(readFileSync(snapshot, 'utf8')) as SnapshotPayload;
} catch (error) {
  process.stdout.write(`scope_check=blocker reason=invalid-snapshot-json detail=${error instanceof Error ? error.message : String(error)}\n`);
  exitForBlocker();
}

if (!payload.scope || typeof payload.scope !== 'object') {
  process.stdout.write('scope_check=blocker reason=missing-scope-object\n');
  exitForBlocker();
}

// Commit binding: a frozen scope must be bound to a landed implementation commit.
// Unbound (null/absent) snapshots pass path checks but cannot prove which landed
// state the scope describes; discovering that only at the final closure phase
// (after terminal publication) forces a post-terminal governance repair. Fail
// fast here instead. Origin: AK-4779 closure runs transcendent-1786830891881 and
// transcendent-1786834204928 both reached the closure gate with an unbound or
// not-yet-committed snapshot and published closure_gate_incomplete.
const commitSha = typeof payload.commit_sha === 'string' ? payload.commit_sha.trim() : '';
if (!commitSha) {
  process.stdout.write('snapshot_commit=unbound\n');
  process.stdout.write('scope_check=blocker reason=snapshot-commit-unbound\n');
  process.stdout.write(
    'remediation=re-run "ak task scope export" after the implementation commit lands, then commit the refreshed snapshot\n'
  );
  exitForBlocker();
}
const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', commitSha, 'HEAD'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
});
if (ancestry.status !== 0) {
  process.stdout.write(`snapshot_commit=${commitSha.slice(0, 12)}\n`);
  process.stdout.write(
    `scope_check=blocker reason=snapshot-commit-not-in-history detail=${(ancestry.stderr || '').trim().slice(0, 200)}\n`
  );
  process.stdout.write('remediation=re-export the task scope from the landed implementation commit\n');
  exitForBlocker();
}
process.stdout.write(`snapshot_commit=${commitSha.slice(0, 12)} bound\n`);

const allowed = asStringList(payload.scope.allowed_paths);
const required = asStringList(payload.scope.required_paths);
const forbidden = asStringList(payload.scope.forbidden_paths);
const outOfScope = dirty.filter((filePath) => !matches(allowed, filePath));
const forbiddenDirty = dirty.filter((filePath) => matches(forbidden, filePath));
const missingRequired = required.filter((filePath) => !existsSync(filePath)).sort();

if (outOfScope.length > 0 || forbiddenDirty.length > 0 || missingRequired.length > 0) {
  process.stdout.write('scope_check=blocker\n');
  if (outOfScope.length > 0) {
    process.stdout.write('scope_out_of_allowed:\n');
    for (const filePath of outOfScope) process.stdout.write(`- ${filePath}\n`);
  }
  if (forbiddenDirty.length > 0) {
    process.stdout.write('scope_forbidden_dirty:\n');
    for (const filePath of forbiddenDirty) process.stdout.write(`- ${filePath}\n`);
  }
  if (missingRequired.length > 0) {
    process.stdout.write('scope_missing_required:\n');
    for (const filePath of missingRequired) process.stdout.write(`- ${filePath}\n`);
  }
  exitForBlocker();
}

process.stdout.write('scope_check=pass\n');
