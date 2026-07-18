import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';

function read(path: string): string {
    return readFileSync(path, 'utf8');
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
