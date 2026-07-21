import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

export interface SymbolWorkflowDeps {
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

        let file = typeof args?.file === 'string' ? args.file : undefined;
        if (!file && this.deps.pickOntologySeedFile) {
            file = (await this.deps.pickOntologySeedFile(symbol)) || undefined;
        }
        const precise = (args?.precise ?? true) as boolean;
        const depth = typeof args?.depth === 'number' ? args.depth : 1;
        const limit = typeof args?.limit === 'number' ? args.limit : 50;

        const definitions = await this.deps.findDefinition({ symbol, file, precise, maxResults: limit });
        const symbolMap = await this.deps.buildSymbolMap({
            symbol,
            file,
            maxFiles: Math.min(20, limit),
            astOnly: true,
        });
        const neighbors = await this.deps.graphExpand(
            file
                ? { file, symbol, edges: ['imports', 'exports', 'callers', 'callees'], depth, limit }
                : { symbol, edges: ['callers', 'callees'], depth, limit }
        );

        const definitionResult = inspectWorkflowResult('find_definition', definitions);
        const symbolMapResult = inspectWorkflowResult('build_symbol_map', symbolMap);
        const neighborsResult = inspectWorkflowResult('graph_expand', neighbors);
        const definitionOut = definitionResult.value;
        const symbolMapOut = symbolMapResult.value;
        const neighborsOut = neighborsResult.value;
        const issues = [definitionResult.issue, symbolMapResult.issue, neighborsResult.issue].filter(
            (issue): issue is string => !!issue
        );
        const definitionCount = definitionResult.issue
            ? 0
            : Array.isArray(definitionOut.definitions)
              ? definitionOut.definitions.length
              : 0;
        const declarationCount = symbolMapResult.issue
            ? 0
            : Array.isArray(symbolMapOut.declarations)
              ? symbolMapOut.declarations.length
              : 0;
        const referenceCount = symbolMapResult.issue
            ? 0
            : Array.isArray(symbolMapOut.references)
              ? symbolMapOut.references.length
              : 0;
        const symbolConfirmed = definitionCount > 0 || declarationCount > 0;
        const hasImpactEvidence = !neighborsResult.issue && neighborsOut?.impactSummary?.hasImpactEvidence === true;
        const status = symbolConfirmed ? 'confirmed' : issues.length > 0 ? 'indeterminate' : 'unconfirmed';
        const nextActions = symbolConfirmed
            ? issues.length > 0
                ? ['Open top definition', 'Inspect incomplete subcall evidence before planning broad changes.']
                : ['Open top definition', 'Inspect low-confidence callers']
            : status === 'indeterminate'
              ? [
                    'Retry explore_symbol_impact after inspecting the reported subcall issues.',
                    'Do not infer that the symbol is absent from incomplete workflow evidence.',
                ]
              : referenceCount > 0
                ? [
                      'Retry locate_confirm_definition without a file filter before planning a change.',
                      'Inspect reference candidates; references alone do not confirm a workspace definition.',
                  ]
                : [
                      'Check the symbol spelling or retry without a file filter.',
                      'Use bounded text search only if composite definition evidence remains insufficient.',
                  ];

        return {
            payload: {
                ok: symbolConfirmed,
                partial: !symbolConfirmed && (referenceCount > 0 || hasImpactEvidence),
                degraded: issues.length > 0,
                symbolResolution: {
                    status,
                    definitionCount,
                    declarationCount,
                    referenceCount,
                    hasImpactEvidence,
                    issues,
                },
                definitions: definitionOut,
                symbolMap: symbolMapOut,
                neighbors: neighborsOut,
                tips: [
                    'Prefer files whose basename includes the symbol for quick AST validation.',
                    'Escalate to precise mode when candidates ≥ 3 or confidence is low.',
                ],
                next_actions: nextActions,
            },
            isError: false,
        };
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
