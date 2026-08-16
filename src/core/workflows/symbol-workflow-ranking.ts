import {
    arrayOf,
    canonicalPath,
    isRecord,
    safeDisclosureLabel,
    safeDisclosurePath,
    SYMBOL_IMPACT_DISCLOSURE_BUDGETS,
    uniqueStrings,
} from './symbol-workflow-disclosure.js';
import {
    classifyImpactSignalEvidence,
    dedupeImpactSignalEvidence,
    type ImpactSignalEvidence,
    type ImpactSignalName,
    type StructuralSignalCandidate,
} from './symbol-workflow-signals.js';

export type CompactLocation = {
    path: string;
    line?: number;
    character?: number;
    kind?: string;
    confidence?: number;
    source?: string;
};

export type RankedFile = CompactLocation & {
    score: number;
    reasons: string[];
    signals: ImpactSignalName[];
    signalEvidence: ImpactSignalEvidence[];
};

function locationPath(item: any, workspaceRoot?: string): string | null {
    const value = [item?.uri, item?.file, item?.path].find((candidate) => typeof candidate === 'string' && candidate);
    if (!value) return null;
    return workspaceRoot ? safeDisclosurePath(value, workspaceRoot) : canonicalPath(value);
}

export function compactLocation(item: any, workspaceRoot?: string): CompactLocation {
    const start = item?.range?.start || item?.start;
    return {
        path: locationPath(item, workspaceRoot) || '',
        ...(Number.isFinite(start?.line) ? { line: Number(start.line) + 1 } : {}),
        ...(Number.isFinite(start?.character ?? start?.column)
            ? { character: Number(start.character ?? start.column) + 1 }
            : {}),
        ...(safeDisclosureLabel(item?.kind) ? { kind: safeDisclosureLabel(item.kind) } : {}),
        ...(Number.isFinite(item?.confidence) ? { confidence: Number(item.confidence) } : {}),
        ...(safeDisclosureLabel(item?.source) ? { source: safeDisclosureLabel(item.source) } : {}),
    };
}

export function isDefinition(item: any, symbol: string, workspaceRoot: string): boolean {
    const definitionKinds = new Set([
        'function',
        'variable',
        'class',
        'constructor',
        'declaration',
        'interface',
        'method',
        'property',
        'type',
        'module',
        'export',
    ]);
    const candidateName = String(item?.name || item?.identifier || '');
    return (
        !!locationPath(item, workspaceRoot) &&
        candidateName === symbol &&
        definitionKinds.has(String(item?.kind || '').toLowerCase())
    );
}

