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
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, isInitializeRequest, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import { EventEmitter } from 'events';
import express from 'express';
import { toMcpError } from '../adapters/error-mapper.js';
import { MCPAdapter } from '../adapters/mcp-adapter.js';
import { createDefaultCoreConfig } from '../adapters/utils.js';
import { getEnvironmentConfig } from '../core/config/server-config.js';
import { CoreError } from '../core/errors.js';
import { createCodeAnalyzer } from '../core/index';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { toMcpToolCallError } from '../mcp/tool-call-error.js';
import { isMcpToolResultSuccess } from '../mcp/tool-result.js';
import { resolveMcpHttpCorsOrigin } from './mcp-http-cors.js';
import { metricsRegistry, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';
import { registerCommonPrompts, registerCommonResources } from './mcp-shared.js';

type SessionRecord = {
    server: Server;
    transport: StreamableHTTPServerTransport;
    analyzer: CodeAnalyzer;
    adapter: MCPAdapter;
};

const cfg = getEnvironmentConfig();
const HOST = process.env.MCP_HTTP_HOST || cfg.host || 'localhost';
const PORT = Number(process.env.MCP_HTTP_PORT || cfg.ports.mcpHTTP || 7001);
const CORS_ORIGIN = resolveMcpHttpCorsOrigin(HOST);

const app = express();
app.use(express.json());
app.use(
    cors({
        origin: CORS_ORIGIN,
        exposedHeaders: ['Mcp-Session-Id'],
        allowedHeaders: ['Content-Type', 'mcp-session-id'],
    })
);

function buildJsonRpcErrorPayload(error: unknown, id: string | number | null = null) {
    const mcpError = toMcpError(error);
    const data = (mcpError as any).data;
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

function sendJsonRpcError(res: express.Response, error: unknown, id: string | number | null, status?: number) {
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

function sendSseJsonRpcPayload(
    res: express.Response,
    payload: ReturnType<typeof buildJsonRpcErrorPayload> | { jsonrpc: '2.0'; id: any; result?: any; error?: any }
) {
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

function sendSseJsonRpcError(res: express.Response, error: unknown, id: string | number | null) {
    const payload = buildJsonRpcErrorPayload(error, id);
    sendSseJsonRpcPayload(res, payload);
}

const missingSessionError = { code: -32000, message: 'Bad Request: No valid session ID provided' };

function sendMissingSession(res: express.Response) {
    res.status(400).json({ jsonrpc: '2.0', error: { ...missingSessionError }, id: null });
}

function ensureMcpAcceptHeaders(req: express.Request) {
    const accepts = (req.headers['accept'] as string | undefined) || '';
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
            (req.headers as any)['accept'] = merged;
        } catch {}
    }
    if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) {
        (req.headers as any)['content-type'] = 'application/json';
    }
}

// Normalize invalid JSON bodies to CoreError InvalidParams for parity
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const isParseError =
        err instanceof SyntaxError ||
        (typeof err?.message === 'string' && err.message.includes('JSON')) ||
        err?.type === 'entity.parse.failed';
    if (isParseError) {
        const core = new CoreError('InvalidParams', 'Invalid JSON', {
            error: err?.message ? String(err.message) : 'Invalid JSON body',
        });
        sendJsonRpcError(res, core, null, 400);
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

async function createMcpServer(desiredSid?: string): Promise<SessionRecord> {
    // Initialize core analyzer
    const coreConfig = createDefaultCoreConfig();
    coreConfig.monitoring.enabled = false; // disable periodic metrics for MCP HTTP dogfooding
    const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
    const analyzer = await createCodeAnalyzer({ ...coreConfig, workspaceRoot });
    await analyzer.initialize();

    // Create adapter and low-level server with handlers
    const adapter = new MCPAdapter(analyzer);
    const server = new Server(
        { name: 'semantic-code-intelligence', version: '1.0.0' },
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
            const out = await adapter.handleValidatedToolCall(name, (args || {}) as Record<string, any>);
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
        onsessioninitialized: (sessionId) => {
            // Attach after connect
        },
    });

    // Connect server to transport
    await server.connect(transport);

    // Prompts and resources (shared module) — guard for SDKs without prompt support
    try {
        // @ts-expect-error: older SDKs may not have registerPrompt
        if (typeof (server as any).registerPrompt === 'function') {
            registerCommonPrompts(server);
        }
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[MCP HTTP] Prompts registration skipped:', (e as Error)?.message || String(e));
    }
    try {
        registerCommonResources(server, { workspaceRoot });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[MCP HTTP] Resources registration skipped:', (e as Error)?.message || String(e));
    }

    return { server, transport, analyzer, adapter };
}

// POST /mcp - client -> server
app.post('/mcp', async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            const core = new CoreError('InvalidParams', 'Invalid JSON', {
                error: 'Body must be a JSON-RPC object',
            });
            sendJsonRpcError(res, core, null, 400);
            return;
        }
        const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;

        let record: SessionRecord | undefined;
        if (sessionId && sessions[sessionId]) {
            record = sessions[sessionId];
        } else if (!sessionId && (isInitializeRequest(req.body) || (req.body && req.body.method === 'initialize'))) {
            try {
                const preSid = randomUUID();
                record = await createMcpServer(preSid);
                // Expose session id on first initialize response for client convenience
                try {
                    res.setHeader('Mcp-Session-Id', preSid);
                } catch {}
                sessions[preSid] = record;
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
            const transport = record.transport;
            // When session is initialized, store it
            transport.onsessioninitialized = (sid: string) => {
                sessions[sid] = record!;
                try {
                    res.setHeader('Mcp-Session-Id', sid);
                } catch {}
            };
            transport.onclose = () => {
                const sid = transport.sessionId || preSid;
                if (sid) delete sessions[sid];
                if (sid && sid != preSid) delete sessions[preSid];
            };

        } else {
            sendMissingSession(res);
            return;
        }

        ensureMcpAcceptHeaders(req);

        // SDK request schema validation can surface "missing params" as InternalError (-32603).
        // Normalize the most common transport-level case (tools/call with missing params) to InvalidParams (-32602).
        try {
            const body: any = req.body;
            if (body && body.method === 'tools/call') {
                const params = body.params;
                if (!params || typeof params !== 'object' || Array.isArray(params)) {
                    const core = new CoreError('InvalidParams', 'Missing required parameters: params');
                    sendSseJsonRpcError(res, core, (body?.id ?? null) as any);
                    return;
                }
            }
        } catch {}

        try {
            await record!.transport.handleRequest(req as any, res as any, req.body);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[MCP HTTP] handleRequest error:', e);
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
        const sid = (record!.transport as any).sessionId as string | undefined;
        if (sid && !sessions[sid]) {
            sessions[sid] = record!;
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
    await sessions[sessionId].transport.handleRequest(req as any, res as any);
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

    const send = (event: string, data: any) => {
        const ts = typeof data?.ts === 'number' ? data.ts : Date.now();
        const { sessionId: _sessionId, ...safeData } = data || {};
        const payload = { ...safeData, ts, iso: new Date(ts).toISOString() };
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const onCall = (payload: any) => {
        if (payload?.sessionId === sessionId) send('toolCall', payload);
    };
    const onErr = (payload: any) => {
        if (payload?.sessionId === sessionId) send('toolError', payload);
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
    if (!sessionId || !sessions[sessionId]) {
        sendMissingSession(res);
        return;
    }
    try {
        const transport = sessions[sessionId].transport;
        transport.close();
    } finally {
        delete sessions[sessionId];
        res.status(204).end();
    }
});

// Health endpoint
app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', sessions: Object.keys(sessions).length, timestamp: new Date().toISOString() });
});

// Start server
let server: any = null;
(async () => {
    server = app.listen(PORT, HOST, () => {
        console.log(`MCP Streamable HTTP server listening at http://${HOST}:${(server.address() as any).port}`);
    });
})().catch((e) => {
    console.error('Failed to start MCP HTTP server:', e);
    process.exit(1);
});
