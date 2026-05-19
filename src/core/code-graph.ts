import * as path from 'path';
import Parser, { Query } from 'tree-sitter';
import { AsyncEnhancedGrep } from '../layers/enhanced-search-tools-async.js';
import { openWorkspaceFileForRead, resolveWorkspacePath } from './workspace-path.js';

function findModulePath(moduleName: string): string {
    const candidates = [
        moduleName,
        path.join(process.cwd(), 'node_modules', moduleName),
        path.join(process.cwd(), '..', 'node_modules', moduleName),
        path.join(process.cwd(), '..', '..', 'node_modules', moduleName),
    ];
    for (const p of candidates) {
        try {
            require.resolve(p);
            return p;
        } catch {}
    }
    throw new Error(`Cannot find module ${moduleName}`);
}

async function loadLanguageForFile(file: string) {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        const mod = require(findModulePath('tree-sitter-typescript'));
        return { id: 'typescript', lang: mod.typescript } as const;
    }
    if (file.endsWith('.js') || file.endsWith('.jsx')) {
        const mod = require(findModulePath('tree-sitter-javascript'));
        return { id: 'javascript', lang: mod } as const;
    }
    if (file.endsWith('.py')) {
        const mod = require(findModulePath('tree-sitter-python'));
        return { id: 'python', lang: mod } as const;
    }
    throw new Error(`Unsupported file type: ${file}`);
}

const TS_IMPORTS = `
 (import_statement
   source: (string) @import.source
   (import_clause
     (named_imports (import_specifier name: (identifier) @import.name alias: (identifier)? @import.alias)*)?
     (namespace_import (identifier) @import.namespace)?
     (identifier)? @import.default)?)
`;
const TS_EXPORTS = `
 (export_statement
   (function_declaration name: (identifier) @export.func)?
   (class_declaration name: (type_identifier) @export.class)?
   (variable_declaration (variable_declarator name: (identifier) @export.var))?
   declaration: (_)? @export.decl)
`;

