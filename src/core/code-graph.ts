import * as path from 'path';
import Parser, { Query } from 'tree-sitter';
import { AsyncEnhancedGrep } from '../layers/enhanced-search-tools-async.js';
import { openWorkspaceFileForRead, resolveWorkspacePath } from './workspace-path.js';

type GraphLanguage = 'typescript' | 'javascript' | 'python' | 'rust' | 'go';

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

function resolveLanguageExport(mod: any) {
    return mod?.language ?? mod?.default?.language ?? mod?.default ?? mod;
}

async function loadLanguageForFile(file: string): Promise<{ id: GraphLanguage; lang: any }> {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        const mod = require(findModulePath('tree-sitter-typescript'));
        return { id: 'typescript', lang: mod.typescript };
    }
    if (file.endsWith('.js') || file.endsWith('.jsx')) {
        const mod = require(findModulePath('tree-sitter-javascript'));
        return { id: 'javascript', lang: resolveLanguageExport(mod) };
    }
    if (file.endsWith('.py')) {
        const mod = require(findModulePath('tree-sitter-python'));
        return { id: 'python', lang: resolveLanguageExport(mod) };
    }
    if (file.endsWith('.rs')) {
        const mod = require(findModulePath('tree-sitter-rust'));
        return { id: 'rust', lang: resolveLanguageExport(mod) };
    }
    if (file.endsWith('.go')) {
        const mod = require(findModulePath('tree-sitter-go'));
        return { id: 'go', lang: resolveLanguageExport(mod) };
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

const PY_EXPORTS = `
  (function_definition name: (identifier) @export.func)
  (class_definition name: (identifier) @export.class)
  (assignment left: (identifier) @export.var)
`;

const RUST_IMPORTS = `
  (use_declaration) @import.declaration
`;

const RUST_EXPORTS = `
  (function_item name: (identifier) @export.func)
  (struct_item name: (type_identifier) @export.struct)
  (enum_item name: (type_identifier) @export.enum)
  (trait_item name: (type_identifier) @export.trait)
  (mod_item name: (identifier) @export.module)
`;

const GO_IMPORTS = `
  (import_spec) @import.spec
  (import_spec path: (_) @import.path)
`;

const GO_EXPORTS = `
  (function_declaration name: (identifier) @export.func)
  (method_declaration name: (field_identifier) @export.method)
  (type_declaration (type_spec name: (type_identifier) @export.type))
  (const_declaration (const_spec name: (identifier) @export.const))
  (var_declaration (var_spec name: (identifier) @export.var))
`;

function importQueryForLanguage(id: GraphLanguage): string {
    if (id === 'python') return PY_IMPORTS;
    if (id === 'rust') return RUST_IMPORTS;
    if (id === 'go') return GO_IMPORTS;
    return TS_IMPORTS;
}

function exportQueryForLanguage(id: GraphLanguage): string | null {
    if (id === 'python') return PY_EXPORTS;
    if (id === 'rust') return RUST_EXPORTS;
    if (id === 'go') return GO_EXPORTS;
    return TS_EXPORTS;
}

function symbolBodyQueryForLanguage(id: GraphLanguage): string | null {
    if (id === 'rust') {
        return `(function_item name: (identifier) @sym.name body: (block) @sym.body)`;
    }
    if (id === 'go') {
        return `
          (function_declaration name: (identifier) @sym.name body: (block) @sym.body)
          (method_declaration name: (field_identifier) @sym.name body: (block) @sym.body)
        `;
    }
    if (id === 'python') {
        return `(function_definition name: (identifier) @sym.name body: (block) @sym.body)`;
    }
    return `
      (function_declaration name: (identifier) @sym.name body: (statement_block) @sym.body)
      (method_definition name: (property_identifier) @sym.name body: (statement_block) @sym.body)
    `;
}

function callQueryForLanguage(id: GraphLanguage): string {
    if (id === 'rust') {
        return `
          (call_expression function: (identifier) @call.func)
          (call_expression function: (scoped_identifier name: (identifier) @call.func))
          (call_expression function: (field_expression field: (field_identifier) @call.method))
          (macro_invocation macro: (identifier) @call.macro)
        `;
    }
    if (id === 'go') {
        return `
          (call_expression function: (identifier) @call.func)
          (call_expression function: (selector_expression field: (field_identifier) @call.method))
        `;
    }
    if (id === 'python') {
        return `
          (call function: (identifier) @call.func)
          (call function: (attribute attribute: (identifier) @call.method))
        `;
    }
    return `
      (call_expression
        function: (identifier) @call.func
        arguments: (arguments) @call.args)

      (call_expression
        function: (member_expression
          object: (identifier) @call.object
          property: (property_identifier) @call.method)
        arguments: (arguments) @call.args)
    `;
}

function enclosingCallableForNode(node: any): { name: string; kind: string } | null {
    let cur = node?.parent;
    while (cur) {
        if (cur.type === 'function_declaration' || cur.type === 'method_definition' || cur.type === 'function_definition' || cur.type === 'function_item' || cur.type === 'method_declaration') {
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
}

function isGoExportedName(name: string): boolean {
    return /^[A-Z]/.test(name);
}

function isPythonTopLevelPublicName(node: any): boolean {
    const name = String(node?.text || '');
    if (!name || name.startsWith('_')) return false;
    const parent = node?.parent;
    if (!parent) return false;
    if (parent.type === 'function_definition' || parent.type === 'class_definition') {
        return parent.parent?.type === 'module';
    }
    if (parent.type === 'assignment') {
        return parent.parent?.type === 'expression_statement' && parent.parent?.parent?.type === 'module';
    }
    return false;
}

function rustDeclarationNode(node: any): any {
    let cur = node?.parent;
    while (cur) {
        if (['function_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item'].includes(cur.type)) return cur;
        cur = cur.parent;
    }
    return node?.parent;
}

function isRustPublicExport(node: any): boolean {
    const declaration = rustDeclarationNode(node);
    return /^\s*pub(\b|\()/.test(String(declaration?.text || ''));
}

function includeExportCapture(id: GraphLanguage, node: any): boolean {
    if (!String(node?.text || '').trim()) return false;
    if (id === 'python') return isPythonTopLevelPublicName(node);
    if (id === 'go') return isGoExportedName(String(node.text));
    if (id === 'rust') return isRustPublicExport(node);
    return true;
}

function languageGraphLimitations(id: GraphLanguage): string[] {
    if (id === 'python') {
        return ['python: export evidence is syntactic module-level public definitions/assignments; no __all__, package, import-resolution, or runtime API analysis is performed'];
    }
    if (id === 'rust') {
        return [
            'rust: tree-sitter graph evidence is syntactic; no type-aware method resolution, trait dispatch, module/crate resolution, or macro expansion is performed',
        ];
    }
    if (id === 'go') {
        return [
            'go: tree-sitter graph evidence is syntactic; no package/module resolution, interface dispatch, build-tag evaluation, or type-aware selector resolution is performed',
        ];
    }
    return [];
}

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
            const qstr = symbolBodyQueryForLanguage(id);
            if (!qstr) return [];
            try {
                const Q = new Query(lang, qstr);
                const caps = Q.captures(tree.rootNode);
                const bodies: any[] = [];
                const seen = new Set<any>();
                for (const c of caps) {
                    if (c.name !== 'sym.name' || c.node.text !== symbol) continue;
                    const body = c.node.parent?.childForFieldName?.('body');
                    if (body && !seen.has(body)) {
                        seen.add(body);
                        bodies.push(body);
                    }
                }
                return bodies;
            } catch {
                return [];
            }
        };

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
            const symbolBodies = hasSymbolScope ? findSymbolBodies(opts.symbol as string) : [];
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
                notes.push('callers: symbol required (pass symbol for cross-file callers or pass file+symbol for in-file callers)');
            } else {
                // In-file callers (call sites) for the provided literal symbol. Capture
                // candidate call names and filter in code rather than interpolating the
                // caller-controlled symbol into tree-sitter query predicates.
                try {
                    const Q = new Query(lang, callQueryForLanguage(id));
                    const caps = Q.captures(tree.rootNode);
                    for (const cap of caps) {
                        const n = cap.node;
                        if ((cap.name !== 'call.func' && cap.name !== 'call.method' && cap.name !== 'call.macro') || n.text !== sym) continue;
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
        const pattern = `\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
        const max = Math.min(limit, 1000);
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
                const { id, lang } = await loadLanguageForFile(opened.realPath);
                const parser = new Parser();
                parser.setLanguage(lang);
                const tree = parser.parse(text);
                const Q = new Query(lang, callQueryForLanguage(id));
                const caps = Q.captures(tree.rootNode);
                for (const cap of caps) {
                    const n = cap.node;
                    if ((cap.name !== 'call.func' && cap.name !== 'call.method' && cap.name !== 'call.macro') || n.text !== symbol) continue;
                    const caller = enclosingCallableForNode(n);
                    neighbors.callers.push({
                        file,
                        start: { line: n.startPosition.row, column: n.startPosition.column },
                        caller: caller?.name || null,
                        callerKind: caller?.kind || null,
                    });
                }
                if (neighbors.callers.length >= limit) break;
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
