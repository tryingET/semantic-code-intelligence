/**
 * CLI Adapter - Command-line interface to core analyzer with pretty output
 * Target: <100 lines
 *
 * This adapter handles CLI-specific concerns only:
 * - Command argument parsing
 * - Pretty terminal output formatting
 * - Progress indicators
 * - Exit codes
 *
 * All actual analysis work is delegated to the unified core analyzer.
 */

import * as fs from 'node:fs';
import leven from 'leven';
import { overlayStore } from '../core/overlay-store.js';
import type { CodeAnalyzer } from '../core/unified-analyzer.js';
import { AsyncEnhancedGrep } from '../layers/enhanced-search-tools-async.js';
import {
    buildFindDefinitionRequest,
    buildFindReferencesRequest,
    buildRenameRequest,
    createPosition,
    formatCompletionForCli,
    formatDefinitionForCli,
    formatReferenceForCli,
    handleAdapterError,
    normalizeUri,
} from './utils.js';

export interface CLIAdapterConfig {
    maxResults?: number;
    timeout?: number;
    colorOutput?: boolean;
    verboseMode?: boolean;
    printLimit?: number;
}

/**
 * CLI Adapter - converts command-line calls to core analyzer calls
 */
export class CLIAdapter {
    private coreAnalyzer: CodeAnalyzer;
    private config: CLIAdapterConfig;

    constructor(coreAnalyzer: CodeAnalyzer, config: CLIAdapterConfig = {}) {
        this.coreAnalyzer = coreAnalyzer;
        this.config = {
            maxResults: 50,
            timeout: 30000,
            colorOutput: true,
            verboseMode: false,
            ...config,
        };
    }

    /**
     * Convenience: for E2E validator – direct definition lookup
     */
    async findDefinition(
        file: string,
        input: { line?: number; character?: number; symbol?: string } = {}
    ): Promise<any[]> {
        try {
            await (this.coreAnalyzer as any)?.initialize?.();
        } catch {}
        const uri = normalizeUri(file || 'file://workspace');
        const symbol = input.symbol || this.extractWordFromFile(uri, input.line ?? 0, input.character ?? 0) || 'symbol';
        const request = buildFindDefinitionRequest({
            uri,
            position: createPosition(input.line ?? 0, input.character ?? 0),
            identifier: symbol,
            maxResults: this.config.maxResults,
            includeDeclaration: true,
            precise: true,
        });
        const result = await (this.coreAnalyzer as any).findDefinitionAsync(request);
        return result.data;
    }

    /**
     * Convenience: for E2E validator – direct references lookup
     */
    async findReferences(file: string, symbol: string): Promise<any[]> {
        try {
            await (this.coreAnalyzer as any)?.initialize?.();
        } catch {}
        const uri = normalizeUri(file || 'file://workspace');
        const request = buildFindReferencesRequest({
            uri,
            position: createPosition(0, 0),
            identifier: symbol,
            maxResults: this.config.maxResults,
            includeDeclaration: false,
            precise: true,
        });
        const result = await (this.coreAnalyzer as any).findReferencesAsync(request);
        return result.data;
    }

    /**
     * Convenience: for E2E validator – perform rename (preview)
     */
    async rename(
        file: string,
        position: { line: number; character: number },
        newName: string
    ): Promise<Record<string, any>> {
        try {
            await (this.coreAnalyzer as any)?.initialize?.();
        } catch {}
        const uri = normalizeUri(file || 'file://workspace');
        const identifier = this.extractWordFromFile(uri, position.line, position.character) || 'symbol';
        const request = buildRenameRequest({ uri, position, identifier, newName, dryRun: true });
        const result = await this.coreAnalyzer.rename(request);
        return { changes: result.data.changes || {}, performance: result.performance, preview: true };
    }

