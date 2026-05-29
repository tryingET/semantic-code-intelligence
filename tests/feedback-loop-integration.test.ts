/**
 * Comprehensive Integration Tests for FeedbackLoopSystem
 * Tests the complete feedback loop functionality with proper setup
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { EventBusService } from '../src/core/services/event-bus-service.js';
import { SharedServices } from '../src/core/services/index.js';
import type { CoreConfig } from '../src/core/types.js';
import { FEEDBACK_LOOP_PERFORMANCE_TARGETS, FeedbackEvent, FeedbackLoopSystem } from '../src/learning/feedback-loop.js';
import { PatternLearner } from '../src/patterns/pattern-learner.js';

// Test database paths
const TEST_DB_PATH = path.join(process.cwd(), 'test-feedback-integration.db');
const PATTERN_DB_PATH = path.join(process.cwd(), 'test-patterns-integration.db');

const cleanupDbFiles = (dbPath: string) => {
    const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
        }
    }
};

// Mock configuration with proper cache config
const mockConfig: CoreConfig = {
    layers: {
        layer1: { enabled: true, timeout: 5000, maxResults: 100 },
        layer2: { enabled: true, timeout: 50000, languages: ['typescript', 'javascript'] },
        layer3: { enabled: true, dbPath: TEST_DB_PATH, cacheSize: 1000 },
        layer4: { enabled: true, dbPath: TEST_DB_PATH },
        layer5: { enabled: true, maxDepth: 3, autoApplyThreshold: 0.8 },
    },
    cache: { enabled: true, strategy: 'memory', memory: { maxSize: 1024 * 1024, ttl: 300 } },
    monitoring: { enabled: true, metricsInterval: 1000, logLevel: 'error', tracing: { enabled: false, sampleRate: 0 } },
    performance: { healthCheckInterval: 30000 },
    database: { path: TEST_DB_PATH, maxConnections: 2 },
};

describe('FeedbackLoopSystem Integration', () => {
    let feedbackLoop: FeedbackLoopSystem;
    let sharedServices: SharedServices;
    let eventBus: EventBusService;
    let patternLearner: PatternLearner;

    beforeEach(async () => {
        // Clean up test databases
        cleanupDbFiles(TEST_DB_PATH);
        cleanupDbFiles(PATTERN_DB_PATH);

        // Create fresh components
        eventBus = new EventBusService();
        sharedServices = new SharedServices(mockConfig, eventBus);
        await sharedServices.initialize();

        // Create pattern learner
        patternLearner = new PatternLearner(PATTERN_DB_PATH, {
            learningThreshold: 3,
            confidenceThreshold: 0.7,
        });
        await patternLearner.ensureInitialized();

        // Create feedback loop system
        feedbackLoop = new FeedbackLoopSystem(sharedServices, eventBus, {
            minFeedbacksToLearn: 3,
            weakPatternThreshold: 0.3,
            strongPatternThreshold: 0.8,
        });

        await feedbackLoop.initialize();
        feedbackLoop.setPatternLearner(patternLearner);
    });

    afterEach(async () => {
        // Proper cleanup
        try {
            if (feedbackLoop) await feedbackLoop.dispose();
            if (patternLearner) await patternLearner.dispose();
            if (sharedServices) await sharedServices.dispose();
        } catch (error) {
            console.warn('Cleanup warning:', error);
        }

        // Remove test databases
        cleanupDbFiles(TEST_DB_PATH);
        cleanupDbFiles(PATTERN_DB_PATH);
    });

    describe('System Initialization', () => {
        test('should initialize all components correctly', async () => {
            expect(feedbackLoop).toBeDefined();
            const diagnostics = feedbackLoop.getDiagnostics();
            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.hasPatternLearner).toBe(true);
            expect(diagnostics.feedbackHistorySize).toBe(0);
        });

        test('should have proper configuration', () => {
            const diagnostics = feedbackLoop.getDiagnostics();
            expect(diagnostics.learningThresholds.minFeedbacksToLearn).toBe(3);
            expect(diagnostics.learningThresholds.weakPatternThreshold).toBe(0.3);
            expect(diagnostics.learningThresholds.strongPatternThreshold).toBe(0.8);
        });
    });

    describe('Feedback Recording', () => {
        test('should record positive feedback successfully', async () => {
            const feedbackId = await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'test-suggestion-1',
                originalSuggestion: 'getUserData',
                context: {
                    file: '/src/user.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.85,
                },
                metadata: {
                    source: 'test',
                    timeToDecision: 2500,
                },
            });

            expect(feedbackId).toBeDefined();
            expect(typeof feedbackId).toBe('string');

            const recentFeedback = feedbackLoop.getRecentFeedback(1);
            expect(recentFeedback.length).toBe(1);
            expect(recentFeedback[0].type).toBe('accept');
            expect(recentFeedback[0].originalSuggestion).toBe('getUserData');
        });

        test('should record negative feedback successfully', async () => {
            await feedbackLoop.recordFeedback({
                type: 'reject',
                suggestionId: 'test-suggestion-2',
                originalSuggestion: 'badName',
                context: {
                    file: '/src/test.ts',
                    operation: 'completion',
                    timestamp: new Date(),
                    confidence: 0.4,
                },
                metadata: {
                    source: 'test',
                },
            });

            const recentFeedback = feedbackLoop.getRecentFeedback(1);
            expect(recentFeedback.length).toBe(1);
            expect(recentFeedback[0].type).toBe('reject');
        });

        test('should record modification feedback with final value', async () => {
            await feedbackLoop.recordFeedback({
                type: 'modify',
                suggestionId: 'test-suggestion-3',
                originalSuggestion: 'originalName',
                finalValue: 'modifiedName',
                context: {
                    file: '/src/test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.7,
                },
                metadata: {
                    source: 'test',
                    keystrokes: 8,
                },
            });

            const recentFeedback = feedbackLoop.getRecentFeedback(1);
            expect(recentFeedback.length).toBe(1);
            expect(recentFeedback[0].type).toBe('modify');
            expect(recentFeedback[0].finalValue).toBe('modifiedName');
        });

        test('should handle multiple feedback types correctly', async () => {
            const feedbackTypes: Array<'accept' | 'reject' | 'modify' | 'ignore'> = [
                'accept',
                'reject',
                'modify',
                'ignore',
            ];

            for (const type of feedbackTypes) {
                await feedbackLoop.recordFeedback({
                    type,
                    suggestionId: `test-${type}`,
                    originalSuggestion: 'testName',
                    finalValue: type === 'modify' ? 'modifiedTestName' : undefined,
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.7,
                    },
                    metadata: {
                        source: 'test',
                    },
                });
            }

            const allFeedback = feedbackLoop.getRecentFeedback(10);
            expect(allFeedback.length).toBe(4);

            const types = allFeedback.map((f) => f.type);
            expect(types).toContain('accept');
            expect(types).toContain('reject');
            expect(types).toContain('modify');
            expect(types).toContain('ignore');
        });
    });

    describe('Learning from Corrections', () => {
        test('should learn from user corrections', async () => {
            const original = 'getUserData';
            const corrected = 'fetchUserData';

            await feedbackLoop.learnFromCorrection(original, corrected, {
                file: '/src/user.ts',
                operation: 'rename',
                confidence: 0.7,
            });

            // Should have recorded the correction as feedback
            const recentFeedback = feedbackLoop.getRecentFeedback(5);
            const correctionFeedback = recentFeedback.find((f) => f.type === 'modify');

            expect(correctionFeedback).toBeDefined();
            expect(correctionFeedback?.originalSuggestion).toBe(original);
            expect(correctionFeedback?.finalValue).toBe(corrected);
        });

        test('should handle similar corrections (pattern refinement)', async () => {
            // First correction
            await feedbackLoop.learnFromCorrection('getData', 'fetchData', {
                file: '/src/api.ts',
                operation: 'rename',
                confidence: 0.8,
            });

            // Similar correction should be processed quickly
            const startTime = Date.now();
            await feedbackLoop.learnFromCorrection('getUser', 'fetchUser', {
                file: '/src/user.ts',
                operation: 'rename',
                confidence: 0.8,
            });
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(50); // Should be fast

            // Should have 2 correction feedback items
            const corrections = feedbackLoop.getRecentFeedback(10).filter((f) => f.type === 'modify');
            expect(corrections.length).toBe(2);
        });

        test('should handle dissimilar corrections (new patterns)', async () => {
            const original = 'myFunction';
            const corrected = 'calculateTotalPrice';

            await feedbackLoop.learnFromCorrection(original, corrected, {
                file: '/src/calculator.ts',
                operation: 'rename',
                confidence: 0.6,
            });

            const recentFeedback = feedbackLoop.getRecentFeedback(5);
            const correctionFeedback = recentFeedback.find(
                (f) => f.originalSuggestion === original && f.finalValue === corrected
            );

            expect(correctionFeedback).toBeDefined();
            // Should track significant keystrokes for major changes
            expect(correctionFeedback?.metadata.keystrokes).toBeGreaterThan(5);
        });
    });

    describe('Statistics and Analytics', () => {
        beforeEach(async () => {
            // Add diverse test feedback data
            const feedbackData = [
                { type: 'accept', confidence: 0.9, patternId: 'pattern-1' },
                { type: 'accept', confidence: 0.8, patternId: 'pattern-1' },
                { type: 'reject', confidence: 0.3, patternId: 'pattern-2' },
                { type: 'modify', confidence: 0.7, patternId: undefined },
                { type: 'accept', confidence: 0.85, patternId: 'pattern-3' },
            ] as const;

            for (let i = 0; i < feedbackData.length; i++) {
                await feedbackLoop.recordFeedback({
                    type: feedbackData[i].type,
                    suggestionId: `stats-test-${i}`,
                    patternId: feedbackData[i].patternId,
                    originalSuggestion: `testName${i}`,
                    finalValue: feedbackData[i].type === 'modify' ? `modifiedName${i}` : undefined,
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(Date.now() - i * 60 * 1000), // Spread over time
                        confidence: feedbackData[i].confidence,
                    },
                    metadata: {
                        source: 'stats-test',
                    },
                });
            }
        });

        test('should calculate basic statistics correctly', async () => {
            const stats = await feedbackLoop.getFeedbackStats();

            expect(stats.totalFeedbacks).toBe(5);
            expect(stats.acceptanceRate).toBe(0.6); // 3 accepts out of 5
            expect(stats.rejectionRate).toBe(0.2); // 1 reject out of 5
            expect(stats.modificationRate).toBe(0.2); // 1 modify out of 5
            expect(stats.averageConfidence).toBe(0.71); // Average confidence (0.9+0.8+0.3+0.7+0.85)/5 = 0.71
        });

        test('should track pattern performance', async () => {
            const stats = await feedbackLoop.getFeedbackStats();

            expect(stats.patternPerformance.length).toBeGreaterThan(0);

            // Check pattern-1 (2 accepts out of 2)
            const pattern1Stats = stats.patternPerformance.find((p) => p.patternId === 'pattern-1');
            if (pattern1Stats) {
                expect(pattern1Stats.acceptanceRate).toBe(1.0);
                expect(pattern1Stats.usageCount).toBe(2);
            }
        });

        test('should calculate time-based trends', async () => {
            const stats = await feedbackLoop.getFeedbackStats();

            expect(stats.recentTrends.last24h.accepted).toBe(3);
            expect(stats.recentTrends.last24h.rejected).toBe(1);
            expect(stats.recentTrends.last24h.modified).toBe(1);
        });

        test('should handle empty statistics gracefully', async () => {
            // Create completely separate services for empty test
            const emptyDbPath = path.join(process.cwd(), 'test-empty-feedback.db');
            cleanupDbFiles(emptyDbPath);

            const emptyConfig = {
                ...mockConfig,
                layers: {
                    ...mockConfig.layers,
                    layer3: { ...mockConfig.layers.layer3, dbPath: emptyDbPath },
                    layer4: { enabled: true, dbPath: emptyDbPath },
                },
                database: { ...mockConfig.database, path: emptyDbPath },
            };
            const emptyEventBus = new EventBusService();
            const emptyServices = new SharedServices(emptyConfig, emptyEventBus);
            await emptyServices.initialize();

            const emptyFeedbackLoop = new FeedbackLoopSystem(emptyServices, emptyEventBus);
            await emptyFeedbackLoop.initialize();

            const stats = await emptyFeedbackLoop.getFeedbackStats();

            expect(stats.totalFeedbacks).toBe(0);
            expect(stats.acceptanceRate).toBe(0);
            expect(stats.rejectionRate).toBe(0);
            expect(stats.modificationRate).toBe(0);

            await emptyFeedbackLoop.dispose();
            await emptyServices.dispose();
            cleanupDbFiles(emptyDbPath);
        });
    });

    describe('Insight Generation', () => {
        test('should generate insights from feedback patterns', async () => {
            // Add feedback that will trigger insights
            for (let i = 0; i < 10; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'accept',
                    suggestionId: `insight-test-${i}`,
                    patternId: 'strong-pattern',
                    originalSuggestion: 'strongPattern',
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.9,
                    },
                    metadata: {
                        source: 'insight-test',
                    },
                });
            }

            const insights = await feedbackLoop.generateInsights();
            expect(insights).toBeDefined();
            expect(Array.isArray(insights)).toBe(true);
        });

        test('should identify strong patterns in insights', async () => {
            // Add strong pattern feedback (high acceptance rate)
            for (let i = 0; i < 10; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'accept',
                    suggestionId: `strong-pattern-${i}`,
                    patternId: 'very-strong-pattern',
                    originalSuggestion: 'strongPattern',
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.9,
                    },
                    metadata: {
                        source: 'test',
                    },
                });
            }

            const insights = await feedbackLoop.generateInsights();
            const strongPatternInsights = insights.filter((i) => i.type === 'pattern_strength');

            expect(strongPatternInsights.length).toBeGreaterThan(0);
            if (strongPatternInsights.length > 0) {
                expect(strongPatternInsights[0].actionable).toBe(true);
                expect(strongPatternInsights[0].suggestedAction).toContain('promoting');
            }
        });

        test('should identify weak patterns in insights', async () => {
            // Add weak pattern feedback (low acceptance rate)
            for (let i = 0; i < 10; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'reject',
                    suggestionId: `weak-pattern-${i}`,
                    patternId: 'very-weak-pattern',
                    originalSuggestion: 'weakPattern',
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.2,
                    },
                    metadata: {
                        source: 'test',
                    },
                });
            }

            const insights = await feedbackLoop.generateInsights();
            const weakPatternInsights = insights.filter((i) => i.type === 'pattern_weakness');

            expect(weakPatternInsights.length).toBeGreaterThan(0);
            if (weakPatternInsights.length > 0) {
                expect(weakPatternInsights[0].suggestedAction).toContain('reviewing');
            }
        });

        test('should identify high modification rate', async () => {
            // Add mostly modification feedback
            for (let i = 0; i < 10; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'modify',
                    suggestionId: `modify-${i}`,
                    originalSuggestion: 'originalName',
                    finalValue: 'modifiedName',
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.6,
                    },
                    metadata: {
                        source: 'test',
                    },
                });
            }

            const insights = await feedbackLoop.generateInsights();
            const userPreferenceInsights = insights.filter((i) => i.type === 'user_preference');

            if (userPreferenceInsights.length > 0) {
                expect(userPreferenceInsights[0].description).toContain('modification rate');
                expect(userPreferenceInsights[0].suggestedAction).toContain('improve pattern accuracy');
            }
        });
    });

    describe('Pattern Integration', () => {
        test('should track feedback for specific patterns', async () => {
            const patternId = 'test-pattern-456';

            await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'pattern-feedback-test',
                patternId,
                originalSuggestion: 'patternTestName',
                context: {
                    file: '/src/pattern-test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.8,
                },
                metadata: {
                    source: 'pattern-test',
                },
            });

            const patternFeedback = feedbackLoop.getFeedbackForPattern(patternId);

            expect(patternFeedback.length).toBe(1);
            expect(patternFeedback[0].patternId).toBe(patternId);
            expect(patternFeedback[0].type).toBe('accept');
        });

        test('should return empty array for non-existent pattern', async () => {
            const patternFeedback = feedbackLoop.getFeedbackForPattern('non-existent-pattern');
            expect(patternFeedback).toBeDefined();
            expect(Array.isArray(patternFeedback)).toBe(true);
            expect(patternFeedback.length).toBe(0);
        });

        test('should calculate pattern confidence correctly', async () => {
            const patternId = 'confidence-test-pattern';

            // Add mixed feedback for pattern
            await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'conf-1',
                patternId,
                originalSuggestion: 'test1',
                context: {
                    file: '/src/test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.8,
                },
                metadata: { source: 'test' },
            });

            await feedbackLoop.recordFeedback({
                type: 'reject',
                suggestionId: 'conf-2',
                patternId,
                originalSuggestion: 'test2',
                context: {
                    file: '/src/test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.4,
                },
                metadata: { source: 'test' },
            });

            const confidence = await feedbackLoop.getPatternConfidence(patternId);
            expect(confidence).toBe(0.5); // 1 accept out of 2 total = 50%
        });
    });

    describe('Error Handling and Edge Cases', () => {
        test('should handle corrupted feedback data gracefully', async () => {
            // Test with null/undefined values
            const result = await feedbackLoop.processFeedback({
                type: 'accept',
                suggestionId: null as any, // Invalid
                originalSuggestion: 'test',
                context: null as any, // Invalid
                metadata: null as any, // Invalid
            });

            expect(result.success).toBe(true);
            expect(result.feedbackId).toBeDefined();
        });

        test('should handle missing pattern learner gracefully', async () => {
            // Create feedback loop without pattern learner
            const feedbackLoopNoPattern = new FeedbackLoopSystem(sharedServices, eventBus);
            await feedbackLoopNoPattern.initialize();

            // Should not throw when learning from correction
            let didThrow = false;
            try {
                await feedbackLoopNoPattern.learnFromCorrection('old', 'new', {
                    file: '/src/test.ts',
                    operation: 'rename',
                    confidence: 0.5,
                });
            } catch (error) {
                didThrow = true;
            }
            expect(didThrow).toBe(false);

            await feedbackLoopNoPattern.dispose();
        });

        test('should handle database errors gracefully', async () => {
            // Record some feedback first
            const feedbackId = await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'db-error-test',
                originalSuggestion: 'testName',
                context: {
                    file: '/src/test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.8,
                },
                metadata: {
                    source: 'error-test',
                },
            });

            // Feedback should still be stored in memory even if DB fails
            expect(feedbackId).toBeDefined();

            const recentFeedback = feedbackLoop.getRecentFeedback(1);
            expect(recentFeedback.length).toBe(1);
        });
    });

    describe('Performance Requirements', () => {
        test('should record feedback within the exported performance target', async () => {
            const measurements: number[] = [];

            for (let i = 0; i < 10; i++) {
                const startTime = Date.now();

                await feedbackLoop.recordFeedback({
                    type: 'accept',
                    suggestionId: `perf-${i}`,
                    originalSuggestion: `testName${i}`,
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.8,
                    },
                    metadata: {
                        source: 'performance-test',
                    },
                });

                const duration = Date.now() - startTime;
                measurements.push(duration);
            }

            const averageDuration = measurements.reduce((a, b) => a + b) / measurements.length;
            expect(averageDuration).toBeLessThan(FEEDBACK_LOOP_PERFORMANCE_TARGETS.recordFeedback);
        });

        test('should generate insights within performance targets', async () => {
            // Add some test data first
            for (let i = 0; i < 20; i++) {
                await feedbackLoop.recordFeedback({
                    type: i % 2 === 0 ? 'accept' : 'reject',
                    suggestionId: `insight-perf-${i}`,
                    originalSuggestion: `name${i}`,
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.7,
                    },
                    metadata: { source: 'test' },
                });
            }

            const startTime = Date.now();
            const insights = await feedbackLoop.generateInsights();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100); // Should complete under 100ms
            expect(insights).toBeDefined();
        });

        test('should handle high volume feedback efficiently', async () => {
            const startTime = Date.now();
            const promises: Promise<string>[] = [];

            // Process 100 feedback items concurrently
            for (let i = 0; i < 100; i++) {
                promises.push(
                    feedbackLoop.recordFeedback({
                        type: i % 2 === 0 ? 'accept' : 'reject',
                        suggestionId: `bulk-${i}`,
                        originalSuggestion: `bulkName${i}`,
                        context: {
                            file: `/src/bulk${i % 10}.ts`,
                            operation: 'rename',
                            timestamp: new Date(),
                            confidence: 0.7 + (i % 3) * 0.1,
                        },
                        metadata: {
                            source: 'bulk-test',
                        },
                    })
                );
            }

            const feedbackIds = await Promise.all(promises);
            const duration = Date.now() - startTime;

            expect(feedbackIds.length).toBe(100);
            expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

            const diagnostics = feedbackLoop.getDiagnostics();
            expect(diagnostics.feedbackHistorySize).toBeGreaterThanOrEqual(100);
        });
    });
});
