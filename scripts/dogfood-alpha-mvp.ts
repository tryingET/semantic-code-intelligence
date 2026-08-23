#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { SYMBOL_IMPACT_DISCLOSURE_BUDGETS } from '../src/core/workflows/symbol-workflow-disclosure.js';
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
const structuralRiskSymbol = 'ObliqueMarker';
const structuralRiskFile = 'fixtures/symbol-impact-structural/facet.ts';
const structuralRiskSignals = ['publicApi', 'state', 'registry', 'tests'] as const;
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
    const standardImpact = await callTool(
        'explore_symbol_impact',
        { symbol: navigationSymbol, file: navigationFile, precise: true, depth: 1, limit: 10, mode: 'standard' },
        'Verify normalized bounded standard evidence through HTTP tools/call.'
    );
    const debugImpact = callCliWorkflow(
        'explore_symbol_impact',
        { symbol: navigationSymbol, file: navigationFile, precise: true, depth: 1, limit: 10, mode: 'debug' },
        'Verify bounded/redacted debug evidence through a fresh CLI workflow process.'
    );
    recordSemanticCheck(
        'explore_symbol_impact_progressive_modes_differ',
        impact?.details === 'mode: standard' &&
            standardImpact?.details?.mode === 'standard' &&
            standardImpact?.details?.diagnostics === undefined &&
            debugImpact?.details?.mode === 'debug' &&
            Array.isArray(debugImpact?.details?.diagnostics?.subcalls),
        {
            compact: impact?.details,
            standard: standardImpact?.details?.mode,
            debug: debugImpact?.details?.mode,
        }
    );
    const standardDetailBytes = Buffer.byteLength(JSON.stringify(standardImpact?.details), 'utf8');
    const debugDetailBytes = Buffer.byteLength(JSON.stringify(debugImpact?.details), 'utf8');
    const standardPacketBytes = Buffer.byteLength(JSON.stringify(standardImpact), 'utf8');
    const debugPacketBytes = Buffer.byteLength(JSON.stringify(debugImpact), 'utf8');
    recordSemanticCheck(
        'explore_symbol_impact_details_respect_byte_budgets',
        Number(standardImpact?.details?.disclosure?.emittedBytes || 0) === standardDetailBytes &&
            standardDetailBytes <= Number(standardImpact?.details?.disclosure?.byteBudget || 0) &&
            Number(debugImpact?.details?.disclosure?.emittedBytes || 0) === debugDetailBytes &&
            debugDetailBytes <= Number(debugImpact?.details?.disclosure?.byteBudget || 0) &&
            standardPacketBytes <= Number(standardImpact?.details?.disclosure?.packetByteBudget || 0) &&
            debugPacketBytes <= Number(debugImpact?.details?.disclosure?.packetByteBudget || 0),
        { standardDetailBytes, debugDetailBytes, standardPacketBytes, debugPacketBytes }
    );
    const goProbeArgs = {
        symbol: 'MissingRender',
        file: 'tests/fixtures/graph/go/sample.go',
        precise: true,
        depth: 1,
        limit: 20,
    };
    const goCompactImpact = await callTool(
        'explore_symbol_impact',
        goProbeArgs,
        'Verify an unconfirmed Go symbol remains decision-first while seed-local graph evidence is normalized.'
    );
    const goStandardImpact = await callTool(
        'explore_symbol_impact',
        { ...goProbeArgs, mode: 'standard' },
        'Verify sparse observed/usable evidence for an unconfirmed Go symbol.'
    );
    const goDebugImpact = callCliWorkflow(
        'explore_symbol_impact',
        { ...goProbeArgs, mode: 'debug' },
        'Verify the full debug audit for the same unconfirmed Go symbol in a fresh CLI process.'
    );
    const goPackets = {
        compact: Buffer.byteLength(JSON.stringify(goCompactImpact), 'utf8'),
        standard: Buffer.byteLength(JSON.stringify(goStandardImpact), 'utf8'),
        debug: Buffer.byteLength(JSON.stringify(goDebugImpact), 'utf8'),
    };
    const goStandardGraph = goStandardImpact?.details?.evidence?.graph;
    const goDebugGraph = goDebugImpact?.details?.graph;
    const goActions = {
        compact: goCompactImpact?.nextReads?.[0],
        standard: goStandardImpact?.nextReads?.[0],
        debug: goDebugImpact?.nextReads?.[0],
    };
    const goOmissionReasons = Array.isArray(goStandardImpact?.details?.omissions)
        ? goStandardImpact.details.omissions.map((item: any) => item?.reason).filter(Boolean)
        : [];
    const goDebugOmissionReasons = Array.isArray(goDebugImpact?.details?.omissions)
        ? goDebugImpact.details.omissions.map((item: any) => item?.reason).filter(Boolean)
        : [];
    const goPacketBudget = Number(
        goStandardImpact?.details?.disclosure?.packetByteBudget || SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes
    );
    const goStandardDetailBytes = Buffer.byteLength(JSON.stringify(goStandardImpact?.details), 'utf8');
    const goDebugDetailBytes = Buffer.byteLength(JSON.stringify(goDebugImpact?.details), 'utf8');
    const exactGoActions = Object.values(goActions).every(
        (action: any) =>
            action?.action === 'locate_confirm_definition' &&
            action?.arguments?.symbol === goProbeArgs.symbol &&
            action?.arguments?.precise === true &&
            !Object.hasOwn(action.arguments, 'file')
    );
    recordSemanticCheck(
        'explore_symbol_impact_unconfirmed_go_evidence_is_truthful_and_actionable',
        goCompactImpact?.ok === false &&
            goCompactImpact?.status === 'unconfirmed' &&
            goCompactImpact?.degraded === false &&
            goStandardImpact?.status === 'unconfirmed' &&
            goStandardImpact?.degraded === false &&
            goDebugImpact?.status === 'unconfirmed' &&
            goDebugImpact?.degraded === false &&
            goCompactImpact?.evidence?.graphImpact === true &&
            exactGoActions &&
            goStandardImpact?.details?.schemaVersion === 2 &&
            goStandardGraph?.observedImpact === true &&
            goStandardGraph?.usableImpact === true &&
            Number(goStandardGraph?.usableItems || 0) > 0 &&
            goDebugGraph?.observedImpact === true &&
            goDebugGraph?.usableImpact === true &&
            goPackets.compact <= goPacketBudget &&
            goPackets.standard <= goPacketBudget &&
            goPackets.debug <= goPacketBudget &&
            Number(goStandardImpact?.details?.disclosure?.emittedBytes || 0) === goStandardDetailBytes &&
            goStandardDetailBytes <= Number(goStandardImpact?.details?.disclosure?.byteBudget || 0) &&
            Number(goDebugImpact?.details?.disclosure?.emittedBytes || 0) === goDebugDetailBytes &&
            goDebugDetailBytes <= Number(goDebugImpact?.details?.disclosure?.byteBudget || 0) &&
            ![...goOmissionReasons, ...goDebugOmissionReasons].some(
                (reason) => reason === 'invalid_shape' || reason === 'outside_workspace'
            ),
        {
            packets: goPackets,
            standardGraph: {
                observedImpact: goStandardGraph?.observedImpact,
                usableImpact: goStandardGraph?.usableImpact,
                observedItems: goStandardGraph?.observedItems,
                usableItems: goStandardGraph?.usableItems,
            },
            debugGraph: {
                observedImpact: goDebugGraph?.observedImpact,
                usableImpact: goDebugGraph?.usableImpact,
                observedItems: goDebugGraph?.observedItems,
                usableItems: goDebugGraph?.usableItems,
            },
            omissionReasons: { standard: goOmissionReasons, debug: goDebugOmissionReasons },
            budgets: {
                packet: goPacketBudget,
                standardDetail: {
                    bytes: goStandardDetailBytes,
                    budget: goStandardImpact?.details?.disclosure?.byteBudget,
                },
                debugDetail: {
                    bytes: goDebugDetailBytes,
                    budget: goDebugImpact?.details?.disclosure?.byteBudget,
                },
            },
            degradation: {
                compact: goCompactImpact?.degraded,
                standard: goStandardImpact?.degraded,
                debug: goDebugImpact?.degraded,
            },
            nextActions: goActions,
        }
    );
    const structuralRiskImpact = await callTool(
        'explore_symbol_impact',
        { symbol: structuralRiskSymbol, file: structuralRiskFile, precise: true, depth: 1, limit: 50, maxFiles: 10 },
        'Dogfood structural public-API, state-write, registration, and test risk evidence against adversarial names.'
    );
    const structuralTruth: Record<(typeof structuralRiskSignals)[number], Set<string>> = {
        publicApi: new Set(['fixtures/symbol-impact-structural/facet.ts']),
        state: new Set(['fixtures/symbol-impact-structural/facet.ts']),
        registry: new Set(['fixtures/symbol-impact-structural/mesh.ts']),
        tests: new Set(['fixtures/symbol-impact-structural/verification.ts']),
    };
    const structuralFiles = [
        'fixtures/symbol-impact-structural/facet.ts',
        'fixtures/symbol-impact-structural/mesh.ts',
        'fixtures/symbol-impact-structural/verification.ts',
        'fixtures/symbol-impact-structural/public-api-index-registry-state-store.spec.ts',
    ];
    let structuralFalsePositives = 0;
    let structuralFalseNegatives = 0;
    for (const signal of structuralRiskSignals) {
        const predicted = new Set<string>(structuralRiskImpact?.editRisk?.signals?.[signal]?.files || []);
        for (const file of structuralFiles) {
            if (predicted.has(file) && !structuralTruth[signal].has(file)) structuralFalsePositives++;
            if (!predicted.has(file) && structuralTruth[signal].has(file)) structuralFalseNegatives++;
        }
    }
    recordSemanticCheck(
        'explore_symbol_impact_structural_signal_fixture_has_no_false_classifications',
        structuralFalsePositives === 0 &&
            structuralFalseNegatives === 0 &&
            structuralRiskSignals.every(
                (signal) => structuralRiskImpact?.editRisk?.signals?.[signal]?.status === 'detected'
            ),
        {
            labels: structuralFiles.length * structuralRiskSignals.length,
            falsePositives: structuralFalsePositives,
            falseNegatives: structuralFalseNegatives,
            signals: structuralRiskImpact?.editRisk?.signals,
        }
    );
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
                'The structural risk fixture distinguishes target-specific exports, writes, keyed registration, and imported test calls from low-confidence filename fallbacks.',
                'propose_patch and run_checks support preview-first patch planning without mutating the working tree.',
                'The CLI workflow command provides a machine-readable local fallback for bounded tool calls.',
            ],
            does_not_prove: [
                'Production readiness.',
                'Full MCP client compatibility in every host.',
                'Rich semantic graph coverage or framework-level registry/state semantics for every repository.',
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
