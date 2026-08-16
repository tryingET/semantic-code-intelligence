import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';
import {
    arrayOf,
    boundedNumber,
    buildSymbolImpactDetails,
    canonicalPath,
    classifyImpactSignals,
    compareCompactLocations,
    dedupeCompactPaths,
    fitSymbolImpactPacket,
    invokeSymbolImpactSubcall,
    isRecord,
    parseWorkflowResult,
    safeDisclosureLabel,
    safeDisclosurePath,
    sanitizeDisclosureText,
    SYMBOL_IMPACT_DISCLOSURE_BUDGETS,
    uniqueStrings,
} from './symbol-workflow-disclosure.js';

export { parseWorkflowResult };

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
        const workflowStarted = performance.now();
        const symbol = String(args?.symbol || '').trim();
        if (!symbol) return { text: 'symbol required', isError: true };
        if (symbol.length > 256) return { text: 'symbol exceeds 256 characters', isError: true };

        let file = typeof args?.file === 'string' ? args.file : undefined;
        let ontologySeedElapsedMs: number | undefined;
        if (!file && this.deps.pickOntologySeedFile) {
            const ontologySeedStarted = performance.now();
            file = (await this.deps.pickOntologySeedFile(symbol)) || undefined;
            ontologySeedElapsedMs = performance.now() - ontologySeedStarted;
        }
        const precise = (args?.precise ?? true) as boolean;
        const depth = boundedNumber(args?.depth, 1, 1, 5);
        const limit = boundedNumber(args?.limit, 50, 1, 200);
        const maxFiles = boundedNumber(args?.maxFiles, 8, 1, 25);
        const maxNextReads = boundedNumber(args?.maxNextReads, 4, 1, 10);
        const maxLimitations = boundedNumber(args?.maxLimitations, 3, 1, 10);
        const mode = args?.mode === 'standard' || args?.mode === 'debug' ? args.mode : 'compact';
        const workspaceRoot = canonicalPath(this.deps.workspaceRoot());
        const disclosedSymbol = sanitizeDisclosureText(symbol, workspaceRoot, 256);

        const definitionInput = { symbol, file, precise, maxResults: limit };
        const symbolMapInput = { symbol, file, maxFiles: Math.min(20, limit), astOnly: true };
        const [definitionResult, symbolMapResult] = await Promise.all([
            invokeSymbolImpactSubcall('find_definition', definitionInput, () =>
                this.deps.findDefinition(definitionInput)
            ),
            invokeSymbolImpactSubcall('build_symbol_map', symbolMapInput, () =>
                this.deps.buildSymbolMap(symbolMapInput)
            ),
        ]);
        const definitionOut = definitionResult.value;
        const symbolMapOut = symbolMapResult.value;
        const definitionItems = definitionResult.issue ? [] : arrayOf(definitionOut.definitions);
        const declarationItems = symbolMapResult.issue ? [] : arrayOf(symbolMapOut.declarations);
        const referenceItems = symbolMapResult.issue ? [] : arrayOf(symbolMapOut.references);
        const rawDefinitions = definitionItems.slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection);
        const rawDeclarations = declarationItems.slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection);
        const rawReferences = referenceItems.slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection);
        const intakeTruncated = [definitionItems, declarationItems, referenceItems].some(
            (items) => items.length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection
        );
        const confirmedCandidates = dedupeLocations(
            [...rawDefinitions, ...rawDeclarations].filter((item) => isDefinition(item, symbol, workspaceRoot)),
            workspaceRoot
        );
        const confirmedLocations = dedupeCompactPaths(
            confirmedCandidates.map((item) => compactLocation(item, workspaceRoot)).sort(compareCompactLocations)
        );
        const definition = confirmedLocations[0] || null;

        // Import/export impact is file-shaped. Resolve the symbol first so symbol-only calls
        // can seed graph expansion from confirmed evidence rather than omitting those edges.
        const graphFile = definition?.path || file;
        const graphInput = graphFile
            ? { file: graphFile, symbol, edges: ['imports', 'exports', 'callers', 'callees'], depth, limit }
            : { symbol, edges: ['callers', 'callees'], depth, limit };
        const neighborsResult = await invokeSymbolImpactSubcall('graph_expand', graphInput, () =>
            this.deps.graphExpand(graphInput)
        );
        const neighborsOut = neighborsResult.value;
        const subcalls = [definitionResult, symbolMapResult, neighborsResult];
        const totalElapsedMs = performance.now() - workflowStarted;
        const issues = [definitionResult.issue, symbolMapResult.issue, neighborsResult.issue].filter(
            (issue): issue is string => !!issue
        );
        const impactSummary = isRecord(neighborsOut.impactSummary) ? neighborsOut.impactSummary : {};
        const hasImpactEvidence = !neighborsResult.issue && impactSummary.hasImpactEvidence === true;
        const graphNeighbors = isRecord(neighborsOut.neighbors) ? neighborsOut.neighbors : {};
        const graphIntakeTruncated = ['exports', 'callers', 'imports', 'callees'].some(
            (edge) => arrayOf(graphNeighbors[edge]).length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection
        );
        const status = definition ? 'confirmed' : issues.length > 0 ? 'indeterminate' : 'unconfirmed';
        const backendLimitations = arrayOf(impactSummary.limitations);
        const limitationIntakeTruncated =
            backendLimitations.length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedLimitations;
        const limitations = uniqueStrings([
            ...(confirmedLocations.length > 1
                ? ['Multiple definition candidates were found; impact includes every confirmed definition file.']
                : []),
            ...issues,
            ...(intakeTruncated || graphIntakeTruncated || limitationIntakeTruncated
                ? ['Backend evidence exceeded an analysis budget and was truncated deterministically.']
                : []),
            ...backendLimitations
                .slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedLimitations)
                .map((value) => sanitizeDisclosureText(String(value), workspaceRoot, 200)),
            ...(depth > 1 ? ['Impact ranking uses the backend’s bounded one-hop evidence.'] : []),
        ]).slice(0, maxLimitations);

        if (!definition) {
            const hasPartialEvidence = rawReferences.length > 0 || hasImpactEvidence;
            const packet: Record<string, any> = {
                schemaVersion: 1,
                workflow: 'explore_symbol_impact',
                ok: false,
                symbol: disclosedSymbol,
                status,
                degraded: issues.length > 0,
                message:
                    status === 'indeterminate'
                        ? 'Definition not confirmed because one or more evidence sources failed; do not plan edits from this result.'
                        : 'Definition not confirmed; references or graph matches alone are insufficient to plan edits.',
                evidence: {
                    references: rawReferences.length,
                    graphImpact: hasImpactEvidence,
                    partial: hasPartialEvidence,
                },
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
            if (mode !== 'compact') {
                packet.details = buildSymbolImpactDetails({
                    mode,
                    workspaceRoot,
                    subcalls,
                    limitations,
                    totalElapsedMs,
                    ontologySeedElapsedMs,
                });
            }
            return { payload: fitSymbolImpactPacket(packet), isError: false };
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
            ...(signals.publicApi.detected
                ? ['Export/public API evidence means downstream consumers may be affected.']
                : []),
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
            reason:
                index === 0
                    ? 'Start at the confirmed definition.'
                    : `Verify ${item.reasons.slice(0, 2).join(' and ')} evidence.`,
        }));
        const packet: Record<string, any> = {
            schemaVersion: 1,
            workflow: 'explore_symbol_impact',
            ok: true,
            symbol: disclosedSymbol,
            status,
            degraded: issues.length > 0,
            definition,
            definitions: { count: confirmedLocations.length },
            impact: { files, totalFiles: ranked.length, truncated: ranked.length > files.length },
            editRisk: { level: risk, reasons: riskReasons.slice(0, 4), signals },
            nextReads,
            limitations,
            details:
                mode === 'compact'
                    ? 'mode: standard'
                    : buildSymbolImpactDetails({
                          mode,
                          workspaceRoot,
                          subcalls,
                          limitations,
                          totalElapsedMs,
                          ontologySeedElapsedMs,
                      }),
        };
        return { payload: fitSymbolImpactPacket(packet), isError: false };
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

