import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    ErrorCode,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    McpError,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

type PromptArgumentSpec = { name: string; description?: string; required?: boolean };
type PromptRenderResult = {
    description: string;
    messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
};
type PromptSpec = {
    name: string;
    title: string;
    description: string;
    arguments: PromptArgumentSpec[];
    argsSchema: z.ZodTypeAny;
    render: (args: Record<string, unknown>) => PromptRenderResult;
};

const suggestSymbols = (value: string) =>
    ['HTTPServer', 'TestClass', 'CodeAnalyzer', 'TestFunction'].filter((s) =>
        s.toLowerCase().startsWith((value || '').toLowerCase())
    );
const suggestFiles = (value: string) =>
    ['src/servers/http.ts', 'tests/fixtures/example.ts', 'src/core/unified-analyzer.ts'].filter((p) =>
        p.toLowerCase().includes((value || '').toLowerCase())
    );
const suggestCommands = (value: string) =>
    ['bun run build:all', 'bun test -q', 'bun run typecheck'].filter((c) =>
        c.toLowerCase().startsWith((value || '').toLowerCase())
    );

function stringArg(args: Record<string, unknown>, name: string, fallback: string): string {
    const value = args[name];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function booleanArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
    const value = args[name];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
    }
    return fallback;
}

function numberArg(args: Record<string, unknown>, name: string, fallback: number): number {
    const value = Number(args[name]);
    return Number.isFinite(value) ? value : fallback;
}

function inlineJson(value: unknown): string {
    return JSON.stringify(value);
}

