import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CoreError } from '../errors.js';
import { DefinitionKind } from '../types.js';
import { openWorkspaceFileForRead, walkWorkspaceFilesForRead } from '../workspace-path.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

type WorkspaceFileContext = { path: string; uri: string; relativePath: string };

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };

export interface NavigationWorkflowServiceDeps {
    workspaceRoot: () => string;
    coreAnalyzer: any;
    maxResults: () => number;
    resolveWorkspaceFile: (value: string, inputLabel: string) => Promise<WorkspaceFileContext>;
    containedUriOrNull: (value: string, inputLabel: string) => Promise<string | null>;
}

export class NavigationWorkflowService {
    constructor(private readonly deps: NavigationWorkflowServiceDeps) {}

    async findDefinition(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const position = args.position ? normalizePosition(args.position) : createPosition(0, 0);
        let symbol: string = typeof args.symbol === 'string' ? args.symbol : '';
        const fileContext = args.file ? await this.deps.resolveWorkspaceFile(args.file, 'find_definition file') : null;
        const uri = fileContext?.uri || null;

        if (!symbol && fileContext) {
            let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
            try {
                opened = await openWorkspaceFileForRead(fileContext.path, {
                    workspaceRoot: this.deps.workspaceRoot(),
                    inputLabel: 'find_definition file',
                });
                const text = await opened.handle.readFile('utf8');
                const derived = wordAt(text, position);
                if (derived) symbol = derived;
            } catch {
            } finally {
                await opened?.handle.close().catch(() => undefined);
            }
        }

        if (!symbol && !uri) {
            throw new CoreError('InvalidParams', 'Missing required parameter: symbol');
        }

        await this.initializeCoreBestEffort();
        const maxResults =
            typeof args.maxResults === 'number' && args.maxResults > 0 ? args.maxResults : this.deps.maxResults();

        if (!uri) {
            const workspaceRequest = buildFindDefinitionRequest({
                uri: '',
                position,
                identifier: symbol,
                maxResults,
                includeDeclaration: true,
                precise: !!args.precise,
            });

            try {
                const explicit = await scanForExplicitDeclaration(this.deps.workspaceRoot(), symbol);
                if (explicit) {
                    return {
                        payload: {
                            schemaVersion: 2,
                            symbol,
                            query: symbol,
                            fallback: false,
                            maxResults,
                            definitions: [definitionToApiResponse(explicit as any)],
                            performance: { layer1: 0, layer2: 0, layer3: 0, layer4: 0, layer5: 0, total: 0 },
                            requestId: undefined,
                            count: 1,
                        },
                        isError: false,
                    };
                }

                const result = await this.deps.coreAnalyzer.findDefinitionAsync(workspaceRequest);
                let prioritized = prioritizeDefinitions(Array.isArray(result.data) ? result.data : result.data, symbol);

                try {
                    const top = Array.isArray(prioritized) && prioritized[0] ? prioritized[0] : null;
                    const name = String(args.symbol || '').toLowerCase();
                    const likelyTop = top ? toBase(top.uri).toLowerCase().includes(name) : false;
                    if (!likelyTop) {
                        const fallbackDefs = await fallbackScanForDefinition(
                            this.deps.workspaceRoot(),
                            args.symbol,
                            300
                        );
                        const match = fallbackDefs.find((definition) =>
                            toBase(definition.uri).toLowerCase().includes(name)
                        );
                        if (match) {
                            prioritized = [match, ...prioritized];
                        }
                        if (Array.isArray(prioritized) && prioritized.length) {
                            const declRe = new RegExp(
                                `\\b(class|function|interface|type)\\s+${escapeRegExp(args.symbol)}\\b`
                            );
                            for (const definition of prioritized.slice(0, 200)) {
                                try {
                                    const filePath = filePathFromUriLike(definition.uri);
                                    const containedUri = await this.deps.containedUriOrNull(
                                        filePath,
                                        'find_definition result uri'
                                    );
                                    if (!containedUri) continue;
                                    const containedPath = fileURLToPath(containedUri);
                                    let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
                                    try {
                                        opened = await openWorkspaceFileForRead(containedPath, {
                                            workspaceRoot: this.deps.workspaceRoot(),
                                            inputLabel: 'find_definition result uri',
                                        });
                                        const text = await opened.handle.readFile('utf8');
                                        const lines = text.split(/\r?\n/);
                                        const line = lines[definition.range?.start?.line ?? 0] || '';
                                        if (declRe.test(line)) {
                                            prioritized = [
                                                definition,
                                                ...prioritized.filter((item: any) => item !== definition),
                                            ];
                                            break;
                                        }
                                    } finally {
                                        await opened?.handle.close().catch(() => undefined);
                                    }
                                } catch {}
                            }
                        }
                    }
                } catch {}

                const containedPrioritized = await this.filterWorkspaceItemsByUri(
                    Array.isArray(prioritized) ? prioritized : [],
                    'find_definition result uri'
                );
                return {
                    payload: {
                        schemaVersion: 2,
                        ...(containedPrioritized.length
                            ? { symbol, query: symbol, fallback: false, maxResults }
                            : { fallback: false, maxResults }),
                        definitions: containedPrioritized.map((definition: any) => definitionToApiResponse(definition)),
                        performance: result.performance,
                        requestId: result.requestId,
                        count: containedPrioritized.length,
                    },
                    isError: false,
                };
            } catch {
                const fallbackDefs = await fallbackScanForDefinition(this.deps.workspaceRoot(), args.symbol, 200);
                const containedFallbackDefs = await this.filterWorkspaceItemsByUri(
                    fallbackDefs,
                    'find_definition fallback result uri'
                );
                return {
                    payload: {
                        schemaVersion: 2,
                        ...(containedFallbackDefs.length ? { symbol, query: symbol, maxResults } : { maxResults }),
                        definitions: containedFallbackDefs.map((definition: any) =>
                            definitionToApiResponse(definition)
                        ),
                        performance: { layer1: 0, layer2: 0, layer3: 0, layer4: 0, layer5: 0, total: 0 },
                        requestId: undefined,
                        count: containedFallbackDefs.length,
                        fallback: true,
                    },
                    isError: false,
                };
            }
        }

        const request = buildFindDefinitionRequest({
            uri,
            position,
            identifier: symbol,
            maxResults,
            includeDeclaration: true,
            precise: !!args.precise,
        });
        const result = await this.deps.coreAnalyzer.findDefinitionAsync(request);
        const prioritized = prioritizeDefinitions(Array.isArray(result.data) ? result.data : result.data, symbol);
        const containedPrioritized = await this.filterWorkspaceItemsByUri(
            Array.isArray(prioritized) ? prioritized : [],
            'find_definition result uri'
        );
        return {
            payload: {
                schemaVersion: 2,
                ...(containedPrioritized.length
                    ? { symbol, query: symbol, fallback: false, maxResults }
                    : { fallback: false, maxResults }),
                definitions: containedPrioritized.map((definition: any) => definitionToApiResponse(definition)),
                performance: result.performance,
                requestId: result.requestId,
                count: containedPrioritized.length,
            },
            isError: false,
        };
    }

