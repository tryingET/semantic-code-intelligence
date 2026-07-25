import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type StructuralEvidenceRequest,
    structuralEvidenceRequestDigest,
    validateStructuralEvidenceReceipt,
} from '../src/core/workflows/structural-evidence-contract.js';
import {
    exportStructuralEvidenceReceipt,
    type StructuralEvidenceExportDependencies,
} from '../src/core/workflows/structural-evidence-export-workflow.js';

const roots: string[] = [];

function run(cwd: string, command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
    return String(result.stdout || '').trim();
}

function createRepository(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-evidence-export-test-'));
    roots.push(root);
    run(root, 'git', ['init', '--quiet']);
    run(root, 'git', ['config', 'user.email', 'sci@example.invalid']);
    run(root, 'git', ['config', 'user.name', 'SCI Test']);
    writeFileSync(join(root, 'sample.ts'), 'const alpha = 1;\nconst beta = 2;\n', 'utf8');
    run(root, 'git', ['add', 'sample.ts']);
    run(root, 'git', ['commit', '--quiet', '-m', 'fixture']);
    return root;
}

function request(overrides: Partial<StructuralEvidenceRequest> = {}): StructuralEvidenceRequest {
    return {
        question: 'Where are constant declarations?',
        seeds: [
            { id: 'seed:language', kind: 'text', value: 'ts' },
            { id: 'seed:pattern', kind: 'text', value: 'const $A = $B' },
            { id: 'seed:sample', kind: 'path', value: 'sample.ts' },
        ],
        operations: ['structural_search'],
        limits: {
            maxCandidates: 20,
            maxCandidatesPerFile: 20,
            maxEvidenceBytes: 65_536,
            timeoutMs: 30_000,
        },
        ...overrides,
    };
}

