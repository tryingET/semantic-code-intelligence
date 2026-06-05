/**
 * Comprehensive error handling utilities for MCP server
 *
 * Provides error recovery, connection state management, and proper
 * MCP protocol error responses.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { isCoreError } from '../core/errors.js';
import { mcpLogger } from './file-logger.js';

export interface ErrorContext {
    component: string;
    operation: string;
    requestId?: string;
    userId?: string;
    sessionId?: string;
    timestamp: number;
}

export interface RecoveryOptions {
    maxRetries: number;
    baseDelay: number; // in milliseconds
    maxDelay: number;
    exponentialBackoff: boolean;
    circuitBreakerThreshold: number; // failures before opening circuit
    circuitBreakerResetTimeout: number; // milliseconds before an open circuit can try again
    jitterMs: number; // random jitter amplitude in ms
    timeoutMs: number; // per-attempt operation timeout
}

class OperationTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Operation timed out after ${timeoutMs}ms`);
        this.name = 'OperationTimeoutError';
    }
}

function parsePositiveIntegerEnv(name: string, value: string | undefined): number | undefined {
    if (value === undefined || value === '') return undefined;
    if (!/^\d+$/.test(value.trim())) throw new Error(`Invalid numeric environment variable ${name}: ${value}`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid numeric environment variable ${name}: ${value}`);
    }
    return parsed;
}

function environmentRecoveryOptions(): Partial<RecoveryOptions> {
    return {
        circuitBreakerThreshold: parsePositiveIntegerEnv(
            'CIRCUIT_BREAKER_THRESHOLD',
            process.env.CIRCUIT_BREAKER_THRESHOLD
        ),
        circuitBreakerResetTimeout: parsePositiveIntegerEnv(
            'CIRCUIT_BREAKER_RESET_TIMEOUT',
            process.env.CIRCUIT_BREAKER_RESET_TIMEOUT
        ),
    };
}

export class ErrorHandler {
    private retryAttempts = new Map<string, number>();
    private circuitBreakerState = new Map<
        string,
        {
            failures: number;
            lastFailure: number;
            isOpen: boolean;
        }
    >();

    private defaultOptions: RecoveryOptions = {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        exponentialBackoff: true,
        circuitBreakerThreshold: 5,
        circuitBreakerResetTimeout: 30000,
        jitterMs: 1000,
        timeoutMs: 30000,
    };

    constructor(private options: Partial<RecoveryOptions> = {}) {
        this.options = { ...this.defaultOptions, ...environmentRecoveryOptions(), ...options };
    }

    /**
     * Wrap an async operation with comprehensive error handling and recovery
     */
    async withErrorHandling<T>(
        context: ErrorContext,
        operation: () => Promise<T>,
        options?: Partial<RecoveryOptions>
    ): Promise<T> {
        const effectiveOptions: RecoveryOptions = {
            ...this.defaultOptions,
            ...(this.options as RecoveryOptions),
            ...(options || {}),
        } as RecoveryOptions;
        const operationKey = `${context.component}:${context.operation}`;

        // Check circuit breaker
        if (this.isCircuitOpen(operationKey, effectiveOptions)) {
            const error = new Error(`Circuit breaker open for ${operationKey}`);
            this.logError(context, error, { circuitBreakerOpen: true });
            throw this.createMcpError(ErrorCode.InternalError, error.message, context);
        }

        let lastError: Error | undefined;
        const maxAttempts = (effectiveOptions.maxRetries ?? this.defaultOptions.maxRetries) + 1; // +1 for initial attempt

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Log attempt
                if (attempt > 1) {
                    mcpLogger.info(`Retry attempt ${attempt}/${maxAttempts} for ${context.operation}`, {
                        context,
                        attempt,
                    });
                }

                const startTime = Date.now();
                const timeoutMs = Math.max(1000, Number(effectiveOptions.timeoutMs || 30000));
                const result = await this.withTimeout(operation(), timeoutMs);
                const duration = Date.now() - startTime;

                // Success - reset retry counter and close circuit
                this.retryAttempts.delete(operationKey);
                this.resetCircuitBreaker(operationKey);

                mcpLogger.logPerformance(context.operation, duration, true, {
                    attempt,
                    component: context.component,
                });

                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                const nonRetryable = this.shouldNotRetry(lastError);
                this.logError(context, lastError, {
                    attempt,
                    maxAttempts,
                    willRetry: !nonRetryable && attempt < maxAttempts,
                });

                // Don't retry client/validation errors, and don't wrap them as exhausted retries.
                if (nonRetryable) {
                    mcpLogger.warn('Not retrying due to error type', {
                        error: lastError.message,
                        type: lastError.constructor.name,
                    });
                    throw this.createMcpError(this.mapErrorToMcpCode(lastError), lastError.message, context, lastError);
                }

                // Update circuit breaker for retryable/system failures only.
                this.recordFailure(operationKey, effectiveOptions);

                // Wait before retry (except on last attempt)
                if (attempt < maxAttempts) {
                    const delay = this.calculateDelay(attempt, effectiveOptions);
                    mcpLogger.debug(`Waiting ${delay}ms before retry`, { attempt, delay });
                    await this.sleep(delay);
                }
            }
        }

        // All retries exhausted
        if (lastError) {
            this.logError(context, lastError, {
                allRetriesExhausted: true,
                totalAttempts: maxAttempts,
            });

            throw this.createMcpError(
                this.mapErrorToMcpCode(lastError),
                `Operation failed after ${maxAttempts} attempts: ${lastError.message}`,
                context,
                lastError
            );
        }

        // Should never reach here, but just in case
        throw this.createMcpError(ErrorCode.InternalError, 'Unknown error in retry logic', context);
    }

    /**
     * Handle connection-related errors with automatic recovery
     */
    async handleConnectionError(error: Error, context: ErrorContext, reconnectFn?: () => Promise<void>): Promise<void> {
        mcpLogger.logConnection('error', {
            error: error.message,
            context,
        });

        // Attempt reconnection if function provided
        if (reconnectFn) {
            try {
                await this.withErrorHandling({ ...context, operation: 'reconnect' }, reconnectFn, {
                    maxRetries: 2,
                    baseDelay: 2000,
                });
                mcpLogger.logConnection('connect', { reconnected: true });
            } catch (reconnectError) {
                mcpLogger.error('Failed to reconnect', reconnectError);
                throw this.createMcpError(
                    ErrorCode.InternalError,
                    'Connection lost and reconnection failed',
                    context,
                    error
                );
            }
        }
    }

    /**
     * Validate request parameters and throw appropriate errors
     */
    validateRequest(request: unknown, requiredFields: string[], context: ErrorContext): void {
        try {
            if (!request || typeof request !== 'object') {
                throw new Error('Request must be an object');
            }
            const requestRecord = request as Record<string, unknown>;

            for (const field of requiredFields) {
                if (requestRecord[field] === undefined || requestRecord[field] === null) {
                    throw new Error(`Missing required field: ${field}`);
                }
            }

            // Validate field types if needed
            this.validateFieldTypes(requestRecord, context);
        } catch (error) {
            const validationError = error instanceof Error ? error : new Error(String(error));
            this.logError(context, validationError, {
                requestValidation: true,
                request: this.sanitizeForLogging(request),
            });

            throw this.createMcpError(ErrorCode.InvalidParams, validationError.message, context, validationError);
        }
    }

    /**
     * Create a properly formatted MCP error
     */
    createMcpError(code: ErrorCode, message: string, context: ErrorContext, originalError?: Error): McpError {
        const mcpError = new McpError(code, message);
        const mutableMcpError = mcpError as McpError & { rawMessage?: string; message: string; data?: unknown };
        // Align with tests: expose the raw message on the Error.message field
        // SDK prefixes messages (e.g., "MCP error -32602: ..."); tests expect the plain message
        try {
            mutableMcpError.rawMessage = message;
            mutableMcpError.message = message;
        } catch {
            // Fallback – if message is readonly in some environments, keep SDK default
        }

        // Add context to error data
        mutableMcpError.data = {
            component: context.component,
            operation: context.operation,
            requestId: context.requestId,
            timestamp: context.timestamp,
            originalError: originalError
                ? {
                      name: originalError.name,
                      message: originalError.message,
                  }
                : undefined,
        };

        return mcpError;
    }

    /**
     * Sanitize sensitive data from logs
     */
    private sanitizeForLogging(obj: unknown): unknown {
        if (!obj || typeof obj !== 'object') return obj;

        const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];
        const sanitized: Record<string, unknown> = { ...(obj as Record<string, unknown>) };

        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    private logError(context: ErrorContext, error: Error, additionalData?: Record<string, unknown>): void {
        mcpLogger.error(`${context.operation} failed`, error, {
            context,
            ...additionalData,
        });
    }

    private validateFieldTypes(request: Record<string, unknown>, _context: ErrorContext): void {
        // Add specific field type validations based on MCP protocol requirements

        if (request.symbol && typeof request.symbol !== 'string') {
            throw new Error('Field "symbol" must be a string');
        }

        if (request.file && typeof request.file !== 'string') {
            throw new Error('Field "file" must be a string');
        }

        if (request.position && typeof request.position !== 'object') {
            throw new Error('Field "position" must be an object');
        }

        if (request.position) {
            const position = request.position as Record<string, unknown>;
            if (typeof position.line !== 'number' || position.line < 0) {
                throw new Error('Field "position.line" must be a non-negative number');
            }
            if (typeof position.character !== 'number' || position.character < 0) {
                throw new Error('Field "position.character" must be a non-negative number');
            }
        }
    }

    private shouldNotRetry(error: Error): boolean {
        // Retrying after a local timeout can duplicate non-idempotent side effects
        // because Promise.race cannot cancel the original operation.
        if (error.name === 'OperationTimeoutError') {
            return true;
        }

        // Don't retry on validation errors or client errors
        const msg = (error.message || '').toLowerCase();
        if (
            msg.includes('missing required') ||
            msg.includes('invalid') ||
            msg.includes('must be') ||
            msg.includes('unknown tool') ||
            msg.includes('cannot be empty') ||
            msg.includes('arguments must be')
        ) {
            return true;
        }

        // Don't retry on authentication errors
        if (error.message.includes('unauthorized') || error.message.includes('forbidden')) {
            return true;
        }

        return false;
    }

    private mapErrorToMcpCode(error: Error): ErrorCode {
        if (isCoreError(error)) {
            if (error.code === 'UnknownTool') return ErrorCode.MethodNotFound;
            if (error.code === 'InvalidParams') return ErrorCode.InvalidParams;
            return ErrorCode.InternalError;
        }

        if (/timeout|timed out/i.test(error.message)) {
            return ErrorCode.RequestTimeout;
        }

        if (
            error.message.includes('Invalid') ||
            error.message.includes('Missing required') ||
            error.message.includes('must be')
        ) {
            return ErrorCode.InvalidParams;
        }

        if (error.message.includes('not found') || error.message.includes('Unknown tool')) {
            return ErrorCode.MethodNotFound;
        }

        return ErrorCode.InternalError;
    }

    private calculateDelay(attempt: number, options: RecoveryOptions): number {
        if (!options.exponentialBackoff) {
            return options.baseDelay;
        }

        const exponentialDelay = options.baseDelay * 2 ** (attempt - 1);
        const jitteredDelay = exponentialDelay + (options.jitterMs > 0 ? Math.random() * options.jitterMs : 0);

        return Math.min(jitteredDelay, options.maxDelay);
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new OperationTimeoutError(timeoutMs)), timeoutMs);
            timer?.unref?.();
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private isCircuitOpen(operationKey: string, options: RecoveryOptions): boolean {
        const state = this.circuitBreakerState.get(operationKey);
        if (!state) return false;

        if (state.isOpen) {
            // Check if enough time has passed to try again (half-open state)
            const timeSinceLastFailure = Date.now() - state.lastFailure;
            const resetTimeout = options.circuitBreakerResetTimeout ?? this.defaultOptions.circuitBreakerResetTimeout;
            if (timeSinceLastFailure > resetTimeout) {
                state.isOpen = false;
                state.failures = 0;
                return false;
            }
            return true;
        }

        return false;
    }

    private recordFailure(operationKey: string, options: RecoveryOptions): void {
        let state = this.circuitBreakerState.get(operationKey);
        if (!state) {
            state = { failures: 0, lastFailure: 0, isOpen: false };
            this.circuitBreakerState.set(operationKey, state);
        }

        state.failures++;
        state.lastFailure = Date.now();

        const threshold = options.circuitBreakerThreshold ?? this.defaultOptions.circuitBreakerThreshold;
        if (state.failures >= threshold) {
            state.isOpen = true;
            mcpLogger.warn(`Circuit breaker opened for ${operationKey}`, {
                failures: state.failures,
                threshold,
            });
        }
    }

    private resetCircuitBreaker(operationKey: string): void {
        this.circuitBreakerState.delete(operationKey);
    }
}

// Global error handler instance
export const globalErrorHandler = new ErrorHandler();

// Utility functions for common error handling patterns
export function withMcpErrorHandling<T>(
    component: string,
    operation: string,
    fn: () => Promise<T>,
    requestId?: string,
    options?: Partial<RecoveryOptions>
): Promise<T> {
    const context: ErrorContext = {
        component,
        operation,
        requestId,
        timestamp: Date.now(),
    };

    return globalErrorHandler.withErrorHandling(context, fn, options);
}

export function createValidationError(message: string, context: ErrorContext): McpError {
    return globalErrorHandler.createMcpError(ErrorCode.InvalidParams, message, context);
}

export function createInternalError(message: string, context: ErrorContext, originalError?: Error): McpError {
    return globalErrorHandler.createMcpError(ErrorCode.InternalError, message, context, originalError);
}
