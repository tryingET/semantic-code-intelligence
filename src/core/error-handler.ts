/**
 * ErrorHandler - Comprehensive error handling and recovery for the unified system
 * Provides circuit breaker, retry logic, and graceful degradation
 */

import {
    CoreError,
    type EventBus,
    InvalidRequestError,
    type Layer,
    LayerTimeoutError,
    LayerUnavailableError,
} from './types.js';

/**
 * Circuit breaker states
 */
enum CircuitBreakerState {
    Closed = 'closed', // Normal operation
    Open = 'open', // Failing, reject requests
    HalfOpen = 'half-open', // Testing if service recovered
}

/**
 * Circuit breaker for individual layers
 */
class CircuitBreaker {
    private state = CircuitBreakerState.Closed;
    private failureCount = 0;
    private successCount = 0;
    private lastFailureTime = 0;
    private nextAttempt = 0;

    constructor(
        private threshold: number = 5,
        private timeout: number = 60000, // 1 minute
        private halfOpenSuccessThreshold: number = 3
    ) {}

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === CircuitBreakerState.Open) {
            if (Date.now() < this.nextAttempt) {
                throw new CoreError(
                    'Circuit breaker is open - service temporarily unavailable',
                    'CIRCUIT_BREAKER_OPEN'
                );
            }
            this.state = CircuitBreakerState.HalfOpen;
        }

        try {
            const result = await operation();

            if (this.state === CircuitBreakerState.HalfOpen) {
                this.successCount++;
                if (this.successCount >= this.halfOpenSuccessThreshold) {
                    this.reset();
                }
            } else {
                this.failureCount = 0;
            }

            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    private recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.threshold) {
            this.state = CircuitBreakerState.Open;
            this.nextAttempt = Date.now() + this.timeout;
        }
    }

    private reset(): void {
        this.state = CircuitBreakerState.Closed;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = 0;
        this.nextAttempt = 0;
    }

    getState(): CircuitBreakerState {
        return this.state;
    }

    getStats(): {
        state: CircuitBreakerState;
        failureCount: number;
        successCount: number;
        lastFailureTime: number;
    } {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
        };
    }
}

/**
 * Retry configuration
 */
interface RetryConfig {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    jitter: boolean;
}

/**
 * Retry utility with exponential backoff and jitter
 */
