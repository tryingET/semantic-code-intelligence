/**
 * Comprehensive test suite for MCP server error handling and recovery
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ErrorHandler as CoreErrorHandler } from '../src/core/error-handler';
import type { EventBus } from '../src/core/types';
import { ConnectionManager, defaultConnectionManager } from '../src/mcp/connection-manager';
// Import our error handling utilities
import {
    createInternalError,
    createValidationError,
    ErrorHandler,
    globalErrorHandler,
    withMcpErrorHandling,
} from '../src/mcp/error-handler';
import { FileLogger, fileLogger } from '../src/mcp/file-logger';

describe('Error Handler', () => {
    let errorHandler: ErrorHandler;
    const originalCircuitBreakerThreshold = process.env.CIRCUIT_BREAKER_THRESHOLD;
    const originalCircuitBreakerResetTimeout = process.env.CIRCUIT_BREAKER_RESET_TIMEOUT;

    beforeEach(() => {
        errorHandler = new ErrorHandler();
    });

    afterEach(() => {
        if (originalCircuitBreakerThreshold === undefined) delete process.env.CIRCUIT_BREAKER_THRESHOLD;
        else process.env.CIRCUIT_BREAKER_THRESHOLD = originalCircuitBreakerThreshold;
        if (originalCircuitBreakerResetTimeout === undefined) delete process.env.CIRCUIT_BREAKER_RESET_TIMEOUT;
        else process.env.CIRCUIT_BREAKER_RESET_TIMEOUT = originalCircuitBreakerResetTimeout;
    });

    test('should handle successful operations', async () => {
        const context = {
            component: 'TestComponent',
            operation: 'test_operation',
            timestamp: Date.now(),
        };

        const result = await errorHandler.withErrorHandling(context, async () => 'success');

        expect(result).toBe('success');
    });

    test('should retry on transient failures', async () => {
        const context = {
            component: 'TestComponent',
            operation: 'retry_test',
            timestamp: Date.now(),
        };

        let attempts = 0;
        const result = await errorHandler.withErrorHandling(
            context,
            async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('Transient failure');
                }
                return 'success_after_retry';
            },
            { maxRetries: 3, baseDelay: 10, exponentialBackoff: true, jitterMs: 0 }
        );

        expect(result).toBe('success_after_retry');
        expect(attempts).toBe(3);
    });

    test('should not retry on validation errors', async () => {
        const context = {
            component: 'TestComponent',
            operation: 'validation_test',
            timestamp: Date.now(),
        };

        let attempts = 0;

        try {
            await errorHandler.withErrorHandling(
                context,
                async () => {
                    attempts++;
                    throw new Error('Missing required field: name');
                },
                { maxRetries: 3 }
            );
        } catch (error) {
            expect(attempts).toBe(1); // Should not retry
            expect(error.message).toContain('Missing required');
        }
    });

    test('should implement exponential backoff', async () => {
        const context = {
            component: 'TestComponent',
            operation: 'backoff_test',
            timestamp: Date.now(),
        };

        const delays: number[] = [];
        const originalSleep = (errorHandler as any).sleep;
        (errorHandler as any).sleep = async (ms: number) => {
            delays.push(ms);
            return Promise.resolve();
        };

        try {
            await errorHandler.withErrorHandling(
                context,
                async () => {
                    throw new Error('Always fail');
                },
                {
                    maxRetries: 3,
                    baseDelay: 100,
                    exponentialBackoff: true,
                    // Make delays deterministic and strictly increasing for this test
                    jitterMs: 0,
                }
            );
        } catch (error) {
            // Verbose diagnostics on failure
            // Should have 3 delays (for 3 retry attempts)
            if (delays.length !== 3) {
                console.error('Backoff delays count mismatch:', delays);
            }
            expect(delays.length).toBe(3);
            if (!(delays[1] > delays[0] && delays[2] > delays[1])) {
                console.error('Backoff delays not strictly increasing:', delays);
            }
            expect(delays[1]).toBeGreaterThan(delays[0]); // Exponential increase
            expect(delays[2]).toBeGreaterThan(delays[1]);
        }

        // Restore original sleep
        (errorHandler as any).sleep = originalSleep;
    });

    test('should implement circuit breaker', async () => {
        const context = {
            component: 'TestComponent',
            operation: 'circuit_test',
            timestamp: Date.now(),
        };

        const circuitBreakerHandler = new ErrorHandler({
            circuitBreakerThreshold: 2,
            maxRetries: 0, // No retries to trigger circuit breaker faster
        });

        // Trigger failures to open circuit
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreakerHandler.withErrorHandling(context, async () => {
                    throw new Error('Service failure');
                });
            } catch (error) {
                // Expected
            }
        }

        // Circuit should now be open
        try {
            await circuitBreakerHandler.withErrorHandling(context, async () => 'should_not_execute');
        } catch (error) {
            expect(error.message).toContain('Circuit breaker open');
        }
    });

    test('should honor circuit breaker reset timeout option', async () => {
        const context = {
            component: 'TestComponent',
            operation: 'circuit_reset_timeout_test',
            timestamp: Date.now(),
        };
        const circuitBreakerHandler = new ErrorHandler();
        const perCallCircuitOptions = {
            circuitBreakerThreshold: 1,
            circuitBreakerResetTimeout: 1,
            maxRetries: 0,
        };

        await expect(
            circuitBreakerHandler.withErrorHandling(
                context,
                async () => {
                    throw new Error('Service failure');
                },
                perCallCircuitOptions
            )
        ).rejects.toThrow('Service failure');

        await expect(
            circuitBreakerHandler.withErrorHandling(context, async () => 'blocked', perCallCircuitOptions)
        ).rejects.toThrow('Circuit breaker open');

        await new Promise((resolve) => setTimeout(resolve, 5));
        await expect(
            circuitBreakerHandler.withErrorHandling(context, async () => 'recovered', perCallCircuitOptions)
        ).resolves.toBe('recovered');
    });

    test('should apply circuit breaker environment overrides to new handlers', async () => {
        process.env.CIRCUIT_BREAKER_THRESHOLD = '1';
        process.env.CIRCUIT_BREAKER_RESET_TIMEOUT = '1';
        const context = {
            component: 'TestComponent',
            operation: 'circuit_env_timeout_test',
            timestamp: Date.now(),
        };
        const circuitBreakerHandler = new ErrorHandler({ maxRetries: 0 });

        await expect(
            circuitBreakerHandler.withErrorHandling(context, async () => {
                throw new Error('Service failure');
            })
        ).rejects.toThrow('Service failure');
        await expect(circuitBreakerHandler.withErrorHandling(context, async () => 'blocked')).rejects.toThrow(
            'Circuit breaker open'
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        await expect(circuitBreakerHandler.withErrorHandling(context, async () => 'recovered')).resolves.toBe(
            'recovered'
        );
    });

    test('should reject invalid circuit breaker environment overrides', () => {
        process.env.CIRCUIT_BREAKER_THRESHOLD = '0';
        expect(() => new ErrorHandler()).toThrow('Invalid numeric environment variable CIRCUIT_BREAKER_THRESHOLD');
    });

    test('should validate request parameters', () => {
        const context = {
            component: 'TestComponent',
            operation: 'validation',
            timestamp: Date.now(),
        };

        // Test missing required field
        expect(() => {
            errorHandler.validateRequest({ name: 'test' }, ['name', 'required_field'], context);
        }).toThrow('Missing required field: required_field');

        // Test null request
        expect(() => {
            errorHandler.validateRequest(null, ['name'], context);
        }).toThrow('Request must be an object');

        // Test valid request
        expect(() => {
            errorHandler.validateRequest(
                { name: 'test', required_field: 'value' },
                ['name', 'required_field'],
                context
            );
        }).not.toThrow();
    });

    test('should create proper MCP errors', () => {
        const context = {
            component: 'TestComponent',
            operation: 'error_creation',
            timestamp: Date.now(),
        };

        const originalError = new Error('Original error');
        const mcpError = errorHandler.createMcpError(
            ErrorCode.InvalidParams,
            'Test error message',
            context,
            originalError
        );

        expect(mcpError.code).toBe(ErrorCode.InvalidParams);
        expect(mcpError.message).toBe('Test error message');
        expect((mcpError as any).data.component).toBe('TestComponent');
        expect((mcpError as any).data.operation).toBe('error_creation');
    });
});

describe('Core ErrorHandler', () => {
    const eventBus: EventBus = {
        emit: () => {},
        on: () => {},
        off: () => {},
        once: () => {},
    };

    test('honors circuit breaker reset timeout option', async () => {
        const handler = new CoreErrorHandler(eventBus);
        const options = { circuitBreakerThreshold: 1, circuitBreakerResetTimeout: 1 };

        await expect(
            handler.executeWithProtection(
                'test-layer',
                async () => {
                    throw new Error('core service failure');
                },
                options
            )
        ).rejects.toThrow('core service failure');

        await expect(handler.executeWithProtection('test-layer', async () => 'blocked', options)).rejects.toThrow(
            'Circuit breaker is open'
        );

        await new Promise((resolve) => setTimeout(resolve, 5));
        await expect(handler.executeWithProtection('test-layer', async () => 'recovered', options)).resolves.toBe(
            'recovered'
        );
    });
});

describe('File Logger', () => {
    let logger: FileLogger;

    beforeEach(() => {
        // Create logger with test configuration
        logger = new FileLogger({
            logDir: '/tmp/test-logs',
            enableConsole: false, // Disable console output during tests
        });
    });

    test('should create log entries with proper format', () => {
        const component = 'TestComponent';
        const message = 'Test message';
        const data = { key: 'value' };

        // Mock the writeToFile method to capture log entries
        const logEntries: any[] = [];
        (logger as any).writeToFile = (entry: any) => {
            logEntries.push(entry);
        };

        logger.info(component, message, data);

        expect(logEntries.length).toBe(1);
        expect(logEntries[0].level).toBe('info');
        expect(logEntries[0].component).toBe(component);
        expect(logEntries[0].message).toBe(message);
        expect(logEntries[0].data).toEqual(data);
    });

    test('should log errors with stack traces', () => {
        const component = 'TestComponent';
        const message = 'Test error';
        const error = new Error('Test error details');

        const logEntries: any[] = [];
        (logger as any).writeToFile = (entry: any) => {
            logEntries.push(entry);
        };

        logger.error(component, message, error);

        expect(logEntries.length).toBe(1);
        expect(logEntries[0].level).toBe('error');
        expect(logEntries[0].error.name).toBe('Error');
        expect(logEntries[0].error.message).toBe('Test error details');
        expect(logEntries[0].error.stack).toBeDefined();
    });

    test('should create child loggers', () => {
        const childLogger = logger.child('ChildComponent');

        const logEntries: any[] = [];
        (logger as any).writeToFile = (entry: any) => {
            logEntries.push(entry);
        };

        childLogger.info('Child message');

        expect(logEntries.length).toBe(1);
        expect(logEntries[0].component).toBe('ChildComponent');
    });
});

describe('Connection Manager', () => {
    let connectionManager: ConnectionManager;

    beforeEach(() => {
        connectionManager = new ConnectionManager({
            enableHeartbeat: false,
            connectionTimeout: 1000,
        });
    });

    afterEach(async () => {
        await connectionManager.disconnect();
    });

    test('should track connection state', async () => {
        expect(connectionManager.getState()).toBe('disconnected');

        await connectionManager.connect();
        expect(connectionManager.getState()).toBe('connected');

        await connectionManager.disconnect();
        expect(connectionManager.getState()).toBe('disconnected');
    });

    test('should track connection metrics', async () => {
        await connectionManager.connect();

        connectionManager.recordMessage('incoming', { test: 'message' });
        connectionManager.recordMessage('outgoing', { response: 'data' });

        const metrics = connectionManager.getMetrics();
        expect(metrics.messagesReceived).toBe(1);
        expect(metrics.messagesSent).toBe(1);
        expect(metrics.connectionCount).toBe(1);
    });

    test('should handle connection events', async () => {
        const events: any[] = [];
        connectionManager.onStateChange((event) => {
            events.push(event);
        });

        await connectionManager.connect();
        await connectionManager.disconnect();

        expect(events.length).toBeGreaterThan(0);
        expect(events[0].state).toBe('connecting');
    });

    test('should provide health check information', async () => {
        const health = connectionManager.getHealthCheck();

        expect(health.status).toBe('unhealthy'); // Initially disconnected
        expect(health.state).toBe('disconnected');
        expect(typeof health.uptime).toBe('number');
        expect(typeof health.connections).toBe('number');
    });

    test('default import does not install process-wide uncaught exception handlers', () => {
        expect(defaultConnectionManager.getState()).toBe('disconnected');
        const proc = spawnSync(
            process.execPath,
            [
                '--eval',
                "await import('./src/mcp/connection-manager.ts'); setTimeout(() => { throw new Error('boom') }, 0); setTimeout(() => { console.log('still alive'); process.exit(0) }, 100);",
            ],
            { cwd: process.cwd(), encoding: 'utf8' }
        );

        expect(proc.status).not.toBe(0);
        expect(proc.stdout).not.toContain('still alive');
    });
});

describe('Utility Functions', () => {
    test('withMcpErrorHandling should wrap operations', async () => {
        const result = await withMcpErrorHandling('TestComponent', 'test_operation', async () => 'success');

        expect(result).toBe('success');
    });

    test('createValidationError should create proper error', () => {
        const context = {
            component: 'TestComponent',
            operation: 'validation',
            timestamp: Date.now(),
        };

        const error = createValidationError('Invalid parameter', context);

        expect(error.code).toBe(ErrorCode.InvalidParams);
        expect(error.message).toBe('Invalid parameter');
    });

    test('createInternalError should create proper error', () => {
        const context = {
            component: 'TestComponent',
            operation: 'internal',
            timestamp: Date.now(),
        };

        const originalError = new Error('Original error');
        const error = createInternalError('Internal failure', context, originalError);

        expect(error.code).toBe(ErrorCode.InternalError);
        expect(error.message).toBe('Internal failure');
        expect((error as any).data.originalError.message).toBe('Original error');
    });
});

describe('Integration Tests', () => {
    test('should handle complete error recovery scenario', async () => {
        const context = {
            component: 'IntegrationTest',
            operation: 'recovery_scenario',
            timestamp: Date.now(),
        };

        let attempts = 0;
        const scenarios = [
            () => {
                throw new Error('Network timeout');
            }, // Retry
            () => {
                throw new Error('Temporary failure');
            }, // Retry
            () => {
                return 'recovered';
            }, // Success
        ];

        const result = await globalErrorHandler.withErrorHandling(
            context,
            async () => {
                const scenario = scenarios[attempts];
                attempts++;
                return scenario();
            },
            { maxRetries: 3, baseDelay: 10, jitterMs: 0, exponentialBackoff: true }
        );

        expect(result).toBe('recovered');
        expect(attempts).toBe(3);
    });

    test('does not retry operations after local timeout because the original promise is still running', async () => {
        const handler = new ErrorHandler({ maxRetries: 1, baseDelay: 1, jitterMs: 0, timeoutMs: 1000 });
        const context = {
            component: 'IntegrationTest',
            operation: 'timeout_no_retry_test',
            timestamp: Date.now(),
        };
        let started = 0;
        let finished = 0;
        let releaseOperation!: () => void;
        let markFinished!: () => void;
        const operationGate = new Promise<void>((resolve) => {
            releaseOperation = resolve;
        });
        const finishedSignal = new Promise<void>((resolve) => {
            markFinished = resolve;
        });

        await expect(
            handler.withErrorHandling(
                context,
                async () => {
                    started++;
                    await operationGate;
                    finished++;
                    markFinished();
                    return 'too_late';
                },
                { maxRetries: 1, baseDelay: 1, jitterMs: 0, timeoutMs: 1000 }
            )
        ).rejects.toThrow('timed out');

        expect(started).toBe(1);
        expect(finished).toBe(0);
        releaseOperation();
        await finishedSignal;
        expect(finished).toBe(1);
    });

    test('should handle timeout scenarios', async () => {
        const context = {
            component: 'IntegrationTest',
            operation: 'timeout_test',
            timestamp: Date.now(),
        };

        try {
            await globalErrorHandler.withErrorHandling(
                context,
                async () => {
                    // Simulate long-running operation
                    return new Promise((resolve) => {
                        setTimeout(() => resolve('too_late'), 100);
                    });
                },
                { maxRetries: 0 } // No retries for timeout test
            );
        } catch (error) {
            expect(error.message).toContain('timed out');
        }
    });

    test('should handle connection loss and recovery', async () => {
        const connectionManager = new ConnectionManager({
            enableHeartbeat: false,
            maxReconnectAttempts: 2,
            reconnectBackoff: 100,
        });

        await connectionManager.connect();

        const connectionError = new Error('Connection lost');

        // Simulate connection loss
        await connectionManager.handleConnectionLoss(connectionError);

        // Should attempt reconnection
        expect(connectionManager.getState()).toBe('reconnecting');

        await connectionManager.disconnect();
    });
});
