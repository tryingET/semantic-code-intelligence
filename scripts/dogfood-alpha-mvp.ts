#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
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
const navigationSymbol = 'handleToolCall';
const navigationFile = 'src/adapters/mcp-adapter.ts';
const patchPlanningMarker = '<!-- alpha patch-planning parity snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -7,6 +7,7 @@ type: "reference"
 ---
${' '}
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
${' '}
 ## User and job
${' '}
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
const semanticChecks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

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

function recordSemanticCheck(name: string, ok: boolean, detail?: unknown): void {
    semanticChecks.push({ name, ok, detail });
}

function parseCliWorkflowOutput(stdout: string) {
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
    let parsed: unknown = null;
    try {
        parsed = parseCliWorkflowOutput(String(proc.stdout || ''));
    } catch {
        parsed = { stdout: String(proc.stdout || '').slice(0, 1000), stderr: String(proc.stderr || '').slice(0, 1000) };
    }
    const success = proc.status === 0;
    calls.push({
        name: `cli:${name}`,
        args,
        status: proc.status ?? -1,
        success,
        elapsedMs,
        observation,
        sample: compactSample(parsed),
    });
    return (parsed as any)?.payload;
}

try {
    await server.start();
    const snapshot = await callTool('get_snapshot', { preferExisting: true }, 'Establish repository state for subsequent navigation calls.');
    await callTool(
        'read_file',
        { path: 'docs/project/alpha-mvp-contract.md', range: { startLine: 1, endLine: 30 }, snapshot: snapshot?.snapshot || snapshot?.id },
        'Read the Phase 1 contract from a bounded range.'
    );
    const textSearch = await callTool(
        'text_search',
        { query: navigationSymbol, path: 'src', maxResults: 10 },
        'Locate implementation candidates by text.'
    );
    recordSemanticCheck('text_search_finds_navigation_symbol', Number(textSearch?.count || 0) > 0, {
        count: textSearch?.count,
        symbol: navigationSymbol,
    });
    const symbolSearch = await callTool(
        'symbol_search',
        { query: navigationSymbol, maxResults: 10, fileHint: navigationFile },
        'Validate symbol-level candidates with a file hint.'
    );
    recordSemanticCheck(
        'symbol_search_finds_navigation_symbol',
        Array.isArray(symbolSearch?.symbols) && symbolSearch.symbols.some((symbol: any) => symbol?.name === navigationSymbol),
        { count: symbolSearch?.count, symbol: navigationSymbol }
    );
    const definition = await callTool(
        'find_definition',
        { symbol: navigationSymbol, file: navigationFile, precise: true, maxResults: 10 },
        'Resolve the implementation definition.'
    );
    recordSemanticCheck(
        'find_definition_resolves_navigation_symbol_in_target_file',
        Array.isArray(definition?.definitions) &&
            definition.definitions.some(
                (item: any) => item?.name === navigationSymbol && String(item?.uri || '').endsWith(`/${navigationFile}`)
            ),
        { count: definition?.count, symbol: navigationSymbol, file: navigationFile }
    );
    const references = await callTool(
        'find_references',
        { symbol: navigationSymbol, file: navigationFile, includeDeclaration: true, maxResults: 10 },
        'Find bounded references so the harness can estimate local change impact.'
    );
    recordSemanticCheck('find_references_finds_navigation_symbol', Number(references?.count || 0) > 0, {
        count: references?.count,
        symbol: navigationSymbol,
    });
    await callTool(
        'ast_query',
        { language: 'typescript', query: '(program) @root', paths: [navigationFile], limit: 5 },
        'Exercise structural query behavior and parser/fallback stability.'
    );
    const graphResult = await callTool(
        'graph_expand',
        { file: navigationFile, edges: ['imports', 'exports'], depth: 1, limit: 20 },
        'Inspect graph-neighborhood behavior and fallback stability.'
    );
    const impact = await callTool(
        'explore_symbol_impact',
        { symbol: navigationSymbol, file: navigationFile, precise: true, depth: 1, limit: 10 },
        'Exercise the preferred renamed impact workflow exposed through the Alpha membrane.'
    );
    recordSemanticCheck('explore_symbol_impact_resolves_navigation_symbol', Number(impact?.definitions?.count || 0) > 0, {
        count: impact?.definitions?.count,
        symbol: navigationSymbol,
    });
    const located = await callTool(
        'locate_confirm_definition',
        { symbol: navigationSymbol, file: navigationFile, precise: true, maxResults: 10 },
        'Exercise the preferred renamed locate/confirm workflow exposed through the Alpha membrane.'
    );
    recordSemanticCheck('locate_confirm_definition_resolves_navigation_symbol', located?.ok === true, {
        count: located?.definitions?.length,
        symbol: navigationSymbol,
    });
    await callTool(
        'recommend_checks',
        { files: ['src/adapters/mcp-adapter.ts'], impactSummary: graphResult?.impactSummary, mode: 'broader' },
        'Recommend explicit advisory validation commands from touched source files and graph impact evidence.'
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
    await callTool(
        'apply_snapshot',
        { snapshot: patchSnapshot?.snapshot || patchSnapshot?.id, check: true },
        'Preflight the staged snapshot through guarded apply semantics without mutating the workspace.'
    );
    await callTool(
        'extract_snapshot_artifacts',
        { snapshot: patchSnapshot?.snapshot || patchSnapshot?.id, includeContent: false },
        'Expose bounded snapshot artifact links for human/operator inspection.'
    );
    await callTool(
        'patch_checks_in_snapshot',
        { patch: patchPlanningDiff, commands: ['true'], timeoutSec: 30 },
        'Exercise the composite preview-first patch/check workflow through HTTP tools/call.'
    );
    await callTool(
        'structural_search',
        { language: 'typescript', pattern: 'const $A = $B', paths: ['src/core/version.ts'], maxResults: 5 },
        'Exercise ast-grep-backed structural search on a bounded source file.'
    );
    await callTool(
        'structural_patch_checks',
        {
            language: 'typescript',
            pattern: 'const SCI_ALPHA_MVP_NO_MATCH = $B',
            rewrite: 'const SCI_ALPHA_MVP_NO_MATCH = $B',
            paths: ['src/core/version.ts'],
            commands: ['true'],
            timeoutSec: 30,
        },
        'Exercise structural patch checks in no-match preview mode without mutating the workspace.'
    );
    await callTool(
        'safe_write',
        { patch: patchPlanningDiff, commands: ['true'], timeoutSec: 30, apply: false },
        'Exercise the autonomous-safe write workflow in preview-only mode.'
    );
    await callTool(
        'rename_safely',
        {
            oldName: 'SCI_ALPHA_MVP_NO_SUCH_SYMBOL',
            newName: 'SCI_ALPHA_MVP_NO_SUCH_SYMBOL_RENAMED',
            file: 'src/core/version.ts',
            runChecks: false,
        },
        'Exercise safe rename planning with a bounded file context and no workspace mutation.'
    );
    const afterPatchPlanning = await Bun.file(patchPlanningTarget).text();
    const workspaceUnchanged = beforePatchPlanning === afterPatchPlanning && !afterPatchPlanning.includes(patchPlanningMarker);

    const beforeCliFallback = await Bun.file(patchPlanningTarget).text();
    callCliWorkflow(
        'read_file',
        { path: 'docs/project/alpha-mvp-contract.md', range: { startLine: 1, endLine: 8 } },
        'Use the CLI fallback workflow command for bounded file retrieval.'
    );
    callCliWorkflow(
        'text_search',
        { query: navigationSymbol, path: 'src', maxResults: 5 },
        'Use the CLI fallback workflow command for bounded navigation search.'
    );
    callCliWorkflow(
        'patch_checks_in_snapshot',
        { patch: patchPlanningDiff, commands: ['true'], timeoutSec: 30 },
        'Use the CLI fallback workflow command for preview-first patch checks.'
    );
    const afterCliFallback = await Bun.file(patchPlanningTarget).text();
    const cliWorkspaceUnchanged = beforeCliFallback === afterCliFallback && !afterCliFallback.includes(patchPlanningMarker);

    const evidence = {
        schema: 'semantic-code-intelligence.alpha_mvp_dogfood.v1',
        ok: calls.every((call) => call.success) && semanticChecks.every((check) => check.ok) && workspaceUnchanged && cliWorkspaceUnchanged,
        mode: 'harnessed_llm_code_navigation_simulation',
        base,
        summary: calls.map(({ name, status, success, elapsedMs, observation }) => ({ name, status, success, elapsedMs, observation })),
        calls,
        semanticChecks,
        patchPlanning: {
            target: patchPlanningTarget,
            workspaceUnchanged,
            mutationPosture: 'preview_first_snapshot_only',
        },
        cliFallback: {
            workspaceUnchanged: cliWorkspaceUnchanged,
            command: 'semantic-code-intelligence workflow <tool> --args <json> --json',
            note: 'CLI workflow invocations are process-local; composite patch_checks_in_snapshot is used for snapshot plus checks.',
        },
        interpretation: {
            proves: [
                'HTTP tools/call can execute the Phase 1 navigation loop deterministically.',
                'read_file provides bounded path/range retrieval for harnessed LLM context gathering.',
                'Search, symbol, definition, reference, AST, graph, and check-recommendation tools compose into a code-navigation and validation-planning workflow.',
                'propose_patch and run_checks support preview-first patch planning without mutating the working tree.',
                'The CLI workflow command provides a machine-readable local fallback for bounded tool calls.',
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
