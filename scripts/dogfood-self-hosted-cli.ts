#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';

const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');
const target = 'docs/project/product-posture.md';
const marker = '<!-- self-hosted-cli-dogfood snapshot-only marker -->';
const patch = `diff --git a/${target} b/${target}
--- a/${target}
+++ b/${target}
@@ -7,6 +7,7 @@ type: "reference"
 ---
${' '}
 # Product posture
+${marker}
${' '}
 ## Position
${' '}
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
const sciFirstDiscoveryTools = [
    'read_file',
    'text_search',
    'symbol_search',
    'find_definition',
    'find_references',
    'graph_expand',
] as const;

function compactSample(value: unknown): unknown {
    const cloned = JSON.parse(JSON.stringify(value));
    const text = cloned?.raw?.content?.[0]?.text;
    if (typeof text === 'string' && text.length > 600) {
        cloned.raw.content[0].text = `${text.slice(0, 600)}…`;
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
    const proc = spawnSync(bun, ['run', 'src/servers/cli.ts', 'workflow', name, '--args', JSON.stringify(args), '--json'], {
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
            stdout: String(proc.stdout || '').slice(0, 1000),
            stderr: stderr.slice(0, 1000),
        };
    }
    const stderrClean = !stderr.includes('[HTTP Server]') && !stderr.includes('Error:');
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

const before = await Bun.file(target).text();

const productPosture = callCliWorkflow(
    'read_file',
    { path: target, range: { startLine: 45, endLine: 95 } },
    'Read the current product posture through SCI CLI instead of direct file inspection.'
);

callCliWorkflow(
    'text_search',
    { query: 'Current alpha evidence', path: 'docs/project/product-posture.md', maxResults: 5 },
    'Locate the current alpha-evidence section through SCI CLI text search.'
);

callCliWorkflow(
    'symbol_search',
    { query: 'callCliWorkflow', fileHint: 'scripts/dogfood-self-hosted-cli.ts', maxResults: 5 },
    'Use SCI CLI symbol search against this self-hosted dogfood script itself.'
);

callCliWorkflow(
    'find_definition',
    { symbol: 'callCliWorkflow', file: 'scripts/dogfood-self-hosted-cli.ts', precise: true, maxResults: 5 },
    'Use SCI CLI definition lookup against the dogfood implementation.'
);

callCliWorkflow(
    'find_references',
    { symbol: 'callCliWorkflow', file: 'scripts/dogfood-self-hosted-cli.ts', includeDeclaration: true, maxResults: 10 },
    'Use SCI CLI reference lookup to estimate the dogfood helper impact.'
);

callCliWorkflow(
    'graph_expand',
    { file: 'scripts/dogfood-self-hosted-cli.ts', edges: ['imports', 'exports'], depth: 1, limit: 20 },
    'Use SCI CLI graph expansion/fallback shape for the dogfood script.'
);

const discoveryCallNames = calls.map((call) => call.name);
const sciFirstDiscoveryComplete = sciFirstDiscoveryTools.every((tool, index) => discoveryCallNames[index] === tool);

const patchCheck = callCliWorkflow(
    'patch_checks_in_snapshot',
    { patch, commands: ['true'], timeoutSec: 30 },
    'Stage and check a doc patch through SCI CLI without mutating the working tree.'
);

const after = await Bun.file(target).text();
const workspaceUnchanged = before === after && !after.includes(marker);

const evidence = {
    schema: 'semantic-code-intelligence.self_hosted_cli_dogfood.v1',
    ok:
        calls.every((call) => call.success) &&
        sciFirstDiscoveryComplete &&
        workspaceUnchanged &&
        typeof productPosture?.content === 'string' &&
        productPosture.content.includes('Current alpha evidence') &&
        patchCheck?.ok === true,
    mode: 'self_hosted_sci_cli_work_loop',
    targetRepo: process.cwd(),
    target,
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
    selfHosting: {
        primarySurface: 'semantic-code-intelligence workflow <tool> --args <json> --json',
        sciFirstDiscovery: {
            complete: sciFirstDiscoveryComplete,
            expectedFirstTools: [...sciFirstDiscoveryTools],
            actualFirstTools: discoveryCallNames.slice(0, sciFirstDiscoveryTools.length),
            rule: 'Use SCI workflow discovery/navigation before raw shell reads/searches when SCI exposes the primitive.',
        },
        workspaceUnchanged,
        rawShellAvoidedFor: ['file read', 'text search', 'symbol search', 'definition lookup', 'reference lookup', 'graph expansion', 'patch check'],
        rawShellStillAllowedFor: ['git status/diff hygiene', 'AK task/evidence/direction operations', 'deterministic validation commands'],
        limitation: 'CLI workflow invocations are process-local; use composite workflow tools for multi-step snapshot state.',
    },
    interpretation: {
        proves: [
            'SCI CLI can be used as a practical self-hosted navigation and patch-planning loop on the SCI repo.',
            'The self-hosted loop starts with SCI discovery/navigation before snapshot patch planning.',
            'CLI workflow stdout remains machine-readable JSON for harness consumption.',
            'Preview-first patch checks can validate a proposed change without mutating the working tree.',
        ],
        does_not_prove: [
            'Production readiness.',
            'External repository usefulness.',
            'Durable cross-process snapshot/session semantics.',
        ],
    },
};

const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
if (jsonMode) process.stdout.write(`${output}\n`);
else console.log(output);

if (!evidence.ok) process.exitCode = 1;
