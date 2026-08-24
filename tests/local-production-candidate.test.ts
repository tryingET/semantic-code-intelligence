import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    CandidateStageError,
    shutdownMcpProcess,
    toCandidateFailureEvidence,
} from '../scripts/local-production-candidate-safety.js';

function read(path: string): string {
    return readFileSync(path, 'utf8');
}

function bashBlockContaining(markdown: string, marker: string): string {
    for (const match of markdown.matchAll(/```bash\n([\s\S]*?)\n```/g)) {
        if (match[1].includes(marker)) return match[1];
    }
    throw new Error(`Missing bash block containing ${marker}`);
}

describe('local single-user production candidate contract', () => {
    test('declares unique runtime bin paths and a bounded artifact command surface', () => {
        const pkg = JSON.parse(read('package.json')) as {
            private?: boolean;
            version?: string;
            bin?: Record<string, string>;
            files?: string[];
            scripts?: Record<string, string>;
            sciPackageContract?: { sourceOnlyScripts?: string[] };
        };
        const binPaths = Object.values(pkg.bin ?? {});

        expect(pkg.private).toBe(true);
        expect(pkg.version).toBe('2.1.0-rc.2');
        expect(read('src/core/version.ts')).toContain("SCI_VERSION = '2.1.0-rc.2'");
        expect(pkg.bin).toEqual({
            sci: './bin/sci',
            'semantic-code-intelligence': './bin/semantic-code-intelligence',
            'semantic-code-mcp': './bin/semantic-code-mcp',
        });
        expect(new Set(binPaths).size).toBe(binPaths.length);
        for (const path of binPaths) {
            expect(pkg.files).toContain(path.replace(/^\.\//, ''));
            expect(existsSync(path)).toBe(true);
            expect(statSync(path).mode & 0o111).not.toBe(0);
        }
        expect(pkg.scripts?.['production:artifact']).toBe('bun run scripts/build-local-production-artifact.ts');
        expect(pkg.scripts?.['production:dogfood']).toBe(
            'bun run scripts/dogfood-local-production-candidate.ts --json'
        );
        expect(pkg.scripts?.['production:candidate:check']).toContain('tests/local-production-candidate.test.ts');
        for (const script of ['production:artifact', 'production:dogfood', 'production:candidate:check']) {
            expect(pkg.sciPackageContract?.sourceOnlyScripts).toContain(script);
        }
    });

    test('bundled docs cover installed lifecycle and preserve target runtime state', () => {
        const pkg = JSON.parse(read('package.json')) as { files?: string[] };
        const readme = read('README.md');
        const config = read('CONFIG.md');
        const contract = read('docs/project/local-single-user-production-readiness.md');

        expect(pkg.files).toContain('README.md');
        expect(pkg.files).toContain('CONFIG.md');
        expect(readme).toContain('### Installed local single-user candidate');
        expect(readme).toContain('EXPECTED_SHA256=');
        expect(readme).toContain('SCI_VERSIONS/$SCI_VERSION');
        expect(readme).toContain('node_modules/.bin/semantic-code-mcp');
        expect(readme).toContain('SCI_MCP_COMMAND="$(readlink -f');
        expect(readme).toContain("copy the command's exact absolute output");
        expect(readme).not.toMatch(/\/home\/[^\s"`]+/);
        expect(readme).toContain('#### Upgrade');
        expect(readme).toContain('#### Rollback');
        expect(readme).toContain('#### Uninstall');
        expect(readme).toContain('test ! -L "$REMOVE_ROOT"');
        expect(readme).toContain('does **not** authorize deletion of `.ontology`');
        expect(config).toContain('The following gate is available only from a source checkout');
        expect(config).toContain('SEMANTIC_CODE_WORKSPACE=/absolute/path/to/trusted/repository');
        expect(config).toContain('must not silently migrate or delete target `.ontology` state');
        expect(contract).toContain('The bundled `README.md` is the installed-runtime lifecycle authority');
    });

    test('documented lifecycle rejects pre-existing and symlink-escaped install paths', () => {
        const installBlock = bashBlockContaining(read('README.md'), 'lifecycle-install-v1');
        const dir = mkdtempSync(join(tmpdir(), 'sci-documented-install-safety-'));
        const archive = join(dir, 'candidate.tgz');
        const env = {
            ...process.env,
            SCI_VERSION: '2.1.0-rc.1',
            SCI_ARCHIVE: archive,
            BUN_CONFIG_REGISTRY: 'http://127.0.0.1:9',
        };
        writeFileSync(archive, 'not reached by safety cases');

        try {
            const escapedRoot = join(dir, 'escaped-root');
            const outsideVersions = join(dir, 'outside-versions');
            mkdirSync(escapedRoot);
            mkdirSync(outsideVersions);
            writeFileSync(join(outsideVersions, 'keep'), 'keep');
            symlinkSync(outsideVersions, join(escapedRoot, 'versions'));
            const escaped = spawnSync('bash', ['-c', installBlock], {
                encoding: 'utf8',
                env: { ...env, SCI_ROOT: escapedRoot },
            });
            expect(escaped.status).toBe(2);
            expect(escaped.stderr).toContain('versions root must not be a symlink');
            expect(readFileSync(join(outsideVersions, 'keep'), 'utf8')).toBe('keep');

            const existingRoot = join(dir, 'existing-root');
            const existingVersion = join(existingRoot, 'versions', '2.1.0-rc.1');
            mkdirSync(existingVersion, { recursive: true });
            writeFileSync(join(existingVersion, 'keep'), 'keep');
            const existing = spawnSync('bash', ['-c', installBlock], {
                encoding: 'utf8',
                env: { ...env, SCI_ROOT: existingRoot },
            });
            expect(existing.status).toBe(2);
            expect(existing.stderr).toContain('version directory already exists; refusing overwrite');
            expect(readFileSync(join(existingVersion, 'keep'), 'utf8')).toBe('keep');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('documented uninstall rejects escaped parents and preserves target runtime state', () => {
        const uninstallBlock = bashBlockContaining(read('README.md'), 'lifecycle-uninstall-v1');
        const dir = mkdtempSync(join(tmpdir(), 'sci-documented-uninstall-safety-'));
        try {
            const escapedRoot = join(dir, 'escaped-root');
            const outsideVersions = join(dir, 'outside-versions');
            const escapedVersion = join(outsideVersions, 'candidate');
            mkdirSync(escapedRoot);
            mkdirSync(escapedVersion, { recursive: true });
            writeFileSync(join(escapedVersion, 'keep'), 'keep');
            symlinkSync(outsideVersions, join(escapedRoot, 'versions'));
            const escaped = spawnSync('bash', ['-c', uninstallBlock], {
                encoding: 'utf8',
                env: { ...process.env, SCI_ROOT: escapedRoot, REMOVE_VERSION: 'candidate' },
            });
            expect(escaped.status).toBe(2);
            expect(escaped.stderr).toContain('versions root must not be a symlink');
            expect(readFileSync(join(escapedVersion, 'keep'), 'utf8')).toBe('keep');

            const root = join(dir, 'normal-root');
            const version = join(root, 'versions', 'candidate');
            const targetState = join(dir, 'trusted-target', '.ontology');
            mkdirSync(version, { recursive: true });
            mkdirSync(targetState, { recursive: true });
            writeFileSync(join(version, 'runtime'), 'remove');
            writeFileSync(join(targetState, 'keep.db'), 'keep');
            symlinkSync(version, join(root, 'current'));
            const removed = spawnSync('bash', ['-c', uninstallBlock], {
                encoding: 'utf8',
                env: { ...process.env, SCI_ROOT: root, REMOVE_VERSION: 'candidate' },
            });
            expect(removed.status, removed.stderr || removed.stdout).toBe(0);
            expect(existsSync(version)).toBe(false);
            expect(existsSync(join(root, 'current'))).toBe(false);
            expect(readFileSync(join(targetState, 'keep.db'), 'utf8')).toBe('keep');

            const traversal = spawnSync('bash', ['-c', uninstallBlock], {
                encoding: 'utf8',
                env: { ...process.env, SCI_ROOT: root, REMOVE_VERSION: '../trusted-target' },
            });
            expect(traversal.status).toBe(2);
            expect(traversal.stderr).toContain('invalid version identifier');
            expect(readFileSync(join(targetState, 'keep.db'), 'utf8')).toBe('keep');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('artifact builder rejects duplicate and source-only members and compares payload digests', () => {
        const builder = read('scripts/build-local-production-artifact.ts');

        expect(builder).toContain('duplicate archive members');
        expect(builder).toContain('(src|scripts|tests|node_modules|\\.test-results)');
        expect(builder).toContain('Repeated pack runs produced different runtime payloads');
        expect(builder).toContain('semantic-code-intelligence.local_production_artifact.v1');
        expect(builder).toContain('trackedClean');
        expect(builder).not.toContain('npm publish');
        expect(builder).not.toContain('docker push');
    });

    function buildPackFixture(wrapperMode: number): { fixture: string; fakeBin: string } {
        const fixture = mkdtempSync(join(tmpdir(), 'sci-artifact-hygiene-'));
        const scripts = join(fixture, 'scripts');
        const fakeBin = join(fixture, 'fake-bin');
        const packageRoot = join(fixture, 'template', 'package');
        mkdirSync(join(packageRoot, 'bin'), { recursive: true });
        mkdirSync(join(packageRoot, 'dist', 'core'), { recursive: true });
        mkdirSync(join(packageRoot, 'dist', 'cli'), { recursive: true });
        mkdirSync(join(packageRoot, 'dist', 'mcp'), { recursive: true });
        mkdirSync(scripts, { recursive: true });
        mkdirSync(fakeBin, { recursive: true });
        copyFileSync(
            join(process.cwd(), 'scripts/build-local-production-artifact.ts'),
            join(scripts, 'build-local-production-artifact.ts')
        );
        copyFileSync(
            join(process.cwd(), 'scripts/local-production-candidate-safety.ts'),
            join(scripts, 'local-production-candidate-safety.ts')
        );
        for (const wrapper of ['sci', 'semantic-code-intelligence', 'semantic-code-mcp']) {
            writeFileSync(join(packageRoot, 'bin', wrapper), '#!/usr/bin/env bun\n');
            chmodSync(join(packageRoot, 'bin', wrapper), wrapperMode);
        }
        for (const member of [
            'package.json',
            'README.md',
            'CONFIG.md',
            'LICENSE',
            'dist/core/index.js',
            'dist/cli/cli.js',
            'dist/mcp/mcp.js'
        ]) {
            writeFileSync(join(packageRoot, member), `fixture payload for ${member}\n`);
        }
        const templateTar = join(fixture, 'template.tgz');
        const tar = spawnSync('tar', ['-czf', templateTar, '-C', join(fixture, 'template'), 'package']);
        expect(tar.status).toBe(0);
        const fakeBun = join(fakeBin, 'bun');
        writeFileSync(
            fakeBun,
            `#!/usr/bin/env bash\nset -euo pipefail\ndest="${'$'}5"\ncp "${JSON.stringify(templateTar).slice(1, -1)}" "$dest/semantic-code-intelligence-2.1.0-rc.2.tgz"\n`
        );
        chmodSync(fakeBun, 0o755);
        mkdirSync(join(fixture, 'bin'), { recursive: true });
        for (const wrapper of ['sci', 'semantic-code-intelligence', 'semantic-code-mcp']) {
            writeFileSync(join(fixture, 'bin', wrapper), '#!/usr/bin/env bun\n');
            chmodSync(join(fixture, 'bin', wrapper), 0o755);
        }
        const gitInit = [
            spawnSync('git', ['-C', fixture, 'init', '-q']),
            spawnSync('git', ['-C', fixture, 'add', '-A', '--', ':!template', ':!fake-bin']),
            spawnSync('git', ['-C', fixture, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '-m', 'fixture'])
        ];
        for (const step of gitInit) expect(step.status).toBe(0);
        return { fixture, fakeBin };
    }

    test('artifact payload is globally ordered with 0755 wrappers bound into digest evidence', () => {
        const { fixture, fakeBin } = buildPackFixture(0o755);
        try {
            const ok = spawnSync(
                process.execPath,
                [join(fixture, 'scripts', 'build-local-production-artifact.ts'), '--skip-build'],
                {
                    cwd: fixture,
                    encoding: 'utf8',
                    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` }
                }
            );
            expect(ok.status).toBe(0);
            const manifest = JSON.parse(readFileSync(join(fixture, '.test-results/local-production-artifact/artifact-manifest.json'), 'utf8'));
            const entries: Array<{ path: string; mode: string; sha256: string; bytes: number }> = manifest.artifact.entries;
            expect(manifest.artifact.repeatablePayload).toBe(true);
            expect(entries.map((entry) => entry.path)).toEqual([...entries.map((entry) => entry.path)].sort());
            expect(entries[0].path).toBe('CONFIG.md');
            for (const wrapper of ['bin/sci', 'bin/semantic-code-intelligence', 'bin/semantic-code-mcp']) {
                expect(entries.find((entry) => entry.path === wrapper)?.mode).toBe('0755');
            }
            const expectedDigest = createHash('sha256')
                .update(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\0${entry.mode}`).join('\n'))
                .digest('hex');
            expect(manifest.artifact.payloadDigest).toBe(expectedDigest);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    test('artifact builder fails closed when archived wrappers are not mode 0755', () => {
        const { fixture, fakeBin } = buildPackFixture(0o777);
        try {
            const failed = spawnSync(
                process.execPath,
                [join(fixture, 'scripts', 'build-local-production-artifact.ts'), '--skip-build'],
                {
                    cwd: fixture,
                    encoding: 'utf8',
                    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` }
                }
            );
            expect(failed.status).toBe(1);
            expect(failed.stderr).toContain('candidate_artifact_validation_failed');
            expect(failed.stderr).not.toContain('Runtime wrappers');
            const diagnostics = spawnSync(
                process.execPath,
                [join(fixture, 'scripts', 'build-local-production-artifact.ts'), '--skip-build'],
                {
                    cwd: fixture,
                    encoding: 'utf8',
                    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, SCI_LOCAL_PRODUCTION_DIAGNOSTICS: '1' }
                }
            );
            expect(diagnostics.status).toBe(1);
            expect(diagnostics.stderr).toContain('Runtime wrappers must be mode 0755');
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    test('artifact builder rejects outside and symlink-escaped output roots before deletion', () => {
        mkdirSync('.test-results', { recursive: true });
        const outside = mkdtempSync(join(tmpdir(), 'sci-artifact-output-escape-'));
        const link = join('.test-results', `artifact-output-link-${process.pid}-${Date.now()}`);
        const sentinel = join(outside, 'keep');
        writeFileSync(sentinel, 'keep');
        symlinkSync(outside, link, 'dir');

        try {
            const escaped = spawnSync(
                'bun',
                [
                    'run',
                    'scripts/build-local-production-artifact.ts',
                    '--skip-build',
                    '--output-dir',
                    join(link, 'candidate'),
                ],
                { cwd: process.cwd(), encoding: 'utf8' }
            );
            expect(escaped.status).toBe(1);
            expect(escaped.stderr).toContain('candidate_setup_failed');
            expect(escaped.stderr).not.toContain(outside);
            expect(escaped.stderr).not.toContain('symlinked ancestor');
            expect(readFileSync(sentinel, 'utf8')).toBe('keep');

            const diagnosed = spawnSync(
                'bun',
                [
                    'run',
                    'scripts/build-local-production-artifact.ts',
                    '--skip-build',
                    '--output-dir',
                    join(link, 'candidate'),
                ],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    env: { ...process.env, SCI_LOCAL_PRODUCTION_DIAGNOSTICS: '1' },
                }
            );
            expect(diagnosed.status).toBe(1);
            expect(diagnosed.stderr).toContain('diagnostic (not promoted)');
            expect(diagnosed.stderr).toContain('Artifact output must not traverse a symlinked ancestor');

            const outsideRoot = spawnSync(
                'bun',
                [
                    'run',
                    'scripts/build-local-production-artifact.ts',
                    '--skip-build',
                    '--output-dir',
                    join(outside, 'candidate'),
                ],
                { cwd: process.cwd(), encoding: 'utf8' }
            );
            expect(outsideRoot.status).toBe(1);
            expect(outsideRoot.stderr).toContain('candidate_setup_failed');
            expect(outsideRoot.stderr).not.toContain(outside);
            expect(outsideRoot.stderr).not.toContain('must stay below');
            expect(readFileSync(sentinel, 'utf8')).toBe('keep');
        } finally {
            rmSync(link, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('artifact builder default stderr excludes child-controlled diagnostics', () => {
        const fixture = mkdtempSync(join(tmpdir(), 'sci-artifact-builder-failure-'));
        const scripts = join(fixture, 'scripts');
        const fakeBin = join(fixture, 'bin');
        const secret = 'artifact-builder-secret-token';
        const submittedPath = '/sensitive/artifact/source';
        mkdirSync(scripts, { recursive: true });
        mkdirSync(fakeBin, { recursive: true });
        copyFileSync(
            join(process.cwd(), 'scripts/build-local-production-artifact.ts'),
            join(scripts, 'build-local-production-artifact.ts')
        );
        copyFileSync(
            join(process.cwd(), 'scripts/local-production-candidate-safety.ts'),
            join(scripts, 'local-production-candidate-safety.ts')
        );
        const fakeBun = join(fakeBin, 'bun');
        writeFileSync(
            fakeBun,
            `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(`${secret} ${submittedPath} stdout`)}\nprintf '%s\\n' ${JSON.stringify(`${secret} ${submittedPath} stderr`)} >&2\nexit 23\n`
        );
        chmodSync(fakeBun, 0o755);
        writeFileSync(join(fakeBin, 'sci'), '#!/usr/bin/env bun\n');
        chmodSync(join(fakeBin, 'sci'), 0o755);
        writeFileSync(join(fakeBin, 'semantic-code-intelligence'), '#!/usr/bin/env bun\n');
        chmodSync(join(fakeBin, 'semantic-code-intelligence'), 0o755);
        writeFileSync(join(fakeBin, 'semantic-code-mcp'), '#!/usr/bin/env bun\n');
        chmodSync(join(fakeBin, 'semantic-code-mcp'), 0o755);

        try {
            const failed = spawnSync(
                process.execPath,
                [join(scripts, 'build-local-production-artifact.ts'), '--skip-build'],
                {
                    cwd: fixture,
                    encoding: 'utf8',
                    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
                }
            );
            expect(failed.status).toBe(1);
            expect(failed.stderr).toContain('candidate_artifact_build_failed');
            expect(failed.stderr).not.toContain(secret);
            expect(failed.stderr).not.toContain(submittedPath);
            expect(failed.stdout).not.toContain(secret);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    test('candidate failure evidence is typed and excludes child-controlled diagnostics', () => {
        const fixture = mkdtempSync(join(tmpdir(), 'sci-candidate-failure-evidence-'));
        const scripts = join(fixture, 'scripts');
        const secret = 'token-super-secret-value';
        const submittedPath = '/sensitive/operator/repository';
        mkdirSync(scripts, { recursive: true });
        copyFileSync(
            join(process.cwd(), 'scripts/dogfood-local-production-candidate.ts'),
            join(scripts, 'dogfood-local-production-candidate.ts')
        );
        copyFileSync(
            join(process.cwd(), 'scripts/local-production-candidate-safety.ts'),
            join(scripts, 'local-production-candidate-safety.ts')
        );
        writeFileSync(
            join(scripts, 'build-local-production-artifact.ts'),
            `process.stderr.write(${JSON.stringify(`${secret} ${submittedPath} producer stack detail\\n`)}); process.exit(23);\n`
        );
        mkdirSync(join(fixture, '.test-results'));
        writeFileSync(
            join(fixture, '.test-results/local-production-candidate.json'),
            '{"schema":"semantic-code-intelligence.local_production_candidate.v1","runId":"stale-run","ok":true,"candidateReady":true}\n'
        );

        try {
            const failed = spawnSync('bun', ['run', 'scripts/dogfood-local-production-candidate.ts', '--json'], {
                cwd: fixture,
                encoding: 'utf8',
                env: { ...process.env, SCI_LOCAL_PRODUCTION_DIAGNOSTICS: undefined },
            });
            expect(failed.status).toBe(1);
            expect(failed.stderr).toContain('candidate_artifact_build_failed');
            expect(failed.stderr).not.toContain(secret);
            expect(failed.stderr).not.toContain(submittedPath);

            const packetText = readFileSync(join(fixture, '.test-results/local-production-candidate.json'), 'utf8');
            const packet = JSON.parse(packetText);
            expect(packet).toEqual({
                schema: 'semantic-code-intelligence.local_production_candidate.v1',
                runId: expect.any(String),
                ok: false,
                candidateReady: false,
                failure: {
                    code: 'candidate_artifact_build_failed',
                    stage: 'artifact_build',
                    message: 'Local candidate artifact build failed.',
                    diagnosticsPromoted: false,
                },
            });
            expect(packetText).not.toContain(secret);
            expect(packetText).not.toContain(submittedPath);
            expect(packetText).not.toContain(fixture);
            expect(packet.runId).not.toBe('stale-run');

            writeFileSync(
                join(scripts, 'build-local-production-artifact.ts'),
                `import { mkdirSync } from 'node:fs';\nmkdirSync('.test-results/local-production-candidate.json');\nprocess.stderr.write(${JSON.stringify(`${secret} ${submittedPath} write failure\\n`)});\nprocess.exit(23);\n`
            );
            const unwritable = spawnSync('bun', ['run', 'scripts/dogfood-local-production-candidate.ts', '--json'], {
                cwd: fixture,
                encoding: 'utf8',
                env: { ...process.env, SCI_LOCAL_PRODUCTION_DIAGNOSTICS: undefined },
            });
            expect(unwritable.status).toBe(1);
            expect(unwritable.stderr).toContain('candidate_evidence_write_failed');
            expect(unwritable.stderr).not.toContain(secret);
            expect(unwritable.stderr).not.toContain(submittedPath);
            expect(statSync(join(fixture, '.test-results/local-production-candidate.json')).isDirectory()).toBe(true);

            const projected = toCandidateFailureEvidence(
                new CandidateStageError('mcp_stdio', new Error(`${secret} ${submittedPath}`))
            );
            expect(projected).toEqual({
                code: 'candidate_mcp_stdio_failed',
                stage: 'mcp_stdio',
                message: 'Installed MCP stdio validation failed.',
                diagnosticsPromoted: false,
            });
            expect(JSON.stringify(projected)).not.toContain(secret);
            expect(JSON.stringify(projected)).not.toContain(submittedPath);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    test('MCP shutdown is bounded when close precedes observation or SIGTERM is ignored', async () => {
        const alreadyClosed = spawn(process.execPath, ['-e', 'process.exit(0)'], {
            stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessWithoutNullStreams;
        await once(alreadyClosed, 'close');
        const closedStart = Date.now();
        await shutdownMcpProcess(alreadyClosed, { termAfterMs: 5, killAfterMs: 10, finalAfterMs: 100 });
        expect(Date.now() - closedStart).toBeLessThan(100);

        const stubborn = spawn(
            process.execPath,
            ['-e', "process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000);"],
            { stdio: ['pipe', 'pipe', 'pipe'] }
        ) as ChildProcessWithoutNullStreams;
        try {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
            const stubbornStart = Date.now();
            await shutdownMcpProcess(stubborn, { termAfterMs: 10, killAfterMs: 40, finalAfterMs: 500 });
            expect(Date.now() - stubbornStart).toBeLessThan(1000);
            expect(stubborn.exitCode !== null || stubborn.signalCode !== null).toBe(true);
        } finally {
            if (stubborn.exitCode === null && stubborn.signalCode === null) stubborn.kill('SIGKILL');
        }
    });

    test('dogfood executes installed CLI and MCP stdio bins without applying changes', () => {
        const dogfood = read('scripts/dogfood-local-production-candidate.ts');
        const safety = read('scripts/local-production-candidate-safety.ts');

        expect(dogfood).toContain('node_modules/.bin/semantic-code-intelligence');
        expect(dogfood).toContain('node_modules/.bin/semantic-code-mcp');
        expect(dogfood).toContain("name: 'read_file'");
        expect(dogfood).toContain("'tools/list'");
        expect(dogfood).toContain('stdoutClean: true');
        expect(dogfood).toContain('function isJsonRpcRecord');
        expect(dogfood).toContain("typeof message.method === 'string'");
        expect(dogfood).toContain('hasResult === hasError');
        expect(dogfood).toContain('metadata.isSymbolicLink()');
        expect(dogfood).toContain('readlinkSync(absolute)');
        expect(dogfood).toContain('describeEntry(targetRoot, targetRoot)');
        expect(dogfood).toContain("runtimeStateRoot: '.ontology'");
        expect(dogfood).toContain('shutdownMcpProcess(proc)');
        expect(safety).toContain("proc.kill('SIGKILL')");
        expect(safety).toContain('MCP stdio shutdown exceeded its final deadline');
        expect(dogfood).toContain('workspace source tree');
        expect(dogfood).toContain('candidateReady');
        expect(dogfood).not.toContain('ALLOW_SNAPSHOT_APPLY');
    });

    test('accepted decision keeps hosted and network service claims outside the candidate', () => {
        const adr = read('docs/adr/0004-local-single-user-production-candidate.md');
        const contract = read('docs/project/local-single-user-production-readiness.md');

        expect(adr).toContain('Status: Accepted');
        expect(adr).toContain('CLI and MCP stdio');
        expect(adr).toContain('no publication, deployment, hosted service, or multi-tenant claim');
        expect(contract).toContain('HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes');
        expect(contract).toContain('run_checks');
        expect(contract).toContain('not a sandbox');
    });

    test('unverified root container deployment surfaces are absent', () => {
        expect(existsSync('Dockerfile')).toBe(false);
        expect(existsSync('docker-compose.yml')).toBe(false);
    });

    test('unsupported container and Kubernetes recipes fail closed', () => {
        const justfile = read('justfile');
        for (const recipe of [
            'docker-build:',
            'docker-push ',
            'rollback ',
            'deploy-status ',
            'scale ',
            'port-forward ',
        ]) {
            expect(justfile).toContain(recipe);
        }
        expect(justfile).not.toContain('kubectl rollout undo');
        expect(justfile).not.toContain('kubectl scale deployment/semantic-code-intelligence');
        expect(justfile).not.toContain('docker push');
    });
});
