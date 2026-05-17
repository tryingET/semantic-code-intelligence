#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

const files = {
    alpha: '.test-results/alpha-mvp-dogfood.json',
    selfHosted: '.test-results/self-hosted-cli-dogfood.json',
    structural: '.test-results/structural-workflow-dogfood.json',
    safeWrite: '.test-results/safe-write-dogfood.json',
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
const safeWrite = loaded.safeWrite.ok ? loaded.safeWrite.value : null;
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
        safeWrite?.ok === true &&
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
    previewFirstMutation: {
        structuralOk: structural?.ok === true,
        structuralCalls: summarizeCalls(Array.isArray(structural?.calls) ? structural.calls : []),
        safeWritePreviewPresent: !!preview,
        safeWriteFixtureCleanAfterRollback: safeWrite?.assertions?.fixtureCleanAfterRollback === true,
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
        'bun run safe-write:dogfood',
        'bun run alpha:evidence:check',
        'bun run alpha:evidence:packet',
        './scripts/migration-hygiene.sh',
    ],
    operatorSummary: {
        proves: [
            'SCI exposes the Alpha MVP tool surface across tested interfaces.',
            'Self-hosted maintenance starts with SCI discovery/navigation evidence.',
            'Patch planning remains preview-first by default.',
            'safe_write has clean apply exact-diff verification and dirty mismatch fail-closed evidence.',
            'Generated dogfood evidence passes the lightweight Alpha evidence gate.',
        ],
        doesNotProve: [
            'Production readiness.',
            'Comprehensive performance characterization.',
            'Rich semantic graph behavior beyond current tested fallback/structural shapes.',
            'A durable long-lived session database beyond narrow snapshot artifacts and generated evidence files.',
        ],
        nextRecommendedWave: 'Richer graph/impact evidence for harnessed LLM change planning.',
    },
    loadErrors: Object.fromEntries(
        Object.entries(loaded)
            .filter(([, result]) => !result.ok)
            .map(([key, result]: [string, any]) => [key, result.error])
    ),
};

console.log(JSON.stringify(packet, null, 2));
if (!packet.ok) process.exitCode = 1;