const COMMON_PROMPTS: PromptSpec[] = [
    {
        name: 'plan-safe-rename',
        title: 'Plan Safe Rename',
        description: 'Plan a safe rename and optionally run checks in a snapshot',
        arguments: [
            { name: 'oldName', description: 'Original symbol name', required: true },
            { name: 'newName', description: 'New symbol name', required: true },
            { name: 'file', description: 'Optional context file URI', required: false },
            { name: 'runChecks', description: 'Whether to run checks', required: false },
            { name: 'command', description: 'Validation command', required: false },
        ],
        argsSchema: z.object({
            oldName: completable(z.string(), (v) => suggestSymbols(v || '')),
            newName: completable(z.string(), (v) => suggestSymbols(v || '')),
            file: completable(z.string().optional(), (v) => suggestFiles(v || '')),
            runChecks: z.boolean().optional(),
            command: completable(z.string().optional(), (v) => suggestCommands(v || '')),
        }),
        render: (args) => {
            const oldName = stringArg(args, 'oldName', '<oldName>');
            const newName = stringArg(args, 'newName', '<newName>');
            const file = stringArg(args, 'file', 'file://workspace');
            const runChecks = booleanArg(args, 'runChecks', true);
            const command = stringArg(args, 'command', 'bun run build:all');
            return {
                description: 'Plan a safe rename and optionally run checks in a snapshot',
                messages: [
                    {
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: 'Use Alpha MVP primitives only: locate/read the target, prepare a reviewed unified diff, then stage and check it with safe_write or propose_patch + run_checks.',
                        },
                    },
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Intent: rename ${oldName} -> ${newName} at ${file}\nSteps:\n1) tools/call find_definition ${inlineJson({ symbol: oldName, file, maxResults: 20, precise: true })}\n2) tools/call read_file ${inlineJson({ path: '<repo-relative-file-from-definition>', range: { startLine: 1, endLine: 120 } })}\n3) Prepare a unified diff replacing reviewed occurrences only.\n4) tools/call safe_write ${inlineJson({ patch: '<unified_diff>', commands: runChecks ? [command] : ['true'], timeoutSec: 180, apply: false })}`,
                        },
                    },
                ],
            };
        },
    },
    {
        name: 'investigate-symbol',
        title: 'Investigate Symbol',
        description: 'Explore, build symbol map (AST-only), and expand graph neighbors',
        arguments: [
            { name: 'symbol', description: 'Symbol to investigate', required: true },
            { name: 'file', description: 'Optional context file URI', required: false },
            { name: 'conceptual', description: 'Whether to include conceptual hints', required: false },
        ],
        argsSchema: z.object({
            symbol: completable(z.string(), (v) => suggestSymbols(v || '')),
            file: completable(z.string().optional(), (v) => suggestFiles(v || '')),
            conceptual: z.boolean().optional(),
        }),
        render: (args) => {
            const symbol = stringArg(args, 'symbol', '<symbol>');
            const file = stringArg(args, 'file', 'file://workspace');
            return {
                description: 'Explore, build symbol map (AST-only), and expand graph neighbors',
                messages: [
                    {
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: 'Start with find_definition/find_references, then use graph_expand for bounded one-hop impact context. Stay within the Alpha MVP tool surface.',
                        },
                    },
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Target: ${symbol} at ${file}\nSuggested tools:\n- tools/call find_definition ${inlineJson({ symbol, file, precise: true, maxResults: 20 })}\n- tools/call find_references ${inlineJson({ symbol, file, includeDeclaration: true, maxResults: 50 })}\n- tools/call graph_expand ${inlineJson({ symbol, edges: ['callers', 'callees'], depth: 1, limit: 50 })}`,
                        },
                    },
                ],
            };
        },
    },
    {
        name: 'quick-patch-checks',
        title: 'Quick Patch Checks',
        description: 'Stage a unified diff to snapshot and run checks',
        arguments: [
            { name: 'command', description: 'Validation command', required: false },
            { name: 'timeoutSec', description: 'Per-command timeout seconds', required: false },
        ],
        argsSchema: z.object({
            command: completable(z.string().optional(), (v) => suggestCommands(v || '')),
            timeoutSec: z.number().optional(),
        }),
        render: (args) => {
            const command = stringArg(args, 'command', 'bun run build:all');
            const timeoutSec = numberArg(args, 'timeoutSec', 180);
            return {
                description: 'Stage a unified diff to snapshot and run checks',
                messages: [
                    {
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: 'Use get_snapshot + propose_patch + run_checks, keeping edits isolated in snapshot.',
                        },
                    },
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Suggested calls:\n- tools/call get_snapshot ${inlineJson({ preferExisting: true })}\n- tools/call propose_patch ${inlineJson({ snapshot: '<id>', patch: '<unified_diff>' })}\n- tools/call run_checks ${inlineJson({ snapshot: '<id>', commands: [command], timeoutSec })}\n- Or single call: tools/call patch_checks_in_snapshot ${inlineJson({ patch: '<unified_diff>', timeoutSec })}`,
                        },
                    },
                ],
            };
        },
    },
    {
        name: 'locate-confirm',
        title: 'Locate & Confirm Definition',
        description: 'Fast locate, precise retry if ambiguous; returns chosen definitions with attempts.',
        arguments: [
            { name: 'symbol', description: 'Symbol name to locate', required: true },
            { name: 'file', description: 'Optional context file URI', required: false },
        ],
        argsSchema: z.object({
            symbol: completable(z.string(), (v) => suggestSymbols(v || '')),
            file: completable(z.string().optional(), (v) => suggestFiles(v || '')),
        }),
        render: (args) => {
            const symbol = stringArg(args, 'symbol', '<symbol>');
            const file = stringArg(args, 'file', 'file://workspace');
            return {
                description: 'Fast locate, precise retry if ambiguous; returns chosen definitions with attempts.',
                messages: [
                    {
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: 'Prefer precise confirmation only when fast pass is ambiguous.',
                        },
                    },
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Target: ${symbol} at ${file}\nSuggested tool:\n- tools/call find_definition ${inlineJson({ symbol, file, precise: true, maxResults: 20 })}`,
                        },
                    },
                ],
            };
        },
    },
];

// Register common prompts available to both HTTP and stdio servers.
export function registerCommonPrompts(server: Server): void {
    if (typeof (server as any).registerPrompt !== 'function') {
        registerCommonPromptHandlers(server);
        return;
    }

    for (const prompt of COMMON_PROMPTS) {
        (server as any).registerPrompt(
            prompt.name,
            {
                title: prompt.title,
                description: prompt.description,
                argsSchema: prompt.argsSchema,
            },
            (args: Record<string, unknown>) => prompt.render(args || {})
        );
    }
}

