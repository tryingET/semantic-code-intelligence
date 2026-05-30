import type { ToolSpec } from './registry.js';

export const OPERATION_TOOL_SPECS: ToolSpec[] = [
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
            execution: { longRunning: true, disableRetries: true },
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
                'Reject direct rename mutation; use plan_rename for preview or workflow_safe_rename/snapshot workflows for reviewed patches.',
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
        }
];
