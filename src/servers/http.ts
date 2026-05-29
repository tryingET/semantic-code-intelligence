/**
 * HTTP API Server - Thin wrapper around unified core
 *
 * This server only handles HTTP transport concerns:
 * - Request parsing
 * - Response formatting
 * - Server lifecycle
 *
 * All analysis work is delegated to the HTTP adapter and core analyzer.
 */

import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from 'bun';
import { HTTPAdapter, type HTTPRequest } from '../adapters/http-adapter.js';
import { createDefaultCoreConfig, definitionToApiResponse, strictJsonParse } from '../adapters/utils.js';
import { getEnvironmentConfig, type ServerConfig } from '../core/config/server-config.js';
import { CoreError, isCoreError } from '../core/errors.js';
import { createCodeAnalyzer } from '../core/index';
import { ToolExecutor } from '../core/tools/executor.js';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { assertHttpToolAllowed as assertSharedHttpToolAllowed } from '../core/workflows/http-tool-policy.js';
import type { SnapshotWorkflowResult } from '../core/workflows/snapshot-patch-workflow.js';
import {
    normalizeWorkflowResult,
    workflowErrorPayload,
    workflowPayload,
} from '../core/workflows/tool-result-normalizer.js';
import { ToolWorkflowRouter } from '../core/workflows/tool-workflow-router.js';
import { resolveConfiguredWorkspaceRoot } from '../core/workspace-root.js';
import { metricsRegistry, recordLayerLatency, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';
import type { FastSearchLayer } from '../layers/layer1-fast-search.js';
import type { SearchQuery } from '../types/core.js';
import { assertAllowedBrowserOrigin, corsHeadersForRequest, readLimitedJsonBody } from './http-ingress.js';

const HTTP_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_ARTIFACT_MAX_BYTES = 256 * 1024;

function truncateBufferUtf8WithMarker(buffer: Buffer, bytesRead: number, maxBytes: number): string {
    const marker = `\n[truncated at ${maxBytes} bytes]\n`;
    const markerBytes = Buffer.byteLength(marker, 'utf8');
    let end = Math.min(bytesRead, Math.max(0, maxBytes - markerBytes));
    const decoder = new TextDecoder('utf-8', { fatal: true });
    while (end > 0) {
        try {
            return decoder.decode(buffer.subarray(0, end)) + marker;
        } catch {
            end--;
        }
    }
    return markerBytes <= maxBytes ? marker : '';
}

async function readFileHandleBounded(handle: fs.FileHandle, maxBytes = SNAPSHOT_ARTIFACT_MAX_BYTES): Promise<string> {
    const stat = await handle.stat();
    if (stat.size <= maxBytes) return await handle.readFile('utf8');
    const buffer = Buffer.alloc(maxBytes);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return truncateBufferUtf8WithMarker(buffer, result.bytesRead, maxBytes);
}

interface HTTPServerConfig {
    port?: number;
    host?: string;
    workspaceRoot?: string;
    enableCors?: boolean;
    enableOpenAPI?: boolean;
    enableLegacyPipelines?: boolean;
}

async function readSnapshotArtifactText(dir: string | undefined, file: string, fallback: string): Promise<string> {
    if (!dir) return fallback;
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
            return await readFileHandleBounded(handle);
        } finally {
            await handle.close().catch(() => undefined);
        }
    } catch {
        return fallback;
    }
}

function statusForCoreErrorCode(code: unknown, fallback = 500): number {
    if (code === 'InvalidParams') return 400;
    if (code === 'UnknownTool') return 404;
    if (code === 'Internal') return 500;
    return fallback;
}

function statusForThrownError(err: unknown): number {
    return isCoreError(err) ? statusForCoreErrorCode(err.code) : 500;
}

function envelopeForThrownError(err: unknown): { code: string; message: string; data?: any } {
    if (isCoreError(err)) {
        return { code: err.code, message: err.message, data: err.data };
    }
    const message = err instanceof Error ? err.message : String(err || 'Internal server error');
    return { code: 'Internal', message };
}

export class HTTPServer {
    private coreAnalyzer!: CodeAnalyzer;
    private httpAdapter!: HTTPAdapter;
    private toolRouter!: ToolWorkflowRouter;
    private toolExecutor!: ToolExecutor;
    private config: HTTPServerConfig;
    private serverConfig: ServerConfig;
    private server: any = null;
    // No external port registry; honor env or defaults

    constructor(config: HTTPServerConfig = {}) {
        this.serverConfig = getEnvironmentConfig();
        this.config = {
            ...config,
            port: config.port ?? this.serverConfig.ports.httpAPI,
            host: config.host ?? this.serverConfig.host,
            workspaceRoot: resolveConfiguredWorkspaceRoot(config.workspaceRoot),
            enableCors: config.enableCors ?? true,
            enableOpenAPI: config.enableOpenAPI ?? true,
            enableLegacyPipelines:
                config.enableLegacyPipelines ??
                (process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES === '1' || config.enableOpenAPI === false),
        };
    }

    async initialize(): Promise<void> {
        if (!process.env.SILENT_MODE) {
            console.log(`[HTTP Server] Initializing at ${this.config.host}:${this.config.port}`);
            console.log(`[HTTP Server] Workspace root: ${this.config.workspaceRoot}`);
        }

        // Initialize core analyzer
        const coreConfig = createDefaultCoreConfig();
        coreConfig.monitoring.enabled = true; // enable metrics only for HTTP server

        this.coreAnalyzer = await createCodeAnalyzer({
            ...coreConfig,
            workspaceRoot: this.config.workspaceRoot!,
        });

        await this.coreAnalyzer.initialize();

        // Create HTTP adapter and reusable core workflow executor
        this.httpAdapter = new HTTPAdapter(this.coreAnalyzer, {
            enableCors: this.config.enableCors,
            enableOpenAPI: this.config.enableOpenAPI,
            maxResults: 100,
            timeout: 30000,
        });
        this.toolRouter = new ToolWorkflowRouter(this.coreAnalyzer);
        this.toolExecutor = new ToolExecutor();

        if (!process.env.SILENT_MODE) {
            console.log(`[HTTP Server] Core analyzer and HTTP adapter initialized`);
        }
    }

