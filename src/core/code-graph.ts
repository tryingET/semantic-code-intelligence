import * as path from 'path';
import Parser, { Query } from 'tree-sitter';
import { AsyncEnhancedGrep } from '../layers/enhanced-search-tools-async.js';
import {
    callQueryForLanguage,
    enclosingCallableForNode,
    exportQueryForLanguage,
    findSymbolBodies,
    importQueryForLanguage,
    includeExportCapture,
    insideAny,
    languageGraphLimitations,
    loadLanguageForFile,
} from './code-graph-language.js';
import { openWorkspaceFileForRead, resolveWorkspacePath } from './workspace-path.js';

export async function expandNeighbors(opts: {
    file?: string;
    symbol?: string;
    edges: string[];
    depth?: number;
    limit?: number;
    seedFiles?: string[];
    seedStrict?: boolean;
    workspaceRoot?: string;
}) {
    const edges = opts.edges && opts.edges.length ? opts.edges : ['imports', 'exports'];
    const limit = Math.max(1, Math.min(Number(opts.limit || 200) || 200, 1000));
    const workspaceRoot = path.resolve(opts.workspaceRoot || process.cwd());
    if (opts.file) {
        const opened = await openWorkspaceFileForRead(opts.file, { workspaceRoot, inputLabel: 'graph_expand file' });
        const res: any = { file: opened.realPath, neighbors: {} as Record<string, any[]> };
        let text: string;
        try {
            text = await opened.handle.readFile('utf8');
        } finally {
            await opened.handle.close().catch(() => undefined);
        }
        const { id, lang } = await loadLanguageForFile(opened.realPath);
        const parser = new Parser();
        parser.setLanguage(lang);
        const tree = parser.parse(text);
        const notes: string[] = [...languageGraphLimitations(id)];

        const by = (edge: string, qstr: string, include?: (node: any) => boolean) => {
            const q = new Query(lang, qstr);
            const caps = q.captures(tree.rootNode);
            const items: any[] = [];
            for (const c of caps) {
                const n = c.node;
                if (include && !include(n)) continue;
                items.push({
                    capture: c.name,
                    text: n.text,
                    start: { line: n.startPosition.row, column: n.startPosition.column },
                    end: { line: n.endPosition.row, column: n.endPosition.column },
                });
                if (items.length >= limit) break;
            }
            res.neighbors[edge] = items;
        };
        if (edges.includes('imports')) by('imports', importQueryForLanguage(id));
        if (edges.includes('exports')) {
            const exportQuery = exportQueryForLanguage(id);
            if (exportQuery) by('exports', exportQuery, (node) => includeExportCapture(id, node));
        }
        if (edges.includes('callees')) {
            // Extract callees within file (best-effort). If a symbol is supplied, keep
            // the evidence scoped to that literal symbol; do not silently widen a missing
            // or malformed symbol to file-wide callees.
            const hasSymbolScope = typeof opts.symbol === 'string' && opts.symbol.length > 0;
            const symbolBodies = hasSymbolScope ? findSymbolBodies(opts.symbol as string, id, lang, tree) : [];
            if (hasSymbolScope && symbolBodies.length === 0) {
                notes.push('callees: requested symbol not found in file; scoped callee extraction unavailable');
            }
            const CALLS = new Query(lang, callQueryForLanguage(id));
            const caps = CALLS.captures(tree.rootNode);
            const items: any[] = [];
            for (const c of caps) {
                const n = c.node;
                if (c.name === 'call.func' || c.name === 'call.method' || c.name === 'call.macro') {
                    if (hasSymbolScope && (symbolBodies.length === 0 || !insideAny(n, symbolBodies))) continue;
                    items.push({ name: n.text, start: { line: n.startPosition.row, column: n.startPosition.column } });
                    if (items.length >= limit) break;
                }
            }
            res.neighbors.callees = items;
        }
        if (edges.includes('callers')) {
            res.neighbors.callers = [];
            const sym = typeof opts.symbol === 'string' ? opts.symbol : '';
            if (!sym) {
                notes.push(
                    'callers: symbol required (pass symbol for cross-file callers or pass file+symbol for in-file callers)'
                );
            } else {
                // In-file callers (call sites) for the provided literal symbol. Capture
                // candidate call names and filter in code rather than interpolating the
                // caller-controlled symbol into tree-sitter query predicates.
                try {
                    const Q = new Query(lang, callQueryForLanguage(id));
                    const caps = Q.captures(tree.rootNode);
                    for (const cap of caps) {
                        const n = cap.node;
                        if (
                            (cap.name !== 'call.func' && cap.name !== 'call.method' && cap.name !== 'call.macro') ||
                            n.text !== sym
                        )
                            continue;
                        const caller = enclosingCallableForNode(n);
                        res.neighbors.callers.push({
                            file: res.file,
                            start: { line: n.startPosition.row, column: n.startPosition.column },
                            caller: caller?.name || null,
                            callerKind: caller?.kind || null,
                        });
                        if (res.neighbors.callers.length >= limit) break;
                    }
                } catch {
                    notes.push('callers: failed to extract in-file call sites');
                }
            }
        }
        if (notes.length) {
            res.note = notes.join('; ');
        }
        return res;
    }
    if (opts.symbol) {
        const symbol = opts.symbol;
        const neighbors: any = { callers: [], callees: [], imports: [], exports: [] };
        const notes: string[] = [];
        // Best-effort callers: grep for word-boundary matches and confirm via AST
        const grep = new AsyncEnhancedGrep({ cacheSize: 500, cacheTTL: 30000 });
        // AsyncEnhancedGrep treats the pattern as a search string for this path;
        // AST filtering below is the authority for call/name matching. Avoid regex
        // word-boundary wrappers here because they become literal search text and
        // can erase both caller and definition seed candidates.
        const pattern = symbol;
        const max = Math.min(limit, 1000);
        const containedSeedFiles: string[] = [];
        for (const seedFile of opts.seedFiles || []) {
            try {
                const resolved = await resolveWorkspacePath(seedFile, {
                    workspaceRoot,
                    inputLabel: 'graph_expand seedFile',
                });
                containedSeedFiles.push(resolved.realPath);
            } catch {}
        }
        const seedSearchPaths = containedSeedFiles.length
            ? Array.from(new Set(containedSeedFiles.map((f) => path.dirname(f))))
            : [];
        const searchPaths: string[] = edges.includes('callers')
            ? Array.from(new Set([...seedSearchPaths, workspaceRoot]))
            : seedSearchPaths.length
              ? seedSearchPaths
              : [workspaceRoot];
        let accMatches: any[] = [];
        for (const p of searchPaths) {
            const perPathMax = opts.seedStrict ? max : Math.max(1, Math.floor(max / searchPaths.length));
            const part = await grep.search({
                pattern,
                path: p,
                maxResults: perPathMax,
                timeout: 2000,
                caseInsensitive: false,
            });
            accMatches = accMatches.concat(part);
            if (accMatches.length >= max) break;
        }
        const matches = accMatches;
        const files = Array.from(new Set(matches.map((m) => m.file))).slice(0, 200);
        let foundDefinitionBodies = false;
        for (const file of files) {
            try {
                const opened = await openWorkspaceFileForRead(file, {
                    workspaceRoot,
                    inputLabel: 'graph_expand search result',
                });
                let text: string;
                try {
                    text = await opened.handle.readFile('utf8');
                } finally {
                    await opened.handle.close().catch(() => undefined);
                }
                const { id, lang } = await loadLanguageForFile(opened.realPath);
                const parser = new Parser();
                parser.setLanguage(lang);
                const tree = parser.parse(text);
                const Q = new Query(lang, callQueryForLanguage(id));
                const caps = Q.captures(tree.rootNode);
                const symbolBodies = edges.includes('callees') ? findSymbolBodies(symbol, id, lang, tree) : [];
                if (symbolBodies.length > 0) foundDefinitionBodies = true;
                for (const cap of caps) {
                    const n = cap.node;
                    if (cap.name !== 'call.func' && cap.name !== 'call.method' && cap.name !== 'call.macro') continue;
                    if (edges.includes('callers') && n.text === symbol) {
                        const caller = enclosingCallableForNode(n);
                        neighbors.callers.push({
                            file,
                            start: { line: n.startPosition.row, column: n.startPosition.column },
                            caller: caller?.name || null,
                            callerKind: caller?.kind || null,
                        });
                    }
                    if (edges.includes('callees') && symbolBodies.length > 0 && insideAny(n, symbolBodies)) {
                        neighbors.callees.push({
                            file,
                            name: n.text,
                            start: { line: n.startPosition.row, column: n.startPosition.column },
                        });
                    }
                    if (neighbors.callers.length >= limit && neighbors.callees.length >= limit) break;
                }
                if (neighbors.callers.length > limit) neighbors.callers = neighbors.callers.slice(0, limit);
                if (neighbors.callees.length > limit) neighbors.callees = neighbors.callees.slice(0, limit);
                if (
                    neighbors.callers.length >= limit &&
                    (!edges.includes('callees') || neighbors.callees.length >= limit)
                )
                    break;
            } catch {}
        }
        if (edges.includes('callees')) {
            if (!foundDefinitionBodies) {
                notes.push(
                    'callees: symbol definition body not found in bounded candidate files; scoped callee extraction unavailable'
                );
            } else {
                notes.push(
                    'callees: symbol-only callees are syntactic and scoped to bounded candidate definition files; not whole-program typed call graph evidence'
                );
            }
        }
        if (edges.some((e) => e === 'imports' || e === 'exports')) {
            notes.push('imports/exports: provide file to extract import/export neighbors');
        }
        const out: any = { symbol, neighbors };
        if (notes.length) out.note = notes.join('; ');
        return out;
    }
    throw new Error('file or symbol required');
}
