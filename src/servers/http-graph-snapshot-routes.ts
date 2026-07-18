import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { strictJsonParse } from '../adapters/utils.js';
import { recordToolEnd } from '../instrumentation/metrics.js';
import { assertAllowedBrowserOrigin, corsHeadersForRequest } from './http-ingress.js';
import {
    envelopeForThrownError,
    type HTTPRouteContext,
    statusForCoreErrorCode,
    statusForThrownError,
} from './http-route-context.js';

const SNAPSHOT_ARTIFACT_MAX_BYTES = 256 * 1024;

function truncateBufferUtf8WithMarker(buffer: Buffer, bytesRead: number, maxBytes: number): string {
    const marker = `
[truncated at ${maxBytes} bytes]
`;
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

export async function handleHTTPGraphSnapshotRoutes(
    context: HTTPRouteContext,
    request: Request,
    url: URL
): Promise<Response | null> {
    // Graph Expand endpoint (HTTP parity with MCP graph_expand)
    if (url.pathname === '/api/v1/graph-expand' && request.method === 'POST') {
        const t0 = Date.now();
        try {
            const raw = await context.getRequestBody(request);
            const body: any = strictJsonParse(raw || '{}');
            const res = await context.executeToolWorkflow('graph_expand', body);

            if (res?.isError) {
                try {
                    recordToolEnd('http', 'graph_expand_fallback', Date.now() - t0, false);
                } catch {}
                const error = context.toolWorkflowErrorPayload(res, 'graph_expand failed');
                const status = statusForCoreErrorCode(error.code);
                return new Response(JSON.stringify({ success: false, error }), {
                    status,
                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                });
            }

            const payload = context.toolWorkflowPayload(res, res);

            if (typeof payload?.note === 'string' && payload.note.length) {
                try {
                    (context.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.('graph_expand_note');
                } catch {}
                try {
                    recordToolEnd('http', 'graph_expand_note', 0, true);
                } catch {}
            }

            const backend = payload?.impactSummary?.backend;
            const metricName = backend === 'fallback' ? 'graph_expand_fallback' : 'graph_expand_primary';
            try {
                (context.coreAnalyzer as any)?.sharedServices?.monitoring?.recordToolCall?.(metricName);
            } catch {}
            try {
                recordToolEnd('http', metricName, Date.now() - t0, true);
            } catch {}
            return new Response(JSON.stringify({ success: true, data: payload }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch (err) {
            try {
                recordToolEnd('http', 'graph_expand_fallback', Date.now() - t0, false);
            } catch {}
            return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(err) }), {
                status: statusForThrownError(err),
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    // Snapshots - list
    if (url.pathname === '/api/v1/snapshots' && request.method === 'GET') {
        assertAllowedBrowserOrigin(request, 'HTTP snapshots');
        const { overlayStore } = await import('../core/overlay-store.js');
        const snaps = overlayStore.list({ workspaceRoot: context.config.workspaceRoot }).map((s: any) => ({
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
    if (url.pathname.startsWith('/api/v1/snapshots/') && url.pathname.endsWith('/diff') && request.method === 'GET') {
        try {
            assertAllowedBrowserOrigin(request, 'HTTP snapshot diff');
            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/diff$/);
            const id = m?.[1];
            if (!id)
                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                });
            const { overlayStore } = await import('../core/overlay-store.js');
            let text =
                (overlayStore as any).getOverlayDiffText?.(id, {
                    workspaceRoot: context.config.workspaceRoot,
                }) || '';
            if (!text) {
                const existingDiffPath = (overlayStore as any).getExistingMaterializedDiffPath?.(id, {
                    workspaceRoot: context.config.workspaceRoot,
                });
                text = await readSnapshotArtifactText(
                    existingDiffPath ? path.dirname(existingDiffPath) : undefined,
                    'overlay.diff',
                    ''
                );
            }
            return new Response(JSON.stringify({ success: true, data: { id, diff: text } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch (err) {
            return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(err) }), {
                status: statusForThrownError(err),
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    // Snapshots - status (exposes lastApply and touched files)
    if (url.pathname.startsWith('/api/v1/snapshots/') && url.pathname.endsWith('/status') && request.method === 'GET') {
        try {
            assertAllowedBrowserOrigin(request, 'HTTP snapshot status');
            const m = url.pathname.match(/^\/api\/v1\/snapshots\/([^/]+)\/status$/);
            const id = m?.[1];
            if (!id)
                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                });
            const { overlayStore } = await import('../core/overlay-store.js');
            const status = (overlayStore as any).getStatus?.(id, {
                workspaceRoot: context.config.workspaceRoot,
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
            return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(err) }), {
                status: statusForThrownError(err),
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
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
            const id = m?.[1];
            if (!id)
                return new Response(JSON.stringify({ success: false, error: 'Invalid snapshot id' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
                });
            const { overlayStore } = await import('../core/overlay-store.js');
            const snapshotDir =
                (overlayStore as any).getSnapshotDirectory?.(id, {
                    workspaceRoot: context.config.workspaceRoot,
                }) || '';
            const text = await readSnapshotArtifactText(snapshotDir || undefined, 'progress.log', '');
            return new Response(JSON.stringify({ success: true, data: { id, progress: text } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch (err) {
            return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(err) }), {
                status: statusForThrownError(err),
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    // Snapshots - clean
    if (url.pathname === '/api/v1/snapshots/clean' && request.method === 'POST') {
        try {
            assertAllowedBrowserOrigin(request, 'HTTP snapshots/clean');
            const raw = await context.getRequestBody(request);
            const body: any = strictJsonParse(raw || '{}');
            const { overlayStore } = await import('../core/overlay-store.js');
            const maxKeep = typeof body.maxKeep === 'number' ? body.maxKeep : 10;
            const days = typeof body.maxAgeDays === 'number' ? body.maxAgeDays : 3;
            await overlayStore.cleanup(maxKeep, days * 24 * 60 * 60 * 1000, {
                workspaceRoot: context.config.workspaceRoot,
            });
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch (err) {
            return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(err) }), {
                status: statusForThrownError(err),
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    // Lightweight learning stats (mirrors adapter API)
    if ((url.pathname === '/learning-stats' || url.pathname === '/api/v1/learning-stats') && request.method === 'GET') {
        try {
            const stats = await (context.coreAnalyzer as any).getStats?.();
            return new Response(JSON.stringify({ success: true, data: stats || {} }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        } catch {
            return new Response(JSON.stringify({ success: false, error: 'Failed to get learning stats' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    }

    return null;
}
