/**
 * Universal Tool Registry
 *
 * Single source of truth for capabilities exposed by adapters (MCP/HTTP/CLI).
 * Each tool includes a name, description, and JSON schema for inputs/outputs.
 */

export interface ToolSpec {
    name: string;
    description: string;
    title?: string;
    inputSchema: any;
    outputSchema?: any;
    availability?: {
        adapters?: Array<'mcp' | 'http' | 'cli' | 'lsp'>;
        languages?: string[];
    };
    category?: 'workflow' | 'operation' | 'system';
    execution?: {
        longRunning?: boolean;
        disableRetries?: boolean;
        requiresPatchValidation?: boolean;
    };
}

export class ToolRegistry {
    private static tools: ToolSpec[] = [
        {
            name: 'get_snapshot',
            description: 'Create or return a snapshot id for consistent reads/edits',
            inputSchema: { type: 'object', properties: { preferExisting: { type: 'boolean' } } },
        },
        {
            name: 'read_file',
            description: 'Read a bounded file range from the workspace for snapshot-aware code navigation',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Workspace-relative file path' },
                    range: {
                        type: 'object',
                        properties: {
                            startLine: { type: 'number', description: '1-based inclusive start line' },
                            endLine: { type: 'number', description: '1-based inclusive end line' },
                        },
                    },
                    snapshot: {
                        type: 'string',
                        description:
                            'Optional snapshot id; when supplied, read from the materialized snapshot overlay instead of live workspace state',
                    },
                    maxBytes: { type: 'number', default: 65536 },
                },
                required: ['path'],
            },
        },
        // WORKFLOWS (legacy names kept for compatibility)
        {
            name: 'workflow_safe_rename',
            title: 'Workflow: Safe Rename (Snapshot + Checks)',
            description:
                'Plan a rename, stage a unified diff into a snapshot, run checks, and return status with next actions.',
            category: 'workflow',
            execution: { longRunning: true, disableRetries: true },
            inputSchema: {
                type: 'object',
                properties: {
                    oldName: { type: 'string', description: 'Original symbol name' },
                    newName: { type: 'string', description: 'New symbol name' },
                    file: { type: 'string', description: 'Optional context file URI' },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        default: ['bun run typecheck'],
                    },
                    timeoutSec: {
                        type: 'number',
                        default: 240,
                        description: 'Per-command timeout (seconds, 1–600; clamped centrally)',
                    },
                    runChecks: { type: 'boolean', default: true },
                },
                required: ['oldName', 'newName'],
            },
        },
        {
            name: 'workflow_explore_symbol',
            title: 'Workflow: Explore Symbol Impact',
            description:
                'Find definitions, build a symbol map, and expand neighbors (imports/exports/callers/callees). Returns a compact JSON summary. Use to assess change impact before edits.',
            category: 'workflow',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Symbol name to explore' },
                    file: { type: 'string', description: 'Optional context file URI' },
                    precise: { type: 'boolean', default: true },
                    depth: { type: 'number', default: 1 },
                    limit: { type: 'number', default: 50 },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'workflow_quick_patch_checks',
            title: 'Workflow: Quick Patch + Checks (Snapshot‑Safe)',
            description:
                'Stages a unified diff into a snapshot and runs checks (typecheck/build/tests). Returns ok, snapshot id, and tail of logs. Safe: never writes to working tree.',
            category: 'workflow',
            execution: { longRunning: true, disableRetries: true },
            inputSchema: {
                type: 'object',
                properties: {
                    patch: { type: 'string', description: 'Unified diff (git format) to stage' },
                    snapshot: { type: 'string', description: 'Optional snapshot id; if absent a snapshot is created' },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        default: ['bun run typecheck'],
                    },
                    recommendChecks: {
                        type: 'boolean',
                        default: false,
                        description: 'Include advisory recommend_checks output without changing the commands that run',
                    },
                    impactSummary: {
                        type: 'object',
                        description: 'Optional graph_expand impactSummary to include in recommendations/validationPlan',
                    },
                    onlyTouched: {
                        type: 'boolean',
                        description: 'Restrict checks to touched files when possible',
                        default: false,
                    },
                    timeoutSec: {
                        type: 'number',
                        default: 240,
                        description: 'Per-command timeout (seconds, 1–600; clamped centrally)',
                    },
                },
                required: ['patch'],
            },
        },
        {
            name: 'workflow_locate_confirm_definition',
            title: 'Workflow: Locate & Confirm Definition',
            description:
                'Locate definitions fast, retry with precise AST validation if ambiguous; returns attempts and chosen results.',
            category: 'workflow',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Symbol name to locate' },
                    file: { type: 'string', description: 'Optional context file URI' },
                    precise: { type: 'boolean', default: true },
                    maxResults: { type: 'number', default: 50 },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'structural_search',
            title: 'Structural Search (ast-grep)',
            description:
                'Use ast-grep for deterministic structural search. Returns bounded file/range/snippet matches for harnessed LLM coding sessions.',
            category: 'operation',
            inputSchema: {
                type: 'object',
                properties: {
                    language: { type: 'string', description: 'ast-grep language, e.g. typescript, javascript, python' },
                    pattern: { type: 'string', description: 'ast-grep pattern' },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Repo-relative files or directories',
                    },
                    maxResults: { type: 'number', default: 50 },
                    timeoutMs: { type: 'number', default: 30000 },
                    maxBuffer: { type: 'number', default: 8388608 },
                },
                required: ['language', 'pattern'],
            },
        },
        {
            name: 'structural_patch_checks',
            title: 'Structural Patch Checks (ast-grep + Snapshot)',
            description:
                'Generate an ast-grep structural rewrite diff, stage it in a snapshot, run checks, and optionally apply only when ALLOW_SNAPSHOT_APPLY=1.',
            category: 'workflow',
            execution: { longRunning: true, disableRetries: true },
            inputSchema: {
                type: 'object',
                properties: {
                    language: { type: 'string', description: 'ast-grep language, e.g. typescript, javascript, python' },
                    pattern: { type: 'string', description: 'ast-grep pattern' },
                    rewrite: { type: 'string', description: 'ast-grep rewrite template' },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Repo-relative files or directories',
                    },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        default: ['bun run typecheck'],
                    },
                    timeoutSec: { type: 'number', default: 240 },
                    timeoutMs: { type: 'number', default: 30000 },
                    maxBuffer: { type: 'number', default: 16777216 },
                    apply: { type: 'boolean', default: false },
                    maxResults: { type: 'number', default: 200 },
                },
                required: ['language', 'pattern', 'rewrite'],
            },
        },
        {
            name: 'ast_query',
            description: 'Run a Tree-sitter s-expression query over selected files',
            inputSchema: {
                type: 'object',
                properties: {
                    language: { type: 'string', enum: ['typescript', 'javascript', 'python'] },
                    query: { type: 'string' },
                    paths: { type: 'array', items: { type: 'string' } },
                    glob: { type: 'string' },
                    limit: { type: 'number' },
                    snapshot: {
                        type: 'string',
                        description:
                            'Optional snapshot id; when supplied, query files from the materialized snapshot overlay',
                    },
                },
                required: ['language', 'query'],
            },
        },
        {
            name: 'graph_expand',
            description: 'Expand neighbors for a file or symbol (imports/exports; callers/callees best-effort)',
            inputSchema: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    symbol: { type: 'string' },
                    edges: {
                        type: 'array',
                        items: { type: 'string', enum: ['imports', 'exports', 'callers', 'callees'] },
                        description:
                            'Defaults to imports/exports for file seeds and callers/callees for symbol-only seeds.',
                    },
                    depth: {
                        type: 'number',
                        default: 1,
                        description:
                            'Reserved for future recursive expansion; current graph_expand returns one-hop evidence.',
                    },
                    limit: { type: 'number', default: 50 },
                    scipIndexPath: {
                        type: 'string',
                        description:
                            'Optional path to an existing local index.scip artifact. SCI reads it only; graph_expand does not generate SCIP indexes.',
                    },
                },
                anyOf: [{ required: ['file'] }, { required: ['symbol'] }],
            },
        },
        {
            name: 'recommend_checks',
            title: 'Recommend Checks (Impact-Aware)',
            description:
                'Recommend transparent validation commands from a patch, touched files, and optional graph impact summary. Heuristic only; does not run checks.',
            category: 'workflow',
            inputSchema: {
                type: 'object',
                properties: {
                    patch: { type: 'string', description: 'Optional unified diff used to infer touched files' },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional repo-relative touched files',
                    },
                    impactSummary: { type: 'object', description: 'Optional graph_expand impactSummary' },
                    mode: { type: 'string', enum: ['minimum', 'broader'], default: 'minimum' },
                },
            },
        },
        {
            name: 'propose_patch',
            description: 'Validate and stage a patch against a snapshot (diff-only, no write to disk)',
            inputSchema: {
                type: 'object',
                properties: {
                    patch: { type: 'string' },
                    format: { type: 'string', enum: ['unified'], default: 'unified' },
                    snapshot: { type: 'string' },
                },
                required: ['patch'],
            },
        },
        {
            name: 'run_checks',
            description: 'Run format/lint/typecheck/tests for a snapshot (guarded)',
            execution: { longRunning: true, disableRetries: true },
            inputSchema: {
                type: 'object',
                properties: {
                    snapshot: { type: 'string' },
                    commands: { type: 'array', items: { type: 'string' }, maxItems: 20 },
                    onlyTouched: {
                        type: 'boolean',
                        description: 'Restrict checks to touched files when possible',
                        default: false,
                    },
                    timeoutSec: {
                        type: 'number',
                        default: 120,
                        description: 'Per-command timeout (seconds, 1–600; clamped centrally)',
                    },
                },
                required: ['snapshot'],
            },
        },
        {
            name: 'apply_snapshot',
            description: 'Apply a staged snapshot overlay.diff to the working tree (guarded by env)',
            execution: { longRunning: true, disableRetries: true },
            inputSchema: {
                type: 'object',
                properties: {
                    snapshot: { type: 'string' },
                    check: { type: 'boolean', default: false },
                    reverse: { type: 'boolean', default: false },
                },
                required: ['snapshot'],
            },
        },
        {
            name: 'find_definition',
            description: 'Find symbol definition with fuzzy/AST validation',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string' },
                    file: { type: 'string' },
                    precise: { type: 'boolean' },
                    position: {
                        type: 'object',
                        properties: { line: { type: 'number', minimum: 0 }, character: { type: 'number', minimum: 0 } },
                        required: ['line', 'character'],
                    },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'rename_symbol',
            description: 'Rename symbol with intelligent propagation (preview/apply via preview flag)',
            execution: { longRunning: true, disableRetries: true },
            inputSchema: {
                type: 'object',
                properties: {
                    oldName: { type: 'string' },
                    newName: { type: 'string' },
                    preview: { type: 'boolean', default: true },
                    file: { type: 'string' },
                },
                required: ['oldName', 'newName'],
            },
        },
        {
            name: 'find_references',
            description: 'Find references to a symbol across codebase',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string' },
                    file: { type: 'string', description: 'Optional workspace-relative file or file URI context' },
                    uri: { type: 'string', description: 'Optional file URI context' },
                    includeDeclaration: { type: 'boolean' },
                    precise: { type: 'boolean' },
                    maxResults: { type: 'number' },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'explore_codebase',
            description: 'Aggregate definitions, references, diagnostics for a symbol',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string' },
                    file: { type: 'string' },
                    maxResults: { type: 'number' },
                    includeDeclaration: { type: 'boolean' },
                    precise: { type: 'boolean' },
                    conceptual: { type: 'boolean', description: 'Include Layer 4 conceptual hints if available' },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'build_symbol_map',
            description: 'Build a targeted symbol map (TS/JS) for a given identifier',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string' },
                    file: { type: 'string' },
                    maxFiles: { type: 'number' },
                    astOnly: { type: 'boolean' },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'plan_rename',
            description: 'Plan a safe rename across files with AST validation',
            inputSchema: {
                type: 'object',
                properties: {
                    oldName: { type: 'string' },
                    newName: { type: 'string' },
                    file: { type: 'string' },
                    dryRun: { type: 'boolean' },
                },
                required: ['oldName', 'newName'],
            },
        },
        {
            name: 'apply_rename',
            description:
                'Apply a rename by oldName/newName. Direct WorkspaceEdit application is unsupported; use snapshot workflows for reviewed patches.',
            inputSchema: {
                type: 'object',
                properties: {
                    oldName: { type: 'string' },
                    newName: { type: 'string' },
                    file: { type: 'string' },
                },
                required: ['oldName', 'newName'],
            },
        },
        {
            name: 'text_search',
            description: 'Fast content search (bounded, repo-aware, ripgrep-backed)',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    path: { type: 'string' },
                    maxResults: { type: 'number' },
                    caseInsensitive: { type: 'boolean' },
                    kind: { type: 'string', enum: ['literal', 'regex', 'word'], default: 'literal' },
                    context: { type: 'number', default: 2 },
                    snapshot: {
                        type: 'string',
                        description:
                            'Optional snapshot id; when supplied, search the materialized snapshot overlay instead of live workspace state',
                    },
                },
                required: ['query'],
            },
        },
        {
            name: 'symbol_search',
            description: 'Search for symbols by name with AST/Planner validation',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    maxResults: { type: 'number' },
                    fileHint: { type: 'string' },
                },
                required: ['query'],
            },
        },
        {
            name: 'list_files',
            description: 'List files under workspace with ignore rules',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    maxFiles: { type: 'number' },
                    depth: { type: 'number' },
                },
            },
        },
        {
            name: 'get_completions',
            description: 'Get code completions (pattern/ontology-driven)',
            inputSchema: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    position: {
                        type: 'object',
                        properties: { line: { type: 'number', minimum: 0 }, character: { type: 'number', minimum: 0 } },
                        required: ['line', 'character'],
                    },
                    maxResults: { type: 'number' },
                },
                required: ['file', 'position'],
            },
        },
        {
            name: 'list_symbols',
            description: 'List symbols in a file (bounded)',
            inputSchema: {
                type: 'object',
                properties: { file: { type: 'string' } },
                required: ['file'],
            },
        },
        {
            name: 'list_pipelines',
            description: 'List learning pipelines (id, name, trigger, schedule, enabled)',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'run_pipeline',
            description: 'Run a learning pipeline by id and return a run id',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
            },
        },
        {
            name: 'list_pipeline_runs',
            description: 'List recent runs for a learning pipeline',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' }, limit: { type: 'number', default: 10 } },
                required: ['id'],
            },
        },
        {
            name: 'pipeline_status',
            description: 'Get status for a learning pipeline',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
            },
        },
        {
            name: 'diagnostics',
            description: 'Get analyzer diagnostics and health information',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'pattern_stats',
            description: 'Pattern learning statistics snapshot',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'generate_tests',
            description: 'Generate tests (stub) based on code understanding and patterns',
            inputSchema: {
                type: 'object',
                properties: {
                    target: { type: 'string' },
                    framework: {
                        type: 'string',
                        enum: ['bun', 'jest', 'vitest', 'mocha', 'auto'],
                        default: 'auto',
                    },
                    coverage: {
                        type: 'string',
                        enum: ['basic', 'comprehensive', 'edge-cases'],
                        default: 'comprehensive',
                    },
                },
                required: ['target'],
            },
        },
        {
            name: 'suggest_refactoring',
            description: 'Suggest refactoring opportunities (legacy compatibility stub)',
            inputSchema: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                },
            },
        },
        {
            name: 'knowledge_insights',
            description: 'Knowledge propagation / learning insights snapshot',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'cache_controls',
            description: 'Warm or clear internal caches',
            inputSchema: {
                type: 'object',
                properties: { action: { type: 'string', enum: ['warm', 'clear'] } },
                required: ['action'],
            },
        },
        // WORKFLOWS (renamed, preferred)
        {
            name: 'rename_safely',
            title: 'Rename Safely (Snapshot + Checks)',
            description:
                'Use for: safe symbol rename across files. Avoid: ad-hoc search/replace. Returns: { ok, changes, snapshot, next_actions }',
            category: 'workflow',
            execution: { longRunning: true, disableRetries: true },
            inputSchema: {
                type: 'object',
                properties: {
                    oldName: { type: 'string' },
                    newName: { type: 'string' },
                    file: { type: 'string' },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        default: ['bun run typecheck'],
                    },
                    timeoutSec: {
                        type: 'number',
                        default: 240,
                        description: 'Per-command timeout (seconds, 1–600; clamped centrally)',
                    },
                    runChecks: { type: 'boolean', default: true },
                },
                required: ['oldName', 'newName'],
            },
        },
        {
            name: 'explore_symbol_impact',
            title: 'Explore Symbol Impact',
            description:
                'Use for: quick impact analysis (defs/map/neighbors). Avoid: large raw dumps. Returns: { definitions, symbolMap, neighbors }',
            category: 'workflow',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string' },
                    file: { type: 'string' },
                    precise: { type: 'boolean', default: true },
                    depth: { type: 'number', default: 1 },
                    limit: { type: 'number', default: 50 },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'patch_checks_in_snapshot',
            title: 'Patch Checks in Snapshot',
            description:
                'Use for: validate a unified diff safely. Avoid: editing working tree. Returns: { ok, elapsedMs, output_tail }',
            category: 'workflow',
            execution: { longRunning: true, disableRetries: true, requiresPatchValidation: true },
            inputSchema: {
                type: 'object',
                properties: {
                    patch: { type: 'string' },
                    snapshot: { type: 'string' },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        default: ['bun run typecheck'],
                    },
                    recommendChecks: {
                        type: 'boolean',
                        default: false,
                        description: 'Include advisory recommend_checks output without changing the commands that run',
                    },
                    impactSummary: {
                        type: 'object',
                        description: 'Optional graph_expand impactSummary to include in recommendations/validationPlan',
                    },
                    timeoutSec: {
                        type: 'number',
                        default: 240,
                        description: 'Per-command timeout (seconds, 1–600; clamped centrally)',
                    },
                },
                required: ['patch'],
            },
        },
        {
            name: 'locate_confirm_definition',
            title: 'Locate & Confirm Definition',
            description:
                'Use for: precise go-to-def. Avoid: guessing. Returns: { attempts: [fast, precise], definitions }',
            category: 'workflow',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string' },
                    file: { type: 'string' },
                    precise: { type: 'boolean', default: true },
                    maxResults: { type: 'number', default: 50 },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'extract_snapshot_artifacts',
            title: 'Extract Snapshot Artifacts',
            description:
                'Use for: quickly getting overlay.diff/status/progress links for a snapshot. Returns: { snapshot, links }',
            category: 'workflow',
            inputSchema: {
                type: 'object',
                properties: {
                    snapshot: { type: 'string' },
                    includeContent: { type: 'boolean', default: false },
                    maxBytes: { type: 'number', default: 65536 },
                },
                required: ['snapshot'],
            },
        },
        {
            name: 'safe_write',
            title: 'Safe Write (Preview → Checks → Guarded Apply)',
            description:
                'Use for: autonomous-safe write path. Stages a patch, runs checks, optionally applies only with apply:true and ALLOW_SNAPSHOT_APPLY=1, and returns risk/rollback/artifact evidence.',
            category: 'workflow',
            execution: { longRunning: true, disableRetries: true, requiresPatchValidation: true },
            inputSchema: {
                type: 'object',
                properties: {
                    patch: { type: 'string' },
                    snapshot: { type: 'string' },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        default: ['bun run typecheck'],
                    },
                    recommendChecks: {
                        type: 'boolean',
                        default: false,
                        description: 'Include advisory recommend_checks output without changing the commands that run',
                    },
                    impactSummary: {
                        type: 'object',
                        description: 'Optional graph_expand impactSummary to include in recommendations/validationPlan',
                    },
                    timeoutSec: { type: 'number', default: 240 },
                    apply: { type: 'boolean', default: false },
                    brief: { type: 'boolean', default: false },
                },
                required: ['patch'],
            },
        },
        {
            name: 'apply_after_checks',
            title: 'Apply After Checks',
            description:
                'Use for: patch → checks → apply (dev only). Guarded by ALLOW_SNAPSHOT_APPLY=1. Returns: { ok, snapshot, applied, output_tail }',
            category: 'workflow',
            execution: { longRunning: true, disableRetries: true, requiresPatchValidation: true },
            inputSchema: {
                type: 'object',
                properties: {
                    patch: { type: 'string' },
                    snapshot: { type: 'string' },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        default: ['bun run typecheck'],
                    },
                    timeoutSec: { type: 'number', default: 240 },
                    reverse: { type: 'boolean', default: false },
                },
                required: ['patch'],
            },
        },
        {
            name: 'execute_intent',
            title: 'Execute Intent (Auto-Select Workflow)',
            description:
                'Use for: auto-orchestrating rename/patch/explore/locate. Provide minimal args; returns selected workflow result + next_actions.',
            category: 'workflow',
            inputSchema: {
                type: 'object',
                properties: {
                    intent: {
                        type: 'string',
                        enum: ['rename', 'patch', 'explore', 'locate', 'apply'],
                        description: 'Preferred action; optional if args imply intent',
                    },
                    // Rename
                    oldName: { type: 'string' },
                    newName: { type: 'string' },
                    file: { type: 'string' },
                    // Patch
                    patch: { type: 'string' },
                    applyIfOk: {
                        type: 'boolean',
                        default: false,
                        description: 'If checks pass and apply is allowed, apply snapshot',
                    },
                    commands: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 20,
                        description: 'Optional commands for checks',
                    },
                    timeoutSec: { type: 'number', default: 240 },
                    // Explore/Locate
                    symbol: { type: 'string' },
                },
            },
        },
    ];

    static list(): ToolSpec[] {
        return [...ToolRegistry.tools];
    }
}
