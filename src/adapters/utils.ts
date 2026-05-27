import * as nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Position, Range } from 'vscode-languageserver';
import type {
    CompletionRequest,
    CoreConfig,
    Definition,
    FindDefinitionRequest,
    FindReferencesRequest,
    Reference,
    RenameRequest,
} from '../core/types.js';
import { CoreError, type CoreErrorCode, isCoreError } from '../core/errors.js';
import { AnalyzerFactory } from '../core/analyzer-factory.js';

export function pathToUri(filePath: string): string {
    try {
        if (filePath.startsWith('file://')) return filePath;
        const abs = nodePath.isAbsolute(filePath) ? filePath : nodePath.resolve(process.cwd(), filePath);
        return pathToFileURL(abs).href;
    } catch {
        return filePath.startsWith('file://') ? filePath : '';
    }
}

export function uriToPath(uri: string): string {
    const WORKSPACE_PREFIX = 'file://workspace';
    const getWorkspaceRoot = () => process.env.SEMANTIC_CODE_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();
    if (uri.startsWith(WORKSPACE_PREFIX)) {
        const ws = getWorkspaceRoot();
        const sub = uri.length > WORKSPACE_PREFIX.length ? uri.substring(WORKSPACE_PREFIX.length) : '';
        const rel = sub.replace(/^\/+/, '');
        const p = rel ? nodePath.join(ws, rel) : ws;
        return nodePath.resolve(p);
    }
    if (uri.startsWith('file://')) {
        try {
            return fileURLToPath(uri);
        } catch {
            const body = uri.replace(/^file:\/\//, '');
            return nodePath.isAbsolute(body) ? body : nodePath.resolve('/', body);
        }
    }
    return nodePath.isAbsolute(uri) ? uri : nodePath.resolve(process.cwd(), uri);
}

export function normalizeUri(uri: string): string {
    return pathToUri(uriToPath(uri));
}

export function createPosition(line: number, character: number): Position {
    return { line: Math.max(0, line), character: Math.max(0, character) };
}

export function createRange(startLine: number, startChar: number, endLine: number, endChar: number): Range {
    return { start: createPosition(startLine, startChar), end: createPosition(endLine, endChar) };
}

export function normalizePosition(pos: any): Position {
    if (typeof pos === 'object' && pos) {
        if (typeof pos.line === 'number' && typeof pos.character === 'number')
            return createPosition(pos.line, pos.character);
        if (typeof pos.line === 'number' && typeof pos.col === 'number') return createPosition(pos.line, pos.col);
        if (typeof pos.row === 'number' && typeof pos.column === 'number') return createPosition(pos.row, pos.column);
    }
    throw new Error(`Invalid position format: ${JSON.stringify(pos)}`);
}

export function normalizeRange(range: any): Range {
    if (typeof range === 'object' && range) {
        if (range.start && range.end)
            return { start: normalizePosition(range.start), end: normalizePosition(range.end) };
        if (
            typeof range.startLine === 'number' &&
            typeof range.startChar === 'number' &&
            typeof range.endLine === 'number' &&
            typeof range.endChar === 'number'
        )
            return createRange(range.startLine, range.startChar, range.endLine, range.endChar);
    }
    throw new Error(`Invalid range format: ${JSON.stringify(range)}`);
}

export function buildFindDefinitionRequest(params: {
    uri: string;
    position: Position;
    identifier?: string;
    maxResults?: number;
    includeDeclaration?: boolean;
    precise?: boolean;
}): FindDefinitionRequest {
    return {
        uri: normalizeUri(params.uri),
        position: params.position,
        identifier: params.identifier || '',
        maxResults: params.maxResults,
        includeDeclaration: params.includeDeclaration ?? true,
        precise: params.precise,
    } as any;
}

export function buildFindReferencesRequest(params: {
    uri: string;
    position: Position;
    identifier?: string;
    maxResults?: number;
    includeDeclaration?: boolean;
    precise?: boolean;
}): FindReferencesRequest {
    return {
        uri: normalizeUri(params.uri),
        position: params.position,
        identifier: params.identifier || '',
        maxResults: params.maxResults,
        includeDeclaration: params.includeDeclaration ?? false,
        precise: params.precise,
    } as any;
}

export function buildPrepareRenameRequest(params: { uri: string; position: Position; identifier: string }) {
    return { uri: normalizeUri(params.uri), position: params.position, identifier: params.identifier } as any;
}

export function buildRenameRequest(params: {
    uri: string;
    position: Position;
    identifier: string;
    newName: string;
    dryRun?: boolean;
}): RenameRequest {
    return {
        uri: normalizeUri(params.uri),
        position: params.position,
        oldName: params.identifier,
        newName: params.newName,
        dryRun: params.dryRun ?? false,
    } as any;
}

export function buildCompletionRequest(params: {
    uri: string;
    position: Position;
    triggerCharacter?: string;
    maxResults?: number;
}): CompletionRequest {
    return {
        uri: normalizeUri(params.uri),
        position: params.position,
        maxResults: params.maxResults ?? 20,
        context: params.triggerCharacter
            ? { triggerKind: 2, triggerCharacter: params.triggerCharacter }
            : { triggerKind: 1 },
    } as any;
}

export function definitionToApiResponse(def: Definition) {
    const range = normalizeRange(def.range as any);
    return { uri: normalizeUri(def.uri), range, kind: (def as any).kind, name: (def as any).name };
}

export function referenceToApiResponse(ref: Reference) {
    const range = normalizeRange(ref.range as any);
    return { uri: normalizeUri(ref.uri), range, kind: (ref as any).kind, name: (ref as any).name };
}

// Legacy MCP helpers kept for adapter compatibility
// Map core types to MCP-friendly response objects (same shape as API helpers)
// NOTE: MCP adapters use the same normalized shape as HTTP.

export function validateRequired(params: Record<string, any>, required: string[]): void {
    for (const field of required) {
        if (params[field] === undefined || params[field] === null) {
            throw new CoreError('InvalidParams', `Missing required parameter: ${field}`, { field });
        }
    }
}

export function safeJsonParse(jsonString: string, fallback: any = null): any {
    try {
        return JSON.parse(jsonString);
    } catch {
        return fallback;
    }
}

export function strictJsonParse(jsonString: string): any {
    try {
        return JSON.parse(jsonString);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new CoreError('InvalidParams', 'Invalid JSON', { error: msg });
    }
}

export function parseIntegerOption(
    value: unknown,
    label: string,
    options: { defaultValue?: number; min?: number; max?: number } = {}
): number {
    const raw = value === undefined || value === null || value === '' ? options.defaultValue : value;
    if (raw === undefined) {
        throw new CoreError('InvalidParams', `${label} is required`, { label });
    }

    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(parsed) || !Number.isFinite(parsed)) {
        throw new CoreError('InvalidParams', `${label} must be an integer`, { label, value });
    }

    const min = options.min ?? Number.MIN_SAFE_INTEGER;
    const max = options.max ?? Number.MAX_SAFE_INTEGER;
    if (parsed < min || parsed > max) {
        throw new CoreError('InvalidParams', `${label} must be between ${min} and ${max}`, {
            label,
            value,
            min,
            max,
        });
    }

    return parsed;
}

