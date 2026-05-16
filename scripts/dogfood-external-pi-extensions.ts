#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');
const defaultRepo = '/home/tryinget/ai-society/softwareco/owned/pi-extensions';
const externalRepo = path.resolve(process.env.PI_EXTENSIONS_REPO || defaultRepo);
const packageDir = 'packages/pi-toolbox-discovery';
const targetFile = `${packageDir}/README.md`;
const implementationFile = `${packageDir}/extensions/toolbox.ts`;
const marker = '<!-- sci external dogfood snapshot-only marker -->';
const patch = `diff --git a/${targetFile} b/${targetFile}
--- a/${targetFile}
+++ b/${targetFile}
@@ -12,1 +12,2 @@
 # @tryinget/pi-toolbox-discovery
+${marker}
`;

type CliCallEvidence = {
    name: string;
    args: Record<string, unknown>;
    exitCode: number | null;
    success: boolean;
    elapsedMs: number;
    observation: string;
    stdoutJson: boolean;
    stderrClean: boolean;
    sample?: unknown;
};

const calls: CliCallEvidence[] = [];

function compactSample(value: unknown): unknown {
    const cloned = JSON.parse(JSON.stringify(value));
    const text = cloned?.raw?.content?.[0]?.text;
    if (typeof text === 'string' && text.length > 700) {
        cloned.raw.content[0].text = `${text.slice(0, 700)}…`;
    }
    return cloned;
}

function parseWorkflowStdout(stdout: string) {
    const raw = JSON.parse(stdout.trim() || '{}');
    const text = raw?.content?.[0]?.text;
    const payload = typeof text === 'string' ? JSON.parse(text) : raw;
    return { raw, payload };
}

function callCliWorkflow(name: string, args: Record<string, unknown>, observation: string) {
    const started = Date.now();
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    const cliPath = path.resolve('src/servers/cli.ts');
    const proc = spawnSync(bun, ['run', cliPath, 'workflow', name, '--args', JSON.stringify(args), '--json'], {
        cwd: externalRepo,
        encoding: 'utf8',
        env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true' },
    });
    const elapsedMs = Date.now() - started;
    const stderr = String(proc.stderr || '');
    let parsed: any = null;
    let stdoutJson = false;
    try {
        parsed = parseWorkflowStdout(String(proc.stdout || ''));
        stdoutJson = true;
    } catch {
        parsed = {
            stdout: String(proc.stdout || '').slice(0, 1200),
            stderr: stderr.slice(0, 1200),
        };
    }
    const stderrClean = !stderr.includes('[HTTP Server]') && !stderr.includes('Error:') && !stderr.includes('Failed to initialize');
    const success = proc.status === 0 && stdoutJson && stderrClean;
    calls.push({
        name,
        args,
        exitCode: proc.status,
        success,
        elapsedMs,
        observation,
        stdoutJson,
        stderrClean,
        sample: compactSample(parsed),
    });
    return parsed?.payload;
}

async function listSnapshotDirs() {
    const root = path.join(externalRepo, '.ontology', 'snapshots');
    try {
        const entries = await fsp.readdir(root, { withFileTypes: true });
        return { root, entries: new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)) };
    } catch {
        return { root, entries: new Set<string>() };
    }
}

async function cleanupNewSnapshotDirs(before: Set<string>, root: string) {
    try {
        const entries = await fsp.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && !before.has(entry.name)) {
                await fsp.rm(path.join(root, entry.name), { recursive: true, force: true });
            }
        }
    } catch {
        // best effort cleanup only
    }
}

if (!fs.existsSync(externalRepo)) {
    console.error(`Missing pi-extensions repo: ${externalRepo}`);
    process.exit(2);
}

const ontologyRoot = path.join(externalRepo, '.ontology');
const ontologyExistedBefore = fs.existsSync(ontologyRoot);
const beforeTarget = await Bun.file(path.join(externalRepo, targetFile)).text();
const beforeGit = spawnSync('git', ['status', '--short'], { cwd: externalRepo, encoding: 'utf8' }).stdout;
const beforeSnapshots = await listSnapshotDirs();

const readme = callCliWorkflow(
    'read_file',
    { path: targetFile, range: { startLine: 1, endLine: 80 } },
    'Read pi-toolbox-discovery package posture through SCI CLI from the external repo root.'
);