    async findReferences(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        if (typeof args?.symbol === 'string' && args.symbol.trim().length === 0) {
            return { payload: emptyReferencesPayload(), isError: false };
        }
        if (!args || typeof args !== 'object') {
            throw new CoreError('InvalidParams', 'Arguments must be an object');
        }
        if (
            args.symbol === undefined ||
            args.symbol === null ||
            (typeof args.symbol === 'string' && args.symbol.trim() === '')
        ) {
            throw new CoreError('InvalidParams', 'Missing required parameter: symbol');
        }

        await this.initializeCoreBestEffort();
        const maxResults =
            typeof args.maxResults === 'number' && args.maxResults > 0 ? args.maxResults : this.deps.maxResults();

        if (!args.file && !args.uri) {
            const fallbackRefs = await fallbackScanForReferences(
                this.deps.workspaceRoot(),
                String(args.symbol),
                maxResults,
                !!args.includeDeclaration
            );
            const containedFallbackRefs = await this.filterWorkspaceItemsByUri(
                fallbackRefs,
                'find_references fallback result uri'
            );
            return {
                payload: {
                    schemaVersion: 2,
                    ...(containedFallbackRefs.length
                        ? { symbol: String(args.symbol), query: String(args.symbol), maxResults }
                        : { maxResults }),
                    references: containedFallbackRefs.map((reference: any) => referenceToApiResponse(reference)),
                    performance: { layer1: 0, layer2: 0, layer3: 0, layer4: 0, layer5: 0, total: 0 },
                    requestId: undefined,
                    count: containedFallbackRefs.length,
                    scope: 'workspace',
                    fallback: true,
                },
                isError: false,
            };
        }

        const fileContext = await this.deps.resolveWorkspaceFile(String(args.file || args.uri), 'find_references file');
        const request = buildFindReferencesRequest({
            uri: fileContext.uri,
            position: createPosition(0, 0),
            identifier: args.symbol,
            maxResults,
            includeDeclaration: args.includeDeclaration ?? false,
            precise: !!args.precise,
        });

        const result = await this.deps.coreAnalyzer.findReferencesAsync(request);
        const containedReferences = await this.filterWorkspaceItemsByUri(
            Array.isArray(result.data) ? result.data : [],
            'find_references result uri'
        );

        return {
            payload: {
                schemaVersion: 2,
                ...(containedReferences.length
                    ? { symbol: String(args.symbol), query: String(args.symbol), fallback: false, maxResults }
                    : { fallback: false, maxResults }),
                references: containedReferences.map((reference: any) => referenceToApiResponse(reference)),
                performance: result.performance,
                requestId: result.requestId,
                count: containedReferences.length,
                scope: args.scope || 'workspace',
            },
            isError: false,
        };
    }