export type AdapterProtocol = 'http' | 'mcp' | 'cli' | 'lsp';

export type McpAdapterErrorEnvelope = {
    isError: true;
    error: { code: string | number; message: string; data?: any };
    content?: Array<{ type: 'text'; text: string }>;
};

export type HttpAdapterErrorEnvelope = {
    status: number;
    error: string;
    details?: any;
};

export type LspAdapterErrorEnvelope = {
    code: number;
    message: string;
    data?: any;
};

function coreToJsonRpcCode(code: CoreErrorCode): number {
    switch (code) {
        case 'InvalidParams':
            return -32602;
        case 'UnknownTool':
            return -32601;
        default:
            return -32603;
    }
}

function coreToHttpStatus(code: CoreErrorCode): number {
    switch (code) {
        case 'InvalidParams':
            return 400;
        case 'UnknownTool':
            return 404;
        default:
            return 500;
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function getErrorMessage(error: unknown): string {
    if (isCoreError(error)) return error.message;
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error === null || error === undefined) return String(error);
    return safeStringify(error);
}

export function handleAdapterError(
    error: unknown,
    adapter: AdapterProtocol
): string | McpAdapterErrorEnvelope | HttpAdapterErrorEnvelope | LspAdapterErrorEnvelope {
    const message = getErrorMessage(error);
    const core = isCoreError(error) ? error : undefined;
    const includeDebugData = process.env.DEBUG === '1' || process.env.NODE_ENV === 'test';

    if (adapter === 'cli') {
        return message;
    }

    if (adapter === 'lsp') {
        const code = core ? coreToJsonRpcCode(core.code) : -32603;
        const data = includeDebugData ? core?.data : undefined;
        return { code, message, data };
    }

    if (adapter === 'http') {
        const status = core ? coreToHttpStatus(core.code) : 500;
        const details = includeDebugData
            ? { code: core?.code, message, data: core?.data }
            : { code: core?.code, message };
        return { status, error: message, details };
    }

    // MCP
    const errCode: string | number = core ? core.code : -32603;

    const envelope: McpAdapterErrorEnvelope = {
        isError: true,
        error: { code: errCode, message },
        content: [{ type: 'text', text: message }],
    };

    if (core?.data !== undefined && includeDebugData) {
        envelope.error.data = core.data;
    }

    return envelope;
}

export function createDefaultCoreConfig(): CoreConfig {
    const cfg = AnalyzerFactory.createDefaultConfig();
    (cfg as any).monitoring = { ...(cfg as any).monitoring, enabled: false };

    // Allow simple env-based overrides for storage without touching callers
    // Default remains SQLite; only switch if explicitly requested.
    try {
        const adapterEnv =
            process.env.LAYER4_ADAPTER || process.env.ONTOLOGY_STORAGE_ADAPTER || process.env.STORAGE_ADAPTER;
        if (adapterEnv) {
            (cfg as any).layers = (cfg as any).layers || {};
            (cfg as any).layers.layer4 = { ...(cfg as any).layers.layer4, adapter: adapterEnv };
        }
        const dbPathEnv = process.env.SEMANTIC_CODE_DB_PATH || process.env.LAYER4_DB_PATH;
        if (dbPathEnv) {
            (cfg as any).layers = (cfg as any).layers || {};
            (cfg as any).layers.layer4 = { ...(cfg as any).layers.layer4, dbPath: dbPathEnv };
            (cfg as any).layers.layer3 = { ...(cfg as any).layers.layer3, dbPath: dbPathEnv };
            (cfg as any).layers.layer5 = { ...(cfg as any).layers.layer5, dbPath: dbPathEnv };
        }
        const augmentExplore = process.env.L4_AUGMENT_EXPLORE;
        if (augmentExplore) {
            (cfg as any).layers.layer4 = {
                ...(cfg as any).layers.layer4,
                augmentExplore: augmentExplore === '1' || augmentExplore === 'true',
            };
        }
    } catch {
        // ignore env parsing errors; keep defaults
    }
    return cfg as CoreConfig;
}

// Pretty-format helpers for CLI output (kept simple and robust)
export function formatDefinitionForCli(def: any): string {
    try {
        const uri = def.uri ?? def.location?.uri ?? '';
        const range = def.range ?? def.location?.range ?? {};
        const start = range.start ?? { line: 0, character: 0 };
        const kind = def.kind ?? def.type ?? '';
        const name = def.name ?? def.identifier ?? '';
        const pos = `${(start.line ?? 0) + 1}:${(start.character ?? 0) + 1}`;
        return `${uri}:${pos} [${kind}] ${name}`.trim();
    } catch {
        return String(def);
    }
}

export function formatReferenceForCli(ref: any): string {
    try {
        const uri = ref.uri ?? ref.location?.uri ?? '';
        const range = ref.range ?? ref.location?.range ?? {};
        const start = range.start ?? { line: 0, character: 0 };
        const kind = ref.kind ?? ref.type ?? '';
        const name = ref.name ?? ref.identifier ?? '';
        const pos = `${(start.line ?? 0) + 1}:${(start.character ?? 0) + 1}`;
        return `${uri}:${pos} [${kind}] ${name}`.trim();
    } catch {
        return String(ref);
    }
}

export function formatCompletionForCli(item: any): string {
    try {
        const label = item.label ?? item.text ?? '';
        const detail = item.detail ? ` — ${item.detail}` : '';
        const kind = item.kind ? ` [${item.kind}]` : '';
        return `${label}${kind}${detail}`.trim();
    } catch {
        return String(item);
    }
}

export type WireCompletion = {
    label: string;
    kind: number;
    detail?: string;
    documentation?: string;
    insertText?: string;
    sortText?: string;
    filterText?: string;
    confidence?: number;
};

function normalizeCompletionKindKey(kind: string): string {
    const trimmed = kind.trim();
    if (!trimmed) return '';
    if (/^[a-z][a-zA-Z0-9]*$/.test(trimmed)) return trimmed;
    if (/^[A-Z][a-zA-Z0-9]*$/.test(trimmed)) return trimmed[0].toLowerCase() + trimmed.slice(1);

    const parts = trimmed.replace(/[-_\s]+/g, ' ').split(' ').filter(Boolean);
    if (parts.length === 0) return '';
    const [head, ...rest] = parts;
    return (
        head.toLowerCase() +
        rest.map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '')).join('')
    );
}

