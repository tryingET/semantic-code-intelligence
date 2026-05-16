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

import { serve } from 'bun';
import { HTTPAdapter, type HTTPRequest } from '../adapters/http-adapter.js';
import { MCPAdapter } from '../adapters/mcp-adapter.js';
import { createDefaultCoreConfig, definitionToApiResponse, strictJsonParse } from '../adapters/utils.js';
import { getEnvironmentConfig, type ServerConfig } from '../core/config/server-config.js';
import { CoreError, isCoreError } from '../core/errors.js';
import { createCodeAnalyzer } from '../core/index';
import { ToolExecutor } from '../core/tools/executor.js';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { metricsRegistry, recordLayerLatency, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';
import type { FastSearchLayer } from '../layers/layer1-fast-search.js';
import type { SearchQuery } from '../types/core.js';

interface HTTPServerConfig {
    port?: number;
    host?: string;
    workspaceRoot?: string;
    enableCors?: boolean;
    enableOpenAPI?: boolean;
}

export class HTTPServer {
    private coreAnalyzer!: CodeAnalyzer;
    private httpAdapter!: HTTPAdapter;
    private config: HTTPServerConfig;
    private serverConfig: ServerConfig;
    private server: any = null;
    // No external port registry; honor env or defaults

    constructor(config: HTTPServerConfig = {}) {
        this.serverConfig = getEnvironmentConfig();
        this.config = {
            port: config.port ?? this.serverConfig.ports.httpAPI,
            host: config.host ?? this.serverConfig.host,
            workspaceRoot: config.workspaceRoot ?? process.cwd(),
            enableCors: config.enableCors ?? true,
            enableOpenAPI: config.enableOpenAPI ?? true,
            ...config,
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

        // Create HTTP adapter
        this.httpAdapter = new HTTPAdapter(this.coreAnalyzer, {
            enableCors: this.config.enableCors,
            enableOpenAPI: this.config.enableOpenAPI,
            maxResults: 100,
            timeout: 30000,
        });

        if (!process.env.SILENT_MODE) {
            console.log(`[HTTP Server] Core analyzer and HTTP adapter initialized`);
        }
    }

    async start(): Promise<void> {
        if (!this.coreAnalyzer || !this.httpAdapter) {
            await this.initialize();
        }

        // Determine port: prefer config port if explicitly set, else HTTP_API_PORT env, else 7000
        const listenPort = Number(this.config.port || process.env.HTTP_API_PORT || 7000);

        this.server = serve({
            hostname: this.config.host,
            port: listenPort,
            fetch: async (request) => {
                try {
                    const url = new URL(request.url);

                    // Serve static web UI from web-ui/dist under /ui; fallback to unbundled web-ui/index.html
                    if (url.pathname === '/ui' || url.pathname === '/ui/') {
                        const dist = Bun.file('web-ui/dist/index.html');
                        if (await dist.exists()) {
                            return new Response(dist, { status: 200, headers: { 'Content-Type': 'text/html' } });
                        }
                        const fallback = Bun.file('web-ui/index.html');
                        if (await fallback.exists()) {
                            return new Response(fallback, { status: 200, headers: { 'Content-Type': 'text/html' } });
                        }
                        return new Response('Not found', { status: 404 });
                    }
                    if (url.pathname.startsWith('/ui/')) {
                        const rel = url.pathname.replace(/^\/ui\//, '');
                        const filePath = `web-ui/dist/${rel}`;
                        const contentType = this.contentTypeFor(filePath);
                        return await this.serveStaticFile(filePath, contentType);
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
                            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
                                    status: l4 || l1m || l2m ? 200 : 503,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
                            const body: any = raw ? JSON.parse(raw) : {};
                            const { runAstQuery } = await import('../core/ast-query.js');
                            const out = await runAstQuery({
                                language: body.language,
                                query: body.query,
                                paths: body.paths,
                                glob: body.glob,
                                limit: body.limit,
                            });
                            return new Response(JSON.stringify({ success: true, data: out }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'AST query failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
                        }
                    }

                    // Generic Tools endpoint (HTTP parity with MCP tools)
                    if (url.pathname === '/api/v1/tools/call' && request.method === 'POST') {
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = strictJsonParse(raw || '{}');
                            const name = String(body?.name || '').trim();
                            const args =
                                body?.arguments && typeof body.arguments === 'object'
                                    ? (body.arguments as Record<string, any>)
                                    : {};
                            if (!name) {
                                throw new CoreError('InvalidParams', 'Missing tool name');
                            }

                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            const t0 = Date.now();
                            recordToolStart('http');
                            const mcpResult: any = await executor.execute(mcpAdapter as any, name, args);
                            // Record tool call in monitoring (if enabled)
                            try {
                                const mon = (this.coreAnalyzer as any)?.sharedServices?.monitoring;
                                if (mon && typeof mon.recordToolCall === 'function') mon.recordToolCall(name);
                            } catch {}

                            // Normalize/unwrap MCP result to a stable JSON shape for HTTP clients
                            const unwrap = (res: any) => {
                                try {
                                    // If MCP returned an explicit error shape, surface it via success:false
                                    if (res && typeof res === 'object' && (res.error === true || res.isError)) {
                                        const code = (res as any)?.error?.code;
                                        const data = (res as any)?.error?.data;
                                        const msg = (() => {
                                            if (typeof res.message === 'string') return res.message;
                                            const txt = res?.content?.[0]?.text;
                                            if (typeof txt === 'string') return txt.slice(0, 2000);
                                            return 'Tool execution failed';
                                        })();
                                        return { ok: false, error: { code, message: msg, data } };
                                    }

                                    // Try to parse content[0].text as JSON when present
                                    const txt = res?.content?.[0]?.text;
                                    if (typeof txt === 'string') {
                                        try {
                                            return JSON.parse(txt);
                                        } catch {
                                            // Fallback to passthrough text
                                            return { ok: true, content: txt };
                                        }
                                    }
                                    // If adapter already returned a plain object result, pass it through
                                    if (res && typeof res === 'object') return res;
                                    // Primitive fallback
                                    return { ok: true, value: res };
                                } catch {
                                    return { ok: false, error: { message: 'Failed to normalize tool result' } };
                                }
                            };

                            const normalized = unwrap(mcpResult);
                            const success = !(normalized && typeof normalized === 'object' && normalized.ok === false);
                            recordToolEnd('http', name, Date.now() - t0, success);
                            const isError = !!(normalized && typeof normalized === 'object' && normalized.ok === false);
                            const errCode = isError ? (normalized as any)?.error?.code : undefined;
                            const status = isError
                                ? errCode === 'UnknownTool'
                                    ? 404
                                    : errCode === 'InvalidParams'
                                      ? 400
                                      : errCode === 'Internal'
                                        ? 500
                                        : 400
                                : 200;
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
                                        'Access-Control-Allow-Origin': '*',
                                    },
                                }
                            );
                        } catch (err: any) {
                            try {
                                recordToolEnd('http', 'unknown', 0, false);
                            } catch {}
                            const message = err?.message || String(err || 'tool call failed');
                            const status = isCoreError(err)
                                ? err.code === 'InvalidParams'
                                    ? 400
                                    : err.code === 'UnknownTool'
                                      ? 404
                                      : 500
                                : 500;
                            const code = isCoreError(err) ? err.code : 'Internal';
                            const data = isCoreError(err) ? err.data : undefined;
                            return new Response(JSON.stringify({ success: false, error: { code, message, data } }), {
                                status,
                                headers: { 'Content-Type': 'application/json' },
                            });
                        }
                    }

                    // Pipelines: run with streamable HTTP tail (NDJSON)
                    if (url.pathname === '/api/v1/pipelines/run-stream' && request.method === 'POST') {
                        const encoder = new TextEncoder();
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = raw ? JSON.parse(raw) : {};
                            const pipelineId = String(body?.id || '').trim();
                            const pollMs = Math.max(100, Math.min(2000, Number(body?.pollMs || 300)));
                            const timeoutSec = Math.max(1, Math.min(600, Number(body?.timeoutSec || 30)));
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
                            }

                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            // Kick off the pipeline run
                            const runRes = await executor.execute(mcpAdapter as any, 'run_pipeline', {
                                id: pipelineId,
                            });
                            const txt = (() => {
                                try {
                                    return runRes?.content?.[0]?.text ?? '';
                                } catch {
                                    return '';
                                }
                            })();
                            const runJson = (() => {
                                try {
                                    return JSON.parse(txt);
                                } catch {
                                    return {};
                                }
                            })();
                            const runId = String(runJson?.runId || '').trim();
                            if (!runId) {
                                return new Response(JSON.stringify({ error: 'failed to start pipeline' }), {
                                    status: 500,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
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
                                            const listRes = await executor.execute(
                                                mcpAdapter as any,
                                                'list_pipeline_runs',
                                                {
                                                    id: pipelineId,
                                                    limit: 10,
                                                }
                                            );
                                            const ltxt = (() => {
                                                try {
                                                    return listRes?.content?.[0]?.text ?? '';
                                                } catch {
                                                    return '';
                                                }
                                            })();
                                            const ljson = (() => {
                                                try {
                                                    return JSON.parse(ltxt);
                                                } catch {
                                                    return { runs: [] };
                                                }
                                            })();
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
                                    'Access-Control-Allow-Origin': '*',
                                },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'run-stream failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
                        }
                    }

                    // Pipelines: non-streaming run start (immediate)
                    if (url.pathname === '/api/v1/pipelines/run' && request.method === 'POST') {
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = raw ? JSON.parse(raw) : {};
                            const pipelineId = String(body?.id || '').trim();
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
                            }
                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            const runRes = await executor.execute(mcpAdapter as any, 'run_pipeline', {
                                id: pipelineId,
                            });
                            const txt = (() => {
                                try {
                                    return (runRes as any)?.content?.[0]?.text ?? '';
                                } catch {
                                    return '';
                                }
                            })();
                            const json = (() => {
                                try {
                                    return JSON.parse(txt);
                                } catch {
                                    return { ok: false, runId: '', reason: 'parse_error' };
                                }
                            })();
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'run failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
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
                                            'Access-Control-Allow-Origin': '*',
                                        },
                                    }
                                );
                            }

                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            const listRes = await executor.execute(mcpAdapter as any, 'list_pipeline_runs', {
                                id: pipelineId,
                                limit: 25,
                            });
                            const ltxt = (() => {
                                try {
                                    return (listRes as any)?.content?.[0]?.text ?? '';
                                } catch {
                                    return '';
                                }
                            })();
                            const ljson = (() => {
                                try {
                                    return JSON.parse(ltxt);
                                } catch {
                                    return { runs: [] as any[] };
                                }
                            })();
                            const runs = Array.isArray((ljson as any)?.runs) ? (ljson as any).runs : [];
                            const row = runs.find((r: any) => String(r?.id) === runId) || null;

                            return new Response(
                                JSON.stringify({ success: true, data: { pipelineId, runId, run: row } }),
                                {
                                    status: 200,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                }
                            );
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'run detail failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
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
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
                            }
                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            const res = await executor.execute(mcpAdapter as any, 'pipeline_status', {
                                id: pipelineId,
                            });
                            const txt = (() => {
                                try {
                                    return (res as any)?.content?.[0]?.text ?? '';
                                } catch {
                                    return '';
                                }
                            })();
                            const json = (() => {
                                try {
                                    return JSON.parse(txt);
                                } catch {
                                    return { ok: false, reason: 'parse_error' };
                                }
                            })();
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'status failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
                        }
                    }

                    // Pipelines: runs (recent)
                    if (url.pathname === '/api/v1/pipelines/runs' && request.method === 'GET') {
                        try {
                            const pipelineId = String(url.searchParams.get('id') || '').trim();
                            const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || '10')));
                            if (!pipelineId) {
                                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
                            }
                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            const res = await executor.execute(mcpAdapter as any, 'list_pipeline_runs', {
                                id: pipelineId,
                                limit,
                            });
                            const txt = (() => {
                                try {
                                    return (res as any)?.content?.[0]?.text ?? '';
                                } catch {
                                    return '';
                                }
                            })();
                            const json = (() => {
                                try {
                                    return JSON.parse(txt);
                                } catch {
                                    return { runs: [] };
                                }
                            })();
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'runs failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
                        }
                    }

                    // Pipelines: list
                    if (url.pathname === '/api/v1/pipelines' && request.method === 'GET') {
                        try {
                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            const res = await executor.execute(mcpAdapter as any, 'list_pipelines', {});
                            const txt = (() => {
                                try {
                                    return (res as any)?.content?.[0]?.text ?? '';
                                } catch {
                                    return '';
                                }
                            })();
                            const json = (() => {
                                try {
                                    return JSON.parse(txt);
                                } catch {
                                    return { pipelines: [] };
                                }
                            })();
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'list failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
                        }
                    }

                    // Pipelines: register (dev-only)
                    if (url.pathname === '/api/v1/pipelines' && request.method === 'POST') {
                        try {
                            const raw = await this.getRequestBody(request);
                            const body: any = raw ? JSON.parse(raw) : {};
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
                                            'Access-Control-Allow-Origin': '*',
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
                                        headers: { 'Content-Type': 'application/json' },
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
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'register failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
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
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
                            }
                            const mcpAdapter = new MCPAdapter(this.coreAnalyzer);
                            const executor = new ToolExecutor();
                            const res = await executor.execute(mcpAdapter as any, 'pipeline_status', {
                                id: pipelineId,
                            });
                            const txt = (() => {
                                try {
                                    return (res as any)?.content?.[0]?.text ?? '';
                                } catch {
                                    return '';
                                }
                            })();
                            const json = (() => {
                                try {
                                    return JSON.parse(txt);
                                } catch {
                                    return { ok: false, reason: 'parse_error' };
                                }
                            })();
                            return new Response(JSON.stringify({ success: true, data: json }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, error: 'get failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
                        }
                    }

                    // Graph Expand endpoint (graceful fallback)
                    if (url.pathname === '/api/v1/graph-expand' && request.method === 'POST') {
                        const raw = await this.getRequestBody(request);
                        const body: any = raw ? JSON.parse(raw) : {};
                        const edges: string[] =
                            Array.isArray(body.edges) && body.edges.length ? body.edges : ['imports', 'exports'];
	                        try {
	                            const { expandNeighbors } = await import('../core/code-graph.js');
	                            const t0 = Date.now();
		                            const out = await expandNeighbors({
		                                file: body.file,
		                                symbol: body.symbol,
		                                edges,
		                                depth: body.depth,
		                                limit: body.limit,
		                            });
		                            const payload = { schemaVersion: 2, ...out };
                                    // Note incidence metric: returned a note/warning (best-effort / partial results)
                                    if (typeof (payload as any)?.note === 'string' && String((payload as any).note).length) {
                                        try {
                                            (this.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.(
                                                'graph_expand_note'
                                            );
                                        } catch {}
                                        try {
                                            recordToolEnd('http', 'graph_expand_note', 0, true);
                                        } catch {}
                                    }
		                            // Record primary-path usage in monitoring counters (minimal)
		                            try {
		                                (this.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.(
		                                    'graph_expand_primary'
	                                );
                            } catch {}
                            try {
                                recordToolEnd('http', 'graph_expand_primary', Date.now() - t0, true);
                            } catch {}
	                            return new Response(JSON.stringify({ success: true, data: payload }), {
	                                status: 200,
	                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
	                            });
	                        } catch (err) {
                            // Record fallback usage in monitoring counters (minimal)
                            try {
                                (this.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.(
                                    'graph_expand_fallback'
                                );
                            } catch {}
                            try {
                                recordToolEnd('http', 'graph_expand_fallback', 0, true);
                            } catch {}
                            // Fallback: never 500 — AST-only import/export extraction if possible, else regex; return empty neighbors if none
                            const neighbors: Record<string, any[]> = {
                                imports: [],
                                exports: [],
                                callers: [],
                                callees: [],
                            };
                            let note = 'fallback: graph expand unavailable; returning empty neighbors';
                            let astTried = false;
                            // Try AST-only extraction for TS/JS if file path is provided
                            try {
                                if (typeof body.file === 'string') {
                                    const abs = body.file as string;
                                    const lower = abs.toLowerCase();
                                    let language: 'typescript' | 'javascript' | 'python' | null = null;
                                    if (/\.(ts|tsx)$/.test(lower)) language = 'typescript';
                                    else if (/\.(js|jsx)$/.test(lower)) language = 'javascript';
                                    if (language) {
                                        const { runAstQuery } = await import('../core/ast-query.js');
                                        const query = `
                                            (import_statement) @ast.import
                                            (export_statement) @ast.export
                                        `;
                                        const res: any = await runAstQuery({
                                            language,
                                            query,
                                            paths: [abs],
                                            limit: 2000,
                                        });
                                        astTried = true;
                                        if (Array.isArray(res?.results) && res.results.length > 0) {
                                            for (const r of res.results) {
                                                const cap = String(r.capture || '');
                                                const item = {
                                                    capture: cap,
                                                    text: r.snippet || '',
                                                    start: r.start,
                                                    end: r.end,
                                                };
                                                if (cap.includes('import') && edges.includes('imports'))
                                                    neighbors.imports.push(item);
                                                if (cap.includes('export') && edges.includes('exports'))
                                                    neighbors.exports.push(item);
                                            }
                                        }
                                    }
                                }
                            } catch {
                                // ignore AST fallback errors
                            }

                            // If AST path didn't yield anything, fall back to simple regex scan of the file
                            if (
                                neighbors.imports.length + neighbors.exports.length === 0 &&
                                typeof body.file === 'string'
                            ) {
                                try {
                                    const f = Bun.file(body.file);
                                    if (await f.exists()) {
                                        const text = await f.text();
                                        const lines = text.split(/\r?\n/);
                                        if (edges.includes('imports')) {
                                            const impRe = /^(\s*)(import\s+[^;]+;?)/;
                                            for (let i = 0; i < lines.length; i++) {
                                                const m = impRe.exec(lines[i]);
                                                if (m)
                                                    neighbors.imports.push({
                                                        capture: 'fallback.import',
                                                        text: m[2],
                                                        start: { line: i, column: 0 },
                                                        end: { line: i, column: lines[i].length },
                                                    });
                                            }
                                        }
                                        if (edges.includes('exports')) {
                                            const expRe = /^(\s*)(export\s+[^;{]+|export\s+\{[^}]*\})/;
                                            for (let i = 0; i < lines.length; i++) {
                                                const m = expRe.exec(lines[i]);
                                                if (m)
                                                    neighbors.exports.push({
                                                        capture: 'fallback.export',
                                                        text: m[2],
                                                        start: { line: i, column: 0 },
                                                        end: { line: i, column: lines[i].length },
                                                    });
                                            }
                                        }
                                    }
                                } catch {}
                            }

                            // Build note reflecting which fallback path was used
		                            if (astTried) {
		                                note = 'fallback: graph expand unavailable; AST-only imports/exports used (or empty)';
		                            }
		                            const data = body.file
		                                ? { schemaVersion: 2, file: body.file, neighbors, note }
		                                : { schemaVersion: 2, symbol: String(body.symbol || ''), neighbors, note };
                                    // Note incidence metric: fallback always includes a note describing what happened
                                    try {
                                        (this.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.(
                                            'graph_expand_note'
                                        );
                                    } catch {}
                                    try {
                                        recordToolEnd('http', 'graph_expand_note', 0, true);
                                    } catch {}
		                            return new Response(JSON.stringify({ success: true, data }), {
		                                status: 200,
		                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
		                            });
		                        }
		                    }

                    // Snapshots - list
                    if (url.pathname === '/api/v1/snapshots' && request.method === 'GET') {
                        const { overlayStore } = await import('../core/overlay-store.js');
                        const snaps = overlayStore.list().map((s: any) => ({
                            id: s.id,
                            createdAt: s.createdAt,
                            diffCount: s.diffs.length,
                            lastApply: s.lastApply
                                ? { ok: !!s.lastApply.ok, elapsedMs: s.lastApply.elapsedMs, at: s.lastApply.at }
                                : null,
                        }));
                        return new Response(JSON.stringify({ success: true, data: snaps }), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                        });
                    }

                    // Snapshots - diff
                    if (
                        url.pathname.startsWith('/api/v1/snapshots/') &&
                        url.pathname.endsWith('/diff') &&
                        request.method === 'GET'
                    ) {
                        try {
                            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/diff$/);
                            const id = m && m[1];
                            if (!id)
                                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json' },
                                });
                            const { overlayStore } = await import('../core/overlay-store.js');
                            const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
                            const dir = ensure ? await ensure(id) : null;
                            if (!dir)
                                return new Response(JSON.stringify({ success: false, error: 'Snapshot not found' }), {
                                    status: 404,
                                    headers: { 'Content-Type': 'application/json' },
                                });
                            const diffPath = `${dir}/overlay.diff`;
                            const file = Bun.file(diffPath);
                            if (!(await file.exists())) {
                                return new Response(JSON.stringify({ success: true, data: { id, diff: '' } }), {
                                    status: 200,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
                            }
                            const text = await file.text();
                            return new Response(JSON.stringify({ success: true, data: { id, diff: text } }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: 'Failed to read snapshot diff' }),
                                { status: 500, headers: { 'Content-Type': 'application/json' } }
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
                            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/status$/);
                            const id = m && m[1];
                            if (!id)
                                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json' },
                                });
                            const { overlayStore } = await import('../core/overlay-store.js');
                            const status = (overlayStore as any).getStatus?.(id);
                            if (!status)
                                return new Response(JSON.stringify({ success: false, error: 'Snapshot not found' }), {
                                    status: 404,
                                    headers: { 'Content-Type': 'application/json' },
                                });
                            return new Response(JSON.stringify({ success: true, data: status }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: 'Failed to read snapshot status' }),
                                {
                                    status: 500,
                                    headers: { 'Content-Type': 'application/json' },
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
                            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/progress$/);
                            const id = m && m[1];
                            if (!id)
                                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                                    status: 400,
                                    headers: { 'Content-Type': 'application/json' },
                                });
                            const snapsRoot = '.ontology/snapshots';
                            const file = Bun.file(`${snapsRoot}/${id}/progress.log`);
                            if (!(await file.exists())) {
                                return new Response(JSON.stringify({ success: true, data: { id, progress: '' } }), {
                                    status: 200,
                                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                });
                            }
                            const text = await file.text();
                            return new Response(JSON.stringify({ success: true, data: { id, progress: text } }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: 'Failed to read snapshot progress' }),
                                {
                                    status: 500,
                                    headers: { 'Content-Type': 'application/json' },
                                }
                            );
                        }
                    }

                    // Snapshots - clean
                    if (url.pathname === '/api/v1/snapshots/clean' && request.method === 'POST') {
                        try {
                            const body = await this.getRequestBody(request);
                            const { overlayStore } = await import('../core/overlay-store.js');
                            const maxKeep = typeof body.maxKeep === 'number' ? body.maxKeep : 10;
                            const days = typeof body.maxAgeDays === 'number' ? body.maxAgeDays : 3;
                            await overlayStore.cleanup(maxKeep, days * 24 * 60 * 60 * 1000);
                            return new Response(JSON.stringify({ success: true }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch {
                            return new Response(JSON.stringify({ success: false, error: 'Cleanup failed' }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' },
                            });
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
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            });
                        } catch (err) {
                            return new Response(
                                JSON.stringify({ success: false, error: 'Failed to get learning stats' }),
                                {
                                    status: 500,
                                    headers: { 'Content-Type': 'application/json' },
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
                    console.error('[HTTP Server] Request failed:', error);
                    return new Response(
                        JSON.stringify({
                            success: false,
                            error: 'Internal server error',
                            message: error instanceof Error ? error.message : String(error),
                        }),
                        {
                            status: 500,
                            headers: { 'Content-Type': 'application/json' },
                        }
                    );
                }
            },
        });

        const actual = this.server?.port ?? listenPort;
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

    private async serveStaticFile(relPath: string, contentType: string): Promise<Response> {
        try {
            const file = Bun.file(relPath);
            if (!(await file.exists())) return new Response('Not found', { status: 404 });
            return new Response(file, {
                status: 200,
                headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
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
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Set up SSE headers
        const headers = new Headers({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
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

    private async getRequestBody(request: Request): Promise<string | undefined> {
        if (request.method === 'GET' || request.method === 'HEAD') {
            return undefined;
        }

        try {
            const contentType = request.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                return await request.text();
            }
            return undefined;
        } catch (error) {
            console.warn('[HTTP Server] Failed to read request body:', error);
            return undefined;
        }
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
