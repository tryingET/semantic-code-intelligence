import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
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
            bin?: Record<string, string>;
            files?: string[];
            scripts?: Record<string, string>;
            sciPackageContract?: { sourceOnlyScripts?: string[] };
        };
        const binPaths = Object.values(pkg.bin ?? {});

        expect(pkg.private).toBe(true);
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

    test('dogfood executes installed CLI and MCP stdio bins without applying changes', () => {
        const dogfood = read('scripts/dogfood-local-production-candidate.ts');

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
        expect(dogfood).toContain("proc.kill('SIGKILL')");
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