function locationPath(item: any, workspaceRoot?: string): string | null {
    const value = [item?.uri, item?.file, item?.path].find((candidate) => typeof candidate === 'string' && candidate);
    if (!value) return null;
    return workspaceRoot ? safeDisclosurePath(value, workspaceRoot) : canonicalPath(value);
}

function compactLocation(item: any, workspaceRoot?: string): CompactLocation {
    const start = item?.range?.start || item?.start;
    return {
        path: locationPath(item, workspaceRoot) || '',
        ...(Number.isFinite(start?.line) ? { line: Number(start.line) + 1 } : {}),
        ...(Number.isFinite(start?.character) ? { character: Number(start.character) + 1 } : {}),
        ...(safeDisclosureLabel(item?.kind) ? { kind: safeDisclosureLabel(item.kind) } : {}),
        ...(Number.isFinite(item?.confidence) ? { confidence: Number(item.confidence) } : {}),
        ...(safeDisclosureLabel(item?.source) ? { source: safeDisclosureLabel(item.source) } : {}),
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
        current.signals = uniqueStrings([...current.signals, ...classifyImpactSignals(path, item, edge)]);
        files.set(path, current);
    };
    add(definition, 120, 'definition');
    for (const item of alternateDefinitions) add(item, 110, 'alternateDefinition');
    for (const item of dedupeLocations(declarations, workspaceRoot)) add(item, 90, 'declaration');
    for (const item of dedupeLocations(references, workspaceRoot)) add(item, 45, 'reference');
    const weights: Record<string, number> = { exports: 70, callers: 65, imports: 40, callees: 30 };
    const neighbors = isRecord(neighborsOut?.neighbors) ? neighborsOut.neighbors : {};
    for (const edge of ['exports', 'callers', 'imports', 'callees']) {
        for (const item of arrayOf(neighbors[edge]).slice(
            0,
            SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection
        )) {
            add(item, weights[edge], edge.slice(0, -1), edge);
        }
    }
    return Array.from(files.values())
        .map((item) => ({ ...item, score: Math.min(999, item.score) }))
        .sort(
            (a, b) =>
                b.score - a.score ||
                Number(b.signals.includes('publicApi')) - Number(a.signals.includes('publicApi')) ||
                a.path.localeCompare(b.path)
        );
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
    return {
        publicApi: signal('publicApi'),
        state: signal('state'),
        registry: signal('registry'),
        tests: signal('tests'),
    };
}
