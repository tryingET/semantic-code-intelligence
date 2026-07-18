/**
 * HTTP API Server - Thin wrapper around unified core
 *
 * This server only handles HTTP transport concerns:
 * - Request parsing
 * - Response formatting
 * - Server lifecycle
 *
 * All analysis work is delegated to the HTTP adapter and core analyzer.
 */

import { serve } from 'bun';
import { HTTPAdapter, type HTTPRequest } from '../adapters/http-adapter.js';
import { createDefaultCoreConfig } from '../adapters/utils.js';
import { getEnvironmentConfig, type ServerConfig } from '../core/config/server-config.js';
import { createCodeAnalyzer } from '../core/index';
import { ToolExecutor } from '../core/tools/executor.js';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { assertHttpToolAllowed as assertSharedHttpToolAllowed } from '../core/workflows/http-tool-policy.js';
import type { SnapshotWorkflowResult } from '../core/workflows/snapshot-patch-workflow.js';
import {
    normalizeWorkflowResult,
    workflowErrorPayload,
    workflowPayload,
} from '../core/workflows/tool-result-normalizer.js';
import { ToolWorkflowRouter } from '../core/workflows/tool-workflow-router.js';
import { resolveConfiguredWorkspaceRoot } from '../core/workspace-root.js';
import { recordLayerLatency } from '../instrumentation/metrics.js';
import { readLimitedJsonBody } from './http-ingress.js';
import { decodeStaticPath as decodeHTTPStaticPath, findWebUiFile as findHTTPWebUiFile } from './http-static-files.js';
import { createHTTPFetchHandler } from './http-request-handler.js';

interface HTTPServerConfig {
    port?: number;
    host?: string;
    workspaceRoot?: string;
    enableCors?: boolean;
    enableOpenAPI?: boolean;
    enableLegacyPipelines?: boolean;
}

interface HTTPServerStatus {
    running: boolean;
    config: HTTPServerConfig;
    adapter: unknown;
    timestamp: number;
}

export class HTTPServer {
    private coreAnalyzer!: CodeAnalyzer;
    private httpAdapter!: HTTPAdapter;
    private toolRouter!: ToolWorkflowRouter;
    private toolExecutor!: ToolExecutor;
    private config: HTTPServerConfig;
    private serverConfig: ServerConfig;
    private server: ReturnType<typeof serve> | null = null;
    // No external port registry; honor env or defaults

    constructor(config: HTTPServerConfig = {}) {
        const workspaceRoot = resolveConfiguredWorkspaceRoot(config.workspaceRoot);
        this.serverConfig = getEnvironmentConfig(workspaceRoot);
        this.config = {
            ...config,
            port: config.port ?? this.serverConfig.ports.httpAPI,
            host: config.host ?? this.serverConfig.host,
            workspaceRoot,
            enableCors: config.enableCors ?? true,
            enableOpenAPI: config.enableOpenAPI ?? true,
            enableLegacyPipelines:
                config.enableLegacyPipelines ??
                (process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES === '1' || config.enableOpenAPI === false),
        };
    }

    async initialize(): Promise<void> {
        if (!process.env.SILENT_MODE) {
            console.log(`[HTTP Server] Initializing at ${this.config.host}:${this.config.port}`);
            console.log(`[HTTP Server] Workspace root: ${this.config.workspaceRoot}`);
        }

        // Initialize core analyzer
        const workspaceRoot = this.config.workspaceRoot ?? resolveConfiguredWorkspaceRoot();
        const coreConfig = createDefaultCoreConfig(workspaceRoot);
        coreConfig.monitoring.enabled = true; // enable metrics only for HTTP server

        this.coreAnalyzer = await createCodeAnalyzer({
            ...coreConfig,
            workspaceRoot,
        });

        await this.coreAnalyzer.initialize();

        // Create HTTP adapter and reusable core workflow executor
        this.httpAdapter = new HTTPAdapter(this.coreAnalyzer, {
            enableCors: this.config.enableCors,
            enableOpenAPI: this.config.enableOpenAPI,
            maxResults: 100,
            timeout: 30000,
        });
        this.toolRouter = new ToolWorkflowRouter(this.coreAnalyzer);
        this.toolExecutor = new ToolExecutor();

        if (!process.env.SILENT_MODE) {
            console.log(`[HTTP Server] Core analyzer and HTTP adapter initialized`);
        }
    }

