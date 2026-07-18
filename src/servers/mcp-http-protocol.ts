import { ErrorCode, isInitializeRequest, type McpError } from '@modelcontextprotocol/sdk/types.js';
import type express from 'express';
import { toMcpError } from '../adapters/error-mapper.js';

export type JsonRpcMessageId = string | number | null;
export type JsonRpcPayload =
    | ReturnType<typeof buildJsonRpcErrorPayload>
    | { jsonrpc: '2.0'; id: JsonRpcMessageId; result?: unknown; error?: unknown };

export function buildJsonRpcErrorPayload(error: unknown, id: JsonRpcMessageId = null) {
    const mcpError = toMcpError(error) as McpError & { data?: unknown };
    const data = mcpError.data;
    const payload = {
        jsonrpc: '2.0',
        error: {
            code: mcpError.code,
            message: mcpError.message,
            ...(data !== undefined ? { data } : {}),
        },
        id,
    };
    return payload;
}

export function sendJsonRpcError(res: express.Response, error: unknown, id: JsonRpcMessageId, status?: number) {
    const payload = buildJsonRpcErrorPayload(error, id);
    const code = payload.error.code;
    const httpStatus =
        typeof status === 'number'
            ? status
            : code === ErrorCode.InvalidParams
              ? 400
              : code === ErrorCode.MethodNotFound
                ? 404
                : 500;
    res.status(httpStatus).json(payload);
}

export function sendSseJsonRpcPayload(res: express.Response, payload: JsonRpcPayload | JsonRpcPayload[]) {
    // Minimal SSE envelope for streamable clients (single event; then close).
    // Keep status=200 even for JSON-RPC errors, matching typical JSON-RPC over HTTP behavior.
    try {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    } catch {}
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.end();
}

export function sendSseJsonRpcError(res: express.Response, error: unknown, id: JsonRpcMessageId) {
    const payload = buildJsonRpcErrorPayload(error, id);
    sendSseJsonRpcPayload(res, payload);
}

const missingSessionError = { code: -32000, message: 'Bad Request: No valid session ID provided' };

export function requestJsonRpcId(body: unknown): JsonRpcMessageId {
    if (Array.isArray(body)) return null;
    if (body && typeof body === 'object' && Object.hasOwn(body, 'id')) {
        const id = (body as { id?: unknown }).id;
        if (typeof id === 'string' || typeof id === 'number' || id === null) return id;
    }
    return null;
}

export function jsonRpcIdResponseState(body: unknown): { respond: boolean; id: JsonRpcMessageId } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { respond: true, id: null };
    if (!Object.hasOwn(body, 'id')) return { respond: false, id: null };
    return { respond: true, id: requestJsonRpcId(body) };
}

export function sendMissingSession(res: express.Response, bodyOrId: unknown = null) {
    if (Array.isArray(bodyOrId)) {
        const payloads = bodyOrId
            .map((item) => jsonRpcIdResponseState(item))
            .filter((state) => state.respond)
            .map((state) => ({
                jsonrpc: '2.0',
                error: { ...missingSessionError },
                id: state.id,
            }));
        if (payloads.length) res.status(400).json(payloads);
        else res.status(400).end();
        return;
    }
    const state =
        typeof bodyOrId === 'string' || typeof bodyOrId === 'number' || bodyOrId === null
            ? { respond: true, id: bodyOrId }
            : jsonRpcIdResponseState(bodyOrId);
    if (!state.respond) {
        res.status(400).end();
        return;
    }
    res.status(400).json({ jsonrpc: '2.0', error: { ...missingSessionError }, id: state.id });
}

export function isJsonRpcObjectOrBatch(body: unknown): body is Record<string, unknown> | Record<string, unknown>[] {
    if (!body || typeof body !== 'object') return false;
    if (!Array.isArray(body)) return true;
    return body.every((item) => !!item && typeof item === 'object' && !Array.isArray(item));
}

export function containsInitializeRequest(body: unknown): boolean {
    const messages = Array.isArray(body) ? body : [body];
    return messages.some((message) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
        return isInitializeRequest(message) || (message as { method?: unknown }).method === 'initialize';
    });
}

export function invalidInitializeRequests(body: unknown): Record<string, unknown>[] {
    const messages = Array.isArray(body) ? body : [body];
    const invalid: Record<string, unknown>[] = [];
    for (const message of messages) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
        const candidate = message as Record<string, unknown>;
        if (candidate.method === 'initialize' && !isInitializeRequest(candidate)) invalid.push(candidate);
    }
    return invalid;
}

function isJsonRpcNotification(message: unknown): boolean {
    return (
        !!message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        !Object.hasOwn(message, 'id') &&
        typeof (message as { method?: unknown }).method === 'string'
    );
}

export function jsonRpcMessageShouldReceiveResponse(message: unknown): boolean {
    return !isJsonRpcNotification(message);
}

export function ensureMcpAcceptHeaders(req: express.Request) {
    const accepts = (req.headers.accept as string | undefined) || '';
    const needJson = !/application\/json/i.test(accepts);
    const needSse = !/text\/event-stream/i.test(accepts);
    if (needJson || needSse) {
        try {
            const merged = [
                ...(accepts
                    ? accepts
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                    : []),
                ...(needJson ? ['application/json'] : []),
                ...(needSse ? ['text/event-stream'] : []),
            ]
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(', ');
            (req.headers as Record<string, unknown>).accept = merged;
        } catch {}
    }
    if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) {
        (req.headers as Record<string, unknown>)['content-type'] = 'application/json';
    }
}
