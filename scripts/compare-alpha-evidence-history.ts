#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, join } from 'node:path';
import { readEvidenceJsonFile, redactString, sanitizeEvidence, safeEvidenceError, writeTextFileNoSymlink } from './evidence-summary-utils';

process.on('uncaughtException', (error) => {
    console.error(`alpha-evidence-history: ${safeEvidenceError(error)}`);
    process.exit(1);
});

const evidenceRoot = process.env.SCI_ALPHA_EVIDENCE_ROOT || '.test-results';
const outputPath = join(evidenceRoot, 'alpha-evidence-history.json');
const baselinePath = process.env.SCI_ALPHA_EVIDENCE_BASELINE || 'docs/project/alpha-evidence-latency-baseline.json';

const evidenceFiles = {
    alpha: join(evidenceRoot, 'alpha-mvp-dogfood.json'),
    selfHosted: join(evidenceRoot, 'self-hosted-cli-dogfood.json'),
    structural: join(evidenceRoot, 'structural-workflow-dogfood.json'),
    graph: join(evidenceRoot, 'graph-impact-dogfood.json'),
    recommendChecks: join(evidenceRoot, 'recommend-checks-dogfood.json'),
    safeWrite: join(evidenceRoot, 'safe-write-dogfood.json'),
    gate: join(evidenceRoot, 'alpha-evidence-check.json'),
};

const fallbackBudgetsMs: Record<string, number> = {
    alpha: 15_000,
    selfHosted: 15_000,
    structural: 20_000,
    graph: 15_000,
    recommendChecks: 15_000,
    safeWrite: 15_000,
};

type CommandReceiptSummary = {
    count: number;
    totalElapsedMs: number;
    slowest: {
        command: string;
        elapsedMs: number;
        ok?: boolean;
        exitCode?: number;
        timedOut?: boolean;
    };
};

type SlowestCall = {
    index: number;
    name: string;
    elapsedMs: number;
    observation?: string;
    commandReceiptSummary?: CommandReceiptSummary;
} | null;

function readJson(path: string): any {
    try {
        return readEvidenceJsonFile(path);
    } catch (error) {
        throw new Error(safeEvidenceError(error));
    }
}

function displayPath(path: string): string {
    const raw = String(path || '');
    if (!raw) return '';
    if (!isAbsolute(raw)) return redactString(raw);
    const workspaceRelative = relative(process.cwd(), raw);
    if (workspaceRelative && !workspaceRelative.startsWith('..') && !isAbsolute(workspaceRelative)) {
        return redactString(workspaceRelative);
    }
    return `<external-path>/${basename(raw)}`;
}