    private async initializeCoreBestEffort() {
        try {
            await this.deps.coreAnalyzer?.initialize?.();
        } catch {}
    }

    private async filterWorkspaceItemsByUri<T extends { uri?: unknown }>(items: T[], inputLabel: string): Promise<T[]> {
        const contained: T[] = [];
        for (const item of items) {
            const uri = typeof item?.uri === 'string' ? item.uri : '';
            if (uri && (await this.deps.containedUriOrNull(uri, inputLabel))) contained.push(item);
        }
        return contained;
    }
}

export function wordAt(text: string, pos: Position): string | null {
    const lines = text.split(/\r?\n/);
    if (pos.line < 0 || pos.line >= lines.length) return null;
    const line = lines[pos.line] || '';
    const idx = Math.min(Math.max(pos.character, 0), line.length);
    const re = /[A-Za-z0-9_]+/g;
    let match: RegExpExecArray | null = null;
    while ((match = re.exec(line))) {
        const start = match.index;
        const end = start + match[0].length;
        if (idx >= start && idx <= end) return match[0];
    }
    return null;
}

function escapeRegExp(value: unknown): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declarationRegexForSymbol(symbol: unknown, flags = ''): RegExp {
    const escaped = escapeRegExp(symbol);
    return new RegExp(
        `\\b(?:export\\s+)?(?:class|function|interface|type|const|let|var|def|fn|struct|func)\\s+${escaped}\\b`,
        flags
    );
}

function definitionKindForLine(line: string): DefinitionKind {
    if (/\bclass\s+/.test(line) || /\bstruct\s+/.test(line)) return DefinitionKind.Class;
    if (/\binterface\s+/.test(line)) return DefinitionKind.Interface;
    if (/\bfunction\s+/.test(line) || /\bdef\s+/.test(line) || /\bfn\s+/.test(line) || /\bfunc\s+/.test(line))
        return DefinitionKind.Function;
    if (/\btype\s+/.test(line)) return DefinitionKind.Type;
    return DefinitionKind.Variable;
}

