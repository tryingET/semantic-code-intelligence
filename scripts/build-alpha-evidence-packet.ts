#!/usr/bin/env bun
import { join } from 'node:path';
import { maxElapsed, readEvidenceJsonFile, safeEvidenceError, sanitizeEvidence, summarizeCalls } from './evidence-summary-utils';

const evidenceRoot = process.env.SCI_ALPHA_EVIDENCE_ROOT || '.test-results';
const files = {
    alpha: join(evidenceRoot, 'alpha-mvp-dogfood.json'),
    selfHosted: join(evidenceRoot, 'self-hosted-cli-dogfood.json'),
    structural: join(evidenceRoot, 'structural-workflow-dogfood.json'),
    graph: join(evidenceRoot, 'graph-impact-dogfood.json'),
    recommendChecks: join(evidenceRoot, 'recommend-checks-dogfood.json'),
    safeWrite: join(evidenceRoot, 'safe-write-dogfood.json'),
    validationPlanComparison: join(evidenceRoot, 'validation-plan-comparison.json'),
    evidenceHistory: join(evidenceRoot, 'alpha-evidence-history.json'),
    gate: join(evidenceRoot, 'alpha-evidence-check.json'),
};

function readJson(path: string): any {
    return readEvidenceJsonFile(path);
}

function safeRead(path: string): { ok: true; value: any } | { ok: false; error: string } {
    try {
        return { ok: true, value: readJson(path) };
    } catch (error) {
        return { ok: false, error: safeEvidenceError(error) };
    }
}

const loaded = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, safeRead(path)]));
const alpha = loaded.alpha.ok ? loaded.alpha.value : null;
const selfHosted = loaded.selfHosted.ok ? loaded.selfHosted.value : null;
const structural = loaded.structural.ok ? loaded.structural.value : null;
const graph = loaded.graph.ok ? loaded.graph.value : null;
const recommendChecks = loaded.recommendChecks.ok ? loaded.recommendChecks.value : null;
const safeWrite = loaded.safeWrite.ok ? loaded.safeWrite.value : null;
const validationPlanComparison = loaded.validationPlanComparison.ok ? loaded.validationPlanComparison.value : null;
const evidenceHistory = loaded.evidenceHistory.ok ? loaded.evidenceHistory.value : null;
const gate = loaded.gate.ok ? loaded.gate.value : null;

const safeWriteCalls = Array.isArray(safeWrite?.calls) ? safeWrite.calls : [];
const cleanApply = safeWriteCalls.find(
    (call) => call?.success === true && call?.payload?.applied === true && call?.payload?.verification?.appliedDiffMatchesSnapshot === true
);
const mismatch = safeWriteCalls.find(
    (call) => call?.success === true && call?.payload?.applied === true && call?.payload?.ok === false && call?.payload?.verification?.appliedDiffMatchesSnapshot === false
);
const preview = safeWriteCalls.find((call) => call?.success === true && call?.payload?.mode === 'preview_validate' && call?.payload?.applied === false);

const gateChecks = Array.isArray(gate?.checks) ? gate.checks : [];
const failedGateChecks = gateChecks.filter((check) => check?.ok !== true).map((check) => check?.name);
const sourceFilesOk =
    alpha?.ok === true &&
    selfHosted?.ok === true &&
    structural?.ok === true &&
    graph?.ok === true &&
    recommendChecks?.ok === true &&
    safeWrite?.ok === true &&
    validationPlanComparison?.ok === true &&
    evidenceHistory?.ok === true &&
    gate?.ok === true;
