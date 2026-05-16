/**
 * MonitoringService - Performance monitoring and metrics collection
 * Tracks layer performance, cache hits, errors, and system health
 */

import { CoreError, type EventBus, type MonitoringConfig, type PerformanceMetrics } from '../types.js';

export interface MetricsSummary {
    requestCount: number;
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
    errorRate: number;
    cacheHitRate: number;
    layerBreakdown: Record<
        string,
        {
            requestCount: number;
            averageLatency: number;
            errorCount: number;
        }
    >;
}

/**
 * Sliding window for calculating percentiles efficiently
 */
class SlidingWindow {
    private values: number[] = [];
    private maxSize: number;

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }

    add(value: number): void {
        this.values.push(value);
        if (this.values.length > this.maxSize) {
            this.values.shift();
        }
    }

    getPercentile(percentile: number): number {
        if (this.values.length === 0) return 0;

        const sorted = [...this.values].sort((a, b) => a - b);
        const index = Math.floor((percentile / 100) * sorted.length);
        return sorted[Math.min(index, sorted.length - 1)];
    }

    getAverage(): number {
        if (this.values.length === 0) return 0;
        return this.values.reduce((sum, v) => sum + v, 0) / this.values.length;
    }

    size(): number {
        return this.values.length;
    }

    clear(): void {
        this.values.length = 0;
    }
}

/**
 * Monitoring service for performance metrics and system health
 */
export class MonitoringService {
    private config: MonitoringConfig;
    private eventBus: EventBus;
    private initialized = false;

    // Performance tracking
    private latencyWindow = new SlidingWindow(1000);
    private layerMetrics = new Map<
        string,
        {
            requestCount: number;
            totalLatency: number;
            errorCount: number;
            latencyWindow: SlidingWindow;
        }
    >();

    // Cache tracking
    private cacheHits = 0;
    private cacheMisses = 0;

    // Error tracking
    private errorCounts = new Map<string, number>();
    private recentErrors: Array<{ timestamp: number; error: string; layer?: string }> = [];

    // Request tracking
    private totalRequests = 0;
    private startTime = Date.now();

    // Health monitoring
    private healthCheckTimer?: NodeJS.Timeout;

    // Tool tracking (counts + recent)
    private toolCounts = new Map<string, number>();
    private toolRecent: Array<{ name: string; timestamp: number }> = [];