    async start(): Promise<void> {
        if (!this.coreAnalyzer || !this.httpAdapter) {
            await this.initialize();
        }

        // Determine port: prefer config port if explicitly set, else HTTP_API_PORT env, else 7000
        const listenPort = Number(this.config.port ?? process.env.HTTP_API_PORT ?? 7000);

        this.server = serve({
            hostname: this.config.host,
            port: listenPort,
            fetch: async (request) => {
                try {
                    const url = new URL(request.url);

                    if (request.method === 'OPTIONS') {
                        const headers = corsHeadersForRequest(request);
                        if (request.headers.get('origin') && headers['Access-Control-Allow-Origin'] === 'null') {
                            return new Response('', { status: 403, headers });
                        }
                        return new Response('', { status: 204, headers });
                    }

                    if (request.method !== 'GET' && request.method !== 'HEAD') {
                        assertAllowedBrowserOrigin(request, 'HTTP write request');
                    }

                    // Serve static web UI from web-ui/dist under /ui; fallback to unbundled web-ui/index.html
                    if (url.pathname === '/ui' || url.pathname === '/ui/') {
                        const index = await this.findWebUiFile('index.html', ['dist', null]);
                        if (index) {
                            return new Response(index.file, { status: 200, headers: { 'Content-Type': 'text/html' } });
                        }
                        return new Response('Not found', { status: 404 });
                    }
                    if (url.pathname.startsWith('/ui/')) {
                        const rel = this.decodeStaticPath(url.pathname.replace(/^\/ui\//, ''));
                        if (rel === null) return new Response('Bad request', { status: 400 });
                        const asset = await this.findWebUiFile(rel, ['dist']);
                        if (!asset) return new Response('Not found', { status: 404 });
                        const contentType = this.contentTypeFor(asset.filePath);
                        return new Response(asset.file, {
                            status: 200,
                            headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
                        });
                    }

                    // Let adapter handle streaming endpoints for now
                    // TODO: Implement proper server-level SSE streaming
                    // if (url.pathname.includes('/stream/') && request.method === 'POST') {
                    //   return await this.handleSSEStream(request, url.pathname);
                    // }

                    // Small built-in metrics endpoint for Layer 4 storage
                    if (url.pathname === '/metrics/l4' && request.method === 'GET') {
                        const metrics = (this.coreAnalyzer as any).getLayer4StorageMetrics?.();
                        return new Response(JSON.stringify(metrics || { error: 'unavailable' }), {
                            status: metrics ? 200 : 503,
                            headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                        });
                    }

                    // Unified /metrics endpoint - supports format=json|prometheus (default)
                    if (url.pathname === '/metrics' && request.method === 'GET') {
                        const fmt = (url.searchParams.get('format') || 'prometheus').toLowerCase();
                        const lm: any = (this.coreAnalyzer as any).layerManager;
                        const l1: any = lm?.getLayer?.('layer1');
                        const l2: any = lm?.getLayer?.('layer2');
                        const l1m = typeof l1?.getMetrics === 'function' ? l1.getMetrics() : null;
                        const l2m = typeof l2?.getMetrics === 'function' ? l2.getMetrics() : null;
                        const l4 = (this.coreAnalyzer as any).getLayer4StorageMetrics?.();
                        const lmAll = typeof lm?.getAllMetrics === 'function' ? lm.getAllMetrics() : null;
                        const lmPerf =
                            typeof lm?.getPerformanceReport === 'function' ? lm.getPerformanceReport() : null;

                        if (fmt !== 'prometheus') {
                            // JSON variant for dashboards: include L4 storage extras for richer panels
                            const storageExtras = l4 && (l4 as any).extras ? (l4 as any).extras : {};
                            const storageTotals =
                                l4 && (l4 as any).totals ? (l4 as any).totals : { count: 0, errors: 0 };
                            return new Response(
                                JSON.stringify({
                                    l1: l1m,
                                    l2: l2m,
                                    l4: l4 || null,
                                    storageExtras,
                                    storageTotals,
                                    layerManager: {
                                        layers: lmAll,
                                        performance: lmPerf,
                                    },
                                }),
                                {
                                    status: l4 || l1m || l2m || lmAll || lmPerf ? 200 : 503,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }

                        let text = '';
                        // L1 metrics
                        if (l1m?.layer) {
                            text += '# HELP ontology_l1_timeouts_total L1 async search timeouts.\n';
                            text += '# TYPE ontology_l1_timeouts_total counter\n';
                            text += `ontology_l1_timeouts_total ${l1m.layer.timeouts || 0}\n`;
                            text += '# HELP ontology_l1_fallbacks_total L1 async->sync fallbacks.\n';
                            text += '# TYPE ontology_l1_fallbacks_total counter\n';
                            text += `ontology_l1_fallbacks_total ${l1m.layer.fallbacks || 0}\n`;
                            text += '# HELP ontology_l1_avg_response_ms Average L1 response time.\n';
                            text += '# TYPE ontology_l1_avg_response_ms gauge\n';
                            text += `ontology_l1_avg_response_ms ${Math.round(l1m.layer.avgResponseTime || 0)}\n`;
                            // Quantiles for L1 (if available)
                            if (typeof l1m.layer.p50ResponseTime === 'number') {
                                text += '# HELP ontology_l1_response_ms Quantiles of L1 response time in ms.\n';
                                text += '# TYPE ontology_l1_response_ms gauge\n';
                                text += `ontology_l1_response_ms{quantile="p50"} ${Math.round(l1m.layer.p50ResponseTime || 0)}\n`;
                                text += `ontology_l1_response_ms{quantile="p95"} ${Math.round(l1m.layer.p95ResponseTime || 0)}\n`;
                                text += `ontology_l1_response_ms{quantile="p99"} ${Math.round(l1m.layer.p99ResponseTime || 0)}\n`;
                            }
                        }

                        // L2 metrics
                        if (l2m) {
                            text += '# HELP ontology_l2_parse_count Total parsed files.\n';
                            text += '# TYPE ontology_l2_parse_count counter\n';
                            text += `ontology_l2_parse_count ${l2m.count || 0}\n`;
                            text += '# HELP ontology_l2_parse_errors Total parse errors.\n';
                            text += '# TYPE ontology_l2_parse_errors counter\n';
                            text += `ontology_l2_parse_errors ${l2m.errors || 0}\n`;
                            text += '# HELP ontology_l2_parse_duration_ms Parse duration quantiles.\n';
                            text += '# TYPE ontology_l2_parse_duration_ms summary\n';
                            text += `ontology_l2_parse_duration_ms{quantile="p50"} ${Math.round(l2m.p50 || 0)}\n`;
                            text += `ontology_l2_parse_duration_ms{quantile="p95"} ${Math.round(l2m.p95 || 0)}\n`;
                            text += `ontology_l2_parse_duration_ms{quantile="p99"} ${Math.round(l2m.p99 || 0)}\n`;
                        }

                        // L4 storage metrics
                        if (l4) {
                            text += '# HELP ontology_l4_started_at_seconds L4 storage metrics start time.\n';
                            text += '# TYPE ontology_l4_started_at_seconds gauge\n';
                            if (l4?.startedAt)
                                text += `ontology_l4_started_at_seconds ${Math.floor(l4.startedAt / 1000)}\n`;
                            text += '# HELP ontology_l4_updated_at_seconds L4 storage metrics last update time.\n';
                            text += '# TYPE ontology_l4_updated_at_seconds gauge\n';
                            if (l4?.updatedAt)
                                text += `ontology_l4_updated_at_seconds ${Math.floor(l4.updatedAt / 1000)}\n`;
                            if (l4?.operations) {
                                for (const [op, s] of Object.entries(l4.operations)) {
                                    if (!s || !(s as any).count) continue;
                                    text += `# HELP ontology_l4_operation_count Total operations per op.\n`;
                                    text += '# TYPE ontology_l4_operation_count counter\n';
                                    text += `ontology_l4_operation_count{op="${op}"} ${(s as any).count}\n`;
                                    text += `# HELP ontology_l4_operation_errors Total errors per op.\n`;
                                    text += '# TYPE ontology_l4_operation_errors counter\n';
                                    text += `ontology_l4_operation_errors{op="${op}"} ${(s as any).errors}\n`;
                                    text +=
                                        '# HELP ontology_l4_operation_duration_ms Quantiles of op duration in ms.\n';
                                    text += '# TYPE ontology_l4_operation_duration_ms gauge\n';
                                    text += `ontology_l4_operation_duration_ms{op="${op}",quantile="p50"} ${Math.round((s as any).p50)}\n`;
                                    text += `ontology_l4_operation_duration_ms{op="${op}",quantile="p95"} ${Math.round((s as any).p95)}\n`;
                                    text += `ontology_l4_operation_duration_ms{op="${op}",quantile="p99"} ${Math.round((s as any).p99)}\n`;
                                }
                            }
                        }
                        // Include core metrics registry output
                        const coreMetrics = metricsRegistry.renderPrometheusText();
                        if (coreMetrics) {
                            text = coreMetrics + '\n' + text;
                        }
                        if (!text.endsWith('\n')) text += '\n';
                        return new Response(text, {
                            status: 200,
                            headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-cache' },
                        });
                    }

                    // Monitoring shortcut: /monitoring -> /api/v1/monitoring (supports ?raw=1)
                    if (url.pathname === '/monitoring' && request.method === 'GET') {
                        const proxiedUrl = `${url.origin}/api/v1/monitoring${url.search}`;
                        const httpRequest: HTTPRequest = {
                            method: 'GET',
                            url: proxiedUrl,
                            headers: Object.fromEntries(request.headers.entries()),
                            body: undefined,
                            query: this.extractQuery(proxiedUrl),
                        };
                        const resp = await this.httpAdapter.handleRequest(httpRequest);
                        return new Response(resp.body, { status: resp.status, headers: resp.headers });
                    }

                    // AST Query endpoint
                    if (url.pathname === '/api/v1/ast-query' && request.method === 'POST') {
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const { runAstQuery } = await import('../core/ast-query.js');
                            const out = await runAstQuery({
                                language: body.language,
                                query: body.query,
                                paths: body.paths,
                                glob: body.glob,
                                limit: body.limit,
                                workspaceRoot: this.config.workspaceRoot,
                            });
                            return new Response(JSON.stringify({ success: true, data: out }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            const status = statusForThrownError(err);
                            return new Response(
                                JSON.stringify({
                                    success: false,
                                    error: isCoreError(err) ? envelopeForThrownError(err) : 'AST query failed',
                                }),
                                {
                                    status,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Generic Tools endpoint (HTTP parity with MCP tools)
                    if (url.pathname === '/api/v1/tools/call' && request.method === 'POST') {
                        try {
                            assertAllowedBrowserOrigin(request, 'HTTP tools/call');
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const name = String(body?.name || '').trim();
                            const hasArguments = Object.hasOwn(body || {}, 'arguments');
                            if (
                                hasArguments &&
                                (!body?.arguments ||
                                    typeof body.arguments !== 'object' ||
                                    Array.isArray(body.arguments))
                            ) {
                                throw new CoreError('InvalidParams', 'Tool arguments must be an object');
                            }
                            const args = hasArguments ? (body.arguments as Record<string, any>) : {};
                            if (!name) {
                                throw new CoreError('InvalidParams', 'Missing tool name');
                            }

                            const t0 = Date.now();
                            recordToolStart('http');
                            const toolResult = await this.executeToolWorkflow(name, args, {
                                enforceHttpToolSurface: true,
                            });
                            // Record tool call in monitoring (if enabled)
                            try {
                                const mon = (this.coreAnalyzer as any)?.sharedServices?.monitoring;
                                if (mon && typeof mon.recordToolCall === 'function') mon.recordToolCall(name);
                            } catch {}

                            const normalized = this.normalizeToolWorkflowResultForHttp(toolResult);
                            const explicitToolError = !!toolResult?.isError;
                            // A parsed tool payload may legitimately contain ok:false as domain state
                            // (for example guarded apply refused or checks failed). Treat only explicit
                            // core workflow error flags as HTTP tool-call failures.
                            const isError = explicitToolError;
                            recordToolEnd('http', name, Date.now() - t0, !isError);
                            const errCode = isError ? (normalized as any)?.error?.code : undefined;
                            const status = isError ? statusForCoreErrorCode(errCode, 400) : 200;
                            return new Response(
                                JSON.stringify({
                                    success: !isError,
                                    result: isError ? undefined : normalized,
                                    error: isError ? normalized.error : undefined,
                                }),
                                {
                                    status,
                                    headers: {
                                        'Content-Type': 'application/json',
                                        ...corsHeadersForRequest(request),
                                    },
                                }
                            );
                        } catch (err: any) {
                            try {
                                recordToolEnd('http', 'unknown', 0, false);
                            } catch {}
                            return new Response(
                                JSON.stringify({ success: false, error: envelopeForThrownError(err) }),
                                {
                                    status: statusForThrownError(err),
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    if (url.pathname.startsWith('/api/v1/pipelines') && !this.legacyPipelinesEnabled()) {
                        return new Response(
                            JSON.stringify({
                                success: false,
                                error: {
                                    code: 'InvalidParams',
                                    message:
                                        'Legacy pipeline HTTP endpoints are disabled; use the Alpha tools/call surface or set SCI_ENABLE_LEGACY_HTTP_PIPELINES=1 for explicit legacy access',
                                },
                            }),
                            {
                                status: 404,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            }
                        );
                    }

                    // Pipelines: run with streamable HTTP tail (NDJSON)
                    if (url.pathname === '/api/v1/pipelines/run-stream' && request.method === 'POST') {
                        const encoder = new TextEncoder();
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const pipelineId = String(body?.id || '').trim();
                            const pollMs = Math.max(100, Math.min(2000, Number(body?.pollMs || 300)));
                            const timeoutSec = Math.max(1, Math.min(600, Number(body?.timeoutSec || 30)));
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            }

                            const learningOrchestrator = (this.coreAnalyzer as any)?.learningOrchestrator;
                            if (!learningOrchestrator || typeof learningOrchestrator.startPipelineRun !== 'function') {
                                return new Response(
                                    JSON.stringify({ success: false, error: 'learning orchestrator unavailable' }),
                                    {
                                        status: 500,
                                        headers: {
                                            'Content-Type': 'application/json',
                                            ...corsHeadersForRequest(request),
                                        },
                                    }
                                );
                            }

                            // Start the persisted run before constructing the stream so the
                            // first bytes can report the accepted run instead of waiting for
                            // pipeline completion.
                            const runJson = await learningOrchestrator.startPipelineRun(pipelineId, {
                                requestId: String(Date.now()),
                                operation: 'pipeline_run_stream',
                                timestamp: new Date(),
                                metadata: {},
                            });
                            const runId = String(runJson?.runId || '').trim();
                            if (!runJson?.ok || !runId) {
                                return new Response(
                                    JSON.stringify({
                                        success: false,
                                        error: {
                                            code: 'InvalidParams',
                                            message: runJson?.errors?.[0] || 'failed to start pipeline',
                                            data: runJson,
                                        },
                                    }),
                                    {
                                        status: 400,
                                        headers: {
                                            'Content-Type': 'application/json',
                                            ...corsHeadersForRequest(request),
                                        },
                                    }
                                );
                            }

                            const stream = new ReadableStream<Uint8Array>({
                                start: async (controller) => {
                                    const begun = { event: 'started', pipelineId, runId, t: Date.now() };
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify(begun) + '\n'));
                                    } catch {}
                                    const t0 = Date.now();
                                    let lastStatus = '';
                                    // Poll for status using list_pipeline_runs (filter by runId)
                                    while (true) {
                                        try {
                                            const listRes = await this.executeToolWorkflow('list_pipeline_runs', {
                                                id: pipelineId,
                                                limit: 10,
                                            });
                                            const ljson = this.toolWorkflowPayload(listRes, { runs: [] });
                                            const runs = Array.isArray(ljson?.runs) ? ljson.runs : [];
                                            const row = runs.find((r: any) => String(r?.id) === runId);
                                            if (row) {
                                                const status = String(row?.status || 'unknown');
                                                const finished = row?.finished_at != null;
                                                if (status !== lastStatus) {
                                                    lastStatus = status;
                                                    const ev = {
                                                        event: 'status',
                                                        runId,
                                                        status,
                                                        finished,
                                                        metrics: row?.metrics ?? {},
                                                        t: Date.now(),
                                                    };
                                                    try {
                                                        controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
                                                    } catch {}
                                                }
                                                if (finished) {
                                                    const ev = { event: 'finished', runId, status, t: Date.now() };
                                                    try {
                                                        controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
                                                    } catch {}
                                                    try {
                                                        controller.close();
                                                    } catch {}
                                                    break;
                                                }
                                            }
                                        } catch {}
                                        if (Date.now() - t0 > timeoutSec * 1000) {
                                            const ev = { event: 'timeout', runId, t: Date.now() };
                                            try {
                                                controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
                                            } catch {}
                                            try {
                                                controller.close();
                                            } catch {}
                                            break;
                                        }
                                        await new Promise((r) => setTimeout(r, pollMs));
                                    }
                                },
                            });

                            return new Response(stream, {
                                status: 200,
                                headers: {
                                    'Content-Type': 'application/x-ndjson',
                                    'Cache-Control': 'no-cache',
                                    ...corsHeadersForRequest(request),
                                },
                            });
                        } catch (err) {
                            const status = statusForThrownError(err);
                            return new Response(
                                JSON.stringify({
                                    success: false,
                                    error: isCoreError(err) ? envelopeForThrownError(err) : 'run-stream failed',
                                }),
                                {
                                    status,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Pipelines: non-streaming run start (immediate)
                    if (url.pathname === '/api/v1/pipelines/run' && request.method === 'POST') {
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const pipelineId = String(body?.id || '').trim();
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            }
                            const runRes = await this.executeToolWorkflow('run_pipeline', {
                                id: pipelineId,
                            });
                            const json = this.toolWorkflowPayload(runRes, {
                                ok: false,
                                runId: '',
                                reason: 'parse_error',
                            });
                            const ok = !!json?.ok;
                            const status = ok || json?.runId ? 200 : 400;
                            return new Response(
                                JSON.stringify({
                                    success: ok,
                                    data: json,
                                    error: ok
                                        ? undefined
                                        : {
                                              code: 'InvalidParams',
                                              message: json?.errors?.[0] || json?.reason || 'pipeline run failed',
                                              data: json,
                                          },
                                }),
                                {
                                    status,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        } catch (err) {
                            const status = statusForThrownError(err);
                            return new Response(
                                JSON.stringify({
                                    success: false,
                                    error: isCoreError(err) ? envelopeForThrownError(err) : 'run failed',
                                }),
                                {
                                    status,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Pipelines: non-streaming run detail (poll-once)
                    if (url.pathname === '/api/v1/pipelines/run' && request.method === 'GET') {
                        try {
                            const pipelineId = String(url.searchParams.get('id') || '').trim();
                            const runId = String(url.searchParams.get('runId') || '').trim();
                            if (!pipelineId || !runId) {
                                return new Response(
                                    JSON.stringify({ success: false, error: 'id and runId required' }),
                                    {
                                        status: 400,
                                        headers: {
                                            'Content-Type': 'application/json',
                                            ...corsHeadersForRequest(request),
                                        },
                                    }
                                );
                            }

                            const listRes = await this.executeToolWorkflow('list_pipeline_runs', {
                                id: pipelineId,
                                limit: 25,
                            });
                            const ljson = this.toolWorkflowPayload(listRes, { runs: [] as any[] });
                            const runs = Array.isArray((ljson as any)?.runs) ? (ljson as any).runs : [];
                            const row = runs.find((r: any) => String(r?.id) === runId) || null;

                            return new Response(
                                JSON.stringify({ success: true, data: { pipelineId, runId, run: row } }),
                                {
                                    status: 200,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'run detail failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        }
                    }

                    // Pipelines: status (single pipeline)
                    if (url.pathname === '/api/v1/pipelines/status' && request.method === 'GET') {
                        try {
                            const pipelineId = String(url.searchParams.get('id') || '').trim();
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            }
                            const res = await this.executeToolWorkflow('pipeline_status', {
                                id: pipelineId,
                            });
                            const json = this.toolWorkflowPayload(res, { ok: false, reason: 'parse_error' });
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'status failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        }
                    }

                    // Pipelines: runs (recent)
                    if (url.pathname === '/api/v1/pipelines/runs' && request.method === 'GET') {
                        try {
                            const pipelineId = String(url.searchParams.get('id') || '').trim();
                            const rawLimit = url.searchParams.get('limit') || '10';
                            const parsedLimit = Number(rawLimit);
                            if (!Number.isFinite(parsedLimit)) {
                                throw new CoreError('InvalidParams', 'limit must be a finite number', {
                                    field: 'limit',
                                });
                            }
                            const limit = Math.max(1, Math.min(100, Math.floor(parsedLimit)));
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            }
                            const res = await this.executeToolWorkflow('list_pipeline_runs', {
                                id: pipelineId,
                                limit,
                            });
                            const json = this.toolWorkflowPayload(res, { runs: [] });
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            const status = statusForThrownError(err);
                            return new Response(
                                JSON.stringify({
                                    success: false,
                                    error: isCoreError(err) ? envelopeForThrownError(err) : 'runs failed',
                                }),
                                {
                                    status,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Pipelines: list
                    if (url.pathname === '/api/v1/pipelines' && request.method === 'GET') {
                        try {
                            const res = await this.executeToolWorkflow('list_pipelines', {});
                            const json = this.toolWorkflowPayload(res, { pipelines: [] });
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'list failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        }
                    }

                    // Pipelines: register (dev-only)
                    if (url.pathname === '/api/v1/pipelines' && request.method === 'POST') {
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const id = String(body?.id || '').trim();
                            const name = String(body?.name || '').trim();
                            const components = Array.isArray(body?.components) ? body.components : [];
                            const trigger = String(body?.trigger || '').trim();
                            const schedule = body?.schedule ? String(body.schedule) : undefined;
                            const description = body?.description ? String(body.description) : '';
                            const eventTriggers = Array.isArray(body?.eventTriggers) ? body.eventTriggers : undefined;
                            const enabled = body?.enabled != null ? !!body.enabled : true;

                            if (!id || !name || !components.length || !trigger) {
                                return new Response(
                                    JSON.stringify({ success: false, error: 'id, name, components, trigger required' }),
                                    {
                                        status: 400,
                                        headers: {
                                            'Content-Type': 'application/json',
                                            ...corsHeadersForRequest(request),
                                        },
                                    }
                                );
                            }

                            const lo = (this.coreAnalyzer as any)?.learningOrchestrator;
                            if (!lo || typeof lo.registerPipeline !== 'function') {
                                return new Response(
                                    JSON.stringify({ success: false, error: 'learning orchestrator unavailable' }),
                                    {
                                        status: 500,
                                        headers: {
                                            'Content-Type': 'application/json',
                                            ...corsHeadersForRequest(request),
                                        },
                                    }
                                );
                            }

                            const payload = {
                                id,
                                name,
                                description,
                                components,
                                trigger,
                                schedule,
                                eventTriggers,
                                enabled,
                            };
                            const pid = await lo.registerPipeline(payload);
                            return new Response(JSON.stringify({ success: true, data: { id: pid } }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            const status = statusForThrownError(err);
                            return new Response(
                                JSON.stringify({
                                    success: false,
                                    error: isCoreError(err) ? envelopeForThrownError(err) : 'register failed',
                                }),
                                {
                                    status,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Pipelines: get by id (status/detail)
                    if (url.pathname.startsWith('/api/v1/pipelines/') && request.method === 'GET') {
                        try {
                            const m = url.pathname.match(/^\/api\/v1\/pipelines\/([^/]+)$/);
                            const pipelineId = m && m[1] ? decodeURIComponent(m[1]) : '';
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            }
                            const res = await this.executeToolWorkflow('pipeline_status', {
                                id: pipelineId,
                            });
                            const json = this.toolWorkflowPayload(res, { ok: false, reason: 'parse_error' });
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'get failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        }
                    }

                    // Graph Expand endpoint (HTTP parity with MCP graph_expand)
                    if (url.pathname === '/api/v1/graph-expand' && request.method === 'POST') {
                        const t0 = Date.now();
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const res = await this.executeToolWorkflow('graph_expand', body);

                            if (res?.isError) {
                                try {
                                    recordToolEnd('http', 'graph_expand_fallback', Date.now() - t0, false);
                                } catch {}
                                const error = this.toolWorkflowErrorPayload(res, 'graph_expand failed');
                                const status = statusForCoreErrorCode(error.code);
                                return new Response(JSON.stringify({ success: false, error }), {
                                    status,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            }

                            const payload = this.toolWorkflowPayload(res, res);

                            if (typeof payload?.note === 'string' && payload.note.length) {
                                try {
                                    (this.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.(
                                        'graph_expand_note'
                                    );
                                } catch {}
                                try {
                                    recordToolEnd('http', 'graph_expand_note', 0, true);
                                } catch {}
                            }

                            const backend = payload?.impactSummary?.backend;
                            const metricName =
                                backend === 'fallback' ? 'graph_expand_fallback' : 'graph_expand_primary';
                            try {
                                (this.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.(metricName);
                            } catch {}
                            try {
                                recordToolEnd('http', metricName, Date.now() - t0, true);
                            } catch {}
                            return new Response(JSON.stringify({ success: true, data: payload }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err: any) {
                            try {
                                recordToolEnd('http', 'graph_expand_fallback', Date.now() - t0, false);
                            } catch {}
                            return new Response(
                                JSON.stringify({ success: false, error: envelopeForThrownError(err) }),
                                {
                                    status: statusForThrownError(err),
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Snapshots - list
                    if (url.pathname === '/api/v1/snapshots' && request.method === 'GET') {
                        assertAllowedBrowserOrigin(request, 'HTTP snapshots');
                        const { overlayStore } = await import('../core/overlay-store.js');
                        const snaps = overlayStore.list({ workspaceRoot: this.config.workspaceRoot }).map((s: any) => ({
                            id: s.id,
                            createdAt: s.createdAt,
                            diffCount: s.diffs.length,
                            lastApply: s.lastApply
                                ? { ok: !!s.lastApply.ok, elapsedMs: s.lastApply.elapsedMs, at: s.lastApply.at }
                                : null,
                        }));
                        return new Response(JSON.stringify({ success: true, data: snaps }), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                        });
                    }

                    // Snapshots - diff
                    if (
                        url.pathname.startsWith('/api/v1/snapshots/') &&
                        url.pathname.endsWith('/diff') &&
                        request.method === 'GET'
                    ) {
                        try {
                            assertAllowedBrowserOrigin(request, 'HTTP snapshot diff');
                            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/diff$/);
                            const id = m && m[1];
                            if (!id)
                                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            const { overlayStore } = await import('../core/overlay-store.js');
                            const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
                            const dir = ensure ? await ensure(id, { workspaceRoot: this.config.workspaceRoot }) : null;
                            if (!dir)
                                return new Response(JSON.stringify({ success: false, error: 'Snapshot not found' }), {
                                    status: 404,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            const text = await readSnapshotArtifactText(dir, 'overlay.diff', '');
                            return new Response(JSON.stringify({ success: true, data: { id, diff: text } }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: envelopeForThrownError(err) }),
                                {
                                    status: statusForThrownError(err),
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Snapshots - status (exposes lastApply and touched files)
                    if (
                        url.pathname.startsWith('/api/v1/snapshots/') &&
                        url.pathname.endsWith('/status') &&
                        request.method === 'GET'
                    ) {
                        try {
                            assertAllowedBrowserOrigin(request, 'HTTP snapshot status');
                            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/status$/);
                            const id = m && m[1];
                            if (!id)
                                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            const { overlayStore } = await import('../core/overlay-store.js');
                            const status = (overlayStore as any).getStatus?.(id, {
                                workspaceRoot: this.config.workspaceRoot,
                            });
                            if (!status)
                                return new Response(JSON.stringify({ success: false, error: 'Snapshot not found' }), {
                                    status: 404,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            return new Response(JSON.stringify({ success: true, data: status }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: envelopeForThrownError(err) }),
                                {
                                    status: statusForThrownError(err),
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Snapshots - progress (tail)
                    if (
                        url.pathname.startsWith('/api/v1/snapshots/') &&
                        url.pathname.endsWith('/progress') &&
                        request.method === 'GET'
                    ) {
                        try {
                            assertAllowedBrowserOrigin(request, 'HTTP snapshot progress');
                            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/progress$/);
                            const id = m && m[1];
                            if (!id)
                                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                });
                            const { overlayStore } = await import('../core/overlay-store.js');
                            const snapshotDir =
                                (overlayStore as any).getSnapshotDirectory?.(id, {
                                    workspaceRoot: this.config.workspaceRoot,
                                }) || '';
                            const text = await readSnapshotArtifactText(snapshotDir || undefined, 'progress.log', '');
                            return new Response(JSON.stringify({ success: true, data: { id, progress: text } }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: envelopeForThrownError(err) }),
                                {
                                    status: statusForThrownError(err),
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Snapshots - clean
                    if (url.pathname === '/api/v1/snapshots/clean' && request.method === 'POST') {
                        try {
                            assertAllowedBrowserOrigin(request, 'HTTP snapshots/clean');
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const { overlayStore } = await import('../core/overlay-store.js');
                            const maxKeep = typeof body.maxKeep === 'number' ? body.maxKeep : 10;
                            const days = typeof body.maxAgeDays === 'number' ? body.maxAgeDays : 3;
                            await overlayStore.cleanup(maxKeep, days * 24 * 60 * 60 * 1000, {
                                workspaceRoot: this.config.workspaceRoot,
                            });
                            return new Response(JSON.stringify({ success: true }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: envelopeForThrownError(err) }),
                                {
                                    status: statusForThrownError(err),
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Lightweight learning stats (mirrors adapter API)
                    if (
                        (url.pathname === '/learning-stats' || url.pathname === '/api/v1/learning-stats') &&
                        request.method === 'GET'
                    ) {
                        try {
                            const stats = await (this.coreAnalyzer as any).getStats?.();
                            return new Response(JSON.stringify({ success: true, data: stats || {} }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: 'Failed to get learning stats' }),
                                {
                                    status: 500,
                                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                                }
                            );
                        }
                    }

                    // Convert Bun request to our HTTPRequest format
                    const httpRequest: HTTPRequest = {
                        method: request.method,
                        url: request.url,
                        headers: Object.fromEntries(request.headers.entries()),
                        body: await this.getRequestBody(request),
                        query: this.extractQuery(request.url),
                    };

                    // Handle request through adapter
                    const response = await this.httpAdapter.handleRequest(httpRequest);

                    // Convert back to Response object
                    return new Response(response.body, {
                        status: response.status,
                        headers: response.headers,
                    });
                } catch (error) {
                    if (!isCoreError(error)) {
                        console.error('[HTTP Server] Request failed:', error);
                    }
                    return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(error) }), {
                        status: statusForThrownError(error),
                        headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                    });
                }
            },
        });

        const actual = this.server?.port ?? listenPort;
        this.config.port = actual;
        if (!process.env.SILENT_MODE) {
            console.log(`[HTTP Server] Started at http://${this.config.host}:${actual}`);
            console.log(`[HTTP Server] OpenAPI spec: http://${this.config.host}:${actual}/openapi.json`);
            console.log(`[HTTP Server] Web UI: http://${this.config.host}:${actual}/ui`);
            console.log(`[HTTP Server] Health check: http://${this.config.host}:${actual}/health`);
        }

        // Dev warm-up probe to prime monitoring panels and learning stats with initial datapoints
        try {
            const shouldWarm = process.env.DEV_AUTO_WARMUP === '1' || process.env.NODE_ENV === 'development';
            if (shouldWarm) {
                const proxiedUrl = `http://${this.config.host}:${this.config.port}/api/v1/monitoring`;
                const httpRequest: HTTPRequest = {
                    method: 'GET',
                    url: proxiedUrl,
                    headers: {},
                    body: undefined,
                    query: {},
                };
                this.httpAdapter.handleRequest(httpRequest).catch(() => {});

                const lsUrl = `http://${this.config.host}:${this.config.port}/api/v1/learning-stats`;
                const httpRequest2: HTTPRequest = {
                    method: 'GET',
                    url: lsUrl,
                    headers: {},
                    body: undefined,
                    query: {},
                };
                this.httpAdapter.handleRequest(httpRequest2).catch(() => {});
            }
        } catch {}

        // Subscribe to layer performance to record layer latency histograms
        try {
            const ss: any = (this.coreAnalyzer as any).sharedServices;
            const bus: any = ss?.eventBus;
            bus?.on?.('layer-manager:performance-recorded', (perf: any) => {
                try {
                    recordLayerLatency('http', String(perf?.layer || 'unknown'), Number(perf?.duration || 0));
                } catch {}
            });
        } catch {}
    }

    async stop(): Promise<void> {
        if (this.server) {
            this.server.stop();
            this.server = null;
            if (!process.env.SILENT_MODE) {
                console.log(`[HTTP Server] Stopped`);
            }
        }

        if (this.coreAnalyzer) {
            await this.coreAnalyzer.dispose();
            if (!process.env.SILENT_MODE) {
                console.log(`[HTTP Server] Core analyzer disposed`);
            }
        }

        // Nothing else to clean up
    }

    /**
     * Get server status and diagnostics
     */
    getStatus(): Record<string, any> {
        return {
            running: this.server !== null,
            config: this.config,
            adapter: this.httpAdapter?.getDiagnostics() || null,
            timestamp: Date.now(),
        };
    }

    private contentTypeFor(p: string): string {
        if (p.endsWith('.html')) return 'text/html';
        if (p.endsWith('.js')) return 'application/javascript';
        if (p.endsWith('.css')) return 'text/css';
        if (p.endsWith('.svg')) return 'image/svg+xml';
        if (p.endsWith('.png')) return 'image/png';
        if (p.endsWith('.ico')) return 'image/x-icon';
        return 'application/octet-stream';
    }

    private webUiRoots(): string[] {
        return Array.from(
            new Set([
                path.resolve(HTTP_MODULE_DIR, '../../web-ui'),
                path.resolve(HTTP_MODULE_DIR, '../web-ui'),
                path.resolve(process.cwd(), 'web-ui'),
            ])
        );
    }

    private decodeStaticPath(encodedPath: string): string | null {
        try {
            return decodeURIComponent(encodedPath);
        } catch {
            return null;
        }
    }

    private safeStaticRelativePath(relPath: string): string | null {
        const normalized = path.normalize(relPath);
        if (
            !normalized ||
            path.isAbsolute(normalized) ||
            normalized === '..' ||
            normalized.startsWith(`..${path.sep}`)
        ) {
            return null;
        }
        return normalized;
    }

    private async findWebUiFile(
        relPath: string,
        subdirs: Array<'dist' | null>
    ): Promise<{ filePath: string; file: Buffer } | null> {
        const safeRel = this.safeStaticRelativePath(relPath);
        if (!safeRel) return null;

        for (const root of this.webUiRoots()) {
            for (const subdir of subdirs) {
                const base = subdir ? path.resolve(root, subdir) : root;
                const candidate = path.resolve(base, safeRel);
                const relative = path.relative(base, candidate);
                if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;

                try {
                    const stat = await fs.lstat(candidate);
                    if (!stat.isFile() || stat.isSymbolicLink()) continue;
                    const [realBase, realCandidate] = await Promise.all([fs.realpath(base), fs.realpath(candidate)]);
                    const realRelative = path.relative(realBase, realCandidate);
                    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
                    const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number' ? fsSync.constants.O_NOFOLLOW : 0;
                    const handle = await fs.open(candidate, fsSync.constants.O_RDONLY | noFollow);
                    try {
                        const openedReal = await fs
                            .realpath(`/proc/self/fd/${handle.fd}`)
                            .catch(() => fs.realpath(`/dev/fd/${handle.fd}`));
                        const openedRelative = path.relative(realBase, openedReal);
                        if (!openedRelative || openedRelative.startsWith('..') || path.isAbsolute(openedRelative)) {
                            continue;
                        }
                        return { filePath: candidate, file: await handle.readFile() };
                    } finally {
                        await handle.close().catch(() => undefined);
                    }
                } catch {}
            }
        }

        return null;
    }

    /**
     * Handle Server-Sent Events streaming for real-time search results
     */
    private async handleSSEStream(request: Request, pathname: string): Promise<Response> {
        const body = await request.text();
        let requestData: any;

        try {
            requestData = JSON.parse(body);
        } catch (error) {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }

        // Set up SSE headers
        const headers = new Headers({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...corsHeadersForRequest(request),
            'Access-Control-Allow-Headers': 'Content-Type',
        });

        // Create a readable stream for SSE
        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                const sendSSEMessage = (data: any, eventType = 'data') => {
                    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
                    controller.enqueue(encoder.encode(message));
                };

                try {
                    // Get the layer manager from the core analyzer to access the ClaudeToolsLayer
                    if (pathname.includes('/stream/search')) {
                        await this.handleStreamSearch(requestData, sendSSEMessage, controller);
                    } else if (pathname.includes('/stream/definition')) {
                        await this.handleStreamDefinition(requestData, sendSSEMessage, controller);
                    }
                } catch (error) {
                    sendSSEMessage({ error: 'Stream processing failed', details: String(error) }, 'error');
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, { headers });
    }

    /**
     * Handle streaming search requests
     */
    private async handleStreamSearch(
        requestData: any,
        sendMessage: (data: any, eventType?: string) => void,
        controller: ReadableStreamDefaultController
    ): Promise<void> {
        const { pattern, path = '.', maxResults = 100, timeout = 20000 } = requestData;

        if (!pattern) {
            sendMessage({ error: 'Pattern is required' }, 'error');
            return;
        }

        // Try to get the ClaudeToolsLayer for streaming
        const layerManager = (this.coreAnalyzer as any).layerManager;
        if (layerManager) {
            const claudeLayer = layerManager.getLayer('layer1') as FastSearchLayer;

            if (claudeLayer && claudeLayer.streamSearch) {
                const searchQuery: SearchQuery = {
                    identifier: pattern,
                    searchPath: path,
                    caseSensitive: false,
                    fileTypes: ['typescript', 'javascript'],
                    includeTests: true,
                };

                try {
                    const searchStream = await claudeLayer.streamSearch(searchQuery);

                    let resultCount = 0;

                    searchStream.on('data', (result) => {
                        if (resultCount >= maxResults) {
                            searchStream.cancel();
                            return;
                        }

                        sendMessage({
                            type: 'match',
                            file: result.file,
                            line: result.line,
                            column: result.column,
                            text: result.text,
                            confidence: result.confidence,
                        });

                        resultCount++;
                    });

                    searchStream.on('progress', (progress) => {
                        sendMessage(
                            {
                                type: 'progress',
                                filesSearched: progress.filesSearched,
                                matchesFound: progress.matchesFound,
                                elapsedMs: progress.elapsedMs,
                            },
                            'progress'
                        );
                    });

                    searchStream.on('end', () => {
                        sendMessage({ type: 'complete', totalResults: resultCount }, 'complete');
                    });

                    searchStream.on('error', (error) => {
                        sendMessage({ error: 'Search failed', details: String(error) }, 'error');
                    });

                    // Set timeout
                    setTimeout(() => {
                        searchStream.cancel();
                        sendMessage({ error: 'Search timeout' }, 'error');
                    }, timeout);
                } catch (error) {
                    sendMessage({ error: 'Failed to start stream search', details: String(error) }, 'error');
                }
            } else {
                sendMessage({ error: 'Streaming search not available' }, 'error');
            }
        } else {
            sendMessage({ error: 'Layer manager not available' }, 'error');
        }
    }

    /**
     * Handle streaming definition search
     */
    private async handleStreamDefinition(
        requestData: any,
        sendMessage: (data: any, eventType?: string) => void,
        controller: ReadableStreamDefaultController
    ): Promise<void> {
        const { identifier, file, maxResults = 50, timeout = 15000 } = requestData;

        if (!identifier) {
            sendMessage({ error: 'Identifier is required' }, 'error');
            return;
        }

        // Use regular definition search for now - could be enhanced with streaming later
        try {
            const result = await (this.coreAnalyzer as any).findDefinitionAsync({
                uri: file || 'file://unknown',
                position: { line: 0, character: 0 },
                identifier,
                maxResults,
            });

            // Stream the results one by one to simulate streaming
            for (let i = 0; i < result.data.length; i++) {
                const definition = result.data[i];
                const mapped = definitionToApiResponse(definition);
                sendMessage({
                    type: 'definition',
                    ...mapped,
                    confidence: (definition as any).confidence,
                    layer: (definition as any).layer,
                });

                // Small delay to simulate streaming
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            sendMessage({ type: 'complete', totalResults: result.data.length }, 'complete');
        } catch (error) {
            sendMessage({ error: 'Definition search failed', details: String(error) }, 'error');
        }
    }

    // ===== PRIVATE HELPERS =====

    private async executeToolWorkflow(
        name: string,
        args: Record<string, any>,
        opts: { enforceHttpToolSurface?: boolean } = {}
    ): Promise<SnapshotWorkflowResult> {
        if (opts.enforceHttpToolSurface) this.assertHttpToolAllowed(name, args);
        return this.toolExecutor.execute(this.toolRouter, name, args);
    }

    private assertHttpToolAllowed(name: string, args: Record<string, any>): void {
        assertSharedHttpToolAllowed(name, args, { surface: 'HTTP tools/call surface' });
    }

    private toolWorkflowPayload(result: SnapshotWorkflowResult, fallback: any = {}): any {
        return workflowPayload(result, fallback);
    }

    private toolWorkflowErrorPayload(result: SnapshotWorkflowResult, fallbackMessage: string) {
        return workflowErrorPayload(result, fallbackMessage);
    }

    private normalizeToolWorkflowResultForHttp(result: SnapshotWorkflowResult): any {
        return normalizeWorkflowResult(result);
    }

    private async getRequestBody(request: Request): Promise<string | undefined> {
        return readLimitedJsonBody(request);
    }

    private legacyPipelinesEnabled(): boolean {
        return this.config.enableLegacyPipelines === true || process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES === '1';
    }

    private extractQuery(url: string): Record<string, string> {
        try {
            const parsed = new URL(url);
            const query: Record<string, string> = {};

            for (const [key, value] of parsed.searchParams.entries()) {
                query[key] = value;
            }

            return query;
        } catch (error) {
            return {};
        }
    }
}

// Export for use as singleton
export let httpServer: HTTPServer | null = null;

/**
 * Create and start HTTP server
 */
export async function createHTTPServer(config?: HTTPServerConfig): Promise<HTTPServer> {
    if (httpServer) {
        await httpServer.stop();
    }

    httpServer = new HTTPServer(config);
    return httpServer;
}
// Start server if run directly
if (import.meta.main) {
    const server = new HTTPServer();

    // Handle shutdown
    process.on('SIGINT', async () => {
        if (!process.env.SILENT_MODE) {
            console.log('\n[HTTP Server] Shutting down...');
        }
        await server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
    });

    server.start().catch((error) => {
        console.error('[HTTP Server] Failed to start:', error);
        process.exit(1);
    });
}
