import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

export interface SymbolWorkflowDeps {
    workspaceRoot: () => string;
    pickOntologySeedFile?: (symbol: string) => Promise<string | undefined | null>;
    findDefinition: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    buildSymbolMap: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    graphExpand: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    safeRename: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    patchChecksInSnapshot: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
    applySnapshot: (args: Record<string, any>) => Promise<SnapshotWorkflowResult>;
}

export class SymbolWorkflowService {
    constructor(private readonly deps: SymbolWorkflowDeps) {}

    async executeIntent(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const intentRaw = String(args?.intent || '')
            .trim()
            .toLowerCase();
        const hasPatch = typeof args?.patch === 'string' && args.patch.trim().length > 0;
        const hasRename =
            typeof args?.oldName === 'string' && typeof args?.newName === 'string' && args.oldName && args.newName;
        const hasSymbol = typeof args?.symbol === 'string' && args.symbol.trim().length > 0;

        const prefer = intentRaw as 'rename' | 'patch' | 'explore' | 'locate' | 'apply' | '';
        let invoked = '';
        let result: SnapshotWorkflowResult | null = null;

        if (prefer === 'rename' || hasRename) {
            invoked = 'rename_safely';
            result = await this.safeRename(args);
        } else if (prefer === 'patch' || hasPatch) {
            invoked = 'patch_checks_in_snapshot';
            const checks = await this.deps.patchChecksInSnapshot(args);
            const out = parseWorkflowResult(checks) || {};
            const doApply = !!args?.applyIfOk && out?.ok && process.env.ALLOW_SNAPSHOT_APPLY === '1';
            if (doApply && out?.snapshot) {
                const applied = await this.deps.applySnapshot({ snapshot: out.snapshot, check: false });
                const appliedPayload = parseWorkflowResult(applied) || {};
                return { payload: { invoked, ...out, applied: !!appliedPayload?.ok }, isError: !out?.ok };
            }
            return checks;
        } else if (prefer === 'locate' || (hasSymbol && args?.precise !== false)) {
            invoked = 'locate_confirm_definition';
            result = await this.locateConfirmDefinition(args);
        } else if (prefer === 'explore' || hasSymbol) {
            invoked = 'explore_symbol_impact';
            result = await this.exploreSymbol(args);
        } else if (prefer === 'apply') {
            invoked = 'apply_snapshot';
            result = await this.deps.applySnapshot(args);
        } else {
            return {
                payload: {
                    invoked: 'none',
                    ok: false,
                    message: 'Insufficient arguments; provide patch, oldName+newName, or symbol',
                },
                isError: true,
            };
        }

        const payload = parseWorkflowResult(result) || {};
        return { payload: { invoked, ...payload }, isError: false };
    }