    private extractWordFromFile(uri: string, line: number, character: number): string | null {
        try {
            const path = uri.startsWith('file://') ? uri.substring(7) : uri;
            if (!fs.existsSync(path)) return null;
            const text = fs.readFileSync(path, 'utf8');
            const lines = text.split(/\r?\n/);
            if (line < 0 || line >= lines.length) return null;
            const ln = lines[line];
            const idx = Math.min(Math.max(character, 0), ln.length);
            const re = /[A-Za-z0-9_]+/g;
            let m: RegExpExecArray | null = null;
            while ((m = re.exec(ln))) {
                const start = m.index;
                const end = start + m[0].length;
                if (idx >= start && idx <= end) return m[0];
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Convenience: for E2E validator – refactor suggestions (stub)
     */
    async suggestRefactoring(_file: string): Promise<Record<string, any>> {
        return { suggestions: [], status: 'ok' };
    }

    /**
     * Handle find command
     */
    async handleFind(
        identifier: string,
        options: {
            file?: string;
            maxResults?: number;
            json?: boolean;
            limit?: number;
            verbose?: boolean;
            summary?: boolean;
            precise?: boolean;
            astOnly?: boolean;
        }
    ): Promise<any> {
        try {
            // Parity + UX: when identifier is empty
            if (!identifier || !String(identifier).trim()) {
                // If a file context is provided, return an empty structured array for consistency checks
                if (options.file) return [];
                // Otherwise return a concise message for CLI UX
                return 'Find failed: identifier required';
            }
            const request = buildFindDefinitionRequest({
                uri: normalizeUri(options.file || 'file://workspace'),
                position: createPosition(0, 0),
                identifier,
                maxResults: options.maxResults || this.config.maxResults,
                includeDeclaration: true,
                precise: options.precise,
            });
            (request as any).astOnly = !!(options.astOnly || options.precise);

            // Prefer async fast-path to avoid LayerManager gating timeouts
            const result = await (this.coreAnalyzer as any).findDefinitionAsync(request);
            const limit = options.limit ?? this.config.printLimit ?? 20;
            const items = result.data.slice(0, limit);
            if (options.json) {
                return JSON.stringify(
                    {
                        count: result.data.length,
                        shown: items.length,
                        items,
                        performance: result.performance,
                        requestId: result.requestId,
                    },
                    null,
                    2
                );
            }
            if (options.summary || options.verbose) {
                // For programmatic use, return structured items; CLI wrapper adds presentation
                return items;
            }
            // Default for adapters/tests: structured items array
            return items;
        } catch (error) {
            return this.formatError(`Find failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    /**
     * Handle references command
     */
    async handleReferences(
        identifier: string,
        options: {
            file?: string;
            includeDeclaration?: boolean;
            maxResults?: number;
            json?: boolean;
            limit?: number;
            verbose?: boolean;
            summary?: boolean;
            precise?: boolean;
            astOnly?: boolean;
        }
    ): Promise<any> {
        try {
            // Parity + UX: when identifier is empty
            if (!identifier || !String(identifier).trim()) {
                if (options.file) return [];
                return 'References search failed: identifier required';
            }

            // When no file context provided, first locate the symbol via definitions
            // to get seed files for a more targeted references search
            let contextUri = options.file ? normalizeUri(options.file) : 'file://workspace';
            if (!options.file) {
                try {
                    const defRequest = buildFindDefinitionRequest({
                        uri: 'file://workspace',
                        position: createPosition(0, 0),
                        identifier,
                        maxResults: 10,
                        includeDeclaration: true,
                        precise: false,
                    });
                    const defResult = await (this.coreAnalyzer as any).findDefinitionAsync(defRequest);
                    // Use first definition file as context for references search
                    if (defResult?.data?.[0]?.uri) {
                        contextUri = defResult.data[0].uri;
                    }
                } catch {
                    // Fallback to workspace search
                }
            }

            const request = buildFindReferencesRequest({
                uri: contextUri,
                position: createPosition(0, 0),
                identifier,
                maxResults: options.maxResults || this.config.maxResults,
                includeDeclaration: options.includeDeclaration ?? false,
                precise: options.precise,
            });
            (request as any).astOnly = !!(options.astOnly || options.precise);

            // Prefer async fast-path for references as well
            const result = await (this.coreAnalyzer as any).findReferencesAsync(request);
            const limit = options.limit ?? this.config.printLimit ?? 20;
            const items = result.data.slice(0, limit);
            if (options.json) {
                return JSON.stringify(
                    {
                        count: result.data.length,
                        shown: items.length,
                        items,
                        performance: result.performance,
                        requestId: result.requestId,
                    },
                    null,
                    2
                );
            }
            if (options.summary || options.verbose) {
                return items;
            }
            return items;
        } catch (error) {
            return this.formatError(`References search failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    /**
     * Handle rename command
     */
    async handleRename(identifier: string, newName: string, options: { dryRun?: boolean }): Promise<string> {
        try {
            const request = buildRenameRequest({
                uri: normalizeUri('file://workspace'),
                position: createPosition(0, 0),
                identifier,
                newName,
                dryRun: options.dryRun ?? true,
            });

            const result = await this.coreAnalyzer.rename(request);

            const changes = Object.entries(result.data.changes || {});

            if (changes.length === 0) {
                return this.formatWarning(`No changes needed for renaming '${identifier}' to '${newName}'`);
            }

            const totalEdits = changes.reduce((acc, [, edits]) => acc + edits.length, 0);
            const mode = options.dryRun ? 'Preview' : 'Applied';

            const output = [
                this.formatHeader(`${mode}: Rename '${identifier}' to '${newName}'`),
                this.formatInfo(`${changes.length} files affected, ${totalEdits} edits`),
                '',
                ...changes
                    .slice(0, 10)
                    .map(([uri, edits]) => `  ${uri} (${edits.length} edit${edits.length === 1 ? '' : 's'})`),
            ];

            if (changes.length > 10) {
                output.push(`  ... and ${changes.length - 10} more files`);
            }

            output.push('', this.formatPerformance(result.performance));

            if (options.dryRun) {
                output.push('', this.formatInfo('Run with --no-dry-run to apply changes'));
            }

            return output.join('\n');
        } catch (error) {
            return this.formatError(`Rename failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    /**
     * Handle plan-rename command (preview only)
     */
    async handlePlanRename(
        identifier: string,
        newName: string,
        options: { json?: boolean; limit?: number }
    ): Promise<string> {
        try {
            const request = buildRenameRequest({
                uri: normalizeUri('file://workspace'),
                position: createPosition(0, 0),
                identifier,
                newName,
                dryRun: true,
            });

            const result = await this.coreAnalyzer.rename(request);
            const changes = Object.entries(result.data.changes || {});
            const totalEdits = changes.reduce((acc, [, edits]) => acc + (edits as any[]).length, 0);

            if ((options as any).json) {
                return JSON.stringify(
                    {
                        preview: true,
                        filesAffected: changes.length,
                        totalEdits,
                        changes: result.data.changes,
                        performance: result.performance,
                    },
                    null,
                    2
                );
            }

            const output = [
                this.formatHeader(`Plan: Rename '${identifier}' → '${newName}'`),
                `Files: ${changes.length}, Edits: ${totalEdits}`,
            ];
            const shown = changes.slice(0, Math.min(changes.length, options.limit ?? 10));
            for (const [uri, edits] of shown) {
                output.push(`  ${uri} (${(edits as any[]).length} edits)`);
            }
            if (shown.length < changes.length) {
                output.push(`  ... and ${changes.length - shown.length} more files`);
            }
            return output.join('\n');
        } catch (error) {
            return this.formatError(`Plan rename failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    /**
     * Text search using Layer 1 Fast Search through CodeAnalyzer
     */
    async handleTextSearch(
        query: string,
        options: {
            kind?: 'literal' | 'regex' | 'word';
            caseInsensitive?: boolean;
            path?: string;
            maxResults?: number;
            json?: boolean;
        }
    ): Promise<string> {
        try {
            // Ensure analyzer is initialized
            await (this.coreAnalyzer as any)?.initialize?.();
            const kind = options.kind || 'literal';
            const maxResults = Math.min(options.maxResults || this.config.maxResults || 200, 1000);
            const searchPath = options.path || process.cwd();

            const searchViaAsyncGrep = async (pattern: string, useRegex: boolean) => {
                const asyncGrep = new AsyncEnhancedGrep({ cacheSize: 500, cacheTTL: 30000 });
                const results = await asyncGrep.search({
                    pattern,
                    path: searchPath,
                    maxResults,
                    timeout: 200,
                    caseInsensitive: options.caseInsensitive,
                    useRegex,
                });
                const normalized = results.map((r) => ({
                    file: r.file,
                    line: r.line ?? 0,
                    column: r.column ?? 0,
                    text: r.text,
                }));
                return { count: normalized.length, results: normalized };
            };

            const result =
                kind === 'literal'
                    ? await this.coreAnalyzer.textSearch(escapeRegex(query), {
                          path: searchPath,
                          maxResults,
                          caseInsensitive: options.caseInsensitive,
                      })
                    : kind === 'word'
                      ? await searchViaAsyncGrep(`\\b${escapeRegex(query)}\\b`, true)
                      : await searchViaAsyncGrep(query, true);

            return options.json
                ? JSON.stringify(result, null, 2)
                : result.results.map((r) => `${r.file}:${r.line}:${r.column}: ${r.text}`).join('\n');
        } catch (error) {
            // Fallback to direct AsyncEnhancedGrep if textSearch fails
            if (process.env.DEBUG_TEXT_SEARCH === '1') {
                console.error('[CLI handleTextSearch] Error calling textSearch:', error);
            }
            const kind = options.kind || 'literal';
            const caseInsensitive = !!options.caseInsensitive;
            const maxResults = Math.min(options.maxResults || this.config.maxResults || 200, 1000);
            const path = options.path || process.cwd();
            const asyncGrep = new AsyncEnhancedGrep({ cacheSize: 500, cacheTTL: 30000 });
            const pattern =
                kind === 'word' ? `\\b${escapeRegex(query)}\\b` : kind === 'literal' ? escapeRegex(query) : query;
            const results = await asyncGrep.search({ pattern, path, maxResults, timeout: 200, caseInsensitive, useRegex: kind !== 'literal' });
            const normalized = results.map((r) => ({
                file: r.file,
                line: r.line ?? 0,
                column: r.column ?? 0,
                text: r.text,
            }));
            return options.json
                ? JSON.stringify({ count: normalized.length, results: normalized }, null, 2)
                : normalized.map((r) => `${r.file}:${r.line}:${r.column}: ${r.text}`).join('\n');
        }
    }

    /**
     * Symbol search using L3 buildSymbolMap (AST-only)
     */
    async handleSymbolSearch(query: string, options: { maxResults?: number; json?: boolean }): Promise<string> {
        const maxResults = Math.min(options.maxResults || 50, 200);
        const res = await (this.coreAnalyzer as any).buildSymbolMap({
            identifier: query,
            maxFiles: maxResults,
            astOnly: true,
        });
        const out = (res?.declarations || [])
            .slice(0, maxResults)
            .map((d: any) => ({ uri: d.uri, range: d.range, kind: d.kind, name: d.name || query }));
        return options.json
            ? JSON.stringify({ query, count: out.length, symbols: out }, null, 2)
            : out.map((s) => `${s.kind || 'symbol'} ${s.name} @ ${s.uri}:${s.range?.start?.line ?? 0}`).join('\n');
    }

    /**
     * Snapshot creation
     */
    async handleGetSnapshot(options?: { preferExisting?: boolean; json?: boolean }): Promise<string> {
        const snap = overlayStore.createSnapshot(!!options?.preferExisting);
        return options?.json ? JSON.stringify({ snapshot: snap.id }, null, 2) : snap.id;
    }

    /**
     * Propose patch against snapshot; optionally run checks
     */
    async handleProposePatch(
        patch: string,
        options: { snapshot?: string; runChecks?: boolean; commands?: string[]; timeoutSec?: number; json?: boolean }
    ): Promise<string> {
        let snap;
        try {
            snap = overlayStore.ensureSnapshot(options.snapshot);
        } catch (e) {
            return this.formatError(`invalid snapshot: ${e instanceof Error ? e.message : String(e)}`);
        }
        const res = overlayStore.stagePatch(snap.id, patch);
        if (!res.accepted) return this.formatError(res.message || 'Patch rejected');
        if (options.runChecks) {
            const r = await overlayStore.runChecks(snap.id, options.commands || [], options.timeoutSec || 120);
            const payload = {
                snapshot: snap.id,
                accepted: true,
                checks: { ok: r.ok, elapsedMs: r.elapsedMs, commands: r.commands || [], output: r.output.slice(-4000) },
            };
            return options.json
                ? JSON.stringify(payload, null, 2)
                : `${snap.id} ${r.ok ? 'OK' : 'FAIL'} (${r.elapsedMs}ms)`;
        }
        const payload = { snapshot: snap.id, accepted: true };
        return options.json ? JSON.stringify(payload, null, 2) : snap.id;
    }

    /**
     * Run checks for snapshot
     */
    async handleRunChecks(options: {
        snapshot: string;
        commands?: string[];
        timeoutSec?: number;
        json?: boolean;
    }): Promise<string> {
        const snapId = options.snapshot;
        if (!snapId) return this.formatError('snapshot required');
        const r = await overlayStore.runChecks(snapId, options.commands || [], options.timeoutSec || 120);
        const payload = { snapshot: snapId, ok: r.ok, elapsedMs: r.elapsedMs, commands: r.commands || [], output: r.output.slice(-4000) };
        return options.json ? JSON.stringify(payload, null, 2) : `${snapId} ${r.ok ? 'OK' : 'FAIL'} (${r.elapsedMs}ms)`;
    }

    /**
     * Snapshots cleanup
     */
    async handleSnapshotsClean(options: { maxKeep?: number; maxAgeDays?: number }): Promise<string> {
        const maxKeep = typeof options.maxKeep === 'number' ? options.maxKeep : 10;
        const days = typeof options.maxAgeDays === 'number' ? options.maxAgeDays : 3;
        const maxAgeMs = Math.max(0, days) * 24 * 60 * 60 * 1000;
        await overlayStore.cleanup(maxKeep, maxAgeMs);
        return `Cleaned snapshots (maxKeep=${maxKeep}, maxAgeDays=${days})`;
    }

    /**
     * AST query via Tree-sitter
     */
    async handleAstQuery(options: {
        language: 'typescript' | 'javascript' | 'python';
        query: string;
        paths?: string[];
        glob?: string;
        limit?: number;
        json?: boolean;
    }): Promise<string> {
        const { runAstQuery } = await import('../core/ast-query.js');
        const out = await runAstQuery({
            language: options.language,
            query: options.query,
            paths: options.paths,
            glob: options.glob,
            limit: options.limit,
        });
        return options.json ? JSON.stringify(out, null, 2) : String(out.count);
    }

    /**
     * Graph expand (imports/exports for file; callers/callees stub)
     */
    async handleGraphExpand(options: {
        file?: string;
        symbol?: string;
        edges: string[];
        depth?: number;
        limit?: number;
        json?: boolean;
        seedOnly?: boolean;
    }): Promise<string> {
        const { expandNeighbors } = await import('../core/code-graph.js');
        let seedFiles: string[] | undefined;
        if (options.symbol) {
            try {
                const sm = await (this.coreAnalyzer as any).buildSymbolMap({
                    identifier: options.symbol,
                    maxFiles: 50,
                    astOnly: true,
                });
                seedFiles = Array.from(
                    new Set(
                        (sm?.declarations || []).map((d: any) => {
                            try {
                                return new URL(d.uri).pathname;
                            } catch {
                                return d.uri.replace(/^file:\/\//, '');
                            }
                        })
                    )
                );
            } catch {}
        }
        const out = await expandNeighbors({
            file: options.file,
            symbol: options.symbol,
            edges: options.edges || ['imports', 'exports'],
            depth: options.depth,
            limit: options.limit,
            seedFiles,
            seedStrict: !!options.seedOnly,
        });
        return options.json
            ? JSON.stringify(out, null, 2)
            : (out.file || out.symbol || '') + ` -> ` + Object.keys(out.neighbors || {}).join(',');
    }

    /**
     * Handle stats command
     */
    async handleStats(options?: { json?: boolean }): Promise<string> {
        try {
            const diagnostics = this.coreAnalyzer.getDiagnostics();
            const l4 = (this.coreAnalyzer as any).getLayer4StorageMetrics?.();
            const lm: any = (this.coreAnalyzer as any).layerManager;
            const l1: any = lm?.getLayer?.('layer1');
            const l2: any = lm?.getLayer?.('layer2');
            const l1m =
                l1 && l1.name === 'FastSearchLayer' && typeof l1.getMetrics === 'function' ? l1.getMetrics() : null;
            const l2m =
                l2 && l2.name === 'TreeSitterLayer' && typeof l2.getMetrics === 'function' ? l2.getMetrics() : null;

            const output = [
                this.formatHeader('Semantic Code Intelligence Statistics'),
                `Status: ${diagnostics.initialized ? 'Initialized' : 'Not initialized'}`,
                '',
                this.formatHeader('Layer Status:'),
                ...Object.entries(diagnostics.layerManager?.layers || {}).map(
                    ([layer, status]) => `  ${layer}: ${status ? 'Active' : 'Inactive'}`
                ),
                '',
                this.formatHeader('Layer 1 (Fast Search):'),
                l1m
                    ? `  searches=${l1m.layer.searches} cacheHits=${l1m.layer.cacheHits} fallbacks=${l1m.layer.fallbacks} timeouts=${l1m.layer.timeouts} avgMs=${Math.round(l1m.layer.avgResponseTime)}`
                    : '  (no metrics)',
                l1m?.asyncTools
                    ? `  async: pool=${l1m.asyncTools.processPoolSize ?? 'auto'} defaultTimeout=${l1m.asyncTools.defaultTimeout ?? 'auto'}ms`
                    : '',
                '',
                this.formatHeader('Layer 2 (AST Parser):'),
                l2m
                    ? `  parses=${l2m.count} errors=${l2m.errors} p50=${Math.round(l2m.p50)}ms p95=${Math.round(l2m.p95)}ms`
                    : '  (no metrics)',
                '',
                this.formatHeader('Performance:'),
                `Cache enabled: ${diagnostics.sharedServices?.cache?.enabled ?? 'Unknown'}`,
                `Learning enabled: ${diagnostics.learningCapabilities?.patternLearning ?? 'Unknown'}`,
                '',
                this.formatHeader('Layer 4 Storage Metrics (recent):'),
            ];

            if (l4?.operations) {
                const ops = l4.operations as any;
                const opNames = Object.keys(ops);
                for (const name of opNames) {
                    const s = ops[name];
                    if (!s || !s.count) continue;
                    output.push(
                        `  ${name}: count=${s.count}, errors=${s.errors}, p50=${Math.round(s.p50)}ms, p95=${Math.round(
                            s.p95
                        )}ms, p99=${Math.round(s.p99)}ms`
                    );
                }
            } else {
                output.push('  (no metrics yet)');
            }

            output.push('', `Timestamp: ${new Date(diagnostics.timestamp).toISOString()}`);

            // Return JSON if requested
            if (options?.json) {
                const statsData = {
                    status: diagnostics.initialized ? 'Initialized' : 'Not initialized',
                    layers: diagnostics.layerManager?.layers || {},
                    layer1: l1m || null,
                    layer2: l2m || null,
                    layer4: l4 || null,
                    cache: diagnostics.cache || {},
                    performance: diagnostics.performance || {},
                    timestamp: diagnostics.timestamp,
                };
                return JSON.stringify(statsData, null, 2);
            }

            return output.join('\n');
        } catch (error) {
            return this.formatError(`Stats failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    /**
     * Handle explore command: parallel definitions+references aggregation
     */
    async handleExplore(
        identifier: string,
        options: {
            file?: string;
            maxResults?: number;
            includeDeclaration?: boolean;
            json?: boolean;
            limit?: number;
            verbose?: boolean;
            summary?: boolean;
            precise?: boolean;
            conceptual?: boolean;
        }
    ): Promise<string> {
        try {
            const uri = normalizeUri(options.file || 'file://workspace');
            const result = await (this.coreAnalyzer as any).exploreCodebase({
                uri,
                identifier,
                includeDeclaration: options.includeDeclaration ?? true,
                maxResults: options.maxResults || this.config.maxResults,
                precise: options.precise,
                conceptual: !!options.conceptual,
            });

            const defLimit = options.limit ?? this.config.printLimit ?? 10;
            const refLimit = options.limit ?? this.config.printLimit ?? 10;
            const defs = result.definitions.slice(0, defLimit);
            const refs = result.references.slice(0, refLimit);
            if (options.json) {
                return JSON.stringify(
                    {
                        symbol: result.symbol,
                        contextUri: result.contextUri,
                        definitions: defs,
                        references: refs,
                        counts: { definitions: result.definitions.length, references: result.references.length },
                        performance: result.performance,
                        timestamp: result.timestamp,
                    },
                    null,
                    2
                );
            }
            if (options.summary) {
                const lines: string[] = [];
                lines.push(this.formatHeader(`Explore: '${identifier}'`));
                lines.push(`Context: ${uri}`);
                lines.push(
                    `Definitions: ${result.definitions.length} (showing ${defs.length}) | References: ${result.references.length} (showing ${refs.length})`
                );
                if (defs[0]) lines.push(`Top Def: ${formatDefinitionForCli(defs[0])}`);
                if (refs[0]) lines.push(`Top Ref: ${formatReferenceForCli(refs[0])}`);
                return lines.join('\n');
            }
            const lines: string[] = [];
            lines.push(this.formatHeader(`Explore: '${identifier}'`));
            lines.push(`Context: ${uri}`);
            lines.push('');
            lines.push(this.formatHeader(`Definitions (showing ${defs.length} of ${result.definitions.length}):`));
            defs.forEach((def: any) => {
                lines.push(
                    `  ${def.uri}:${def.range.start.line + 1}:${def.range.start.character + 1} [${def.kind}] (${Math.round(def.confidence * 100)}%)`
                );
            });
            lines.push('');
            lines.push(this.formatHeader(`References (showing ${refs.length} of ${result.references.length}):`));
            refs.forEach((ref: any) => {
                lines.push(
                    `  ${ref.uri}:${ref.range.start.line + 1}:${ref.range.start.character + 1} [${ref.kind}] (${Math.round(ref.confidence * 100)}%)`
                );
            });
            lines.push('');
            lines.push(this.formatHeader('Performance:'));
            lines.push(`  total: ${result.performance.total}ms`);
            if (result.performance.definitions) lines.push(`  definitions: ${result.performance.definitions.total}ms`);
            if (result.performance.references) lines.push(`  references: ${result.performance.references.total}ms`);
            lines.push('');
            lines.push(`Timestamp: ${new Date(result.timestamp).toISOString()}`);
            return lines.join('\n');
        } catch (error) {
            return this.formatError(`Explore failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    /**
     * Handle symbol-map command
     */
    async handleSymbolMap(
        identifier: string,
        options: { file?: string; maxFiles?: number; json?: boolean }
    ): Promise<string> {
        try {
            const res = await (this.coreAnalyzer as any).buildSymbolMap({
                identifier,
                uri: normalizeUri(options.file || 'file://workspace'),
                maxFiles: Math.min(options.maxFiles ?? 10, 100),
                astOnly: true,
            });
            if (options.json) return JSON.stringify(res, null, 2);

            const lines: string[] = [];
            lines.push(this.formatHeader(`Symbol Map: '${identifier}'`));
            lines.push(`Files analyzed: ${res.files}`);
            lines.push(`Declarations: ${res.declarations.length} | References: ${res.references.length}`);
            const show = (arr: any[], label: string) => {
                if (arr.length === 0) return;
                lines.push(this.formatHeader(label));
                for (const item of arr.slice(0, 10)) {
                    lines.push(
                        `  ${item.uri}:${item.range.start.line + 1}:${item.range.start.character + 1} ${
                            item.kind || ''
                        } ${item.name || ''}`
                    );
                }
                if (arr.length > 10) lines.push(`  ... and ${arr.length - 10} more`);
            };
            show(res.declarations, 'Declarations');
            show(res.references, 'References');
            return lines.join('\n');
        } catch (error) {
            return this.formatError(`Symbol map failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    /**
     * Handle symbol-map-graph command (Mermaid output)
     */
    async handleSymbolMapGraph(
        identifier: string,
        options: { file?: string; maxFiles?: number; astOnly?: boolean }
    ): Promise<string> {
        try {
            const res = await (this.coreAnalyzer as any).buildSymbolMap({
                identifier,
                uri: normalizeUri(options.file || 'file://workspace'),
                maxFiles: Math.min(options.maxFiles ?? 10, 100),
                astOnly: options.astOnly ?? true,
            });

            const bn = (uri: string) => {
                if (!uri) return '';
                const p = (uri || '').startsWith('file://') ? (uri as string).slice(7) : String(uri);
                try {
                    const rel = (p || '').replace(/\\/g, '/');
                    const cwd = (process.cwd() + '/').replace(/\\/g, '/');
                    return rel.startsWith(cwd) ? rel.slice(cwd.length) : rel;
                } catch {
                    return p;
                }
            };
            const lc = (r: any) => {
                const line = Number(r?.start?.line ?? 0) + 1;
                const col = Number(r?.start?.character ?? 0) + 1;
                return `${line}:${col}`;
            };

            const names: string[] = [];
            const decls = Array.isArray(res?.declarations) ? res.declarations : [];
            const refs = Array.isArray(res?.references) ? res.references : [];
            for (const d of decls) if ((d as any).name) names.push(String((d as any).name));
            for (const r of refs) if ((r as any).name) names.push(String((r as any).name));
            // Fallback: consult Layer 1 async fast-path to infer canonical token if no names extracted
            if (names.length === 0) {
                try {
                    const defProbe = await (this.coreAnalyzer as any).findDefinitionAsync({
                        uri: normalizeUri(options.file || 'file://workspace'),
                        position: createPosition(0, 0),
                        identifier,
                        includeDeclaration: true,
                        maxResults: options.maxFiles ?? 20,
                        precise: false,
                    });
                    for (const d of defProbe?.data || []) {
                        if ((d as any).name) names.push(String((d as any).name));
                    }
                } catch {}
            }
            const canonical = (() => {
                if (names.length === 0) return identifier;
                // Pick most frequent name; tie-breaker by minimal Levenshtein distance to input
                const freq = new Map<string, number>();
                for (const n of names) freq.set(n, (freq.get(n) || 0) + 1);
                const max = Math.max(...[...freq.values()]);
                const candidates = [...freq.entries()].filter(([, c]) => c === max).map(([n]) => n);
                candidates.sort((a, b) => leven(a, identifier) - leven(b, identifier));
                return candidates[0] || identifier;
            })();

            const lines: string[] = [];
            lines.push('graph TD');
            lines.push(`  S["Symbol: ${canonical}"]`);
            decls.forEach((d: any, i: number) => {
                lines.push(`  D${i + 1}["Decl ${bn(d.uri)}:${lc(d.range)}"]`);
                lines.push(`  S --> D${i + 1}`);
            });
            refs.forEach((r: any, i: number) => {
                const kind = r.kind || 'ref';
                lines.push(`  R${i + 1}["Ref ${kind} ${bn(r.uri)}:${lc(r.range)}"]`);
                lines.push(`  S --> R${i + 1}`);
            });
            return lines.join('\n');
        } catch (error) {
            return this.formatError(`Symbol map graph failed: ${handleAdapterError(error, 'cli')}`);
        }
    }

    // ===== FORMATTING METHODS =====

    private formatHeader(text: string): string {
        if (!this.config.colorOutput) return text;
        return `\x1b[1m\x1b[36m${text}\x1b[0m`; // Bold cyan
    }

    private formatError(text: string): string {
        if (!this.config.colorOutput) return `Error: ${text}`;
        return `\x1b[1m\x1b[31mError: ${text}\x1b[0m`; // Bold red
    }

    private formatWarning(text: string): string {
        if (!this.config.colorOutput) return `Warning: ${text}`;
        return `\x1b[1m\x1b[33mWarning: ${text}\x1b[0m`; // Bold yellow
    }

    private formatInfo(text: string): string {
        if (!this.config.colorOutput) return text;
        return `\x1b[36m${text}\x1b[0m`; // Cyan
    }

    /**
     * Initialize the CLI adapter
     */
    async initialize(): Promise<void> {
        // CLI adapter doesn't need special initialization - just ensure core analyzer is ready
        // Core analyzer is passed in constructor and should already be initialized
    }

    /**
     * Dispose the CLI adapter
     */
    async dispose(): Promise<void> {
        // CLI adapter doesn't hold resources that need cleanup
    }

    /**
     * Execute command for testing
     */
    async executeCommand(args: string[]): Promise<{ success: boolean; data?: any; message?: string }> {
        if (!args || args.length === 0) {
            return { success: false, message: 'No command provided' };
        }

        const command = args[0];
        const options = this.parseOptions(args.slice(1));

        try {
            let result: string;

            switch (command) {
                case 'find':
                    if (args[1] === undefined) {
                        return { success: false, message: 'Identifier required for find command' };
                    }
                    result = await this.handleFind(args[1], options);
                    return { success: true, data: result };

                case 'references':
                    if (args[1] === undefined) {
                        return { success: false, message: 'Identifier required for references command' };
                    }
                    result = await this.handleReferences(args[1], options);
                    return { success: true, data: result };

                case 'rename':
                    if (!args[1] || !args[2]) {
                        return { success: false, message: 'Old name and new name required for rename command' };
                    }
                    result = await this.handleRename(args[1], args[2], options);
                    return { success: true, data: result };

                case 'plan-rename':
                    if (!args[1] || !args[2]) {
                        return { success: false, message: 'Old name and new name required for plan-rename command' };
                    }
                    result = await this.handlePlanRename(args[1], args[2], options as any);
                    return { success: true, data: result };

                case 'stats':
                    result = await this.handleStats();
                    return { success: true, data: result };

                case 'symbol-map':
                    if (!args[1]) {
                        return { success: false, message: 'Identifier required for symbol-map command' };
                    }
                    result = await this.handleSymbolMap(args[1], options as any);
                    return { success: true, data: result };

                default:
                    return { success: false, message: `Unknown command: ${command}` };
            }
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private parseOptions(args: string[]): Record<string, any> {
        const options: Record<string, any> = {};

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];

            if (arg === '--file' && i + 1 < args.length) {
                options.file = args[i + 1];
                i++; // Skip next arg
            } else if (arg === '--include-declaration') {
                options.includeDeclaration = true;
            } else if (arg === '--max-results' && i + 1 < args.length) {
                options.maxResults = parseInt(args[i + 1], 10);
                i++; // Skip next arg
            } else if (arg === '--no-dry-run') {
                options.dryRun = false;
            } else if (arg === '--verbose') {
                options.verboseMode = true;
            } else if (arg === '--summary') {
                options.summary = true;
            } else if (arg === '--json') {
                options.json = true;
            } else if (arg === '--max-files' && i + 1 < args.length) {
                options.maxFiles = parseInt(args[i + 1], 10);
                i++;
            }
        }

        return options;
    }

    private formatPerformance(performance: any): string {
        if (!this.config.verboseMode) return '';

        const layers = ['layer1', 'layer2', 'layer3', 'layer4', 'layer5'];
        const timings = layers
            .filter((layer) => performance[layer] > 0)
            .map((layer) => `${layer}: ${performance[layer]}ms`)
            .join(', ');

        return this.formatInfo(`Performance: ${timings} (total: ${performance.total}ms)`);
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