const PY_IMPORTS = `
  (import_statement name: (dotted_name) @import.module)
  (import_from_statement module_name: (dotted_name) @import.from name: (dotted_name) @import.name)
`;

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
        const notes: string[] = [];

        const insideAny = (node: any, bodies: any[]): boolean => {
            if (!bodies.length) return true;
            const s = node.startIndex ?? 0;
            const e = node.endIndex ?? 0;
            for (const b of bodies) {
                const bs = b.startIndex ?? 0;
                const be = b.endIndex ?? 0;
                if (s >= bs && e <= be) return true;
            }
            return false;
        };

        const findSymbolBodies = (symbol: string): any[] => {
            if (!symbol) return [];
            // Best-effort for TS/JS: function and method bodies only (keep bounded and predictable)
            if (id !== 'typescript' && id !== 'javascript') return [];
            try {
                const Q = new Query(
                    lang,
                    `
                      (function_declaration name: (identifier) @sym.name (#eq? @sym.name "${symbol}") body: (statement_block) @sym.body)
                      (method_definition name: (property_identifier) @sym.name (#eq? @sym.name "${symbol}") body: (statement_block) @sym.body)
                    `
                );
                const caps = Q.captures(tree.rootNode);
                const bodies: any[] = [];
                for (const c of caps) {
                    if (c.name === 'sym.body') bodies.push(c.node);
                }
                return bodies;
            } catch {
                return [];
            }
        };

        const enclosingCallable = (node: any): { name: string; kind: string } | null => {
            let cur = node?.parent;
            while (cur) {
                if (cur.type === 'function_declaration' || cur.type === 'method_definition') {
                    const nameNode = cur.childForFieldName?.('name');
                    if (nameNode?.text) return { name: nameNode.text, kind: cur.type };
                }
                if (cur.type === 'variable_declarator') {
                    const nameNode = cur.childForFieldName?.('name');
                    if (nameNode?.text) return { name: nameNode.text, kind: cur.type };
                }
                cur = cur.parent;
            }
            return null;
        };

        const by = (edge: string, qstr: string) => {
            const q = new Query(lang, qstr);
            const caps = q.captures(tree.rootNode);
            const items: any[] = [];
            for (const c of caps) {
                const n = c.node;
                items.push({
                    capture: c.name,
                    text: n.text,
                    start: { line: n.startPosition.row, column: n.startPosition.column },
                    end: { line: n.endPosition.row, column: n.endPosition.column },
                });
            }
            res.neighbors[edge] = items;
        };
        if (edges.includes('imports')) by('imports', id === 'python' ? PY_IMPORTS : TS_IMPORTS);
        if (edges.includes('exports') && id !== 'python') by('exports', TS_EXPORTS);
        if (edges.includes('callees')) {
            // Extract callees within file (best-effort)
            const symbolBodies = typeof opts.symbol === 'string' && opts.symbol ? findSymbolBodies(opts.symbol) : [];
            if (typeof opts.symbol === 'string' && opts.symbol && symbolBodies.length === 0) {
                notes.push(`callees: symbol "${opts.symbol}" not found in file; returning file-wide callees`);
            }
            const CALLS = new Query(
                lang,
                `
        (call_expression
          function: (identifier) @call.func
          arguments: (arguments) @call.args)

        (call_expression
          function: (member_expression
            object: (identifier) @call.object
            property: (property_identifier) @call.method)
          arguments: (arguments) @call.args)
      `
            );
            const caps = CALLS.captures(tree.rootNode);
            const items: any[] = [];
            for (const c of caps) {
                const n = c.node;
                if (c.name === 'call.func' || c.name === 'call.method') {
                    if (!insideAny(n, symbolBodies)) continue;
                    items.push({ name: n.text, start: { line: n.startPosition.row, column: n.startPosition.column } });
                }
            }
            res.neighbors.callees = items;
        }
        if (edges.includes('callers')) {
            res.neighbors.callers = [];
            const sym = typeof opts.symbol === 'string' ? opts.symbol : '';
            if (!sym) {
                notes.push('callers: symbol required (pass symbol for cross-file callers or pass file+symbol for in-file callers)');
            } else {
                // In-file callers (call sites) for the provided symbol
                try {
                    const Q = new Query(
                        lang,
                        `
                          (call_expression function: (identifier) @f (#eq? @f "${sym}"))
                          (call_expression function: (member_expression property: (property_identifier) @m (#eq? @m "${sym}")))
                        `
                    );
                    const caps = Q.captures(tree.rootNode);
                    for (const cap of caps) {
                        const n = cap.node;
                        const caller = enclosingCallable(n);
                        res.neighbors.callers.push({
                            file: res.file,
                            start: { line: n.startPosition.row, column: n.startPosition.column },
                            caller: caller?.name || null,
                            callerKind: caller?.kind || null,
                        });
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
        const pattern = `\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
        const max = Math.min(opts.limit || 200, 1000);
        const containedSeedFiles: string[] = [];
        for (const seedFile of opts.seedFiles || []) {
            try {
                const resolved = await resolveWorkspacePath(seedFile, { workspaceRoot, inputLabel: 'graph_expand seedFile' });
                containedSeedFiles.push(resolved.realPath);
            } catch {}
        }
        const searchPaths: string[] = containedSeedFiles.length
            ? Array.from(new Set(containedSeedFiles.map((f) => path.dirname(f))))
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
        for (const file of files) {
            try {
                const opened = await openWorkspaceFileForRead(file, { workspaceRoot, inputLabel: 'graph_expand search result' });
                let text: string;
                try {
                    text = await opened.handle.readFile('utf8');
                } finally {
                    await opened.handle.close().catch(() => undefined);
                }
                const { lang } = await loadLanguageForFile(opened.realPath);
                const parser = new Parser();
                parser.setLanguage(lang);
                const tree = parser.parse(text);
                const Q = new Query(
                    lang,
                    `
          (call_expression function: (identifier) @f (#eq? @f "${symbol}"))
          (call_expression function: (member_expression property: (property_identifier) @m (#eq? @m "${symbol}")))
        `
                );
                const caps = Q.captures(tree.rootNode);
                const enclosingCallable = (node: any): { name: string; kind: string } | null => {
                    let cur = node?.parent;
                    while (cur) {
                        if (cur.type === 'function_declaration' || cur.type === 'method_definition') {
                            const nameNode = cur.childForFieldName?.('name');
                            if (nameNode?.text) return { name: nameNode.text, kind: cur.type };
                        }
                        if (cur.type === 'variable_declarator') {
                            const nameNode = cur.childForFieldName?.('name');
                            if (nameNode?.text) return { name: nameNode.text, kind: cur.type };
                        }
                        cur = cur.parent;
                    }
                    return null;
                };
                for (const cap of caps) {
                    const n = cap.node;
                    const caller = enclosingCallable(n);
                    neighbors.callers.push({
                        file,
                        start: { line: n.startPosition.row, column: n.startPosition.column },
                        caller: caller?.name || null,
                        callerKind: caller?.kind || null,
                    });
                }
                if (neighbors.callers.length >= (opts.limit || 200)) break;
            } catch {}
        }
        if (edges.includes('callees')) {
            notes.push('callees: provide file+symbol to scope callees extraction to a definition body (symbol-only callees is not implemented yet)');
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
