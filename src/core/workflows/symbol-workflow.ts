import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';
import {
    analyzeSymbolImpactDisclosure,
    arrayOf,
    boundedNumber,
    buildSymbolImpactDetails,
    canonicalPath,
    compareCompactLocations,
    dedupeCompactPaths,
    fitSymbolImpactPacket,
    invokeSymbolImpactSubcall,
    isRecord,
    parseWorkflowResult,
    sanitizeDisclosureText,
    SYMBOL_IMPACT_DISCLOSURE_BUDGETS,
    uniqueStrings,
} from './symbol-workflow-disclosure.js';
import {
    compactLocation,
    dedupeLocations,
    impactSignals,
    isDefinition,
    rankImpactedFiles,
    structuralSignalCandidates,
    type RankedFile,
} from './symbol-workflow-ranking.js';
import { analyzeStructuralSignalEvidence } from './symbol-workflow-structural-analysis.js';

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
        const neighborsOut = neighborsResult.issue ? {} : neighborsResult.value;
        const subcalls = [definitionResult, symbolMapResult, neighborsResult];
        let totalElapsedMs = performance.now() - workflowStarted;
        const issues = [definitionResult.issue, symbolMapResult.issue, neighborsResult.issue].filter(
            (issue): issue is string => !!issue
        );
        const impactSummary = isRecord(neighborsOut.impactSummary) ? neighborsOut.impactSummary : {};
        const disclosureAnalysis = analyzeSymbolImpactDisclosure({ workspaceRoot, subcalls });
        const evidenceDegraded =
            disclosureAnalysis.summary.shapeFailures > 0 || disclosureAnalysis.summary.graphReportedButUnusable;
        const degraded = issues.length > 0 || evidenceDegraded;
        const graphNeighbors = isRecord(neighborsOut.neighbors) ? neighborsOut.neighbors : {};
        const graphIntakeTruncated = ['exports', 'callers', 'imports', 'callees'].some(
            (edge) => arrayOf(graphNeighbors[edge]).length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection
        );
        const status = definition ? 'confirmed' : degraded ? 'indeterminate' : 'unconfirmed';
        const backendLimitations = arrayOf(impactSummary.limitations);
        const limitationIntakeTruncated =
            backendLimitations.length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedLimitations;
        const limitations = uniqueStrings([
            ...(confirmedLocations.length > 1
                ? ['Multiple definition candidates were found; impact includes every confirmed definition file.']
                : []),
            ...issues,
            ...(disclosureAnalysis.summary.graphReportedButUnusable
                ? ['Graph impact was reported, but no graph item was usable after bounded normalization.']
                : []),
            ...(disclosureAnalysis.summary.graph.invalidItems + disclosureAnalysis.summary.graph.outsideWorkspaceItems >
            0
                ? ['Some graph evidence was omitted because it lacked a supported workspace-contained location.']
                : []),
            ...(disclosureAnalysis.summary.shapeFailures >
            disclosureAnalysis.summary.graph.invalidItems + disclosureAnalysis.summary.graph.outsideWorkspaceItems
                ? [
                      'Some definition or reference evidence was omitted because it lacked a supported workspace-contained location.',
                  ]
                : []),
            ...(intakeTruncated || graphIntakeTruncated || limitationIntakeTruncated
                ? ['Backend evidence exceeded an analysis budget and was truncated deterministically.']
                : []),
            ...backendLimitations
                .slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedLimitations)
                .map((value) => sanitizeDisclosureText(String(value), workspaceRoot, 200)),
            ...(depth > 1 ? ['Impact ranking uses the backend’s bounded one-hop evidence.'] : []),
        ]).slice(0, maxLimitations);

        if (!definition) {
            const hasPartialEvidence =
                disclosureAnalysis.summary.references.usable > 0 || disclosureAnalysis.summary.graph.usable;
            const packet: Record<string, any> = {
                schemaVersion: 1,
                workflow: 'explore_symbol_impact',
                ok: false,
                symbol: disclosedSymbol,
                status,
                degraded,
                message:
                    status === 'indeterminate'
                        ? 'Definition not confirmed because evidence was failed, rejected, or unusable; do not plan edits from this result.'
                        : 'Definition not confirmed; references or graph matches alone are insufficient to plan edits.',
                evidence: {
                    references: disclosureAnalysis.summary.references.usable,
                    graphImpact: disclosureAnalysis.summary.graph.usable,
                    partial: hasPartialEvidence,
                },
                nextReads: [
                    {
                        action: 'locate_confirm_definition',
                        arguments: { symbol: disclosedSymbol, precise: true },
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
                    analysis: disclosureAnalysis,
                });
            }
            return { payload: fitSymbolImpactPacket(packet), isError: false };
        }

        const structuralAnalysis = await analyzeStructuralSignalEvidence({
            workspaceRoot,
            symbol,
            candidates: structuralSignalCandidates(
                definition,
                confirmedCandidates,
                rawDeclarations,
                rawReferences,
                neighborsOut,
                workspaceRoot
            ),
        });
        const ranked = rankImpactedFiles(
            symbol,
            definition,
            confirmedLocations.slice(1),
            rawDeclarations,
            rawReferences,
            neighborsOut,
            workspaceRoot,
            structuralAnalysis.evidence
        );
        const definitionFile = ranked.find((item) => item.path === definition.path);
        const visibleFiles = [definitionFile, ...ranked.filter((item) => item !== definitionFile)]
            .filter((item): item is RankedFile => !!item)
            .slice(0, maxFiles);
        if (ranked.length > visibleFiles.length && limitations.length < maxLimitations) {
            limitations.push('Impact files are truncated; risk signals still summarize all ranked evidence.');
        }
        const signals = impactSignals(ranked, visibleFiles);
        const riskReasons = [
            ...(signals.publicApi.detected
                ? ['Target-specific export evidence means downstream consumers may be affected.']
                : []),
            ...(signals.state.detected ? ['Structural write evidence requires invariant review.'] : []),
            ...(signals.registry.detected ? ['Structural registration evidence may require coordinated updates.'] : []),
            ...(signals.tests.detected
                ? ['Structurally identified impacted tests provide a focused validation target.']
                : []),
            ...(degraded ? ['Impact evidence is degraded by failed or unusable evidence.'] : []),
        ];
        const elevatedRisk = signals.publicApi.detected || signals.state.detected || signals.registry.detected;
        const risk = degraded || elevatedRisk ? 'high' : ranked.length > 3 ? 'medium' : 'unknown';
        if (risk === 'unknown') {
            riskReasons.push('No supported structural evidence established a low semantic edit risk.');
        }
        const nextReads = visibleFiles.slice(0, maxNextReads).map((item: any, index: number) => ({
            path: item.path,
            line: item.line,
            reason:
                index === 0
                    ? 'Start at the confirmed definition.'
                    : `Verify ${item.reasons.slice(0, 2).join(' and ')} evidence.`,
        }));
        const publicFiles = visibleFiles.map(({ signalEvidence: _signalEvidence, ...file }) => file);
        totalElapsedMs = performance.now() - workflowStarted;
        const packet: Record<string, any> = {
            schemaVersion: 1,
            workflow: 'explore_symbol_impact',
            ok: true,
            symbol: disclosedSymbol,
            status,
            degraded,
            definition,
            definitions: { count: confirmedLocations.length },
            impact: { files: publicFiles, totalFiles: ranked.length, truncated: ranked.length > visibleFiles.length },
            editRisk: {
                level: risk,
                reasons: riskReasons.slice(0, 4),
                signals,
                analysis: {
                    structural: {
                        ...structuralAnalysis.analysis,
                        limitations: structuralAnalysis.limitations,
                    },
                },
            },
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
                          analysis: disclosureAnalysis,
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
