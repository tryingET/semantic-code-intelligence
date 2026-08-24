#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    assertContainedRealDirectory,
    assertNoSymlinkedAncestors,
    candidateLocalDiagnostic,
    CandidateStageError,
    type CandidateFailureStage,
    cleanupContainedDirectory,
    ensurePhysicalResultsRoot,
    resolveContainedRegularFile,
    toCandidateFailureEvidence,
    writeJsonAtomically,
} from './local-production-candidate-safety.js';

const repoRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const skipBuild = args.includes('--skip-build');
const outputArg = args.indexOf('--output-dir');
const outputRoot = resolve(repoRoot, outputArg >= 0 ? (args[outputArg + 1] ?? '') : '.test-results/local-production-artifact');
let activeStage: CandidateFailureStage = 'setup';

interface PayloadEntry {
    path: string;
    bytes: number;
    sha256: string;
    mode: string;
}

/** Payload ordering contract: entries are globally lexicographic by POSIX package-relative
 * path before digesting or evidence serialization. Wrapper modes are normalized to 0755 before
 * packing and bound into both the per-entry evidence and the payload digest. */
const RUNTIME_WRAPPERS = ['bin/sci', 'bin/semantic-code-intelligence', 'bin/semantic-code-mcp'] as const;
const EXPECTED_WRAPPER_MODE = '0755';

function fail(message: string): never {
    throw new Error(message);
}

function run(command: string, commandArgs: string[], cwd = repoRoot): string {
    const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', env: process.env });
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(-6000);
        fail(`${command} ${commandArgs.join(' ')} failed with status ${result.status}\n${detail}`);
    }
    return result.stdout;
}

function sha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

function listFiles(root: string, current = root): string[] {
    const output: string[] = [];
    for (const name of readdirSync(current).sort()) {
        const absolute = join(current, name);
        const metadata = lstatSync(absolute);
        if (metadata.isSymbolicLink()) fail(`Runtime package must not contain symlinks: ${relative(root, absolute)}`);
        if (metadata.isDirectory()) output.push(...listFiles(root, absolute));
        else if (metadata.isFile()) output.push(absolute);
        else fail(`Runtime package contains unsupported entry: ${relative(root, absolute)}`);
    }
    return output;
}

