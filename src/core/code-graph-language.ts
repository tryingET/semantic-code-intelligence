import * as path from 'path';
import { Query } from 'tree-sitter';

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

export async function loadLanguageForFile(file: string): Promise<{ id: GraphLanguage; lang: any }> {
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
  (import_statement source: (string) @import.source)
  (import_statement (import_clause (identifier) @import.default))
  (import_specifier name: (identifier) @import.name)
  (import_specifier alias: (identifier) @import.alias)
  (namespace_import (identifier) @import.namespace)
`;
const TS_EXPORTS = `
  (export_statement declaration: (function_declaration name: (identifier) @export.func))
  (export_statement declaration: (class_declaration name: (type_identifier) @export.class))
  (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @export.var)))
  (export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @export.var)))
  (export_statement (export_clause (export_specifier name: (identifier) @export.name)))
  (export_statement (export_clause (export_specifier alias: (identifier) @export.alias)))
  (export_statement value: (_) @export.default)
`;

const PY_IMPORTS = `
  (import_statement name: (dotted_name) @import.module)
  (import_from_statement module_name: (dotted_name) @import.from name: (dotted_name) @import.name)
  (import_from_statement module_name: (dotted_name) @import.from name: (aliased_import name: (dotted_name) @import.name alias: (identifier) @import.alias))
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

export function importQueryForLanguage(id: GraphLanguage): string {
    if (id === 'python') return PY_IMPORTS;
    if (id === 'rust') return RUST_IMPORTS;
    if (id === 'go') return GO_IMPORTS;
    return TS_IMPORTS;
}

export function exportQueryForLanguage(id: GraphLanguage): string | null {
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
      (variable_declarator name: (identifier) @sym.name value: (arrow_function body: (_) @sym.body))
      (variable_declarator name: (identifier) @sym.name value: (function_expression body: (statement_block) @sym.body))
    `;
}

export function callQueryForLanguage(id: GraphLanguage): string {
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

export function enclosingCallableForNode(node: any): { name: string; kind: string } | null {
    let cur = node?.parent;
    while (cur) {
        if (
            cur.type === 'function_declaration' ||
            cur.type === 'method_definition' ||
            cur.type === 'function_definition' ||
            cur.type === 'function_item' ||
            cur.type === 'method_declaration'
        ) {
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

export function insideAny(node: any, bodies: any[]): boolean {
    if (!bodies.length) return true;
    const s = node.startIndex ?? 0;
    const e = node.endIndex ?? 0;
    for (const b of bodies) {
        const bs = b.startIndex ?? 0;
        const be = b.endIndex ?? 0;
        if (s >= bs && e <= be) return true;
    }
    return false;
}

function symbolBodyForNameNode(nameNode: any): any {
    const parent = nameNode?.parent;
    const directBody = parent?.childForFieldName?.('body');
    if (directBody) return directBody;
    if (parent?.type === 'variable_declarator') {
        const value = parent.childForFieldName?.('value');
        if (value?.type === 'arrow_function' || value?.type === 'function_expression') {
            return value.childForFieldName?.('body') || value;
        }
    }
    return null;
}

export function findSymbolBodies(symbol: string, id: GraphLanguage, lang: any, tree: any): any[] {
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
            const body = symbolBodyForNameNode(c.node);
            if (body && !seen.has(body)) {
                seen.add(body);
                bodies.push(body);
            }
        }
        return bodies;
    } catch {
        return [];
    }
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

export function includeExportCapture(id: GraphLanguage, node: any): boolean {
    if (!String(node?.text || '').trim()) return false;
    if (id === 'python') return isPythonTopLevelPublicName(node);
    if (id === 'go') return isGoExportedName(String(node.text));
    if (id === 'rust') return isRustPublicExport(node);
    return true;
}

export function languageGraphLimitations(id: GraphLanguage): string[] {
    if (id === 'python') {
        return [
            'python: export evidence is syntactic module-level public definitions/assignments; no __all__, package, import-resolution, or runtime API analysis is performed',
        ];
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
