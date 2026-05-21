import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function readText(path: string): string {
    return readFileSync(path, 'utf8');
}

function recipeBody(justfile: string, recipeName: string): string {
    const recipePattern = new RegExp(`^${recipeName}:\\n(?<body>(?:[ \\t].*\\n|\\n)+)`, 'm');
    const match = justfile.match(recipePattern);
    expect(match, `${recipeName} recipe should exist`).not.toBeNull();
    return match?.groups?.body ?? '';
}

describe('build command surface', () => {
    test('command-surface audit passes for package, workflow, and review surfaces', () => {
        const proc = spawnSync('bun', ['run', 'scripts/check-command-surface.ts', '--json'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });

        expect(proc.status, proc.stderr || proc.stdout).toBe(0);
        const report = JSON.parse(proc.stdout) as { ok: boolean; violations: unknown[] };
        expect(report.ok).toBe(true);
        expect(report.violations).toEqual([]);
    });

    test('package test delegates to the sliced normal-test runner', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        const runner = readText('scripts/run-normal-tests.sh');
        const slicer = readText('bin/test-slicer.sh');
        const justfile = readText('justfile');

        expect(packageJson.scripts?.test).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:nonperf']).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:raw']).toBe('bun test');
        expect(packageJson.scripts?.['test:coverage']).toBe('scripts/run-coverage-tests.sh');
        expect(packageJson.scripts?.['command-surface:check']).toBe('bun run scripts/check-command-surface.ts');
        expect(runner).toContain('bin/test-slicer.sh');
        expect(runner).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
        expect(runner).toContain('BUN_JOBS=${BUN_JOBS:-1}');
        expect(runner).toContain('require_positive_int BATCH_SIZE "$BATCH_SIZE"');
        expect(runner).not.toContain('bun test\n');
        expect(slicer).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
        expect(slicer).toContain('Invalid BATCH_SIZE');
        expect(slicer).toContain('mapfile -t slice_files <<< "$output"');
        expect(slicer).not.toContain('slice_files=( $output )');
        expect(recipeBody(justfile, 'test-fast')).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
        expect(recipeBody(justfile, 'test-slices slices="4"')).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
    });

    test('normal test runners fail closed for invalid batch sizing', () => {
        const proc = spawnSync('bash', ['scripts/run-normal-tests.sh'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, BATCH_SIZE: '0' },
        });
        expect(proc.status).toBe(2);
        expect(proc.stderr).toContain('Invalid BATCH_SIZE: 0');

        const slicerProc = spawnSync('bash', ['bin/test-slicer.sh'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, SLICES: '1', SLICE: '1', BATCH_SIZE: 'nope' },
        });
        expect(slicerProc.status).toBe(2);
        expect(slicerProc.stderr).toContain('Invalid BATCH_SIZE: nope');
    });

    test('batch runner preserves JSONL shape and refuses symlink report outputs', () => {
        const invalidProc = spawnSync('bash', ['bin/test-progress-batch.sh'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, BATCH_SIZE: '0' },
        });
        expect(invalidProc.status).toBe(2);
        expect(invalidProc.stderr).toContain('Invalid BATCH_SIZE: 0');

        const dir = mkdtempSync(join(tmpdir(), 'sci-batch-runner-'));
        try {
            const list = join(dir, 'files.lst');
            const report = join(dir, 'batch-report.jsonl');
            const weirdPath = 'tests/adversarial"quoted.test.ts';
            writeFileSync(list, `${weirdPath}\n`);

            const proc = spawnSync('bash', ['bin/test-progress-batch.sh'], {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    FILE_LIST: list,
                    REPORT_FILE: report,
                    BATCH_SIZE: '1',
                    TIMEOUT: '1000',
                    HEARTBEAT_SEC: '60',
                    BUN_JOBS: '1',
                },
            });

            expect(proc.status).toBe(1);
            const rows = readFileSync(report, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
            expect(rows).toHaveLength(1);
            expect(rows[0].files).toEqual([weirdPath]);

            const outside = join(dir, 'outside.jsonl');
            const link = join(dir, 'link.jsonl');
            writeFileSync(outside, 'keep');
            symlinkSync(outside, link);
            const symlinkProc = spawnSync('bash', ['bin/test-progress-batch.sh'], {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    FILE_LIST: list,
                    REPORT_FILE: link,
                    BATCH_SIZE: '1',
                    TIMEOUT: '1000',
                    HEARTBEAT_SEC: '60',
                    BUN_JOBS: '1',
                },
            });
            expect(symlinkProc.status).toBe(1);
            expect(symlinkProc.stderr).toContain('Refusing to write batch report through symlink');
            expect(readFileSync(outside, 'utf8')).toBe('keep');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('release and review surfaces use the normal package test command for broad tests', () => {
        const npmPublish = readText('.github/workflows/npm-publish.yml');
        const prTemplate = readText('.github/pull_request_template.md');

        expect(npmPublish).toContain('run: bun run test');
        expect(npmPublish).not.toMatch(/^\s*run:\s*bun test\s*$/m);
        expect(prTemplate).toContain('bun run test');
        expect(prTemplate).not.toMatch(/^bun test$/m);
    });

    test('ontology-check workflow uses supported built CLI commands', () => {
        const workflow = readText('.github/workflows/ontology-check.yml');

        expect(workflow).toContain('bun run dist/cli/cli.js stats --json');
        expect(workflow).toContain('bun run dist/cli/cli.js get-snapshot --json');
        expect(workflow).not.toContain('dist/cli/index.js');
        expect(workflow).not.toContain('analyze --path');
    });

    test('package build delegates to the canonical all-adapter build', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        expect(packageJson.scripts?.build).toBe('bun run build:all');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:mcp-stdio');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:http');
        expect(packageJson.scripts?.['build:http']).toContain('--outdir=dist/http');
        expect(packageJson.scripts?.['build:mcp-stdio']).toContain('--outdir=dist/mcp');
    });

    test('Just build delegates to the package build instead of hand-rolling divergent artifacts', () => {
        const justfile = readText('justfile');
        const body = recipeBody(justfile, 'build');

        expect(body).toContain('{{bun}} run build:all');
        expect(body).not.toContain('dist/api');
        expect(body).not.toContain('src/servers/mcp-fast.ts');
        expect(body).not.toContain('dist/mcp-fast');
    });
});
