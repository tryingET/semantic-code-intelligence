import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CoreError } from '../errors.js';
import { overlayStore } from '../overlay-store.js';
import { openWorkspaceFileForRead, resolveWorkspacePath } from '../workspace-path.js';
import { AsyncEnhancedGrep } from '../../layers/enhanced-search-tools-async.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

type WorkspaceQueryDependencies = {
    workspaceRoot: () => string;
    coreAnalyzer: any;
    pathInputFromToolFile: (value: string, workspaceRoot: string) => string;
};

export class WorkspaceQueryWorkflowService {
    constructor(private readonly deps: WorkspaceQueryDependencies) {}

    get workspaceRoot(): string {
        return this.deps.workspaceRoot();
    }

    private snapshotReadPath(requestedPath: string, snapshotRoot: string): string {
        const workspaceRoot = this.workspaceRoot;
        const decodedPath = this.deps.pathInputFromToolFile(requestedPath, workspaceRoot);
        if (!path.isAbsolute(decodedPath)) return decodedPath;

        const absolutePath = path.resolve(decodedPath);
        const workspaceRelative = path.relative(workspaceRoot, absolutePath);
        if (workspaceRelative && !workspaceRelative.startsWith('..') && !path.isAbsolute(workspaceRelative)) {
            return workspaceRelative;
        }

        const snapshotRelative = path.relative(path.resolve(snapshotRoot), absolutePath);
        if (snapshotRelative && !snapshotRelative.startsWith('..') && !path.isAbsolute(snapshotRelative)) {
            return snapshotRelative;
        }

        return decodedPath;
    }

    private async materializedSnapshotRoot(args: Record<string, any>): Promise<string | null> {
        const snapshot = typeof args?.snapshot === 'string' ? args.snapshot.trim() : '';
        if (!snapshot) return null;

        try {
            overlayStore.ensureSnapshot(snapshot, { workspaceRoot: this.workspaceRoot });
            const ensureMaterialized = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
            const snapshotRoot = ensureMaterialized ? await ensureMaterialized(snapshot, { workspaceRoot: this.workspaceRoot }) : null;
            if (!snapshotRoot) throw new Error('Snapshot could not be materialized');
            return snapshotRoot;
        } catch (error: any) {
            throw new CoreError('InvalidParams', error?.message || 'Invalid snapshot id');
        }
    }

    private async resolveReadFileRoot(args: Record<string, any>, requestedPath: string): Promise<{ workspaceRoot: string; readPath: string }> {
        const snapshotRoot = await this.materializedSnapshotRoot(args);
        if (!snapshotRoot) return { workspaceRoot: this.workspaceRoot, readPath: requestedPath };
        return { workspaceRoot: snapshotRoot, readPath: this.snapshotReadPath(requestedPath, snapshotRoot) };
    }

    async readFile(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const requestedPath = typeof args?.path === 'string' ? args.path.trim() : '';
        if (!requestedPath) {
            throw new CoreError('InvalidParams', 'Missing required parameter: path');
        }

        let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
        try {
            const readTarget = await this.resolveReadFileRoot(args, requestedPath);
            opened = await openWorkspaceFileForRead(readTarget.readPath, { workspaceRoot: readTarget.workspaceRoot, inputLabel: 'read_file path' });

            const maxBytesRaw = Number(args?.maxBytes ?? 65_536);
            const maxBytes = Number.isFinite(maxBytesRaw) ? Math.max(1, Math.min(262_144, Math.floor(maxBytesRaw))) : 65_536;
            const range = args?.range && typeof args.range === 'object' ? args.range : null;
            const startLineRaw = Number(range?.startLine ?? 1);
            const requestedEndLineRaw = range?.endLine == null ? null : Number(range.endLine);
            const startLine = Number.isFinite(startLineRaw) ? Math.max(1, Math.floor(startLineRaw)) : 1;
            const requestedEndLine =
                requestedEndLineRaw === null
                    ? Number.POSITIVE_INFINITY
                    : Number.isFinite(requestedEndLineRaw)
                      ? Math.max(startLine, Math.floor(requestedEndLineRaw))
                      : Number.POSITIVE_INFINITY;
            const selected = await this.readSelectedRangeBounded(opened.handle, startLine, requestedEndLine, maxBytes);

            return {
                payload: {
                    path: opened.relativePath,
                    range: { startLine, endLine: Math.min(requestedEndLine, selected.totalLines) },
                    content: selected.content,
                    truncated: selected.truncated,
                    bytes: selected.bytes,
                    totalLines: selected.totalLines,
                    totalLinesKnown: selected.totalLinesKnown,
                },
                isError: false,
            };
        } catch (error) {
            throw error instanceof CoreError
                ? error
                : new CoreError('InvalidParams', `Failed to read workspace file: ${error instanceof Error ? error.message : String(error)}`, { path: requestedPath });
        } finally {
            await opened?.handle.close().catch(() => undefined);
        }
    }

