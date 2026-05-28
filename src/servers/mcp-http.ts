#!/usr/bin/env bun

/**
 * MCP Streamable HTTP Server - replaces SSE
 *
 * Implements the MCP server over the Streamable HTTP transport using Express.
 * Session management is handled via the `Mcp-Session-Id` header as per SDK docs.
 *
 * All analysis work is delegated to the unified core via our MCPAdapter.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    isInitializeRequest,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express from 'express';
import { toMcpError } from '../adapters/error-mapper.js';
import { MCPAdapter } from '../adapters/mcp-adapter.js';
import { createDefaultCoreConfig } from '../adapters/utils.js';
import { getEnvironmentConfig } from '../core/config/server-config.js';
import { CoreError } from '../core/errors.js';
import { createCodeAnalyzer } from '../core/index';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { SCI_VERSION } from '../core/version.js';
import { resolveConfiguredWorkspaceRoot } from '../core/workspace-root.js';
import { metricsRegistry, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';
import { toMcpToolCallError } from '../mcp/tool-call-error.js';
import { isMcpToolResultSuccess } from '../mcp/tool-result.js';
import { maxJsonBodyBytes } from './http-ingress.js';
import { resolveMcpHttpCorsOrigin } from './mcp-http-cors.js';
import { registerCommonPrompts, registerCommonResources } from './mcp-shared.js';

type JsonRpcMessageId = string | number | null;

type JsonRpcPayload =
    | ReturnType<typeof buildJsonRpcErrorPayload>
    | { jsonrpc: '2.0'; id: JsonRpcMessageId; result?: unknown; error?: unknown };

type SessionRecord = {
    server: Server;
    transport: StreamableHTTPServerTransport;
    analyzer: CodeAnalyzer;
    adapter: MCPAdapter;
    disposing?: boolean;
    disposed?: boolean;
    disposePromise?: Promise<void>;
};

type McpEventPayload = { sessionId?: string; ts?: number; [key: string]: unknown };

type TransportRequest = Parameters<StreamableHTTPServerTransport['handleRequest']>[0];
type TransportResponse = Parameters<StreamableHTTPServerTransport['handleRequest']>[1];

const cfg = getEnvironmentConfig();
const HOST = process.env.MCP_HTTP_HOST || cfg.host || 'localhost';
const PORT = Number(process.env.MCP_HTTP_PORT || cfg.ports.mcpHTTP || 7001);
const CORS_ORIGIN = resolveMcpHttpCorsOrigin(HOST);

const app = express();
app.use(express.json({ limit: maxJsonBodyBytes() }));
app.use(
    cors({
        origin: CORS_ORIGIN,
        exposedHeaders: ['Mcp-Session-Id'],
        allowedHeaders: ['Content-Type', 'mcp-session-id', 'mcp-protocol-version'],
    })
);

function buildJsonRpcErrorPayload(error: unknown, id: JsonRpcMessageId = null) {
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

function sendJsonRpcError(res: express.Response, error: unknown, id: JsonRpcMessageId, status?: number) {
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

function sendSseJsonRpcPayload(res: express.Response, payload: JsonRpcPayload) {
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

function sendSseJsonRpcError(res: express.Response, error: unknown, id: JsonRpcMessageId) {
    const payload = buildJsonRpcErrorPayload(error, id);
    sendSseJsonRpcPayload(res, payload);
}

const missingSessionError = { code: -32000, message: 'Bad Request: No valid session ID provided' };

function requestJsonRpcId(body: unknown): JsonRpcMessageId {
    if (Array.isArray(body)) return null;
    if (body && typeof body === 'object') {
        const id = (body as { id?: unknown }).id;
        if (typeof id === 'string' || typeof id === 'number' || id === null) return id;
    }
    return null;
}

function sendMissingSession(res: express.Response, id: JsonRpcMessageId = null) {
    res.status(400).json({ jsonrpc: '2.0', error: { ...missingSessionError }, id });
}

function isJsonRpcObjectOrBatch(body: unknown): body is Record<string, unknown> | Record<string, unknown>[] {
    if (!body || typeof body !== 'object') return false;
    if (!Array.isArray(body)) return true;
    return body.every((item) => !!item && typeof item === 'object' && !Array.isArray(item));
}

function containsInitializeRequest(body: unknown): boolean {
    const messages = Array.isArray(body) ? body : [body];
    return messages.some((message) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
        return isInitializeRequest(message) || (message as { method?: unknown }).method === 'initialize';
    });
}

function ensureMcpAcceptHeaders(req: express.Request) {
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

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const errorLike = err as { message?: unknown; type?: unknown; limit?: unknown; length?: unknown };
    const message = typeof errorLike.message === 'string' ? errorLike.message : undefined;
    const isTooLarge = errorLike.type === 'entity.too.large';
    const isParseError =
        err instanceof SyntaxError || (message?.includes('JSON') ?? false) || errorLike.type === 'entity.parse.failed';

    if (isTooLarge) {
        const core = new CoreError('InvalidParams', 'HTTP JSON request body exceeds maximum size', {
            bytes: typeof errorLike.length === 'number' ? errorLike.length : undefined,
            maxBytes: typeof errorLike.limit === 'number' ? errorLike.limit : maxJsonBodyBytes(),
        });
        sendJsonRpcError(res, core, null, 400);
        return;
    }

    if (isParseError) {
        sendJsonRpcError(
            res,
            new McpError(ErrorCode.ParseError, 'Parse error', {
                error: message ?? 'Invalid JSON body',
            }),
            null,
            400
        );
        return;
    }
    next(err);
});

// Prometheus metrics endpoint for MCP HTTP adapter
app.get('/metrics', (_req, res) => {
    const text = metricsRegistry.renderPrometheusText();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.status(200).send(text);
});

// In-memory session map
const sessions: Record<string, SessionRecord> = {};
const mcpEvents = new EventEmitter();

async function disposeSession(record: SessionRecord | undefined, sessionId?: string): Promise<void> {
    if (!record) return;
    if (sessionId) delete sessions[sessionId];
    for (const [sid, candidate] of Object.entries(sessions)) {
        if (candidate === record) delete sessions[sid];
    }
    if (record.disposed) return;
    if (record.disposing) return record.disposePromise ?? Promise.resolve();

    record.disposing = true;
    record.disposePromise = Promise.resolve().then(async () => {
        try {
            await Promise.resolve(record.transport.close());
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('[MCP HTTP] transport close failed during session disposal:', error);
        }
        try {
            await record.analyzer.dispose();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('[MCP HTTP] analyzer dispose failed during session disposal:', error);
        } finally {
            record.disposed = true;
            record.disposing = false;
        }
    });

    return record.disposePromise;
}

async function createMcpServer(desiredSid?: string, enableJsonResponse = false): Promise<SessionRecord> {
    // Initialize core analyzer
    const coreConfig = createDefaultCoreConfig();
    coreConfig.monitoring.enabled = false; // disable periodic metrics for MCP HTTP dogfooding
    const workspaceRoot = resolveConfiguredWorkspaceRoot();
    const analyzer = await createCodeAnalyzer({ ...coreConfig, workspaceRoot });
    await analyzer.initialize();

    // Create adapter and low-level server with handlers
    const adapter = new MCPAdapter(analyzer);
    const server = new Server(
        { name: 'semantic-code-intelligence', version: SCI_VERSION },
        { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // Register request handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: adapter.getTools() }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            const t0 = Date.now();
            const sid = transport.sessionId || 'unknown';
            const argKeys = args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args).sort() : [];
            mcpEvents.emit('toolCall', { sessionId: sid, name, argKeys, ts: Date.now() });
            recordToolStart('mcp_http');
            const out = await adapter.handleValidatedToolCall(name, (args || {}) as Record<string, unknown>);
            try {
                recordToolEnd('mcp_http', String(name || 'unknown'), Date.now() - t0, isMcpToolResultSuccess(out));
            } catch {}
            return out;
        } catch (error) {
            const sid = transport.sessionId || 'unknown';
            mcpEvents.emit('toolError', {
                sessionId: sid,
                name,
                error: error instanceof Error ? error.message : String(error),
                ts: Date.now(),
            });
            try {
                recordToolEnd('mcp_http', String(name || 'unknown'), 0, false);
            } catch {}
            throw toMcpToolCallError(name, error);
        }
    });

    // Create transport (session id assigned on first initialize)
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => desiredSid || randomUUID(),
        enableJsonResponse,
        onsessioninitialized: (_sessionId) => {
            // Attach after connect
        },
    });

    // Connect server to transport
    await server.connect(transport);

    // Prompts and resources (shared module)
    try {
        registerCommonPrompts(server);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[MCP HTTP] Prompts registration skipped:', (e as Error)?.message || String(e));
    }
    try {
        registerCommonResources(server, { workspaceRoot, getAnalyzer: () => analyzer });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[MCP HTTP] Resources registration skipped:', (e as Error)?.message || String(e));
    }

    return { server, transport, analyzer, adapter };
}

// POST /mcp - client -> server
app.post('/mcp', async (req, res) => {
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

        let record: SessionRecord | undefined;
        let provisionalSessionId: string | undefined;
        if (sessionId && sessions[sessionId]) {
            record = sessions[sessionId];
        } else if (!sessionId && containsInitializeRequest(req.body)) {
            try {
                const preSid = randomUUID();
                provisionalSessionId = preSid;
                record = await createMcpServer(preSid, !/text\/event-stream/i.test(originalAccept));
            } catch (e) {
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
            transport.onsessioninitialized = (sid: string) => {
                sessions[sid] = initializedRecord;
                try {
                    res.setHeader('Mcp-Session-Id', sid);
                } catch {}
            };
            transport.onclose = () => {
                const sid = transport.sessionId || preSid;
                void disposeSession(initializedRecord, sid);
            };
        } else {
            sendMissingSession(res, requestJsonRpcId(req.body));
            return;
        }

        const activeRecord = record;
        if (!activeRecord) {
            sendMissingSession(res, requestJsonRpcId(req.body));
            return;
        }

        ensureMcpAcceptHeaders(req);

        // SDK request schema validation can surface "missing params" as InternalError (-32603).
        // Normalize the most common transport-level case (tools/call with missing params) to InvalidParams (-32602).
        try {
            const invalidToolsCall = (
                body: any
            ): body is { method?: unknown; params?: unknown; id?: JsonRpcMessageId } =>
                !!body &&
                body.method === 'tools/call' &&
                (!body.params || typeof body.params !== 'object' || Array.isArray(body.params));
            const body = req.body as
                | { method?: unknown; params?: unknown; id?: JsonRpcMessageId }
                | Array<{ method?: unknown; params?: unknown; id?: JsonRpcMessageId }>;
            const core = new CoreError('InvalidParams', 'Missing required parameters: params');
            if (Array.isArray(body)) {
                const invalid = body.filter(invalidToolsCall);
                if (invalid.length > 0 && invalid.length === body.length) {
                    const payloads = invalid.map((item) => buildJsonRpcErrorPayload(core, item.id ?? null));
                    res.status(400).json(payloads);
                    return;
                }
            } else if (invalidToolsCall(body)) {
                if (/text\/event-stream/i.test(originalAccept)) sendSseJsonRpcError(res, core, body.id ?? null);
                else sendJsonRpcError(res, core, body.id ?? null, 400);
                return;
            }
        } catch {}

        try {
            await activeRecord.transport.handleRequest(req as TransportRequest, res as TransportResponse, req.body);
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
            if (provisionalSessionId) {
                await disposeSession(activeRecord, provisionalSessionId);
            }
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                        data: String(e instanceof Error ? e.message : e),
                    },
                    id: req.body?.id ?? null,
                });
            }
            return;
        }

        // After handling initialize, Streamable HTTP transport may have assigned a session ID
        // Ensure it's stored so subsequent requests can resolve the session without requiring
        // a prior GET /mcp handshake (fixes chicken-and-egg for list/call via HTTP)
        const sid = (activeRecord.transport as { sessionId?: string }).sessionId;
        if (sid && !sessions[sid]) {
            sessions[sid] = activeRecord;
            try {
                if (!res.headersSent) res.setHeader('Mcp-Session-Id', sid);
            } catch {}
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[MCP HTTP] Uncaught error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                    data: String(error instanceof Error ? error.message : error),
                },
                id: req.body?.id ?? null,
            });
        }
    }
});

// GET /mcp - server -> client notifications stream
app.get('/mcp', async (req, res) => {
    const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;
    if (!sessionId || !sessions[sessionId]) {
        sendMissingSession(res);
        return;
    }
    try {
        await sessions[sessionId].transport.handleRequest(req as TransportRequest, res as TransportResponse);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[MCP HTTP] GET handleRequest error:', error);
        if (!res.headersSent) {
            sendJsonRpcError(res, error, null, 500);
        }
    }
});

// SSE stream of MCP tool events for live monitoring
app.get('/mcp-events', (req, res) => {
    const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;
    if (!sessionId || !sessions[sessionId]) {
        sendMissingSession(res);
        return;
    }

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
    const hb = setInterval(() => send('heartbeat', {}), 15000);
    hb?.unref?.();

    req.on('close', () => {
        clearInterval(hb);
        mcpEvents.off('toolCall', onCall);
        mcpEvents.off('toolError', onErr);
        res.end();
    });
});

// DELETE /mcp - end session
app.delete('/mcp', async (req, res) => {
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
app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', sessions: Object.keys(sessions).length, timestamp: new Date().toISOString() });
});

// Start server
let server: HttpServer | null = null;
(async () => {
    server = app.listen(PORT, HOST, () => {
        const address = server?.address();
        const boundPort = typeof address === 'object' && address ? (address as AddressInfo).port : PORT;
        console.log(`MCP Streamable HTTP server listening at http://${HOST}:${boundPort}`);
    });
})().catch((e) => {
    console.error('Failed to start MCP HTTP server:', e);
    process.exit(1);
});
