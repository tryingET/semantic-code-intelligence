import { randomUUID } from 'node:crypto';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type express from 'express';
import { CoreError } from '../core/errors.js';
import {
    buildJsonRpcErrorPayload,
    containsInitializeRequest,
    ensureMcpAcceptHeaders,
    invalidInitializeRequests,
    isJsonRpcObjectOrBatch,
    type JsonRpcMessageId,
    jsonRpcIdResponseState,
    jsonRpcMessageShouldReceiveResponse,
    requestJsonRpcId,
    sendJsonRpcError,
    sendMissingSession,
    sendSseJsonRpcError,
    sendSseJsonRpcPayload,
} from './mcp-http-protocol.js';
import {
    beginSessionConsumer,
    createMcpServer,
    disposeSession,
    endSessionConsumer,
    type McpEventPayload,
    mcpEvents,
    mcpHttpMaxSessions,
    mcpHttpSessionLoad,
    releaseSessionCreation,
    reserveSessionCreation,
    type SessionRecord,
    sessions,
    touchSession,
} from './mcp-http-sessions.js';

type TransportRequest = Parameters<StreamableHTTPServerTransport['handleRequest']>[0];
type TransportResponse = Parameters<StreamableHTTPServerTransport['handleRequest']>[1];

export function registerMcpHttpRoutes(app: any): void {
    // POST /mcp - client -> server
    app.post('/mcp', async (req: express.Request, res: express.Response) => {
        try {
            if (!isJsonRpcObjectOrBatch(req.body)) {
                const core = new CoreError('InvalidParams', 'Invalid JSON', {
                    error: 'Body must be a JSON-RPC object or batch array',
                });
                sendJsonRpcError(res, core, null, 400);
                return;
            }
            const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;
            const originalAccept = String(req.headers.accept || '');
            const invalidInitialize = invalidInitializeRequests(req.body);
            if (invalidInitialize.length > 0) {
                const core = new CoreError('InvalidParams', 'Invalid initialize request', {
                    error: 'initialize params must include protocolVersion, capabilities, and clientInfo',
                });
                if (Array.isArray(req.body)) {
                    const invalidItems = new Set(invalidInitialize);
                    const batchCore = new CoreError(
                        'InvalidParams',
                        'Batch rejected because initialize request is invalid',
                        {
                            error: 'Fix the invalid initialize request and retry the batch',
                        }
                    );
                    const payloads = req.body
                        .filter(jsonRpcMessageShouldReceiveResponse)
                        .map((item: Record<string, unknown>) =>
                            buildJsonRpcErrorPayload(invalidItems.has(item) ? core : batchCore, requestJsonRpcId(item))
                        );
                    if (!payloads.length) res.status(400).end();
                    else if (/text\/event-stream/i.test(originalAccept)) sendSseJsonRpcPayload(res, payloads);
                    else res.status(400).json(payloads);
                } else if (!jsonRpcMessageShouldReceiveResponse(invalidInitialize[0])) {
                    res.status(400).end();
                } else if (/text\/event-stream/i.test(originalAccept)) {
                    sendSseJsonRpcError(res, core, requestJsonRpcId(invalidInitialize[0]));
                } else {
                    sendJsonRpcError(res, core, requestJsonRpcId(invalidInitialize[0]), 400);
                }
                return;
            }

            let record: SessionRecord | undefined;
            let provisionalSessionId: string | undefined;
            let provisionalSessionPending = false;
            if (sessionId && sessions[sessionId]) {
                record = sessions[sessionId];
                touchSession(record);
            } else if (!sessionId && containsInitializeRequest(req.body)) {
                if (mcpHttpSessionLoad() >= mcpHttpMaxSessions()) {
                    const error = new McpError(ErrorCode.InternalError, 'Too many MCP HTTP sessions', {
                        maxSessions: mcpHttpMaxSessions(),
                    });
                    sendJsonRpcError(res, error, requestJsonRpcId(req.body), 429);
                    return;
                }
                try {
                    reserveSessionCreation();
                    provisionalSessionPending = true;
                    const preSid = randomUUID();
                    provisionalSessionId = preSid;
                    record = await createMcpServer(preSid, !/text\/event-stream/i.test(originalAccept));
                } catch (e) {
                    if (provisionalSessionPending) {
                        releaseSessionCreation();
                        provisionalSessionPending = false;
                    }
                    // Log detailed error to help diagnose 500s on initialize
                    // eslint-disable-next-line no-console
                    console.error('[MCP HTTP] createMcpServer failed:', e);
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Initialization failed',
                            data: String(e instanceof Error ? e.message : e),
                        },
                        id: req.body?.id ?? null,
                    });
                    return;
                }
                const initializedRecord = record;
                const transport = initializedRecord.transport;
                // When session is initialized, store it
                (transport as any).onsessioninitialized = (sid: string) => {
                    touchSession(initializedRecord);
                    sessions[sid] = initializedRecord;
                    try {
                        res.setHeader('Mcp-Session-Id', sid);
                    } catch {}
                };
                transport.onclose = () => {
                    const sid = transport.sessionId || provisionalSessionId;
                    void disposeSession(initializedRecord, sid);
                };
            } else {
                sendMissingSession(res, req.body);
                return;
            }

            const activeRecord = record;
            if (!activeRecord) {
                sendMissingSession(res, req.body);
                return;
            }

            ensureMcpAcceptHeaders(req);

            // SDK request schema validation can surface "missing params" as InternalError (-32603).
            // Normalize the most common transport-level case (tools/call with missing params) to InvalidParams (-32602).
            try {
                const invalidToolsCall = (body: any): boolean =>
                    !!body &&
                    body.method === 'tools/call' &&
                    (!body.params || typeof body.params !== 'object' || Array.isArray(body.params));
                const body = req.body as
                    | { method?: unknown; params?: unknown; id?: JsonRpcMessageId }
                    | Array<{ method?: unknown; params?: unknown; id?: JsonRpcMessageId }>;
                const core = new CoreError('InvalidParams', 'Missing required parameters: params');
                const schemaCore = new CoreError('InvalidParams', 'Invalid tools/call parameters');
                const responseId = (item: { id?: JsonRpcMessageId }) => jsonRpcIdResponseState(item).id;
                const shouldRespond = (item: { id?: JsonRpcMessageId }) => jsonRpcIdResponseState(item).respond;
                if (Array.isArray(body)) {
                    const invalid = body.filter(invalidToolsCall);
                    if (invalid.length > 0 && invalid.length === body.length) {
                        const payloads = invalid
                            .filter(shouldRespond)
                            .map((item) => buildJsonRpcErrorPayload(core, responseId(item)));
                        if (payloads.length) res.status(400).json(payloads);
                        else res.status(400).end();
                        return;
                    }
                    const localToolsCall = (item: { method?: unknown; params?: unknown }) =>
                        item.method === 'tools/call' &&
                        !!item.params &&
                        typeof item.params === 'object' &&
                        !Array.isArray(item.params);
                    const canAnswerMixedLocally =
                        invalid.length > 0 &&
                        body.every(
                            (item) => invalidToolsCall(item) || item.method === 'tools/list' || localToolsCall(item)
                        );
                    if (canAnswerMixedLocally) {
                        beginSessionConsumer(activeRecord);
                        try {
                            const payloads = [];
                            for (const item of body) {
                                if (!shouldRespond(item)) continue;
                                if (invalidToolsCall(item)) {
                                    payloads.push(buildJsonRpcErrorPayload(core, responseId(item)));
                                    continue;
                                }
                                if (item.method === 'tools/list') {
                                    payloads.push({
                                        jsonrpc: '2.0' as const,
                                        id: responseId(item),
                                        result: { tools: activeRecord.adapter.getTools() },
                                    });
                                    continue;
                                }
                                const params = item.params as { name?: unknown; arguments?: unknown };
                                if (
                                    typeof params.name !== 'string' ||
                                    !params.name.trim() ||
                                    (params.arguments !== undefined &&
                                        (!params.arguments ||
                                            typeof params.arguments !== 'object' ||
                                            Array.isArray(params.arguments)))
                                ) {
                                    payloads.push(buildJsonRpcErrorPayload(schemaCore, responseId(item)));
                                    continue;
                                }
                                try {
                                    const result = await activeRecord.adapter.handleValidatedToolCall(
                                        params.name,
                                        params.arguments ? (params.arguments as Record<string, unknown>) : {}
                                    );
                                    payloads.push({ jsonrpc: '2.0' as const, id: responseId(item), result });
                                } catch (error) {
                                    payloads.push(buildJsonRpcErrorPayload(error, responseId(item)));
                                }
                            }
                            if (payloads.length) res.status(200).json(payloads);
                            else res.status(200).end();
                        } finally {
                            endSessionConsumer(activeRecord);
                        }
                        return;
                    }
                } else if (invalidToolsCall(body)) {
                    if (/text\/event-stream/i.test(originalAccept)) sendSseJsonRpcError(res, core, body.id ?? null);
                    else sendJsonRpcError(res, core, body.id ?? null, 400);
                    return;
                }
            } catch {}

            try {
                beginSessionConsumer(activeRecord);
                try {
                    await activeRecord.transport.handleRequest(
                        req as TransportRequest,
                        res as TransportResponse,
                        req.body
                    );
                } finally {
                    endSessionConsumer(activeRecord);
                    if (provisionalSessionPending) {
                        releaseSessionCreation();
                        provisionalSessionPending = false;
                    }
                }
                if (provisionalSessionId && res.statusCode >= 400) {
                    try {
                        if (!res.headersSent) res.removeHeader('Mcp-Session-Id');
                    } catch {}
                    await disposeSession(activeRecord, provisionalSessionId);
                    return;
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('[MCP HTTP] handleRequest error:', e);
                if (provisionalSessionPending) {
                    releaseSessionCreation();
                    provisionalSessionPending = false;
                }
                if (provisionalSessionId) {
                    await disposeSession(activeRecord, provisionalSessionId);
                }
                if (!res.headersSent) {
                    const errorPayload = (item: unknown) => ({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error',
                            data: String(e instanceof Error ? e.message : e),
                        },
                        id: requestJsonRpcId(item),
                    });
                    res.status(500).json(Array.isArray(req.body) ? req.body.map(errorPayload) : errorPayload(req.body));
                }
                return;
            }

            // After handling initialize, Streamable HTTP transport may have assigned a session ID
            // Ensure it's stored so subsequent requests can resolve the session without requiring
            // a prior GET /mcp handshake (fixes chicken-and-egg for list/call via HTTP)
            const sid = (activeRecord.transport as { sessionId?: string }).sessionId;
            if (sid && !sessions[sid]) {
                touchSession(activeRecord);
                sessions[sid] = activeRecord;
                try {
                    if (!res.headersSent) res.setHeader('Mcp-Session-Id', sid);
                } catch {}
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[MCP HTTP] Uncaught error:', error);
            if (!res.headersSent) {
                const errorPayload = (item: unknown) => ({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                        data: String(error instanceof Error ? error.message : error),
                    },
                    id: requestJsonRpcId(item),
                });
                res.status(500).json(Array.isArray(req.body) ? req.body.map(errorPayload) : errorPayload(req.body));
            }
        }
    });

    // GET /mcp - server -> client notifications stream
    app.get('/mcp', async (req: express.Request, res: express.Response) => {
        const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;
        if (!sessionId || !sessions[sessionId]) {
            sendMissingSession(res);
            return;
        }
        const record = sessions[sessionId];
        try {
            beginSessionConsumer(record);
            try {
                await record.transport.handleRequest(req as TransportRequest, res as TransportResponse);
            } finally {
                endSessionConsumer(record);
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[MCP HTTP] GET handleRequest error:', error);
            if (!res.headersSent) {
                sendJsonRpcError(res, error, null, 500);
            }
        }
    });

    // SSE stream of MCP tool events for live monitoring
    app.get('/mcp-events', (req: express.Request, res: express.Response) => {
        const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;
        if (!sessionId || !sessions[sessionId]) {
            sendMissingSession(res);
            return;
        }
        const record = sessions[sessionId];
        beginSessionConsumer(record);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const send = (event: string, data: unknown) => {
            const eventData = data && typeof data === 'object' ? (data as McpEventPayload) : {};
            const ts = typeof eventData.ts === 'number' ? eventData.ts : Date.now();
            const { sessionId: _sessionId, ...safeData } = eventData;
            const payload = { ...safeData, ts, iso: new Date(ts).toISOString() };
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        const onCall = (payload: unknown) => {
            if ((payload as McpEventPayload | undefined)?.sessionId === sessionId) send('toolCall', payload);
        };
        const onErr = (payload: unknown) => {
            if ((payload as McpEventPayload | undefined)?.sessionId === sessionId) send('toolError', payload);
        };

        mcpEvents.on('toolCall', onCall);
        mcpEvents.on('toolError', onErr);

        // heartbeat
        const hb = setInterval(() => {
            touchSession(record);
            send('heartbeat', {});
        }, 15000);
        hb?.unref?.();

        req.on('close', () => {
            clearInterval(hb);
            mcpEvents.off('toolCall', onCall);
            mcpEvents.off('toolError', onErr);
            endSessionConsumer(record);
            res.end();
        });
    });

    // DELETE /mcp - end session
    app.delete('/mcp', async (req: express.Request, res: express.Response) => {
        const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;
        const record = sessionId ? sessions[sessionId] : undefined;
        if (!sessionId || !record) {
            sendMissingSession(res);
            return;
        }
        try {
            await disposeSession(record, sessionId);
        } finally {
            res.status(204).end();
        }
    });

    // Health endpoint
    app.get('/health', (_req: express.Request, res: express.Response) => {
        res.json({ status: 'healthy', sessions: Object.keys(sessions).length, timestamp: new Date().toISOString() });
    });
}
