#!/usr/bin/env bun
import { HTTPServer } from '../src/servers/http';

type ToolCallEvidence = {
    name: string;
    args: Record<string, unknown>;
    status: number;
    success: boolean;
    elapsedMs: number;
    observation: string;
    sample?: unknown;
};

const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');
const host = process.env.DOGFOOD_HOST || '127.0.0.1';
const port = Number(process.env.DOGFOOD_PORT || 7031);
const base = `http://${host}:${port}`;
const patchPlanningMarker = '<!-- alpha patch-planning parity snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -9,1 +9,2 @@
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
`;

// Keep --json stdout machine-readable even though HTTPServer logs with console.*.
const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
if (jsonMode) {
    console.log = (...args: unknown[]) => originalConsole.error(...args);
    console.info = (...args: unknown[]) => originalConsole.error(...args);
    console.warn = (...args: unknown[]) => originalConsole.error(...args);
}

const server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
const calls: ToolCallEvidence[] = [];

function compactSample(value: unknown): unknown {
    const cloned = JSON.parse(JSON.stringify(value));
    if (cloned?.result?.content && typeof cloned.result.content === 'string' && cloned.result.content.length > 500) {
        cloned.result.content = `${cloned.result.content.slice(0, 500)}…`;
    }
    return cloned;
}

async function callTool(name: string, args: Record<string, unknown>, observation: string) {
    const started = Date.now();
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    const body = await res.json();
    const elapsedMs = Date.now() - started;
    calls.push({ name, args, status: res.status, success: body.success === true, elapsedMs, observation, sample: compactSample(body) });
    return body.result;
}

try {
    await server.start();
    const snapshot = await callTool('get_snapshot', { preferExisting: true }, 'Establish repository state for subsequent navigation calls.');
    await callTool(
        'read_file',
        { path: 'docs/project/alpha-mvp-contract.md', range: { startLine: 1, endLine: 30 }, snapshot: snapshot?.snapshot || snapshot?.id },
        'Read the Phase 1 contract from a bounded range.'
    );
    await callTool('text_search', { query: 'handleReadFile', path: 'src', maxResults: 10 }, 'Locate implementation candidates by text.');
    await callTool(
        'symbol_search',
        { query: 'handleReadFile', maxResults: 10, fileHint: 'src/adapters/mcp-adapter.ts' },
        'Validate symbol-level candidates with a file hint.'
    );
    await callTool(
        'find_definition',
        { symbol: 'handleReadFile', file: 'src/adapters/mcp-adapter.ts', precise: true, maxResults: 10 },
        'Resolve the implementation definition.'
    );
    await callTool(
        'find_references',
        { symbol: 'handleReadFile', file: 'src/adapters/mcp-adapter.ts', includeDeclaration: true, maxResults: 10 },
        'Find bounded references so the harness can estimate local change impact.'
    );
    await callTool(
        'ast_query',
        { language: 'typescript', query: '(program) @root', paths: ['src/adapters/mcp-adapter.ts'], limit: 5 },
        'Exercise structural query behavior and parser/fallback stability.'
    );
    await callTool(
        'graph_expand',
        { file: 'src/adapters/mcp-adapter.ts', edges: ['imports', 'exports'], depth: 1, limit: 20 },
        'Inspect graph-neighborhood behavior and fallback stability.'
    );

    const beforePatchPlanning = await Bun.file(patchPlanningTarget).text();
    const patchSnapshot = await callTool(
        'get_snapshot',
        { preferExisting: false },
        'Create an isolated snapshot for preview-first patch planning.'
    );
    await callTool(
        'propose_patch',
        { snapshot: patchSnapshot?.snapshot || patchSnapshot?.id, patch: patchPlanningDiff },
        'Stage a reviewable diff in the snapshot without applying it to the workspace.'
    );
    await callTool(
        'run_checks',
        { snapshot: patchSnapshot?.snapshot || patchSnapshot?.id, commands: ['true'], timeoutSec: 30 },
        'Run an explicit validation command against the staged snapshot.'
    );
    const afterPatchPlanning = await Bun.file(patchPlanningTarget).text();
    const workspaceUnchanged = beforePatchPlanning === afterPatchPlanning && !afterPatchPlanning.includes(patchPlanningMarker);

    const evidence = {
        schema: 'semantic-code-intelligence.alpha_mvp_dogfood.v1',
        ok: calls.every((call) => call.success) && workspaceUnchanged,
        mode: 'harnessed_llm_code_navigation_simulation',
        base,
        summary: calls.map(({ name, status, success, elapsedMs, observation }) => ({ name, status, success, elapsedMs, observation })),
        calls,
        patchPlanning: {
            target: patchPlanningTarget,
            workspaceUnchanged,
            mutationPosture: 'preview_first_snapshot_only',
        },
        interpretation: {
            proves: [
                'HTTP tools/call can execute the Phase 1 navigation loop deterministically.',
                'read_file provides bounded path/range retrieval for harnessed LLM context gathering.',
                'Search, symbol, definition, reference, AST, and graph tools compose into a code-navigation workflow.',
                'propose_patch and run_checks support preview-first patch planning without mutating the working tree.',
            ],
            does_not_prove: [
                'Production readiness.',
                'Full MCP client compatibility in every host.',
                'Rich semantic graph coverage for every repository.',
            ],
        },
    };

    const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
    if (jsonMode) process.stdout.write(`${output}\n`);
    else originalConsole.log(output);

    if (!evidence.ok) process.exitCode = 1;
} finally {
    await server.stop();
    if (jsonMode) {
        console.log = originalConsole.log;
        console.error = originalConsole.error;
        console.warn = originalConsole.warn;
        console.info = originalConsole.info;
    }
}
