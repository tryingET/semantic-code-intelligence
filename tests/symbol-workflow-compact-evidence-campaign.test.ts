import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SymbolWorkflowService, type SymbolWorkflowDeps } from '../src/core/workflows/symbol-workflow.js';

const ROOT = process.cwd();
const CAMPAIGN = 'fixtures/symbol-impact-structural/campaign';
const CAMPAIGN_ROOT = join(ROOT, CAMPAIGN);
const OUTPUT_ROOT = join(ROOT, '.test-results/symbol-impact-compact-campaign');
const SIGNALS = ['publicApi', 'state', 'registry', 'tests'] as const;
const MODES = ['compact', 'standard', 'debug'] as const;

type Mode = (typeof MODES)[number];
type Signal = (typeof SIGNALS)[number];
type Case = {
    id: string;
    language: string;
    symbolKind: string;
    symbol: string;
    definitionPaths: string[];
    exported: boolean;
    fanout: number;
    resolution: 'confirmed' | 'unconfirmed' | 'indeterminate';
    parserPosture: 'supported' | 'unsupported' | 'not_run';
    degraded?: 'all' | 'graph';
    symbolOnly?: boolean;
    expectNamingFallback?: boolean;
    expectedSignals: Record<Signal, 'detected' | 'unknown'> | null;
};
type Manifest = {
    schema: string;
    claimBoundary: string;
    acceptance: Record<string, number>;
    cases: Case[];
};
type Freeze = {
    schema: string;
    aggregateSha256: string;
    files: Array<{ path: string; bytes: number; sha256: string }>;
};
type CampaignRun = {
    raw: Array<{ caseId: string; mode: Mode; payload: Record<string, any> }>;
    measurements: any[];
    counters: Record<string, number>;
};

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function bytewiseSort(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function corpusFiles(path: string): string[] {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
        const child = `${path}/${entry.name}`;
        return entry.isDirectory() ? corpusFiles(child) : [child];
    });
}

function verifyFrozenInputs(): Freeze {
    const freeze = JSON.parse(readFileSync(join(CAMPAIGN_ROOT, 'freeze.json'), 'utf8')) as Freeze;
    const expectedMembership = [
        `${CAMPAIGN}/README.md`,
        `${CAMPAIGN}/manifest.json`,
        'tests/symbol-workflow-compact-evidence-campaign.test.ts',
        ...corpusFiles(`${CAMPAIGN}/corpus`),
    ].sort(bytewiseSort);
    const frozenMembership = freeze.files.map((entry) => entry.path).sort(bytewiseSort);
    if (!exactEqual(expectedMembership, frozenMembership)) throw new Error('frozen campaign file membership mismatch');
    const files = [...freeze.files].sort((a, b) => bytewiseSort(a.path, b.path)).map((expected) => {
        const content = readFileSync(join(ROOT, expected.path));
        const actual = { path: expected.path, bytes: content.byteLength, sha256: sha256(content) };
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`frozen campaign input drifted: ${expected.path}`);
        }
        return actual;
    });
    const aggregate = files.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join('\n');
    if (sha256(aggregate) !== freeze.aggregateSha256) throw new Error('frozen campaign aggregate hash mismatch');
    return freeze;
}

function readManifest(): Manifest {
    return JSON.parse(readFileSync(join(CAMPAIGN_ROOT, 'manifest.json'), 'utf8')) as Manifest;
}

function symbolLocation(symbol: string, path: string, kind: string, extra: Record<string, unknown> = {}) {
    const source = readFileSync(join(ROOT, path), 'utf8');
    const offset = source.indexOf(symbol);
    if (offset < 0) throw new Error(`frozen symbol ${symbol} is absent from ${path}`);
    const before = source.slice(0, offset);
    const line = before.split('\n').length - 1;
    const lastNewline = before.lastIndexOf('\n');
    const character = offset - lastNewline - 1;
    return {
        name: symbol,
        uri: pathToFileURL(join(ROOT, path)).href,
        range: { start: { line, character }, end: { line, character: character + symbol.length } },
        kind,
        confidence: 0.99,
        source: 'frozen_campaign',
        ...extra,
    };
}

