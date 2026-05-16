import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import {
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ReadResourceRequestSchema,
    ErrorCode,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Register common prompts available to both HTTP and stdio servers.
export function registerCommonPrompts(server: Server): void {
    const suggestSymbols = (value: string) =>
        ['HTTPServer', 'TestClass', 'CodeAnalyzer', 'TestFunction'].filter((s) =>
            s.toLowerCase().startsWith((value || '').toLowerCase())
        );
    const suggestFiles = (value: string) =>
        ['src/servers/http.ts', 'tests/fixtures/example.ts', 'src/core/unified-analyzer.ts'].filter((p) =>
            p.toLowerCase().includes((value || '').toLowerCase())
        );
    const suggestCommands = (value: string) =>
        ['bun run build:all', 'bun test -q', 'bun run build:tsc'].filter((c) =>
            c.toLowerCase().startsWith((value || '').toLowerCase())
        );

    // Plan safe rename → workflow
    server.registerPrompt(
        'plan-safe-rename',
        {
            title: 'Plan Safe Rename',
            description: 'Plan a safe rename and optionally run checks in a snapshot',
            argsSchema: z.object({
                oldName: completable(z.string(), (v) => suggestSymbols(v || '')),
                newName: completable(z.string(), (v) => suggestSymbols(v || '')),
                file: completable(z.string().optional(), (v) => suggestFiles(v || '')),
                runChecks: z.boolean().optional(),
                command: completable(z.string().optional(), (v) => suggestCommands(v || '')),
            }),
        },
        ({ oldName, newName, file = 'file://workspace', runChecks = true, command = 'bun run build:all' }) => ({
            messages: [
                {
                    role: 'system',
                    content: {
                        type: 'text',
                        text: 'Use plan_rename first; for application use workflow_safe_rename into a snapshot. Prefer AST‑validated hits.',
                    },
                },
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Intent: rename ${oldName} -> ${newName} at ${file}\nSteps:\n1) tools/call plan_rename { oldName: "${oldName}", newName: "${newName}", file: "${file}" }\n2) tools/call rename_safely { oldName: "${oldName}", newName: "${newName}", file: "${file}", runChecks: ${runChecks}, commands: ["${command}"], timeoutSec: 180 }`,
                    },
                },
            ],
        })
    );

    // Investigate symbol
    server.registerPrompt(
        'investigate-symbol',
        {
            title: 'Investigate Symbol',
            description: 'Explore, build symbol map (AST-only), and expand graph neighbors',
            argsSchema: z.object({
                symbol: completable(z.string(), (v) => suggestSymbols(v || '')),
                file: completable(z.string().optional(), (v) => suggestFiles(v || '')),
                conceptual: z.boolean().optional(),
            }),
        },
        ({ symbol, file = 'file://workspace', conceptual = false }) => ({
            messages: [
                {
                    role: 'system',
                    content: {
                        type: 'text',
                        text: 'Start broad with explore_codebase (optionally conceptual), then build_symbol_map (astOnly), then graph_expand imports/exports.',
                    },
                },
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Target: ${symbol} at ${file}\nSuggested tools:\n- tools/call explore_codebase { symbol: "${symbol}", file: "${file}", conceptual: ${conceptual} }\n- tools/call build_symbol_map { symbol: "${symbol}", file: "${file}", maxFiles: 10, astOnly: true }\n- tools/call graph_expand { symbol: "${symbol}", edges: ["imports","exports"], depth: 1, limit: 50 }\n- Optional: tools/call explore_symbol_impact { symbol: "${symbol}", file: "${file}", limit: 50 }`,
                    },
                },
            ],
        })
    );

    // Quick patch checks
    server.registerPrompt(
        'quick-patch-checks',
        {
            title: 'Quick Patch Checks',
            description: 'Stage a unified diff to snapshot and run checks',
            argsSchema: z.object({
                command: completable(z.string().optional(), (v) => suggestCommands(v || '')),
                timeoutSec: z.number().optional(),
            }),
        },
        ({ command = 'bun run build:all', timeoutSec = 180 }) => ({
            messages: [
                {
                    role: 'system',
                    content: {
                        type: 'text',
                        text: 'Use get_snapshot + propose_patch + run_checks, keeping edits isolated in snapshot.',
                    },
                },
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Suggested calls:\n- tools/call get_snapshot { preferExisting: true }\n- tools/call propose_patch { snapshot: <id>, patch: <unified_diff> }\n- tools/call run_checks { snapshot: <id>, commands: ["${command}"], timeoutSec: ${timeoutSec} }\n- Or single call: tools/call patch_checks_in_snapshot { patch: <unified_diff>, timeoutSec: ${timeoutSec} }`,
                    },
                },
            ],
        })
    );

    // Locate & Confirm Definition
    server.registerPrompt(
        'locate-confirm',
        {
            title: 'Locate & Confirm Definition',
            description: 'Fast locate, precise retry if ambiguous; returns chosen definitions with attempts.',
            argsSchema: z.object({
                symbol: completable(z.string(), (v) =>
                    ['HTTPServer', 'TestClass', 'CodeAnalyzer'].filter((s) =>
                        s.toLowerCase().startsWith((v || '').toLowerCase())
                    )
                ),
                file: completable(z.string().optional(), (v) =>
                    ['src/servers/http.ts', 'tests/fixtures/example.ts'].filter((p) =>
                        p.toLowerCase().includes((v || '').toLowerCase())
                    )
                ),
            }),
        },
        ({ symbol, file = 'file://workspace' }) => ({
            messages: [
                {
                    role: 'system',
                    content: { type: 'text', text: 'Prefer precise confirmation only when fast pass is ambiguous.' },
                },
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Target: ${symbol} at ${file}\nSuggested tool:\n- tools/call locate_confirm_definition { symbol: "${symbol}", file: "${file}" }`,
                    },
                },
            ],
        })
    );
}