function finiteElapsed(call: any): number {
    const value = Number(call?.elapsedMs || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function commandReceiptsFor(call: any): any[] {
    const candidates = [
        call?.sample?.result?.commands,
        call?.sample?.payload?.checks?.commands,
        call?.sample?.payload?.validationPlan?.checks?.commands,
        call?.payload?.checks?.commands,
        call?.payload?.validationPlan?.checks?.commands,
    ];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        const receipts = candidate.filter((receipt) => receipt && typeof receipt === 'object');
        if (receipts.length > 0) return receipts;
    }
    return [];
}

function commandReceiptSummary(call: any): CommandReceiptSummary | undefined {
    const receipts = commandReceiptsFor(call);
    let slowest: any = null;
    for (const receipt of receipts) {
        if (!slowest || finiteElapsed(receipt) > finiteElapsed(slowest)) slowest = receipt;
    }
    if (!slowest) return undefined;
    const exitCode = Number(slowest?.exitCode);
    return {
        count: receipts.length,
        totalElapsedMs: receipts.reduce((sum, receipt) => sum + finiteElapsed(receipt), 0),
        slowest: {
            command: redactString(String(slowest?.command || 'unknown')),
            elapsedMs: finiteElapsed(slowest),
            ...(typeof slowest?.ok === 'boolean' ? { ok: slowest.ok } : {}),
            ...(Number.isFinite(exitCode) ? { exitCode } : {}),
            ...(typeof slowest?.timedOut === 'boolean' ? { timedOut: slowest.timedOut } : {}),
        },
    };
}

function matchingRawCall(slowest: any, slowestIndex: number, rawCalls: any[]): any {
    const name = String(slowest?.name || '');
    const indexed = rawCalls[slowestIndex];
    if (indexed && String(indexed?.name || '') === name) return indexed;

    const sameNameAndElapsed = rawCalls.filter((call) => String(call?.name || '') === name && finiteElapsed(call) === finiteElapsed(slowest));
    if (sameNameAndElapsed.length === 1) return sameNameAndElapsed[0];

    const sameName = rawCalls.filter((call) => String(call?.name || '') === name);
    if (sameName.length === 1) return sameName[0];

    return slowest;
}

function slowestCall(calls: any[], rawCalls: any[] = calls): SlowestCall {
    let slowest: any = null;
    let slowestIndex = -1;
    calls.forEach((call, index) => {
        if (!slowest || finiteElapsed(call) > finiteElapsed(slowest)) {
            slowest = call;
            slowestIndex = index;
        }
    });
    if (!slowest) return null;
    const observation = typeof slowest?.observation === 'string' ? redactString(slowest.observation) : undefined;
    const commandSummary = commandReceiptSummary(matchingRawCall(slowest, slowestIndex, rawCalls));
    return {
        index: slowestIndex,
        name: String(slowest?.name || 'unknown'),
        elapsedMs: finiteElapsed(slowest),
        ...(observation ? { observation } : {}),
        ...(commandSummary ? { commandReceiptSummary: commandSummary } : {}),
    };
}

function maxElapsed(calls: any[]): number {
    return slowestCall(calls)?.elapsedMs || 0;
}

function callsFor(key: string, evidence: any): any[] {
    if (key === 'alpha') return Array.isArray(evidence?.summary) ? evidence.summary : [];
    return Array.isArray(evidence?.calls) ? evidence.calls : [];
}

function rawCallsFor(evidence: any, fallbackCalls: any[]): any[] {
    return Array.isArray(evidence?.calls) ? evidence.calls : fallbackCalls;
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

function latencyAttributionFor(call: SlowestCall, baselineMs: number, budgetMs: number): Record<string, unknown> {
    const totalElapsedMs = call?.elapsedMs || 0;
    const commandElapsedMs = call?.commandReceiptSummary?.totalElapsedMs || 0;
    if (!commandElapsedMs || commandElapsedMs <= 0) {
        return {
            kind: 'tool_or_snapshot_runtime',
            totalElapsedMs,
            selectedCommandElapsedMs: 0,
            toolOverheadElapsedMs: totalElapsedMs,
            commandRuntimeShare: 0,
            evidenceConsistent: true,
            overheadStatus: classify(totalElapsedMs, baselineMs, budgetMs),
        };
    }
    const evidenceConsistent = commandElapsedMs <= totalElapsedMs;
    const toolOverheadElapsedMs = evidenceConsistent ? Math.max(0, totalElapsedMs - commandElapsedMs) : totalElapsedMs;
    const commandRuntimeShare = totalElapsedMs > 0 ? Number((commandElapsedMs / totalElapsedMs).toFixed(3)) : 0;
    return {
        kind: evidenceConsistent ? 'selected_command_runtime' : 'inconsistent_selected_command_runtime',
        totalElapsedMs,
        selectedCommandElapsedMs: commandElapsedMs,
        toolOverheadElapsedMs,
        commandRuntimeShare,
        evidenceConsistent,
        overheadStatus: classify(toolOverheadElapsedMs, baselineMs, budgetMs),
    };
}

function calibrateStatus(status: string, attribution: Record<string, unknown>): string {
    if (status !== 'slower_than_baseline') return status;
    if (attribution.kind !== 'selected_command_runtime') return status;
    if (attribution.evidenceConsistent !== true) return status;
    if (attribution.overheadStatus === 'slower_than_baseline') return status;
    if (typeof attribution.commandRuntimeShare !== 'number' || attribution.commandRuntimeShare < 0.5) return status;
    return 'within_noise_band_command_dominated';
}

function likelyLatencyArea(call: SlowestCall): string {
    const name = call?.name || '';
    if (!name) return 'unknown';
    if (name.startsWith('cli:')) return 'cli_startup_or_workflow';
    if (/recommend_checks/i.test(name)) return 'check_recommendation';
    if (/run_checks|safe_write|patch_checks|structural_patch_checks/i.test(name)) return 'validation_or_snapshot_checks';
    if (/snapshot|propose_patch|patch/i.test(name)) return 'snapshot_or_patch_planning';
    if (/structural|ast_query/i.test(name)) return 'structural_analysis';
    if (/text_search|symbol_search|search/i.test(name)) return 'search';
    if (/find_definition|find_references|definition|reference/i.test(name)) return 'navigation_resolution';
    if (/graph/i.test(name)) return 'graph_expansion';
    if (/read_file/i.test(name)) return 'bounded_file_read';
    return 'unknown';
}

function remediationFor(area: string, call: SlowestCall): string {
    const name = call?.name || 'unknown';
    switch (area) {
        case 'cli_startup_or_workflow':
            return `Slowest call is ${name}; inspect CLI startup/process cost before treating tool logic as slow.`;
        case 'search':
            return `Slowest call is ${name}; inspect search breadth, path hints, result caps, and ignore handling before raising budgets.`;
        case 'navigation_resolution':
            return `Slowest call is ${name}; inspect symbol/definition/reference fallback path and file hints before raising budgets.`;
        case 'graph_expansion':
            return `Slowest call is ${name}; inspect graph edge request breadth, fallback provenance, and caller-context expansion.`;
        case 'structural_analysis':
            return `Slowest call is ${name}; inspect AST/ast-grep path scope, pattern complexity, and timeout caps.`;
        case 'check_recommendation':
            return `Slowest call is ${name}; inspect touched-file scope, patch size, and graph-impact summary size before treating external checks as slow.`;
        case 'validation_or_snapshot_checks':
            return `Slowest call is ${name}; inspect selected commands, snapshot materialization, and external check execution.`;
        case 'snapshot_or_patch_planning':
            return `Slowest call is ${name}; inspect snapshot creation/materialization and patch size before raising budgets.`;
        case 'bounded_file_read':
            return `Slowest call is ${name}; inspect file size/range and path containment overhead.`;
        default:
            return `Slowest call is ${name}; classify startup, search, graph, structural matching, or external command cost before raising budgets.`;
    }
}

const baseline = readJson(baselinePath);
const gate = readJson(evidenceFiles.gate);

const comparisons = Object.entries(evidenceFiles)
    .filter(([key]) => key !== 'gate')
    .map(([key, path]) => {
        const evidence = readJson(path);
        const calls = callsFor(key, evidence);
        const rawCalls = rawCallsFor(evidence, calls);
        const slowest = slowestCall(calls, rawCalls);
        const currentMaxElapsedMs = maxElapsed(calls);
        const baselineMaxElapsedMs = Number(baseline?.baselines?.[key]?.maxElapsedMs || 0);
        const budgetMs = budgetFor(key, gate);
        const deltaMs = currentMaxElapsedMs - baselineMaxElapsedMs;
        const ratio = baselineMaxElapsedMs > 0 ? Number((currentMaxElapsedMs / baselineMaxElapsedMs).toFixed(3)) : null;
        const rawStatus = classify(currentMaxElapsedMs, baselineMaxElapsedMs, budgetMs);
        const latencyAttribution = latencyAttributionFor(slowest, baselineMaxElapsedMs, budgetMs);
        const status = calibrateStatus(rawStatus, latencyAttribution);
        const likelyArea = likelyLatencyArea(slowest);
        return {
            key,
            sourceFile: displayPath(path),
            currentMaxElapsedMs,
            baselineMaxElapsedMs,
            deltaMs,
            ratio,
            budgetMs,
            status,
            rawStatus,
            ok: status !== 'over_budget',
            slowestCall: slowest,
            latencyAttribution,
            likelyArea,
            remediationHint: remediationFor(likelyArea, slowest),
        };
    });

const warnings = comparisons.filter((item) => item.status === 'slower_than_baseline');
const overBudget = comparisons.filter((item) => item.status === 'over_budget');
function warningDetailFor(item: any) {
    return {
        key: item.key,
        status: item.status,
        call: item.slowestCall?.name || 'unknown',
        callIndex: Number.isFinite(item.slowestCall?.index) ? item.slowestCall.index : null,
        elapsedMs: item.slowestCall?.elapsedMs || item.currentMaxElapsedMs,
        ...(item.slowestCall?.commandReceiptSummary ? { commandReceiptSummary: item.slowestCall.commandReceiptSummary } : {}),
        likelyArea: item.likelyArea,
        remediationHint: item.remediationHint,
    };
}
const warningDetails = [...overBudget, ...warnings].map(warningDetailFor);

const report = {
    schema: 'semantic-code-intelligence.alpha_evidence_history.v1',
    generatedAt: new Date().toISOString(),
    ok: overBudget.length === 0,
    baseline: {
        path: displayPath(baselinePath),
        label: sanitizeEvidence(baseline.label || null),
        capturedAt: sanitizeEvidence(baseline.capturedAt || null),
        commit: sanitizeEvidence(baseline.commit || null),
        note: sanitizeEvidence(baseline.note || null),
    },
    comparisonPolicy: {
        baselineWarning: 'Warn when current max elapsed time is at least 1.5x baseline and at least 500ms slower, except selected-command-dominated drift is reported as attribution when residual SCI/tool overhead remains within the noise band.',
        failureCondition: 'Fail only when current generated evidence exceeds the existing Alpha evidence budget; selected-command attribution never suppresses over-budget failure.',
        rationale: 'Historical elapsed-time comparison is a lightweight regression signal; coarse budgets remain the fail-closed gate to avoid noisy production-SLO claims, and selected command runtime must not be mistaken for SCI tool overhead.',
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
        warningDetails,
        remediationHints: [
            ...warningDetails.map((item) => item.remediationHint),
            'Refresh the baseline only after an intentional performance-affecting change is reviewed and documented.',
        ],
    },
    interpretation: {
        proves: [
            'Current generated Alpha evidence can be compared against an explicit elapsed-time baseline.',
            'Historical comparison distinguishes warning-level latency drift from existing coarse Alpha budget failure.',
            'Selected-command runtime is attributed separately from residual SCI/tool overhead when command receipts are available.',
            'Warning diagnostics identify the slowest observed call and likely latency area for triage.',
        ],
        does_not_prove: [
            'Production p95/p99 latency SLOs.',
            'Machine-independent benchmark stability.',
            'Long-term metrics storage or dashboard-grade performance trend analysis.',
        ],
    },
};

const outputReport = sanitizeEvidence(report);
mkdirSync(dirname(outputPath), { recursive: true });
writeTextFileNoSymlink(outputPath, `${JSON.stringify(outputReport, null, 2)}\n`);
console.log(JSON.stringify(outputReport, null, process.argv.includes('--pretty') ? 2 : 0));
if (!report.ok) process.exitCode = 1;