    constructor(config: MonitoringConfig, eventBus: EventBus) {
        this.config = config;
        this.eventBus = eventBus;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize layer metrics for standard layers
            const layers = ['layer1', 'layer2', 'layer3', 'layer4', 'layer5'];
            for (const layer of layers) {
                this.layerMetrics.set(layer, {
                    requestCount: 0,
                    totalLatency: 0,
                    errorCount: 0,
                    latencyWindow: new SlidingWindow(1000),
                });
            }

            // Start periodic metrics reporting
            if (this.config.enabled) {
                this.startMetricsReporting();
            }

            this.initialized = true;

            this.eventBus.emit('monitoring-service:initialized', {
                enabled: this.config.enabled,
                metricsInterval: this.config.metricsInterval,
                timestamp: Date.now(),
            });
        } catch (error) {
            this.eventBus.emit('monitoring-service:error', {
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        this.initialized = false;

        this.eventBus.emit('monitoring-service:disposed', {
            finalMetrics: this.getSummary(),
            timestamp: Date.now(),
        });
    }

    /**
     * Record performance metrics for a layer operation
     */
    recordPerformance(metrics: PerformanceMetrics): void {
        if (!this.initialized || !this.config.enabled) {
            return;
        }

        this.totalRequests++;

        if (metrics.duration) {
            this.latencyWindow.add(metrics.duration);

            // Update layer-specific metrics
            let layerMetrics = this.layerMetrics.get(metrics.layer);
            if (!layerMetrics) {
                layerMetrics = {
                    requestCount: 0,
                    totalLatency: 0,
                    errorCount: 0,
                    latencyWindow: new SlidingWindow(1000),
                };
                this.layerMetrics.set(metrics.layer, layerMetrics);
            }

            layerMetrics.requestCount++;
            layerMetrics.totalLatency += metrics.duration;
            layerMetrics.latencyWindow.add(metrics.duration);

            if (metrics.errorCount && metrics.errorCount > 0) {
                layerMetrics.errorCount += metrics.errorCount;
            }
        }

        // Emit performance event
        this.eventBus.emit('monitoring-service:performance-recorded', {
            layer: metrics.layer,
            operation: metrics.operation,
            duration: metrics.duration,
            cacheHit: metrics.cacheHit,
            timestamp: Date.now(),
        });
    }

    /**
     * Record cache hit
     */
    recordCacheHit(key: string, source: 'memory' | 'redis', timestamp: number): void {
        if (!this.initialized || !this.config.enabled) {
            return;
        }

        this.cacheHits++;
    }

    /**
     * Record cache miss
     */
    recordCacheMiss(key: string, timestamp: number): void {
        if (!this.initialized || !this.config.enabled) {
            return;
        }

        this.cacheMisses++;
    }

    /**
     * Record a tool invocation by name (for HTTP/MCP tool endpoints)
     */
    recordToolCall(name: string): void {
        if (!this.initialized || !this.config.enabled) return;
        const key = String(name || 'unknown');
        const prev = this.toolCounts.get(key) || 0;
        this.toolCounts.set(key, prev + 1);
        const now = Date.now();
        this.toolRecent.push({ name: key, timestamp: now });
        if (this.toolRecent.length > 50) this.toolRecent.splice(0, this.toolRecent.length - 50);
        this.eventBus.emit('monitoring-service:tool-called', { name: key, count: prev + 1, timestamp: now });
    }

    getToolCounts(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const [k, v] of this.toolCounts.entries()) out[k] = v;
        return out;
    }

    getToolRecent(limit = 20): Array<{ name: string; timestamp: number }> {
        return this.toolRecent.slice(-limit);
    }

    /**
     * Record error occurrence
     */
    recordError(layer: string, error: string, timestamp: number): void {
        if (!this.initialized || !this.config.enabled) {
            return;
        }

        // Update error counts
        const currentCount = this.errorCounts.get(layer) || 0;
        this.errorCounts.set(layer, currentCount + 1);

        // Add to recent errors (keep last 100)
        this.recentErrors.push({ timestamp, error, layer });
        if (this.recentErrors.length > 100) {
            this.recentErrors.shift();
        }

        // Update layer metrics
        const layerMetrics = this.layerMetrics.get(layer);
        if (layerMetrics) {
            layerMetrics.errorCount++;
        }

        this.eventBus.emit('monitoring-service:error-recorded', {
            layer,
            error,
            timestamp,
        });
    }

    /**
     * Get current metrics summary
     */
    getSummary(): MetricsSummary {
        const totalCacheRequests = this.cacheHits + this.cacheMisses;
        const cacheHitRate = totalCacheRequests > 0 ? this.cacheHits / totalCacheRequests : 0;

        const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
        const errorRate = this.totalRequests > 0 ? totalErrors / this.totalRequests : 0;

        const layerBreakdown: Record<string, any> = {};
        for (const [layer, metrics] of this.layerMetrics.entries()) {
            layerBreakdown[layer] = {
                requestCount: metrics.requestCount,
                averageLatency: metrics.requestCount > 0 ? metrics.totalLatency / metrics.requestCount : 0,
                errorCount: metrics.errorCount,
            };
        }

        return {
            requestCount: this.totalRequests,
            averageLatency: this.latencyWindow.getAverage(),
            p95Latency: this.latencyWindow.getPercentile(95),
            p99Latency: this.latencyWindow.getPercentile(99),
            errorRate,
            cacheHitRate,
            layerBreakdown,
        };
    }

    /**
     * Get detailed statistics
     */
    async getStats(): Promise<{
        summary: MetricsSummary;
        uptime: number;
        recentErrors: Array<{ timestamp: number; error: string; layer?: string }>;
        layerHealth: Record<
            string,
            {
                healthy: boolean;
                averageLatency: number;
                errorRate: number;
                requestCount: number;
            }
        >;
    }> {
        const summary = this.getSummary();
        const uptime = Date.now() - this.startTime;

        // Calculate layer health
        const layerHealth: Record<string, any> = {};
        for (const [layer, metrics] of this.layerMetrics.entries()) {
            const averageLatency = metrics.requestCount > 0 ? metrics.totalLatency / metrics.requestCount : 0;
            const errorRate = metrics.requestCount > 0 ? metrics.errorCount / metrics.requestCount : 0;

            // Define health thresholds
            const latencyThreshold = this.getLatencyThreshold(layer);
            const errorRateThreshold = 0.05; // 5% error rate threshold

            layerHealth[layer] = {
                healthy: averageLatency < latencyThreshold && errorRate < errorRateThreshold,
                averageLatency,
                errorRate,
                requestCount: metrics.requestCount,
            };
        }

        return {
            summary,
            uptime,
            recentErrors: this.recentErrors.slice(-20), // Last 20 errors
            layerHealth,
        };
    }

    /**
     * Reset all metrics (useful for testing or maintenance)
     */
    reset(): void {
        this.latencyWindow.clear();
        this.layerMetrics.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.errorCounts.clear();
        this.recentErrors.length = 0;
        this.totalRequests = 0;
        this.startTime = Date.now();

        // Reinitialize layer metrics
        const layers = ['layer1', 'layer2', 'layer3', 'layer4', 'layer5'];
        for (const layer of layers) {
            this.layerMetrics.set(layer, {
                requestCount: 0,
                totalLatency: 0,
                errorCount: 0,
                latencyWindow: new SlidingWindow(1000),
            });
        }

        this.eventBus.emit('monitoring-service:reset', {
            timestamp: Date.now(),
        });
    }

    /**
     * Check if monitoring service is healthy
     */
    isHealthy(): boolean {
        if (!this.initialized) {
            return false;
        }

        // Check overall error rate
        const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
        const errorRate = this.totalRequests > 0 ? totalErrors / this.totalRequests : 0;

        // System is unhealthy if error rate is too high
        if (errorRate > 0.1) {
            // 10% error rate threshold
            return false;
        }

        // Check recent errors - if too many recent errors, system might be unhealthy
        const recentErrorsCount = this.recentErrors.filter(
            (error) => Date.now() - error.timestamp < 60000 // Last 1 minute
        ).length;

        if (recentErrorsCount > 10) {
            return false;
        }

        return true;
    }

    getDiagnostics(): Record<string, any> {
        return {
            initialized: this.initialized,
            config: this.config,
            metrics: {
                totalRequests: this.totalRequests,
                uptime: Date.now() - this.startTime,
                cacheHits: this.cacheHits,
                cacheMisses: this.cacheMisses,
                recentErrorCount: this.recentErrors.length,
            },
            healthy: this.isHealthy(),
            toolCounts: this.getToolCounts(),
            toolRecent: this.getToolRecent(),
            timestamp: Date.now(),
        };
    }

    private startMetricsReporting(): void {
        const interval = this.config.metricsInterval || 60000; // Default 1 minute

        this.healthCheckTimer = setInterval(() => {
            const summary = this.getSummary();

            this.eventBus.emit('monitoring-service:metrics-report', {
                summary,
                timestamp: Date.now(),
            });

            // Log metrics if configured (suppress for stdio/MCP to avoid protocol corruption)
            if (this.config.enabled && !process.env.STDIO_MODE && !process.env.SILENT_MODE) {
                console.error(
                    `[Metrics] Requests: ${summary.requestCount}, Avg Latency: ${summary.averageLatency.toFixed(2)}ms, Error Rate: ${(summary.errorRate * 100).toFixed(2)}%, Cache Hit Rate: ${(summary.cacheHitRate * 100).toFixed(2)}%`
                );
            }
        }, interval);

        // Don't keep the process alive solely for periodic metrics in dev/test.
        this.healthCheckTimer?.unref?.();
    }

    private getLatencyThreshold(layer: string): number {
        // Define target latencies for each layer (from VISION.md)
        const thresholds = {
            layer1: 10, // 5ms target * 2
            layer2: 100, // 50ms target * 2
            layer3: 20, // 10ms target * 2
            layer4: 20, // 10ms target * 2
            layer5: 40, // 20ms target * 2
        };

        return thresholds[layer as keyof typeof thresholds] || 100;
    }
}
