/**
 * Pattern Learner Layer (Layer 5) - Learns and applies refactoring patterns
 * Wraps the PatternLearner class to provide Layer interface compatibility
 */

import type { LayerMetrics } from '../core/types.js';
import { type LearningResult, PatternLearner, type Prediction } from '../patterns/pattern-learner.js';

export interface PatternQuery {
    type: 'learn' | 'predict' | 'apply' | 'suggest';
    identifier?: string;
    oldName?: string;
    newName?: string;
    context?: any;
    maxResults?: number;
}

export interface PatternResult {
    predictions?: Prediction[];
    learningResult?: LearningResult;
    appliedPattern?: string;
    suggestions?: Array<{
        original: string;
        suggested: string;
        confidence: number;
        reason: string;
    }>;
    searchTime: number;
}

export interface PatternLearnerLayerConfig {
    dbPath?: string;
    learningThreshold?: number;
    confidenceThreshold?: number;
    timeout?: number;
    enabled?: boolean;
}

export class PatternLearnerLayer {
    name = 'layer5';
    version = '1.0.0';
    targetLatency = 10; // 10ms target for pattern operations

    private patternLearner: PatternLearner;
    private config: PatternLearnerLayerConfig;
    private metrics: LayerMetrics;
    private initialized = false;

    constructor(config: PatternLearnerLayerConfig = {}) {
        this.config = {
            dbPath: config.dbPath || ':memory:',
            learningThreshold: config.learningThreshold || 3,
            confidenceThreshold: config.confidenceThreshold || 0.7,
            timeout: config.timeout || 50,
            enabled: config.enabled !== false,
            ...config,
        };

        this.patternLearner = new PatternLearner(this.config.dbPath!, {
            learningThreshold: this.config.learningThreshold,
            confidenceThreshold: this.config.confidenceThreshold,
        });

        this.metrics = {
            name: this.name,
            requestCount: 0,
            averageLatency: 0,
            p95Latency: 0,
            errorCount: 0,
            cacheHitRate: 0,
            lastRequestTime: undefined,
        };
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.patternLearner.ensureInitialized();
            this.initialized = true;
            console.log('Pattern Learner Layer initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Pattern Learner Layer:', error);
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        try {
            await this.patternLearner.dispose();
            this.initialized = false;
            console.log('Pattern Learner Layer disposed');
        } catch (error) {
            console.error('Error disposing Pattern Learner Layer:', error);
        }
    }

    isHealthy(): boolean {
        return this.initialized;
    }

    getMetrics(): LayerMetrics {
        return { ...this.metrics };
    }

    async process(query: PatternQuery): Promise<PatternResult> {
        const startTime = Date.now();

        if (!this.initialized) {
            throw new Error('Pattern Learner Layer not initialized');
        }

        try {
            this.metrics.requestCount++;
            const result: PatternResult = {
                searchTime: 0,
            };

            switch (query.type) {
                case 'learn':
                    if (query.oldName && query.newName && query.context) {
                        const learningResult = await this.patternLearner.learnFromRename(
                            query.oldName,
                            query.newName,
                            query.context
                        );
                        result.learningResult = learningResult;
                    }
                    break;

                case 'predict':
                    if (query.identifier) {
                        const predictions = await this.patternLearner.predictNextRename(
                            query.identifier,
                            query.context
                        );
                        result.predictions = query.maxResults ? predictions.slice(0, query.maxResults) : predictions;
                    }
                    break;

                case 'apply':
                    if (query.identifier && query.context?.pattern) {
                        const appliedResult = await this.patternLearner.applyPattern(
                            query.context.pattern,
                            query.identifier
                        );
                        result.appliedPattern = appliedResult;
                    }
                    break;

                case 'suggest':
                    if (query.identifier) {
                        const patterns = await this.patternLearner.findApplicablePatterns(query.identifier);
                        result.suggestions = [];

                        for (const pattern of patterns.slice(0, query.maxResults || 5)) {
                            const applied = await this.patternLearner.applyPattern(pattern, query.identifier);
                            if (applied && applied !== query.identifier) {
                                result.suggestions.push({
                                    original: query.identifier,
                                    suggested: applied,
                                    confidence: pattern.confidence,
                                    reason: `Pattern from ${pattern.category} (${pattern.occurrences} occurrences)`,
                                });
                            }
                        }
                    }
                    break;

                default:
                    throw new Error(`Unknown query type: ${query.type}`);
            }

            const duration = Date.now() - startTime;
            result.searchTime = duration;

            // Update metrics
            this.updateMetrics(duration, false);

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.updateMetrics(duration, true);

            console.error('Pattern Learner Layer processing error:', error);
            throw error;
        }
    }

    private updateMetrics(duration: number, isError: boolean): void {
        this.metrics.lastRequestTime = Date.now();

        if (isError) {
            this.metrics.errorCount++;
        }

        // Update average latency (exponential moving average)
        const alpha = 0.1;
        this.metrics.averageLatency = this.metrics.averageLatency * (1 - alpha) + duration * alpha;

        // Update p95 latency (simplified calculation)
        this.metrics.p95Latency = Math.max(this.metrics.p95Latency * 0.95, duration);
    }

    /**
     * Get diagnostic information
     */
    getDiagnostics(): Record<string, any> {
        return {
            name: this.name,
            version: this.version,
            targetLatency: this.targetLatency,
            initialized: this.initialized,
            config: this.config,
            metrics: this.metrics,
            timestamp: Date.now(),
        };
    }

    /**
     * Get pattern statistics
     */
    async getPatternStatistics(): Promise<any> {
        if (!this.initialized) {
            return { error: 'Not initialized' };
        }

        try {
            return await this.patternLearner.getStatistics();
        } catch (error) {
            console.error('Error getting pattern statistics:', error);
            return { error: 'Failed to get statistics' };
        }
    }

    /**
     * Import patterns from external source
     */
    async importPatterns(patterns: any[]): Promise<void> {
        if (!this.initialized) {
            throw new Error('Pattern Learner Layer not initialized');
        }

        for (const patternData of patterns) {
            await this.patternLearner.importPattern(patternData);
        }
    }

    /**
     * Export all learned patterns
     */
    async exportPatterns(): Promise<any[]> {
        if (!this.initialized) {
            throw new Error('Pattern Learner Layer not initialized');
        }

        return await this.patternLearner.exportPatterns();
    }
}