export function registerCommonPromptHandlers(server: Server): void {
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: COMMON_PROMPTS.map(({ name, title, description, arguments: args }) => ({
            name,
            title,
            description,
            arguments: args,
        })),
    }));
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const prompt = COMMON_PROMPTS.find((candidate) => candidate.name === request.params.name);
        if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`);
        return prompt.render(request.params.arguments || {});
    });
}

async function readSnapshotArtifactText(dir: string | undefined, file: string, fallback: string): Promise<string> {
    if (!dir) return fallback;
    const fs = await import('node:fs/promises');
    const fsSync = await import('node:fs');
    const path = await import('node:path');
    try {
        const filePath = path.join(dir, file);
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) return fallback;
        const [realDir, realFile] = await Promise.all([fs.realpath(dir), fs.realpath(filePath)]);
        const relative = path.relative(realDir, realFile);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return fallback;
        const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number' ? fsSync.constants.O_NOFOLLOW : 0;
        const handle = await fs.open(filePath, fsSync.constants.O_RDONLY | noFollow);
        try {
            const openedReal = await fs
                .realpath(`/proc/self/fd/${handle.fd}`)
                .catch(() => fs.realpath(`/dev/fd/${handle.fd}`));
            const openedRelative = path.relative(realDir, openedReal);
            if (!openedRelative || openedRelative.startsWith('..') || path.isAbsolute(openedRelative)) return fallback;
            return await handle.readFile('utf8');
        } finally {
            await handle.close().catch(() => undefined);
        }
    } catch {
        return fallback;
    }
}

// Register common resources (monitoring and snapshot artifacts).
export function registerCommonResources(
    server: Server,
    opts: { workspaceRoot?: string; getAnalyzer?: () => any } = {}
): void {
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
                const analyzer = opts.getAnalyzer?.();
                const stats = analyzer?.getDetailedStats
                    ? await analyzer.getDetailedStats()
                    : analyzer?.getDiagnostics
                      ? await analyzer.getDiagnostics()
                      : {};
                const body = JSON.stringify(stats || {}, null, 2);
                return { contents: [{ uri: uri.href, mimeType: 'application/json', text: body }] } as any;
            }
            if (uri.protocol === 'snapshot:') {
                const parts = uri.pathname
                    .split('/')
                    .filter(Boolean)
                    .map((part) => decodeURIComponent(part));
                const hostId = uri.host ? decodeURIComponent(uri.host) : '';
                const id = hostId || parts[0];
                const tail = hostId ? parts[0] : parts[1];
                const extra = hostId ? parts.slice(1) : parts.slice(2);
                if (!id) throw new Error('Missing snapshot id');
                if (extra.length > 0) throw new McpError(ErrorCode.InvalidParams, `Unsupported resource ${uriStr}`);
                if (tail === 'overlay.diff') {
                    const { overlayStore } = await import('../core/overlay-store.js');
                    let text =
                        (overlayStore as any).getOverlayDiffText?.(id, { workspaceRoot: opts.workspaceRoot }) || '';
                    if (!text) {
                        const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
                        const dir = ensure ? await ensure(id, { workspaceRoot: opts.workspaceRoot }) : undefined;
                        text = await readSnapshotArtifactText(
                            dir,
                            'overlay.diff',
                            '# No overlay.diff found in snapshot'
                        );
                    }
                    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] } as any;
                }
                if (tail === 'status') {
                    const { overlayStore } = await import('../core/overlay-store.js');
                    let snap: any = null;
                    try {
                        snap = (overlayStore as any).getStatus?.(id, { workspaceRoot: opts.workspaceRoot }) || null;
                    } catch {}
                    const body = JSON.stringify(
                        {
                            id,
                            exists: !!snap,
                            diffCount: snap?.diffsCount || 0,
                            createdAt: snap?.createdAt || null,
                            touchedFiles: snap?.touchedFiles || [],
                        },
                        null,
                        2
                    );
                    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: body }] } as any;
                }
                if (tail === 'progress') {
                    const { overlayStore } = await import('../core/overlay-store.js');
                    let snapshotDir = '';
                    try {
                        snapshotDir =
                            (overlayStore as any).getSnapshotDirectory?.(id, { workspaceRoot: opts.workspaceRoot }) ||
                            '';
                    } catch {}
                    const text = await readSnapshotArtifactText(
                        snapshotDir,
                        'progress.log',
                        '# No progress.log found for snapshot'
                    );
                    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] } as any;
                }
            }
            throw new McpError(ErrorCode.InvalidParams, `Unsupported resource ${uriStr}`);
        } catch (e) {
            if (e instanceof McpError) throw e;
            throw new McpError(ErrorCode.InternalError, e instanceof Error ? e.message : String(e));
        }
    });
}