    async start(): Promise<void> {
        if (!this.coreAnalyzer || !this.httpAdapter) {
            await this.initialize();
        }

        // Determine port: prefer config port if explicitly set, else HTTP_API_PORT env, else 7000
        const listenPort = Number(this.config.port ?? process.env.HTTP_API_PORT ?? 7000);

        this.server = serve({
            hostname: this.config.host,
            port: listenPort,
            fetch: createHTTPFetchHandler({
                coreAnalyzer: this.coreAnalyzer,
                httpAdapter: this.httpAdapter,
                config: this.config,
                executeToolWorkflow: this.executeToolWorkflow.bind(this),
                normalizeToolWorkflowResultForHttp: this.normalizeToolWorkflowResultForHttp.bind(this),
                toolWorkflowPayload: this.toolWorkflowPayload.bind(this),
                toolWorkflowErrorPayload: this.toolWorkflowErrorPayload.bind(this),
                getRequestBody: this.getRequestBody.bind(this),
                legacyPipelinesEnabled: this.legacyPipelinesEnabled.bind(this),
                extractQuery: this.extractQuery.bind(this),
            }),
        });

        const actual = this.server?.port ?? listenPort;
        this.config.port = actual;
        if (!process.env.SILENT_MODE) {
            console.log(`[HTTP Server] Started at http://${this.config.host}:${actual}`);
            console.log(`[HTTP Server] OpenAPI spec: http://${this.config.host}:${actual}/openapi.json`);
            console.log(`[HTTP Server] Web UI: http://${this.config.host}:${actual}/ui`);
            console.log(`[HTTP Server] Health check: http://${this.config.host}:${actual}/health`);
        }

        // Dev warm-up probe to prime monitoring panels and learning stats with initial datapoints
        try {
            const shouldWarm = process.env.DEV_AUTO_WARMUP === '1' || process.env.NODE_ENV === 'development';
            if (shouldWarm) {
                const proxiedUrl = `http://${this.config.host}:${this.config.port}/api/v1/monitoring`;
                const httpRequest: HTTPRequest = {
                    method: 'GET',
                    url: proxiedUrl,
                    headers: {},
                    body: undefined,
                    query: {},
                };
                this.httpAdapter.handleRequest(httpRequest).catch(() => {});

                const lsUrl = `http://${this.config.host}:${this.config.port}/api/v1/learning-stats`;
                const httpRequest2: HTTPRequest = {
                    method: 'GET',
                    url: lsUrl,
                    headers: {},
                    body: undefined,
                    query: {},
                };
                this.httpAdapter.handleRequest(httpRequest2).catch(() => {});
            }
        } catch {}

        // Subscribe to layer performance to record layer latency histograms
        try {
            const ss: any = (this.coreAnalyzer as any).sharedServices;
            const bus: any = ss?.eventBus;
            bus?.on?.('layer-manager:performance-recorded', (perf: any) => {
                try {
                    recordLayerLatency('http', String(perf?.layer || 'unknown'), Number(perf?.duration || 0));
                } catch {}
            });
        } catch {}
    }

    async stop(): Promise<void> {
        if (this.server) {
            this.server.stop(true);
            this.server = null;
            if (!process.env.SILENT_MODE) {
                console.log(`[HTTP Server] Stopped`);
            }
        }

        if (this.coreAnalyzer) {
            await this.coreAnalyzer.dispose();
            (this as any).coreAnalyzer = undefined;
            (this as any).httpAdapter = undefined;
            (this as any).toolRouter = undefined;
            (this as any).toolExecutor = undefined;
            if (!process.env.SILENT_MODE) {
                console.log(`[HTTP Server] Core analyzer disposed`);
            }
        }

        // Nothing else to clean up
    }

    /**
     * Get server status and diagnostics
     */
    getStatus(): HTTPServerStatus {
        return {
            running: this.server !== null,
            config: this.config,
            adapter: this.httpAdapter?.getDiagnostics() || null,
            timestamp: Date.now(),
        };
    }

    // ===== PRIVATE HELPERS =====

    // Retain the historical server-level helpers for compatibility with
    // boundary tests and downstream diagnostics while the implementation
    // lives in the static-file module.
    private decodeStaticPath(encodedPath: string): string | null {
        return decodeHTTPStaticPath(encodedPath);
    }

    private findWebUiFile(
        relPath: string,
        subdirs: Array<'dist' | null>
    ): Promise<{ filePath: string; file: Buffer } | null> {
        return findHTTPWebUiFile(relPath, subdirs);
    }

    private async executeToolWorkflow(
        name: string,
        args: Record<string, any>,
        opts: { enforceHttpToolSurface?: boolean } = {}
    ): Promise<SnapshotWorkflowResult> {
        if (opts.enforceHttpToolSurface) this.assertHttpToolAllowed(name, args);
        return this.toolExecutor.execute(this.toolRouter, name, args);
    }

    private assertHttpToolAllowed(name: string, args: Record<string, any>): void {
        assertSharedHttpToolAllowed(name, args, { surface: 'HTTP tools/call surface' });
    }

    private toolWorkflowPayload(result: SnapshotWorkflowResult, fallback: any = {}): any {
        return workflowPayload(result, fallback);
    }

    private toolWorkflowErrorPayload(result: SnapshotWorkflowResult, fallbackMessage: string) {
        return workflowErrorPayload(result, fallbackMessage);
    }

    private normalizeToolWorkflowResultForHttp(result: SnapshotWorkflowResult): any {
        return normalizeWorkflowResult(result);
    }

    private async getRequestBody(request: Request): Promise<string | undefined> {
        return readLimitedJsonBody(request);
    }

    private legacyPipelinesEnabled(): boolean {
        return this.config.enableLegacyPipelines === true || process.env.SCI_ENABLE_LEGACY_HTTP_PIPELINES === '1';
    }

    private extractQuery(url: string): Record<string, string> {
        try {
            const parsed = new URL(url);
            const query: Record<string, string> = {};

            for (const [key, value] of parsed.searchParams.entries()) {
                query[key] = value;
            }

            return query;
        } catch {
            return {};
        }
    }
}

// Export for use as singleton
export let httpServer: HTTPServer | null = null;

/**
 * Create and start HTTP server
 */
export async function createHTTPServer(config?: HTTPServerConfig): Promise<HTTPServer> {
    if (httpServer) {
        await httpServer.stop();
    }

    httpServer = new HTTPServer(config);
    return httpServer;
}
// Start server if run directly
if (import.meta.main) {
    const server = new HTTPServer();

    // Handle shutdown
    process.on('SIGINT', async () => {
        if (!process.env.SILENT_MODE) {
            console.log('\n[HTTP Server] Shutting down...');
        }
        await server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
    });

    server.start().catch((error) => {
        console.error('[HTTP Server] Failed to start:', error);
        process.exit(1);
    });
}
