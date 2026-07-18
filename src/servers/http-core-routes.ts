import type { HTTPRequest } from '../adapters/http-adapter.js';
import { strictJsonParse } from '../adapters/utils.js';
import { CoreError, isCoreError } from '../core/errors.js';
import { httpToolDomainOutcomePayload, isHttpToolDomainOutcome } from '../core/workflows/tool-result-normalizer.js';
import { metricsRegistry, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';
import { assertAllowedBrowserOrigin, corsHeadersForRequest } from './http-ingress.js';
import {
    envelopeForThrownError,
    type HTTPRouteContext,
    statusForCoreErrorCode,
    statusForThrownError,
} from './http-route-context.js';
import { contentTypeFor, decodeStaticPath, findWebUiFile } from './http-static-files.js';

export async function handleHTTPCoreRoutes(
    context: HTTPRouteContext,
    request: Request,
    url: URL
): Promise<Response | null> {
    // Serve static web UI from web-ui/dist under /ui; fallback to unbundled web-ui/index.html
    if (url.pathname === '/ui' || url.pathname === '/ui/') {
        const index = await findWebUiFile('index.html', ['dist', null]);
        if (index) {
            return new Response(index.file, { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
        return new Response('Not found', { status: 404 });
    }
    if (url.pathname.startsWith('/ui/')) {
        const rel = decodeStaticPath(url.pathname.replace(/^\/ui\//, ''));
        if (rel === null) return new Response('Bad request', { status: 400 });
        const asset = await findWebUiFile(rel, ['dist']);
        if (!asset) return new Response('Not found', { status: 404 });
        const contentType = contentTypeFor(asset.filePath);
        return new Response(asset.file, {
            status: 200,
            headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
        });
    }

    // Let adapter handle streaming endpoints for now
    // TODO: Implement proper server-level SSE streaming
    // if (url.pathname.includes('/stream/') && request.method === 'POST') {
    //   return await context.handleSSEStream(request, url.pathname);
    // }

    // Small built-in metrics endpoint for Layer 4 storage
    if (url.pathname === '/metrics/l4' && request.method === 'GET') {
        const metrics = (context.coreAnalyzer as any).getLayer4StorageMetrics?.();
        return new Response(JSON.stringify(metrics || { error: 'unavailable' }), {
            status: metrics ? 200 : 503,
            headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
        });
    }

    // Unified /metrics endpoint - supports format=json|prometheus (default)
    if (url.pathname === '/metrics' && request.method === 'GET') {
        const fmt = (url.searchParams.get('format') || 'prometheus').toLowerCase();
        const lm: any = (context.coreAnalyzer as any).layerManager;
        const l1: any = lm?.getLayer?.('layer1');
        const l2: any = lm?.getLayer?.('layer2');
        const l1m = typeof l1?.getMetrics === 'function' ? l1.getMetrics() : null;
        const l2m = typeof l2?.getMetrics === 'function' ? l2.getMetrics() : null;
        const l4 = (context.coreAnalyzer as any).getLayer4StorageMetrics?.();
        const lmAll = typeof lm?.getAllMetrics === 'function' ? lm.getAllMetrics() : null;
        const lmPerf = typeof lm?.getPerformanceReport === 'function' ? lm.getPerformanceReport() : null;

        if (fmt !== 'prometheus') {
            // JSON variant for dashboards: include L4 storage extras for richer panels
            const storageExtras = l4 && (l4 as any).extras ? (l4 as any).extras : {};
            const storageTotals = l4 && (l4 as any).totals ? (l4 as any).totals : { count: 0, errors: 0 };
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
            if (l4?.startedAt) text += `ontology_l4_started_at_seconds ${Math.floor(l4.startedAt / 1000)}\n`;
            text += '# HELP ontology_l4_updated_at_seconds L4 storage metrics last update time.\n';
            text += '# TYPE ontology_l4_updated_at_seconds gauge\n';
            if (l4?.updatedAt) text += `ontology_l4_updated_at_seconds ${Math.floor(l4.updatedAt / 1000)}\n`;
            if (l4?.operations) {
                for (const [op, s] of Object.entries(l4.operations)) {
                    if (!s || !(s as any).count) continue;
                    text += `# HELP ontology_l4_operation_count Total operations per op.\n`;
                    text += '# TYPE ontology_l4_operation_count counter\n';
                    text += `ontology_l4_operation_count{op="${op}"} ${(s as any).count}\n`;
                    text += `# HELP ontology_l4_operation_errors Total errors per op.\n`;
                    text += '# TYPE ontology_l4_operation_errors counter\n';
                    text += `ontology_l4_operation_errors{op="${op}"} ${(s as any).errors}\n`;
                    text += '# HELP ontology_l4_operation_duration_ms Quantiles of op duration in ms.\n';
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
            text = `${coreMetrics}\n${text}`;
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
            query: context.extractQuery(proxiedUrl),
        };
        const resp = await context.httpAdapter.handleRequest(httpRequest);
        return new Response(resp.body, { status: resp.status, headers: resp.headers });
    }

    // AST Query endpoint
    if (url.pathname === '/api/v1/ast-query' && request.method === 'POST') {
        try {
            const raw = await context.getRequestBody(request);
            const body: any = strictJsonParse(raw || '{}');
            const { runAstQuery } = await import('../core/ast-query.js');
            const out = await runAstQuery({
                language: body.language,
                query: body.query,
                paths: body.paths,
                glob: body.glob,
                limit: body.limit,
                workspaceRoot: context.config.workspaceRoot,
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
            const raw = await context.getRequestBody(request);
            const body: any = strictJsonParse(raw || '{}');
            const name = String(body?.name || '').trim();
            const hasArguments = Object.hasOwn(body || {}, 'arguments');
            if (
                hasArguments &&
                (!body?.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments))
            ) {
                throw new CoreError('InvalidParams', 'Tool arguments must be an object');
            }
            const args = hasArguments ? (body.arguments as Record<string, any>) : {};
            if (!name) {
                throw new CoreError('InvalidParams', 'Missing tool name');
            }

            const t0 = Date.now();
            recordToolStart('http');
            const toolResult = await context.executeToolWorkflow(name, args, {
                enforceHttpToolSurface: true,
            });
            // Record tool call in monitoring (if enabled)
            try {
                const mon = (context.coreAnalyzer as any)?.sharedServices?.monitoring;
                if (mon && typeof mon.recordToolCall === 'function') mon.recordToolCall(name);
            } catch {}

            const normalized = context.normalizeToolWorkflowResultForHttp(toolResult);
            const explicitToolError = !!toolResult?.isError;
            const isDomainOutcome = explicitToolError && isHttpToolDomainOutcome(name, normalized);
            // A parsed tool payload may legitimately contain ok:false as domain state
            // (for example guarded apply refused or checks failed). Treat only explicit
            // core workflow error flags as HTTP tool-call failures unless the Alpha contract
            // defines the refusal as a recoverable domain outcome.
            const isError = explicitToolError && !isDomainOutcome;
            recordToolEnd('http', name, Date.now() - t0, !isError);
            const errCode = isError ? (normalized as any)?.error?.code : undefined;
            const status = isError ? statusForCoreErrorCode(errCode, 400) : 200;
            return new Response(
                JSON.stringify({
                    success: !isError,
                    result: explicitToolError
                        ? isDomainOutcome
                            ? httpToolDomainOutcomePayload(normalized)
                            : undefined
                        : normalized,
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
        } catch (err) {
            try {
                recordToolEnd('http', 'unknown', 0, false);
            } catch {}
            return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(err) }), {
                status: statusForThrownError(err),
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    return null;
}
