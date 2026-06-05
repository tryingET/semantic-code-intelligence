#!/usr/bin/env bun

// Suppress background metrics and any stdio noise in CLI context
process.env.SILENT_MODE = 'true';
process.env.STDIO_MODE = 'true';

/**
 * CLI Tool - Thin wrapper around unified core
 *
 * This CLI only handles command parsing and output formatting:
 * - Argument parsing
 * - Command routing
 * - Output presentation
 *
 * All analysis work is delegated to the CLI adapter and core analyzer.
 *
 * Metrics: When PUSHGATEWAY_URL is set, the CLI records tool call metrics
 * and pushes them to the Prometheus Pushgateway on exit.
 */

import { spawnSync } from 'child_process';
import { Command } from 'commander';
import * as fs from 'fs';
// Note: defer heavy imports (tree-sitter, analyzer, adapter) to runtime.
// This keeps `--help` and `init` working even if native deps are unavailable.
import * as path from 'path';
import { parseIntegerOption, strictJsonParse } from '../adapters/utils.js';
import { CoreError, isCoreError } from '../core/errors.js';
import { assertAlphaMvpToolAllowed } from '../core/tools/alpha-surface.js';
import { SCI_VERSION } from '../core/version.js';
import { workflowErrorPayload } from '../core/workflows/tool-result-normalizer.js';
import { workspaceInputToPath } from '../core/workspace-input.js';
import { openWorkspaceFileForRead } from '../core/workspace-path.js';
import { getPushgatewayUrl, pushToGateway, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';

class CLI {
    private program: Command;
    private coreAnalyzer!: any;
    private cliAdapter!: any;
    private initialized = false;
    private coreConfig: any;
    private workspaceRoot: string = process.cwd();
    private fmtDef?: (d: any) => string;
    private fmtRef?: (r: any) => string;
    private toolRouter!: any;
    private toolExecutor!: any;
    private colorOutput = true;
    private commanderErrorOutput = '';

    // Metrics tracking for CLI commands
    private currentCommand: string | null = null;
    private commandStartTime: number = 0;
    private commandSuccess: boolean = true;

    constructor() {
        this.program = new Command();
        this.program.exitOverride();
        this.program.configureOutput({
            writeOut: (str) => process.stdout.write(str),
            writeErr: (str) => {
                this.commanderErrorOutput += str;
            },
        });
        this.setupCommands();
    }

    /**
     * Start tracking a CLI command for metrics.
     * Call this at the beginning of each command action.
     */
    private startCommandMetrics(commandName: string): void {
        this.currentCommand = commandName;
        this.commandStartTime = Date.now();
        this.commandSuccess = true;
        recordToolStart('cli');
    }

    /**
     * Mark the current command as failed for metrics purposes.
     */
    private markCommandFailed(): void {
        this.commandSuccess = false;
    }

    /**
     * End metrics tracking for the current command.
     * Called automatically in shutdown().
     */
    private endCommandMetrics(): void {
        if (this.currentCommand) {
            const duration = Date.now() - this.commandStartTime;
            recordToolEnd('cli', this.currentCommand, duration, this.commandSuccess);
            this.currentCommand = null;
        }
    }

    private setupCommands(): void {
        this.program
            .name('semantic-code-intelligence')
            .description('Semantic Code Intelligence CLI')
            .version(SCI_VERSION);

        // Find command
        this.program
            .command('find <identifier>')
            .aliases(['def', 'definitions'])
            .description('Find symbol definitions with fuzzy matching')
            .option('-f, --file <path>', 'Specific file context')
            .option('-n, --max-results <count>', 'Maximum results to search', '50')
            .option('-l, --limit <count>', 'Maximum results to print', '20')
            .option('-s, --summary', 'Show summary output only')
            .option('--precise', 'Run a quick AST validation pass')
            .option('--ast-only', 'Only return AST-validated results')
            .option('-j, --json', 'Output JSON')
            .option('--no-color', 'Disable colored output')
            .option('-v, --verbose', 'Verbose output with performance info')
            .action(async (identifier, options) => {
                this.startCommandMetrics('find');
                try {
                    await this.ensureInitialized(options);
                    const result = await this.cliAdapter.handleFind(identifier, {
                        file: options.file,
                        maxResults: parseIntegerOption(options.maxResults, 'max-results', { defaultValue: 50, min: 1 }),
                        limit: parseIntegerOption(options.limit, 'limit', { defaultValue: 20, min: 1 }),
                        summary: !!options.summary,
                        precise: !!options.precise,
                        astOnly: !!options.astOnly,
                        json: !!options.json,
                        verbose: !!options.verbose,
                    });
                    await this.exitIfAdapterError(result, !!options.json);
                    if (typeof result === 'string' || options.json) {
                        console.log(result);
                    } else if (Array.isArray(result)) {
                        const items = result as any[];
                        if (options.summary) {
                            const header = this.formatHeader(
                                `Found ${items.length} definitions (showing ${items.length})`
                            );
                            const top = items[0]
                                ? `Top: ${this.fmtDef ? this.fmtDef(items[0]) : JSON.stringify(items[0])}`
                                : 'Top: (none)';
                            console.log([header, top].join('\n'));
                        } else {
                            const lines: string[] = [
                                this.formatHeader(`Found ${items.length} definitions (showing ${items.length})`),
                            ];
                            for (const d of items) lines.push(`  ${this.fmtDef ? this.fmtDef(d) : JSON.stringify(d)}`);
                            console.log(lines.join('\n'));
                        }
                    } else {
                        console.log(result);
                    }
                } catch (e) {
                    this.markCommandFailed();
                    throw e;
                }
                await this.shutdown();
                process.exit(0);
            });

        // References command
        this.program
            .command('references <identifier>')
            .aliases(['ref'])
            .description('Find all references to a symbol')
            .option('-f, --file <path>', 'Specific file or directory context')
            .option('-d, --include-declaration', 'Include symbol declaration in results')
            .option('-n, --max-results <count>', 'Maximum results to search', '50')
            .option('-l, --limit <count>', 'Maximum results to print', '20')
            .option('-s, --summary', 'Show summary output only')
            .option('--precise', 'Run a quick AST validation pass')
            .option('--ast-only', 'Only return AST-validated results')
            .option('-j, --json', 'Output JSON')
            .option('--no-color', 'Disable colored output')
            .option('-v, --verbose', 'Verbose output with performance info')
            .action(async (identifier, options) => {
                this.startCommandMetrics('references');
                try {
                    await this.ensureInitialized(options);
                    const result = await this.cliAdapter.handleReferences(identifier, {
                        file: options.file,
                        includeDeclaration: options.includeDeclaration,
                        maxResults: parseIntegerOption(options.maxResults, 'max-results', { defaultValue: 50, min: 1 }),
                        limit: parseIntegerOption(options.limit, 'limit', { defaultValue: 20, min: 1 }),
                        summary: !!options.summary,
                        precise: !!options.precise,
                        astOnly: !!options.astOnly,
                        json: !!options.json,
                        verbose: !!options.verbose,
                    });
                    await this.exitIfAdapterError(result, !!options.json);
                    if (typeof result === 'string' || options.json) {
                        console.log(result);
                    } else if (Array.isArray(result)) {
                        const items = result as any[];
                        if (options.summary) {
                            const header = this.formatHeader(
                                `Found ${items.length} references (showing ${items.length})`
                            );
                            const top = items[0]
                                ? `Top: ${this.fmtRef ? this.fmtRef(items[0]) : JSON.stringify(items[0])}`
                                : 'Top: (none)';
                            console.log([header, top].join('\n'));
                        } else {
                            const lines: string[] = [
                                this.formatHeader(`Found ${items.length} references (showing ${items.length})`),
                            ];
                            for (const r of items) lines.push(`  ${this.fmtRef ? this.fmtRef(r) : JSON.stringify(r)}`);
                            console.log(lines.join('\n'));
                        }
                    } else {
                        console.log(result);
                    }
                } catch (e) {
                    this.markCommandFailed();
                    throw e;
                }
                await this.shutdown();
                process.exit(0);
            });

        // Symbol: Build Symbol Map (Layer 3 - Planner)
        this.program
            .command('symbol-map <identifier>')
            .description('Build a targeted symbol map (declarations/references/imports/exports)')
            .option('-f, --file <path>', 'Optional file or directory context')
            .option('--max-files <count>', 'Maximum files to analyze (default: 10)', '10')
            .option('-j, --json', 'Output JSON')
            .option('--no-color', 'Disable colored output')
            .action(async (identifier, options) => {
                await this.ensureInitialized(options);
                const result = await this.cliAdapter.handleSymbolMap(identifier, {
                    file: options.file,
                    maxFiles: parseIntegerOption(options.maxFiles, 'max-files', { defaultValue: 10, min: 1, max: 100 }),
                    json: !!options.json,
                });
                await this.exitIfAdapterError(result, !!options.json);
                console.log(result);
                await this.shutdown();
                process.exit(0);
            });

        // Symbol: Mermaid Graph output
        this.program
            .command('symbol-map-graph <identifier>')
            .description('Print Mermaid graph for the symbol map')
            .option('-f, --file <path>', 'Optional file or directory context')
            .option('--max-files <count>', 'Maximum files to analyze (default: 10)', '10')
            .option('--ast-only', 'Prefer AST-validated results', true)
            .option('--no-color', 'Disable colored output')
            .action(async (identifier, options) => {
                await this.ensureInitialized(options);
                const result = await (this.cliAdapter as any).handleSymbolMapGraph(identifier, {
                    file: options.file,
                    maxFiles: parseIntegerOption(options.maxFiles, 'max-files', { defaultValue: 10, min: 1, max: 100 }),
                    astOnly: options.astOnly !== false,
                });
                await this.exitIfAdapterError(result, false);
                console.log(result);
                await this.shutdown();
                process.exit(0);
            });

        // Rename command
        this.program
            .command('rename <identifier> <newName>')
            .description('Rename a symbol with intelligent propagation')
            .option('--no-dry-run', 'Apply changes instead of preview')
            .option('--no-color', 'Disable colored output')
            .option('-v, --verbose', 'Verbose output with performance info')
            .action(async (identifier, newName, options) => {
                await this.ensureInitialized(options);
                const result = await this.cliAdapter.handleRename(identifier, newName, {
                    dryRun: options.dryRun !== false,
                });
                await this.exitIfAdapterError(result, false);
                console.log(result);
                await this.shutdown();
                process.exit(0);
            });

        // Refactor: Plan Rename (preview only, Layer 3)
        this.program
            .command('plan-rename <identifier> <newName>')
            .description('Plan a rename and preview WorkspaceEdit changes (does not apply)')
            .option('-j, --json', 'Output JSON preview')
            .option('-l, --limit <count>', 'Limit previewed files in human output', '10')
            .option('--no-color', 'Disable colored output')
            .action(async (identifier, newName, options) => {
                await this.ensureInitialized(options);
                const result = await this.cliAdapter.handlePlanRename(identifier, newName, {
                    json: !!options.json,
                    limit: parseIntegerOption(options.limit, 'limit', { defaultValue: 10, min: 1, max: 1000 }),
                });
                await this.exitIfAdapterError(result, !!options.json);
                console.log(result);
                await this.shutdown();
                process.exit(0);
            });

        // Text search (ripgrep-backed)
        this.program
            .command('text-search <query>')
            .description('Fast bounded content search (ripgrep-backed)')
            .option('-p, --path <path>', 'Search path (default: cwd)')
            .option('-k, --kind <kind>', 'literal|regex|word', 'literal')
            .option('-i, --ignore-case', 'Case insensitive match')
            .option('-n, --max-results <count>', 'Limit results (<=1000)', '200')
            .option('-j, --json', 'JSON output')
            .action(async (query, options) => {
                this.startCommandMetrics('text_search');
                try {
                    await this.ensureInitialized(options);
                    const out = await this.cliAdapter.handleTextSearch(query, {
                        kind: options.kind,
                        caseInsensitive: !!options.ignoreCase,
                        path: options.path,
                        maxResults: parseIntegerOption(options.maxResults, 'max-results', {
                            defaultValue: 200,
                            min: 1,
                            max: 1000,
                        }),
                        json: !!options.json,
                    });
                    await this.exitIfAdapterError(out, !!options.json);
                    console.log(out);
                } catch (e) {
                    this.markCommandFailed();
                    throw e;
                }
                await this.shutdown();
                process.exit(0);
            });

        // Symbol search (AST-only)
        this.program
            .command('symbol-search <query>')
            .description('Search symbols by name (AST-only map)')
            .option('-n, --max-results <count>', 'Limit results', '50')
            .option('-j, --json', 'JSON output')
            .action(async (query, options) => {
                await this.ensureInitialized(options);
                const out = await this.cliAdapter.handleSymbolSearch(query, {
                    maxResults: parseIntegerOption(options.maxResults, 'max-results', {
                        defaultValue: 50,
                        min: 1,
                        max: 200,
                    }),
                    json: !!options.json,
                });
                await this.exitIfAdapterError(out, !!options.json);
                console.log(out);
                await this.shutdown();
                process.exit(0);
            });

        // Snapshot management
        this.program
            .command('get-snapshot')
            .description('Create or return the latest snapshot id')
            .option('--prefer-existing', 'Return existing snapshot when available')
            .option('-j, --json', 'JSON output')
            .action(async (options) => {
                await this.ensureInitialized(options);
                const out = await this.cliAdapter.handleGetSnapshot({
                    preferExisting: !!options.preferExisting,
                    json: !!options.json,
                });
                console.log(out);
                await this.shutdown();
                process.exit(0);
            });

        // Propose patch
        this.program
            .command('propose-patch')
            .description('Validate and stage a unified diff against a snapshot')
            .option('-s, --snapshot <id>', 'Snapshot id (default: reuse/create)')
            .option('-f, --file <path>', 'Read patch from file (unified diff)')
            .option('--run-checks', 'Run checks after staging patch')
            .option('--cmd <command...>', 'Commands to run (multiple allowed)')
            .option('-t, --timeout <sec>', 'Timeout for run-checks', '120')
            .option('-j, --json', 'JSON output')
            .action(async (options) => {
                await this.ensureInitialized(options);
                let patch = '';
                if (options.file) {
                    patch = await this.readWorkspaceInputFile(String(options.file), 'propose-patch file');
                } else {
                    patch = fs.readFileSync(0, 'utf8'); // stdin
                }
                const out = await this.cliAdapter.handleProposePatch(patch, {
                    snapshot: options.snapshot,
                    runChecks: !!options.runChecks,
                    commands: Array.isArray(options.cmd) ? options.cmd : options.cmd ? [options.cmd] : [],
                    timeoutSec: parseIntegerOption(options.timeout, 'timeout', {
                        defaultValue: 120,
                        min: 1,
                        max: 3600,
                    }),
                    json: !!options.json,
                });
                await this.exitIfAdapterError(out, !!options.json);
                console.log(out);
                await this.shutdown();
                process.exit(0);
            });

        // Run checks for snapshot
        this.program
            .command('run-checks')
            .description('Run checks for a snapshot (format/lint/typecheck/tests)')
            .option('-s, --snapshot <id>', 'Snapshot id', '')
            .option('--cmd <command...>', 'Commands to run (multiple allowed)')
            .option('-t, --timeout <sec>', 'Timeout in seconds', '120')
            .option('-j, --json', 'JSON output')
            .action(async (options) => {
                await this.ensureInitialized(options);
                const out = await this.cliAdapter.handleRunChecks({
                    snapshot: options.snapshot,
                    commands: Array.isArray(options.cmd) ? options.cmd : options.cmd ? [options.cmd] : [],
                    timeoutSec: parseIntegerOption(options.timeout, 'timeout', {
                        defaultValue: 120,
                        min: 1,
                        max: 3600,
                    }),
                    json: !!options.json,
                });
                await this.exitIfAdapterError(out, !!options.json);
                console.log(out);
                await this.shutdown();
                process.exit(0);
            });

        // AST Query
        this.program
            .command('ast-query <language> <query>')
            .description('Run a Tree-sitter s-expression query over selected files')
            .option('--paths <paths...>', 'Specific files to include')
            .option('--glob <pattern>', 'Glob to include files')
            .option('-l, --limit <n>', 'Limit files/results', '2000')
            .option('-j, --json', 'JSON output')
            .action(async (language, query, options) => {
                await this.ensureInitialized(options);
                const out = await this.cliAdapter.handleAstQuery({
                    language,
                    query,
                    paths: options.paths,
                    glob: options.glob,
                    limit: parseInt(options.limit),
                    json: !!options.json,
                } as any);
                await this.exitIfAdapterError(out, !!options.json);
                console.log(out);
                await this.shutdown();
                process.exit(0);
            });

        // Graph Expand
        this.program
            .command('graph-expand')
            .description('Expand neighbors for a file or symbol (imports/exports; callers/callees best-effort)')
            .option('-f, --file <path>', 'File path to analyze')
            .option('-s, --symbol <name>', 'Symbol name to expand')
            .option('-e, --edges <edges...>', 'Edges to include (imports exports callers callees)')
            .option('--seed-only', 'Restrict callers search to seeded directories (from buildSymbolMap)')
            .option('-d, --depth <n>', 'Depth', '1')
            .option('-l, --limit <n>', 'Limit', '50')
            .option('-j, --json', 'JSON output')
            .action(async (options) => {
                await this.ensureInitialized(options);
                const out = await this.cliAdapter.handleGraphExpand({
                    file: options.file,
                    symbol: options.symbol,
                    edges: options.edges || ['imports', 'exports'],
                    seedOnly: !!options.seedOnly,
                    depth: parseInt(options.depth),
                    limit: parseInt(options.limit),
                    json: !!options.json,
                } as any);
                await this.exitIfAdapterError(out, !!options.json);
                console.log(out);
                await this.shutdown();
                process.exit(0);
            });

        // Snapshots clean
        this.program
            .command('snapshots')
            .description('Manage snapshots')
            .command('clean')
            .description('Cleanup materialized snapshots under .ontology/snapshots')
            .option('--max-keep <n>', 'Maximum snapshots to retain (default 10)', '10')
            .option('--max-age-days <d>', 'Delete snapshots older than N days (default 3)', '3')
            .action(async (options) => {
                await this.ensureInitialized(options);
                const out = await this.cliAdapter.handleSnapshotsClean({
                    maxKeep: parseInt(options.maxKeep),
                    maxAgeDays: parseInt(options.maxAgeDays),
                } as any);
                console.log(out);
                await this.shutdown();
                process.exit(0);
            });

        // Stats command
        this.program
            .command('stats')
            .description('Show system statistics and health')
            .option('--no-color', 'Disable colored output')
            .option('-j, --json', 'Output JSON')
            .option('-v, --verbose', 'Verbose output')
            .action(async (options) => {
                this.startCommandMetrics('stats');
                try {
                    await this.ensureInitialized(options);
                    const result = await this.cliAdapter.handleStats(options);
                    await this.exitIfAdapterError(result, !!options.json);
                    console.log(result);
                } catch (e) {
                    this.markCommandFailed();
                    throw e;
                }
                await this.shutdown();
                process.exit(0);
            });

        // Explore command (aggregate defs+refs in parallel)
        this.program
            .command('explore <identifier>')
            .description('Explore codebase: definitions and references in parallel')
            .option('-f, --file <path>', 'Optional file or directory context')
            .option('-n, --max-results <count>', 'Maximum results to search', '100')
            .option('-l, --limit <count>', 'Maximum results to print per section', '10')
            .option('-d, --include-declaration', 'Include declaration in references')
            .option('-s, --summary', 'Show summary output only')
            .option('--precise', 'Run a quick AST validation pass')
            .option('--conceptual', 'Include conceptual (Layer 4) hints if available')
            .option('--tree', 'Append a directory tree view (CLI only)')
            .option('--tree-depth <n>', 'Tree depth for --tree (default: 3)', '3')
            .option('-j, --json', 'Output JSON')
            .option('--no-color', 'Disable colored output')
            .action(async (identifier, options) => {
                this.startCommandMetrics('explore');
                try {
                    await this.ensureInitialized(options);
                    let output = await this.cliAdapter.handleExplore(identifier, {
                        file: options.file,
                        maxResults: parseIntegerOption(options.maxResults, 'max-results', {
                            defaultValue: 100,
                            min: 1,
                            max: 1000,
                        }),
                        includeDeclaration: !!options.includeDeclaration,
                        limit: parseIntegerOption(options.limit, 'limit', { defaultValue: 10, min: 1, max: 1000 }),
                        summary: !!options.summary,
                        precise: !!options.precise,
                        conceptual: !!options.conceptual,
                        json: !!options.json,
                        verbose: !!options.verbose,
                    });
                    await this.exitIfAdapterError(output, !!options.json);
                    if (options.tree && !options.json) {
                        const target = options.file ? this.resolveCliFileInput(options.file) : this.workspaceRoot;
                        const depth = parseIntegerOption(options.treeDepth, 'tree-depth', {
                            defaultValue: 3,
                            min: 1,
                            max: 10,
                        });
                        const tree = this.renderTree(target, depth);
                        if (tree) {
                            output += `\n\n` + tree;
                        }
                    }
                    console.log(output);
                } catch (e) {
                    this.markCommandFailed();
                    throw e;
                }
                await this.shutdown();
                process.exit(0);
            });

        // Init command (optional - for setting up workspace)
        this.program
            .command('init')
            .description('Initialize ontology LSP in current directory')
            .option('-f, --force', 'Overwrite existing configuration')
            .action(async (options) => {
                await this.handleInit(options);
            });

        // Generic workflow executor (HTTP/MCP parity)
        this.program
            .command('workflow <name>')
            .description('Execute a workflow/tool by name via the unified ToolExecutor')
            .option('-a, --args <json>', 'JSON arguments for the workflow/tool')
            .option('-F, --args-file <path>', 'Path to a JSON file with arguments')
            .option('-j, --json', 'Print raw JSON response where applicable')
            .action(async (name, options) => {
                this.startCommandMetrics(`workflow_${String(name).replace(/[^a-zA-Z0-9_]/g, '_')}`);
                try {
                    await this.ensureInitialized(options);
                    let args: Record<string, any> = {};
                    if (options.argsFile) {
                        const body = await this.readWorkspaceInputFile(String(options.argsFile), 'workflow args-file');
                        args = strictJsonParse(body);
                    } else if (options.args) {
                        args = strictJsonParse(String(options.args));
                    }
                    if (!args || typeof args !== 'object' || Array.isArray(args)) {
                        throw new CoreError('InvalidParams', 'Arguments must be a JSON object');
                    }
                    assertAlphaMvpToolAllowed(String(name), args, { surface: 'CLI workflow surface' });
                    const result = await this.executeToolWorkflow(String(name), args);
                    const printed = this.printToolResult(result, !!options.json);
                    if (this.isToolResultError(result)) {
                        this.markCommandFailed();
                        if (options.json) console.log(printed);
                        else console.error(printed);
                        await this.shutdown();
                        process.exit(1);
                    }
                    console.log(printed);
                    await this.shutdown();
                    process.exit(0);
                } catch (e) {
                    this.markCommandFailed();
                    const printed = this.formatToolError(e, !!options.json);
                    if (options.json) {
                        console.log(printed);
                    } else {
                        console.error(printed);
                    }
                    await this.shutdown();
                    process.exit(1);
                }
            });

        // Alias: rename-safely (wraps 'rename_safely')
        this.program
            .command('rename-safely <oldName> <newName>')
            .description('Plan a safe rename, stage diff, optionally run checks inside a snapshot')
            .option('-f, --file <path>', 'Optional context file')
            .option('--no-checks', 'Skip running checks')
            .option('--cmd <command...>', 'Commands to run (e.g., "bun run typecheck")')
            .option('-t, --timeout <sec>', 'Timeout seconds for checks', '240')
            .option('-j, --json', 'Print raw JSON response')
            .action(async (oldName, newName, options) => {
                const args: Record<string, any> = {
                    oldName: String(oldName),
                    newName: String(newName),
                    file: options.file ? String(options.file) : undefined,
                    runChecks: options.checks !== false,
                    commands: Array.isArray(options.cmd)
                        ? options.cmd
                        : options.cmd
                          ? [options.cmd]
                          : ['bun run typecheck'],
                    timeoutSec: parseIntegerOption(options.timeout, 'timeout', {
                        defaultValue: 240,
                        min: 1,
                        max: 3600,
                    }),
                };
                await this.assertToolWorkflowAllowedOrExit('rename_safely', args, !!options.json);
                await this.ensureInitialized(options);
                await this.printToolWorkflowAndExit('rename_safely', args, !!options.json);
            });

        // Alias: patch-checks-in-snapshot (wraps 'patch_checks_in_snapshot')
        this.program
            .command('patch-checks-in-snapshot')
            .description('Stage a unified diff and run checks inside a snapshot (safe)')
            .option('-s, --snapshot <id>', 'Snapshot id (optional)')
            .option('-p, --patch-file <path>', 'Path to unified diff file (default: stdin)')
            .option('--cmd <command...>', 'Commands to run (default: bun run typecheck)')
            .option('-t, --timeout <sec>', 'Timeout seconds for checks', '240')
            .option('--only-touched', 'Prefer quick checks for touched files only')
            .option('-j, --json', 'Print raw JSON response')
            .action(async (options) => {
                await this.ensureInitialized(options);
                let patch = '';
                if (options.patchFile) {
                    patch = await this.readWorkspaceInputFile(
                        String(options.patchFile),
                        'patch-checks-in-snapshot patch-file'
                    );
                } else {
                    patch = fs.readFileSync(0, 'utf8'); // stdin
                }
                const args: Record<string, any> = {
                    patch,
                    snapshot: options.snapshot ? String(options.snapshot) : undefined,
                    commands: Array.isArray(options.cmd)
                        ? options.cmd
                        : options.cmd
                          ? [options.cmd]
                          : ['bun run typecheck'],
                    timeoutSec: parseIntegerOption(options.timeout, 'timeout', {
                        defaultValue: 240,
                        min: 1,
                        max: 3600,
                    }),
                    ...(options.onlyTouched ? { onlyTouched: true } : {}),
                };
                await this.printToolWorkflowAndExit('patch_checks_in_snapshot', args, !!options.json);
            });

        // Alias: structural-search (wraps 'structural_search')
        this.program
            .command('structural-search <language> <pattern>')
            .description('Run ast-grep structural search with bounded JSON results')
            .option('--paths <paths...>', 'Repo-relative files or directories')
            .option('-n, --max-results <count>', 'Maximum matches', '50')
            .option('-j, --json', 'Print raw JSON response')
            .action(async (language, pattern, options) => {
                await this.ensureInitialized(options);
                const args = {
                    language: String(language),
                    pattern: String(pattern),
                    paths: options.paths,
                    maxResults: parseIntegerOption(options.maxResults, 'max-results', {
                        defaultValue: 50,
                        min: 1,
                        max: 1000,
                    }),
                };
                await this.printToolWorkflowAndExit('structural_search', args, !!options.json);
            });

        // Alias: structural-patch-checks (wraps 'structural_patch_checks')
        this.program
            .command('structural-patch-checks <language> <pattern> <rewrite>')
            .description('Generate an ast-grep rewrite diff, stage it in a snapshot, and run checks')
            .option('--paths <paths...>', 'Repo-relative files or directories')
            .option('--cmd <command...>', 'Commands to run (default: bun run typecheck)')
            .option('-t, --timeout <sec>', 'Timeout seconds for checks', '240')
            .option('--apply', 'Apply only when checks pass and ALLOW_SNAPSHOT_APPLY=1')
            .option('-j, --json', 'Print raw JSON response')
            .action(async (language, pattern, rewrite, options) => {
                await this.ensureInitialized(options);
                const args = {
                    language: String(language),
                    pattern: String(pattern),
                    rewrite: String(rewrite),
                    paths: options.paths,
                    commands: Array.isArray(options.cmd)
                        ? options.cmd
                        : options.cmd
                          ? [options.cmd]
                          : ['bun run typecheck'],
                    timeoutSec: parseIntegerOption(options.timeout, 'timeout', {
                        defaultValue: 240,
                        min: 1,
                        max: 3600,
                    }),
                    apply: !!options.apply,
                };
                await this.printToolWorkflowAndExit('structural_patch_checks', args, !!options.json);
            });

        // Pipelines (L5) helpers remain Alpha-gated and hidden from help until promoted.
        const pipelines = this.program.command('pipelines').description('Learning pipelines tools');
        (pipelines as any)._hidden = true;

        // pipelines list
        pipelines
            .command('list')
            .description('List learning pipelines (id, name, trigger, schedule, enabled)')
            .option('-j, --json', 'Print raw JSON response')
            .action(async (options) => {
                await this.assertToolWorkflowAllowedOrExit('list_pipelines', {}, !!options.json);
                await this.ensureInitialized(options);
                await this.printToolWorkflowAndExit('list_pipelines', {}, !!options.json);
            });

        // pipelines run <id>
        pipelines
            .command('run <id>')
            .description('Run a learning pipeline and return a run id')
            .option('-j, --json', 'Print raw JSON response')
            .action(async (id, options) => {
                const args = { id: String(id) };
                await this.assertToolWorkflowAllowedOrExit('run_pipeline', args, !!options.json);
                await this.ensureInitialized(options);
                await this.printToolWorkflowAndExit('run_pipeline', args, !!options.json);
            });

        // pipelines runs <id>
        pipelines
            .command('runs <id>')
            .description('List recent runs for a learning pipeline')
            .option('-l, --limit <n>', 'Number of recent runs to list', '10')
            .option('-j, --json', 'Print raw JSON response')
            .action(async (id, options) => {
                const args = {
                    id: String(id),
                    limit: parseIntegerOption(options.limit, 'limit', { defaultValue: 10, min: 1, max: 1000 }),
                };
                await this.assertToolWorkflowAllowedOrExit('list_pipeline_runs', args, !!options.json);
                await this.ensureInitialized(options);
                await this.printToolWorkflowAndExit('list_pipeline_runs', args, !!options.json);
            });
    }

    private async executeToolWorkflow(name: string, args: Record<string, any>): Promise<any> {
        if (!this.toolRouter || !this.toolExecutor) {
            throw new CoreError('Internal', 'CLI workflow executor not initialized');
        }
        return this.toolExecutor.execute(this.toolRouter, name, args);
    }

    private async assertToolWorkflowAllowedOrExit(
        name: string,
        args: Record<string, any>,
        rawJson: boolean
    ): Promise<void> {
        try {
            assertAlphaMvpToolAllowed(name, args, { surface: 'CLI workflow surface' });
        } catch (error) {
            this.markCommandFailed();
            const printed = this.formatToolError(error, rawJson);
            if (rawJson) console.log(printed);
            else console.error(printed);
            await this.shutdown();
            process.exit(1);
        }
    }

    private async printToolWorkflowAndExit(name: string, args: Record<string, any>, rawJson: boolean): Promise<never> {
        try {
            assertAlphaMvpToolAllowed(name, args, { surface: 'CLI workflow surface' });
            const result = await this.executeToolWorkflow(name, args);
            const printed = this.printToolResult(result, rawJson);
            if (this.isToolResultError(result)) {
                this.markCommandFailed();
                if (rawJson) console.log(printed);
                else console.error(printed);
                await this.shutdown();
                process.exit(1);
            }
            console.log(printed);
            await this.shutdown();
            process.exit(0);
        } catch (error) {
            this.markCommandFailed();
            const printed = this.formatToolError(error, rawJson);
            if (rawJson) console.log(printed);
            else console.error(printed);
            await this.shutdown();
            process.exit(1);
        }
    }

    private isToolResultError(res: any): boolean {
        return res?.isError === true || res?.error || res?.success === false;
    }

    private printToolResult(res: any, rawJson: boolean): string {
        try {
            if (rawJson && this.isToolResultError(res)) {
                return JSON.stringify({ success: false, error: this.toolResultErrorPayload(res) }, null, 2);
            }
            const printable = this.formatWorkflowResultForCli(res);
            if (rawJson) {
                return JSON.stringify(printable, null, 2);
            }
            const text = printable?.content?.[0]?.text;
            if (typeof text === 'string') return text;
            return JSON.stringify(printable, null, 2);
        } catch {
            try {
                return String(res);
            } catch {
                return '';
            }
        }
    }

    private toolResultErrorPayload(res: any): { code: string; message: string; data?: any } {
        if (res?.error && typeof res.error === 'object') {
            return {
                code: String(res.error.code || 'Internal'),
                message: String(res.error.message || 'Tool execution failed'),
                data: res.error.data,
            };
        }
        if (res && typeof res === 'object' && ('payload' in res || 'text' in res)) {
            return workflowErrorPayload(res, 'Tool execution failed');
        }
        return { code: 'Internal', message: 'Tool execution failed' };
    }

    private formatWorkflowResultForCli(res: any): any {
        if (res && typeof res === 'object' && 'content' in res) return res;
        if (res && typeof res === 'object' && 'text' in res) {
            return { content: [{ type: 'text', text: String(res.text) }], isError: res.isError === true };
        }
        if (res && typeof res === 'object' && 'payload' in res) {
            return {
                content: [{ type: 'text', text: JSON.stringify(res.payload, null, 2) }],
                isError: res.isError === true,
            };
        }
        return res;
    }

    private isFormattedAdapterError(value: unknown): boolean {
        return typeof value === 'string' && /^(Error:|\u001b\[1m\u001b\[31mError:)/.test(value);
    }

    private adapterErrorMessage(value: string): string {
        return value
            .replace(/\u001b\[[0-9;]*m/g, '')
            .replace(/^Error:\s*/, '')
            .trim();
    }

    private async exitIfAdapterError(value: unknown, rawJson: boolean): Promise<void> {
        if (!this.isFormattedAdapterError(value)) return;
        this.markCommandFailed();
        const message = this.adapterErrorMessage(String(value));
        if (rawJson) {
            console.log(JSON.stringify({ success: false, error: { code: 'InvalidParams', message } }, null, 2));
        } else {
            console.error(`Error: ${message}`);
        }
        await this.shutdown();
        process.exit(1);
    }

    private formatToolError(error: unknown, rawJson: boolean): string {
        const payload = (() => {
            if (isCoreError(error)) {
                return { code: error.code, message: error.message, data: error.data };
            }
            if (error instanceof Error) {
                return { code: 'Internal', message: error.message };
            }
            return { code: 'Internal', message: String(error) };
        })();

        if (rawJson) {
            return JSON.stringify({ success: false, error: payload }, null, 2);
        }
        return `Workflow failed: ${payload.message}`;
    }

    private async readWorkspaceInputFile(requestedPath: string, inputLabel: string): Promise<string> {
        const normalizedPath = this.resolveCliFileInput(requestedPath);
        const opened = await openWorkspaceFileForRead(normalizedPath, {
            workspaceRoot: this.workspaceRoot,
            inputLabel,
        });
        try {
            return await opened.handle.readFile('utf8');
        } finally {
            await opened.handle.close().catch(() => undefined);
        }
    }

    private cliRelativeBase(): string {
        const root = path.resolve(this.workspaceRoot);
        const cwd = path.resolve(process.cwd());
        const relative = path.relative(root, cwd);
        return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? cwd : root;
    }

    private resolveCliFileInput(requestedPath: string): string {
        const raw = requestedPath.trim();
        if (!raw || raw.startsWith('file://') || path.isAbsolute(raw))
            return workspaceInputToPath(raw, this.workspaceRoot);
        return path.resolve(this.cliRelativeBase(), raw);
    }

    private async ensureInitialized(options: any): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Lazy import heavy modules only when needed
            const [
                { createDefaultCoreConfig, formatDefinitionForCli, formatReferenceForCli },
                { createCodeAnalyzer },
                { CLIAdapter },
                { ToolWorkflowRouter },
                { ToolExecutor },
            ] = await Promise.all([
                import('../adapters/utils.js'),
                import('../core/index.js'),
                import('../adapters/cli-adapter.js'),
                import('../core/workflows/tool-workflow-router.js'),
                import('../core/tools/executor.js'),
            ]);

            const { resolveConfiguredWorkspaceRoot } = await import('../core/workspace-root.js');
            const workspaceRoot = resolveConfiguredWorkspaceRoot(undefined, this.findWorkspaceRoot());
            const config = createDefaultCoreConfig(workspaceRoot);
            if (
                process.env.SCI_ENABLE_CACHE_WARMUP_IN_CLI !== '1' &&
                process.env.SCI_DISABLE_CACHE_WARMUP === undefined
            ) {
                process.env.SCI_DISABLE_CACHE_WARMUP = '1';
            }

            this.coreAnalyzer = await createCodeAnalyzer({
                ...config,
                workspaceRoot,
            });

            await this.coreAnalyzer.initialize();

            // Create CLI adapter and reusable core workflow executor
            this.colorOutput = options.color !== false;
            this.cliAdapter = new CLIAdapter(this.coreAnalyzer, {
                colorOutput: this.colorOutput,
                verboseMode: options.verbose || false,
                maxResults: 50,
                timeout: 30000,
            });
            this.toolRouter = new ToolWorkflowRouter(this.coreAnalyzer);
            this.toolExecutor = new ToolExecutor();

            this.coreConfig = config;
            this.workspaceRoot = workspaceRoot;
            this.fmtDef = formatDefinitionForCli as any;
            this.fmtRef = formatReferenceForCli as any;
            this.initialized = true;
        } catch (error) {
            this.markCommandFailed();
            if (options?.json) {
                const message = `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`;
                console.log(this.formatToolError(new CoreError('Internal', message), true));
            } else {
                console.error(`Failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
            }
            process.exit(1);
        }
    }

    private formatHeader(text: string): string {
        return this.colorOutput ? `\x1b[1m\x1b[36m${text}\x1b[0m` : text;
    }

    private hasCommand(cmd: string): boolean {
        const res = spawnSync('bash', ['-lc', `command -v ${cmd}`], { stdio: 'pipe' });
        return res.status === 0;
    }

    private renderTree(pathStr: string, depth: number): string {
        try {
            const prefer = this.coreConfig?.performance?.tools?.tree?.prefer || 'auto';
            const inGitRepo = fs.existsSync(`${this.workspaceRoot}/.git`);
            const safeDepth = Math.max(1, Math.min(depth, 5));
            // eza preferred
            if (prefer !== 'none' && (prefer === 'eza' || (prefer === 'auto' && this.hasCommand('eza')))) {
                const args = ['-T', '-L', String(safeDepth), pathStr];
                if (inGitRepo) args.splice(1, 0, '--git-ignore');
                const r = spawnSync('eza', args, { encoding: 'utf8' });
                if (r.status === 0 && r.stdout) {
                    return ['Tree (eza):', r.stdout.trim()].join('\n');
                }
            }
            // tree fallback
            if (prefer !== 'none' && (prefer === 'tree' || (prefer === 'auto' && this.hasCommand('tree')))) {
                const ignore = 'node_modules|dist|.git|coverage|out|build|logs';
                const r = spawnSync('tree', ['-L', String(safeDepth), '-I', ignore, pathStr], { encoding: 'utf8' });
                if (r.status === 0 && r.stdout) {
                    return ['Tree (tree):', r.stdout.trim()].join('\n');
                }
            }
            // Minimal fallback
            const entries = fs.readdirSync(pathStr, { withFileTypes: true }).slice(0, 50);
            const lines = ['Tree (fallback):', pathStr];
            for (const e of entries) lines.push(`  ${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private writeConfigFileNoFollow(configPath: string, content: string, force: boolean): void {
        const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
        const flags =
            fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            (force ? fs.constants.O_TRUNC : fs.constants.O_EXCL) |
            noFollow;
        const fd = fs.openSync(configPath, flags, 0o600);
        try {
            fs.writeFileSync(fd, content, 'utf8');
        } finally {
            fs.closeSync(fd);
        }
    }

    private async handleInit(options: any): Promise<void> {
        const configPath = path.join(process.cwd(), '.semantic-code-intelligence-config.yaml');
        const dbPath = path.join(process.cwd(), '.ontology');

        let existingConfig: fs.Stats | null = null;
        try {
            existingConfig = fs.lstatSync(configPath);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') throw error;
        }
        if (existingConfig?.isSymbolicLink()) {
            console.error('Configuration path must not be a symlink.');
            process.exit(1);
        }
        if (existingConfig && !options.force) {
            console.error('Configuration already exists. Use --force to overwrite.');
            process.exit(1);
        }

        // Create .ontology directory without following an existing symlink.
        let existingDbDir: fs.Stats | null = null;
        try {
            existingDbDir = fs.lstatSync(dbPath);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') throw error;
        }
        if (existingDbDir?.isSymbolicLink()) {
            console.error('.ontology path must not be a symlink.');
            process.exit(1);
        }
        if (existingDbDir && !existingDbDir.isDirectory()) {
            console.error('.ontology path already exists and is not a directory.');
            process.exit(1);
        }
        if (!existingDbDir) {
            fs.mkdirSync(dbPath, { recursive: true });
        }

        // Create basic config
        const config = `# Semantic Code Intelligence Configuration
workspaceRoot: .
database:
  path: .ontology/ontology.db
layers:
  layer1:
    enabled: true
    timeout: 5000
  layer2:
    enabled: true
    timeout: 50000
  layer3:
    enabled: true
    timeout: 10000
  layer4:
    enabled: true
    timeout: 10000
    adapter: sqlite
    dbPath: .ontology/ontology.db
  layer5:
    enabled: true
    timeout: 20000
cache:
  enabled: true
  ttlMs: 300000
  maxSize: 1000
performance:
  enableTiming: true
  logSlowOperations: true
  slowOperationThresholdMs: 1000
`;

        try {
            this.writeConfigFileNoFollow(configPath, config, !!options.force);
        } catch (error: any) {
            if (error?.code === 'ELOOP') {
                console.error('Configuration path must not be a symlink.');
                process.exit(1);
            }
            throw error;
        }

        // Create .semantic-code-ignore if it doesn't exist; never follow symlinks.
        const ignorePath = path.join(process.cwd(), '.semantic-code-ignore');
        let ignoreExists = false;
        try {
            const ignoreStat = fs.lstatSync(ignorePath);
            if (ignoreStat.isSymbolicLink()) {
                console.error('Ignore path must not be a symlink.');
                process.exit(1);
            }
            ignoreExists = true;
        } catch (error: any) {
            if (error?.code !== 'ENOENT') throw error;
        }
        if (!ignoreExists) {
            const ignoreContent = `# Semantic Code Intelligence ignore patterns
node_modules/
.git/
dist/
build/
*.log
.env
.env.local
*.min.js
*.map
`;
            try {
                this.writeConfigFileNoFollow(ignorePath, ignoreContent, false);
            } catch (error: any) {
                if (error?.code === 'ELOOP') {
                    console.error('Ignore path must not be a symlink.');
                    process.exit(1);
                }
                throw error;
            }
        }

        console.log('✓ Semantic Code Intelligence initialized');
        console.log(`✓ Configuration written to ${configPath}`);
        console.log(`✓ Database directory created at ${dbPath}`);
        console.log(`✓ Ignore file created at ${ignorePath}`);
        console.log('\nYou can now use other commands like:');
        console.log('  semantic-code-intelligence find <symbol>');
        console.log('  semantic-code-intelligence references <symbol>');
        console.log('  semantic-code-intelligence symbol-map <symbol>');
        console.log('  semantic-code-intelligence plan-rename <old> <new>');
        console.log('  semantic-code-intelligence stats');
    }

    private findWorkspaceRoot(): string {
        let current = process.cwd();

        while (current !== path.dirname(current)) {
            // Check for common project root indicators
            const indicators = ['package.json', '.git', 'tsconfig.json', '.semantic-code-intelligence-config.yaml'];

            for (const indicator of indicators) {
                if (fs.existsSync(path.join(current, indicator))) {
                    return current;
                }
            }

            current = path.dirname(current);
        }

        // Default to current directory if no indicators found
        return process.cwd();
    }

    async run(argv: string[]): Promise<void> {
        try {
            await this.program.parseAsync(argv);
        } catch (error) {
            if (typeof (error as any)?.exitCode === 'number' && (error as any).exitCode === 0) {
                await this.shutdown();
                process.exit(0);
            }
            this.markCommandFailed();
            const message =
                this.commanderErrorOutput.trim() || (error instanceof Error ? error.message : String(error));
            if (argv.includes('--json') || argv.includes('-j')) {
                console.log(
                    JSON.stringify({
                        success: false,
                        error: { code: 'InvalidParams', message: message.replace(/^error:\s*/i, '') },
                    })
                );
            } else {
                console.error(message.startsWith('error:') ? message : `Error: ${message}`);
            }
            await this.shutdown();
            process.exit(1);
        }
    }

    async shutdown(): Promise<void> {
        // End command metrics tracking
        this.endCommandMetrics();

        // Push metrics to Pushgateway if configured
        const pushgatewayUrl = getPushgatewayUrl();
        if (pushgatewayUrl) {
            try {
                const result = await pushToGateway(pushgatewayUrl, 'ontology_cli');
                if (!result.success && process.env.CLI_METRICS_DEBUG) {
                    console.error(`[metrics] Failed to push to Pushgateway: ${result.error}`);
                }
            } catch (e) {
                // Don't fail CLI exit on metrics push failure
                if (process.env.CLI_METRICS_DEBUG) {
                    console.error(`[metrics] Pushgateway error: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }

        // Dispose core analyzer
        if (this.coreAnalyzer) {
            await this.coreAnalyzer.dispose();
        }
    }
}

// Create and run CLI
const cli = new CLI();

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    await cli.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await cli.shutdown();
    process.exit(0);
});

// Run CLI with top-level await to ensure completion before exit (ESM)
await cli.run(process.argv);
