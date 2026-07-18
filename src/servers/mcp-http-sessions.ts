import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCPAdapter } from '../adapters/mcp-adapter.js';
import { createDefaultCoreConfig } from '../adapters/utils.js';
import { createCodeAnalyzer } from '../core/index';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { SCI_VERSION } from '../core/version.js';
import { resolveConfiguredWorkspaceRoot } from '../core/workspace-root.js';
import { recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';
import { toMcpToolCallError } from '../mcp/tool-call-error.js';
import { isMcpToolResultSuccess } from '../mcp/tool-result.js';
import { registerCommonPrompts, registerCommonResources } from './mcp-shared.js';

export type McpEventPayload = { sessionId?: string; ts?: number; [key: string]: unknown };

export type SessionRecord = {
    server: Server;
    transport: StreamableHTTPServerTransport;
    analyzer: CodeAnalyzer;
    adapter: MCPAdapter;
    createdAt: number;
    lastSeenAt: number;
    activeConsumers: number;
    disposing?: boolean;
    disposed?: boolean;
    disposePromise?: Promise<void>;
};

// In-memory session map. Null prototype prevents prototype keys such as
// "__proto__"/"toString" from being accepted as real session IDs.
export const sessions: Record<string, SessionRecord> = Object.create(null);
export const mcpEvents = new EventEmitter();
let sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
let pendingSessionCreations = 0;

export function reserveSessionCreation(): void {
    pendingSessionCreations += 1;
}

export function releaseSessionCreation(): void {
    pendingSessionCreations = Math.max(0, pendingSessionCreations - 1);
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sessionTtlMs(): number {
    return parsePositiveIntegerEnv('MCP_HTTP_SESSION_TTL_MS', 30 * 60 * 1000);
}

function sessionSweepIntervalMs(): number {
    return parsePositiveIntegerEnv('MCP_HTTP_SESSION_SWEEP_INTERVAL_MS', 60 * 1000);
}

export function mcpHttpMaxSessions(): number {
    return parsePositiveIntegerEnv('MCP_HTTP_MAX_SESSIONS', 64);
}

export function mcpHttpSessionLoad(): number {
    return Object.keys(sessions).length + pendingSessionCreations;
}

export function touchSession(record: SessionRecord | undefined, now = Date.now()): void {
    if (record && !record.disposed) record.lastSeenAt = now;
}

export function beginSessionConsumer(record: SessionRecord | undefined): void {
    if (!record || record.disposed) return;
    record.activeConsumers += 1;
    touchSession(record);
}

export function endSessionConsumer(record: SessionRecord | undefined): void {
    if (!record) return;
    record.activeConsumers = Math.max(0, record.activeConsumers - 1);
    touchSession(record);
}

function clearSessionSweeperIfIdle(): void {
    if (sessionSweepTimer && Object.keys(sessions).length === 0) {
        clearInterval(sessionSweepTimer);
        sessionSweepTimer = null;
    }
}

export function ensureSessionSweeper(): void {
    if (sessionSweepTimer) return;
    sessionSweepTimer = setInterval(() => {
        void disposeExpiredSessions(Date.now());
    }, sessionSweepIntervalMs());
    sessionSweepTimer.unref?.();
}

async function disposeExpiredSessions(now = Date.now()): Promise<void> {
    const ttl = sessionTtlMs();
    const expired = Object.entries(sessions).filter(
        ([, record]) => record.activeConsumers === 0 && now - record.lastSeenAt > ttl
    );
    await Promise.all(expired.map(([sessionId, record]) => disposeSession(record, sessionId)));
}

export function mcpHttpSessionCount(): number {
    return Object.keys(sessions).length;
}

export async function disposeExpiredMcpHttpSessions(now = Date.now()): Promise<void> {
    await disposeExpiredSessions(now);
}

export async function disposeAllMcpHttpSessions(): Promise<void> {
    await Promise.all(Object.entries(sessions).map(([sessionId, record]) => disposeSession(record, sessionId)));
    clearSessionSweeperIfIdle();
}

export async function disposeSession(record: SessionRecord | undefined, sessionId?: string): Promise<void> {
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
            clearSessionSweeperIfIdle();
        }
    });

    return record.disposePromise;
}

export async function createMcpServer(desiredSid?: string, enableJsonResponse = false): Promise<SessionRecord> {
    ensureSessionSweeper();
    // Initialize core analyzer
    const workspaceRoot = resolveConfiguredWorkspaceRoot();
    const coreConfig = createDefaultCoreConfig(workspaceRoot);
    coreConfig.monitoring.enabled = false; // disable periodic metrics for MCP HTTP dogfooding
    const analyzer = await createCodeAnalyzer({ ...coreConfig, workspaceRoot });
    await analyzer.initialize();

    // Create adapter and low-level server with handlers
    const adapter = new MCPAdapter(analyzer as any);
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

    // Prompts and resources (shared module) must be registered before connecting so
    // initialization and list/read requests observe the same capability surface as stdio.
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

    // Connect server to transport
    await server.connect(transport);

    const now = Date.now();
    return { server, transport, analyzer, adapter, createdAt: now, lastSeenAt: now, activeConsumers: 0 };
}
