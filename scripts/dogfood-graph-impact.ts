#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outputPath = '.test-results/graph-impact-dogfood.json';
const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');

type CallEvidence = {
    name: string;
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

function workflow(name: string, args: Record<string, unknown>, observation: string): CallEvidence {
    const started = Date.now();
    const proc = spawnSync('bun', ['run', 'src/servers/cli.ts', 'workflow', name, '--args', JSON.stringify(args), '--json'], {
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
        name,
        args,
        exitCode: proc.status,
        success: proc.status === 0 && stderrClean && payload && typeof payload === 'object',
        elapsedMs: Date.now() - started,
        payload,
        stderrClean,
        observation,
    };
}

const calls: CallEvidence[] = [];

const fileImpact = workflow(
    'graph_expand',
    {
        file: 'src/core/code-graph.ts',
        symbol: 'expandNeighbors',
        edges: ['imports', 'exports', 'callees', 'callers'],
        depth: 1,
        limit: 50,
    },
    'Use graph_expand to summarize import/export/callee/caller impact evidence for a core graph implementation file.'
);
calls.push(fileImpact);

const symbolImpact = workflow(
    'graph_expand',
    {
        symbol: 'expandNeighbors',
        edges: ['callers', 'callees'],
        depth: 1,
        limit: 50,
    },
    'Use graph_expand from a symbol seed to return caller/callee edge status and structured limitations when evidence is sparse.'
);
calls.push(symbolImpact);

const callerContextImpact = workflow(
    'graph_expand',
    {
        file: 'scripts/build-alpha-evidence-packet.ts',
        symbol: 'readJson',
        edges: ['callers'],
        depth: 1,
        limit: 20,
    },
    'Use graph_expand with file+symbol to return best-effort enclosing caller context for call sites.'
);
calls.push(callerContextImpact);

const pythonImpact = workflow(
    'graph_expand',
    {
        file: 'scripts/lib/check-task-scope-snapshots.py',
        edges: ['imports', 'exports', 'callees'],
        depth: 1,
        limit: 30,
    },
    'Use graph_expand against Python to characterize supported import/callee extraction and explicit export limitations.'
);
calls.push(pythonImpact);

const rustImpact = workflow(
    'graph_expand',
    {
        file: 'tests/fixtures/graph/rust/sample.rs',
        symbol: 'render',
        edges: ['imports', 'exports', 'callers', 'callees'],
        depth: 1,
        limit: 30,
    },
    'Use graph_expand against Rust to characterize syntactic tree-sitter import/export/callee evidence plus explicit semantic limitations.'
);
calls.push(rustImpact);

const goImpact = workflow(
    'graph_expand',
    {
        file: 'tests/fixtures/graph/go/sample.go',
        symbol: 'Render',
        edges: ['imports', 'exports', 'callers', 'callees'],
        depth: 1,
        limit: 30,
    },
    'Use graph_expand against Go to characterize syntactic tree-sitter import/export/callee evidence plus explicit semantic limitations.'
);
calls.push(goImpact);

const unsupportedImpact = workflow(
    'graph_expand',
    {
        file: 'docs/project/product-posture.md',
        edges: ['imports', 'exports', 'callers', 'callees'],
        depth: 1,
        limit: 10,
    },
    'Use graph_expand against a non-code markdown seed to characterize unsupported-extension fallback behavior.'
);
calls.push(unsupportedImpact);

const fileSummary = fileImpact.payload?.impactSummary || {};
const symbolSummary = symbolImpact.payload?.impactSummary || {};
const callerContextSummary = callerContextImpact.payload?.impactSummary || {};
const pythonSummary = pythonImpact.payload?.impactSummary || {};
const rustSummary = rustImpact.payload?.impactSummary || {};
const goSummary = goImpact.payload?.impactSummary || {};
const unsupportedSummary = unsupportedImpact.payload?.impactSummary || {};
const fileCounts = fileSummary.counts || {};
const symbolCounts = symbolSummary.counts || {};
const callerContextCounts = callerContextSummary.counts || {};

const evidence = {
    schema: 'semantic-code-intelligence.graph_impact_dogfood.v1',
    ok:
        calls.every((call) => call.success) &&
        fileSummary.hasImpactEvidence === true &&
        Number(fileCounts.imports || 0) > 0 &&
        Number(fileCounts.callees || 0) > 0 &&
        Array.isArray(fileSummary.planningHints) &&
        fileSummary.planningHints.length > 0 &&
        Array.isArray(symbolSummary.evidence) &&
        symbolSummary.evidence.some((item: any) => item.edge === 'callers') &&
        symbolSummary.evidence.some((item: any) => item.edge === 'callees') &&
        Number(callerContextCounts.callers || 0) > 0 &&
        Number(callerContextSummary.callerContextCount || 0) > 0 &&
        pythonSummary?.languageSupport?.language === 'python' &&
        Array.isArray(pythonSummary?.limitations) &&
        pythonSummary.limitations.some((item: string) => item.includes('exports: python')) &&
        rustSummary?.languageSupport?.language === 'rust' &&
        rustSummary?.languageSupport?.support === 'tree_sitter_best_effort' &&
        Number(rustSummary?.counts?.imports || 0) > 0 &&
        Number(rustSummary?.counts?.exports || 0) > 0 &&
        Number(rustSummary?.counts?.callees || 0) > 0 &&
        Array.isArray(rustSummary?.limitations) &&
        rustSummary.limitations.some((item: string) => item.includes('rust: tree-sitter graph evidence is syntactic')) &&
        goSummary?.languageSupport?.language === 'go' &&
        goSummary?.languageSupport?.support === 'tree_sitter_best_effort' &&
        Number(goSummary?.counts?.imports || 0) > 0 &&
        Number(goSummary?.counts?.exports || 0) > 0 &&
        Number(goSummary?.counts?.callees || 0) > 0 &&
        Array.isArray(goSummary?.limitations) &&
        goSummary.limitations.some((item: string) => item.includes('go: tree-sitter graph evidence is syntactic')) &&
        unsupportedSummary?.languageSupport?.support === 'unknown_extension' &&
        Array.isArray(unsupportedSummary?.limitations) &&
        unsupportedSummary.limitations.length > 0 &&
        fileSummary?.backend === 'tree_sitter' &&
        fileSummary?.freshness === 'current' &&
        symbolSummary?.discoveryBackend === 'rg' &&
        unsupportedSummary?.backend === 'fallback',
    target: 'src/core/code-graph.ts',
    symbol: 'expandNeighbors',
    assertions: {
        fileImpactHasImports: Number(fileCounts.imports || 0) > 0,
        fileImpactHasCallees: Number(fileCounts.callees || 0) > 0,
        fileImpactHasPlanningHints: Array.isArray(fileSummary.planningHints) && fileSummary.planningHints.length > 0,
        symbolImpactHasCallerStatus: Array.isArray(symbolSummary.evidence) && symbolSummary.evidence.some((item: any) => item.edge === 'callers'),
        symbolImpactHasLimitations: Array.isArray(symbolSummary.limitations) && symbolSummary.limitations.length > 0,
        callerContextPresent: Number(callerContextCounts.callers || 0) > 0 && Number(callerContextSummary.callerContextCount || 0) > 0,
        pythonLanguageCharacterized: pythonSummary?.languageSupport?.language === 'python' && pythonSummary?.languageSupport?.support === 'tree_sitter_best_effort',
        pythonExportLimitationVisible: Array.isArray(pythonSummary?.limitations) && pythonSummary.limitations.some((item: string) => item.includes('exports: python')),
        rustLanguageCharacterized:
            rustSummary?.languageSupport?.language === 'rust' &&
            rustSummary?.languageSupport?.support === 'tree_sitter_best_effort' &&
            Number(rustSummary?.counts?.imports || 0) > 0 &&
            Number(rustSummary?.counts?.exports || 0) > 0 &&
            Number(rustSummary?.counts?.callees || 0) > 0,
        rustLimitationsVisible: Array.isArray(rustSummary?.limitations) && rustSummary.limitations.some((item: string) => item.includes('rust: tree-sitter graph evidence is syntactic')),
        goLanguageCharacterized:
            goSummary?.languageSupport?.language === 'go' &&
            goSummary?.languageSupport?.support === 'tree_sitter_best_effort' &&
            Number(goSummary?.counts?.imports || 0) > 0 &&
            Number(goSummary?.counts?.exports || 0) > 0 &&
            Number(goSummary?.counts?.callees || 0) > 0,
        goLimitationsVisible: Array.isArray(goSummary?.limitations) && goSummary.limitations.some((item: string) => item.includes('go: tree-sitter graph evidence is syntactic')),
        unsupportedExtensionCharacterized: unsupportedSummary?.languageSupport?.support === 'unknown_extension' && Array.isArray(unsupportedSummary?.limitations) && unsupportedSummary.limitations.length > 0,
        backendProvenancePresent:
            fileSummary?.backend === 'tree_sitter' &&
            fileSummary?.freshness === 'current' &&
            fileSummary?.provenance?.backend === 'tree_sitter' &&
            symbolSummary?.discoveryBackend === 'rg' &&
            unsupportedSummary?.backend === 'fallback',
        summariesHaveRequestedEdges:
            Array.isArray(fileSummary.requestedEdges) &&
            fileSummary.requestedEdges.includes('imports') &&
            fileSummary.requestedEdges.includes('callees') &&
            Array.isArray(symbolSummary.requestedEdges) &&
            symbolSummary.requestedEdges.includes('callers'),
    },
    impact: {
        file: fileSummary,
        symbol: symbolSummary,
        callerContext: callerContextSummary,
        python: pythonSummary,
        rust: rustSummary,
        go: goSummary,
        unsupported: unsupportedSummary,
    },
    calls: calls.map((call) => ({
        name: call.name,
        args: call.args,
        exitCode: call.exitCode,
        success: call.success,
        elapsedMs: call.elapsedMs,
        stderrClean: call.stderrClean,
        observation: call.observation,
        payload: {
            schemaVersion: call.payload?.schemaVersion,
            file: call.payload?.file,
            symbol: call.payload?.symbol,
            note: call.payload?.note,
            impactSummary: call.payload?.impactSummary,
        },
    })),
    interpretation: {
        proves: [
            'graph_expand returns operator-readable impactSummary evidence for harnessed LLM change planning.',
            'File-scoped graph expansion exposes import/callee evidence and planning hints.',
            'Symbol-scoped graph expansion exposes caller/callee edge status with structured limitations when evidence is sparse.',
            'File+symbol caller expansion includes best-effort enclosing callable context for call sites.',
            'Graph impact summaries characterize best-effort language support, including Rust and Go syntactic tree-sitter evidence, backend provenance, and unsupported-extension limitations.',
        ],
        does_not_prove: [
            'Complete whole-program call graph accuracy.',
            'Rich semantic graph behavior for every language.',
            'Graph support for unsupported source types such as Markdown or Clojure.',
        ],
    },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
if (jsonMode) process.stdout.write(`${output}\n`);
else console.log(output);
if (!evidence.ok) process.exitCode = 1;
