import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

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
    test('GitHub workflow YAML files parse', () => {
        const workflowFiles = readdirSync('.github/workflows').filter((file) => /\.ya?ml$/.test(file));
        expect(workflowFiles.length).toBeGreaterThan(0);
        for (const file of workflowFiles) {
            const workflowPath = join('.github/workflows', file);
            expect(() => yaml.load(readText(workflowPath)), workflowPath).not.toThrow();
        }
    });

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

    test('command-surface audit normalizes workflow run blocks for normal-suite slices', () => {
        const dir = mkdtempSync(join(tmpdir(), 'sci-command-surface-workflow-normalize-'));
        const scriptPath = join(process.cwd(), 'scripts/check-command-surface.ts');
        const writeFixture = (runBlock: string, jobEnvBlock = '', workflowEnvBlock = '') => {
            mkdirSync(join(dir, '.github/workflows'), { recursive: true });
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({
                    scripts: {
                        test: 'scripts/run-normal-tests.sh',
                        'test:nonperf': 'scripts/run-normal-tests.sh',
                        'test:coverage': 'scripts/run-coverage-tests.sh',
                        'test:raw': 'bun test',
                        'command-surface:check': 'bun run scripts/check-command-surface.ts',
                    },
                })
            );
            writeFileSync(
                join(dir, '.github/workflows/ci.yml'),
                `name: ci\non: [push]\n${workflowEnvBlock}jobs:\n  test:\n    runs-on: ubuntu-latest\n${jobEnvBlock}    steps:\n      - name: Normal slice\n        run: |\n${runBlock
                    .split('\n')
                    .map((line) => `          ${line}`)
                    .join('\n')}\n`
            );
        };

        try {
            writeFixture(
                'echo running\nchmod +x bin/test-slicer.sh\n  bin/test-slicer.sh   | tee .test-results/slice-$SLICE.log'
            );
            const legacy = spawnSync('bun', ['run', scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
            expect(legacy.status).toBe(1);
            expect(JSON.parse(legacy.stdout).violations.map((v: { rule: string }) => v.rule)).toContain(
                'ci-normal-tests-use-canonical-runner'
            );

            writeFixture('bin/test-slicer.sh', '    env:\n      SLICES: 6\n      SLICE: ${{ matrix.slice }}\n');
            const envOnlyLegacy = spawnSync('bun', ['run', scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
            expect(envOnlyLegacy.status).toBe(1);
            expect(JSON.parse(envOnlyLegacy.stdout).violations.map((v: { rule: string }) => v.rule)).toContain(
                'ci-normal-tests-use-canonical-runner'
            );

            writeFixture('./bin/test-slicer.sh', '    env:\n      SLICES: 6\n      SLICE: ${{ matrix.slice }}\n');
            const dottedLegacy = spawnSync('bun', ['run', scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
            expect(dottedLegacy.status).toBe(1);
            expect(JSON.parse(dottedLegacy.stdout).violations.map((v: { rule: string }) => v.rule)).toContain(
                'ci-normal-tests-use-canonical-runner'
            );

            writeFixture('bash bin/test-slicer.sh', '', 'env:\n  SLICES: 6\n  SLICE: ${{ matrix.slice }}\n');
            const topLevelEnvLegacy = spawnSync('bun', ['run', scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
            expect(topLevelEnvLegacy.status).toBe(1);
            expect(JSON.parse(topLevelEnvLegacy.stdout).violations.map((v: { rule: string }) => v.rule)).toContain(
                'ci-normal-tests-use-canonical-runner'
            );

            writeFixture('scripts/run-normal-tests.sh | tee .test-results/slice-${SLICE}.log');
            const implicit = spawnSync('bun', ['run', scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
            expect(implicit.status).toBe(1);
            expect(JSON.parse(implicit.stdout).violations.map((v: { rule: string }) => v.rule)).toContain(
                'ci-normal-tests-explicit-slice'
            );

            writeFixture('bash scripts/run-normal-tests.sh | tee .test-results/slice-${SLICE}.log');
            const shellWrappedImplicit = spawnSync('bun', ['run', scriptPath, '--json'], {
                cwd: dir,
                encoding: 'utf8',
            });
            expect(shellWrappedImplicit.status).toBe(1);
            expect(JSON.parse(shellWrappedImplicit.stdout).violations.map((v: { rule: string }) => v.rule)).toContain(
                'ci-normal-tests-explicit-slice'
            );

            writeFixture(
                'env BUN_JOBS=1 ./scripts/run-normal-tests.sh \\\n  --slice "${SLICE}/${SLICES}" | tee ".test-results/slice-${SLICE}.log"'
            );
            const ok = spawnSync('bun', ['run', scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
            expect(ok.status, ok.stderr || ok.stdout).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('local harness artifacts are ignored and rejected if force-tracked', () => {
        const gitignore = readText('.gitignore');
        expect(gitignore).toContain('.pi-subagent-sessions/');
        expect(gitignore).toContain('.pi-subagent-sessions.self-memory.json');

        for (const artifactPath of [
            '.pi-subagent-sessions/self-memory.jsonl',
            '.pi-subagent-sessions.self-memory.json',
        ]) {
            const ignored = spawnSync('git', ['check-ignore', '--quiet', artifactPath], {
                cwd: process.cwd(),
                encoding: 'utf8',
            });
            expect(ignored.status, `${artifactPath} should be ignored by git`).toBe(0);
        }

        const dir = mkdtempSync(join(tmpdir(), 'sci-harness-artifact-hygiene-'));
        try {
            const init = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
            expect(init.status, init.stderr || init.stdout).toBe(0);

            mkdirSync(join(dir, '.pi-subagent-sessions'), { recursive: true });
            writeFileSync(join(dir, '.pi-subagent-sessions.self-memory.json'), '{"local":"session"}\n');
            writeFileSync(join(dir, '.pi-subagent-sessions', 'session.jsonl'), '{"local":"trace"}\n');

            const add = spawnSync(
                'git',
                ['add', '-f', '.pi-subagent-sessions.self-memory.json', '.pi-subagent-sessions/session.jsonl'],
                {
                    cwd: dir,
                    encoding: 'utf8',
                }
            );
            expect(add.status, add.stderr || add.stdout).toBe(0);

            const proc = spawnSync('bash', [join(process.cwd(), 'scripts/migration-hygiene.sh')], {
                cwd: dir,
                encoding: 'utf8',
            });
            expect(proc.status).toBe(1);
            expect(proc.stderr).toContain('tracked generated/local artifacts');
            expect(proc.stderr).toContain('.pi-subagent-sessions.self-memory.json');
            expect(proc.stderr).toContain('.pi-subagent-sessions/session.jsonl');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('package test delegates to the sliced normal-test runner', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        const runner = readText('scripts/run-normal-tests.sh');
        const slicer = readText('bin/test-slicer.sh');
        const justfile = readText('justfile');
        const ciWorkflow = readText('.github/workflows/ci.yml');

        expect(packageJson.scripts?.test).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:nonperf']).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:raw']).toBe('bun test');
        expect(packageJson.scripts?.['test:coverage']).toBe('scripts/run-coverage-tests.sh');
        expect(packageJson.scripts?.['command-surface:check']).toBe('bun run scripts/check-command-surface.ts');
        expect(packageJson.scripts?.typecheck).toContain('tsconfig.build.json');
        expect(packageJson.scripts?.typecheck).toContain('tsconfig.alpha-contract.json');
        expect(readText('tsconfig.alpha-contract.json')).toContain('src/adapters/http-adapter.ts');
        expect(readText('tsconfig.alpha-contract.json')).toContain('src/servers/http-ingress.ts');
        expect(readText('tsconfig.alpha-contract.json')).toContain('src/servers/mcp-http.ts');
        expect(packageJson.scripts?.['alpha:evidence:check']).toContain('mkdir -p .test-results &&');
        expect(packageJson.scripts?.['alpha:evidence:packet']).toContain('mkdir -p .test-results &&');
        expect(packageJson.scripts?.lint).toBe(
            'bunx @biomejs/biome lint --diagnostic-level=error --files-ignore-unknown=true src tests scripts package.json biome.json'
        );
        expect(packageJson.scripts?.['lint:warnings']).toBe(
            'bunx @biomejs/biome lint --files-ignore-unknown=true src tests scripts package.json biome.json'
        );
        expect(packageJson.scripts?.lint).not.toContain('--write');
        expect(packageJson.scripts?.['lint:fix']).toContain('--write');
        expect(runner).toContain('REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"');
        expect(runner).toContain('"$REPO_ROOT/bin/test-slicer.sh"');
        expect(runner).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
        expect(runner).toContain('BUN_JOBS=${BUN_JOBS:-1}');
        expect(runner).toContain('require_positive_int BATCH_SIZE "$BATCH_SIZE"');
        expect(runner).not.toContain('bun test\n');
        expect(slicer).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
        expect(slicer).toContain('[[ -d src ]] && DISCOVERY_DIRS+=(src)');
        expect(slicer).toContain('Invalid BATCH_SIZE');
        expect(slicer).toContain('mapfile -t slice_files <<< "$output"');
        expect(slicer).not.toContain('slice_files=( $output )');
        expect(recipeBody(justfile, 'test-fast')).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
        expect(recipeBody(justfile, 'test-slices slices="4"')).toContain('BATCH_SIZE=${BATCH_SIZE:-1}');
        expect(recipeBody(justfile, 'test-slices slices="4"')).toContain('scripts/run-normal-tests.sh');
        expect(runner).toContain('require_positive_int SLICES "$SLICES"');
        expect(runner).toContain('REQUESTED_SLICE=');
        expect(runner).not.toContain('SLICE=${SLICE:-}');
        expect(ciWorkflow).toContain('scripts/run-normal-tests.sh --slice "$SLICE/$SLICES"');
        expect(runner).toContain('scripts/git-tree-fingerprint.sh');
        expect(runner).toContain('BASE_GIT_FINGERPRINT="$($REPO_ROOT/scripts/git-tree-fingerprint.sh)"');
        expect(runner).toContain('AFTER_GIT_FINGERPRINT="$($REPO_ROOT/scripts/git-tree-fingerprint.sh)"');
        expect(runner).toContain('Test run changed git working tree content');
        expect(slicer).toContain('scripts/git-tree-fingerprint.sh');
        expect(slicer).toContain('BASE_GIT_FINGERPRINT="$(scripts/git-tree-fingerprint.sh)"');
        expect(slicer).toContain('AFTER_GIT_FINGERPRINT="$(scripts/git-tree-fingerprint.sh)"');
        expect(slicer).toContain('Test slice changed git working tree content');
    });

    test('slice analysis tolerates missing roots and labels local slice directories', () => {
        const missing = spawnSync(
            'bun',
            ['run', 'scripts/analyze-slices.ts', join(tmpdir(), `sci-missing-${Date.now()}`)],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
            }
        );
        expect(missing.status, missing.stderr).toBe(0);
        expect(missing.stdout).toContain('No slice batch-report artifacts found');

        const dir = mkdtempSync(join(tmpdir(), 'sci-local-slices-'));
        try {
            mkdirSync(join(dir, 'slice-1-of-2'), { recursive: true });
            writeFileSync(
                join(dir, 'slice-1-of-2', 'batch-report.jsonl'),
                '{"batch":1,"start":0,"end":1,"duration_ms":2345,"exit_code":0,"files":["tests/b.test.ts"]}\n'
            );
            const local = spawnSync('bun', ['run', 'scripts/analyze-slices.ts', dir], {
                cwd: process.cwd(),
                encoding: 'utf8',
            });
            expect(local.status, local.stderr).toBe(0);
            expect(local.stdout).toContain('[slice-1-of-2] Batch 1');
            expect(local.stdout).not.toContain('[unknown]');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('normal runner ignores ambient SLICE unless --slice is explicit', () => {
        const dir = mkdtempSync(join(tmpdir(), 'sci-normal-runner-slice-contract-'));
        try {
            mkdirSync(join(dir, 'scripts'), { recursive: true });
            mkdirSync(join(dir, 'bin'), { recursive: true });
            writeFileSync(join(dir, 'scripts', 'run-normal-tests.sh'), readText('scripts/run-normal-tests.sh'));
            writeFileSync(join(dir, 'scripts', 'git-tree-fingerprint.sh'), readText('scripts/git-tree-fingerprint.sh'));
            writeFileSync(
                join(dir, 'bin', 'test-slicer.sh'),
                '#!/usr/bin/env bash\nset -euo pipefail\necho "SLICE=${SLICE:-} SLICES=${SLICES:-}"\n'
            );
            chmodSync(join(dir, 'scripts', 'git-tree-fingerprint.sh'), 0o755);
            chmodSync(join(dir, 'bin', 'test-slicer.sh'), 0o755);

            const init = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
            expect(init.status, init.stderr || init.stdout).toBe(0);
            spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir, encoding: 'utf8' });
            spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, encoding: 'utf8' });
            const add = spawnSync(
                'git',
                ['add', 'scripts/run-normal-tests.sh', 'scripts/git-tree-fingerprint.sh', 'bin/test-slicer.sh'],
                { cwd: dir, encoding: 'utf8' }
            );
            expect(add.status, add.stderr || add.stdout).toBe(0);
            const commit = spawnSync('git', ['commit', '-m', 'fixture'], { cwd: dir, encoding: 'utf8' });
            expect(commit.status, commit.stderr || commit.stdout).toBe(0);

            const ambient = spawnSync('bash', ['scripts/run-normal-tests.sh'], {
                cwd: dir,
                encoding: 'utf8',
                env: { ...process.env, SLICES: '3', SLICE: '2', BATCH_SIZE: '1', TIMEOUT: '1000', BUN_JOBS: '1' },
            });
            expect(ambient.status, ambient.stderr || ambient.stdout).toBe(0);
            expect(ambient.stdout.match(/^SLICE=.*$/gm)).toEqual([
                'SLICE=1 SLICES=3',
                'SLICE=2 SLICES=3',
                'SLICE=3 SLICES=3',
            ]);

            const explicit = spawnSync('bash', ['scripts/run-normal-tests.sh', '--slice', '2/3'], {
                cwd: dir,
                encoding: 'utf8',
                env: { ...process.env, SLICES: '99', SLICE: 'stale', BATCH_SIZE: '1', TIMEOUT: '1000', BUN_JOBS: '1' },
            });
            expect(explicit.status, explicit.stderr || explicit.stdout).toBe(0);
            expect(explicit.stdout.match(/^SLICE=.*$/gm)).toEqual(['SLICE=2 SLICES=3']);

            mkdirSync(join(dir, 'subdir'), { recursive: true });
            const fromSubdir = spawnSync('bash', ['../scripts/run-normal-tests.sh', '--slice', '1/3'], {
                cwd: join(dir, 'subdir'),
                encoding: 'utf8',
                env: { ...process.env, BATCH_SIZE: '1', TIMEOUT: '1000', BUN_JOBS: '1' },
            });
            expect(fromSubdir.status, fromSubdir.stderr || fromSubdir.stdout).toBe(0);
            expect(fromSubdir.stdout.match(/^SLICE=.*$/gm)).toEqual(['SLICE=1 SLICES=3']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
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

        const justProc = spawnSync('just', ['test-slices', 'slices=6'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, MAX_FILES: '0' },
        });
        expect(justProc.status).toBe(2);
        expect(justProc.stderr).toContain('Invalid SLICES: slices=6');
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
            const rows = readFileSync(report, 'utf8')
                .trim()
                .split(/\r?\n/)
                .map((line) => JSON.parse(line));
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

    test('documented test slice commands use Just positional arguments', () => {
        expect(readText('README.md')).toContain('just test-slices 6');
        expect(readText('README.md')).not.toContain('just test-slices slices=6');
        expect(readText('TESTING_STRATEGY.md')).toContain('just test-slices 6');
        expect(readText('TESTING_STRATEGY.md')).not.toContain('just test-slices slices=6');
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

    test('CI integration startup uses current build and source server paths', () => {
        const workflow = readText('.github/workflows/ci.yml');
        const ciCdWorkflow = readText('.github/workflows/ci-cd.yml');

        expect(workflow).toContain('bun run dist/http/http.js --port 7000');
        expect(workflow).toContain('bun run dist/mcp-http/mcp-http.js --port 7001');
        expect(workflow).not.toContain('dist/api/http.js');
        expect(workflow).not.toContain('dist/mcp-sse/mcp-sse.js');
        expect(workflow).not.toContain('MCP SSE');
        expect(ciCdWorkflow).toContain('HTTP_API_PORT=7010 bun run src/servers/http.ts');
        expect(ciCdWorkflow).toContain('MCP_HTTP_PORT=7011 bun run src/servers/mcp-http.ts');
        expect(ciCdWorkflow).not.toContain('mcp-ontology-server');
        expect(ciCdWorkflow).not.toContain('src/api/http-server.ts');
        expect(ciCdWorkflow).not.toContain('MCP_SSE_PORT');
    });

    test('Claude setup surfaces use current MCP HTTP paths and Alpha tools', () => {
        const setup = readText('CLAUDE_DESKTOP_SETUP.md');
        const startHook = readText('.claude/hooks/start-mcp-server.sh.old');

        expect(setup).toContain('MCP_HTTP_PORT=7001 bun run src/servers/mcp-http.ts');
        expect(setup).toContain('"type": "streamable-http"');
        expect(setup).toContain('"url": "http://localhost:7001/mcp"');
        expect(setup).toContain('patch_checks_in_snapshot');
        expect(setup).not.toContain('src/api/http-server.ts');
        expect(setup).not.toContain('mcp-ontology-server');
        expect(setup).not.toContain('rename_symbol');
        expect(setup).not.toContain('search_semantic');
        expect(startHook).toContain('MCP_HTTP_PORT');
        expect(startHook).toContain('src/servers/mcp-http.ts');
        expect(startHook).toContain('http://$MCP_HOST:$MCP_PORT/mcp');
        expect(startHook).not.toContain('MCP_SSE_PORT');
        expect(startHook).not.toContain('src/sse-server.ts');
        expect(startHook).not.toContain('mcp-ontology-server');
    });

    test('README quick start only advertises supported packaged commands', () => {
        const readme = readText('README.md');

        expect(readme).toContain('semantic-code-intelligence stats');
        expect(readme).toContain('semantic-code-mcp');
        expect(readme).not.toContain('semantic-code-intelligence start');
        expect(readme).not.toContain('semantic-code-intelligence analyze');
    });

    test('packaged README references and runtime bin wrappers are included in package files allowlist', () => {
        const packageJson = JSON.parse(readText('package.json')) as { files?: string[] };
        const readme = readText('README.md');

        expect(readme).toContain('CONFIG.md');
        expect(packageJson.files).toContain('CONFIG.md');
        expect(packageJson.files).toContain('bin/semantic-code-intelligence');
        expect(packageJson.files).toContain('bin/semantic-code-mcp');
        expect(packageJson.files).not.toContain('bin/');
    });

    test('package scripts are explicitly partitioned between runtime and source-checkout surfaces', () => {
        const packageJson = JSON.parse(readText('package.json')) as {
            files?: string[];
            scripts?: Record<string, string>;
            sciPackageContract?: {
                kind?: string;
                runtimeScripts?: string[];
                sourceOnlyScripts?: string[];
                sourceOnlyReason?: string;
            };
        };
        const scripts = Object.keys(packageJson.scripts || {}).sort();
        const runtime = packageJson.sciPackageContract?.runtimeScripts || [];
        const sourceOnly = packageJson.sciPackageContract?.sourceOnlyScripts || [];
        const classified = [...runtime, ...sourceOnly].sort();

        expect(packageJson.sciPackageContract?.kind).toBe('runtime-tarball');
        expect(packageJson.sciPackageContract?.sourceOnlyReason).toContain('source checkout');
        expect(classified).toEqual(scripts);
        expect(runtime.filter((name) => sourceOnly.includes(name))).toEqual([]);
        expect(runtime).toEqual(['start', 'start:mcp']);
        expect(packageJson.scripts?.start).toContain('dist/lsp/lsp.js');
        expect(packageJson.scripts?.['start:mcp']).toContain('dist/mcp/mcp.js');
        expect(sourceOnly).toContain('test');
        expect(sourceOnly).toContain('alpha:mvp:check');
        expect(packageJson.files).not.toContain('src/');
        expect(packageJson.files).not.toContain('scripts/');
        expect(packageJson.files).not.toContain('tests/');
    });

    test('CLI init --force refuses symlink config clobbering', () => {
        const dir = mkdtempSync(join(tmpdir(), 'sci-init-symlink-'));
        const victim = join(dir, 'victim.txt');
        const configLink = join(dir, '.semantic-code-intelligence-config.yaml');
        try {
            writeFileSync(victim, 'keep-me\n');
            symlinkSync(victim, configLink);

            const proc = spawnSync('bun', [join(process.cwd(), 'src/servers/cli.ts'), 'init', '--force'], {
                cwd: dir,
                encoding: 'utf8',
            });

            expect(proc.status).toBe(1);
            expect(proc.stderr).toContain('Configuration path must not be a symlink');
            expect(readFileSync(victim, 'utf8')).toBe('keep-me\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('package build delegates to the canonical all-adapter build', () => {
        const packageJson = JSON.parse(readText('package.json')) as { main?: string; scripts?: Record<string, string> };
        expect(packageJson.main).toBe('dist/core/index.js');
        expect(packageJson.scripts?.build).toBe('bun run build:all');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:core');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:lsp');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:mcp-stdio');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:mcp-http');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:mcp-enhanced');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:http');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:cli');
        expect(packageJson.scripts?.['build:lsp']).toBe('bun run scripts/build-server.ts lsp');
        expect(packageJson.scripts?.['build:http']).toBe('bun run scripts/build-server.ts http');
        expect(packageJson.scripts?.['build:core']).toBe('bun run scripts/build-server.ts core');
        expect(packageJson.scripts?.['build:cli']).toBe('bun run scripts/build-server.ts cli');
        expect(packageJson.scripts?.['build:mcp-stdio']).toBe('bun run scripts/build-server.ts mcp-stdio');
        expect(packageJson.scripts?.['build:mcp-http']).toBe('bun run scripts/build-server.ts mcp-http');
        expect(packageJson.scripts?.['build:mcp-enhanced']).toBe('bun run scripts/build-server.ts mcp-enhanced');
        expect(packageJson.scripts?.['public-surface:check']).toBe(
            'bun run build:all && bun run scripts/check-public-runtime-surface.ts'
        );
        expect(packageJson.scripts?.prepack).toBe('bun run public-surface:check');
    });

    test('Just build delegates to the package build instead of hand-rolling divergent artifacts', () => {
        const justfile = readText('justfile');
        const body = recipeBody(justfile, 'build');

        expect(body).toContain('{{bun}} run build:all');
        expect(body).not.toContain('dist/api');
        expect(body).not.toContain('src/servers/mcp-fast.ts');
        expect(body).not.toContain('dist/mcp-fast');
    });

    test('server cleanup recipes avoid broad process-name kills', () => {
        const justfile = readText('justfile');
        for (const recipe of ['stop', 'stop-quiet', 'clean-ports-force']) {
            const body = recipeBody(justfile, recipe);
            expect(body).not.toContain('pkill -f "src/servers"');
            expect(body).not.toContain('pkill -f "semantic-code-intelligence"');
            expect(body).not.toContain('pkill -f "http.server.*8081"');
        }
        expect(recipeBody(justfile, 'stop')).toContain('Skipping broad process-name cleanup');
        expect(recipeBody(justfile, 'process-management-info')).toContain('Scoped cleanup methods');
    });

    test('package server builds share one build helper for externals', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        const helper = readText('scripts/build-server.ts');

        for (const script of [
            'build:core',
            'build:lsp',
            'build:mcp-stdio',
            'build:mcp-http',
            'build:mcp-enhanced',
            'build:http',
            'build:cli',
        ]) {
            expect(packageJson.scripts?.[script]).toStartWith('bun run scripts/build-server.ts ');
            expect(packageJson.scripts?.[script]).not.toContain('--external');
        }
        expect(helper).toContain("core: { entry: './src/core/index.ts', outdir: 'dist/core' }");
        expect(helper).toContain("'tree-sitter-rust'");
        expect(helper).toContain("'bun:sqlite'");
        expect(helper).toContain('mcp-enhanced');
        expect(helper).toContain('fileURLToPath(import.meta.url)');
        expect(helper).toContain('const outdir = resolve(repoRoot, target.outdir)');
        expect(helper).toContain('rmSync(outdir, { recursive: true, force: true })');
        expect(helper).toContain('cwd: repoRoot');
    });

    test('build helper fails closed for unknown targets', () => {
        const proc = spawnSync('bun', ['run', 'scripts/build-server.ts', 'not-a-target'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });

        expect(proc.status).toBe(2);
        expect(proc.stderr).toContain('Usage: bun run scripts/build-server.ts <target>');
        expect(proc.stderr).toContain('Available targets:');
    });

    test('ignored source-server bundles do not shadow TypeScript sources', () => {
        for (const generatedPath of ['src/servers/mcp-fast.js', 'src/servers/mcp-fast.js.map']) {
            expect(existsSync(generatedPath), `${generatedPath} should not exist in the source tree`).toBe(false);
        }
    });

    test('MCP stdio and enhanced smoke surfaces are fail-closed over release artifacts', () => {
        const justfile = readText('justfile');
        const buildBody = recipeBody(justfile, 'build-mcp-enhanced');
        const stdioTestBody = recipeBody(justfile, 'test-mcp-stdio');
        const enhancedTestBody = recipeBody(justfile, 'test-mcp-enhanced');

        expect(buildBody).toContain('{{bun}} run build:mcp-enhanced');
        expect(buildBody).not.toContain('src/servers/mcp-enhanced.ts --target');
        expect(stdioTestBody).toContain('{{bun}} run build:mcp-stdio');
        expect(stdioTestBody).toContain('{{bun}} run dist/mcp/mcp.js');
        expect(stdioTestBody).toContain('grep -q');
        expect(stdioTestBody).not.toContain('|| echo');
        expect(enhancedTestBody).toContain('just build-mcp-enhanced');
        expect(enhancedTestBody).toContain('{{bun}} run dist/mcp-enhanced/mcp-enhanced.js');
        expect(enhancedTestBody).toContain('grep -q');
        expect(enhancedTestBody).not.toContain('{{bun}} run src/servers/mcp-enhanced.ts');
        expect(enhancedTestBody).not.toContain('|| echo');
    });

    test('roadmap Kubernetes deployment surfaces are guarded during alpha', () => {
        const justfile = readText('justfile');
        expect(justfile).toContain('SCI_ENABLE_ROADMAP_K8S_DEPLOY=1');
        expect(justfile).toContain('Kubernetes deployment is roadmap-only during alpha');
        expect(readText('k8s/production.yaml')).toContain('not a supported default path');
        expect(readText('k8s/deployment.yaml')).toContain('not a supported default deployment path');
        expect(readText('config/environments/production.yaml')).toContain('not a supported default path');
    });

    test('MCP HTTP docs and env sample use streamable HTTP names', () => {
        const envSample = readText('.env.sample');
        const readme = readText('README.md');

        expect(envSample).toContain('MCP_HTTP_PORT=7001');
        expect(envSample).toContain('MCP_HTTP_CORS_ORIGIN');
        expect(envSample).not.toContain('MCP_SSE_PORT');
        expect(readme).toContain('"type": "streamable-http"');
        expect(readme).toContain('"url": "http://localhost:7001/mcp"');
        expect(readme).not.toContain('/mcp/sse');
        expect(readme).not.toContain('semantic-code-intelligence-sse');
    });
});