const sciFirstDiscoveryOk = selfHosted?.selfHosting?.sciFirstDiscovery?.complete === true;
const selfHostedWorkspaceUnchanged = selfHosted?.selfHosting?.workspaceUnchanged === true;
const safeWritePreviewPresent = !!preview;
const safeWritePreviewRecommendationsPresent = safeWriteCalls.some((call) => call?.success === true && call?.payload?.mode === 'preview_validate' && call?.payload?.checkRecommendations?.workflow === 'recommend_checks');
const safeWritePreviewValidationPlanPresent = safeWriteCalls.some((call) => call?.success === true && call?.payload?.mode === 'preview_validate' && call?.payload?.validationPlan?.schema === 'semantic-code-intelligence.validation_plan.v1');
const safeWriteFixtureCleanAfterRollback = safeWrite?.assertions?.fixtureCleanAfterRollback === true;
const cleanApplyVerified = !!cleanApply;
const mismatchFailsClosed = !!mismatch;
const rollbackRestoredExactly = safeWrite?.assertions?.rollbackRestoredExactly === true;
const mismatchRollbackPreservedPreexistingDirtyChange = safeWrite?.assertions?.mismatchRollbackPreservedPreexistingDirtyChange === true;
const derivedClaimsOk =
    sciFirstDiscoveryOk &&
    selfHostedWorkspaceUnchanged &&
    safeWritePreviewPresent &&
    safeWritePreviewRecommendationsPresent &&
    safeWritePreviewValidationPlanPresent &&
    safeWriteFixtureCleanAfterRollback &&
    cleanApplyVerified &&
    mismatchFailsClosed &&
    rollbackRestoredExactly &&
    mismatchRollbackPreservedPreexistingDirtyChange;

