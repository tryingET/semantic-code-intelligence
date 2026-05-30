/**
 * Centralized configuration for all servers and clients
 * This ensures no port conflicts and consistent settings across the system
 */

import { loadRuntimeConfig } from '../runtime-config.js';

export interface ServerPorts {
    httpAPI: number;
    mcpHTTP: number; // MCP HTTP (Streamable) server port
    lspServer: number;
    testAPI: number;
    testMCP: number;
    testLSP: number;
}

export interface ServerConfig {
    ports: ServerPorts;
    host: string;
    timeout: number;
    maxRetries: number;
    cacheEnabled: boolean;
    cacheTTL: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetTimeout: number;
}

/**
 * Default configuration for all servers
 */
export const DEFAULT_CONFIG: ServerConfig = {
    ports: {
        httpAPI: 7000, // Main HTTP API server
        mcpHTTP: 7001, // MCP HTTP (Streamable) server
        lspServer: 7002, // LSP server (can run TCP or stdio)
        testAPI: 7010, // Test HTTP API server
        testMCP: 7011, // Test MCP server
        testLSP: 7012, // Test LSP server
    },
    host: 'localhost',
    timeout: 5000,
    maxRetries: 3,
    cacheEnabled: true,
    cacheTTL: 300000, // 5 minutes
    circuitBreakerThreshold: 5,
    circuitBreakerResetTimeout: 30000, // 30 seconds
};

/**
 * Environment-based configuration overrides
 */
function parseIntegerEnv(name: string, value: string): number {
    if (!/^\d+$/.test(value.trim())) {
        throw new Error(`Invalid numeric environment variable ${name}: ${value}`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`Invalid numeric environment variable ${name}: ${value}`);
    }
    return parsed;
}

export function getConfig(startDir = process.cwd()): ServerConfig {
    const config: ServerConfig = { ...DEFAULT_CONFIG, ports: { ...DEFAULT_CONFIG.ports } };
    applyRuntimeServerConfig(config, startDir);

    // Allow environment variables to override defaults
    if (process.env.HTTP_API_PORT) {
        config.ports.httpAPI = parseIntegerEnv('HTTP_API_PORT', process.env.HTTP_API_PORT);
    }
    if (process.env.MCP_HTTP_PORT) {
        config.ports.mcpHTTP = parseIntegerEnv('MCP_HTTP_PORT', process.env.MCP_HTTP_PORT);
    }
    if (process.env.LSP_SERVER_PORT) {
        config.ports.lspServer = parseIntegerEnv('LSP_SERVER_PORT', process.env.LSP_SERVER_PORT);
    }
    if (process.env.LSP_TIMEOUT) {
        config.timeout = parseIntegerEnv('LSP_TIMEOUT', process.env.LSP_TIMEOUT);
    }
    if (process.env.LSP_MAX_RETRIES) {
        config.maxRetries = parseIntegerEnv('LSP_MAX_RETRIES', process.env.LSP_MAX_RETRIES);
    }
    if (process.env.LSP_CACHE_ENABLED) {
        config.cacheEnabled = process.env.LSP_CACHE_ENABLED === 'true';
    }
    if (process.env.LSP_CACHE_TTL) {
        config.cacheTTL = parseIntegerEnv('LSP_CACHE_TTL', process.env.LSP_CACHE_TTL);
    }

    validatePorts(config);
    return config;
}

function parseIntegerConfig(name: string, value: unknown): number {
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw new Error(`Invalid numeric runtime configuration ${name}: ${String(value)}`);
    }
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) {
        throw new Error(`Invalid numeric runtime configuration ${name}: ${String(value)}`);
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`Invalid numeric runtime configuration ${name}: ${String(value)}`);
    }
    return parsed;
}

function parseBooleanConfig(name: string, value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    throw new Error(`Invalid boolean runtime configuration ${name}: ${String(value)}`);
}

