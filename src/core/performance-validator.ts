/**
 * PerformanceValidator - Validates that performance targets from VISION.md are met
 * Monitors and reports on layer performance against specified targets
 */

import { CoreError, type EventBus, type LayerPerformance, PerformanceMetrics } from './types.js';

/**
 * Performance targets from VISION.md
 */
const PERFORMANCE_TARGETS = {
    layer1: 5, // Fast search with bloom filters - ~5ms
    layer2: 50, // AST analysis with tree-sitter - ~50ms
    layer3: 10, // Symbol map & planner - ~10ms
    layer4: 10, // Ontology / semantic graph - ~10ms
    layer5: 20, // Pattern learning & propagation - ~20ms
    total: 100, // Total target for 95% of requests - <100ms
} as const;

/**
 * Performance thresholds for warnings and alerts
 */
const PERFORMANCE_THRESHOLDS = {
    warning: 1.5, // 150% of target
    critical: 2.0, // 200% of target
    p95Target: 0.95, // 95% of requests should be under target
} as const;

interface PerformanceWindow {
    measurements: number[];
    maxSize: number;
    target: number;
}

interface ValidationResult {
    layer: string;
    target: number;
    current: number;
    p95: number;
    p99: number;
    compliance: number; // Percentage of requests under target
    status: 'excellent' | 'good' | 'warning' | 'critical';
    recommendation?: string;
}

interface OverallPerformanceReport {
    timestamp: number;
    totalMeasurements: number;
    layerResults: ValidationResult[];
    overallCompliance: number;
    systemStatus: 'healthy' | 'degraded' | 'critical';
    recommendations: string[];
    trends: {
        improving: string[];
        degrading: string[];
    };
}

/**
 * Sliding window for performance measurements
 */
class PerformanceWindow {
    private measurements: number[] = [];
    private sorted: number[] = [];
    private needsSort = false;

    constructor(
        public readonly maxSize: number,
        public readonly target: number
    ) {}

    addMeasurement(value: number): void {
        this.measurements.push(value);
        this.needsSort = true;

        // Keep window size
        if (this.measurements.length > this.maxSize) {
            this.measurements.shift();
        }
    }

    getPercentile(percentile: number): number {
        if (this.measurements.length === 0) return 0;

        this.ensureSorted();
        const index = Math.floor((percentile / 100) * this.sorted.length);
        return this.sorted[Math.min(index, this.sorted.length - 1)];
    }

    getAverage(): number {
        if (this.measurements.length === 0) return 0;
        return this.measurements.reduce((sum, v) => sum + v, 0) / this.measurements.length;
    }

    getCompliance(): number {
        if (this.measurements.length === 0) return 1;
        const underTarget = this.measurements.filter((m) => m <= this.target).length;
        return underTarget / this.measurements.length;
    }

    size(): number {
        return this.measurements.length;
    }

    getTrend(): 'improving' | 'stable' | 'degrading' {
        if (this.measurements.length < 10) return 'stable';

        const recent = this.measurements.slice(-5);
        const earlier = this.measurements.slice(-10, -5);

        const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
        const earlierAvg = earlier.reduce((sum, v) => sum + v, 0) / earlier.length;

        const improvement = (earlierAvg - recentAvg) / earlierAvg;

        if (improvement > 0.1) return 'improving';
        if (improvement < -0.1) return 'degrading';
        return 'stable';
    }

    private ensureSorted(): void {
        if (this.needsSort) {
            this.sorted = [...this.measurements].sort((a, b) => a - b);
            this.needsSort = false;
        }
    }
}

/**
 * Performance validator and monitor
 */
export class PerformanceValidator {
    private layerWindows = new Map<string, PerformanceWindow>();
    private totalWindow: PerformanceWindow;
    private eventBus: EventBus;
    private validationInterval?: NodeJS.Timeout;
    private lastValidationReport?: OverallPerformanceReport;

    constructor(eventBus: EventBus, windowSize: number = 1000) {
        this.eventBus = eventBus;
        this.totalWindow = new PerformanceWindow(windowSize, PERFORMANCE_TARGETS.total);

        // Initialize layer windows
        for (const [layer, target] of Object.entries(PERFORMANCE_TARGETS)) {
            if (layer !== 'total') {
                this.layerWindows.set(layer, new PerformanceWindow(windowSize, target));
            }
        }
    }

    /**
     * Record performance metrics from a request
     */
    recordPerformance(performance: LayerPerformance): void {
        // Record individual layer metrics
        if (performance.layer1 > 0) {
            this.layerWindows.get('layer1')?.addMeasurement(performance.layer1);
        }
        if (performance.layer2 > 0) {
            this.layerWindows.get('layer2')?.addMeasurement(performance.layer2);
        }
        if (performance.layer3 > 0) {
            this.layerWindows.get('layer3')?.addMeasurement(performance.layer3);
        }
        if (performance.layer4 > 0) {
            this.layerWindows.get('layer4')?.addMeasurement(performance.layer4);
        }
        if (performance.layer5 > 0) {
            this.layerWindows.get('layer5')?.addMeasurement(performance.layer5);
        }

        // Record total performance
        this.totalWindow.addMeasurement(performance.total);

        // Check for immediate performance violations
        this.checkImmediateViolations(performance);
    }

