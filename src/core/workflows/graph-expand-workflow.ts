import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { CoreError } from '../errors.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

type GraphExpandDependencies = {
    workspaceRoot: () => string;
    resolveWorkspaceFile: (value: string, inputLabel: string) => Promise<{ path: string }>;
    resolveWorkspaceLexicalPath: (value: string, inputLabel: string) => { relativePath: string };
    containedUriOrNull: (uri: string, inputLabel: string) => Promise<string | null>;
    buildSymbolMap?: (req: any) => Promise<any>;
};

export function inferGraphLanguage(seed: string | undefined) {
    const value = String(seed || '').toLowerCase();
    if (/\.(ts|tsx)$/.test(value)) return { language: 'typescript', support: 'tree_sitter_best_effort', supportedEdges: ['imports', 'exports', 'callers', 'callees'] };
    if (/\.(js|jsx)$/.test(value)) return { language: 'javascript', support: 'tree_sitter_best_effort', supportedEdges: ['imports', 'exports', 'callers', 'callees'] };
    if (/\.py$/.test(value)) return { language: 'python', support: 'tree_sitter_best_effort', supportedEdges: ['imports', 'exports', 'callers', 'callees'] };
    if (/\.rs$/.test(value)) return { language: 'rust', support: 'tree_sitter_best_effort', supportedEdges: ['imports', 'exports', 'callers', 'callees'] };
    if (/\.go$/.test(value)) return { language: 'go', support: 'tree_sitter_best_effort', supportedEdges: ['imports', 'exports', 'callers', 'callees'] };
    if (/\.(clj|cljs|cljc|java|rb|php|cs|cpp|c|h|hpp)$/.test(value)) return { language: value.replace(/^.*\./, ''), support: 'unsupported_extension', supportedEdges: [] };
    return seed
        ? { language: 'unknown', support: 'unknown_extension', supportedEdges: [] }
        : { language: 'symbol_seed', support: 'symbol_seed_best_effort', supportedEdges: ['callers', 'callees'] };
}