    async exploreSymbol(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const symbol = String(args?.symbol || '').trim();
        if (!symbol) return { text: 'symbol required', isError: true };
        if (symbol.length > 256) return { text: 'symbol exceeds 256 characters', isError: true };

        let file = typeof args?.file === 'string' ? args.file : undefined;
        if (!file && this.deps.pickOntologySeedFile) file = (await this.deps.pickOntologySeedFile(symbol)) || undefined;
        const precise = (args?.precise ?? true) as boolean;
        const depth = boundedNumber(args?.depth, 1, 1, 5);
        const limit = boundedNumber(args?.limit, 50, 1, 200);
        const maxFiles = boundedNumber(args?.maxFiles, 8, 1, 25);
        const maxNextReads = boundedNumber(args?.maxNextReads, 4, 1, 10);
        const maxLimitations = boundedNumber(args?.maxLimitations, 3, 1, 10);
        const mode = args?.mode === 'standard' || args?.mode === 'debug' ? args.mode : 'compact';
        const workspaceRoot = canonicalPath(this.deps.workspaceRoot());

        const [definitions, symbolMap] = await Promise.all([
            this.deps.findDefinition({ symbol, file, precise, maxResults: limit }),
            this.deps.buildSymbolMap({ symbol, file, maxFiles: Math.min(20, limit), astOnly: true }),
        ]);
        const definitionResult = inspectWorkflowResult('find_definition', definitions);
        const symbolMapResult = inspectWorkflowResult('build_symbol_map', symbolMap);
        const definitionOut = definitionResult.value;
        const symbolMapOut = symbolMapResult.value;
        const rawDefinitions = definitionResult.issue ? [] : arrayOf(definitionOut.definitions);
        const rawDeclarations = symbolMapResult.issue ? [] : arrayOf(symbolMapOut.declarations);
        const rawReferences = symbolMapResult.issue ? [] : arrayOf(symbolMapOut.references);
        const confirmedCandidates = dedupeLocations(
            [...rawDefinitions, ...rawDeclarations].filter((item) => isDefinition(item, symbol, workspaceRoot)),
            workspaceRoot
        );
        const confirmedLocations = dedupeCompactPaths(
            confirmedCandidates.map((item) => compactLocation(item, workspaceRoot)).sort(compareLocations)
        );
        const definition = confirmedLocations[0] || null;

        // Import/export impact is file-shaped. Resolve the symbol first so symbol-only calls
        // can seed graph expansion from confirmed evidence rather than omitting those edges.
        const graphFile = definition?.path || file;
        const neighbors = await this.deps.graphExpand(
            graphFile
                ? { file: graphFile, symbol, edges: ['imports', 'exports', 'callers', 'callees'], depth, limit }
                : { symbol, edges: ['callers', 'callees'], depth, limit }
        );
        const neighborsResult = inspectWorkflowResult('graph_expand', neighbors);
        const neighborsOut = neighborsResult.value;
        const issues = [definitionResult.issue, symbolMapResult.issue, neighborsResult.issue].filter(
            (issue): issue is string => !!issue
        );
        const hasImpactEvidence = !neighborsResult.issue && neighborsOut?.impactSummary?.hasImpactEvidence === true;
        const status = definition ? 'confirmed' : issues.length > 0 ? 'indeterminate' : 'unconfirmed';
        const limitations = uniqueStrings([
            ...(confirmedLocations.length > 1
                ? ['Multiple definition candidates were found; impact includes every confirmed definition file.']
                : []),
            ...issues,
            ...arrayOf(neighborsOut?.impactSummary?.limitations).map((value) => boundedText(String(value), 200)),
            ...(depth > 1 ? ['Impact ranking uses the backend’s bounded one-hop evidence.'] : []),
        ]).slice(0, maxLimitations);

        if (!definition) {
            const hasPartialEvidence = rawReferences.length > 0 || hasImpactEvidence;
            const packet: Record<string, any> = {
                schemaVersion: 1,
                workflow: 'explore_symbol_impact',
                ok: false,
                symbol,
                status,
                degraded: issues.length > 0,
                message:
                    status === 'indeterminate'
                        ? 'Definition not confirmed because one or more evidence sources failed; do not plan edits from this result.'
                        : 'Definition not confirmed; references or graph matches alone are insufficient to plan edits.',
                evidence: { references: rawReferences.length, graphImpact: hasImpactEvidence, partial: hasPartialEvidence },
                nextReads: [
                    {
                        action: 'locate_confirm_definition',
                        reason: file
                            ? 'Retry without the file filter to confirm a workspace declaration.'
                            : 'Confirm spelling and request precise definition evidence.',
                    },
                ],
                limitations,
            };
            if (mode !== 'compact') packet.details = { definitions: definitionOut, symbolMap: symbolMapOut, neighbors: neighborsOut };
            return { payload: packet, isError: false };
        }

        const ranked = rankImpactedFiles(
            definition,
            confirmedLocations.slice(1),
            rawDeclarations,
            rawReferences,
            neighborsOut,
            workspaceRoot
        );
        const definitionFile = ranked.find((item) => item.path === definition.path);
        const files = [definitionFile, ...ranked.filter((item) => item !== definitionFile)]
            .filter((item): item is RankedFile => !!item)
            .slice(0, maxFiles);
        if (ranked.length > files.length && limitations.length < maxLimitations) {
            limitations.push('Impact files are truncated; risk signals still summarize all ranked evidence.');
        }
        const signals = impactSignals(ranked, files);
        const riskReasons = [
            ...(signals.publicApi.detected ? ['Export/public API evidence means downstream consumers may be affected.'] : []),
            ...(signals.state.detected ? ['State or persistence-adjacent files require invariant review.'] : []),
            ...(signals.registry.detected ? ['Registry/plugin wiring may require coordinated updates.'] : []),
            ...(signals.tests.detected ? ['Existing impacted tests provide a focused validation target.'] : []),
            ...(issues.length > 0 ? ['Impact evidence is degraded by failed subcalls.'] : []),
        ];
        const risk =
            issues.length > 0 || signals.publicApi.detected || signals.state.detected || signals.registry.detected
                ? 'high'
                : ranked.length > 3
                  ? 'medium'
                  : 'low';
        const nextReads = files.slice(0, maxNextReads).map((item: any, index: number) => ({
            path: item.path,
            line: item.line,
            reason: index === 0 ? 'Start at the confirmed definition.' : `Verify ${item.reasons.slice(0, 2).join(' and ')} evidence.`,
        }));
        const packet: Record<string, any> = {
            schemaVersion: 1,
            workflow: 'explore_symbol_impact',
            ok: true,
            symbol,
            status,
            degraded: issues.length > 0,
            definition,
            definitions: { count: confirmedLocations.length },
            impact: { files, totalFiles: ranked.length, truncated: ranked.length > files.length },
            editRisk: { level: risk, reasons: riskReasons.slice(0, 4), signals },
            nextReads,
            limitations,
            details: mode === 'compact' ? 'mode: standard' : { definitions: definitionOut, symbolMap: symbolMapOut, neighbors: neighborsOut },
        };
        return { payload: packet, isError: false };
    }

