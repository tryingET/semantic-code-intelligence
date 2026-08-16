import { fitDisclosureDetails } from './symbol-workflow-disclosure-budget.js';
import { posix } from 'node:path';
import {
    buildSymbolImpactDebugDiagnostics,
    safeDisclosureLabel,
    safeDisclosurePath,
    sanitizeDisclosureText,
    SYMBOL_IMPACT_DISCLOSURE_BUDGETS,
    type SymbolImpactDisclosureMode,
    type SymbolImpactDisclosureSubcall,
} from './symbol-workflow-disclosure-debug.js';

export {
    sanitizeDisclosureText,
    safeDisclosureLabel,
    safeDisclosurePath,
    SYMBOL_IMPACT_DISCLOSURE_BUDGETS,
    type SymbolImpactDisclosureMode,
    type SymbolImpactDisclosureSubcall,
} from './symbol-workflow-disclosure-debug.js';
export { fitSymbolImpactPacket } from './symbol-workflow-disclosure-budget.js';

type NormalizedItem = {
    path: string;
    line?: number;
    character?: number;
    kind?: string;
    confidence?: number;
    source?: string;
    symbol?: string;
    caller?: string;
};

type EvidenceSection = {
    count: number;
    emitted: number;
    omitted: number;
    truncated: boolean;
    items: NormalizedItem[];
    shapeFailures: { invalid: number; outsideWorkspace: number };
};

type Omission = {
    section: string;
    reason: 'item_budget' | 'invalid_shape' | 'outside_workspace' | 'byte_budget';
    count: number;
};

export async function invokeSymbolImpactSubcall(
    name: SymbolImpactDisclosureSubcall['name'],
    input: Record<string, unknown>,
    call: () => Promise<any>
): Promise<SymbolImpactDisclosureSubcall> {
    const started = performance.now();
    try {
        const result = await call();
        const parsed = parseWorkflowResult(result);
        if (result?.isError) {
            return {
                name,
                input,
                value: maybeRecord(parsed) || {},
                issue: `${name}: error_result`,
                status: 'error_result',
                elapsedMs: performance.now() - started,
            };
        }
        const value = maybeRecord(parsed);
        if (!value) {
            return {
                name,
                input,
                value: {},
                issue: `${name}: unstructured_result`,
                status: 'unstructured_result',
                elapsedMs: performance.now() - started,
            };
        }
        return { name, input, value, issue: null, status: 'ok', elapsedMs: performance.now() - started };
    } catch {
        return {
            name,
            input,
            value: {},
            issue: `${name}: threw`,
            status: 'threw',
            elapsedMs: performance.now() - started,
        };
    }
}