export function summarizeGraphImpact(out: any, args: Record<string, any>, workspaceRoot: string) {
    const neighbors = out?.neighbors && typeof out.neighbors === 'object' ? out.neighbors : {};
    const counts = Object.fromEntries(
        ['imports', 'exports', 'callers', 'callees'].map((edge) => [edge, Array.isArray(neighbors[edge]) ? neighbors[edge].length : 0])
    );
    const hasFileSeed = typeof args?.file === 'string' && args.file.trim().length > 0;
    const hasSymbolSeed = typeof args?.symbol === 'string' && args.symbol.trim().length > 0;
    const requestedEdges = Array.isArray(args?.edges) ? args.edges.map(String) : hasFileSeed ? ['imports', 'exports'] : ['callers', 'callees'];
    const languageSupport = out?.languageSupport && typeof out.languageSupport === 'object' ? out.languageSupport : inferGraphLanguage(hasFileSeed ? args.file : undefined);
    const note = typeof out?.note === 'string' ? out.note : '';
    const noteLimitations = note
        ? note
              .split(';')
              .map((part: string) => part.trim())
              .filter(Boolean)
        : [];
    const languageLimitations = requestedEdges
        .filter((edge: string) => !languageSupport.supportedEdges.includes(edge) && languageSupport.support !== 'symbol_seed_best_effort')
        .map((edge: string) => `${edge}: ${languageSupport.language} graph extraction is ${languageSupport.support}; supported edges: ${languageSupport.supportedEdges.join(', ') || 'none'}`);
    const depthLimitations = Number(args?.depth || 1) > 1 ? ['depth: recursive graph expansion is not implemented; returned evidence is one-hop best effort'] : [];
    const limitations = noteLimitations.concat(languageLimitations, depthLimitations);
    const evidence = requestedEdges.map((edge: string) => {
        const count = Number((counts as any)[edge] || 0);
        const edgeLimitations = limitations.filter((item: string) => item.toLowerCase().startsWith(`${edge.toLowerCase()}:`));
        return {
            edge,
            count,
            status: count > 0 ? 'evidence' : edgeLimitations.length > 0 ? 'limited' : 'empty_or_unavailable',
            limitations: edgeLimitations,
        };
    });
    const callerContextCount = Array.isArray(neighbors.callers) ? neighbors.callers.filter((item: any) => typeof item?.caller === 'string' && item.caller).length : 0;
    const fallbackUnavailable = noteLimitations.some((item: string) => item.toLowerCase().startsWith('fallback: graph expand unavailable'));
    const backend = out?.provenance?.backend
        ? String(out.provenance.backend)
        : fallbackUnavailable
          ? 'fallback'
          : languageSupport.support === 'tree_sitter_best_effort'
            ? 'tree_sitter'
            : languageSupport.support === 'symbol_seed_best_effort'
              ? 'fallback'
              : 'fallback';
    const provenance = {
        backend,
        freshness: out?.provenance?.freshness ? String(out.provenance.freshness) : backend === 'tree_sitter' ? 'current' : 'unknown',
        discoveryBackend: out?.provenance?.discoveryBackend !== undefined ? out.provenance.discoveryBackend : !hasFileSeed && hasSymbolSeed ? 'rg' : null,
        indexPath: out?.provenance?.indexPath ?? null,
        generatedAt: out?.provenance?.generatedAt ?? null,
        workspaceRoot: out?.provenance?.workspaceRoot ?? workspaceRoot,
        metadataSource: out?.provenance?.metadataSource ?? null,
    };
    return {
        seed: hasFileSeed ? { kind: 'file', value: args.file } : { kind: 'symbol', value: String(args?.symbol || '') },
        languageSupport,
        provenance,
        backend: provenance.backend,
        freshness: provenance.freshness,
        discoveryBackend: provenance.discoveryBackend,
        requestedEdges,
        counts,
        evidence,
        limitations,
        callerContextCount,
        hasImpactEvidence: evidence.some((item: any) => item.count > 0),
        planningHints: [
            'Inspect non-empty edges before editing touched files or exported symbols.',
            callerContextCount > 0
                ? 'Caller entries include best-effort enclosing callable context; verify with find_references before broad edits.'
                : 'Use find_references for symbol-specific caller confirmation when caller evidence is sparse.',
            limitations.length > 0
                ? 'Treat limited edges as fallback-shaped evidence and narrow with file+symbol or explicit references before relying on them.'
                : 'Use patch_checks_in_snapshot or safe_write after graph-informed patch planning.',
        ],
    };
}

export class GraphExpandWorkflowService {
    constructor(private readonly deps: GraphExpandDependencies) {}

    get workspaceRoot(): string {
        return this.deps.workspaceRoot();
    }

    private async expandGraphFromScip(args: Record<string, any>, edges: string[], file?: string, symbol?: string) {
        const scipIndexPath = typeof args?.scipIndexPath === 'string' && args.scipIndexPath.trim() ? args.scipIndexPath.trim() : '';
        if (!scipIndexPath) return null;

        const { loadScipIndex } = await import('../scip-reader.js');
        const reader = await loadScipIndex(scipIndexPath, { workspaceRoot: this.workspaceRoot });
        const summary = reader.summary();
        const limit = Math.max(1, Math.min(Number(args?.limit || 50) || 50, 1000));
        const neighbors: Record<string, any[]> = { imports: [], exports: [], callers: [], callees: [] };
        const notes: string[] = [];

        const toItem = (occurrence: any) => ({
            file: occurrence.file,
            symbol: occurrence.symbol,
            language: occurrence.language,
            start: occurrence.range.start,
            end: occurrence.range.end,
            roles: occurrence.roles,
        });

        if (file) {
            const fileOccurrences = reader.occurrencesForFile(file);
            if (edges.includes('imports')) neighbors.imports = fileOccurrences.filter((occurrence) => occurrence.roles.import).slice(0, limit).map(toItem);
            if (edges.includes('exports')) neighbors.exports = fileOccurrences.filter((occurrence) => occurrence.roles.definition).slice(0, limit).map(toItem);
        } else {
            if (edges.includes('imports')) notes.push('imports: SCIP import extraction requires a file seed');
            if (edges.includes('exports') && !symbol) notes.push('exports: SCIP definition extraction requires a file or symbol seed');
        }

        if (symbol) {
            if (edges.includes('exports')) neighbors.exports = reader.definitions(symbol).slice(0, limit).map(toItem);
            if (edges.includes('callers')) {
                neighbors.callers = reader.references(symbol).slice(0, limit).map((occurrence) => ({
                    ...toItem(occurrence),
                    caller: null,
                    callerKind: null,
                }));
                notes.push('callers: SCIP backend returns symbol references, not proven call sites');
            }
        } else if (edges.includes('callers')) {
            notes.push('callers: SCIP reference extraction requires a symbol seed');
        }

        if (edges.includes('callees')) notes.push('callees: SCIP reader does not infer callee edges yet');

        const out: any = file ? { file: path.resolve(file), neighbors } : { symbol: symbol || '', neighbors };
        if (notes.length) out.note = notes.join('; ');
        out.scip = summary;
        out.languageSupport = {
            language: file ? inferGraphLanguage(file).language : 'symbol_seed',
            support: 'scip_index',
            supportedEdges: ['imports', 'exports', 'callers'],
        };
        out.provenance = {
            backend: 'scip',
            freshness: 'unknown',
            discoveryBackend: null,
            indexPath: summary.indexPath,
            generatedAt: summary.generatedAt,
            workspaceRoot: summary.workspaceRoot || this.workspaceRoot,
            metadataSource: null,
        };
        return out;
    }