    /**
     * Validate current performance against targets
     */
    validatePerformance(): OverallPerformanceReport {
        const timestamp = Date.now();
        const layerResults: ValidationResult[] = [];
        const recommendations: string[] = [];
        const trends = { improving: [], degrading: [] };

        // Validate each layer
        for (const [layerName, window] of this.layerWindows.entries()) {
            const result = this.validateLayer(layerName, window);
            layerResults.push(result);

            if (result.recommendation) {
                recommendations.push(result.recommendation);
            }

            const trend = window.getTrend();
            if (trend === 'improving') {
                trends.improving.push(layerName);
            } else if (trend === 'degrading') {
                trends.degrading.push(layerName);
            }
        }

        // Validate total performance
        const totalResult = this.validateLayer('total', this.totalWindow);
        layerResults.push(totalResult);

        if (totalResult.recommendation) {
            recommendations.push(totalResult.recommendation);
        }

        // Calculate overall compliance
        const overallCompliance =
            layerResults.reduce((sum, result) => {
                return sum + result.compliance;
            }, 0) / layerResults.length;

        // Determine system status
        const criticalLayers = layerResults.filter((r) => r.status === 'critical');
        const warningLayers = layerResults.filter((r) => r.status === 'warning');

        let systemStatus: 'healthy' | 'degraded' | 'critical';
        if (criticalLayers.length > 0) {
            systemStatus = 'critical';
        } else if (warningLayers.length > 2 || totalResult.status === 'warning') {
            systemStatus = 'degraded';
        } else {
            systemStatus = 'healthy';
        }

        const report: OverallPerformanceReport = {
            timestamp,
            totalMeasurements: this.getTotalMeasurements(),
            layerResults,
            overallCompliance,
            systemStatus,
            recommendations,
            trends,
        };

        this.lastValidationReport = report;

        this.eventBus.emit('performance-validator:report', report);

        return report;
    }

    /**
     * Start periodic validation
     */
    startPeriodicValidation(intervalMs: number = 30000): void {
        this.validationInterval = setInterval(() => {
            this.validatePerformance();
        }, intervalMs);
        this.validationInterval?.unref?.();
    }

    /**
     * Stop periodic validation
     */
    stopPeriodicValidation(): void {
        if (this.validationInterval) {
            clearInterval(this.validationInterval);
        }
    }

    /**
     * Get current performance statistics
     */
    getPerformanceStats(): {
        layers: Record<
            string,
            {
                target: number;
                average: number;
                p95: number;
                p99: number;
                compliance: number;
                measurements: number;
            }
        >;
        total: {
            target: number;
            average: number;
            p95: number;
            p99: number;
            compliance: number;
            measurements: number;
        };
    } {
        const layers: Record<string, any> = {};

        for (const [layerName, window] of this.layerWindows.entries()) {
            layers[layerName] = {
                target: window.target,
                average: window.getAverage(),
                p95: window.getPercentile(95),
                p99: window.getPercentile(99),
                compliance: window.getCompliance(),
                measurements: window.size(),
            };
        }

        return {
            layers,
            total: {
                target: this.totalWindow.target,
                average: this.totalWindow.getAverage(),
                p95: this.totalWindow.getPercentile(95),
                p99: this.totalWindow.getPercentile(99),
                compliance: this.totalWindow.getCompliance(),
                measurements: this.totalWindow.size(),
            },
        };
    }

    /**
     * Check if performance targets are being met
     */
    isPerformanceHealthy(): boolean {
        if (!this.lastValidationReport) {
            return true; // No data yet
        }

        return this.lastValidationReport.systemStatus === 'healthy';
    }

    /**
     * Get latest validation report
     */
    getLatestReport(): OverallPerformanceReport | null {
        return this.lastValidationReport || null;
    }

    /**
     * Reset all performance data (useful for testing)
     */
    reset(): void {
        this.layerWindows.clear();
        this.totalWindow = new PerformanceWindow(1000, PERFORMANCE_TARGETS.total);

        // Reinitialize layer windows
        for (const [layer, target] of Object.entries(PERFORMANCE_TARGETS)) {
            if (layer !== 'total') {
                this.layerWindows.set(layer, new PerformanceWindow(1000, target));
            }
        }

        this.lastValidationReport = undefined;

        this.eventBus.emit('performance-validator:reset', {
            timestamp: Date.now(),
        });
    }