function applyRuntimeServerConfig(config: ServerConfig, startDir: string): void {
    const runtime = loadRuntimeConfig(startDir);
    const server = runtime?.data?.server;
    if (!server || typeof server !== 'object' || Array.isArray(server)) return;

    if (typeof server.host === 'string' && server.host.trim()) config.host = server.host.trim();
    const ports = server.ports;
    if (ports && typeof ports === 'object' && !Array.isArray(ports)) {
        for (const key of Object.keys(config.ports) as Array<keyof ServerPorts>) {
            if (ports[key] !== undefined) config.ports[key] = parseIntegerConfig(`server.ports.${key}`, ports[key]);
        }
    }
    if (server.timeout !== undefined) config.timeout = parseIntegerConfig('server.timeout', server.timeout);
    if (server.maxRetries !== undefined) config.maxRetries = parseIntegerConfig('server.maxRetries', server.maxRetries);
    if (server.cacheEnabled !== undefined)
        config.cacheEnabled = parseBooleanConfig('server.cacheEnabled', server.cacheEnabled);
    if (server.cacheTTL !== undefined) config.cacheTTL = parseIntegerConfig('server.cacheTTL', server.cacheTTL);
}

/**
 * Test configuration with different ports to avoid conflicts
 */
export function getTestConfig(): ServerConfig {
    const config: ServerConfig = {
        ...DEFAULT_CONFIG,
        ports: {
            httpAPI: 7010, // Test instance of HTTP API
            mcpHTTP: 7011, // Test instance of MCP HTTP
            lspServer: 7012, // Test instance of LSP
            testAPI: 7020, // Isolated test target API
            testMCP: 7021, // Isolated test target MCP
            testLSP: 7022, // Isolated test target LSP
        },
        timeout: 1000, // Shorter timeout for tests
        maxRetries: 1, // Fewer retries for tests
        cacheEnabled: false, // Disable cache for tests
    };

    if (process.env.TEST_API_PORT) {
        config.ports.testAPI = parseIntegerEnv('TEST_API_PORT', process.env.TEST_API_PORT);
    }
    if (process.env.TEST_MCP_PORT) {
        config.ports.testMCP = parseIntegerEnv('TEST_MCP_PORT', process.env.TEST_MCP_PORT);
    }
    if (process.env.TEST_LSP_PORT) {
        config.ports.testLSP = parseIntegerEnv('TEST_LSP_PORT', process.env.TEST_LSP_PORT);
    }

    validatePorts(config);
    return config;
}

/**
 * Get the appropriate configuration based on environment
 */
export function getEnvironmentConfig(startDir = process.cwd()): ServerConfig {
    const isTest = process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test';
    return isTest ? getTestConfig() : getConfig(startDir);
}

/**
 * Validate that ports are available and not conflicting
 */
export function validatePorts(config: ServerConfig): void {
    const ports = Object.values(config.ports);
    const uniquePorts = new Set(ports);

    if (ports.length !== uniquePorts.size) {
        throw new Error('Port conflict detected in configuration');
    }

    // Check if ports are in valid range
    for (const port of ports) {
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
            throw new Error(`Invalid port number: ${port}. Must be an integer between 1024 and 65535`);
        }
    }
}

/**
 * Get URL for a specific service
 */
export function getServiceUrl(service: keyof ServerPorts, config?: ServerConfig): string {
    const cfg = config || getEnvironmentConfig();
    const port = cfg.ports[service];
    return `http://${cfg.host}:${port}`;
}

/**
 * Log the current configuration
 */
export function logConfig(config: ServerConfig): void {
    // Skip logging in stdio/silent modes to avoid polluting MCP protocol
    if (process.env.STDIO_MODE || process.env.SILENT_MODE) {
        return;
    }

    console.log('Server Configuration:');
    console.log('=====================');
    console.log(`HTTP API Server: ${config.host}:${config.ports.httpAPI}`);
    console.log(`MCP HTTP Server: ${config.host}:${config.ports.mcpHTTP}`);
    console.log(`LSP Server:      ${config.host}:${config.ports.lspServer} (or stdio)`);
    console.log(
        `Test Servers:    ${config.host}:${config.ports.testAPI} (API), ${config.host}:${config.ports.testMCP} (MCP), ${config.host}:${config.ports.testLSP} (LSP)`
    );
    console.log(`Timeout:         ${config.timeout}ms`);
    console.log(`Max Retries:     ${config.maxRetries}`);
    console.log(`Cache:           ${config.cacheEnabled ? 'Enabled' : 'Disabled'}`);
    if (config.cacheEnabled) {
        console.log(`Cache TTL:       ${config.cacheTTL}ms`);
    }
    console.log('=====================');
}