    async graphExpand(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const rawFile = typeof args?.file === 'string' ? (args.file as string) : undefined;
        const symbol = typeof args?.symbol === 'string' ? (args.symbol as string) : undefined;
        const edges = Array.isArray(args?.edges) ? (args.edges as string[]) : rawFile ? ['imports', 'exports'] : ['callers', 'callees'];
        if (!rawFile && !symbol) return { text: 'file or symbol required', isError: true };
        let file: string | undefined;
        let scipFile: string | undefined;
        const hasScipIndex = typeof args?.scipIndexPath === 'string' && args.scipIndexPath.trim();
        try {
            if (rawFile && hasScipIndex) {
                scipFile = this.deps.resolveWorkspaceLexicalPath(rawFile, 'graph_expand file').relativePath;
            } else if (rawFile) {
                file = (await this.deps.resolveWorkspaceFile(rawFile, 'graph_expand file')).path;
            }
            const scipOut = await this.expandGraphFromScip(args, edges, scipFile || file, symbol);
            if (scipOut) {
                return { payload: { schemaVersion: 2, ...scipOut, impactSummary: summarizeGraphImpact(scipOut, args, this.workspaceRoot) }, isError: false };
            }

            const { expandNeighbors } = await import('../code-graph.js');
            let seedFiles: string[] | undefined;
            if (symbol && this.deps.buildSymbolMap) {
                try {
                    const sm = await this.deps.buildSymbolMap({
                        identifier: symbol,
                        maxFiles: 50,
                        astOnly: true,
                    });
                    const containedSeedFiles: string[] = [];
                    for (const declaration of sm?.declarations || []) {
                        const uri = typeof declaration?.uri === 'string' ? declaration.uri : '';
                        const contained = uri ? await this.deps.containedUriOrNull(uri, 'graph_expand seedFile') : null;
                        if (contained) containedSeedFiles.push(fileURLToPath(contained));
                    }
                    seedFiles = Array.from(new Set(containedSeedFiles));
                } catch {}
            }
            if (rawFile && !file) {
                file = (await this.deps.resolveWorkspaceFile(rawFile, 'graph_expand file')).path;
            }
            const out = await expandNeighbors({
                file,
                symbol,
                edges,
                depth: args?.depth,
                limit: args?.limit,
                seedFiles,
                workspaceRoot: this.workspaceRoot,
            });
            return { payload: { schemaVersion: 2, ...out, impactSummary: summarizeGraphImpact(out, args, this.workspaceRoot) }, isError: false };
        } catch (error) {
            if (error instanceof CoreError || (typeof args?.scipIndexPath === 'string' && args.scipIndexPath.trim())) {
                throw error;
            }
            const neighbors: Record<string, any[]> = { imports: [], exports: [], callers: [], callees: [] };
            const note = 'fallback: graph expand unavailable; returning empty neighbors';
            const out = file ? { file, neighbors, note } : { symbol: symbol || '', neighbors, note };
            return { payload: { schemaVersion: 2, ...out, impactSummary: summarizeGraphImpact(out, args, this.workspaceRoot) }, isError: false };
        }
    }
}
