import { CoreError } from '../core/errors.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);
const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;

export function maxJsonBodyBytes(): number {
    const raw = process.env.SCI_HTTP_MAX_JSON_BODY_BYTES || process.env.HTTP_MAX_JSON_BODY_BYTES;
    const parsed = raw ? Number(raw) : DEFAULT_MAX_JSON_BODY_BYTES;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_JSON_BODY_BYTES;
}

export function isLoopbackOrigin(origin: string | null | undefined): boolean {
    if (!origin) return true;
    try {
        const hostname = new URL(origin).hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
        if (LOOPBACK_HOSTS.has(hostname)) return true;
        return /^127\.\d+\.\d+\.\d+$/.test(hostname);
    } catch {
        return false;
    }
}

export function assertAllowedBrowserOrigin(request: Request, inputLabel = 'HTTP request'): void {
    const origin = request.headers.get('origin');
    if (!origin || isLoopbackOrigin(origin)) return;
    throw new CoreError('InvalidParams', `${inputLabel} origin is not allowed`, { origin });
}

export function corsHeadersForRequest(request: Request): Record<string, string> {
    const origin = request.headers.get('origin');
    const allowOrigin = origin && isLoopbackOrigin(origin) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
            request.headers.get('access-control-request-headers') || 'Content-Type, Authorization',
        Vary: 'Origin',
    };
}

export async function readLimitedJsonBody(
    request: Request,
    maxBytes = maxJsonBodyBytes()
): Promise<string | undefined> {
    if (request.method === 'GET' || request.method === 'HEAD') return undefined;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return undefined;

    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
        throw new CoreError('InvalidParams', 'HTTP JSON request body exceeds maximum size', {
            bytes: Number(contentLength),
            maxBytes,
        });
    }

    if (!request.body) return '';

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > maxBytes) {
                try {
                    await reader.cancel();
                } catch {}
                throw new CoreError('InvalidParams', 'HTTP JSON request body exceeds maximum size', {
                    bytes: total,
                    maxBytes,
                });
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
}
