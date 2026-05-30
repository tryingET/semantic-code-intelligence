import type { ToolSpec } from './registry.js';

export const PREFERRED_WORKFLOW_TOOL_SPECS: ToolSpec[] = [
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
                    apply: {
                        type: 'boolean',
                        default: false,
                        description: 'Required explicit per-call intent to mutate after checks pass',
                    },
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
        }
];
