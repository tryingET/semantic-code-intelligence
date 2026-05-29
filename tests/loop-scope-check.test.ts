import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts', 'loop-scope-check.ts');
const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;

type RunResult = { status: number | null; stdout: string; stderr: string };

function tempRepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-loop-scope-'));
    spawnSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'loop-scope@example.invalid'], { cwd: root, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Loop Scope Test'], { cwd: root, stdio: 'ignore' });
    return root;
}

function snapshot(root: string, id: number, scope: Record<string, unknown>): void {
    const dir = join(root, 'governance', 'task-scopes');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, `AK-${id}.snapshot.json`),
        `${JSON.stringify(
            {
                schema_version: 1,
                task_id: id,
                scope,
            },
            null,
            2
        )}\n`,
        'utf8'
    );
}

function commitAll(root: string): void {
    spawnSync('git', ['add', '--', '.'], { cwd: root, stdio: 'ignore' });
    const commit = spawnSync('git', ['commit', '-qm', 'seed'], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    expect(commit.status, commit.stderr).toBe(0);
}

function run(root: string, env: Record<string, string | undefined> = {}, failOnBlocker = true): RunResult {
    const proc = spawnSync(bun, ['run', scriptPath, `--fail-on-blocker=${failOnBlocker ? '1' : '0'}`], {
        cwd: root,
        env: { ...process.env, LOOP_TASK_ID: undefined, AK_TASK_ID: undefined, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

describe('loop scope active authority selector', () => {
    test('clean working trees do not require selecting among historical snapshots', () => {
        const root = tempRepo();
        try {
            snapshot(root, 1, { allowed_paths: ['src'], required_paths: [], forbidden_paths: [] });
            snapshot(root, 2, { allowed_paths: ['docs'], required_paths: [], forbidden_paths: [] });
            commitAll(root);

            const result = run(root);
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toContain('task_scope_snapshot=not-required reason=no-dirty-paths');
            expect(result.stdout).toContain('scope_check=pass');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('clean working trees ignore stale selected task ids', () => {
        const root = tempRepo();
        try {
            writeFileSync(join(root, 'README.md'), '# seed\n', 'utf8');
            commitAll(root);

            const result = run(root, { LOOP_TASK_ID: '999999' });
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toContain('reason=no-dirty-paths');
            expect(result.stdout).toContain('selected_ignored=999999');
            expect(result.stdout).toContain('scope_check=pass');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('dirty working trees with multiple snapshots require explicit task selection', () => {
        const root = tempRepo();
        try {
            snapshot(root, 1, { allowed_paths: ['src'], required_paths: [], forbidden_paths: [] });
            snapshot(root, 2, { allowed_paths: ['docs'], required_paths: [], forbidden_paths: [] });
            commitAll(root);
            mkdirSync(join(root, 'src'), { recursive: true });
            writeFileSync(join(root, 'src', 'changed.ts'), 'export const changed = true;\n', 'utf8');

            const result = run(root);
            expect(result.status).toBe(2);
            expect(result.stdout).toContain('task_scope_snapshot=ambiguous');
            expect(result.stdout).toContain('scope_check=blocker reason=multiple-snapshots-set-LOOP_TASK_ID');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('dirty working trees without snapshots block fail-on-blocker guards', () => {
        const root = tempRepo();
        try {
            writeFileSync(join(root, 'README.md'), '# seed\n', 'utf8');
            commitAll(root);
            writeFileSync(join(root, 'changed.ts'), 'export const changed = true;\n', 'utf8');

            const result = run(root);
            expect(result.status).toBe(2);
            expect(result.stdout).toContain('task_scope_snapshot=absent');
            expect(result.stdout).toContain('scope_check=blocker reason=snapshot-required-for-dirty-paths');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('selected task ids accept canonical AK-prefixed form', () => {
        const root = tempRepo();
        try {
            snapshot(root, 3443, { allowed_paths: ['src'], required_paths: [], forbidden_paths: [] });
            commitAll(root);
            mkdirSync(join(root, 'src'), { recursive: true });
            writeFileSync(join(root, 'src', 'changed.ts'), 'export const changed = true;\n', 'utf8');

            const result = run(root, { LOOP_TASK_ID: 'AK-3443' });
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toContain('task_scope_snapshot=governance/task-scopes/AK-3443.snapshot.json');
            expect(result.stdout).toContain('scope_check=pass');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('dirty selected task ids reject invalid formats without multiline output', () => {
        const root = tempRepo();
        try {
            writeFileSync(join(root, 'README.md'), '# seed\n', 'utf8');
            commitAll(root);
            writeFileSync(join(root, 'changed.ts'), 'export const changed = true;\n', 'utf8');

            const result = run(root, { LOOP_TASK_ID: 'AK-3443\nscope_check=pass' });
            expect(result.status).toBe(2);
            expect(result.stdout).toContain('task_scope_snapshot=invalid selected=AK-3443?scope_check?pass');
            expect(result.stdout).toContain('scope_check=blocker reason=invalid-task-id-format');
            expect(result.stdout).not.toContain('selected=AK-3443\nscope_check=pass');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('directory-scoped allowed paths cover contained files for selected tasks', () => {
        const root = tempRepo();
        try {
            snapshot(root, 3443, {
                allowed_paths: ['governance/task-scopes'],
                required_paths: ['governance/task-scopes'],
                forbidden_paths: [],
            });

            const result = run(root, { LOOP_TASK_ID: '3443' });
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toContain('task_scope_snapshot=governance/task-scopes/AK-3443.snapshot.json');
            expect(result.stdout).toContain('scope_check=pass');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