    private async readSelectedRangeBounded(
        handle: Awaited<ReturnType<typeof openWorkspaceFileForRead>>['handle'],
        startLine: number,
        endLine: number,
        maxBytes: number
    ): Promise<{ content: string; truncated: boolean; bytes: number; totalLines: number; totalLinesKnown: boolean }> {
        const decoder = new TextDecoder('utf-8');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        const parts: string[] = [];
        let position = 0;
        let currentLine = 1;
        let bytes = 0;
        let truncated = false;
        let pendingCarriageReturn = false;

        const appendBounded = (text: string) => {
            if (!text || truncated) return;
            for (const char of text) {
                const charBytes = Buffer.byteLength(char, 'utf8');
                if (bytes + charBytes > maxBytes) {
                    truncated = true;
                    return;
                }
                parts.push(char);
                bytes += charBytes;
            }
        };
        let stoppedEarly = false;
        const shouldStop = () => truncated || currentLine > endLine;
        const appendIfSelected = (text: string) => {
            if (currentLine >= startLine && currentLine <= endLine) appendBounded(text);
        };
        const finishLine = () => {
            if (currentLine >= startLine && currentLine < endLine) appendBounded('\n');
            currentLine += 1;
        };
        const processRegularChar = (char: string) => appendIfSelected(char);
        const processChar = (char: string) => {
            if (pendingCarriageReturn) {
                if (char === '\n') {
                    pendingCarriageReturn = false;
                    finishLine();
                    return;
                }
                pendingCarriageReturn = false;
                processRegularChar('\r');
            }
            if (char === '\r') {
                pendingCarriageReturn = true;
                return;
            }
            if (char === '\n') {
                finishLine();
                return;
            }
            processRegularChar(char);
        };

        while (true) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0) break;
            position += bytesRead;
            const chunk = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
            for (const char of chunk) {
                processChar(char);
                if (shouldStop()) {
                    stoppedEarly = true;
                    break;
                }
            }
            if (stoppedEarly) break;
        }
        if (!stoppedEarly) {
            const tail = decoder.decode();
            for (const char of tail) processChar(char);
            if (pendingCarriageReturn) processRegularChar('\r');
        }

        return { content: parts.join(''), truncated, bytes, totalLines: currentLine, totalLinesKnown: !stoppedEarly };
    }

    async listFiles(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const requestedPath = typeof args?.path === 'string' && args.path.trim() ? String(args.path) : '.';
        const maxFilesRaw = Number(args?.maxFiles ?? 500);
        const maxFiles = Number.isFinite(maxFilesRaw) ? Math.max(1, Math.min(5000, Math.floor(maxFilesRaw))) : 500;
        const depthRaw = Number(args?.depth ?? 5);
        const maxDepth = Number.isFinite(depthRaw) ? Math.max(0, Math.min(25, Math.floor(depthRaw))) : 5;
        const ignore = new Set(['.git', 'node_modules', '.ontology', 'dist']);
        const root = await resolveWorkspacePath(requestedPath, {
            workspaceRoot: this.workspaceRoot,
            inputLabel: 'list_files path',
            allowRoot: true,
        });
        const files: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = [];
        let capped = false;

        const visit = async (absoluteDir: string, relativeDir: string, depth: number): Promise<void> => {
            if (files.length >= maxFiles) {
                capped = true;
                return;
            }
            if (depth > maxDepth) return;
            const entries = await fs.readdir(absoluteDir, { withFileTypes: true }).catch((error) => {
                throw new CoreError('InvalidParams', `Failed to list workspace files: ${error instanceof Error ? error.message : String(error)}`, { path: requestedPath });
            });
            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
                if (files.length >= maxFiles) {
                    capped = true;
                    return;
                }
                if (ignore.has(entry.name)) continue;
                const childRel = relativeDir === '.' ? entry.name : `${relativeDir}/${entry.name}`;
                const childAbs = path.join(absoluteDir, entry.name);
                let childResolved;
                try {
                    childResolved = await resolveWorkspacePath(childRel, {
                        workspaceRoot: this.workspaceRoot,
                        inputLabel: 'list_files entry',
                        allowRoot: false,
                    });
                } catch {
                    continue;
                }
                const stat = await fs.stat(childResolved.realPath).catch(() => null);
                if (!stat) continue;
                if (stat.isDirectory()) {
                    files.push({ path: childResolved.relativePath, type: 'directory' });
                    await visit(childAbs, childResolved.relativePath, depth + 1);
                } else if (stat.isFile()) {
                    files.push({ path: childResolved.relativePath, type: 'file', size: stat.size });
                }
            }
        };

        const stat = await fs.stat(root.realPath).catch(() => null);
        if (!stat) throw new CoreError('InvalidParams', 'list_files path does not exist', { path: requestedPath });
        if (stat.isFile()) {
            files.push({ path: root.relativePath, type: 'file', size: stat.size });
        } else if (stat.isDirectory()) {
            await visit(root.realPath, root.relativePath, 0);
        } else {
            throw new CoreError('InvalidParams', 'list_files path must be a file or directory', { path: requestedPath });
        }

        return { payload: { path: root.relativePath, count: files.length, capped, files }, isError: false };
    }

    async listSymbols(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const file = typeof args?.file === 'string' ? args.file : '';
        if (!file) return { text: 'file required', isError: true };
        let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
        try {
            const workspaceRoot = this.workspaceRoot;
            opened = await openWorkspaceFileForRead(file, { workspaceRoot, inputLabel: 'list_symbols file' });
            const text = await opened.handle.readFile('utf8');
            const lines = text.split(/\r?\n/);
            const out: Array<{ name: string; kind: string; line: number; character: number }> = [];
            const push = (name: string, kind: string, line: number, character: number) => {
                out.push({ name, kind, line, character });
            };

            const wantAst = String(args?.ast || '').toLowerCase() === 'true' || process.env.LIST_SYMBOLS_AST === '1';
            if (wantAst) {
                try {
                    const { runAstQuery } = await import('../ast-query.js');
                    const ext = opened.relativePath.toLowerCase();
                    let language: 'typescript' | 'javascript' | 'python' | null = null;
                    if (/(\.ts|\.tsx)$/.test(ext)) language = 'typescript';
                    else if (/(\.js|\.jsx)$/.test(ext)) language = 'javascript';
                    else if (/\.py$/.test(ext)) language = 'python';

                    if (language) {
                        let query = '';
                        if (language === 'typescript') {
                            query = `
                                (function_declaration name: (identifier) @sym.func)
                                (method_definition name: (property_identifier) @sym.method)
                                (class_declaration name: (type_identifier) @sym.class)
                                (interface_declaration name: (type_identifier) @sym.interface)
                                (variable_declaration (variable_declarator name: (identifier) @sym.var))
                                (export_statement (export_clause (export_specifier name: (identifier) @sym.export)))
                            `;
                        } else if (language === 'javascript') {
                            query = `
                                (function_declaration name: (identifier) @sym.func)
                                (method_definition name: (property_identifier) @sym.method)
                                (class_declaration name: (identifier) @sym.class)
                                (variable_declaration (variable_declarator name: (identifier) @sym.var))
                                (export_statement (export_clause (export_specifier name: (identifier) @sym.export)))
                            `;
                        } else if (language === 'python') {
                            query = `
                                (function_definition name: (identifier) @sym.func)
                                (class_definition name: (identifier) @sym.class)
                            `;
                        }

                        const res = await runAstQuery({ language, query, paths: [opened.relativePath], limit: 2000, workspaceRoot });
                        if (Array.isArray(res?.results)) {
                            for (const r of res.results) {
                                if (!r || !r.start || !r.end) continue;
                                const start = r.start;
                                const end = r.end;
                                let name = '';
                                if (start.line === end.line) {
                                    const line = lines[start.line] || '';
                                    name = line.slice(start.column, end.column).trim();
                                } else {
                                    const first = (lines[start.line] || '').slice(start.column);
                                    const last = (lines[end.line] || '').slice(0, end.column);
                                    name = `${first}${last}`.trim();
                                }
                                if (!name) continue;
                                const cap: string = String(r.capture || '');
                                let kind = 'symbol';
                                if (cap.includes('func')) kind = 'function';
                                else if (cap.includes('method')) kind = 'method';
                                else if (cap.includes('class')) kind = 'class';
                                else if (cap.includes('interface')) kind = 'interface';
                                else if (cap.includes('export')) kind = 'export';
                                else if (cap.includes('var')) kind = 'const';
                                push(name, kind, start.line, start.column);
                            }
                        }
                    }
                } catch (e) {
                    if (process.env.DEBUG && !process.env.SILENT_MODE) {
                        console.error('list_symbols AST path failed; falling back to regex:', e instanceof Error ? e.message : e);
                    }
                }
            }

            if (out.length === 0) {
                for (let i = 0; i < lines.length; i++) {
                    const l = lines[i];
                    let m = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
                    if (m) push(m[1], 'class', i, Math.max(0, l.indexOf(m[1])));
                    m = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(l);
                    if (m) push(m[1], 'function', i, Math.max(0, l.indexOf(m[1])));
                    m = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
                    if (m) push(m[1], 'interface', i, Math.max(0, l.indexOf(m[1])));
                    m = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
                    if (m) push(m[1], 'const', i, Math.max(0, l.indexOf(m[1])));
                    m = /\bexport\s+\{\s*([^}]+)\}/.exec(l);
                    if (m) {
                        const names = m[1]
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                        for (const n of names) push(n.split(/\s+as\s+/i)[0], 'export', i, Math.max(0, l.indexOf(n)));
                    }
                }
            }

            return { payload: { file: opened.relativePath, symbols: out.slice(0, 500) }, isError: false };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { text: `list_symbols failed: ${msg}`, isError: true };
        } finally {
            await opened?.handle.close().catch(() => undefined);
        }
    }

    async textSearch(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const query = String(args?.query || '').trim();
        if (!query) return { text: 'query required', isError: true };

        try {
            await this.deps.coreAnalyzer?.initialize?.();

            const kind = (args?.kind as string) || 'literal';
            const caseInsensitive = !!args?.caseInsensitive;
            const maxResults = Math.min(Number(args?.maxResults || 200), 1000);
            const snapshotRoot = await this.materializedSnapshotRoot(args);
            const workspaceRoot = snapshotRoot || this.workspaceRoot;
            const requestedPath = typeof args?.path === 'string' && args.path.trim() ? String(args.path) : '.';
            const searchPath = snapshotRoot ? this.snapshotReadPath(requestedPath, snapshotRoot) : requestedPath;
            const searchRoot = await resolveWorkspacePath(searchPath, { workspaceRoot, inputLabel: 'text_search path', allowRoot: true });
            const searchRootPath = searchRoot.realPath;

            let searchQuery = query;
            if (kind === 'word') {
                searchQuery = `\\b${escapeRegex(query)}\\b`;
            } else if (kind === 'literal') {
                searchQuery = escapeRegex(query);
            }

            const result = await this.deps.coreAnalyzer.textSearch(searchQuery, {
                path: searchRootPath,
                maxResults,
                caseInsensitive,
            });

            if (Number(result?.count || 0) === 0 && typeof query === 'string' && query.length > 0) {
                const asyncGrep = new AsyncEnhancedGrep({ cacheSize: 500, cacheTTL: 30000 });
                const results = await asyncGrep.search({ pattern: searchQuery, path: searchRootPath, maxResults, timeout: 200, caseInsensitive });
                if (results.length > 0) {
                    const normalized = normalizeGrepResults(results);
                    return { payload: { count: normalized.length, results: normalized }, isError: false };
                }
            }

            return { payload: result, isError: false };
        } catch (error) {
            if (error instanceof CoreError) throw error;
            const kind = (args?.kind as string) || 'literal';
            const caseInsensitive = !!args?.caseInsensitive;
            const maxResults = Math.min(Number(args?.maxResults || 200), 1000);
            const snapshotRoot = await this.materializedSnapshotRoot(args);
            const workspaceRoot = snapshotRoot || this.workspaceRoot;
            const requestedPath = typeof args?.path === 'string' && args.path.trim() ? String(args.path) : '.';
            const searchPath = snapshotRoot ? this.snapshotReadPath(requestedPath, snapshotRoot) : requestedPath;
            const searchRoot = await resolveWorkspacePath(searchPath, { workspaceRoot, inputLabel: 'text_search path', allowRoot: true });
            const searchRootPath = searchRoot.realPath;
            const asyncGrep = new AsyncEnhancedGrep({ cacheSize: 500, cacheTTL: 30000 });
            const pattern = kind === 'word' ? `\\b${escapeRegex(query)}\\b` : kind === 'literal' ? escapeRegex(query) : query;
            const results = await asyncGrep.search({ pattern, path: searchRootPath, maxResults, timeout: 200, caseInsensitive });
            const normalized = normalizeGrepResults(results);
            return { payload: { count: normalized.length, results: normalized }, isError: false };
        }
    }

    async symbolSearch(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const query = String(args?.query || '').trim();
        if (!query) return { text: 'query required', isError: true };
        const maxResults = Math.min(Number(args?.maxResults || 50), 200);
        const fileHint = typeof args?.fileHint === 'string' ? args.fileHint : '';
        const res = await this.deps.coreAnalyzer.buildSymbolMap({
            identifier: query,
            maxFiles: maxResults,
            astOnly: true,
        });
        let out = (res?.declarations || [])
            .slice(0, maxResults)
            .map((d: any) => ({ uri: d.uri, range: d.range, kind: d.kind, name: d.name || query }));

        if (out.length === 0 && fileHint) {
            let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
            try {
                const workspaceRoot = this.workspaceRoot;
                opened = await openWorkspaceFileForRead(fileHint, { workspaceRoot, inputLabel: 'symbol_search fileHint' });
                const text = await opened.handle.readFile('utf8');
                const lines = text.split(/\r?\n/);
                out = lines
                    .map((line, index) => ({ line, index, column: line.indexOf(query) }))
                    .filter((match) => match.column >= 0)
                    .slice(0, maxResults)
                    .map((match) => ({
                        uri: `file://${path.resolve(workspaceRoot, opened?.relativePath || fileHint)}`,
                        range: {
                            start: { line: match.index, character: match.column },
                            end: { line: match.index, character: match.column + query.length },
                        },
                        kind: /function|class|interface|const|let|var|private|public|async/.test(match.line) ? 'symbol' : 'text_match',
                        name: query,
                        fallback: 'fileHint_text_scan',
                    }));
            } catch (error) {
                throw error instanceof CoreError
                    ? error
                    : new CoreError('InvalidParams', `symbol_search fileHint failed: ${error instanceof Error ? error.message : String(error)}`, { path: fileHint });
            } finally {
                await opened?.handle.close().catch(() => undefined);
            }
        }

        return { payload: { query, count: out.length, symbols: out }, isError: false };
    }

    async astQuery(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const language = String(args?.language || '').trim();
        const query = String(args?.query || '').trim();
        if (!language || !query) return { text: 'language and query required', isError: true };
        const paths = Array.isArray(args?.paths) ? (args.paths as string[]) : undefined;
        const glob = typeof args?.glob === 'string' ? (args.glob as string) : undefined;
        const limit = typeof args?.limit === 'number' ? args.limit : undefined;
        try {
            const snapshotRoot = await this.materializedSnapshotRoot(args);
            const workspaceRoot = snapshotRoot || this.workspaceRoot;
            const queryPaths = snapshotRoot && paths ? paths.map((item) => this.snapshotReadPath(String(item), snapshotRoot)) : paths;
            const { runAstQuery } = await import('../ast-query.js');
            const out = await runAstQuery({ language: language as any, query, paths: queryPaths, glob, limit, workspaceRoot });
            return { payload: out, isError: false };
        } catch (error) {
            throw error instanceof CoreError
                ? error
                : new CoreError('InvalidParams', `ast_query failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

function normalizeGrepResults(results: any[]) {
    return results.map((r) => ({
        file: r.file,
        line: r.line ?? 0,
        column: r.column ?? 0,
        text: r.text,
    }));
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
