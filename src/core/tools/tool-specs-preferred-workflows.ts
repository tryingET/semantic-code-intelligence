import type { ToolSpec } from './registry.js';

export const PREFERRED_WORKFLOW_TOOL_SPECS: ToolSpec[] = [
    // WORKFLOWS (renamed, preferred)
    {
        name: 'rename_safely',
        title: 'Rename Safely (Snapshot + Checks)',
        description:
            'PREFERRED first call for a symbol rename. Plans the cross-file rename in a snapshot and optionally runs checks. Do not decompose into search/reference/edit primitives unless this workflow is insufficient. Returns: { ok, changes, snapshot, next_actions }.',
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
            'PREFERRED first call for unfamiliar symbol changes. compact returns only the decision packet and an exact locate action when definition confirmation fails; standard adds a sparse normalized evidence projection with observed-versus-usable definitions, declarations, references, graph edges, provenance, and omission summaries; debug adds the full bounded/redacted audit shape with subcall inputs/status, diagnostics, timings, shape failures, and raw fragments. Standard details are capped at 24 KiB, debug details at 36 KiB, and every complete packet at 48 KiB with deterministic truncation metadata. No unrestricted backend dumps. Do not manually chain search/definition/reference primitives unless this result is insufficient.',
        category: 'workflow',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: { type: 'string', minLength: 1, maxLength: 256 },
                file: { type: 'string' },
                precise: { type: 'boolean', default: true },
                depth: { type: 'number', minimum: 1, maximum: 5, default: 1 },
                limit: { type: 'number', minimum: 1, maximum: 200, default: 50 },
                mode: {
                    type: 'string',
                    enum: ['compact', 'standard', 'debug'],
                    default: 'compact',
                    description:
                        'compact: decision packet only (default); standard: normalized bounded evidence with sparse observed/usable accounting; debug: full standard evidence plus bounded/redacted diagnostics, shape failures, and raw fragments. Fixed detail budgets are 24 KiB standard and 36 KiB debug; the complete packet is capped at 48 KiB.',
                },
                maxFiles: { type: 'number', minimum: 1, maximum: 25, default: 8 },
                maxNextReads: { type: 'number', minimum: 1, maximum: 10, default: 4 },
                maxLimitations: { type: 'number', minimum: 1, maximum: 10, default: 3 },
            },
            required: ['symbol'],
        },
    },
    {
        name: 'patch_checks_in_snapshot',
        title: 'Patch Checks in Snapshot',
        description:
            'PREFERRED one-call validation for a prepared unified diff. Stages the patch in an SCI snapshot, runs exact checks, and returns evidence without editing the working tree. Returns: { ok, elapsedMs, output_tail }.',
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
            'PREFERRED first call when a symbol definition is uncertain. Performs fast lookup and a precise retry when ambiguous; use bounded reads after it identifies candidates. Returns: { attempts: [fast, precise], definitions }.',
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
            'PREFERRED one-call patch preview/check path. Stages a patch, runs checks, and returns risk/rollback/artifact evidence. Keep apply:false unless mutation is explicitly requested; apply also requires ALLOW_SNAPSHOT_APPLY=1.',
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
    },
];