export function dedupeLocations(items: any[], workspaceRoot?: string): any[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const location = compactLocation(item, workspaceRoot);
        if (!location.path) return false;
        const key = `${location.path}:${location.line || 0}:${location.character || 0}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function structuralSignalCandidates(
    definition: CompactLocation,
    confirmedCandidates: any[],
    declarations: any[],
    references: any[],
    neighborsOut: Record<string, any>,
    workspaceRoot: string
): StructuralSignalCandidate[] {
    const candidates: StructuralSignalCandidate[] = [];
    const add = (item: any, origin: StructuralSignalCandidate['origin'], edge?: string) => {
        const path = resolvedImpactPath(item, edge, definition, workspaceRoot);
        if (!path) return;
        const compact = compactLocation(item, workspaceRoot);
        candidates.push({ path, line: compact.line, character: compact.character, origin });
    };
    for (const item of confirmedCandidates) add(item, 'definition');
    for (const item of dedupeLocations(declarations, workspaceRoot)) add(item, 'declaration');
    for (const item of dedupeLocations(references, workspaceRoot)) add(item, 'reference');
    const neighbors = isRecord(neighborsOut?.neighbors) ? neighborsOut.neighbors : {};
    for (const edge of ['exports', 'callers', 'imports', 'callees'] as const) {
        for (const item of sortedUniqueGraphItems(arrayOf(neighbors[edge]), edge, definition, workspaceRoot)) {
            add(item, edge.slice(0, -1) as StructuralSignalCandidate['origin'], edge);
        }
    }
    return candidates;
}

export function rankImpactedFiles(
    symbol: string,
    definition: CompactLocation,
    alternateDefinitions: CompactLocation[],
    declarations: any[],
    references: any[],
    neighborsOut: Record<string, any>,
    workspaceRoot: string,
    structuralEvidence: ImpactSignalEvidence[]
): RankedFile[] {
    const files = new Map<string, RankedFile>();
    const add = (item: any, score: number, reason: string, edge?: string) => {
        const path = resolvedImpactPath(item, edge, definition, workspaceRoot);
        if (!path) return;
        const itemEvidence = classifyImpactSignalEvidence({ path, item, edge, symbol });
        if (
            edge === 'exports' &&
            !itemEvidence.some((evidence) => evidence.signal === 'publicApi' && !evidence.fallback)
        ) {
            return;
        }
        const compact = compactLocation(item, workspaceRoot);
        const current = files.get(path) || {
            path,
            score: 0,
            reasons: [],
            signals: [],
            signalEvidence: [],
        };
        current.score += score;
        if (compact.line && (!current.line || compact.line < current.line)) current.line = compact.line;
        current.reasons = uniqueStrings([...current.reasons, reason]);
        current.signalEvidence = dedupeImpactSignalEvidence([...current.signalEvidence, ...itemEvidence]);
        files.set(path, current);
    };
    add(definition, 120, 'definition');
    for (const item of alternateDefinitions) add(item, 110, 'alternateDefinition');
    for (const item of dedupeLocations(declarations, workspaceRoot)) add(item, 90, 'declaration');
    for (const item of dedupeLocations(references, workspaceRoot)) add(item, 45, 'reference');
    const weights: Record<string, number> = { exports: 70, callers: 65, imports: 40, callees: 30 };
    const neighbors = isRecord(neighborsOut?.neighbors) ? neighborsOut.neighbors : {};
    for (const edge of ['exports', 'callers', 'imports', 'callees']) {
        for (const item of sortedUniqueGraphItems(arrayOf(neighbors[edge]), edge, definition, workspaceRoot)) {
            add(item, weights[edge], edge.slice(0, -1), edge);
        }
    }
    for (const evidence of structuralEvidence) {
        const file = files.get(evidence.path);
        if (file) file.signalEvidence = dedupeImpactSignalEvidence([...file.signalEvidence, evidence]);
    }
    return Array.from(files.values())
        .map((item) => {
            const signals = Array.from(
                new Set(item.signalEvidence.filter((evidence) => !evidence.fallback).map((evidence) => evidence.signal))
            ) as ImpactSignalName[];
            return { ...item, signals, score: Math.min(999, item.score) };
        })
        .sort(
            (a, b) =>
                b.score - a.score ||
                Number(b.signals.includes('publicApi')) - Number(a.signals.includes('publicApi')) ||
                a.path.localeCompare(b.path)
        );
}

function resolvedImpactPath(
    item: any,
    edge: string | undefined,
    definition: CompactLocation,
    workspaceRoot: string
): string | null {
    const hasExplicitPath = [item?.uri, item?.file, item?.path].some(
        (value) => typeof value === 'string' && value.length > 0
    );
    return (
        locationPath(item, workspaceRoot) ||
        (!hasExplicitPath && (edge === 'imports' || edge === 'exports') ? definition.path : null)
    );
}

function sortedUniqueGraphItems(
    items: any[],
    edge: string,
    definition: CompactLocation,
    workspaceRoot: string
): any[] {
    const keyed = items.slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection).map((item) => {
        const path = resolvedImpactPath(item, edge, definition, workspaceRoot) || '';
        const compact = compactLocation(item, workspaceRoot);
        const key = [
            edge,
            path,
            compact.line || 0,
            compact.character || 0,
            graphKeyText(item?.capture, 80),
            graphKeyText(item?.name, 120),
            graphKeyText(item?.symbol, 120),
            graphKeyText(item?.text, 200),
        ].join(':');
        return { item, key };
    });
    keyed.sort((a, b) => a.key.localeCompare(b.key));
    const seen = new Set<string>();
    return keyed
        .filter(({ key }) => {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(({ item }) => item);
}

function graphKeyText(value: unknown, maxLength: number): string {
    if (typeof value === 'string') return value.slice(0, maxLength);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

export function impactSignals(rankedFiles: RankedFile[], visibleFiles: RankedFile[]) {
    const visiblePaths = new Set(visibleFiles.map((file) => file.path));
    const allEvidence = dedupeImpactSignalEvidence(rankedFiles.flatMap((file) => file.signalEvidence));
    const signal = (name: ImpactSignalName) => {
        const structural = allEvidence.filter((item) => item.signal === name && !item.fallback);
        const fallbacks = allEvidence.filter((item) => item.signal === name && item.fallback);
        const matchPaths = Array.from(new Set(structural.map((item) => item.path))).sort();
        const visibleMatches = matchPaths.filter((path) => visiblePaths.has(path));
        const fallbackPaths = Array.from(new Set(fallbacks.map((item) => item.path))).sort();
        const visibleFallbacks = fallbackPaths.filter((path) => visiblePaths.has(path));
        const confidence = structural.some((item) => item.confidence === 'high')
            ? 'high'
            : structural.some((item) => item.confidence === 'medium')
              ? 'medium'
              : 'unknown';
        return {
            detected: structural.length > 0,
            status: structural.length > 0 ? 'detected' : 'unknown',
            confidence,
            files: visibleMatches,
            hiddenFiles: matchPaths.length - visibleMatches.length,
            reasons:
                structural.length > 0
                    ? uniqueStrings(structural.map((item) => item.reason)).slice(0, 4)
                    : ['No supported structural evidence proved this signal.'],
            provenance: uniqueStrings(structural.map((item) => item.provenance)).sort().slice(0, 4),
            namingFallback: {
                observed: fallbacks.length > 0,
                confidence: 'low',
                files: visibleFallbacks,
                hiddenFiles: fallbackPaths.length - visibleFallbacks.length,
                reasons: uniqueStrings(fallbacks.map((item) => item.reason)).slice(0, 4),
                provenance: fallbacks.length > 0 ? ['fallback.naming'] : [],
            },
        };
    };
    return {
        publicApi: signal('publicApi'),
        state: signal('state'),
        registry: signal('registry'),
        tests: signal('tests'),
    };
}