afterEach(() => {
    while (roots.length) {
        const root = roots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

describe('experimental structural evidence exporter', () => {
    test('emits a self-validating receipt bound to a clean commit and normalized question', async () => {
        const root = createRepository();
        const before = run(root, 'git', ['status', '--porcelain=v1', '--untracked-files=all']);

        const receipt = await exportStructuralEvidenceReceipt(
            request({ question: '  Where   are constant declarations?  ' }),
            { workspaceRoot: root }
        );

        expect(validateStructuralEvidenceReceipt(receipt)).toEqual({ ok: true, value: receipt });
        expect(receipt.request.question).toBe('Where are constant declarations?');
        expect(receipt.requestDigest).toBe(structuralEvidenceRequestDigest(receipt.request));
        expect(receipt.repository.snapshotId).toMatch(/^git:[a-f0-9]{40}$/);
        expect(receipt.repository.stableAcrossExecution).toBe(true);
        expect(receipt.backend.name).toBe('ast-grep');
        expect(receipt.backend.version).toMatch(/^\d+\.\d+/);
        expect(receipt.evidence.length).toBe(2);
        expect(receipt.evidence.every((item) => item.identity.path === 'sample.ts')).toBe(true);
        expect(receipt.evidence.every((item) => item.identity.kind === 'match')).toBe(true);
        expect(JSON.stringify(receipt.evidence)).not.toMatch(/"(?:rank|score)"/);
        expect(run(root, 'git', ['status', '--porcelain=v1', '--untracked-files=all'])).toBe(before);
        expect(existsSync(join(root, '.ontology'))).toBe(false);
    });

    test('applies global and per-file caps without ranking candidates', async () => {
        const root = createRepository();
        const limited = request({
            limits: {
                maxCandidates: 1,
                maxCandidatesPerFile: 1,
                maxEvidenceBytes: 65_536,
                timeoutMs: 30_000,
            },
        });

        const receipt = await exportStructuralEvidenceReceipt(limited, { workspaceRoot: root });

        expect(receipt.summary).toMatchObject({ returnedCount: 1, totalObservedCount: 2, capped: true });
        expect(receipt.summary.complete).toBe(false);
        expect(receipt.evidence[0].snippet).toBe('const alpha = 1;');
    });

    test('rejects dirty repositories and unsupported operation or seed shapes', async () => {
        const root = createRepository();
        await writeFile(join(root, 'untracked.ts'), 'const untracked = true;\n');
        await expect(exportStructuralEvidenceReceipt(request(), { workspaceRoot: root })).rejects.toThrow(
            'clean repository'
        );
        await rm(join(root, 'untracked.ts'));

        await expect(
            exportStructuralEvidenceReceipt(request({ operations: ['find_definition'] }), { workspaceRoot: root })
        ).rejects.toThrow('exactly one structural_search');
        const badSeeds = request();
        badSeeds.seeds.push({ id: 'seed:query', kind: 'text', value: 'extra' });
        await expect(exportStructuralEvidenceReceipt(badSeeds, { workspaceRoot: root })).rejects.toThrow(
            'request requires one seed:language'
        );
    });

    test('rejects final and parent symlinks in backend evidence paths', async () => {
        const root = createRepository();
        symlinkSync('/etc/passwd', join(root, 'escape.ts'));
        mkdirSync(join(root, 'real'));
        writeFileSync(join(root, 'real', 'nested.ts'), 'const nested = 1;\n', 'utf8');
        symlinkSync('real', join(root, 'internal-link'));
        run(root, 'git', ['add', 'escape.ts', 'real/nested.ts', 'internal-link']);
        run(root, 'git', ['commit', '--quiet', '-m', 'add symlink fixtures']);
        const dependencies: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: () => ({ command: '/usr/bin/ast-grep', name: 'ast-grep', version: '0.42.0' }),
            runProcess: async () => ({
                status: 0,
                stdout: `${JSON.stringify({
                    file: 'escape.ts',
                    text: 'root',
                    range: {
                        byteOffset: { start: 0, end: 4 },
                        start: { line: 0, column: 0 },
                        end: { line: 0, column: 4 },
                    },
                })}\n`,
                stderr: '',
                timedOut: false,
                outputExceeded: false,
            }),
        };

        await expect(exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies })).rejects.toThrow(
            'regular committed file'
        );

        dependencies.runProcess = async () => ({
            status: 0,
            stdout: `${JSON.stringify({
                file: 'internal-link/nested.ts',
                text: 'const nested = 1;',
                range: {
                    byteOffset: { start: 0, end: 17 },
                    start: { line: 0, column: 0 },
                    end: { line: 0, column: 17 },
                },
            })}\n`,
            stderr: '',
            timedOut: false,
            outputExceeded: false,
        });
        await expect(exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies })).rejects.toThrow(
            'regular committed file'
        );
    });

    test('rejects a TMPDIR contained by the target even when Git ignores it', async () => {
        const root = createRepository();
        const ignoredTemp = join(root, '.ignored-temp');
        mkdirSync(ignoredTemp);
        writeFileSync(join(root, '.gitignore'), '.ignored-temp/\n', 'utf8');
        run(root, 'git', ['add', '.gitignore']);
        run(root, 'git', ['commit', '--quiet', '-m', 'ignore local temp']);
        const previous = process.env.TMPDIR;
        process.env.TMPDIR = ignoredTemp;
        try {
            await expect(exportStructuralEvidenceReceipt(request(), { workspaceRoot: root })).rejects.toThrow(
                'temporary directory must be outside'
            );
        } finally {
            if (previous === undefined) delete process.env.TMPDIR;
            else process.env.TMPDIR = previous;
        }
        expect(readdirSync(ignoredTemp)).toEqual([]);
    });

    test('fails closed on backend timeout and repository drift', async () => {
        const root = createRepository();
        const timedOut: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: () => ({ command: '/usr/bin/ast-grep', name: 'ast-grep', version: '0.42.0' }),
            runProcess: async () => ({
                status: null,
                stdout: '',
                stderr: '',
                timedOut: true,
                outputExceeded: false,
            }),
        };
        await expect(
            exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies: timedOut })
        ).rejects.toThrow('timed out');

        const malformed: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: timedOut.findBackend,
            runProcess: async () => ({
                status: 0,
                stdout: '{not-json}\n',
                stderr: '',
                timedOut: false,
                outputExceeded: false,
            }),
        };
        await expect(
            exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies: malformed })
        ).rejects.toThrow('malformed JSON');

        const nonexistent: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: timedOut.findBackend,
            runProcess: async () => ({
                status: 0,
                stdout: `${JSON.stringify({
                    file: 'missing.ts',
                    text: 'x',
                    range: {
                        byteOffset: { start: 0, end: 1 },
                        start: { line: 0, column: 0 },
                        end: { line: 0, column: 1 },
                    },
                })}\n`,
                stderr: '',
                timedOut: false,
                outputExceeded: false,
            }),
        };
        await expect(
            exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies: nonexistent })
        ).rejects.toThrow('regular committed file');

        const mismatched = { ...nonexistent };
        mismatched.runProcess = async () => ({
            status: 0,
            stdout: `${JSON.stringify({
                file: 'sample.ts',
                text: 'wrong',
                range: {
                    byteOffset: { start: 0, end: 5 },
                    start: { line: 0, column: 0 },
                    end: { line: 0, column: 5 },
                },
            })}\n`,
            stderr: '',
            timedOut: false,
            outputExceeded: false,
        });
        await expect(
            exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies: mismatched })
        ).rejects.toThrow('snippet does not match');

        const forgedQueryCopy: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: timedOut.findBackend,
            runProcess: async (_command, _args, options) => {
                await writeFile(join(options.cwd, 'sample.ts'), 'const forged = 9;\n');
                return {
                    status: 0,
                    stdout: `${JSON.stringify({
                        file: 'sample.ts',
                        text: 'const forged = 9;',
                        range: {
                            byteOffset: { start: 0, end: 17 },
                            start: { line: 0, column: 0 },
                            end: { line: 0, column: 17 },
                        },
                    })}\n`,
                    stderr: '',
                    timedOut: false,
                    outputExceeded: false,
                };
            },
        };
        await expect(
            exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies: forgedQueryCopy })
        ).rejects.toThrow('snippet does not match');

        const drift: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: timedOut.findBackend,
            runProcess: async () => {
                await writeFile(join(root, 'sample.ts'), 'const changed = 3;\n');
                return { status: 0, stdout: '', stderr: '', timedOut: false, outputExceeded: false };
            },
        };
        await expect(
            exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies: drift })
        ).rejects.toThrow('clean repository');
    });

    test('cleanup failure prevents receipt publication', async () => {
        const root = createRepository();
        const temporaryRoots = [
            mkdtempSync(join(tmpdir(), 'sci-evidence-cleanup-failure-a-')),
            mkdtempSync(join(tmpdir(), 'sci-evidence-cleanup-failure-b-')),
        ];
        roots.push(...temporaryRoots);
        let nextRoot = 0;
        const dependencies: Partial<StructuralEvidenceExportDependencies> = {
            makeTemporaryRoot: async () => temporaryRoots[nextRoot++],
            removeTemporaryRoot: async () => {
                throw new Error('simulated cleanup failure');
            },
        };

        await expect(exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies })).rejects.toThrow(
            'simulated cleanup failure'
        );
    });

    test('an abort arriving during cleanup prevents late receipt publication', async () => {
        const root = createRepository();
        const controller = new AbortController();
        const dependencies: Partial<StructuralEvidenceExportDependencies> = {
            removeTemporaryRoot: async (temporaryRoot) => {
                controller.abort();
                await rm(temporaryRoot, { recursive: true, force: true });
            },
        };

        await expect(
            exportStructuralEvidenceReceipt(request(), {
                workspaceRoot: root,
                dependencies,
                signal: controller.signal,
            })
        ).rejects.toThrow('aborted');
    });

    test('uses the fixed complete-scan ignore policy and an option terminator for every path list', async () => {
        const root = createRepository();
        writeFileSync(join(root, '--help.ts'), 'const optionShaped = 1;\n', 'utf8');
        writeFileSync(join(root, '.hidden.ts'), 'const hidden = 1;\n', 'utf8');
        writeFileSync(join(root, 'dot-ignored.ts'), 'const dotIgnored = 1;\n', 'utf8');
        writeFileSync(join(root, 'global-ignored.ts'), 'const globalIgnored = 1;\n', 'utf8');
        writeFileSync(join(root, '.ignore'), 'dot-ignored.ts\n', 'utf8');
        const globalIgnoreRoot = mkdtempSync(join(tmpdir(), 'sci-evidence-global-ignore-'));
        roots.push(globalIgnoreRoot);
        const excludesFile = join(globalIgnoreRoot, 'global-ignore');
        const globalConfig = join(globalIgnoreRoot, 'gitconfig');
        writeFileSync(excludesFile, 'global-ignored.ts\n', 'utf8');
        writeFileSync(globalConfig, `[core]\n\texcludesFile = ${excludesFile}\n`, 'utf8');
        run(root, 'git', [
            'add',
            '-f',
            '--',
            '--help.ts',
            '.hidden.ts',
            'dot-ignored.ts',
            'global-ignored.ts',
            '.ignore',
        ]);
        run(root, 'git', ['commit', '--quiet', '-m', 'add ignored and option-shaped sources']);

        const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        try {
            const allSources = request({
                seeds: [
                    { id: 'seed:language', kind: 'text', value: 'ts' },
                    { id: 'seed:pattern', kind: 'text', value: 'const $A = $B' },
                ],
            });
            const allReceipt = await exportStructuralEvidenceReceipt(allSources, { workspaceRoot: root });
            expect([...new Set(allReceipt.evidence.map((item) => item.identity.path))].sort()).toEqual([
                '--help.ts',
                '.hidden.ts',
                'dot-ignored.ts',
                'global-ignored.ts',
                'sample.ts',
            ]);

            let observedArgs: string[] = [];
            const dependencies: Partial<StructuralEvidenceExportDependencies> = {
                runProcess: async (command, args, options) => {
                    observedArgs = args;
                    const { runStructuralEvidenceProcess } = await import(
                        '../src/core/workflows/structural-evidence-process.js'
                    );
                    return await runStructuralEvidenceProcess(command, args, options);
                },
            };
            const optionReceipt = await exportStructuralEvidenceReceipt(
                request({
                    seeds: [
                        { id: 'seed:language', kind: 'text', value: 'ts' },
                        { id: 'seed:pattern', kind: 'text', value: 'const $A = $B' },
                        { id: 'seed:option', kind: 'path', value: '--help.ts' },
                    ],
                }),
                { workspaceRoot: root, dependencies }
            );
            expect(optionReceipt.evidence.map((item) => item.identity.path)).toEqual(['--help.ts']);
            const terminator = observedArgs.indexOf('--');
            expect(terminator).toBeGreaterThan(0);
            expect(observedArgs.slice(terminator + 1)).toEqual(['--help.ts']);
            expect(observedArgs.slice(0, terminator)).toEqual(
                expect.arrayContaining(['--no-ignore', 'hidden', 'dot', 'exclude', 'global', 'parent', 'vcs'])
            );
            expect(observedArgs.filter((arg) => arg === '--no-ignore')).toHaveLength(6);
        } finally {
            if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
            else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
        }
    });

    test('materializes exact Git blob bytes despite ident and EOL checkout attributes', async () => {
        const root = createRepository();
        writeFileSync(join(root, '.gitattributes'), 'filtered.ts ident text eol=crlf\n', 'utf8');
        writeFileSync(join(root, 'filtered.ts'), 'const marker = "$Id$";\nconst alpha = 1;\n', 'utf8');
        run(root, 'git', ['add', '.gitattributes', 'filtered.ts']);
        run(root, 'git', ['commit', '--quiet', '-m', 'add filtered source']);
        const rawResult = spawnSync('git', ['-C', root, 'cat-file', 'blob', 'HEAD:filtered.ts']);
        expect(rawResult.status).toBe(0);
        const rawBlob = Buffer.from(rawResult.stdout || '');
        expect(rawBlob.toString('utf8')).toContain('$Id$');
        let searchedBytes = Buffer.alloc(0);
        const snippet = 'const alpha = 1;';
        const byteStart = rawBlob.indexOf(snippet);
        const dependencies: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: () => ({ command: '/usr/bin/ast-grep', name: 'ast-grep', version: '0.42.0' }),
            runProcess: async (_command, _args, options) => {
                searchedBytes = readFileSync(join(options.cwd, 'filtered.ts'));
                return {
                    status: 0,
                    stdout: `${JSON.stringify({
                        file: 'filtered.ts',
                        text: snippet,
                        range: {
                            byteOffset: { start: byteStart, end: byteStart + Buffer.byteLength(snippet) },
                            start: { line: 1, column: 0 },
                            end: { line: 1, column: [...snippet].length },
                        },
                    })}\n`,
                    stderr: '',
                    timedOut: false,
                    outputExceeded: false,
                };
            },
        };

        const receipt = await exportStructuralEvidenceReceipt(
            request({
                seeds: [
                    { id: 'seed:language', kind: 'text', value: 'ts' },
                    { id: 'seed:pattern', kind: 'text', value: 'const $A = $B' },
                    { id: 'seed:filtered', kind: 'path', value: 'filtered.ts' },
                ],
            }),
            { workspaceRoot: root, dependencies }
        );

        expect(searchedBytes).toEqual(rawBlob);
        expect(receipt.evidence[0].snippet).toBe(snippet);
    });

    test('disables Git replacement objects for cleanliness, fingerprint, and raw blob capture', async () => {
        const root = createRepository();
        const originalCommit = run(root, 'git', ['rev-parse', '--verify', 'HEAD']);
        writeFileSync(join(root, 'sample.ts'), 'const replacementOnly = 9;\n', 'utf8');
        run(root, 'git', ['add', 'sample.ts']);
        const replacementTree = run(root, 'git', ['write-tree']);
        const replacementCommit = run(root, 'git', ['commit-tree', replacementTree, '-m', 'replacement fixture']);
        run(root, 'git', ['reset', '--hard', originalCommit]);
        run(root, 'git', ['replace', originalCommit, replacementCommit]);

        const receipt = await exportStructuralEvidenceReceipt(request(), { workspaceRoot: root });

        expect(receipt.repository.snapshotId).toBe(`git:${originalCommit}`);
        expect(receipt.evidence.map((item) => item.snippet)).toEqual(['const alpha = 1;', 'const beta = 2;']);
        expect(receipt.evidence.map((item) => item.snippet).join('\n')).not.toContain('replacementOnly');
    });

    test('verifies BMP and astral scalar columns across multiline match boundaries', async () => {
        const root = createRepository();
        const prefix = 'const prefix = "é😀"; ';
        const snippet = 'const alpha = {\n  value: "💡"\n};';
        const source = `${prefix}${snippet}\n`;
        writeFileSync(join(root, 'unicode.ts'), source, 'utf8');
        run(root, 'git', ['add', 'unicode.ts']);
        run(root, 'git', ['commit', '--quiet', '-m', 'add unicode source']);
        const sourceBytes = Buffer.from(source, 'utf8');
        const byteStart = Buffer.byteLength(prefix, 'utf8');
        const byteEnd = byteStart + Buffer.byteLength(snippet, 'utf8');
        const unicodeRequest = request({
            seeds: [
                { id: 'seed:language', kind: 'text', value: 'ts' },
                { id: 'seed:pattern', kind: 'text', value: 'const $A = $B' },
                { id: 'seed:unicode', kind: 'path', value: 'unicode.ts' },
            ],
        });
        const dependencies: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: () => ({ command: '/usr/bin/ast-grep', name: 'ast-grep', version: '0.42.0' }),
            runProcess: async () => ({
                status: 0,
                stdout: `${JSON.stringify({
                    file: 'unicode.ts',
                    text: snippet,
                    range: {
                        byteOffset: { start: byteStart, end: byteEnd },
                        start: { line: 0, column: [...prefix].length },
                        end: { line: 2, column: 2 },
                    },
                })}\n`,
                stderr: '',
                timedOut: false,
                outputExceeded: false,
            }),
        };

        const receipt = await exportStructuralEvidenceReceipt(unicodeRequest, { workspaceRoot: root, dependencies });
        expect(sourceBytes.subarray(byteStart, byteEnd).toString('utf8')).toBe(snippet);
        expect(receipt.evidence[0].identity.range).toEqual({
            start: { line: 0, column: [...prefix].length },
            end: { line: 2, column: 2 },
        });

        dependencies.runProcess = async () => ({
            status: 0,
            stdout: `${JSON.stringify({
                file: 'unicode.ts',
                text: snippet,
                range: {
                    byteOffset: { start: byteStart, end: byteEnd },
                    start: { line: 0, column: prefix.length },
                    end: { line: 2, column: 2 },
                },
            })}\n`,
            stderr: '',
            timedOut: false,
            outputExceeded: false,
        });
        await expect(
            exportStructuralEvidenceReceipt(unicodeRequest, { workspaceRoot: root, dependencies })
        ).rejects.toThrow('line and column range');
    });

    test('unconfirmed backend termination fails publication after standalone capture cleanup', async () => {
        const root = createRepository();
        let cleanupCalls = 0;
        const dependencies: Partial<StructuralEvidenceExportDependencies> = {
            findBackend: () => ({ command: '/usr/bin/ast-grep', name: 'ast-grep', version: '0.42.0' }),
            runProcess: async () => ({
                status: null,
                stdout: '',
                stderr: 'process termination was not confirmed within 25ms',
                timedOut: true,
                outputExceeded: false,
                aborted: false,
                terminationConfirmed: false,
            }),
            removeTemporaryRoot: async (temporaryRoot) => {
                cleanupCalls += 1;
                await rm(temporaryRoot, { recursive: true, force: true });
            },
        };

        await expect(exportStructuralEvidenceReceipt(request(), { workspaceRoot: root, dependencies })).rejects.toThrow(
            'termination was not confirmed'
        );
        expect(cleanupCalls).toBe(2);
    });

    test('changing only the question changes the request and receipt digests', async () => {
        const root = createRepository();
        const first = await exportStructuralEvidenceReceipt(request(), { workspaceRoot: root });
        const second = await exportStructuralEvidenceReceipt(request({ question: 'Where is alpha declared?' }), {
            workspaceRoot: root,
        });

        expect(second.requestDigest).not.toBe(first.requestDigest);
        expect(second.receiptDigest).not.toBe(first.receiptDigest);
        expect(second.evidence.map((item) => item.id)).toEqual(first.evidence.map((item) => item.id));
    });
});