export function buildSymbolImpactDetails(args: {
    mode: SymbolImpactDisclosureMode;
    workspaceRoot: string;
    subcalls: SymbolImpactDisclosureSubcall[];
    limitations: string[];
    totalElapsedMs?: number;
    ontologySeedElapsedMs?: number;
    byteBudget?: number;
}): Record<string, unknown> {
    const byName = new Map(args.subcalls.map((subcall) => [subcall.name, subcall]));
    const definitionCall = byName.get('find_definition');
    const symbolMapCall = byName.get('build_symbol_map');
    const graphCall = byName.get('graph_expand');
    const graphNeighbors = recordOf(graphCall?.value.neighbors);
    const sections: Record<string, EvidenceSection> = {
        definitions: normalizeSection(arrayOf(definitionCall?.value.definitions), args.workspaceRoot),
        declarations: normalizeSection(arrayOf(symbolMapCall?.value.declarations), args.workspaceRoot),
        references: normalizeSection(arrayOf(symbolMapCall?.value.references), args.workspaceRoot),
        'graph.exports': normalizeSection(arrayOf(graphNeighbors.exports), args.workspaceRoot),
        'graph.callers': normalizeSection(arrayOf(graphNeighbors.callers), args.workspaceRoot),
        'graph.imports': normalizeSection(arrayOf(graphNeighbors.imports), args.workspaceRoot),
        'graph.callees': normalizeSection(arrayOf(graphNeighbors.callees), args.workspaceRoot),
    };
    const omissions = collectOmissions(sections);
    const limitations = uniqueStrings([...args.limitations, ...args.subcalls.map((subcall) => subcall.issue || '')])
        .map((value) =>
            sanitizeDisclosureText(value, args.workspaceRoot, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.textCharacters)
        )
        .slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.limitations);
    const graphSections = {
        exports: sections['graph.exports'],
        callers: sections['graph.callers'],
        imports: sections['graph.imports'],
        callees: sections['graph.callees'],
    };
    const details: Record<string, any> = {
        schemaVersion: 1,
        mode: args.mode,
        definitions: sections.definitions,
        declarations: sections.declarations,
        references: sections.references,
        graph: {
            hasImpactEvidence: recordOf(graphCall?.value.impactSummary).hasImpactEvidence === true,
            edges: graphSections,
        },
        provenance: {
            definitionLookup: provenanceSummary(definitionCall?.value, sections.definitions),
            symbolMap: provenanceSummary(symbolMapCall?.value, sections.declarations, sections.references),
            graph: provenanceSummary(graphCall?.value, ...Object.values(graphSections)),
        },
        counts: Object.fromEntries(
            Object.entries(sections).map(([name, section]) => [
                name,
                { observed: section.count, emitted: section.emitted },
            ])
        ),
        omissions,
        limitations,
        disclosure: {
            packetByteBudget: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes,
            byteBudget: Math.min(
                args.mode === 'debug'
                    ? SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugBytes
                    : SYMBOL_IMPACT_DISCLOSURE_BUDGETS.standardBytes,
                Number.isFinite(args.byteBudget) ? Math.max(2_048, Number(args.byteBudget)) : Number.POSITIVE_INFINITY
            ),
            emittedBytes: 0,
            itemBudgetPerSection: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.itemsPerSection,
            analyzedItemBudgetPerSection: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection,
            textCharacterBudget: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.textCharacters,
            truncated: omissions.length > 0,
            byteTruncated: false,
            omittedItems: omissions.reduce((sum, omission) => sum + omission.count, 0),
            omittedRawFragments: 0,
            truncatedRawFragments: 0,
        },
    };
    if (args.mode === 'debug') {
        details.diagnostics = buildSymbolImpactDebugDiagnostics({
            subcalls: args.subcalls,
            sections,
            workspaceRoot: args.workspaceRoot,
            totalElapsedMs: args.totalElapsedMs,
            ontologySeedElapsedMs: args.ontologySeedElapsedMs,
        });
        details.disclosure.truncatedRawFragments = countTruncatedRawFragments(details.diagnostics);
        details.disclosure.truncated ||= details.disclosure.truncatedRawFragments > 0;
    }
    return fitDisclosureDetails(details);
}

function normalizeSection(items: unknown[], workspaceRoot: string): EvidenceSection {
    const normalized: NormalizedItem[] = [];
    let invalid = 0;
    let outsideWorkspace = 0;
    for (const item of items.slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection)) {
        const record = maybeRecord(item);
        if (!record) {
            invalid++;
            continue;
        }
        const pathState = normalizedPath(record, workspaceRoot);
        if (pathState.kind !== 'ok') {
            if (pathState.kind === 'outside') outsideWorkspace++;
            else invalid++;
            continue;
        }
        if (normalized.length >= SYMBOL_IMPACT_DISCLOSURE_BUDGETS.itemsPerSection) continue;
        const start = recordOf(record.range)?.start || record.start;
        const startRecord = recordOf(start);
        normalized.push({
            path: pathState.path,
            ...(Number.isFinite(startRecord.line) ? { line: Number(startRecord.line) + 1 } : {}),
            ...(Number.isFinite(startRecord.character) ? { character: Number(startRecord.character) + 1 } : {}),
            ...(safeDisclosureLabel(record.kind) ? { kind: safeDisclosureLabel(record.kind) } : {}),
            ...(Number.isFinite(record.confidence) ? { confidence: Number(record.confidence) } : {}),
            ...(safeDisclosureLabel(record.source) ? { source: safeDisclosureLabel(record.source) } : {}),
            ...(safeDisclosureLabel(record.symbol) ? { symbol: safeDisclosureLabel(record.symbol) } : {}),
            ...(safeDisclosureLabel(record.caller) ? { caller: safeDisclosureLabel(record.caller) } : {}),
        });
    }
    const omitted = Math.max(0, items.length - normalized.length);
    return {
        count: items.length,
        emitted: normalized.length,
        omitted,
        truncated: omitted > 0,
        items: normalized,
        shapeFailures: { invalid, outsideWorkspace },
    };
}

function normalizedPath(
    item: Record<string, any>,
    workspaceRoot: string
): { kind: 'ok'; path: string } | { kind: 'outside' | 'invalid' } {
    const value = [item.uri, item.file, item.path].find((candidate) => typeof candidate === 'string' && candidate);
    if (!value) return { kind: 'invalid' };
    const path = safeDisclosurePath(value, workspaceRoot);
    if (path) return { kind: 'ok', path };
    return /^(?:file:\/\/|\/|[A-Za-z]:[\\/]|\\\\)|(?:^|\/)\.\.(?:\/|$)/.test(value)
        ? { kind: 'outside' }
        : { kind: 'invalid' };
}