export async function fallbackScanForDefinition(root: string, symbol: string, maxFiles: number) {
    const results: any[] = [];
    const re = declarationRegexForSymbol(symbol);
    let filesScanned = 0;

    for await (const candidate of walkWorkspaceFilesForRead({
        workspaceRoot: root,
        maxFiles,
        extensionPattern: /\.(ts|tsx|js|jsx|py|rs|go)$/,
    })) {
        filesScanned++;
        const text = await readSafeWorkspaceFile(root, candidate.relativePath);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
            if (re.test(lines[index])) {
                results.push({
                    identifier: symbol,
                    uri: pathToFileURL(candidate.realPath).href,
                    range: {
                        start: { line: index, character: Math.max(0, lines[index].indexOf(symbol)) },
                        end: {
                            line: index,
                            character: Math.max(0, lines[index].indexOf(symbol)) + String(symbol).length,
                        },
                    },
                    kind: definitionKindForLine(lines[index]),
                    name: symbol,
                    source: 'exact',
                    confidence: 0.5,
                    layer: 'async-layer1',
                });
                break;
            }
        }
        if (results.length > 0 || filesScanned >= maxFiles) break;
    }
    return results;
}

export async function fallbackScanForReferences(
    root: string,
    symbol: string,
    maxResults: number,
    includeDeclaration = false,
    maxFiles = 500
) {
    const results: any[] = [];
    const escaped = String(symbol).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrenceRe = new RegExp(`\\b${escaped}\\b`, 'g');
    const declarationRe = new RegExp(`\\b(class|function|interface|type|const|let|var)\\s+${escaped}\\b`, 'g');
    let filesScanned = 0;

    for await (const candidate of walkWorkspaceFilesForRead({
        workspaceRoot: root,
        maxFiles,
        extensionPattern: /\.(ts|tsx|js|jsx|py|rs|go|md)$/,
    })) {
        filesScanned++;
        const text = await readSafeWorkspaceFile(root, candidate.relativePath);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length && results.length < maxResults; index++) {
            const line = lines[index];
            const declarationSpans = declarationSymbolSpans(line, symbol, declarationRe);
            occurrenceRe.lastIndex = 0;
            let match: RegExpExecArray | null = null;
            while ((match = occurrenceRe.exec(line)) && results.length < maxResults) {
                const column = match.index;
                const isDeclaration = declarationSpans.some(([start, end]) => column >= start && column < end);
                if (!includeDeclaration && isDeclaration) continue;
                results.push({
                    identifier: symbol,
                    uri: pathToFileURL(candidate.realPath).href,
                    range: {
                        start: { line: index, character: column },
                        end: { line: index, character: column + String(symbol).length },
                    },
                    kind: isDeclaration ? 'declaration' : 'reference',
                    name: symbol,
                    source: 'fallback-scan',
                    confidence: 0.5,
                    layer: 'async-layer1',
                });
            }
        }
        if (filesScanned >= maxFiles || results.length >= maxResults) break;
    }
    return results;
}

function declarationSymbolSpans(line: string, symbol: string, declarationRe: RegExp): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    declarationRe.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = declarationRe.exec(line))) {
        const start = line.indexOf(symbol, match.index);
        if (start >= 0) spans.push([start, start + symbol.length]);
    }
    return spans;
}

export async function scanForExplicitDeclaration(root: string, symbol: string, maxFiles = 300) {
    const declRe = declarationRegexForSymbol(symbol);
    let filesScanned = 0;

    for await (const candidate of walkWorkspaceFilesForRead({
        workspaceRoot: root,
        maxFiles,
        extensionPattern: /\.(ts|tsx|js|jsx|py|rs|go)$/,
    })) {
        filesScanned++;
        const text = await readSafeWorkspaceFile(root, candidate.relativePath);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            if (declRe.test(line)) {
                const column = Math.max(0, line.indexOf(symbol));
                return {
                    identifier: symbol,
                    uri: pathToFileURL(candidate.realPath).href,
                    range: {
                        start: { line: index, character: column },
                        end: { line: index, character: column + symbol.length },
                    },
                    kind: definitionKindForLine(line),
                    name: symbol,
                    source: 'exact',
                    confidence: 0.95,
                    layer: 'async-layer1',
                };
            }
        }
        if (filesScanned >= maxFiles) break;
    }
    return null;
}