function workflowResult(value: Record<string, unknown>, isError = false) {
    return Promise.resolve({ payload: value, isError });
}

function referencePaths(probe: Case): string[] {
    const fanoutPaths = Array.from({ length: 16 }, (_, index) =>
        `${CAMPAIGN}/corpus/fanout/ref-${String(index).padStart(2, '0')}.ts`
    );
    if (probe.fanout <= 0) return [];
    if (probe.definitionPaths.length === 0) return fanoutPaths.slice(0, probe.fanout);
    const definitionReferences = probe.definitionPaths.slice(0, probe.fanout);
    return [
        ...definitionReferences,
        ...fanoutPaths.slice(0, Math.max(0, probe.fanout - definitionReferences.length)),
    ];
}

function depsFor(probe: Case): SymbolWorkflowDeps {
    const definitions = probe.definitionPaths.map((path) => symbolLocation(probe.symbol, path, probe.symbolKind));
    const referencePathList = referencePaths(probe);
    const references = referencePathList.map((path) =>
        symbolLocation(probe.symbol, path, 'usage', { caller: `caller_${probe.id}` })
    );
    const exports = probe.exported
        ? probe.definitionPaths.map((path) => ({
              file: path,
              text: probe.symbol,
              capture: 'export.symbol',
              source: 'frozen_graph',
          }))
        : [];
    const callers = referencePathList.map((path) => ({
        file: path,
        caller: `caller_${probe.id}`,
        source: 'frozen_graph',
    }));
    return {
        workspaceRoot: () => ROOT,
        findDefinition: () => {
            if (probe.degraded === 'all') throw new Error('frozen find-definition failure');
            return workflowResult({ backend: 'frozen_definition', definitions, provenance: { corpus: probe.id } });
        },
        buildSymbolMap: () => {
            if (probe.degraded === 'all') throw new Error('frozen symbol-map failure');
            return workflowResult({
                backend: 'frozen_symbol_map',
                identifier: probe.symbol,
                declarations: definitions,
                references,
                provenance: { corpus: probe.id },
            });
        },
        graphExpand: () => {
            if (probe.degraded === 'all' || probe.degraded === 'graph') {
                throw new Error('frozen graph failure');
            }
            const unsupported = probe.language.includes('unsupported') || probe.language.includes('unknown-extension');
            return workflowResult({
                backend: unsupported ? 'fallback' : 'frozen_graph',
                fallback: unsupported,
                neighbors: { exports, callers, imports: [], callees: [] },
                impactSummary: {
                    hasImpactEvidence: exports.length > 0 || callers.length > 0,
                    limitations: unsupported ? ['Unsupported language graph evidence remains unknown.'] : [],
                    provenance: { corpus: probe.id },
                },
            });
        },
        safeRename: () => workflowResult({}),
        patchChecksInSnapshot: () => workflowResult({}),
        applySnapshot: () => workflowResult({}),
    };
}

function payload(result: any): Record<string, any> {
    return (result?.payload || result) as Record<string, any>;
}

function recursiveItemCount(value: unknown): number {
    if (Array.isArray(value)) return value.length + value.reduce((sum, item) => sum + recursiveItemCount(item), 0);
    if (!value || typeof value !== 'object') return 0;
    return Object.values(value).reduce((sum, item) => sum + recursiveItemCount(item), 0);
}

function recursiveTruncationMarkers(value: unknown): number {
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + recursiveTruncationMarkers(item), 0);
    if (!value || typeof value !== 'object') return 0;
    return Object.entries(value).reduce(
        (sum, [key, item]) =>
            sum +
            Number((key === 'truncated' || key === 'byteTruncated') && item === true) +
            recursiveTruncationMarkers(item),
        0
    );
}