    async locateConfirmDefinition(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const symbol = String(args?.symbol || '').trim();
        if (!symbol) return { text: 'symbol required', isError: true };

        let file = typeof args?.file === 'string' ? args.file : undefined;
        if (!file && this.deps.pickOntologySeedFile) {
            file = (await this.deps.pickOntologySeedFile(symbol)) || undefined;
        }
        const attempts: any[] = [];
        const fast = await this.deps.findDefinition({
            symbol,
            file,
            precise: false,
            maxResults: Math.min(50, Number(args?.maxResults || 50)),
        });
        const fastOut = parseWorkflowResult(fast);
        attempts.push({ mode: 'fast', count: Array.isArray(fastOut?.definitions) ? fastOut.definitions.length : 0 });

        let chosen = fastOut;
        const ambiguous = !fastOut?.definitions || fastOut.definitions.length !== 1;
        const doPrecise = args?.precise !== false && ambiguous;
        if (doPrecise) {
            const precise = await this.deps.findDefinition({
                symbol,
                file,
                precise: true,
                maxResults: Math.min(50, Number(args?.maxResults || 50)),
            });
            const preciseOut = parseWorkflowResult(precise);
            attempts.push({
                mode: 'precise',
                count: Array.isArray(preciseOut?.definitions) ? preciseOut.definitions.length : 0,
            });
            if (preciseOut?.definitions && preciseOut.definitions.length > 0) {
                chosen = preciseOut;
            }
        }

        return {
            payload: {
                workflow: 'locate_confirm_definition',
                ok: Array.isArray(chosen?.definitions) && chosen.definitions.length > 0,
                symbol,
                attempts,
                definitions: chosen?.definitions || [],
                decision: ambiguous && doPrecise ? 'precise_retry' : 'fast',
            },
            isError: false,
        };
    }

    private async safeRename(args: Record<string, any>) {
        return this.deps.safeRename(args);
    }
}

type CompactLocation = {
    path: string;
    line?: number;
    character?: number;
    kind?: string;
    confidence?: number;
    source?: string;
};

