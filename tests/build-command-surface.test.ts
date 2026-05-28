import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

    test('local harness artifacts are ignored and rejected if force-tracked', () => {
        const gitignore = readText('.gitignore');
        expect(gitignore).toContain('.pi-subagent-sessions/');
        expect(gitignore).toContain('.pi-subagent-sessions.self-memory.json');

        for (const artifactPath of ['.pi-subagent-sessions/self-memory.jsonl', '.pi-subagent-sessions.self-memory.json']) {
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

            const add = spawnSync('git', ['add', '-f', '.pi-subagent-sessions.self-memory.json', '.pi-subagent-sessions/session.jsonl'], {
                cwd: dir,
                encoding: 'utf8',
            });
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

        expect(packageJson.scripts?.test).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:nonperf']).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:raw']).toBe('bun test');
        expect(packageJson.scripts?.['test:coverage']).toBe('scripts/run-coverage-tests.sh');
        expect(packageJson.scripts?.['command-surface:check']).toBe('bun run scripts/check-command-surface.ts');
        expect(packageJson.scripts?.lint).toBe(
            'bunx @biomejs/biome lint --diagnostic-level=error --files-ignore-unknown=true src tests scripts package.json biome.json'
        );
        expect(packageJson.scripts?.['lint:warnings']).toBe(
            'bunx @biomejs/biome lint --files-ignore-unknown=true src tests scripts package.json biome.json'
        );
        expect(packageJson.scripts?.lint).not.toContain('--write');
        expect(packageJson.scripts?.['lint:fix']).toContain('--write');
        expect(runner).toContain('bin/test-slicer.sh');
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
        expect(runner).toContain('git_tree_fingerprint()');
        expect(runner).toContain('BASE_GIT_FINGERPRINT="$(git_tree_fingerprint)"');
        expect(runner).toContain('AFTER_GIT_FINGERPRINT="$(git_tree_fingerprint)"');
        expect(runner).toContain('Test run changed git working tree content');
        expect(slicer).toContain('git_tree_fingerprint()');
        expect(slicer).toContain('BASE_GIT_FINGERPRINT="$(git_tree_fingerprint)"');
        expect(slicer).toContain('AFTER_GIT_FINGERPRINT="$(git_tree_fingerprint)"');
        expect(slicer).toContain('Test slice changed git working tree content');
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

    test('CI integration startup uses current build artifact paths', () => {
        const workflow = readText('.github/workflows/ci.yml');

        expect(workflow).toContain('bun run dist/http/http.js --port 7000');
        expect(workflow).toContain('bun run dist/mcp-http/mcp-http.js --port 7001');
        expect(workflow).not.toContain('dist/api/http.js');
        expect(workflow).not.toContain('dist/mcp-sse/mcp-sse.js');
        expect(workflow).not.toContain('MCP SSE');
    });

    test('README quick start only advertises supported packaged commands', () => {
        const readme = readText('README.md');

        expect(readme).toContain('semantic-code-intelligence stats');
        expect(readme).toContain('semantic-code-mcp');
        expect(readme).not.toContain('semantic-code-intelligence start');
        expect(readme).not.toContain('semantic-code-intelligence analyze');
    });

    test('packaged README references are included in package files allowlist', () => {
        const packageJson = JSON.parse(readText('package.json')) as { files?: string[] };
        const readme = readText('README.md');

        expect(readme).toContain('CONFIG.md');
        expect(packageJson.files).toContain('CONFIG.md');
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
        expect(packageJson.scripts?.['public-surface:check']).toBe('bun run build:all && bun run scripts/check-public-runtime-surface.ts');
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

    test('package server builds share one build helper for externals', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        const helper = readText('scripts/build-server.ts');

        for (const script of ['build:core', 'build:lsp', 'build:mcp-stdio', 'build:mcp-http', 'build:mcp-enhanced', 'build:http', 'build:cli']) {
            expect(packageJson.scripts?.[script]).toStartWith('bun run scripts/build-server.ts ');
            expect(packageJson.scripts?.[script]).not.toContain('--external');
        }
        expect(helper).toContain("core: { entry: './src/core/index.ts', outdir: 'dist/core' }");
        expect(helper).toContain("'tree-sitter-rust'");
        expect(helper).toContain("'bun:sqlite'");
        expect(helper).toContain('mcp-enhanced');
        expect(helper).toContain('rmSync(target.outdir, { recursive: true, force: true })');
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