function disclosureOmissions(value: Record<string, any>): number {
    const disclosure = value.details && typeof value.details === 'object' ? value.details.disclosure : null;
    return Number(disclosure?.omittedItems || 0) + Number(disclosure?.omittedRawFragments || 0);
}

function decisionFactEntries(value: Record<string, any>): Array<[string, unknown]> {
    return [
        ['schemaVersion', value.schemaVersion],
        ['workflow', value.workflow],
        ['ok', value.ok],
        ['symbol', value.symbol],
        ['status', value.status],
        ['degraded', value.degraded],
        ['message', value.message],
        ['evidence', value.evidence],
        ['definition', value.definition],
        ['definitions', value.definitions],
        ['impact', value.impact],
        ['editRisk.level', value.editRisk?.level],
        ['editRisk.reasons', value.editRisk?.reasons],
        ['editRisk.analysis', value.editRisk?.analysis],
        ['limitations', value.limitations],
    ].filter(([, item]) => item !== undefined) as Array<[string, unknown]>;
}

function exactEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function nearestRank(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)] ?? 0;
}

function percent(numerator: number, denominator: number): number {
    return denominator === 0 ? 100 : (100 * numerator) / denominator;
}

function rounded(value: number): number {
    return Number(value.toFixed(6));
}

function expectedDefinitionLine(probe: Case): number | null {
    if (probe.definitionPaths.length === 0) return null;
    return symbolLocation(probe.symbol, probe.definitionPaths[0], probe.symbolKind).range.start.line + 1;
}

function oracleFailures(probe: Case, compact: Record<string, any>): number {
    let failures = 0;
    const expectedOk = probe.resolution === 'confirmed';
    failures += Number(compact.status !== probe.resolution);
    failures += Number(compact.ok !== expectedOk);
    failures += Number(compact.degraded !== Boolean(probe.degraded));
    if (expectedOk) {
        failures += Number(compact.definitions?.count !== probe.definitionPaths.length);
        failures += Number(!probe.definitionPaths.includes(compact.definition?.path));
        failures += Number(compact.definition?.line !== expectedDefinitionLine(probe));
        failures += Number(compact.nextReads?.[0]?.path !== compact.definition?.path);
        for (const nextRead of compact.nextReads || []) {
            failures += Number(!existsSync(join(ROOT, nextRead.path)));
            failures += Number(!(compact.impact?.files || []).some((item: any) => item.path === nextRead.path));
        }
        if (probe.fanout > 8) failures += Number(compact.impact?.truncated !== true);
        if (probe.definitionPaths.length > 1) {
            failures += Number(
                !probe.definitionPaths.every((path) =>
                    compact.impact?.files?.some((item: any) => item.path === path)
                )
            );
        }
        const structural = compact.editRisk?.analysis?.structural;
        if (probe.parserPosture === 'supported') {
            failures += Number(!(structural?.analyzedFiles >= 1));
            failures += Number(structural?.failedFiles !== 0);
            failures += Number(structural?.oversizedFiles !== 0);
        } else if (probe.parserPosture === 'unsupported') {
            failures += Number(structural?.analyzedFiles !== 0);
            failures += Number(!(structural?.failedFiles >= 1));
            failures += Number(
                !structural?.limitations?.includes(
                    'Structural source analysis failed for one or more files; affected signals remain unknown.'
                )
            );
        } else {
            failures++;
        }
    } else {
        failures += Number(probe.parserPosture !== 'not_run');
        failures += Number(compact.definition !== undefined);
        failures += Number(compact.editRisk !== undefined);
        failures += Number(compact.nextReads?.[0]?.action !== 'locate_confirm_definition');
    }
    if (probe.expectNamingFallback) {
        for (const signal of SIGNALS) failures += Number(compact.editRisk?.signals?.[signal]?.namingFallback?.observed !== true);
    }
    return failures;
}