function inspectArchive(
    archivePath: string,
    extractionRoot: string,
    physicalResultsRoot: string
): { entries: PayloadEntry[]; payloadDigest: string } {
    resolveContainedRegularFile(physicalResultsRoot, archivePath, 'Packed candidate archive');
    const members = run('tar', ['-tzf', archivePath])
        .split(/\r?\n/)
        .filter(Boolean);
    const duplicates = [...new Set(members.filter((member, index) => members.indexOf(member) !== index))];
    if (duplicates.length) fail(`Runtime package has duplicate archive members: ${duplicates.join(', ')}`);

    const verbose = run('tar', ['-tvzf', archivePath]).split(/\r?\n/).filter(Boolean);
    const headerMode = (permissions: string): string => {
        if (!/^[-dlbcps][rwx-]{9}$/.test(permissions)) fail(`Runtime package has an unparsable member mode: ${permissions}`);
        if (permissions[0] !== '-') fail(`Runtime package contains a non-regular archived entry: ${permissions}`);
        const numeric = permissions
            .slice(1)
            .match(/.{3}/g)!
            .map((triplet) =>
                triplet
                    .split('')
                    .reduce((bits, flag) => (flag === '-' ? bits << 1 : (bits << 1) | 1), 0)
            )
            .join('');
        return numeric.padStart(4, '0');
    };
    const archivedWrapperModes = verbose
        .map((line) => { const fields = line.split(/\s+/); return { permissions: fields[0], member: fields[fields.length - 1] }; })
        .filter(({ member }) => RUNTIME_WRAPPERS.some((wrapper) => member === `package/${wrapper}`))
        .map(({ permissions, member }) => ({ wrapper: member.replace(/^package\//, ''), mode: headerMode(permissions) }));
    if (archivedWrapperModes.length !== RUNTIME_WRAPPERS.length) {
        fail('Runtime package is missing archived wrapper members for mode verification');
    }
    const badArchivedModes = archivedWrapperModes.filter((entry) => entry.mode !== EXPECTED_WRAPPER_MODE);
    if (badArchivedModes.length) {
        fail(`Runtime wrappers must be mode 0755 inside the archive: ${badArchivedModes.map((entry) => `${entry.wrapper}:${entry.mode}`).join(', ')}`);
    }

    const forbidden = members.filter((member) =>
        /(^|\/)(src|scripts|tests|node_modules|\.test-results)(\/|$)/.test(member)
    );
    if (forbidden.length) fail(`Runtime package contains source-only members: ${forbidden.join(', ')}`);
    if (members.some((member) => !member.startsWith('package/'))) fail('Runtime package contains entries outside package/');

    resolveContainedRegularFile(physicalResultsRoot, archivePath, 'Packed candidate archive');
    assertNoSymlinkedAncestors(physicalResultsRoot, extractionRoot, 'Artifact extraction root');
    cleanupContainedDirectory(physicalResultsRoot, extractionRoot, 'Artifact extraction root');
    assertNoSymlinkedAncestors(physicalResultsRoot, extractionRoot, 'Artifact extraction root');
    mkdirSync(extractionRoot, { recursive: true, mode: 0o700 });
    assertContainedRealDirectory(physicalResultsRoot, extractionRoot, 'Artifact extraction root');
    resolveContainedRegularFile(physicalResultsRoot, archivePath, 'Packed candidate archive');
    run('tar', ['-xzf', archivePath, '-C', extractionRoot]);
    assertContainedRealDirectory(physicalResultsRoot, extractionRoot, 'Artifact extraction root');
    const packageRoot = join(extractionRoot, 'package');
    if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) fail('Runtime package did not extract a package directory');

    const entries = listFiles(packageRoot)
        .map((absolute) => {
            const data = readFileSync(absolute);
            const relativePath = relative(packageRoot, absolute).replaceAll('\\', '/');
            const mode = (lstatSync(absolute).mode & 0o777).toString(8).padStart(4, '0');
            return { path: relativePath, bytes: data.byteLength, sha256: sha256(data), mode };
        })
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const required = [
        'package.json',
        'README.md',
        'CONFIG.md',
        'LICENSE',
        'bin/sci',
        'bin/semantic-code-intelligence',
        'bin/semantic-code-mcp',
        'dist/core/index.js',
        'dist/cli/cli.js',
        'dist/mcp/mcp.js',
    ];
    const entryPaths = new Set(entries.map((entry) => entry.path));
    const missing = required.filter((path) => !entryPaths.has(path));
    if (missing.length) fail(`Runtime package is missing required entries: ${missing.join(', ')}`);

    const unsorted = entries.some((entry, index) => index > 0 && entries[index - 1].path >= entry.path);
    if (unsorted) fail('Runtime payload entries are not globally lexicographic by path');
    const badWrapperModes = entries
        .filter((entry) => RUNTIME_WRAPPERS.includes(entry.path as (typeof RUNTIME_WRAPPERS)[number]) && entry.mode !== EXPECTED_WRAPPER_MODE)
        .map((entry) => `${entry.path}:${entry.mode}`);
    if (badWrapperModes.length) {
        fail(`Extracted runtime wrappers must be mode 0755: ${badWrapperModes.join(', ')}`);
    }

    const payloadDigest = sha256(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\0${entry.mode}`).join('\n'));
    return { entries, payloadDigest };
}

function trackedSourceStatus(): { commit: string; trackedClean: boolean; trackedChanges: string[] } {
    const commit = run('git', ['rev-parse', 'HEAD']).trim();
    const status = run('git', ['status', '--porcelain', '--untracked-files=no']);
    const trackedChanges = status.split(/\r?\n/).filter(Boolean);
    return { commit, trackedClean: trackedChanges.length === 0, trackedChanges };
}

function createContainedDirectory(root: string, candidate: string, label: string): void {
    assertNoSymlinkedAncestors(root, candidate, label);
    mkdirSync(candidate, { recursive: true, mode: 0o700 });
    assertContainedRealDirectory(root, candidate, label);
}

function main(): void {
    activeStage = 'setup';
    const physicalResultsRoot = ensurePhysicalResultsRoot(repoRoot);
    assertNoSymlinkedAncestors(physicalResultsRoot, outputRoot, 'Artifact output');

    if (!skipBuild) {
        activeStage = 'artifact_build';
        run('bun', ['run', 'public-surface:check']);
    }

    activeStage = 'setup';
    assertNoSymlinkedAncestors(physicalResultsRoot, outputRoot, 'Artifact output');
    cleanupContainedDirectory(physicalResultsRoot, outputRoot, 'Artifact output');
    createContainedDirectory(physicalResultsRoot, outputRoot, 'Artifact output');
    for (const wrapper of RUNTIME_WRAPPERS) chmodSync(join(repoRoot, wrapper), 0o755);

    const firstPack = join(outputRoot, '.pack-a');
    const secondPack = join(outputRoot, '.pack-b');
    createContainedDirectory(physicalResultsRoot, firstPack, 'First pack root');
    createContainedDirectory(physicalResultsRoot, secondPack, 'Second pack root');

    activeStage = 'artifact_build';
    assertContainedRealDirectory(physicalResultsRoot, outputRoot, 'Artifact output');
    run('bun', ['pm', 'pack', '--ignore-scripts', '--destination', firstPack]);
    assertContainedRealDirectory(physicalResultsRoot, firstPack, 'First pack root');
    assertContainedRealDirectory(physicalResultsRoot, outputRoot, 'Artifact output');
    run('bun', ['pm', 'pack', '--ignore-scripts', '--destination', secondPack]);
    assertContainedRealDirectory(physicalResultsRoot, secondPack, 'Second pack root');

    activeStage = 'artifact_validation';
    const firstArchive = readdirSync(firstPack).filter((name) => name.endsWith('.tgz'));
    const secondArchive = readdirSync(secondPack).filter((name) => name.endsWith('.tgz'));
    if (firstArchive.length !== 1 || secondArchive.length !== 1) fail('Expected exactly one archive from each pack run');

    const firstPath = join(firstPack, firstArchive[0]);
    const secondPath = join(secondPack, secondArchive[0]);
    const first = inspectArchive(firstPath, join(outputRoot, '.extract-a'), physicalResultsRoot);
    const second = inspectArchive(secondPath, join(outputRoot, '.extract-b'), physicalResultsRoot);
    if (first.payloadDigest !== second.payloadDigest || JSON.stringify(first.entries) !== JSON.stringify(second.entries)) {
        fail('Repeated pack runs produced different runtime payloads');
    }

    const artifactPath = join(outputRoot, firstArchive[0]);
    resolveContainedRegularFile(physicalResultsRoot, firstPath, 'First packed candidate archive');
    assertContainedRealDirectory(physicalResultsRoot, outputRoot, 'Artifact output');
    assertNoSymlinkedAncestors(physicalResultsRoot, artifactPath, 'Final candidate archive');
    renameSync(firstPath, artifactPath);
    resolveContainedRegularFile(physicalResultsRoot, artifactPath, 'Final candidate archive');

    activeStage = 'workspace_integrity';
    const source = trackedSourceStatus();
    const manifest = {
        schema: 'semantic-code-intelligence.local_production_artifact.v1',
        ok: true,
        artifact: {
            path: relative(repoRoot, artifactPath).replaceAll('\\', '/'),
            bytes: statSync(artifactPath).size,
            sha256: sha256(readFileSync(artifactPath)),
            payloadDigest: first.payloadDigest,
            repeatablePayload: true,
            entryCount: first.entries.length,
            entries: first.entries,
        },
        source,
        runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
        limitations: [
            'Local artifact only; no publication or hosted deployment was performed.',
            'Payload repeatability does not prove hermetic future dependency resolution.',
            'Production-candidate support is limited to a trusted local operator using CLI or MCP stdio.',
        ],
    };

    activeStage = 'cleanup';
    cleanupContainedDirectory(physicalResultsRoot, firstPack, 'First pack root');
    cleanupContainedDirectory(physicalResultsRoot, secondPack, 'Second pack root');
    cleanupContainedDirectory(physicalResultsRoot, join(outputRoot, '.extract-a'), 'First extraction root');
    cleanupContainedDirectory(physicalResultsRoot, join(outputRoot, '.extract-b'), 'Second extraction root');

    activeStage = 'evidence_write';
    assertContainedRealDirectory(physicalResultsRoot, outputRoot, 'Artifact output');
    resolveContainedRegularFile(physicalResultsRoot, artifactPath, 'Final candidate archive');
    writeJsonAtomically(physicalResultsRoot, join(outputRoot, 'artifact-manifest.json'), manifest);

    if (jsonMode) process.stdout.write(`${JSON.stringify(manifest)}\n`);
    else {
        process.stdout.write(`local-production-artifact: ok\n`);
        process.stdout.write(`artifact: ${manifest.artifact.path}\n`);
        process.stdout.write(`sha256: ${manifest.artifact.sha256}\n`);
        process.stdout.write(`payload: ${manifest.artifact.payloadDigest}\n`);
    }
}

try {
    main();
} catch (error) {
    const finalError = new CandidateStageError(activeStage, error);
    const failure = toCandidateFailureEvidence(finalError);
    process.stderr.write(`local-production-artifact: ${failure.code}: ${failure.message}\n`);
    if (process.env.SCI_LOCAL_PRODUCTION_DIAGNOSTICS === '1') {
        process.stderr.write(`local-production-artifact diagnostic (not promoted): ${candidateLocalDiagnostic(finalError)}\n`);
    }
    process.exitCode = 1;
}
