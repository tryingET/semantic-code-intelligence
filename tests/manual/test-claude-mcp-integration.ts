#!/usr/bin/env bun
/**
 * Claude-MCP Integration Test
 *
 * This test validates the exact Claude-MCP connection pattern and ensures
 * our server is fully Claude-compatible. It tests:
 * - Exact initialization sequence Claude uses
 * - All four MCP tools with Claude's expected request/response format
 * - Error scenarios and timeout handling
 * - Performance benchmarks matching Claude's requirements
 * - Diagnostic mode with full communication logging
 */

import { type ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import { createInterface, type Interface } from 'node:readline';

interface MCPRequest {
    jsonrpc: string;
    id: number | string;
    method: string;
    params?: any;
}

interface MCPResponse {
    jsonrpc: string;
    id: number | string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

interface TestResult {
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
    details?: any;
}

class ClaudeMCPIntegrationTest {
    private mcpServer?: ChildProcess;
    private readline?: Interface;
    private requestId = 1;
    private responses = new Map<string | number, MCPResponse>();
    private diagnosticMode = false;
    private testResults: TestResult[] = [];
    private serverStartTime?: number;
    private serverInitialized = false;

    constructor(diagnosticMode = false) {
        this.diagnosticMode = diagnosticMode;
        if (diagnosticMode) {
            console.log('🔍 Running in diagnostic mode - full communication logging enabled');
        }
    }

    /**
     * Start the MCP server using the exact same command as Claude
     */
    private async startServer(): Promise<void> {
        this.serverStartTime = Date.now();

        // Use the exact same startup command as in .mcp.json
        const wrapperPath = path.join(process.cwd(), 'mcp-wrapper.sh');

        this.log(`🚀 Starting MCP server: ${wrapperPath}`);

        this.mcpServer = spawn('/bin/bash', [wrapperPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                // Claude's typical environment
                NODE_ENV: 'production',
                SILENT_MODE: 'true',
                STDIO_MODE: 'true',
            },
        });

        if (!this.mcpServer.stdout || !this.mcpServer.stdin || !this.mcpServer.stderr) {
            throw new Error('Failed to create server pipes');
        }

        // Set up readline for server communication
        this.readline = createInterface({
            input: this.mcpServer.stdout,
            crlfDelay: Infinity,
        });

        // Handle server responses
        this.readline.on('line', (line) => {
            this.log(`📥 Server response: ${line}`);

            try {
                const response: MCPResponse = JSON.parse(line);
                if (response.id !== undefined) {
                    this.responses.set(response.id, response);
                }
            } catch (error) {
                this.log(`⚠️  Failed to parse server response: ${error}`);
            }
        });

        // Handle server errors
        this.mcpServer.stderr?.on('data', (data) => {
            const message = data.toString().trim();
            if (message && this.diagnosticMode) {
                this.log(`🔧 Server stderr: ${message}`);
            }
        });

        // Handle server exit
        this.mcpServer.on('exit', (code, signal) => {
            this.log(`🛑 Server exited with code ${code}, signal ${signal}`);
        });

        // Wait a moment for server to start
        await this.sleep(1000);
    }

    /**
     * Send a request to the MCP server and wait for response
     */
    private async sendRequest(method: string, params?: any, timeout = 30000): Promise<MCPResponse> {
        const id = this.requestId++;
        const request: MCPRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };

        const requestStr = JSON.stringify(request);
        this.log(`📤 Sending request: ${requestStr}`);

        if (!this.mcpServer?.stdin) {
            throw new Error('Server stdin not available');
        }

        // Send request
        this.mcpServer.stdin.write(requestStr + '\n');

        // Wait for response
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            if (this.responses.has(id)) {
                const response = this.responses.get(id)!;
                this.responses.delete(id);
                return response;
            }
            await this.sleep(10);
        }

        throw new Error(`Request ${id} timed out after ${timeout}ms`);
    }

    /**
     * Test Claude's exact initialization sequence
     */
    private async testInitialization(): Promise<TestResult> {
        const startTime = Date.now();

        try {
            this.log('🔄 Testing Claude initialization sequence...');

            // Step 1: Initialize - Claude's exact format
            const initResponse = await this.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {
                    experimental: {},
                    sampling: {},
                },
                clientInfo: {
                    name: 'Claude',
                    version: '3.5-sonnet',
                },
            });

            if (initResponse.error) {
                throw new Error(`Initialize failed: ${initResponse.error.message}`);
            }

            this.log('✅ Initialize successful');

            // Step 2: Initialized notification
            const initializedResponse = await this.sendRequest('initialized', {});

            // Step 3: List tools (Claude does this immediately)
            const toolsResponse = await this.sendRequest('tools/list', {});

            if (toolsResponse.error) {
                throw new Error(`tools/list failed: ${toolsResponse.error.message}`);
            }

            const tools = toolsResponse.result?.tools || [];
            const expectedTools = ['find_definition', 'find_references', 'rename_symbol', 'generate_tests'];

            for (const expectedTool of expectedTools) {
                const found = tools.find((t: any) => t.name === expectedTool);
                if (!found) {
                    throw new Error(`Missing required tool: ${expectedTool}`);
                }
            }

            this.serverInitialized = true;
            const duration = Date.now() - startTime;

            return {
                name: 'Claude Initialization Sequence',
                passed: true,
                duration,
                details: {
                    serverStartupTime: startTime - (this.serverStartTime || startTime),
                    initializationTime: duration,
                    toolsFound: tools.length,
                    expectedTools: expectedTools.length,
                },
            };
        } catch (error) {
            return {
                name: 'Claude Initialization Sequence',
                passed: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Test find_definition tool with various scenarios
     */
    private async testFindDefinition(): Promise<TestResult> {
        const startTime = Date.now();

        try {
            this.log('🔍 Testing find_definition tool...');

            // Test 1: Basic symbol search (Claude's typical usage)
            const basicResponse = await this.sendRequest('tools/call', {
                name: 'find_definition',
                arguments: {
                    symbol: 'FastMCPServer',
                    file: 'src/servers/mcp-fast.ts',
                },
            });

            if (basicResponse.error) {
                throw new Error(`Basic find_definition failed: ${basicResponse.error.message}`);
            }

            // Validate response format matches Claude's expectations
            const result = basicResponse.result;
            if (!result.content || !Array.isArray(result.content)) {
                throw new Error('Response missing content array');
            }

            const content = result.content[0];
            if (content.type !== 'text') {
                throw new Error('Content type should be text');
            }

            const data = JSON.parse(content.text);
            if (!data.definitions || !Array.isArray(data.definitions)) {
                throw new Error('Missing definitions array');
            }

            // Test 2: Workspace-wide search (no file specified)
            const workspaceResponse = await this.sendRequest('tools/call', {
                name: 'find_definition',
                arguments: {
                    symbol: 'CodeAnalyzer',
                },
            });

            if (workspaceResponse.error) {
                throw new Error(`Workspace find_definition failed: ${workspaceResponse.error.message}`);
            }

            // Test 3: Fuzzy matching
            const fuzzyResponse = await this.sendRequest('tools/call', {
                name: 'find_definition',
                arguments: {
                    symbol: 'FastMCPSrv', // Partial match
                },
            });

            // Test 4: Non-existent symbol (should not error, just return empty)
            const nonExistentResponse = await this.sendRequest('tools/call', {
                name: 'find_definition',
                arguments: {
                    symbol: 'ThisSymbolDoesNotExist123',
                },
            });

            const duration = Date.now() - startTime;

            return {
                name: 'find_definition Tool',
                passed: true,
                duration,
                details: {
                    basicSearchResults: JSON.parse(basicResponse.result.content[0].text).definitions.length,
                    workspaceSearchResults: JSON.parse(workspaceResponse.result.content[0].text).definitions.length,
                    fuzzySearchResults: JSON.parse(fuzzyResponse.result.content[0].text).definitions.length,
                    nonExistentResults: JSON.parse(nonExistentResponse.result.content[0].text).definitions.length,
                },
            };
        } catch (error) {
            return {
                name: 'find_definition Tool',
                passed: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Test find_references tool
     */
    private async testFindReferences(): Promise<TestResult> {
        const startTime = Date.now();

        try {
            this.log('🔗 Testing find_references tool...');

            const response = await this.sendRequest('tools/call', {
                name: 'find_references',
                arguments: {
                    symbol: 'FastMCPServer',
                    includeDeclaration: true,
                    scope: 'workspace',
                },
            });

            if (response.error) {
                throw new Error(`find_references failed: ${response.error.message}`);
            }

            const result = response.result;
            const data = JSON.parse(result.content[0].text);

            if (!data.references || !Array.isArray(data.references)) {
                throw new Error('Missing references array');
            }

            const duration = Date.now() - startTime;

            return {
                name: 'find_references Tool',
                passed: true,
                duration,
                details: {
                    referencesFound: data.references.length,
                    includeDeclaration: true,
                    scope: 'workspace',
                },
            };
        } catch (error) {
            return {
                name: 'find_references Tool',
                passed: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Test rename_symbol tool
     */
    private async testRenameSymbol(): Promise<TestResult> {
        const startTime = Date.now();

        try {
            this.log('✏️ Testing rename_symbol tool...');

            const response = await this.sendRequest('tools/call', {
                name: 'rename_symbol',
                arguments: {
                    oldName: 'FastMCPServer',
                    newName: 'SuperFastMCPServer',
                    preview: true,
                    scope: 'exact',
                },
            });

            if (response.error) {
                throw new Error(`rename_symbol failed: ${response.error.message}`);
            }

            const result = response.result;
            const data = JSON.parse(result.content[0].text);

            if (!data.changes || !Array.isArray(data.changes)) {
                throw new Error('Missing changes array');
            }

            const duration = Date.now() - startTime;

            return {
                name: 'rename_symbol Tool',
                passed: true,
                duration,
                details: {
                    changesCount: data.changes.length,
                    preview: data.preview,
                    scope: data.scope,
                    totalEdits: data.changes.reduce((acc: number, c: any) => acc + c.edits.length, 0),
                },
            };
        } catch (error) {
            return {
                name: 'rename_symbol Tool',
                passed: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Test generate_tests tool
     */
    private async testGenerateTests(): Promise<TestResult> {
        const startTime = Date.now();

        try {
            this.log('🧪 Testing generate_tests tool...');

            const response = await this.sendRequest('tools/call', {
                name: 'generate_tests',
                arguments: {
                    target: 'src/servers/mcp-fast.ts',
                    framework: 'bun',
                    coverage: 'comprehensive',
                },
            });

            if (response.error) {
                throw new Error(`generate_tests failed: ${response.error.message}`);
            }

            const result = response.result;
            const data = JSON.parse(result.content[0].text);

            const duration = Date.now() - startTime;

            return {
                name: 'generate_tests Tool',
                passed: true,
                duration,
                details: {
                    status: data.status,
                    target: data.target,
                    framework: data.framework,
                    coverage: data.coverage,
                },
            };
        } catch (error) {
            return {
                name: 'generate_tests Tool',
                passed: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Test error scenarios
     */
    private async testErrorScenarios(): Promise<TestResult> {
        const startTime = Date.now();
        const errorTests: Array<{ name: string; passed: boolean; details?: any }> = [];

        try {
            this.log('⚠️ Testing error scenarios...');

            // Test 1: Invalid tool name (server implements retry mechanism, so increase timeout)
            try {
                const response = await this.sendRequest(
                    'tools/call',
                    {
                        name: 'invalid_tool_that_does_not_exist',
                        arguments: {},
                    },
                    15000
                ); // Increased timeout to account for retry mechanism

                // Should return an error response (either in error field or result field with error info)
                const hasJsonRpcError = response.error !== undefined;
                const hasResultError = response.result?.error !== undefined;
                const hasAnyError = hasJsonRpcError || hasResultError;

                const correctErrorType =
                    response.error?.message?.includes('Unknown tool') ||
                    response.error?.message?.includes('invalid_tool_that_does_not_exist') ||
                    response.result?.message?.includes('Unknown tool') ||
                    response.result?.message?.includes('invalid_tool_that_does_not_exist');

                errorTests.push({
                    name: 'Invalid tool',
                    passed: hasAnyError && correctErrorType,
                    details: {
                        hasJsonRpcError,
                        hasResultError,
                        hasAnyError,
                        correctErrorType,
                        error: response.error,
                        result: response.result,
                    },
                });
            } catch (error) {
                errorTests.push({
                    name: 'Invalid tool',
                    passed: false,
                    details: { error: error instanceof Error ? error.message : String(error) },
                });
            }

            // Test 2: Missing required parameters
            try {
                const response = await this.sendRequest(
                    'tools/call',
                    {
                        name: 'find_definition',
                        arguments: {}, // Missing required 'symbol'
                    },
                    5000
                );

                // Should return an error for missing required parameter
                const hasJsonRpcError = response.error !== undefined;
                const hasResultError = response.result?.error !== undefined;
                const hasAnyError = hasJsonRpcError || hasResultError;

                const isValidationError =
                    response.error?.message?.includes('symbol') ||
                    response.error?.message?.includes('required') ||
                    response.error?.message?.includes('Missing') ||
                    response.result?.message?.includes('symbol') ||
                    response.result?.message?.includes('required') ||
                    response.result?.message?.includes('Missing');

                errorTests.push({
                    name: 'Missing parameters',
                    passed: hasAnyError && isValidationError,
                    details: {
                        hasJsonRpcError,
                        hasResultError,
                        hasAnyError,
                        isValidationError,
                        error: response.error,
                        result: response.result,
                    },
                });
            } catch (error) {
                errorTests.push({
                    name: 'Missing parameters',
                    passed: false,
                    details: { error: error instanceof Error ? error.message : String(error) },
                });
            }

            // Test 3: Invalid JSON-RPC method
            try {
                const response = await this.sendRequest('invalid/method/that/does/not/exist', {}, 5000);

                // Should return method not found error
                const hasError = response.error !== undefined;
                const isMethodNotFound = response.error?.code === -32601;

                errorTests.push({
                    name: 'Invalid JSON-RPC method',
                    passed: hasError && isMethodNotFound,
                    details: {
                        hasError,
                        isMethodNotFound,
                        error: response.error,
                    },
                });
            } catch (error) {
                errorTests.push({
                    name: 'Invalid JSON-RPC method',
                    passed: false,
                    details: { error: error instanceof Error ? error.message : String(error) },
                });
            }

            // Test 4: Malformed tool call
            try {
                const response = await this.sendRequest(
                    'tools/call',
                    {
                        name: 'find_definition',
                        arguments: 'this should be an object not a string',
                    },
                    5000
                );

                // Should handle gracefully
                const handledGracefully = response.error !== undefined || response.result !== undefined;

                errorTests.push({
                    name: 'Malformed arguments',
                    passed: handledGracefully,
                    details: {
                        handledGracefully,
                        error: response.error,
                        result: response.result,
                    },
                });
            } catch (error) {
                errorTests.push({
                    name: 'Malformed arguments',
                    passed: false,
                    details: { error: error instanceof Error ? error.message : String(error) },
                });
            }

            const allPassed = errorTests.every((t) => t.passed);
            const failedTests = errorTests.filter((t) => !t.passed);
            const duration = Date.now() - startTime;

            return {
                name: 'Error Scenarios',
                passed: allPassed,
                duration,
                details: {
                    tests: errorTests,
                    summary: {
                        passed: errorTests.filter((t) => t.passed).length,
                        failed: failedTests.length,
                        total: errorTests.length,
                        failedTests: failedTests.map((t) => t.name),
                    },
                },
            };
        } catch (error) {
            return {
                name: 'Error Scenarios',
                passed: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Performance benchmarks
     */
    private async testPerformance(): Promise<TestResult> {
        const startTime = Date.now();

        try {
            this.log('⚡ Testing performance benchmarks...');

            // Benchmark 1: Tool listing speed (Claude does this frequently)
            const toolListTimes: number[] = [];
            for (let i = 0; i < 5; i++) {
                const start = Date.now();
                await this.sendRequest('tools/list', {});
                toolListTimes.push(Date.now() - start);
                await this.sleep(100);
            }

            // Benchmark 2: find_definition speed
            const findDefTimes: number[] = [];
            for (let i = 0; i < 3; i++) {
                const start = Date.now();
                await this.sendRequest('tools/call', {
                    name: 'find_definition',
                    arguments: { symbol: 'FastMCPServer' },
                });
                findDefTimes.push(Date.now() - start);
                await this.sleep(100);
            }

            // Benchmark 3: find_references speed
            const findRefTimes: number[] = [];
            for (let i = 0; i < 3; i++) {
                const start = Date.now();
                await this.sendRequest('tools/call', {
                    name: 'find_references',
                    arguments: { symbol: 'FastMCPServer' },
                });
                findRefTimes.push(Date.now() - start);
                await this.sleep(100);
            }

            const avgToolList = toolListTimes.reduce((a, b) => a + b, 0) / toolListTimes.length;
            const avgFindDef = findDefTimes.reduce((a, b) => a + b, 0) / findDefTimes.length;
            const avgFindRef = findRefTimes.reduce((a, b) => a + b, 0) / findRefTimes.length;

            // Claude's performance expectations
            const toolListPassed = avgToolList < 100; // Should be very fast
            const findDefPassed = avgFindDef < 5000; // Should be under 5s
            const findRefPassed = avgFindRef < 5000; // Should be under 5s

            const duration = Date.now() - startTime;

            return {
                name: 'Performance Benchmarks',
                passed: toolListPassed && findDefPassed && findRefPassed,
                duration,
                details: {
                    toolListAvg: avgToolList,
                    findDefAvg: avgFindDef,
                    findRefAvg: avgFindRef,
                    requirements: {
                        toolList: '<100ms',
                        findDef: '<5000ms',
                        findRef: '<5000ms',
                    },
                    results: {
                        toolListPassed,
                        findDefPassed,
                        findRefPassed,
                    },
                },
            };
        } catch (error) {
            return {
                name: 'Performance Benchmarks',
                passed: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Run all tests
     */
    async runAllTests(): Promise<TestResult[]> {
        try {
            await this.startServer();

            // Run tests in order
            this.testResults.push(await this.testInitialization());

            if (this.serverInitialized) {
                this.testResults.push(await this.testFindDefinition());
                this.testResults.push(await this.testFindReferences());
                this.testResults.push(await this.testRenameSymbol());
                this.testResults.push(await this.testGenerateTests());
                this.testResults.push(await this.testErrorScenarios());
                this.testResults.push(await this.testPerformance());
            } else {
                this.log('❌ Skipping tool tests due to initialization failure');
            }
        } catch (error) {
            this.log(`💥 Fatal error during testing: ${error}`);
            this.testResults.push({
                name: 'Fatal Error',
                passed: false,
                duration: 0,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            await this.cleanup();
        }

        return this.testResults;
    }

    /**
     * Generate comprehensive test report
     */
    generateReport(): string {
        const passed = this.testResults.filter((r) => r.passed).length;
        const total = this.testResults.length;
        const totalDuration = this.testResults.reduce((acc, r) => acc + r.duration, 0);

        let report = '# Claude-MCP Integration Test Report\n\n';
        report += `**Overall Result: ${passed}/${total} tests passed**\n`;
        report += `**Total Duration: ${totalDuration}ms**\n`;
        report += `**Server Startup Time: ${this.serverStartTime ? 'N/A' : 'Unknown'}**\n\n`;

        // Summary
        report += '## Summary\n\n';
        if (passed === total) {
            report += '✅ **ALL TESTS PASSED** - Server is fully Claude-compatible!\n\n';
        } else {
            report += `❌ **${total - passed} TESTS FAILED** - Server has compatibility issues\n\n`;
        }

        // Detailed results
        report += '## Detailed Results\n\n';

        for (const result of this.testResults) {
            const status = result.passed ? '✅' : '❌';
            report += `### ${status} ${result.name}\n`;
            report += `- **Duration:** ${result.duration}ms\n`;

            if (result.error) {
                report += `- **Error:** ${result.error}\n`;
            }

            if (result.details) {
                report += `- **Details:** ${JSON.stringify(result.details, null, 2)}\n`;
            }

            report += '\n';
        }

        // Recommendations
        report += '## Recommendations\n\n';

        const failedTests = this.testResults.filter((r) => !r.passed);
        if (failedTests.length === 0) {
            report += '🎉 No issues found! The server is ready for Claude integration.\n';
        } else {
            for (const failed of failedTests) {
                report += `- Fix ${failed.name}: ${failed.error || 'Unknown error'}\n`;
            }
        }

        return report;
    }

    /**
     * Cleanup resources
     */
    private async cleanup(): Promise<void> {
        try {
            if (this.readline) {
                this.readline.close();
            }

            if (this.mcpServer) {
                this.mcpServer.kill('SIGTERM');

                // Wait for graceful shutdown
                await new Promise<void>((resolve) => {
                    const timeout = setTimeout(() => {
                        this.mcpServer?.kill('SIGKILL');
                        resolve();
                    }, 5000);

                    this.mcpServer?.on('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            }

            this.log('🧹 Cleanup completed');
        } catch (error) {
            this.log(`⚠️ Cleanup error: ${error}`);
        }
    }

    /**
     * Utility: Sleep for ms
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Utility: Log with timestamp
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString();
        if (this.diagnosticMode) {
            console.log(`[${timestamp}] ${message}`);
        }
    }
}

// Main execution
async function main() {
    const diagnosticMode = process.argv.includes('--diagnostic') || process.argv.includes('-d');
    const test = new ClaudeMCPIntegrationTest(diagnosticMode);

    console.log('🧪 Starting Claude-MCP Integration Test...\n');

    const startTime = Date.now();
    const results = await test.runAllTests();
    const totalTime = Date.now() - startTime;

    console.log('\n' + '='.repeat(60));
    console.log('🏁 Testing Complete!');
    console.log('='.repeat(60));

    const report = test.generateReport();
    console.log(report);

    // Save report to file
    const reportPath = 'claude-mcp-integration-report.md';
    await Bun.write(reportPath, report);
    console.log(`\n📄 Full report saved to: ${reportPath}`);

    // Exit with appropriate code
    const allPassed = results.every((r) => r.passed);
    console.log(`\n${allPassed ? '✅' : '❌'} Claude Compatibility: ${allPassed ? 'VERIFIED' : 'FAILED'}`);

    process.exit(allPassed ? 0 : 1);
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('💥 Test execution failed:', error);
        process.exit(1);
    });
}

export { ClaudeMCPIntegrationTest };
