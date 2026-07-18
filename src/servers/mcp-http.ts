#!/usr/bin/env bun

/**
 * MCP Streamable HTTP Server - replaces SSE
 *
 * Implements the MCP server over the Streamable HTTP transport using Express.
 * Session management is handled via the `Mcp-Session-Id` header as per SDK docs.
 *
 * All analysis work is delegated to the unified core via our MCPAdapter.
 */

import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express from 'express';
import { getEnvironmentConfig } from '../core/config/server-config.js';
import { CoreError } from '../core/errors.js';
import { resolveConfiguredWorkspaceRoot } from '../core/workspace-root.js';
import { metricsRegistry } from '../instrumentation/metrics.js';
import { maxJsonBodyBytes } from './http-ingress.js';
import { resolveMcpHttpCorsOrigin } from './mcp-http-cors.js';
import { sendJsonRpcError } from './mcp-http-protocol.js';
import { registerMcpHttpRoutes } from './mcp-http-routes.js';
import {
    disposeAllMcpHttpSessions,
    disposeExpiredMcpHttpSessions,
    ensureSessionSweeper,
    mcpHttpSessionCount,
} from './mcp-http-sessions.js';

export { disposeAllMcpHttpSessions, disposeExpiredMcpHttpSessions, mcpHttpSessionCount };

export type McpHttpServerStartOptions = {
    host?: string;
    port?: number;
};

let activeCorsHost: string | undefined;

function resolveMcpHttpRuntimeConfig(options: McpHttpServerStartOptions = {}): { host: string; port: number } {
    const workspaceRoot = resolveConfiguredWorkspaceRoot();
    const cfg = getEnvironmentConfig(workspaceRoot);
    return {
        host: options.host ?? process.env.MCP_HTTP_HOST ?? cfg.host ?? 'localhost',
        port: Number(options.port ?? process.env.MCP_HTTP_PORT ?? cfg.ports.mcpHTTP ?? 7001),
    };
}

function dynamicMcpHttpCorsOrigin(
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean | string | string[]) => void
): void {
    const policy = resolveMcpHttpCorsOrigin(activeCorsHost ?? resolveMcpHttpRuntimeConfig().host);
    if (typeof policy === 'function') {
        policy(origin, callback);
        return;
    }
    callback(null, policy);
}

export const app: any = express();
app.use(express.json({ limit: maxJsonBodyBytes() }));
app.use(
    cors({
        origin: dynamicMcpHttpCorsOrigin,
        exposedHeaders: ['Mcp-Session-Id'],
        allowedHeaders: ['Content-Type', 'mcp-session-id', 'mcp-protocol-version'],
    })
);

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
app.get('/metrics', (_req: express.Request, res: express.Response) => {
    const text = metricsRegistry.renderPrometheusText();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.status(200).send(text);
});

registerMcpHttpRoutes(app);

let activeServer: HttpServer | null = null;

export async function stopMcpHttpServer(server: HttpServer): Promise<void> {
    await disposeAllMcpHttpSessions();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function installSessionDisposingClose(server: HttpServer): HttpServer {
    const originalClose = server.close.bind(server);
    let closeStarted = false;
    server.close = ((callback?: (err?: Error) => void) => {
        const closeCallback = (error?: Error) => {
            if (activeServer === server) activeServer = null;
            activeCorsHost = undefined;
            callback?.(error);
        };
        if (closeStarted) return originalClose(closeCallback);
        closeStarted = true;
        void disposeAllMcpHttpSessions().finally(() => originalClose(closeCallback));
        return server;
    }) as typeof server.close;
    return server;
}

export function startMcpHttpServer(options: McpHttpServerStartOptions = {}): HttpServer {
    if (activeServer) throw new Error('MCP HTTP server is already running in this process');
    ensureSessionSweeper();
    const { host, port } = resolveMcpHttpRuntimeConfig(options);
    activeCorsHost = host;
    let listening = false;
    const server = app.listen(port, host, () => {
        listening = true;
        const address = server.address();
        const boundPort = typeof address === 'object' && address ? (address as AddressInfo).port : port;
        console.log(`MCP Streamable HTTP server listening at http://${host}:${boundPort}`);
    });
    const managedServer = installSessionDisposingClose(server);
    const onBindError = (error: Error) => {
        if (!listening && activeServer === managedServer) {
            activeServer = null;
            activeCorsHost = undefined;
        }
        managedServer.off('listening', onListening);
        managedServer.off('error', onBindError);
        if (managedServer.listenerCount('error') === 0) {
            queueMicrotask(() => {
                throw error;
            });
        }
    };
    const onListening = () => {
        managedServer.off('error', onBindError);
    };
    managedServer.once('error', onBindError);
    managedServer.once('listening', onListening);
    activeServer = managedServer;
    return managedServer;
}

let server: HttpServer | null = null;
if (import.meta.main) {
    try {
        server = startMcpHttpServer();
    } catch (e) {
        console.error('Failed to start MCP HTTP server:', e);
        process.exit(1);
    }
}
