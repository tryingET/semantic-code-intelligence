/**
 * Adapter Integration Tests
 *
 * Tests all protocol adapters (LSP, MCP, HTTP, CLI) to ensure they correctly
 * convert between their protocol formats and the unified core, while maintaining
 * backward compatibility and consistent behavior.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { CLIAdapter } from '../src/adapters/cli-adapter.js';
import { HTTPAdapter } from '../src/adapters/http-adapter.js';
import { LSPAdapter } from '../src/adapters/lsp-adapter.js';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import {
    CompletionRequest,
    type CoreConfig,
    type EventBus,
    type FindDefinitionRequest,
    FindReferencesRequest,
    RenameRequest,
} from '../src/core/types.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig, testPaths, toFileUri } from './test-helpers';

// Test fixtures
interface AdapterTestContext {
    codeAnalyzer: CodeAnalyzer;
    layerManager: LayerManager;
    sharedServices: SharedServices;
    eventBus: EventBus;
    config: CoreConfig;
    adapters: {
        lsp: LSPAdapter;
        mcp: MCPAdapter;
        http: HTTPAdapter;
        cli: CLIAdapter;
    };
}

const createAdapterTestContext = async (): Promise<AdapterTestContext> => {
    // Create configuration using test helpers
    const config: CoreConfig = createTestConfig();

    // Initialize services and core
    const sharedServices = new SharedServices(config);
    await sharedServices.initialize();

    const layerManager = new LayerManager(config, sharedServices.eventBus);
    await layerManager.initialize();

    // Register mock layers for testing
    const mockLayers = [
        {
            name: 'layer1',
            targetLatency: 5,
            async process(request: any): Promise<any> {
                // Mock layer 1 - fast search
                return { data: [], fromLayer: 'layer1' };
            },
            async dispose(): Promise<void> {},
            getDiagnostics(): any {
                return { name: 'layer1', active: true };
            },
            isHealthy(): boolean {
                return true;
            },
        },
        {
            name: 'layer2',
            targetLatency: 50,
            async process(request: any): Promise<any> {
                // Mock layer 2 - AST analysis
                return { data: [], fromLayer: 'layer2' };
            },
            async dispose(): Promise<void> {},
            getDiagnostics(): any {
                return { name: 'layer2', active: true };
            },
            isHealthy(): boolean {
                return true;
            },
        },
        {
            name: 'layer3',
            targetLatency: 10,
            async process(request: any): Promise<any> {
                // Mock layer 3 - ontology
                return { data: [], fromLayer: 'layer3' };
            },
            async dispose(): Promise<void> {},
            getDiagnostics(): any {
                return { name: 'layer3', active: true };
            },
            isHealthy(): boolean {
                return true;
            },
        },
        {
            name: 'layer4',
            targetLatency: 10,
            async process(request: any): Promise<any> {
                // Mock layer 4 - patterns
                return { data: [], fromLayer: 'layer4' };
            },
            async dispose(): Promise<void> {},
            getDiagnostics(): any {
                return { name: 'layer4', active: true };
            },
            isHealthy(): boolean {
                return true;
            },
        },
        {
            name: 'layer5',
            targetLatency: 20,
            async process(request: any): Promise<any> {
                // Mock layer 5 - knowledge propagation
                return { data: [], fromLayer: 'layer5' };
            },
            async dispose(): Promise<void> {},
            getDiagnostics(): any {
                return { name: 'layer5', active: true };
            },
            isHealthy(): boolean {
                return true;
            },
        },
    ];

    // Register all mock layers (check if already registered to avoid conflicts)
    mockLayers.forEach((layer) => {
        try {
            layerManager.registerLayer(layer);
        } catch (error) {
            // Layer already registered - continue with existing layer
            if (error instanceof Error && error.message.includes('already registered')) {
                console.log(`Layer ${layer.name} already registered, skipping...`);
            } else {
                throw error;
            }
        }
    });

    const codeAnalyzer = new CodeAnalyzer(layerManager, sharedServices, config, sharedServices.eventBus);
    await codeAnalyzer.initialize();

    // Initialize all adapters (no initialize() method needed)
    const lspAdapter = new LSPAdapter(codeAnalyzer, {
        enableDiagnostics: true,
        enableCodeLens: true,
        enableFolding: true,
        maxResults: 50,
        timeout: 30000,
    });

    const mcpAdapter = new MCPAdapter(codeAnalyzer, {
        maxResults: 50,
    });

    const httpAdapter = new HTTPAdapter(codeAnalyzer, {
        port: 7010, // Test port
        host: 'localhost',
        cors: {
            enabled: true,
            origins: ['*'],
        },
        rateLimit: {
            windowMs: 60000,
            maxRequests: 100,
        },
    });

    const cliAdapter = new CLIAdapter(codeAnalyzer, {
        appName: 'semantic-code-intelligence-test',
        version: '1.0.0-test',
        maxResults: 50,
    });

    return {
        codeAnalyzer,
        layerManager,
        sharedServices,
        eventBus: sharedServices.eventBus,
        config,
        adapters: {
            lsp: lspAdapter,
            mcp: mcpAdapter,
            http: httpAdapter,
            cli: cliAdapter,
        },
    };
};

// Test data using proper path helpers
const testFile = toFileUri('tests/fixtures/example.ts');
const testPosition = { line: 10, character: 5 };
const testSymbol = 'TestFunction';

describe('Protocol Adapters Integration', () => {
    let context: AdapterTestContext;

    beforeAll(async () => {
        context = await createAdapterTestContext();
    });

    afterAll(async () => {
        // Adapters don't have dispose methods, only core services do
        if (context?.codeAnalyzer) {
            await context.codeAnalyzer.dispose();
        }
        if (context?.layerManager) {
            await context.layerManager.dispose();
        }
        if (context?.sharedServices) {
            await context.sharedServices.dispose();
        }
    });

    describe('LSP Adapter', () => {
        test('should convert LSP definition requests correctly', async () => {
            const lspRequest = {
                textDocument: { uri: testFile },
                position: testPosition,
            };

            // Test the adapter's conversion and execution
            const result = await context.adapters.lsp.handleDefinition(lspRequest);

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);

            // LSP should return Location[] format
            if (result.length > 0) {
                expect(result[0]).toHaveProperty('uri');
                expect(result[0]).toHaveProperty('range');
                expect(result[0].range).toHaveProperty('start');
                expect(result[0].range).toHaveProperty('end');
            }
        });

        test('should convert LSP references requests correctly', async () => {
            const lspRequest = {
                textDocument: { uri: testFile },
                position: testPosition,
                context: { includeDeclaration: true },
            };

            const result = await context.adapters.lsp.handleReferences(lspRequest);

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);

            // LSP references return Location[] format
            if (result.length > 0) {
                expect(result[0]).toHaveProperty('uri');
                expect(result[0]).toHaveProperty('range');
            }
        });

        test('should handle LSP rename requests correctly', async () => {
            // First prepare rename
            const prepareRequest = {
                textDocument: { uri: testFile },
                position: testPosition,
            };

            const prepareResult = await context.adapters.lsp.handlePrepareRename(prepareRequest);

            if (prepareResult) {
                expect(prepareResult).toHaveProperty('range');
                expect(prepareResult).toHaveProperty('placeholder');

                // Then execute rename
                const renameRequest = {
                    textDocument: { uri: testFile },
                    position: testPosition,
                    newName: 'RenamedFunction',
                };

                const renameResult = await context.adapters.lsp.handleRename(renameRequest);
                expect(renameResult).toBeDefined();
                expect(renameResult).toHaveProperty('changes');
            }
        });

        test('should provide LSP completions correctly', async () => {
            const lspRequest = {
                textDocument: { uri: testFile },
                position: testPosition,
                context: { triggerKind: 1 }, // Invoked
            };

            const result = await context.adapters.lsp.handleCompletion(lspRequest);

            expect(result).toBeDefined();

            if (Array.isArray(result)) {
                // CompletionItem[] format
                if (result.length > 0) {
                    expect(result[0]).toHaveProperty('label');
                    expect(typeof result[0].label).toBe('string');
                }
            } else if (result) {
                // CompletionList format
                expect(result).toHaveProperty('items');
                expect(Array.isArray(result.items)).toBe(true);
            }
        });

        test('should maintain LSP protocol compliance', async () => {
            // Test server capabilities
            const capabilities = context.adapters.lsp.getCapabilities();

            expect(capabilities.definitionProvider).toBe(true);
            expect(capabilities.referencesProvider).toBe(true);
            expect(capabilities.renameProvider).toBeTruthy();
            expect(capabilities.completionProvider).toBeDefined();
        });
    });

    describe('MCP Adapter', () => {
        test('should handle find_definition tool correctly', async () => {
            const mcpRequest = {
                name: 'find_definition',
                arguments: {
                    symbol: testSymbol,
                    file: testFile,
                    position: testPosition,
                },
            };

            const result = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('content');
            expect(Array.isArray(result.content)).toBe(true);
        });

        test('should handle find_definition tool with advanced options', async () => {
            const mcpRequest = {
                name: 'find_definition',
                arguments: {
                    symbol: testSymbol,
                    file: testFile,
                    position: testPosition,
                },
            };

            const result = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('content');
            expect(Array.isArray(result.content)).toBe(true);
        });

        test('should handle find_references tool correctly', async () => {
            const mcpRequest = {
                name: 'find_references',
                arguments: {
                    symbol: testSymbol,
                    includeDeclaration: true,
                    scope: 'workspace',
                },
            };

            const result = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('content');
            expect(Array.isArray(result.content)).toBe(true);
        });

        test('should handle get_completions tool correctly', async () => {
            const mcpRequest = {
                name: 'get_completions',
                arguments: {
                    file: testFile,
                    position: testPosition,
                    maxResults: 20,
                },
            };

            const result = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('content');
            expect(Array.isArray(result.content)).toBe(true);

            const text = result.content?.[0]?.text;
            expect(typeof text).toBe('string');
            const payload = JSON.parse(text);
            expect(Array.isArray(payload.completions)).toBe(true);
            expect(payload.completions.length).toBeGreaterThan(0);
            expect(typeof payload.completions[0].label).toBe('string');
            expect(typeof payload.completions[0].kind).toBe('number');
            expect(payload.completions[0].kind).toBeGreaterThanOrEqual(1);
            expect(payload.completions[0].kind).toBeLessThanOrEqual(25);
        });

        test('should handle rename_symbol tool correctly', async () => {
            const mcpRequest = {
                name: 'rename_symbol',
                arguments: {
                    oldName: testSymbol,
                    newName: 'RenamedFunction',
                    preview: true,
                },
            };

            const result = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('content');
        });

        test('should handle generate_tests tool correctly', async () => {
            const mcpRequest = {
                name: 'generate_tests',
                arguments: {
                    target: testFile,
                    framework: 'bun',
                    coverage: 'comprehensive',
                },
            };

            const result = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('content');
        });

        test('should provide correct MCP tool list', async () => {
            const tools = context.adapters.mcp.getTools();

            expect(Array.isArray(tools)).toBe(true);
            expect(tools.length).toBeGreaterThan(0);

            const toolNames = tools.map((tool) => tool.name);
            expect(toolNames).toContain('find_definition');
            expect(toolNames).toContain('find_references');
            expect(toolNames).toContain('rename_symbol');
            expect(toolNames).toContain('generate_tests');
        });

        test('should handle invalid MCP tool requests gracefully', async () => {
            const invalidRequest = {
                name: 'non_existent_tool',
                arguments: {},
            };

            const result = await context.adapters.mcp.handleToolCall(invalidRequest.name, invalidRequest.arguments);
            expect(result).toHaveProperty('isError');
            expect(result.isError).toBe(true);
            expect(result).toHaveProperty('error');
            expect(result.error.message).toContain('Unknown tool');
        });
    });

    describe('HTTP Adapter', () => {
        test('should handle POST /api/definition requests correctly', async () => {
            const httpRequest = {
                method: 'POST',
                url: '/api/v1/definition',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    identifier: testSymbol,
                    uri: testFile,
                    position: testPosition,
                    includeDeclaration: true,
                }),
            };

            const response = await context.adapters.http.handleRequest(httpRequest);

            expect(response.status).toBe(200);
            expect(response.headers['Content-Type']).toContain('application/json');

            const responseBody = JSON.parse(response.body);
            expect(responseBody).toHaveProperty('data');
            expect(responseBody).toHaveProperty('performance');
            expect(responseBody).toHaveProperty('requestId');
            expect(Array.isArray(responseBody.data)).toBe(true);
        });

        test('should handle GET /api/references requests correctly', async () => {
            const httpRequest = {
                method: 'POST',
                url: `/api/v1/references`,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    identifier: testSymbol,
                    uri: testFile,
                    includeDeclaration: true,
                }),
            };

            const response = await context.adapters.http.handleRequest(httpRequest);

            expect(response.status).toBe(200);
            const responseBody = JSON.parse(response.body);
            expect(responseBody).toHaveProperty('data');
            expect(Array.isArray(responseBody.data)).toBe(true);
        });

        test('should handle POST /api/rename requests correctly', async () => {
            const httpRequest = {
                method: 'POST',
                url: '/api/v1/rename',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    identifier: testSymbol,
                    newName: 'RenamedFunction',
                    uri: testFile,
                    position: testPosition,
                    dryRun: true,
                }),
            };

            const response = await context.adapters.http.handleRequest(httpRequest);

            expect(response.status).toBe(200);
            const responseBody = JSON.parse(response.body);
            expect(responseBody).toHaveProperty('data');
            expect(responseBody.data).toHaveProperty('changes');
        });

        test('should handle GET /api/completions requests correctly', async () => {
            const httpRequest = {
                method: 'POST',
                url: `/api/v1/completions`,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    uri: testFile,
                    position: testPosition,
                    triggerKind: 1,
                }),
            };

            const response = await context.adapters.http.handleRequest(httpRequest);

            expect(response.status).toBe(200);
            const responseBody = JSON.parse(response.body);
            expect(responseBody).toHaveProperty('data');
            expect(Array.isArray(responseBody.data)).toBe(true);
            expect(responseBody.data.length).toBeGreaterThan(0);
            expect(typeof responseBody.data[0].label).toBe('string');
            expect(typeof responseBody.data[0].kind).toBe('number');
            expect(responseBody.data[0].kind).toBeGreaterThanOrEqual(1);
            expect(responseBody.data[0].kind).toBeLessThanOrEqual(25);
        });

        test('should provide health check endpoint', async () => {
            const httpRequest = {
                method: 'GET',
                url: '/health',
                headers: {},
            };

            const response = await context.adapters.http.handleRequest(httpRequest);

            expect(response.status).toBe(200);
            const responseBody = JSON.parse(response.body);
            expect(responseBody).toHaveProperty('status');
            expect(responseBody.status).toBe('healthy');
        });

        test('should handle CORS requests correctly', async () => {
            const corsRequest = {
                method: 'OPTIONS',
                url: '/api/definition',
                headers: {
                    origin: 'https://example.com',
                    'access-control-request-method': 'POST',
                    'access-control-request-headers': 'content-type',
                },
            };

            const response = await context.adapters.http.handleRequest(corsRequest);

            expect(response.status).toBe(200);
            expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
            expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
            expect(response.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
        });

        test('should handle HTTP errors gracefully', async () => {
            const invalidRequest = {
                method: 'POST',
                url: '/api/v1/definition',
                headers: { 'content-type': 'application/json' },
                body: 'invalid json',
            };

            const response = await context.adapters.http.handleRequest(invalidRequest);

            expect(response.status).toBe(400);
            const responseBody = JSON.parse(response.body);
            expect(responseBody).toHaveProperty('error');
        });
    });

    describe('CLI Adapter', () => {
        test("should handle 'find' command correctly", async () => {
            const result = await context.adapters.cli.handleFind(testSymbol, { file: testFile, maxResults: 10 });

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            // CLI adapter now returns structured data for consistency tests
        });

        test("should handle 'references' command correctly", async () => {
            const result = await context.adapters.cli.handleReferences(testSymbol, {
                includeDeclaration: true,
                maxResults: 10,
            });

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            // CLI adapter now returns structured data for consistency tests
        });

        test("should handle 'rename' command correctly", async () => {
            const result = await context.adapters.cli.handleRename(testSymbol, 'NewName', { dryRun: true });

            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });

        test("should handle 'stats' command correctly", async () => {
            const result = await context.adapters.cli.handleStats();

            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            expect(result).toContain('Status:');
        });

        test('should handle invalid input gracefully', async () => {
            // Test with empty identifier
            const result = await context.adapters.cli.handleFind('');
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            // Should handle gracefully, not crash
        });
    });

    describe('Cross-Adapter Consistency', () => {
        test('should return equivalent results across all adapters for definition', async () => {
            const coreRequest: FindDefinitionRequest = {
                identifier: testSymbol,
                uri: testFile,
                position: testPosition,
                includeDeclaration: true,
            };

            // Get result from core analyzer
            const coreResult = await context.codeAnalyzer.findDefinition(coreRequest);

            // Test LSP adapter
            const lspRequest = {
                textDocument: { uri: testFile },
                position: testPosition,
            };
            const lspResult = await context.adapters.lsp.handleDefinition(lspRequest);

            // Test MCP adapter
            const mcpRequest = {
                name: 'find_definition',
                arguments: {
                    symbol: testSymbol,
                    file: testFile,
                    position: testPosition,
                },
            };
            const mcpResult = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);

            // Test HTTP adapter
            const httpRequest = {
                method: 'POST',
                url: '/api/v1/definition',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(coreRequest),
            };
            const httpResponse = await context.adapters.http.handleRequest(httpRequest);
            const httpResult = JSON.parse(httpResponse.body);

            // Test CLI adapter
            const cliResult = await context.adapters.cli.handleFind(testSymbol, { file: testFile });

            // All adapters should return data (even if empty)
            expect(coreResult.data).toBeDefined();
            expect(lspResult).toBeDefined();
            expect(mcpResult.content).toBeDefined();
            expect(httpResult.data).toBeDefined();
            expect(Array.isArray(cliResult)).toBe(true);

            // Results should be consistent in structure
            if (coreResult.data.length > 0) {
                expect(Array.isArray(lspResult)).toBe(true);
                expect(Array.isArray(mcpResult.content)).toBe(true);
                expect(Array.isArray(httpResult.data)).toBe(true);
            }
        });

        test('should handle errors consistently across adapters', async () => {
            const invalidSymbol = '';

            // Test how each adapter handles invalid input

            // LSP adapter
            const lspRequest = {
                textDocument: { uri: testFile },
                position: testPosition,
            };

            // Should not throw but return empty results or handle gracefully
            const lspResult = await context.adapters.lsp.handleDefinition(lspRequest);
            expect(lspResult).toBeDefined();

            // MCP adapter
            const mcpRequest = {
                name: 'find_definition',
                arguments: {
                    symbol: invalidSymbol,
                    file: testFile,
                },
            };

            // Should handle gracefully
            const mcpResult = await context.adapters.mcp.handleToolCall(mcpRequest.name, mcpRequest.arguments);
            expect(mcpResult).toBeDefined();

            // HTTP adapter
            const httpRequest = {
                method: 'POST',
                url: '/api/definition',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    identifier: invalidSymbol,
                    uri: testFile,
                    position: testPosition,
                }),
            };

            const httpResponse = await context.adapters.http.handleRequest(httpRequest);
            // Should return a proper error response or empty result
            expect([200, 400, 404]).toContain(httpResponse.status);

            // CLI adapter
            const cliResult = await context.adapters.cli.handleFind(invalidSymbol, { file: testFile });
            expect(cliResult).toBeDefined();
            // CLI should return structured data (even if empty array)
            expect(Array.isArray(cliResult)).toBe(true);
        });
    });

    describe('Backward Compatibility', () => {
        test('should maintain compatibility with existing LSP clients', async () => {
            // Test that standard LSP methods are available and working
            const capabilities = context.adapters.lsp.getCapabilities();

            expect(capabilities).toHaveProperty('definitionProvider');
            expect(capabilities).toHaveProperty('referencesProvider');
            expect(capabilities).toHaveProperty('renameProvider');
            expect(capabilities).toHaveProperty('completionProvider');

            // Test standard LSP request/response format
            const lspRequest = {
                textDocument: { uri: testFile },
                position: testPosition,
            };

            const result = await context.adapters.lsp.handleDefinition(lspRequest);

            // Should return LSP-compliant Location[] or LocationLink[]
            expect(Array.isArray(result)).toBe(true);
        });

        test('should maintain compatibility with existing MCP tools', async () => {
            const tools = context.adapters.mcp.getTools();

            // Should have all expected MCP tools
            const toolNames = tools.map((tool) => tool.name);
            expect(toolNames).toContain('find_definition');
            expect(toolNames).toContain('find_references');
            expect(toolNames).toContain('rename_symbol');
            expect(toolNames).toContain('generate_tests');

            // Each tool should have proper schema
            tools.forEach((tool) => {
                expect(tool).toHaveProperty('name');
                expect(tool).toHaveProperty('description');
                expect(tool).toHaveProperty('inputSchema');
            });
        });

        test('should maintain compatibility with existing HTTP API clients', async () => {
            // Test that existing REST endpoints still work
            const endpoints = ['/api/v1/definition', '/api/v1/references', '/api/v1/completions', '/health'];

            for (const endpoint of endpoints) {
                const httpRequest = {
                    method: endpoint === '/health' ? 'GET' : 'POST',
                    url: endpoint,
                    headers: { 'content-type': 'application/json' },
                    body:
                        endpoint !== '/health'
                            ? JSON.stringify({
                                  identifier: testSymbol,
                                  uri: testFile,
                                  position: testPosition,
                              })
                            : undefined,
                };

                const response = await context.adapters.http.handleRequest(httpRequest);

                // Should return a valid HTTP response
                expect(response.status).toBeGreaterThanOrEqual(200);
                expect(response.status).toBeLessThan(500);
                expect(response.headers).toHaveProperty('Content-Type');
                if (response.headers['Content-Type']) {
                    expect(response.headers['Content-Type']).toContain('application/json');
                }
            }
        });

        test('should maintain compatibility with existing CLI usage', async () => {
            // Test that existing CLI methods work
            const findResult = await context.adapters.cli.handleFind(testSymbol);
            expect(findResult).toBeDefined();
            expect(typeof findResult).toBe('string');

            const referencesResult = await context.adapters.cli.handleReferences(testSymbol);
            expect(referencesResult).toBeDefined();
            expect(typeof referencesResult).toBe('string');

            const statsResult = await context.adapters.cli.handleStats();
            expect(statsResult).toBeDefined();
            expect(typeof statsResult).toBe('string');
        });
    });

    describe('Performance Across Adapters', () => {
        test('should meet performance targets across all adapters', async () => {
            const performanceTests = [
                {
                    name: 'LSP Definition',
                    test: async () => {
                        const start = Date.now();
                        await context.adapters.lsp.handleDefinition({
                            textDocument: { uri: testFile },
                            position: testPosition,
                        });
                        return Date.now() - start;
                    },
                },
                {
                    name: 'MCP Find Definition',
                    test: async () => {
                        const start = Date.now();
                        await context.adapters.mcp.handleToolCall('find_definition', {
                            symbol: testSymbol,
                            file: testFile,
                        });
                        return Date.now() - start;
                    },
                },
                {
                    name: 'HTTP Definition',
                    test: async () => {
                        const start = Date.now();
                        await context.adapters.http.handleRequest({
                            method: 'POST',
                            url: '/api/definition',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                                identifier: testSymbol,
                                uri: testFile,
                                position: testPosition,
                            }),
                        });
                        return Date.now() - start;
                    },
                },
                {
                    name: 'CLI Find',
                    test: async () => {
                        const start = Date.now();
                        await context.adapters.cli.handleFind(testSymbol);
                        return Date.now() - start;
                    },
                },
            ];

            for (const { name, test } of performanceTests) {
                const duration = await test();

                // All adapters should complete within reasonable time
                // (including adapter overhead on top of core performance)
                expect(duration).toBeLessThan(150); // Allow extra time for adapter layer
                console.log(`${name}: ${duration}ms`);
            }
        });
    });
});