async function withDeterministicClock<T>(callback: () => Promise<T>): Promise<T> {
    const originalNow = performance.now;
    let clock = 0;
    performance.now = () => (clock += 0.25);
    try {
        return await callback();
    } finally {
        performance.now = originalNow;
    }
}

async function executeOnce(manifest: Manifest): Promise<CampaignRun> {
    return withDeterministicClock(async () => {
        const raw: CampaignRun['raw'] = [];
        const measurements: any[] = [];
        const counters = {
            factRetained: 0,
            factCompared: 0,
            riskRetained: 0,
            riskCompared: 0,
            nextReadRetained: 0,
            nextReadCompared: 0,
            falseConfirmations: 0,
            unsupportedConfidenceFailures: 0,
            expectedSignalMismatches: 0,
            resolutionMismatches: 0,
            oracleFailures: 0,
        };

        for (const probe of manifest.cases) {
            const outputs = {} as Record<Mode, Record<string, any>>;
            for (const mode of MODES) {
                outputs[mode] = payload(
                    await new SymbolWorkflowService(depsFor(probe)).exploreSymbol({
                        symbol: probe.symbol,
                        ...(probe.symbolOnly || probe.definitionPaths.length === 0 ? {} : { file: probe.definitionPaths[0] }),
                        mode,
                        maxFiles: 8,
                        maxNextReads: 4,
                        maxLimitations: 10,
                        depth: 1,
                        limit: 50,
                    })
                );
                raw.push({ caseId: probe.id, mode, payload: outputs[mode] });
            }

            const modeMeasurements = Object.fromEntries(
                MODES.map((mode) => {
                    const json = JSON.stringify(outputs[mode]);
                    return [mode, {
                        bytes: Buffer.byteLength(json, 'utf8'),
                        sha256: sha256(json),
                        items: recursiveItemCount(outputs[mode]),
                        truncationMarkers: recursiveTruncationMarkers(outputs[mode]),
                        disclosureOmissions: disclosureOmissions(outputs[mode]),
                    }];
                })
            ) as Record<Mode, { bytes: number; sha256: string; items: number; truncationMarkers: number; disclosureOmissions: number }>;

            for (const comparisonMode of ['standard', 'debug'] as const) {
                const compactFacts = new Map(decisionFactEntries(outputs.compact));
                const comparisonFacts = decisionFactEntries(outputs[comparisonMode]);
                for (const [name, comparisonValue] of comparisonFacts) {
                    counters.factCompared++;
                    counters.factRetained += Number(exactEqual(compactFacts.get(name), comparisonValue));
                }
                counters.nextReadCompared++;
                counters.nextReadRetained += Number(exactEqual(outputs.compact.nextReads, outputs[comparisonMode].nextReads));
                if (probe.expectedSignals) {
                    for (const signal of SIGNALS) {
                        counters.riskCompared++;
                        counters.riskRetained += Number(
                            exactEqual(outputs.compact.editRisk?.signals?.[signal], outputs[comparisonMode].editRisk?.signals?.[signal])
                        );
                    }
                }
            }

            counters.resolutionMismatches += Number(outputs.compact.status !== probe.resolution);
            if (probe.resolution !== 'confirmed') {
                counters.falseConfirmations += Number(outputs.compact.ok === true || outputs.compact.status === 'confirmed');
            }
            if (probe.expectedSignals) {
                for (const signal of SIGNALS) {
                    const actual = outputs.compact.editRisk?.signals?.[signal];
                    const expected = probe.expectedSignals[signal];
                    if (expected === 'unknown') {
                        counters.unsupportedConfidenceFailures += Number(
                            actual?.detected !== false || actual?.status !== 'unknown' || actual?.confidence !== 'unknown'
                        );
                        counters.expectedSignalMismatches += Number(actual?.status !== 'unknown');
                    } else {
                        const validDetection =
                            actual?.status === 'detected' &&
                            actual?.detected === true &&
                            ['high', 'medium'].includes(actual?.confidence) &&
                            Array.isArray(actual?.files) &&
                            actual.files.length > 0 &&
                            actual.files.every(
                                (path: string) =>
                                    existsSync(join(ROOT, path)) &&
                                    outputs.compact.impact?.files?.some((item: any) => item.path === path)
                            ) &&
                            Array.isArray(actual?.reasons) &&
                            actual.reasons.length > 0 &&
                            Array.isArray(actual?.provenance) &&
                            actual.provenance.length > 0;
                        counters.expectedSignalMismatches += Number(!validDetection);
                    }
                }
            }
            counters.oracleFailures += oracleFailures(probe, outputs.compact);

            measurements.push({
                caseId: probe.id,
                language: probe.language,
                symbolKind: probe.symbolKind,
                resolution: probe.resolution,
                exported: probe.exported,
                fanout: probe.fanout,
                definitions: probe.definitionPaths.length,
                degraded: probe.degraded || false,
                symbolOnly: Boolean(probe.symbolOnly),
                modes: modeMeasurements,
                reductionPercent: {
                    versusStandard: rounded(
                        (100 * (modeMeasurements.standard.bytes - modeMeasurements.compact.bytes)) /
                            modeMeasurements.standard.bytes
                    ),
                    versusDebug: rounded(
                        (100 * (modeMeasurements.debug.bytes - modeMeasurements.compact.bytes)) /
                            modeMeasurements.debug.bytes
                    ),
                },
                compactStatus: outputs.compact.status,
                compactRisk: outputs.compact.editRisk?.level || null,
                expectedSignals: probe.expectedSignals,
                observedSignals: probe.expectedSignals
                    ? Object.fromEntries(SIGNALS.map((signal) => [signal, outputs.compact.editRisk?.signals?.[signal]?.status]))
                    : null,
            });
        }
        return { raw, measurements, counters };
    });
}