function provenanceSummary(value: unknown, ...sections: EvidenceSection[]): Record<string, unknown> {
    const record = recordOf(value);
    const impactSummary = maybeRecord(record.impactSummary);
    const provenance = maybeRecord(record.provenance) || maybeRecord(impactSummary?.provenance);
    const provenanceScan = boundedMetadataFields(provenance);
    const fields = uniqueStrings(
        provenanceScan.keys.map((key) => safeMetadataField(key)).filter((key): key is string => !!key)
    ).slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.provenanceFields);
    const sources = uniqueStrings(
        sections.flatMap((section) => section.items.map((item) => item.source || '')).filter(Boolean)
    ).slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.provenanceFields);
    return {
        present: provenance !== null || !!safeDisclosureLabel(record.backend) || sources.length > 0,
        ...(safeDisclosureLabel(record.backend) ? { backend: safeDisclosureLabel(record.backend) } : {}),
        sources,
        fields,
        fieldCount: provenanceScan.observed,
        fieldCountExact: !provenanceScan.analysisTruncated,
        fieldsTruncated: provenanceScan.analysisTruncated || provenanceScan.observed > fields.length,
    };
}

function collectOmissions(sections: Record<string, EvidenceSection>): Omission[] {
    const omissions: Omission[] = [];
    for (const [name, section] of Object.entries(sections)) {
        const budgetOmitted = Math.max(
            0,
            section.omitted - section.shapeFailures.invalid - section.shapeFailures.outsideWorkspace
        );
        if (budgetOmitted) omissions.push({ section: name, reason: 'item_budget', count: budgetOmitted });
        if (section.shapeFailures.invalid)
            omissions.push({ section: name, reason: 'invalid_shape', count: section.shapeFailures.invalid });
        if (section.shapeFailures.outsideWorkspace)
            omissions.push({
                section: name,
                reason: 'outside_workspace',
                count: section.shapeFailures.outsideWorkspace,
            });
    }
    return omissions;
}

function safeMetadataField(value: string): string | undefined {
    const label = safeDisclosureLabel(value);
    return label && /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/.test(label) ? label : undefined;
}

function boundedMetadataFields(value: unknown): {
    keys: string[];
    observed: number;
    analysisTruncated: boolean;
} {
    const record = maybeRecord(value);
    if (!record) return { keys: [], observed: 0, analysisTruncated: false };
    const keys: string[] = [];
    let observed = 0;
    try {
        for (const key in record) {
            if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
            observed++;
            if (keys.length < SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedMetadataFields) keys.push(key);
            else return { keys, observed, analysisTruncated: true };
        }
    } catch {
        return { keys, observed, analysisTruncated: true };
    }
    return { keys, observed, analysisTruncated: false };
}

function countTruncatedRawFragments(diagnostics: unknown): number {
    return arrayOf(recordOf(diagnostics).subcalls).reduce(
        (sum, subcall) =>
            sum +
            arrayOf(recordOf(subcall).rawFragments).filter((fragment) => recordOf(fragment).truncated === true).length,
        0
    );
}

function recordOf(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function maybeRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

export function parseWorkflowResult(result: any): any {
    if (!result || typeof result !== 'object') return result;
    if ('payload' in result) return result.payload;
    if ('text' in result) {
        try {
            return JSON.parse(result.text);
        } catch {
            return result.text;
        }
    }
    return result;
}

export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

export function arrayOf(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
}

export function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

export function compareCompactLocations(
    a: { confidence?: number; path: string; line?: number },
    b: { confidence?: number; path: string; line?: number }
): number {
    return (b.confidence || 0) - (a.confidence || 0) || a.path.localeCompare(b.path) || (a.line || 0) - (b.line || 0);
}

export function dedupeCompactPaths<T extends { path: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
    });
}

export function classifyImpactSignals(path: string, item: any, edge?: string): string[] {
    const evidence =
        `${path} ${String(item?.kind || '').slice(0, 80)} ${String(item?.context || '').slice(0, 200)}`.toLowerCase();
    return uniqueStrings([
        edge === 'exports' || /(^|[/_.-])(public|api|index)([/_.-]|$)|\bexport\b/.test(evidence) ? 'publicApi' : '',
        /(^|[/_.-])(state|store|reducer|schema|migration|database|db)([/_.-]|$)/.test(evidence) ? 'state' : '',
        /(^|[/_.-])(registry|registries|plugin|plugins)([/_.-]|$)|\bregister(ed|ing)?\b/.test(evidence)
            ? 'registry'
            : '',
        /(^|[/_.-])(__tests__|tests?|spec)([/_.-]|$)/.test(evidence) ? 'tests' : '',
    ]);
}

export function canonicalPath(value: string): string {
    return posix.normalize(value.replaceAll('\\', '/'));
}

export function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
