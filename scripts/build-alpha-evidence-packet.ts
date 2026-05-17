#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

const files = {
    alpha: '.test-results/alpha-mvp-dogfood.json',
    selfHosted: '.test-results/self-hosted-cli-dogfood.json',
    structural: '.test-results/structural-workflow-dogfood.json',
    graph: '.test-results/graph-impact-dogfood.json',
    recommendChecks: '.test-results/recommend-checks-dogfood.json',
    safeWrite: '.test-results/safe-write-dogfood.json',
    validationPlanComparison: '.test-results/validation-plan-comparison.json',
    gate: '.test-results/alpha-evidence-check.json',
};

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function safeRead(path: string): { ok: true; value: any } | { ok: false; error: string } {
    try {
        return { ok: true, value: readJson(path) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function maxElapsed(calls: any[]): number {
    return Math.max(0, ...calls.map((call) => Number(call?.elapsedMs || 0)).filter((value) => Number.isFinite(value)));
}

function summarizeCalls(calls: any[]) {
    return calls.map((call) => ({
        name: String(call?.name || ''),
        success: call?.success === true,
        elapsedMs: Number(call?.elapsedMs || 0),
        observation: typeof call?.observation === 'string' ? call.observation : undefined,
    }));
}

const loaded = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, safeRead(path)]));
const alpha = loaded.alpha.ok ? loaded.alpha.value : null;
const selfHosted = loaded.selfHosted.ok ? loaded.selfHosted.value : null;
const structural = loaded.structural.ok ? loaded.structural.value : null;
const graph = loaded.graph.ok ? loaded.graph.value : null;
const recommendChecks = loaded.recommendChecks.ok ? loaded.recommendChecks.value : null;
const safeWrite = loaded.safeWrite.ok ? loaded.safeWrite.value : null;
const validationPlanComparison = loaded.validationPlanComparison.ok ? loaded.validationPlanComparison.value : null;
const gate = loaded.gate.ok ? loaded.gate.value : null;

const safeWriteCalls = Array.isArray(safeWrite?.calls) ? safeWrite.calls : [];
const cleanApply = safeWriteCalls.find(
    (call) => call?.payload?.applied === true && call?.payload?.verification?.appliedDiffMatchesSnapshot === true
);
const mismatch = safeWriteCalls.find(
    (call) => call?.payload?.applied === true && call?.payload?.ok === false && call?.payload?.verification?.appliedDiffMatchesSnapshot === false
);
const preview = safeWriteCalls.find((call) => call?.payload?.mode === 'preview_validate' && call?.payload?.applied === false);

const gateChecks = Array.isArray(gate?.checks) ? gate.checks : [];
const failedGateChecks = gateChecks.filter((check) => check?.ok !== true).map((check) => check?.name);