class RetryHandler {
    private defaultConfig: RetryConfig = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 5000,
        backoffMultiplier: 2,
        jitter: true,
    };

    async execute<T>(
        operation: () => Promise<T>,
        config?: Partial<RetryConfig>,
        shouldRetry?: (error: Error) => boolean
    ): Promise<T> {
        const finalConfig = { ...this.defaultConfig, ...config };
        let lastError: Error;

        for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Don't retry if it's the last attempt
                if (attempt === finalConfig.maxAttempts) {
                    break;
                }

                // Check if we should retry this error
                if (shouldRetry && !shouldRetry(lastError)) {
                    break;
                }

                // Don't retry certain errors
                if (
                    lastError instanceof InvalidRequestError ||
                    (lastError instanceof CoreError && lastError.code === 'CIRCUIT_BREAKER_OPEN')
                ) {
                    break;
                }

                // Calculate delay with exponential backoff and optional jitter
                const delay = this.calculateDelay(attempt - 1, finalConfig);
                await this.sleep(delay);
            }
        }

        throw lastError!;
    }

    private calculateDelay(attempt: number, config: RetryConfig): number {
        let delay = config.baseDelay * config.backoffMultiplier ** attempt;
        delay = Math.min(delay, config.maxDelay);

        if (config.jitter) {
            // Add jitter to prevent thundering herd
            delay = delay * (0.5 + Math.random() * 0.5);
        }

        return delay;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * Graceful degradation strategies
 */
enum DegradationStrategy {
    SkipLayer = 'skip-layer', // Skip failed layer, continue with others
    UseCachedResult = 'use-cached', // Use cached result if available
    ReturnPartialResult = 'partial', // Return whatever we have so far
    ReturnEmpty = 'empty', // Return empty result
    Fail = 'fail', // Fail the request
}

/**
 * Comprehensive error handler for the unified system
 */
export class ErrorHandler {
    private circuitBreakers = new Map<string, CircuitBreaker>();
    private retryHandler = new RetryHandler();
    private eventBus: EventBus;

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
    }

    /**
     * Execute operation with comprehensive error handling
     */
    async executeWithProtection<T>(
        layerName: string,
        operation: () => Promise<T>,
        options: {
            circuitBreakerThreshold?: number;
            circuitBreakerResetTimeout?: number;
            retryConfig?: Partial<RetryConfig>;
            degradationStrategy?: DegradationStrategy;
            fallbackValue?: T;
            timeout?: number;
        } = {}
    ): Promise<T> {
        const circuitBreaker = this.getOrCreateCircuitBreaker(
            layerName,
            options.circuitBreakerThreshold,
            options.circuitBreakerResetTimeout
        );

        const timeoutPromise = options.timeout ? this.createTimeoutPromise<T>(options.timeout, layerName) : null;

        try {
            const operationWithRetry = () => circuitBreaker.execute(operation);

            const resultPromise = this.retryHandler.execute(operationWithRetry, options.retryConfig, (error) =>
                this.shouldRetry(error, layerName)
            );

            const result = timeoutPromise ? await Promise.race([resultPromise, timeoutPromise]) : await resultPromise;

            // Record success metrics
            this.eventBus.emit('error-handler:success', {
                layerName,
                timestamp: Date.now(),
            });

            return result;
        } catch (error) {
            // Record error metrics
            this.eventBus.emit('error-handler:error', {
                layerName,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });

            // Apply degradation strategy
            return this.applyDegradationStrategy(
                error as Error,
                layerName,
                options.degradationStrategy || DegradationStrategy.SkipLayer,
                options.fallbackValue
            );
        }
    }

    /**
     * Get circuit breaker statistics for all layers
     */
    getCircuitBreakerStats(): Record<string, any> {
        const stats: Record<string, any> = {};

        for (const [layerName, breaker] of this.circuitBreakers.entries()) {
            stats[layerName] = breaker.getStats();
        }

        return stats;
    }

    /**
     * Reset circuit breaker for a specific layer
     */
    resetCircuitBreaker(layerName: string): void {
        const breaker = this.circuitBreakers.get(layerName);
        if (breaker) {
            // Create new circuit breaker (resets state)
            this.circuitBreakers.set(layerName, new CircuitBreaker());

            this.eventBus.emit('error-handler:circuit-breaker-reset', {
                layerName,
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Check if layer is healthy based on circuit breaker state
     */
    isLayerHealthy(layerName: string): boolean {
        const breaker = this.circuitBreakers.get(layerName);
        return !breaker || breaker.getState() !== CircuitBreakerState.Open;
    }

    private getOrCreateCircuitBreaker(layerName: string, threshold?: number, resetTimeout?: number): CircuitBreaker {
        if (!this.circuitBreakers.has(layerName)) {
            this.circuitBreakers.set(layerName, new CircuitBreaker(threshold, resetTimeout));
        }
        return this.circuitBreakers.get(layerName)!;
    }

    private createTimeoutPromise<T>(timeout: number, layerName: string): Promise<T> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new LayerTimeoutError(layerName, timeout));
            }, timeout);
        });
    }

    private shouldRetry(error: Error, layerName: string): boolean {
        // Don't retry validation errors
        if (error instanceof InvalidRequestError) {
            return false;
        }

        // Don't retry if circuit breaker is open
        if (error instanceof CoreError && error.code === 'CIRCUIT_BREAKER_OPEN') {
            return false;
        }

        // Retry timeout errors and temporary failures
        return error instanceof LayerTimeoutError || error instanceof LayerUnavailableError;
    }

    private async applyDegradationStrategy<T>(
        error: Error,
        layerName: string,
        strategy: DegradationStrategy,
        fallbackValue?: T
    ): Promise<T> {
        this.eventBus.emit('error-handler:degradation-applied', {
            layerName,
            strategy,
            error: error.message,
            timestamp: Date.now(),
        });

        switch (strategy) {
            case DegradationStrategy.SkipLayer:
                // For skip layer, we return a special value that indicates to continue
                // This would be handled by the layer manager
                throw error; // Let layer manager handle the skip

            case DegradationStrategy.UseCachedResult:
                // TODO: Integrate with cache service to get last known good result
                if (fallbackValue !== undefined) {
                    return fallbackValue;
                }
                throw error;

            case DegradationStrategy.ReturnPartialResult:
                if (fallbackValue !== undefined) {
                    return fallbackValue;
                }
                // Return empty array/object depending on expected type
                return (Array.isArray(fallbackValue) ? [] : {}) as T;

            case DegradationStrategy.ReturnEmpty:
                return (Array.isArray(fallbackValue) ? [] : {}) as T;

            case DegradationStrategy.Fail:
            default:
                throw error;
        }
    }

    /**
     * Create a standardized error from any thrown value
     */
    static normalizeError(error: unknown, context?: string): CoreError {
        if (error instanceof CoreError) {
            return error;
        }

        if (error instanceof Error) {
            return new CoreError(error.message, 'UNKNOWN_ERROR', context, undefined, { originalError: error });
        }

        return new CoreError(String(error), 'UNKNOWN_ERROR', context);
    }

    /**
     * Log error with appropriate level based on error type
     */
    static logError(error: Error, context?: string): void {
        const logContext = context ? `[${context}]` : '';

        if (error instanceof InvalidRequestError) {
            console.warn(`${logContext} Invalid request: ${error.message}`);
        } else if (error instanceof LayerTimeoutError) {
            console.warn(`${logContext} Layer timeout: ${error.message}`);
        } else if (error instanceof LayerUnavailableError) {
            console.error(`${logContext} Layer unavailable: ${error.message}`);
        } else if (error instanceof CoreError) {
            console.error(`${logContext} Core error [${error.code}]: ${error.message}`);
        } else {
            console.error(`${logContext} Unexpected error:`, error);
        }
    }
}

