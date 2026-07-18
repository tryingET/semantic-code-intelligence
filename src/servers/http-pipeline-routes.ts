import { strictJsonParse } from '../adapters/utils.js';
import { CoreError, isCoreError } from '../core/errors.js';
import { corsHeadersForRequest } from './http-ingress.js';
import { envelopeForThrownError, type HTTPRouteContext, statusForThrownError } from './http-route-context.js';

export async function handleHTTPPipelineRoutes(
    context: HTTPRouteContext,
    request: Request,
    url: URL
): Promise<Response | null> {
    if (url.pathname.startsWith('/api/v1/pipelines') && !context.legacyPipelinesEnabled()) {
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
            const raw = await context.getRequestBody(request);
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

            const learningOrchestrator = (context.coreAnalyzer as any)?.learningOrchestrator;
            if (!learningOrchestrator || typeof learningOrchestrator.startPipelineRun !== 'function') {
                return new Response(JSON.stringify({ success: false, error: 'learning orchestrator unavailable' }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeadersForRequest(request),
                    },
                });
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
                        controller.enqueue(encoder.encode(`${JSON.stringify(begun)}\n`));
                    } catch {}
                    const t0 = Date.now();
                    let lastStatus = '';
                    // Poll for status using list_pipeline_runs (filter by runId)
                    while (true) {
                        try {
                            const listRes = await context.executeToolWorkflow('list_pipeline_runs', {
                                id: pipelineId,
                                limit: 10,
                            });
                            const ljson = context.toolWorkflowPayload(listRes, { runs: [] });
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
                                        controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
                                    } catch {}
                                }
                                if (finished) {
                                    const ev = { event: 'finished', runId, status, t: Date.now() };
                                    try {
                                        controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
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
                                controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
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
            const raw = await context.getRequestBody(request);
            const body: any = strictJsonParse(raw || '{}');
            const pipelineId = String(body?.id || '').trim();
            if (!pipelineId) {
                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                });
            }
            const runRes = await context.executeToolWorkflow('run_pipeline', {
                id: pipelineId,
            });
            const json = context.toolWorkflowPayload(runRes, {
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
                return new Response(JSON.stringify({ success: false, error: 'id and runId required' }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeadersForRequest(request),
                    },
                });
            }

            const listRes = await context.executeToolWorkflow('list_pipeline_runs', {
                id: pipelineId,
                limit: 25,
            });
            const ljson = context.toolWorkflowPayload(listRes, { runs: [] as any[] });
            const runs = Array.isArray((ljson as any)?.runs) ? (ljson as any).runs : [];
            const row = runs.find((r: any) => String(r?.id) === runId) || null;

            return new Response(JSON.stringify({ success: true, data: { pipelineId, runId, run: row } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch {
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
            const res = await context.executeToolWorkflow('pipeline_status', {
                id: pipelineId,
            });
            const json = context.toolWorkflowPayload(res, { ok: false, reason: 'parse_error' });
            return new Response(JSON.stringify({ success: true, data: json }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch {
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
            const res = await context.executeToolWorkflow('list_pipeline_runs', {
                id: pipelineId,
                limit,
            });
            const json = context.toolWorkflowPayload(res, { runs: [] });
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
            const res = await context.executeToolWorkflow('list_pipelines', {});
            const json = context.toolWorkflowPayload(res, { pipelines: [] });
            return new Response(JSON.stringify({ success: true, data: json }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch {
            return new Response(JSON.stringify({ success: false, error: 'list failed' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    // Pipelines: register (dev-only)
    if (url.pathname === '/api/v1/pipelines' && request.method === 'POST') {
        try {
            const raw = await context.getRequestBody(request);
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

            const lo = (context.coreAnalyzer as any)?.learningOrchestrator;
            if (!lo || typeof lo.registerPipeline !== 'function') {
                return new Response(JSON.stringify({ success: false, error: 'learning orchestrator unavailable' }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeadersForRequest(request),
                    },
                });
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
            const pipelineId = m?.[1] ? decodeURIComponent(m[1]) : '';
            if (!pipelineId) {
                return new Response(JSON.stringify({ success: false, error: 'id required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                });
            }
            const res = await context.executeToolWorkflow('pipeline_status', {
                id: pipelineId,
            });
            const json = context.toolWorkflowPayload(res, { ok: false, reason: 'parse_error' });
            return new Response(JSON.stringify({ success: true, data: json }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch {
            return new Response(JSON.stringify({ success: false, error: 'get failed' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    return null;
}