export function completionKindToLspKind(kind: unknown): number | undefined {
    if (typeof kind === 'number' && Number.isFinite(kind)) {
        const n = Math.trunc(kind);
        if (n >= 1 && n <= 25) return n;
        return undefined;
    }
    if (typeof kind !== 'string') return undefined;

    // LSP CompletionItemKind (1..25)
    const kindMap: Record<string, number> = {
        text: 1,
        method: 2,
        function: 3,
        constructor: 4,
        field: 5,
        variable: 6,
        class: 7,
        interface: 8,
        module: 9,
        property: 10,
        unit: 11,
        value: 12,
        enum: 13,
        keyword: 14,
        snippet: 15,
        color: 16,
        file: 17,
        reference: 18,
        folder: 19,
        enumMember: 20,
        constant: 21,
        struct: 22,
        event: 23,
        operator: 24,
        typeParameter: 25,

        // Semantic Code Intelligence extensions: best-effort mapping
        pattern: 15,
    };

    const key = normalizeCompletionKindKey(kind);
    return kindMap[key];
}

export function completionToWireCompletion(item: any): WireCompletion {
    const label = String(item.label ?? item.text ?? '');
    const detail = item.detail != null ? String(item.detail) : undefined;
    const documentation = item.documentation != null ? String(item.documentation) : undefined;
    const insertText = item.insertText != null ? String(item.insertText) : undefined;
    const sortText = item.sortText != null ? String(item.sortText) : undefined;
    const filterText = item.filterText != null ? String(item.filterText) : undefined;
    const confidence = typeof item.confidence === 'number' ? item.confidence : undefined;
    const kind = completionKindToLspKind(item.kind) ?? 1;

    return { label, kind, detail, documentation, insertText, sortText, filterText, confidence };
}