const search = callCliWorkflow(
    'text_search',
    { query: 'toolbox', path: packageDir, maxResults: 12 },
    'Search the external package for toolbox-related implementation and docs references.'
);

const symbol = callCliWorkflow(
    'symbol_search',
    { query: 'CATALOG', fileHint: implementationFile, maxResults: 10 },
    'Find the toolbox catalog symbol in the external implementation file.'
);

const definition = callCliWorkflow(
    'find_definition',
    { symbol: 'CATALOG', file: implementationFile, precise: true, maxResults: 10 },
    'Resolve the external toolbox catalog definition candidates.'
);

const references = callCliWorkflow(
    'find_references',
    { symbol: 'CATALOG', file: implementationFile, includeDeclaration: true, maxResults: 20 },
    'Estimate local impact for the external toolbox catalog symbol.'
);

const graph = callCliWorkflow(
    'graph_expand',
    { file: implementationFile, edges: ['imports', 'exports'], depth: 1, limit: 20 },
    'Inspect graph/fallback context for the external toolbox extension file.'
);

const patchCheck = callCliWorkflow(
    'patch_checks_in_snapshot',
    { patch, commands: ['true'], timeoutSec: 30 },
    'Stage and check a harmless package README patch in a snapshot without mutating pi-extensions.'
);

await cleanupNewSnapshotDirs(beforeSnapshots.entries, beforeSnapshots.root);
if (!ontologyExistedBefore) {
    await fsp.rm(ontologyRoot, { recursive: true, force: true }).catch(() => {});
}

const afterTarget = await Bun.file(path.join(externalRepo, targetFile)).text();
const afterGit = spawnSync('git', ['status', '--short'], { cwd: externalRepo, encoding: 'utf8' }).stdout;
const targetUnchanged = beforeTarget === afterTarget && !afterTarget.includes(marker);
const gitStatusUnchanged = beforeGit === afterGit;

const evidence = {
    schema: 'semantic-code-intelligence.external_dogfood.pi_extensions.v1',
    ok:
        calls.every((call) => call.success) &&
        targetUnchanged &&
        gitStatusUnchanged &&
        typeof readme?.content === 'string' &&
        readme.content.includes('@tryinget/pi-toolbox-discovery') &&
        Number(search?.count || 0) > 0 &&
        Number(symbol?.count || 0) > 0 &&
        patchCheck?.ok === true,
    mode: 'external_repo_cli_dogfood',
    externalRepo,
    packageDir,
    targetFile,
    implementationFile,
    summary: calls.map(({ name, exitCode, success, elapsedMs, observation, stdoutJson, stderrClean }) => ({
        name,
        exitCode,
        success,
        elapsedMs,
        observation,
        stdoutJson,
        stderrClean,
    })),
    calls,
    mutationSafety: {
        targetUnchanged,
        gitStatusUnchanged,
        generatedSnapshotCleanup: ontologyExistedBefore
            ? 'best_effort_removed_new_.ontology/snapshots_entries'
            : 'best_effort_removed_generated_.ontology_directory',
    },
    findings: {
        packageIdentified: readme?.content?.includes('@tryinget/pi-toolbox-discovery') === true,
        searchCount: search?.count ?? null,
        symbolCount: symbol?.count ?? null,
        definitionCount: definition?.count ?? null,
        referenceCount: references?.count ?? null,
        graphSchemaVersion: graph?.schemaVersion ?? null,
        patchCheckOk: patchCheck?.ok === true,
    },
    interpretation: {
        proves: [
            'SCI CLI can navigate a nontrivial external TypeScript package in pi-extensions.',
            'SCI can locate package docs, implementation symbols, definitions, references, and graph/fallback context outside its own repo.',
            'SCI can stage and check a harmless external-repo patch without mutating the external working tree.',
        ],
        does_not_prove: [
            'Production readiness.',
            'All pi-extensions packages behave equally well.',
            'Rich semantic graph coverage beyond the observed fallback/neighbor shape.',
            'Permission to mutate pi-extensions canonical files.',
        ],
    },
};

const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
if (jsonMode) process.stdout.write(`${output}\n`);
else console.log(output);

if (!evidence.ok) process.exitCode = 1;