// Register common resources (monitoring and snapshot artifacts).
export function registerCommonResources(server: Server): void {
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
            {
                uri: 'monitoring://summary',
                name: 'monitoring',
                title: 'Monitoring Summary',
                description: 'System health and layer stats',
                mimeType: 'application/json',
            },
        ],
    }));

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
        resourceTemplates: [
            {
                name: 'snapshot-diff',
                uriTemplate: 'snapshot://{id}/overlay.diff',
                title: 'Snapshot Patch Diff',
                description: 'Staged diff for a snapshot',
                mimeType: 'text/plain',
            },
            {
                name: 'snapshot-status',
                uriTemplate: 'snapshot://{id}/status',
                title: 'Snapshot Status',
                description: 'Snapshot metadata and staged changes',
                mimeType: 'application/json',
            },
            {
                name: 'snapshot-progress',
                uriTemplate: 'snapshot://{id}/progress',
                title: 'Snapshot Progress',
                description: 'Progress log for snapshot operations',
                mimeType: 'text/plain',
            },
        ],
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uriStr = request.params.uri;
        try {
            const uri = new URL(uriStr);
            if (uri.protocol === 'monitoring:') {
                const coreIndex = await import('../core/index');
                const analyzerGetter = (coreIndex as any)?.getActiveAnalyzer;
                // Fallback: use any exported accessor or return empty
                const stats = typeof analyzerGetter === 'function' ? await analyzerGetter()?.getDetailedStats?.() : {};
                const body = JSON.stringify(stats || {}, null, 2);
                return { contents: [{ uri: uri.href, mimeType: 'application/json', text: body }] } as any;
            }
            if (uri.protocol === 'snapshot:') {
                const parts = uri.pathname.split('/').filter(Boolean);
                const id = parts[0];
                const tail = parts[1];
                if (!id) throw new Error('Missing snapshot id');
                if (tail === 'overlay.diff') {
                    const fs = await import('node:fs/promises');
                    const path = await import('node:path');
                    const { overlayStore } = await import('../core/overlay-store.js');
                    const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
                    const dir = ensure ? await ensure(id) : undefined;
                    const diffPath = path.join(dir || '', 'overlay.diff');
                    let text = '';
                    try {
                        text = await fs.readFile(diffPath, 'utf8');
                    } catch {
                        text = '# No overlay.diff found in snapshot';
                    }
                    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] } as any;
                }
                if (tail === 'status') {
                    const { overlayStore } = await import('../core/overlay-store.js');
                    const snaps = (overlayStore as any).list?.() || [];
                    const snap = snaps.find((s: any) => s.id === id) || null;
                    const body = JSON.stringify(
                        { id, exists: !!snap, diffCount: snap?.diffs?.length || 0, createdAt: snap?.createdAt || null },
                        null,
                        2
                    );
                    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: body }] } as any;
                }
                if (tail === 'progress') {
                    const fs = await import('node:fs/promises');
                    const path = await import('node:path');
                    const snapsRoot = path.resolve('.ontology', 'snapshots');
                    const logPath = path.join(snapsRoot, id, 'progress.log');
                    let text = '';
                    try {
                        text = await fs.readFile(logPath, 'utf8');
                    } catch {
                        text = '# No progress.log found for snapshot';
                    }
                    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] } as any;
                }
            }
            throw new McpError(ErrorCode.InvalidParams, `Unsupported resource ${uriStr}`);
        } catch (e) {
            throw new McpError(ErrorCode.InternalError, e instanceof Error ? e.message : String(e));
        }
    });
}
