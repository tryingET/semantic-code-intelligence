import { CoreError } from '../errors.js';
import { parseBoundedInteger } from '../input-validation.js';
import { normalizeWorkspaceUri } from './request-semantics.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

type WorkspaceFileContext = { path: string; uri: string; relativePath: string };

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };

export interface CodeAnalysisWorkflowDeps {
    coreAnalyzer: any;
    maxResults: () => number;
    resolveWorkspaceFile: (value: string, inputLabel: string) => Promise<WorkspaceFileContext>;
    resolveWorkspaceLexicalPath: (value: string, inputLabel: string) => { path: string; relativePath: string };
    filterWorkspaceItemsByUri: <T extends { uri?: unknown }>(items: T[], inputLabel: string) => Promise<T[]>;
    workspaceRoot?: () => string;
}

export class CodeAnalysisWorkflowService {
    constructor(private readonly deps: CodeAnalysisWorkflowDeps) {}

    async getCompletions(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const fileInput = args?.file ?? args?.uri;
        validateRequired({ file: fileInput, position: args?.position }, ['file', 'position']);
        await initializeBestEffort(this.deps.coreAnalyzer);

        if (typeof this.deps.coreAnalyzer.getCompletions !== 'function') {
            throw new CoreError('Internal', 'Core analyzer does not support getCompletions');
        }

        const file = await this.deps.resolveWorkspaceFile(fileInput, 'get_completions file');
        const request = buildCompletionRequest({
            uri: file.uri,
            position: normalizePosition(args.position),
            maxResults: parseBoundedInteger(args.maxResults, 'maxResults', { defaultValue: 20, min: 1, max: 200 }),
        });
        const result = await this.deps.coreAnalyzer.getCompletions(request);
        const items = Array.isArray(result.data)
            ? result.data.map((completion: any) => completionToWireCompletion(completion))
            : [];

        return {
            payload: {
                schemaVersion: 2,
                completions: items,
                performance: result.performance,
                requestId: result.requestId,
                count: items.length,
            },
            isError: false,
        };
    }

    async buildSymbolMap(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        validateRequired(args, ['symbol']);
        const rawFile = typeof args.file === 'string' && args.file.trim() ? args.file : args.uri;
        let uri = 'file://workspace';
        if (typeof rawFile === 'string' && rawFile.trim() && rawFile.trim() !== 'file://workspace') {
            try {
                uri = (await this.deps.resolveWorkspaceFile(rawFile, 'build_symbol_map file')).uri;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes('does not exist')) throw error;
                uri = this.normalizeUri(this.deps.resolveWorkspaceLexicalPath(rawFile, 'build_symbol_map file').path);
            }
        }
        const result = await this.deps.coreAnalyzer.buildSymbolMap({
            identifier: args.symbol,
            uri,
            maxFiles: parseBoundedInteger(args.maxFiles, 'maxFiles', { defaultValue: 20, min: 1, max: 100 }),
            astOnly: !!args.astOnly,
        });
        return { payload: { schemaVersion: 2, ...result }, isError: false };
    }

    async generateTests(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        validateRequired(args, ['target']);
        return {
            payload: {
                message: 'Test generation not yet implemented in core analyzer',
                target: args.target,
                framework: args.framework || 'auto',
                coverage: args.coverage || 'comprehensive',
                status: 'not_implemented',
            },
            isError: false,
        };
    }

    async exploreCodebase(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        validateRequired(args, ['symbol']);
        const defaultMaxResultsRaw = this.deps.maxResults();
        const defaultMaxResults = Number.isFinite(defaultMaxResultsRaw) ? Math.max(1, Math.min(1000, Math.floor(defaultMaxResultsRaw))) : 100;
        const maxResults = parseBoundedInteger(args.maxResults, 'maxResults', { defaultValue: defaultMaxResults, min: 1, max: 1000 });
        const includeDeclaration = args.includeDeclaration ?? true;
        const uri = args.file
            ? (await this.deps.resolveWorkspaceFile(args.file, 'explore_codebase file')).uri
            : this.normalizeUri('file://workspace');

        const coreResult = await this.deps.coreAnalyzer.exploreCodebase({
            uri,
            identifier: args.symbol,
            includeDeclaration,
            maxResults,
            precise: !!args.precise,
            conceptual: !!args.conceptual,
        });

        const containedDefinitions = await this.deps.filterWorkspaceItemsByUri(
            Array.isArray(coreResult.definitions) ? coreResult.definitions : [],
            'explore_codebase definition uri'
        );
        const containedReferences = await this.deps.filterWorkspaceItemsByUri(
            Array.isArray(coreResult.references) ? coreResult.references : [],
            'explore_codebase reference uri'
        );

        return {
            payload: {
                schemaVersion: 2,
                symbol: coreResult.symbol,
                contextUri: coreResult.contextUri,
                definitions: containedDefinitions.map((definition: any) => definitionToApiResponse(definition, this.deps.workspaceRoot?.() || process.cwd())),
                references: containedReferences.map((reference: any) => referenceToApiResponse(reference, this.deps.workspaceRoot?.() || process.cwd())),
                performance: coreResult.performance,
                diagnostics: coreResult.diagnostics,
                timestamp: coreResult.timestamp,
            },
            isError: false,
        };
    }

    private normalizeUri(uri: string): string {
        return normalizeWorkspaceUri(uri, this.deps.workspaceRoot?.() || process.cwd());
    }
}

