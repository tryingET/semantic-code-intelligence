import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];

function runFixture(allowedPaths: string[], requiredPaths: string[]) {
    const root = mkdtempSync(join(tmpdir(), 'sci-task-scope-offline-'));
    roots.push(root);
    const snapshots = join(root, 'snapshots');
    mkdirSync(snapshots);
    writeFileSync(
        join(snapshots, 'AK-1.snapshot.json'),
        `${JSON.stringify(
            {
                schema_version: 1,
                exported_at: '2026-01-01T00:00:00Z',
                task_id: 1,
                entity_version: 1,
                commit_sha: null,
                scope: {
                    allowed_paths: allowedPaths,
                    required_paths: requiredPaths,
                    forbidden_paths: [],
                },
                default_applies: false,
                export_tool: 'ak task scope export',
                export_tool_version: 'snapshot-v1',
            },
            null,
            2
        )}\n`,
        'utf8'
    );
    return spawnSync(
        'python3',
        [
            'scripts/lib/check-task-scope-snapshots.py',
            '--repo-root',
            process.cwd(),
            '--snapshots-dir',
            snapshots,
            '--offline',
        ],
        { cwd: process.cwd(), encoding: 'utf8' }
    );
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('offline task-scope snapshot validation', () => {
    test('accepts normalized recursive scope globs', () => {
        const result = runFixture(['docs/**'], ['docs/project/alpha-mvp-contract.md']);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('offline contract');
    });

    test('rejects repeated separators and trailing separators', () => {
        for (const malformed of ['docs//**', 'docs/**/']) {
            const result = runFixture([malformed], ['docs/project/alpha-mvp-contract.md']);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('normalized repo-relative path');
        }
    });

    test('does not let a single-star segment cross directories', () => {
        const result = runFixture(['docs/*'], ['docs/project/alpha-mvp-contract.md']);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('is not covered by allowed_paths');
    });
});
