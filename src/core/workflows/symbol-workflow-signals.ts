import { canonicalPath } from './symbol-workflow-disclosure.js';

export type ImpactSignalName = 'publicApi' | 'state' | 'registry' | 'tests';
export type ImpactSignalConfidence = 'high' | 'medium' | 'low';

export type ImpactSignalEvidence = {
    signal: ImpactSignalName;
    path: string;
    confidence: ImpactSignalConfidence;
    provenance: string;
    reason: string;
    fallback: boolean;
};

export type StructuralSignalCandidate = {
    path: string;
    line?: number;
    character?: number;
    origin: 'definition' | 'declaration' | 'reference' | 'export' | 'caller' | 'import' | 'callee';
};

export type StructuralSignalAnalysis = {
    evidence: ImpactSignalEvidence[];
    limitations: string[];
    analysis: {
        fileBudget: number;
        candidateBudgetPerFile: number;
        sourceFileByteBudget: number;
        totalSourceByteBudget: number;
        parseTimeoutMicros: number;
        astNodeBudgetPerFile: number;
        astWorkUnitBudgetPerFile: number;
        targetOccurrenceBudgetPerFile: number;
        symbolBodyBudgetPerFile: number;
        writeNodeBudgetPerFile: number;
        importNodeBudgetPerFile: number;
        observedFiles: number;
        selectedFiles: number;
        attemptedFiles: number;
        analyzedFiles: number;
        failedFiles: number;
        oversizedFiles: number;
        omittedFiles: number;
        filesOmittedByFileBudget: number;
        filesOmittedByTotalByteBudget: number;
        totalBudgetRejectedFiles: number;
        unattemptedFiles: number;
        observedCandidates: number;
        selectedCandidates: number;
        omittedCandidates: number;
        candidatesOmittedByFileBudget: number;
        rejectedCandidates: number;
        sourceBytesRead: number;
        sourceBytesAnalyzed: number;
        totalSourceByteBudgetExhausted: boolean;
        astNodesInspected: number;
        astNodeBudgetHits: number;
        astWorkUnits: number;
        astWorkBudgetHits: number;
        targetOccurrencesObserved: number;
        targetOccurrencesAnalyzed: number;
        omittedTargetOccurrences: number;
        symbolBodiesObserved: number;
        symbolBodiesAnalyzed: number;
        omittedSymbolBodies: number;
        writeNodesObserved: number;
        writeNodesAnalyzed: number;
        omittedWriteNodes: number;
        importNodesObserved: number;
        importNodesAnalyzed: number;
        omittedImportNodes: number;
    };
    analyzedFiles: number;
    omittedFiles: number;
};

const SIGNAL_ORDER: ImpactSignalName[] = ['publicApi', 'state', 'registry', 'tests'];
const CONFIDENCE_WEIGHT: Record<ImpactSignalConfidence, number> = { high: 3, medium: 2, low: 1 };

export function classifyImpactSignalEvidence(args: {
    path: string;
    item: any;
    edge?: string;
    symbol: string;
}): ImpactSignalEvidence[] {
    const path = canonicalPath(args.path);
    const item = args.item && typeof args.item === 'object' ? args.item : {};
    const roles = item.roles && typeof item.roles === 'object' ? item.roles : {};
    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const evidence: ImpactSignalEvidence[] = [];
    const add = (
        signal: ImpactSignalName,
        confidence: ImpactSignalConfidence,
        provenance: string,
        reason: string,
        fallback = false
    ) => evidence.push({ signal, path, confidence, provenance, reason, fallback });

    const exactSymbol = [item.symbol, item.name, item.text].some((value) => String(value || '') === args.symbol);
    const exportCapture = String(item.capture || '').startsWith('export.');
    if (args.edge === 'exports' && exactSymbol && (exportCapture || item.kind === 'export' || roles.definition === true)) {
        add('publicApi', 'high', 'graph.exports', 'The graph backend returned a target-matching export declaration.');
    } else if (item.kind === 'export' && String(item.name || '') === args.symbol) {
        add('publicApi', 'high', 'declaration.kind', 'The target declaration is structurally labelled as an export.');
    }
    if (roles.write === true) {
        add('state', 'high', 'scip.roles.write', 'SCIP marks this target occurrence as a write access.');
    } else if (item.kind === 'assignment' && (item.astValidated === true || metadata.astValidated === true)) {
        add('state', 'medium', 'reference.assignment', 'An AST-validated target occurrence is an assignment.');
    }
    if (roles.test === true) {
        add('tests', 'high', 'scip.roles.test', 'SCIP marks this target occurrence as test code.');
    }

    const conventional = `${path} ${String(item.kind || '').slice(0, 80)} ${String(item.context || '').slice(0, 200)}`.toLowerCase();
    if (/(^|[/_.-])(public|api|index)([/_.-]|$)|\bexport\b/.test(conventional)) {
        add(
            'publicApi',
            'low',
            'fallback.naming',
            'A conventional public/api/index/export name matched, but no target-specific export was proved.',
            true
        );
    }
    if (/(^|[/_.-])(state|store|reducer|schema|migration|database|db)([/_.-]|$)/.test(conventional)) {
        add(
            'state',
            'low',
            'fallback.naming',
            'A conventional state/store/schema/database name matched, but no write was proved.',
            true
        );
    }
    if (/(^|[/_.-])(registry|registries|plugin|plugins)([/_.-]|$)|\bregister(ed|ing)?\b/.test(conventional)) {
        add(
            'registry',
            'low',
            'fallback.naming',
            'A conventional registry/plugin/register name matched, but no registration mutation was proved.',
            true
        );
    }
    if (/(^|[/_.-])(__tests__|tests?|spec)([/_.-]|$)/.test(conventional)) {
        add(
            'tests',
            'low',
            'fallback.naming',
            'A conventional test/spec path matched, but no test declaration or test role was proved.',
            true
        );
    }
    return dedupeImpactSignalEvidence(evidence);
}

export function dedupeImpactSignalEvidence(items: ImpactSignalEvidence[]): ImpactSignalEvidence[] {
    const ordered = [...items].sort(
        (a, b) =>
            SIGNAL_ORDER.indexOf(a.signal) - SIGNAL_ORDER.indexOf(b.signal) ||
            Number(a.fallback) - Number(b.fallback) ||
            CONFIDENCE_WEIGHT[b.confidence] - CONFIDENCE_WEIGHT[a.confidence] ||
            a.path.localeCompare(b.path) ||
            a.provenance.localeCompare(b.provenance) ||
            a.reason.localeCompare(b.reason)
    );
    const seen = new Set<string>();
    return ordered.filter((item) => {
        const key = `${item.signal}:${item.path}:${item.provenance}:${item.reason}:${item.fallback}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