/**
 * Health checker utility
 */
export class HealthChecker {
    private eventBus: EventBus;
    private healthCheckInterval?: NodeJS.Timeout;
    private lastHealthReport = { timestamp: 0, healthy: true };

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
    }

    startHealthCheck(layers: Map<string, Layer>, errorHandler: ErrorHandler, intervalMs: number = 30000): void {
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck(layers, errorHandler);
        }, intervalMs);
        this.healthCheckInterval?.unref?.();
    }

    stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }

    private performHealthCheck(layers: Map<string, Layer>, errorHandler: ErrorHandler): void {
        const healthReport: Record<string, any> = {
            timestamp: Date.now(),
            layers: {},
            overall: true,
        };

        for (const [name, layer] of layers.entries()) {
            const layerHealth = {
                healthy: (layer.isHealthy?.() ?? true) && errorHandler.isLayerHealthy(name),
                circuitBreakerState: errorHandler.getCircuitBreakerStats()[name]?.state,
                metrics: layer.getMetrics?.() || {
                    name,
                    requestCount: 0,
                    averageLatency: 0,
                    p95Latency: 0,
                    errorCount: 0,
                    cacheHitRate: 0,
                },
            };

            healthReport.layers[name] = layerHealth;

            if (!layerHealth.healthy) {
                healthReport.overall = false;
            }
        }

        // Only emit if health status changed
        if (healthReport.overall !== this.lastHealthReport.healthy) {
            this.eventBus.emit('health-checker:status-change', {
                wasHealthy: this.lastHealthReport.healthy,
                isHealthy: healthReport.overall,
                report: healthReport,
            });
        }

        this.eventBus.emit('health-checker:report', healthReport);
        this.lastHealthReport = { timestamp: healthReport.timestamp, healthy: healthReport.overall };
    }
}