const packet = {
    schema: 'semantic-code-intelligence.alpha_evidence_packet.v1',
    generatedAt: new Date().toISOString(),
    ok: sourceFilesOk && derivedClaimsOk,
    sourceFiles: sanitizeEvidence(files),
    evidenceGate: {
        ok: gate?.ok === true,
        checkCount: gateChecks.length,
        failedChecks: failedGateChecks,
        budgetsMs: gate?.budgetsMs || null,
    },
    toolCoverage: {
        alphaSummaryCount: Array.isArray(alpha?.summary) ? alpha.summary.length : 0,
        alphaTools: sanitizeEvidence(Array.isArray(alpha?.summary) ? alpha.summary.map((entry: any) => entry?.name).filter(Boolean) : []),
        maxAlphaCallElapsedMs: Array.isArray(alpha?.summary) ? maxElapsed(alpha.summary) : 0,
    },
    sciFirstDiscovery: {
        ok: sciFirstDiscoveryOk,
        expectedFirstTools: sanitizeEvidence(selfHosted?.selfHosting?.sciFirstDiscovery?.expectedFirstTools || []),
        actualFirstTools: sanitizeEvidence(selfHosted?.selfHosting?.sciFirstDiscovery?.actualFirstTools || []),
        workspaceUnchanged: selfHostedWorkspaceUnchanged,
        maxCallElapsedMs: Array.isArray(selfHosted?.calls) ? maxElapsed(selfHosted.calls) : 0,
    },
    graphImpact: {
        ok: graph?.ok === true,
        target: sanitizeEvidence(graph?.target || null),
        symbol: sanitizeEvidence(graph?.symbol || null),
        assertions: sanitizeEvidence(graph?.assertions || null),
        fileImpact: sanitizeEvidence(graph?.impact?.file || null),
        symbolImpact: sanitizeEvidence(graph?.impact?.symbol || null),
        impact: sanitizeEvidence({ callerContext: graph?.impact?.callerContext || null }),
        maxCallElapsedMs: Array.isArray(graph?.calls) ? maxElapsed(graph.calls) : 0,
    },
    checkRecommendations: {
        ok: recommendChecks?.ok === true,
        assertions: sanitizeEvidence(recommendChecks?.assertions || null),
        calls: summarizeCalls(Array.isArray(recommendChecks?.calls) ? recommendChecks.calls : []),
        maxCallElapsedMs: Array.isArray(recommendChecks?.calls) ? maxElapsed(recommendChecks.calls) : 0,
    },
    previewFirstMutation: {
        structuralOk: structural?.ok === true,
        structuralCalls: summarizeCalls(Array.isArray(structural?.calls) ? structural.calls : []),
        safeWritePreviewPresent,
        safeWritePreviewRecommendationsPresent,
        safeWritePreviewValidationPlanPresent,
        validationPlanSample: sanitizeEvidence(preview?.payload?.validationPlan || null),
        safeWriteFixtureCleanAfterRollback,
    },
    validationPlanComparison: {
        ok: validationPlanComparison?.ok === true,
        comparedPlanCount: validationPlanComparison?.comparedPlanCount || 0,
        stableFields: sanitizeEvidence(validationPlanComparison?.stableFields || []),
        ignoredVolatileFields: sanitizeEvidence(validationPlanComparison?.ignoredVolatileFields || []),
        drift: sanitizeEvidence(validationPlanComparison?.drift || []),
        operatorSummary: sanitizeEvidence(validationPlanComparison?.operatorSummary || null),
        remediationCatalog: sanitizeEvidence(validationPlanComparison?.remediationCatalog || null),
    },
    evidenceHistory: {
        ok: evidenceHistory?.ok === true,
        baseline: sanitizeEvidence(evidenceHistory?.baseline || null),
        comparisonPolicy: sanitizeEvidence(evidenceHistory?.comparisonPolicy || null),
        comparisons: sanitizeEvidence(evidenceHistory?.comparisons || []),
        warnings: sanitizeEvidence(evidenceHistory?.warnings || []),
        overBudget: sanitizeEvidence(evidenceHistory?.overBudget || []),
        operatorSummary: sanitizeEvidence(evidenceHistory?.operatorSummary || null),
    },
    safeWriteVerification: {
        ok: safeWrite?.ok === true,
        cleanApplyVerified,
        cleanApplyMethod: cleanApply?.payload?.verification?.method || null,
        mismatchFailsClosed,
        mismatchMethod: mismatch?.payload?.verification?.method || null,
        rollbackRestoredExactly,
        mismatchRollbackPreservedPreexistingDirtyChange,
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
        'bun run alpha:evidence:history',
        'bun run alpha:evidence:packet',
        './scripts/migration-hygiene.sh',
    ],
    operatorSummary: {
        proves: [
            'SCI exposes the Alpha MVP tool surface across tested interfaces.',
            'Self-hosted maintenance starts with SCI discovery/navigation evidence.',
            'Graph impact dogfood exposes import/export/callee/caller edge status, sparse-edge limitations, best-effort caller context, and planning hints.',
            'Impact-aware check recommendation dogfood maps docs, source, test, and graph-impact cases to explicit advisory commands.',
            'Patch-check and safe-write previews can surface advisory check recommendations and compact validationPlan summaries without changing check/apply policy.',
            'ValidationPlan comparison flags stable-field check-plan drift while ignoring volatile snapshot/timing fields and includes remediation hints for failures.',
            'Alpha evidence history compares elapsed-time maxima against an explicit baseline while preserving coarse budgets as the fail-closed gate.',
            'Patch planning remains preview-first by default.',
            'safe_write has clean apply exact-diff verification and dirty mismatch fail-closed evidence.',
            'Generated dogfood evidence passes the lightweight Alpha evidence gate.',
        ],
        doesNotProve: [
            'Production readiness.',
            'Production p95/p99 performance characterization.',
            'Complete whole-program call graph accuracy or rich semantic graph behavior for every language.',
            'A durable long-lived session database beyond narrow snapshot artifacts and generated evidence files.',
            'Authority to reopen Phase 1 dogfood accumulation by default.',
        ],
        nextRecommendedWave: 'Phase 1 is closed as an Alpha MVP substrate. Continue only for Alpha maintenance/regression fixes, targeted hardening tied to a named closure-review gap, or an explicit Phase 2 review; do not add confidence-only dogfood by default.'
    },
    loadErrors: Object.fromEntries(
        Object.entries(loaded)
            .filter(([, result]) => !result.ok)
            .map(([key, result]: [string, any]) => [key, sanitizeEvidence(result.error)])
    ),
};

console.log(JSON.stringify(sanitizeEvidence(packet), null, 2));
if (!packet.ok) process.exitCode = 1;