    private validateLayer(layerName: string, window: PerformanceWindow): ValidationResult {
        const average = window.getAverage();
        const p95 = window.getPercentile(95);
        const p99 = window.getPercentile(99);
        const compliance = window.getCompliance();
        const target = window.target;

        // Determine status
        let status: ValidationResult['status'];
        let recommendation: string | undefined;

        if (compliance >= PERFORMANCE_THRESHOLDS.p95Target && p95 <= target) {
            status = 'excellent';
        } else if (compliance >= 0.8 && p95 <= target * PERFORMANCE_THRESHOLDS.warning) {
            status = 'good';
        } else if (compliance >= 0.6 && p95 <= target * PERFORMANCE_THRESHOLDS.critical) {
            status = 'warning';
            recommendation = `${layerName} performance degraded: p95=${p95.toFixed(1)}ms (target: ${target}ms). Consider optimization.`;
        } else {
            status = 'critical';
            recommendation = `${layerName} performance critical: p95=${p95.toFixed(1)}ms (target: ${target}ms). Immediate attention required.`;
        }

        return {
            layer: layerName,
            target,
            current: average,
            p95,
            p99,
            compliance,
            status,
            recommendation,
        };
    }

    private checkImmediateViolations(performance: LayerPerformance): void {
        // Check for immediate critical violations
        const violations: string[] = [];

        if (performance.layer1 > PERFORMANCE_TARGETS.layer1 * PERFORMANCE_THRESHOLDS.critical) {
            violations.push(`Layer 1 critical latency: ${performance.layer1}ms`);
        }
        if (performance.layer2 > PERFORMANCE_TARGETS.layer2 * PERFORMANCE_THRESHOLDS.critical) {
            violations.push(`Layer 2 critical latency: ${performance.layer2}ms`);
        }
        if (performance.layer3 > PERFORMANCE_TARGETS.layer3 * PERFORMANCE_THRESHOLDS.critical) {
            violations.push(`Layer 3 critical latency: ${performance.layer3}ms`);
        }
        if (performance.layer4 > PERFORMANCE_TARGETS.layer4 * PERFORMANCE_THRESHOLDS.critical) {
            violations.push(`Layer 4 critical latency: ${performance.layer4}ms`);
        }
        if (performance.layer5 > PERFORMANCE_TARGETS.layer5 * PERFORMANCE_THRESHOLDS.critical) {
            violations.push(`Layer 5 critical latency: ${performance.layer5}ms`);
        }
        if (performance.total > PERFORMANCE_TARGETS.total * PERFORMANCE_THRESHOLDS.critical) {
            violations.push(`Total critical latency: ${performance.total}ms`);
        }

        if (violations.length > 0) {
            this.eventBus.emit('performance-validator:critical-violation', {
                violations,
                performance,
                timestamp: Date.now(),
            });
        }
    }

    private getTotalMeasurements(): number {
        let total = 0;
        for (const window of this.layerWindows.values()) {
            total += window.size();
        }
        total += this.totalWindow.size();
        return total;
    }
}

/**
 * Utility to create performance recommendations
 */
export class PerformanceOptimizer {
    static generateOptimizationSuggestions(report: OverallPerformanceReport): string[] {
        const suggestions: string[] = [];

        for (const result of report.layerResults) {
            if (result.status === 'critical' || result.status === 'warning') {
                suggestions.push(...PerformanceOptimizer.getLayerOptimizations(result.layer, result));
            }
        }

        // System-wide optimizations
        if (report.systemStatus !== 'healthy') {
            suggestions.push(
                'Consider increasing cache size and TTL',
                'Review database indexes and query optimization',
                'Consider horizontal scaling or load balancing',
                'Enable performance profiling to identify bottlenecks'
            );
        }

        return [...new Set(suggestions)]; // Remove duplicates
    }

    private static getLayerOptimizations(layer: string, result: ValidationResult): string[] {
        const suggestions: string[] = [];

        switch (layer) {
            case 'layer1':
                suggestions.push(
                    'Optimize bloom filter parameters',
                    'Increase frequency cache size',
                    'Add more aggressive file type filtering',
                    'Consider parallel search execution'
                );
                break;

            case 'layer2':
                suggestions.push(
                    'Reduce AST parsing depth for large files',
                    'Implement incremental parsing',
                    'Cache parsed ASTs',
                    'Use faster tree-sitter language parsers'
                );
                break;

            case 'layer3':
                suggestions.push(
                    'Reduce planner scope (limit files/symbols)',
                    'Cache symbol maps for hot modules',
                    'Apply time-bounded planning heuristics',
                    'Defer non-critical rename checks'
                );
                break;

            case 'layer4':
                suggestions.push(
                    'Add database indexes on frequently queried columns',
                    'Optimize concept similarity calculations',
                    'Increase concept cache size',
                    'Use connection pooling'
                );
                break;

            case 'layer5':
                suggestions.push(
                    'Limit propagation depth',
                    'Use async propagation for non-critical updates',
                    'Cache propagation results',
                    'Optimize relationship graph traversal'
                );
                break;

            case 'total':
                suggestions.push(
                    'Enable layer bypass for simple queries',
                    'Implement request prioritization',
                    'Use circuit breakers to prevent cascade failures',
                    'Consider distributed caching'
                );
                break;
        }

        return suggestions;
    }
}