async function readSafeWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string | null> {
    let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
    try {
        opened = await openWorkspaceFileForRead(relativePath, {
            workspaceRoot,
            inputLabel: 'navigation fallback file',
        });
        return await opened.handle.readFile('utf8');
    } catch {
        return null;
    } finally {
        await opened?.handle.close().catch(() => undefined);
    }
}

function emptyReferencesPayload() {
    return {
        schemaVersion: 2,
        fallback: false,
        maxResults: 0,
        references: [],
        performance: { total: 0 },
        requestId: 'none',
        count: 0,
    };
}

function prioritizeDefinitions(data: any, symbol: unknown) {
    return Array.isArray(data)
        ? data.slice().sort((a: any, b: any) => {
              const kindDiff = priorityKind(b.kind) - priorityKind(a.kind);
              const name = String(symbol || '').toLowerCase();
              const aBase = toBase(a.uri).toLowerCase();
              const bBase = toBase(b.uri).toLowerCase();
              const aNameHit = aBase.includes(name) ? 1 : 0;
              const bNameHit = bBase.includes(name) ? 1 : 0;
              if (aNameHit !== bNameHit) return bNameHit - aNameHit;
              if (kindDiff !== 0) return kindDiff;
              return (b.confidence || 0) - (a.confidence || 0);
          })
        : data;
}

function priorityKind(kind: string) {
    return kind === 'class' ? 4 : kind === 'function' ? 3 : kind === 'interface' ? 2 : kind === 'variable' ? 1 : 0;
}

function toBase(uri: string) {
    try {
        const resolvedPath = new URL(uri).pathname;
        return resolvedPath.split('/').pop() || resolvedPath;
    } catch {
        return String(uri).split('/').pop() || String(uri);
    }
}

function filePathFromUriLike(uri: string): string {
    if (String(uri).startsWith('file://')) {
        try {
            return fileURLToPath(uri);
        } catch {
            return String(uri).replace(/^file:\/\//, '');
        }
    }
    return String(uri);
}

function buildFindDefinitionRequest(params: {
    uri: string;
    position: Position;
    identifier?: string;
    maxResults?: number;
    includeDeclaration?: boolean;
    precise?: boolean;
}) {
    return {
        uri: normalizeUri(params.uri),
        position: params.position,
        identifier: params.identifier || '',
        maxResults: params.maxResults,
        includeDeclaration: params.includeDeclaration ?? true,
        precise: params.precise,
    } as any;
}

function buildFindReferencesRequest(params: {
    uri: string;
    position: Position;
    identifier?: string;
    maxResults?: number;
    includeDeclaration?: boolean;
    precise?: boolean;
}) {
    return {
        uri: normalizeUri(params.uri),
        position: params.position,
        identifier: params.identifier || '',
        maxResults: params.maxResults,
        includeDeclaration: params.includeDeclaration ?? false,
        precise: params.precise,
    } as any;
}

function definitionToApiResponse(definition: any) {
    return {
        uri: normalizeUri(definition.uri),
        range: normalizeRange(definition.range),
        kind: definition.kind,
        name: definition.name,
    };
}

function referenceToApiResponse(reference: any) {
    return {
        uri: normalizeUri(reference.uri),
        range: normalizeRange(reference.range),
        kind: reference.kind,
        name: reference.name,
    };
}

function normalizeUri(uri: string): string {
    const pathValue = uriToPath(uri);
    try {
        return pathToFileURL(pathValue).href;
    } catch {
        return uri.startsWith('file://') ? uri : '';
    }
}

function uriToPath(uri: string): string {
    if (uri.startsWith('file://')) {
        try {
            return fileURLToPath(uri);
        } catch {
            const body = uri.replace(/^file:\/\//, '');
            return path.isAbsolute(body) ? body : path.resolve('/', body);
        }
    }
    return path.isAbsolute(uri) ? uri : path.resolve(process.cwd(), uri);
}

function createPosition(line: number, character: number): Position {
    return { line: Math.max(0, line), character: Math.max(0, character) };
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

function createRange(startLine: number, startChar: number, endLine: number, endChar: number): Range {
    return { start: createPosition(startLine, startChar), end: createPosition(endLine, endChar) };
}
