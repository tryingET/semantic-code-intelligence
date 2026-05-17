#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

type Check = {
    name: string;
    ok: boolean;
    detail?: Record<string, unknown>;
};

const evidenceFiles = {
    alpha: '.test-results/alpha-mvp-dogfood.json',
    selfHosted: '.test-results/self-hosted-cli-dogfood.json',
    structural: '.test-results/structural-workflow-dogfood.json',
    graph: '.test-results/graph-impact-dogfood.json',
    recommendChecks: '.test-results/recommend-checks-dogfood.json',
    safeWrite: '.test-results/safe-write-dogfood.json',
    validationPlanComparison: '.test-results/validation-plan-comparison.json',
};

const budgetsMs: Record<string, number> = {
    alphaCall: 15_000,
    selfHostedCall: 15_000,
    structuralCall: 20_000,
    graphCall: 15_000,
    recommendChecksCall: 15_000,
    safeWriteCall: 15_000,
};

function readJson(path: string): any {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function maxElapsed(calls: any[]): number {
    return Math.max(0, ...calls.map((call) => Number(call?.elapsedMs || 0)).filter((value) => Number.isFinite(value)));
}

function names(calls: any[]): string[] {
    return calls.map((call) => String(call?.name || '')).filter(Boolean);
}

const checks: Check[] = [];
let alpha: any = null;
let selfHosted: any = null;
let structural: any = null;
let graph: any = null;
let recommendChecks: any = null;
let safeWrite: any = null;
let validationPlanComparison: any = null;

try {
    alpha = readJson(evidenceFiles.alpha);
    selfHosted = readJson(evidenceFiles.selfHosted);
    structural = readJson(evidenceFiles.structural);
    graph = readJson(evidenceFiles.graph);
    recommendChecks = readJson(evidenceFiles.recommendChecks);
    safeWrite = readJson(evidenceFiles.safeWrite);
    validationPlanComparison = readJson(evidenceFiles.validationPlanComparison);
} catch (error) {
    checks.push({ name: 'evidence_files_readable', ok: false, detail: { message: error instanceof Error ? error.message : String(error) } });
}

if (alpha) {
    const summary = Array.isArray(alpha.summary) ? alpha.summary : [];
    const required = ['get_snapshot', 'read_file', 'text_search', 'symbol_search', 'find_definition', 'find_references', 'ast_query', 'graph_expand', 'recommend_checks', 'propose_patch', 'run_checks'];
    const actual = names(summary);
    checks.push({ name: 'alpha_dogfood_ok', ok: alpha.ok === true, detail: { schema: alpha.schema } });
    checks.push({
        name: 'alpha_required_tools_present',
        ok: required.every((tool) => actual.includes(tool)),
        detail: { required, actual },
    });
    checks.push({
        name: 'alpha_latency_budget',
        ok: maxElapsed(summary) <= budgetsMs.alphaCall,
        detail: { maxElapsedMs: maxElapsed(summary), budgetMs: budgetsMs.alphaCall },
    });
}

if (selfHosted) {
    const sciFirst = selfHosted?.selfHosting?.sciFirstDiscovery;
    const calls = Array.isArray(selfHosted.calls) ? selfHosted.calls : [];
    checks.push({ name: 'self_hosted_dogfood_ok', ok: selfHosted.ok === true, detail: { schema: selfHosted.schema } });
    checks.push({
        name: 'sci_first_discovery_complete',
        ok: sciFirst?.complete === true,
        detail: { expectedFirstTools: sciFirst?.expectedFirstTools, actualFirstTools: sciFirst?.actualFirstTools },
    });
    checks.push({
        name: 'self_hosted_workspace_unchanged',
        ok: selfHosted?.selfHosting?.workspaceUnchanged === true,
    });
    checks.push({
        name: 'self_hosted_latency_budget',
        ok: maxElapsed(calls) <= budgetsMs.selfHostedCall,
        detail: { maxElapsedMs: maxElapsed(calls), budgetMs: budgetsMs.selfHostedCall },
    });
}

if (structural) {
    const calls = Array.isArray(structural.calls) ? structural.calls : [];
    const actual = names(calls);
    const hasPreviewPatch = calls.some((call) => call?.name === 'structural_patch_checks' && call?.sample?.payload?.applied === false);
    checks.push({ name: 'structural_dogfood_ok', ok: structural.ok === true, detail: { schema: structural.schema } });
    checks.push({
        name: 'structural_preview_first',
        ok: actual.includes('structural_search') && actual.includes('structural_patch_checks') && hasPreviewPatch,
        detail: { actual, hasPreviewPatch },
    });
    checks.push({
        name: 'structural_latency_budget',
        ok: maxElapsed(calls) <= budgetsMs.structuralCall,
        detail: { maxElapsedMs: maxElapsed(calls), budgetMs: budgetsMs.structuralCall },
    });
}

if (graph) {
    const calls = Array.isArray(graph.calls) ? graph.calls : [];
    checks.push({ name: 'graph_impact_dogfood_ok', ok: graph.ok === true, detail: { schema: graph.schema } });
    checks.push({
        name: 'graph_impact_summary_present',
        ok:
            graph?.assertions?.fileImpactHasImports === true &&
            graph?.assertions?.fileImpactHasCallees === true &&
            graph?.assertions?.fileImpactHasPlanningHints === true &&
            graph?.assertions?.symbolImpactHasCallerStatus === true,
        detail: graph?.assertions || null,
    });
    checks.push({
        name: 'graph_latency_budget',
        ok: maxElapsed(calls) <= budgetsMs.graphCall,
        detail: { maxElapsedMs: maxElapsed(calls), budgetMs: budgetsMs.graphCall },
    });
}

if (recommendChecks) {
    const calls = Array.isArray(recommendChecks.calls) ? recommendChecks.calls : [];
    checks.push({ name: 'recommend_checks_dogfood_ok', ok: recommendChecks.ok === true, detail: { schema: recommendChecks.schema } });
    checks.push({
        name: 'recommend_checks_cases_present',
        ok:
            recommendChecks?.assertions?.docsOnlyMinimumNoop === true &&
            recommendChecks?.assertions?.tsSourceTypecheck === true &&
            recommendChecks?.assertions?.testFileNarrowTest === true &&
            recommendChecks?.assertions?.graphImpactBroaderRationale === true &&
            recommendChecks?.assertions?.patchChecksThreadRecommendations === true &&
            recommendChecks?.assertions?.patchChecksValidationPlanPresent === true,
        detail: recommendChecks?.assertions || null,
    });
    checks.push({
        name: 'recommend_checks_latency_budget',
        ok: maxElapsed(calls) <= budgetsMs.recommendChecksCall,
        detail: { maxElapsedMs: maxElapsed(calls), budgetMs: budgetsMs.recommendChecksCall },
    });
}

if (validationPlanComparison) {
    checks.push({
        name: 'validation_plan_comparison_ok',
        ok: validationPlanComparison.ok === true && Number(validationPlanComparison.comparedPlanCount || 0) >= 2,
        detail: { schema: validationPlanComparison.schema, comparedPlanCount: validationPlanComparison.comparedPlanCount, drift: validationPlanComparison.drift || [] },
    });
}

if (safeWrite) {
    const calls = Array.isArray(safeWrite.calls) ? safeWrite.calls : [];
    const preview = calls.some((call) => call?.payload?.mode === 'preview_validate' && call?.payload?.applied === false);
    const previewRecommendations = calls.some((call) => call?.payload?.mode === 'preview_validate' && call?.payload?.checkRecommendations?.workflow === 'recommend_checks');
    const previewValidationPlan = calls.some((call) => call?.payload?.mode === 'preview_validate' && call?.payload?.validationPlan?.schema === 'semantic-code-intelligence.validation_plan.v1');
    const cleanApplyVerified = calls.some((call) => call?.payload?.applied === true && call?.payload?.verification?.appliedDiffMatchesSnapshot === true);
    const mismatchFailsClosed = calls.some((call) => call?.payload?.applied === true && call?.payload?.ok === false && call?.payload?.verification?.appliedDiffMatchesSnapshot === false);
    checks.push({ name: 'safe_write_dogfood_ok', ok: safeWrite.ok === true, detail: { schema: safeWrite.schema } });
    checks.push({ name: 'safe_write_preview_first', ok: preview });
    checks.push({ name: 'safe_write_preview_recommendations_threaded', ok: previewRecommendations });
    checks.push({ name: 'safe_write_preview_validation_plan', ok: previewValidationPlan });
    checks.push({ name: 'safe_write_exact_apply_verified', ok: cleanApplyVerified });
    checks.push({ name: 'safe_write_mismatch_fails_closed', ok: mismatchFailsClosed });
    checks.push({
        name: 'safe_write_latency_budget',
        ok: maxElapsed(calls) <= budgetsMs.safeWriteCall,
        detail: { maxElapsedMs: maxElapsed(calls), budgetMs: budgetsMs.safeWriteCall },
    });
}

const ok = checks.length > 0 && checks.every((check) => check.ok);
const report = {
    schema: 'semantic-code-intelligence.alpha_evidence_check.v1',
    ok,
    budgetsMs,
    checks,
    interpretation: {
        proves: [
            'Generated dogfood evidence preserves the documented Alpha MVP safety posture.',
            'SCI-first discovery, graph impact summaries, impact-aware check recommendations, validationPlan summaries and comparison, preview-first patching, exact safe_write verification, and bounded latency remain present.',
        ],
        does_not_prove: ['Production readiness.', 'Comprehensive performance characterization.'],
    },
};

console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;
