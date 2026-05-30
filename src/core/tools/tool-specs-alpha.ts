import type { ToolSpec } from './registry.js';

export const ALPHA_TOOL_SPECS: ToolSpec[] = [
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
        }
];