async function initializeBestEffort(coreAnalyzer: any) {
    try {
        await coreAnalyzer?.initialize?.();
    } catch {}
}

function validateRequired(args: Record<string, any>, fields: string[]) {
    if (!args || typeof args !== 'object') {
        throw new CoreError('InvalidParams', 'Arguments must be an object');
    }
    for (const field of fields) {
        if (
            args[field] === undefined ||
            args[field] === null ||
            (typeof args[field] === 'string' && args[field].trim() === '')
        ) {
            throw new CoreError('InvalidParams', `Missing required parameter: ${field}`, { field });
        }
    }
}

function buildCompletionRequest(params: {
    uri: string;
    position: Position;
    triggerCharacter?: string;
    maxResults?: number;
}) {
    return {
        uri: params.uri,
        position: params.position,
        maxResults: params.maxResults ?? 20,
        context: params.triggerCharacter
            ? { triggerKind: 2, triggerCharacter: params.triggerCharacter }
            : { triggerKind: 1 },
    } as any;
}

function completionToWireCompletion(item: any) {
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

function completionKindToLspKind(kind: unknown): number | undefined {
    const key = String(kind ?? '').toLowerCase();
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
        pattern: 15,
    };
    return kindMap[key];
}

function definitionToApiResponse(definition: any, workspaceRoot: string) {
    return {
        uri: normalizeOutputUri(definition.uri, workspaceRoot),
        range: normalizeRange(definition.range),
        kind: definition.kind,
        name: definition.name,
    };
}

function referenceToApiResponse(reference: any, workspaceRoot: string) {
    return {
        uri: normalizeOutputUri(reference.uri, workspaceRoot),
        range: normalizeRange(reference.range),
        kind: reference.kind,
        name: reference.name,
    };
}

function normalizePosition(position: any): Position {
    if (typeof position === 'object' && position) {
        if (typeof position.line === 'number' && typeof position.character === 'number') {
            return createPosition(position.line, position.character);
        }
        if (typeof position.line === 'number' && typeof position.col === 'number')
            return createPosition(position.line, position.col);
        if (typeof position.row === 'number' && typeof position.column === 'number')
            return createPosition(position.row, position.column);
    }
    throw new Error(`Invalid position format: ${JSON.stringify(position)}`);
}

function normalizeRange(range: any): Range {
    if (typeof range === 'object' && range) {
        if (range.start && range.end)
            return { start: normalizePosition(range.start), end: normalizePosition(range.end) };
        if (
            typeof range.startLine === 'number' &&
            typeof range.startChar === 'number' &&
            typeof range.endLine === 'number' &&
            typeof range.endChar === 'number'
        ) {
            return createRange(range.startLine, range.startChar, range.endLine, range.endChar);
        }
    }
    throw new Error(`Invalid range format: ${JSON.stringify(range)}`);
}

function createPosition(line: number, character: number): Position {
    return { line: Math.max(0, line), character: Math.max(0, character) };
}

function createRange(startLine: number, startChar: number, endLine: number, endChar: number): Range {
    return { start: createPosition(startLine, startChar), end: createPosition(endLine, endChar) };
}

function normalizeOutputUri(uri: unknown, workspaceRoot: string): string {
    return normalizeWorkspaceUri(String(uri || ''), workspaceRoot);
}