function runIdentity(run: CampaignRun): string {
    return sha256(JSON.stringify(run));
}

describe('bounded compact-output evidence campaign', () => {
    test('measures the frozen corpus twice and writes bounded raw evidence', async () => {
        const freezeBefore = verifyFrozenInputs();
        const manifest = readManifest();
        const first = await executeOnce(manifest);
        const second = await executeOnce(manifest);
        const freezeAfter = verifyFrozenInputs();
        const repeatable = runIdentity(first) === runIdentity(second);
        const inputsUnchanged = exactEqual(freezeBefore, freezeAfter);
        const measurements = first.measurements;
        const counters = first.counters;
        const standardReductions = measurements.map((item) => item.reductionPercent.versusStandard);
        const debugReductions = measurements.map((item) => item.reductionPercent.versusDebug);
        const retentionPercent = {
            confirmedFacts: rounded(percent(counters.factRetained, counters.factCompared)),
            riskSignals: rounded(percent(counters.riskRetained, counters.riskCompared)),
            actionableNextReads: rounded(percent(counters.nextReadRetained, counters.nextReadCompared)),
        };
        const reductionPercent = {
            versusStandard: {
                p50: rounded(nearestRank(standardReductions, 0.5)),
                p90: rounded(nearestRank(standardReductions, 0.9)),
                p95: rounded(nearestRank(standardReductions, 0.95)),
                worstCase: rounded(Math.min(...standardReductions)),
            },
            versusDebug: {
                p50: rounded(nearestRank(debugReductions, 0.5)),
                p90: rounded(nearestRank(debugReductions, 0.9)),
                p95: rounded(nearestRank(debugReductions, 0.95)),
                worstCase: rounded(Math.min(...debugReductions)),
            },
        };
        const criteria: Record<string, boolean> = {
            repeatable,
            inputsUnchanged,
            medianReductionVsStandard:
                reductionPercent.versusStandard.p50 >= manifest.acceptance.medianReductionVsStandardPercent,
            medianReductionVsDebug:
                reductionPercent.versusDebug.p50 >= manifest.acceptance.medianReductionVsDebugPercent,
            confirmedFactRetention:
                retentionPercent.confirmedFacts >= manifest.acceptance.minimumConfirmedFactRetentionPercent,
            riskSignalRetention:
                retentionPercent.riskSignals >= manifest.acceptance.minimumRiskSignalRetentionPercent,
            actionableNextReadRetention:
                retentionPercent.actionableNextReads >= manifest.acceptance.minimumActionableNextReadRetentionPercent,
            falseConfirmations: counters.falseConfirmations <= manifest.acceptance.maximumFalseConfirmations,
            unsupportedConfidenceFailures:
                counters.unsupportedConfidenceFailures <= manifest.acceptance.maximumUnsupportedConfidenceFailures,
            expectedSignalMismatches:
                counters.expectedSignalMismatches <= manifest.acceptance.maximumExpectedSignalMismatches,
            resolutionMismatches: counters.resolutionMismatches <= manifest.acceptance.maximumResolutionMismatches,
            oracleFailures: counters.oracleFailures <= manifest.acceptance.maximumOracleFailures,
            packetBounds: measurements.every((item) => MODES.every((mode) => item.modes[mode].bytes <= manifest.acceptance.maximumPacketBytes)),
        };
        const accepted = Object.values(criteria).every(Boolean);
        const summary = {
            schema: 'semantic-code-intelligence.symbol-impact-compact-campaign.v1',
            claimBoundary: manifest.claimBoundary,
            corpus: {
                sha256: freezeBefore.aggregateSha256,
                fileCount: freezeBefore.files.length,
                caseCount: manifest.cases.length,
                languages: [...new Set(manifest.cases.map((item) => item.language))].sort(bytewiseSort),
                symbolKinds: [...new Set(manifest.cases.map((item) => item.symbolKind))].sort(bytewiseSort),
                files: freezeBefore.files,
            },
            procedure: {
                modelVisibleJson: 'UTF-8 bytes of JSON.stringify(producer payload); transport envelope/newline excluded',
                modeOrder: MODES,
                percentile: 'nearest-rank over ascending reductions',
                reductionFormula: '100 * (comparisonBytes - compactBytes) / comparisonBytes',
                independentRuns: 2,
                firstRunIdentity: runIdentity(first),
                secondRunIdentity: runIdentity(second),
            },
            reductionPercent,
            retentionPercent,
            failures: {
                falseConfirmations: counters.falseConfirmations,
                unsupportedConfidenceFailures: counters.unsupportedConfidenceFailures,
                expectedSignalMismatches: counters.expectedSignalMismatches,
                resolutionMismatches: counters.resolutionMismatches,
                oracleFailures: counters.oracleFailures,
            },
            verdict: { accepted, criteria },
            acceptance: manifest.acceptance,
            measurements,
        };

        const outputJsonl = `${first.raw.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
        summary.verdict.criteria.rawArtifactBounded =
            Buffer.byteLength(outputJsonl, 'utf8') <= manifest.acceptance.maximumRawArtifactBytes;
        summary.verdict.accepted = Object.values(summary.verdict.criteria).every(Boolean);
        const measurementsJson = `${JSON.stringify(summary, null, 2)}\n`;
        mkdirSync(OUTPUT_ROOT, { recursive: true });
        writeFileSync(join(OUTPUT_ROOT, 'outputs.jsonl'), outputJsonl);
        writeFileSync(join(OUTPUT_ROOT, 'measurements.json'), measurementsJson);

        const nonReductionCriteriaPassed = Object.entries(summary.verdict.criteria)
            .filter(([name]) => !name.startsWith('medianReduction'))
            .every(([, passed]) => passed);
        expect(nonReductionCriteriaPassed).toBe(true);
        expect(summary.verdict.accepted).toBe(Object.values(summary.verdict.criteria).every(Boolean));
        expect(Buffer.byteLength(measurementsJson, 'utf8')).toBeLessThan(
            manifest.acceptance.maximumRawArtifactBytes
        );
    });
});
