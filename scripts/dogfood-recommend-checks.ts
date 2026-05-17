#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outputPath = '.test-results/recommend-checks-dogfood.json';
const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');

type CallEvidence = {
    name: string;
    caseName: string;
    args: Record<string, unknown>;
    exitCode: number | null;
    success: boolean;
    elapsedMs: number;
    payload: any;
    stderrClean: boolean;
    observation: string;
};

function parseWorkflowStdout(stdout: string) {
    const raw = JSON.parse(stdout.trim() || '{}');
    const text = raw?.content?.[0]?.text;
    return typeof text === 'string' ? JSON.parse(text) : raw;
}

function workflow(caseName: string, args: Record<string, unknown>, observation: string): CallEvidence {
    const started = Date.now();
    const proc = spawnSync('bun', ['run', 'src/servers/cli.ts', 'workflow', 'recommend_checks', '--args', JSON.stringify(args), '--json'], {
        encoding: 'utf8',
        env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true' },
    });
    const stderr = String(proc.stderr || '');
    let payload: any = null;
    try {
        payload = parseWorkflowStdout(String(proc.stdout || ''));
    } catch {
        payload = { stdout: String(proc.stdout || '').slice(0, 1000), stderr: stderr.slice(0, 1000) };
    }
    const stderrClean = !stderr.includes('[HTTP Server]') && !stderr.includes('Error:');
    return {
        name: 'recommend_checks',
        caseName,
        args,
        exitCode: proc.status,
        success: proc.status === 0 && stderrClean && payload?.workflow === 'recommend_checks' && payload?.ok === true,
        elapsedMs: Date.now() - started,
        payload,
        stderrClean,
        observation,
    };
}

const docsPatch = `diff --git a/docs/project/alpha-mvp-contract.md b/docs/project/alpha-mvp-contract.md
--- a/docs/project/alpha-mvp-contract.md
+++ b/docs/project/alpha-mvp-contract.md
@@ -1,3 +1,3 @@
-old docs line
+new docs line
`;

const sourcePatch = `diff --git a/src/adapters/mcp-adapter.ts b/src/adapters/mcp-adapter.ts
--- a/src/adapters/mcp-adapter.ts
+++ b/src/adapters/mcp-adapter.ts
@@ -1,3 +1,3 @@
-old source line
+new source line
`;

const impactSummary = {
    seed: { kind: 'file', value: 'src/adapters/mcp-adapter.ts' },
    requestedEdges: ['imports', 'exports', 'callers', 'callees'],
    counts: { imports: 2, exports: 1, callers: 0, callees: 3 },
    hasImpactEvidence: true,
};

const calls: CallEvidence[] = [
    workflow('docs_only_patch', { patch: docsPatch }, 'Docs-only patch should recommend a no-op minimum check with explicit docs rationale.'),
    workflow('ts_source_patch', { patch: sourcePatch }, 'TypeScript source patch should recommend bun run typecheck.'),
    workflow(
        'test_file_change',
        { files: ['tests/alpha-mvp-cli-parity.test.ts'] },
        'Test-file change should recommend a narrow bun test invocation for that file.'
    ),
    workflow(
        'graph_impact_source_change',
        { files: ['src/adapters/mcp-adapter.ts'], impactSummary, mode: 'broader' },
        'Graph impact with source edges should add broader-validation rationale while preserving typecheck.'
    ),
];

function commands(call: CallEvidence, key: 'commands' | 'minimum' | 'broader' = 'commands'): string[] {
    return Array.isArray(call.payload?.[key]) ? call.payload[key].map(String) : [];
}

function reasons(call: CallEvidence): string[] {
    return Array.isArray(call.payload?.rationale) ? call.payload.rationale.map((item: any) => String(item?.reason || '')) : [];
}

const byCase = Object.fromEntries(calls.map((call) => [call.caseName, call]));
const assertions = {
    docsOnlyMinimumNoop: commands(byCase.docs_only_patch, 'minimum').includes('true') && reasons(byCase.docs_only_patch).some((reason) => reason.includes('docs') || reason.includes('markdown')),
    tsSourceTypecheck: commands(byCase.ts_source_patch, 'minimum').includes('bun run typecheck'),
    testFileNarrowTest: commands(byCase.test_file_change, 'minimum').includes('bun test tests/alpha-mvp-cli-parity.test.ts'),
    graphImpactBroaderRationale: reasons(byCase.graph_impact_source_change).includes('graph_impact_edges_present') && commands(byCase.graph_impact_source_change, 'broader').includes('bun run typecheck'),
};

const evidence = {
    schema: 'semantic-code-intelligence.recommend_checks_dogfood.v1',
    ok: calls.every((call) => call.success) && Object.values(assertions).every(Boolean),
    target: 'recommend_checks',
    assertions,
    calls: calls.map((call) => ({
        name: call.name,
        caseName: call.caseName,
        args: call.args,
        exitCode: call.exitCode,
        success: call.success,
        elapsedMs: call.elapsedMs,
        stderrClean: call.stderrClean,
        observation: call.observation,
        payload: {
            workflow: call.payload?.workflow,
            ok: call.payload?.ok,
            mode: call.payload?.mode,
            commands: call.payload?.commands,
            minimum: call.payload?.minimum,
            broader: call.payload?.broader,
            rationale: call.payload?.rationale,
            confidence: call.payload?.confidence,
        },
    })),
    interpretation: {
        proves: [
            'recommend_checks returns transparent command recommendations without running checks.',
            'Docs-only, TS source, test-file, and graph-impact cases produce expected minimum/broader command rationale.',
        ],
        does_not_prove: ['Complete test selection accuracy.', 'A hidden policy gate; recommendations are advisory.'],
    },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
if (jsonMode) process.stdout.write(`${output}\n`);
else console.log(output);
if (!evidence.ok) process.exitCode = 1;