const packet = {
    schema: 'semantic-code-intelligence.alpha_evidence_packet.v1',
    generatedAt: new Date().toISOString(),
    ok:
        alpha?.ok === true &&
        selfHosted?.ok === true &&
        structural?.ok === true &&
        graph?.ok === true &&
        recommendChecks?.ok === true &&
        safeWrite?.ok === true &&
        validationPlanComparison?.ok === true &&
        gate?.ok === true,
    sourceFiles: files,
    evidenceGate: {
        ok: gate?.ok === true,
        checkCount: gateChecks.length,
        failedChecks: failedGateChecks,
        budgetsMs: gate?.budgetsMs || null,
    },
    toolCoverage: {
        alphaSummaryCount: Array.isArray(alpha?.summary) ? alpha.summary.length : 0,
        alphaTools: Array.isArray(alpha?.summary) ? alpha.summary.map((entry: any) => entry?.name).filter(Boolean) : [],
        maxAlphaCallElapsedMs: Array.isArray(alpha?.summary) ? maxElapsed(alpha.summary) : 0,
    },
    sciFirstDiscovery: {
        ok: selfHosted?.selfHosting?.sciFirstDiscovery?.complete === true,
        expectedFirstTools: selfHosted?.selfHosting?.sciFirstDiscovery?.expectedFirstTools || [],
        actualFirstTools: selfHosted?.selfHosting?.sciFirstDiscovery?.actualFirstTools || [],
        workspaceUnchanged: selfHosted?.selfHosting?.workspaceUnchanged === true,
        maxCallElapsedMs: Array.isArray(selfHosted?.calls) ? maxElapsed(selfHosted.calls) : 0,
    },
    graphImpact: {
        ok: graph?.ok === true,
        target: graph?.target || null,
        symbol: graph?.symbol || null,
        assertions: graph?.assertions || null,
        fileImpact: graph?.impact?.file || null,
        symbolImpact: graph?.impact?.symbol || null,
        maxCallElapsedMs: Array.isArray(graph?.calls) ? maxElapsed(graph.calls) : 0,
    },
    checkRecommendations: {
        ok: recommendChecks?.ok === true,
        assertions: recommendChecks?.assertions || null,
        calls: summarizeCalls(Array.isArray(recommendChecks?.calls) ? recommendChecks.calls : []),
        maxCallElapsedMs: Array.isArray(recommendChecks?.calls) ? maxElapsed(recommendChecks.calls) : 0,
    },
    previewFirstMutation: {
        structuralOk: structural?.ok === true,
        structuralCalls: summarizeCalls(Array.isArray(structural?.calls) ? structural.calls : []),
        safeWritePreviewPresent: !!preview,
        safeWritePreviewRecommendationsPresent: safeWriteCalls.some((call) => call?.payload?.mode === 'preview_validate' && call?.payload?.checkRecommendations?.workflow === 'recommend_checks'),
        safeWritePreviewValidationPlanPresent: safeWriteCalls.some((call) => call?.payload?.mode === 'preview_validate' && call?.payload?.validationPlan?.schema === 'semantic-code-intelligence.validation_plan.v1'),
        validationPlanSample: preview?.payload?.validationPlan || null,
        safeWriteFixtureCleanAfterRollback: safeWrite?.assertions?.fixtureCleanAfterRollback === true,
    },
    validationPlanComparison: {
        ok: validationPlanComparison?.ok === true,
        comparedPlanCount: validationPlanComparison?.comparedPlanCount || 0,
        stableFields: validationPlanComparison?.stableFields || [],
        ignoredVolatileFields: validationPlanComparison?.ignoredVolatileFields || [],
        drift: validationPlanComparison?.drift || [],
        operatorSummary: validationPlanComparison?.operatorSummary || null,
        remediationCatalog: validationPlanComparison?.remediationCatalog || null,
    },
    safeWriteVerification: {
        ok: safeWrite?.ok === true,
        cleanApplyVerified: !!cleanApply,
        cleanApplyMethod: cleanApply?.payload?.verification?.method || null,
        mismatchFailsClosed: !!mismatch,
        mismatchMethod: mismatch?.payload?.verification?.method || null,
        rollbackRestoredExactly: safeWrite?.assertions?.rollbackRestoredExactly === true,
        mismatchRollbackPreservedPreexistingDirtyChange:
            safeWrite?.assertions?.mismatchRollbackPreservedPreexistingDirtyChange === true,
    },
    validationCommands: [
        'bun run typecheck',
        'bun run alpha:mvp:test',
        'bun run alpha:mvp:dogfood',
        'bun run self:dogfood:cli',
        'bun run structural:dogfood',
        'bun run graph:dogfood',
        'bun run recommend-checks:dogfood',
        'bun run safe-write:dogfood',
        'bun run validation-plan:compare',
        'bun run alpha:evidence:check',
        'bun run alpha:evidence:packet',
        './scripts/migration-hygiene.sh',
    ],
    operatorSummary: {
        proves: [
            'SCI exposes the Alpha MVP tool surface across tested interfaces.',
            'Self-hosted maintenance starts with SCI discovery/navigation evidence.',
            'Graph impact dogfood exposes import/export/callee/caller edge status and planning hints.',
            'Impact-aware check recommendation dogfood maps docs, source, test, and graph-impact cases to explicit advisory commands.',
            'Patch-check and safe-write previews can surface advisory check recommendations and compact validationPlan summaries without changing check/apply policy.',
            'ValidationPlan comparison flags stable-field check-plan drift while ignoring volatile snapshot/timing fields and includes remediation hints for failures.',
            'Patch planning remains preview-first by default.',
            'safe_write has clean apply exact-diff verification and dirty mismatch fail-closed evidence.',
            'Generated dogfood evidence passes the lightweight Alpha evidence gate.',
        ],
        doesNotProve: [
            'Production readiness.',
            'Comprehensive performance characterization.',
            'Complete whole-program call graph accuracy or rich semantic graph behavior for every language.',
            'A durable long-lived session database beyond narrow snapshot artifacts and generated evidence files.',
        ],
        nextRecommendedWave: 'Promote validationPlan evidence into targeted operator UX only after more external-repo dogfood.'
    },
    loadErrors: Object.fromEntries(
        Object.entries(loaded)
            .filter(([, result]) => !result.ok)
            .map(([key, result]: [string, any]) => [key, result.error])
    ),
};

console.log(JSON.stringify(packet, null, 2));
if (!packet.ok) process.exitCode = 1;
