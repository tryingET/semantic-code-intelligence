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
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const skipBuild = args.includes('--skip-build');
const outputArg = args.indexOf('--output-dir');
const outputRoot = resolve(repoRoot, outputArg >= 0 ? (args[outputArg + 1] ?? '') : '.test-results/local-production-artifact');

interface PayloadEntry {
    path: string;
    bytes: number;
    sha256: string;
}

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

function inspectArchive(archivePath: string, extractionRoot: string): { entries: PayloadEntry[]; payloadDigest: string } {
    const members = run('tar', ['-tzf', archivePath])
        .split(/\r?\n/)
        .filter(Boolean);
    const duplicates = [...new Set(members.filter((member, index) => members.indexOf(member) !== index))];
    if (duplicates.length) fail(`Runtime package has duplicate archive members: ${duplicates.join(', ')}`);

    const forbidden = members.filter((member) =>
        /(^|\/)(src|scripts|tests|node_modules|\.test-results)(\/|$)/.test(member)
    );
    if (forbidden.length) fail(`Runtime package contains source-only members: ${forbidden.join(', ')}`);
    if (members.some((member) => !member.startsWith('package/'))) fail('Runtime package contains entries outside package/');

    rmSync(extractionRoot, { recursive: true, force: true });
    mkdirSync(extractionRoot, { recursive: true });
    run('tar', ['-xzf', archivePath, '-C', extractionRoot]);
    const packageRoot = join(extractionRoot, 'package');
    if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) fail('Runtime package did not extract a package directory');

    const entries = listFiles(packageRoot).map((absolute) => {
        const data = readFileSync(absolute);
        return { path: relative(packageRoot, absolute).replaceAll('\\', '/'), bytes: data.byteLength, sha256: sha256(data) };
    });
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

    const payloadDigest = sha256(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join('\n'));
    return { entries, payloadDigest };
}

function trackedSourceStatus(): { commit: string; trackedClean: boolean; trackedChanges: string[] } {
    const commit = run('git', ['rev-parse', 'HEAD']).trim();
    const status = run('git', ['status', '--porcelain', '--untracked-files=no']);
    const trackedChanges = status.split(/\r?\n/).filter(Boolean);
    return { commit, trackedClean: trackedChanges.length === 0, trackedChanges };
}

function main(): void {
    if (!outputRoot.startsWith(`${repoRoot}/`)) fail('Artifact output must stay inside the repository');
    if (!skipBuild) run('bun', ['run', 'public-surface:check']);

    chmodSync(join(repoRoot, 'bin/sci'), 0o755);
    rmSync(outputRoot, { recursive: true, force: true });
    mkdirSync(outputRoot, { recursive: true });

    const firstPack = join(outputRoot, '.pack-a');
    const secondPack = join(outputRoot, '.pack-b');
    mkdirSync(firstPack);
    mkdirSync(secondPack);
    run('bun', ['pm', 'pack', '--ignore-scripts', '--destination', firstPack]);
    run('bun', ['pm', 'pack', '--ignore-scripts', '--destination', secondPack]);

    const firstArchive = readdirSync(firstPack).filter((name) => name.endsWith('.tgz'));
    const secondArchive = readdirSync(secondPack).filter((name) => name.endsWith('.tgz'));
    if (firstArchive.length !== 1 || secondArchive.length !== 1) fail('Expected exactly one archive from each pack run');

    const firstPath = join(firstPack, firstArchive[0]);
    const secondPath = join(secondPack, secondArchive[0]);
    const first = inspectArchive(firstPath, join(outputRoot, '.extract-a'));
    const second = inspectArchive(secondPath, join(outputRoot, '.extract-b'));
    if (first.payloadDigest !== second.payloadDigest || JSON.stringify(first.entries) !== JSON.stringify(second.entries)) {
        fail('Repeated pack runs produced different runtime payloads');
    }

    const artifactPath = join(outputRoot, firstArchive[0]);
    renameSync(firstPath, artifactPath);
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

    rmSync(firstPack, { recursive: true, force: true });
    rmSync(secondPack, { recursive: true, force: true });
    rmSync(join(outputRoot, '.extract-a'), { recursive: true, force: true });
    rmSync(join(outputRoot, '.extract-b'), { recursive: true, force: true });
    writeFileSync(join(outputRoot, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

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
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`local-production-artifact: ${message}\n`);
    process.exit(1);
}