// LSP mappers (simple, tolerant)
export function definitionToLspLocation(def: any): { uri: string; range: any } {
    const uri = normalizeUri(def.uri ?? def.location?.uri ?? 'file://unknown');
    const range = normalizeRange((def.range ?? def.location?.range) as any);
    return { uri, range };
}

export function referenceToLspLocation(ref: any): { uri: string; range: any } {
    const uri = normalizeUri(ref.uri ?? ref.location?.uri ?? 'file://unknown');
    const range = normalizeRange((ref.range ?? ref.location?.range) as any);
    return { uri, range };
}

export function completionToLspItem(item: any): { label: string; detail?: string; kind?: number } {
    const wire = completionToWireCompletion(item);
    return {
        label: wire.label,
        kind: wire.kind,
        detail: wire.detail,
        documentation: wire.documentation,
        insertText: wire.insertText,
        sortText: wire.sortText,
        filterText: wire.filterText,
    } as any;
}

export function workspaceEditToLsp(edit: any): any {
    // If already in { changes: { uri: TextEdit[] } } shape, return as-is
    if (edit && edit.changes && typeof edit.changes === 'object') return edit;
    // If in array form, convert
    if (Array.isArray(edit)) {
        const changes: Record<string, any[]> = {};
        for (const e of edit) {
            const uri = normalizeUri(e.uri ?? e.file ?? 'file://unknown');
            const edits = (e.edits ?? e.changes ?? []).map((te: any) => ({
                range: normalizeRange(te.range as any),
                newText: te.newText,
            }));
            changes[uri] = (changes[uri] || []).concat(edits);
        }
        return { changes };
    }
    return { changes: {} };
}