type RankedFile = CompactLocation & {
    score: number;
    reasons: string[];
    signals: string[];
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function arrayOf(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function boundedText(value: string, maxCharacters: number): string {
    return value.length <= maxCharacters ? value : `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

function locationPath(item: any, workspaceRoot?: string): string | null {
    const value = [item?.uri, item?.file, item?.path].find((candidate) => typeof candidate === 'string' && candidate);
    if (!value) return null;
    let normalized: string;
    if (value.startsWith('file://')) {
        try {
            normalized = canonicalPath(fileURLToPath(value));
        } catch {
            return null;
        }
    } else {
        normalized = canonicalPath(value);
    }
    if (!workspaceRoot) return normalized;
    const root = canonicalPath(workspaceRoot);
    const absolute = posix.isAbsolute(normalized) ? normalized : canonicalPath(posix.join(root, normalized));
    const relative = posix.relative(root, absolute);
    if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)) return null;
    return relative || '.';
}

function canonicalPath(value: string): string {
    return posix.normalize(value.replaceAll('\\', '/'));
}

function compactLocation(item: any, workspaceRoot?: string): CompactLocation {
    const start = item?.range?.start || item?.start;
    return {
        path: locationPath(item, workspaceRoot) || '',
        ...(Number.isFinite(start?.line) ? { line: Number(start.line) + 1 } : {}),
        ...(Number.isFinite(start?.character) ? { character: Number(start.character) + 1 } : {}),
        ...(typeof item?.kind === 'string' ? { kind: item.kind } : {}),
        ...(Number.isFinite(item?.confidence) ? { confidence: Number(item.confidence) } : {}),
        ...(typeof item?.source === 'string' ? { source: item.source } : {}),
    };
}

function isDefinition(item: any, symbol: string, workspaceRoot: string): boolean {
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

function dedupeLocations(items: any[], workspaceRoot?: string): any[] {
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

function compareLocations(a: CompactLocation, b: CompactLocation): number {
    return (b.confidence || 0) - (a.confidence || 0) || a.path.localeCompare(b.path) || (a.line || 0) - (b.line || 0);
}

function dedupeCompactPaths(items: CompactLocation[]): CompactLocation[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
    });
}

function classifySignals(path: string, item: any, edge?: string): string[] {
    const evidence = `${path} ${item?.kind || ''} ${item?.context || ''}`.toLowerCase();
    return uniqueStrings([
        edge === 'exports' || /(^|[/_.-])(public|api|index)([/_.-]|$)|\bexport\b/.test(evidence) ? 'publicApi' : '',
        /(^|[/_.-])(state|store|reducer|schema|migration|database|db)([/_.-]|$)/.test(evidence) ? 'state' : '',
        /(^|[/_.-])(registry|registries|plugin|plugins)([/_.-]|$)|\bregister(ed|ing)?\b/.test(evidence)
            ? 'registry'
            : '',
        /(^|[/_.-])(__tests__|tests?|spec)([/_.-]|$)/.test(evidence) ? 'tests' : '',
    ]);
}

function rankImpactedFiles(
    definition: CompactLocation,
    alternateDefinitions: CompactLocation[],
    declarations: any[],
    references: any[],
    neighborsOut: Record<string, any>,
    workspaceRoot: string
): RankedFile[] {
    const files = new Map<string, RankedFile>();
    const add = (item: any, score: number, reason: string, edge?: string) => {
        // Tree-sitter import/export captures are seed-file-local and may not repeat the file path.
        // An explicit but rejected path is not pathless and must never be reassigned to the seed.
        const hasExplicitPath = [item?.uri, item?.file, item?.path].some(
            (value) => typeof value === 'string' && value.length > 0
        );
        const path =
            locationPath(item, workspaceRoot) ||
            (!hasExplicitPath && (edge === 'imports' || edge === 'exports') ? definition.path : null);
        if (!path) return;
        const compact = compactLocation(item, workspaceRoot);
        const current = files.get(path) || { path, score: 0, reasons: [], signals: [] };
        current.score += score;
        if (!current.line && compact.line) current.line = compact.line;
        current.reasons = uniqueStrings([...current.reasons, reason]);
        current.signals = uniqueStrings([...current.signals, ...classifySignals(path, item, edge)]);
        files.set(path, current);
    };
    add(definition, 120, 'definition');
    for (const item of alternateDefinitions) add(item, 110, 'alternateDefinition');
    for (const item of dedupeLocations(declarations, workspaceRoot)) add(item, 90, 'declaration');
    for (const item of dedupeLocations(references, workspaceRoot)) add(item, 45, 'reference');
    const weights: Record<string, number> = { exports: 70, callers: 65, imports: 40, callees: 30 };
    const neighbors = isRecord(neighborsOut?.neighbors) ? neighborsOut.neighbors : {};
    for (const edge of ['exports', 'callers', 'imports', 'callees']) {
        for (const item of arrayOf(neighbors[edge])) add(item, weights[edge], edge.slice(0, -1), edge);
    }
    return Array.from(files.values())
        .map((item) => ({ ...item, score: Math.min(999, item.score) }))
        .sort((a, b) => b.score - a.score || Number(b.signals.includes('publicApi')) - Number(a.signals.includes('publicApi')) || a.path.localeCompare(b.path));
}

function impactSignals(rankedFiles: RankedFile[], visibleFiles: RankedFile[]) {
    const visiblePaths = new Set(visibleFiles.map((file) => file.path));
    const signal = (name: string) => {
        const matches = rankedFiles.filter((file) => file.signals.includes(name)).map((file) => file.path);
        const visibleMatches = matches.filter((path) => visiblePaths.has(path));
        return {
            detected: matches.length > 0,
            files: visibleMatches,
            hiddenFiles: matches.length - visibleMatches.length,
        };
    };
    return { publicApi: signal('publicApi'), state: signal('state'), registry: signal('registry'), tests: signal('tests') };
}

type InspectedWorkflowResult = {
    value: Record<string, any>;
    issue: string | null;
};

function inspectWorkflowResult(label: string, result: SnapshotWorkflowResult): InspectedWorkflowResult {
    const parsed = parseWorkflowResult(result);
    if (result?.isError) {
        return { value: isRecord(parsed) ? parsed : {}, issue: `${label}: error_result` };
    }
    if (!isRecord(parsed)) {
        return { value: {}, issue: `${label}: unstructured_result` };
    }
    return { value: parsed, issue: null };
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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
