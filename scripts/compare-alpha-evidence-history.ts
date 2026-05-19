#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outputPath = '.test-results/alpha-evidence-history.json';
const baselinePath = 'docs/project/alpha-evidence-latency-baseline.json';

const evidenceFiles = {
    alpha: '.test-results/alpha-mvp-dogfood.json',
    selfHosted: '.test-results/self-hosted-cli-dogfood.json',
    structural: '.test-results/structural-workflow-dogfood.json',
    graph: '.test-results/graph-impact-dogfood.json',
    recommendChecks: '.test-results/recommend-checks-dogfood.json',
    safeWrite: '.test-results/safe-write-dogfood.json',
    gate: '.test-results/alpha-evidence-check.json',
};

const fallbackBudgetsMs: Record<string, number> = {
    alpha: 15_000,
    selfHosted: 15_000,
    structural: 20_000,
    graph: 15_000,
    recommendChecks: 15_000,
    safeWrite: 15_000,
};

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function maxElapsed(calls: any[]): number {
    return Math.max(0, ...calls.map((call) => Number(call?.elapsedMs || 0)).filter((value) => Number.isFinite(value)));
}

function callsFor(key: string, evidence: any): any[] {
    if (key === 'alpha') return Array.isArray(evidence?.summary) ? evidence.summary : [];
    return Array.isArray(evidence?.calls) ? evidence.calls : [];
}

function budgetFor(key: string, gate: any): number {
    const budgets = gate?.budgetsMs || {};
    const budgetKey = `${key}Call`;
    return Number(budgets[budgetKey] || fallbackBudgetsMs[key] || 0);
}

function classify(currentMs: number, baselineMs: number, budgetMs: number): string {
    if (budgetMs > 0 && currentMs > budgetMs) return 'over_budget';
    if (baselineMs <= 0) return 'no_baseline';
    const ratio = currentMs / baselineMs;
    const delta = currentMs - baselineMs;
    if (ratio >= 1.5 && delta >= 500) return 'slower_than_baseline';
    if (ratio <= 0.75 && -delta >= 500) return 'faster_than_baseline';
    return 'within_noise_band';
}

const baseline = readJson(baselinePath);
const gate = readJson(evidenceFiles.gate);

const comparisons = Object.entries(evidenceFiles)
    .filter(([key]) => key !== 'gate')
    .map(([key, path]) => {
        const evidence = readJson(path);
        const currentMaxElapsedMs = maxElapsed(callsFor(key, evidence));
        const baselineMaxElapsedMs = Number(baseline?.baselines?.[key]?.maxElapsedMs || 0);
        const budgetMs = budgetFor(key, gate);
        const deltaMs = currentMaxElapsedMs - baselineMaxElapsedMs;
        const ratio = baselineMaxElapsedMs > 0 ? Number((currentMaxElapsedMs / baselineMaxElapsedMs).toFixed(3)) : null;
        const status = classify(currentMaxElapsedMs, baselineMaxElapsedMs, budgetMs);
        return {
            key,
            sourceFile: path,
            currentMaxElapsedMs,
            baselineMaxElapsedMs,
            deltaMs,
            ratio,
            budgetMs,
            status,
            ok: status !== 'over_budget',
        };
    });

const warnings = comparisons.filter((item) => item.status === 'slower_than_baseline');
const overBudget = comparisons.filter((item) => item.status === 'over_budget');

const report = {
    schema: 'semantic-code-intelligence.alpha_evidence_history.v1',
    generatedAt: new Date().toISOString(),
    ok: overBudget.length === 0,
    baseline: {
        path: baselinePath,
        label: baseline.label || null,
        capturedAt: baseline.capturedAt || null,
        commit: baseline.commit || null,
        note: baseline.note || null,
    },
    comparisonPolicy: {
        baselineWarning: 'Warn when current max elapsed time is at least 1.5x baseline and at least 500ms slower.',
        failureCondition: 'Fail only when current generated evidence exceeds the existing Alpha evidence budget.',
        rationale: 'Historical elapsed-time comparison is a lightweight regression signal; coarse budgets remain the fail-closed gate to avoid noisy production-SLO claims.',
    },
    comparisons,
    warnings,
    overBudget,
    operatorSummary: {
        status: overBudget.length > 0 ? 'elapsed_time_over_budget' : warnings.length > 0 ? 'historical_latency_warning' : 'historical_latency_within_alpha_bounds',
        summary:
            overBudget.length > 0
                ? `${overBudget.length} evidence class(es) exceeded the Alpha budget.`
                : warnings.length > 0
                  ? `${warnings.length} evidence class(es) are materially slower than the baseline but remain within Alpha budgets.`
                  : 'Current generated evidence remains within Alpha budgets and historical noise bands.',
        remediationHints: [
            'If a warning repeats, classify whether the delay is startup, search breadth, graph expansion, structural matching, or external check execution.',
            'Narrow paths, limits, or selected commands before increasing budgets.',
            'Refresh the baseline only after an intentional performance-affecting change is reviewed and documented.',
        ],
    },
    interpretation: {
        proves: [
            'Current generated Alpha evidence can be compared against an explicit elapsed-time baseline.',
            'Historical comparison distinguishes warning-level latency drift from existing coarse Alpha budget failure.',
        ],
        does_not_prove: [
            'Production p95/p99 latency SLOs.',
            'Machine-independent benchmark stability.',
            'Long-term metrics storage or dashboard-grade performance trend analysis.',
        ],
    },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, process.argv.includes('--pretty') ? 2 : 0));
if (!report.ok) process.exitCode = 1;
