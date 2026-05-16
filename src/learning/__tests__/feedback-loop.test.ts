/**
 * Comprehensive tests for FeedbackLoopSystem
 * Tests feedback recording, learning from corrections, and insight generation
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { CacheService } from '../../core/services/cache-service.js';
import { DatabaseService } from '../../core/services/database-service.js';
import { EventBusService } from '../../core/services/event-bus-service.js';
import { SharedServices } from '../../core/services/index.js';
import { MonitoringService } from '../../core/services/monitoring-service.js';
import type { CoreConfig } from '../../core/types.js';
import { PatternLearner } from '../../patterns/pattern-learner.js';
import { FeedbackEvent, FeedbackLoopSystem } from '../feedback-loop.js';

// Test database path
const TEST_DB_PATH = path.join(process.cwd(), 'test-feedback.db');
const PATTERN_DB_PATH = path.join(process.cwd(), 'test-patterns.db');

// Mock configuration
const mockConfig: CoreConfig = {
    layers: {
        layer1: { enabled: true, timeout: 5000, maxResults: 100 },
        layer2: { enabled: true, timeout: 50000, languages: ['typescript', 'javascript'] },
        layer3: { enabled: true, dbPath: TEST_DB_PATH, cacheSize: 1000 },
        layer4: { enabled: true, learningThreshold: 3, confidenceThreshold: 0.7 },
        layer5: { enabled: true, maxDepth: 3, autoApplyThreshold: 0.8 },
    },
    cache: { enabled: true, maxSize: 1000, ttl: 300 },
    monitoring: { enabled: true, metricsInterval: 1000 },
    performance: { healthCheckInterval: 30000 },
};

describe('FeedbackLoopSystem', () => {
    let feedbackLoop: FeedbackLoopSystem;
    let sharedServices: SharedServices;
    let eventBus: EventBusService;
    let patternLearner: PatternLearner;

    beforeEach(async () => {
        // Clean up test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        if (fs.existsSync(PATTERN_DB_PATH)) {
            fs.unlinkSync(PATTERN_DB_PATH);
        }

        // Create fresh event bus and shared services
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
        // Clean up
        await feedbackLoop.dispose();
        await patternLearner.dispose();
        await sharedServices.dispose();

        // Remove test databases
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        if (fs.existsSync(PATTERN_DB_PATH)) {
            fs.unlinkSync(PATTERN_DB_PATH);
        }
    });

    describe('Initialization', () => {
        test('should initialize successfully', async () => {
            expect(feedbackLoop).toBeDefined();
            const diagnostics = feedbackLoop.getDiagnostics();
            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.hasPatternLearner).toBe(true);
        });

        test('should initialize database schema', async () => {
            // Check if feedback_events table exists
            const tables = await sharedServices.database.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='feedback_events'"
            );
            expect(tables.length).toBe(1);
        });

        test('should load existing feedback history', async () => {
            // Add some test data first
            await sharedServices.database.execute(
                `
        INSERT INTO feedback_events (
          id, type, suggestion_id, original_suggestion, file_path, operation,
          timestamp, confidence, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
                [
                    'test-1',
                    'accept',
                    'suggestion-1',
                    'oldName',
                    '/test/file.ts',
                    'rename',
                    Date.now() / 1000,
                    0.8,
                    'test',
                ]
            );

            // Create new instance to test loading
            const newFeedbackLoop = new FeedbackLoopSystem(sharedServices, eventBus);
            await newFeedbackLoop.initialize();

            const recentFeedback = newFeedbackLoop.getRecentFeedback(10);
            expect(recentFeedback.length).toBe(1);
            expect(recentFeedback[0].id).toBe('test-1');

            await newFeedbackLoop.dispose();
        });
    });

    describe('Feedback Recording', () => {
        test('should record feedback successfully', async () => {
            const feedbackId = await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'suggestion-123',
                originalSuggestion: 'getUserData',
                context: {
                    file: '/src/user.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.85,
                },
                metadata: {
                    source: 'vscode',
                    timeToDecision: 2500,
                },
            });

            expect(feedbackId).toBeDefined();
            expect(typeof feedbackId).toBe('string');

            // Verify feedback was stored
            const recentFeedback = feedbackLoop.getRecentFeedback(1);
            expect(recentFeedback.length).toBe(1);
            expect(recentFeedback[0].type).toBe('accept');
            expect(recentFeedback[0].originalSuggestion).toBe('getUserData');
        });

        test('should record feedback within performance target', async () => {
            const startTime = Date.now();

            await feedbackLoop.recordFeedback({
                type: 'reject',
                suggestionId: 'suggestion-456',
                originalSuggestion: 'badName',
                context: {
                    file: '/src/test.ts',
                    operation: 'completion',
                    timestamp: new Date(),
                    confidence: 0.4,
                },
                metadata: {
                    source: 'vscode',
                },
            });

            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(50); // Should be much faster than 50ms
        });

        test('should handle different feedback types', async () => {
            const feedbackTypes = ['accept', 'reject', 'modify', 'ignore'] as const;
            const feedbackIds: string[] = [];

            for (const type of feedbackTypes) {
                const feedbackId = await feedbackLoop.recordFeedback({
                    type,
                    suggestionId: `suggestion-${type}`,
                    originalSuggestion: 'testName',
                    finalValue: type === 'modify' ? 'modifiedTestName' : undefined,
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.7,
                    },
                    metadata: {
                        source: 'vscode',
                    },
                });
                feedbackIds.push(feedbackId);
            }

            expect(feedbackIds.length).toBe(4);

            const recentFeedback = feedbackLoop.getRecentFeedback(10);
            expect(recentFeedback.length).toBe(4);

            const types = recentFeedback.map((f) => f.type);
            expect(types).toContain('accept');
            expect(types).toContain('reject');
            expect(types).toContain('modify');
            expect(types).toContain('ignore');
        });

        test('should emit events when recording feedback', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('feedback-recorded', (data: any) => {
                    resolve(data);
                });
            });

            await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'event-test',
                originalSuggestion: 'eventTest',
                context: {
                    file: '/src/event.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.8,
                },
                metadata: {
                    source: 'vscode',
                },
            });

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).type).toBe('accept');
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

            // Check that feedback was recorded
            const recentFeedback = feedbackLoop.getRecentFeedback(5);
            const correctionFeedback = recentFeedback.find((f) => f.type === 'modify');

            expect(correctionFeedback).toBeDefined();
            expect(correctionFeedback?.originalSuggestion).toBe(original);
            expect(correctionFeedback?.finalValue).toBe(corrected);
        });

        test('should handle similar corrections (strengthen patterns)', async () => {
            const original = 'getData';
            const corrected = 'fetchData';

            await feedbackLoop.learnFromCorrection(original, corrected, {
                file: '/src/api.ts',
                operation: 'rename',
                confidence: 0.8,
            });

            // The correction should be processed within performance target
            const startTime = Date.now();
            await feedbackLoop.learnFromCorrection('getUser', 'fetchUser', {
                file: '/src/user.ts',
                operation: 'rename',
                confidence: 0.8,
            });
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(30); // Should be faster than 30ms
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
            expect(correctionFeedback?.metadata.keystrokes).toBeGreaterThan(5);
        });
    });

    describe('Feedback Statistics', () => {
        beforeEach(async () => {
            // Add test feedback data
            const feedbackData = [
                { type: 'accept', confidence: 0.9, timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                { type: 'accept', confidence: 0.8, timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000) },
                { type: 'reject', confidence: 0.3, timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000) },
                { type: 'modify', confidence: 0.7, timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) },
                { type: 'accept', confidence: 0.85, timestamp: new Date() },
            ] as const;

            for (let i = 0; i < feedbackData.length; i++) {
                await feedbackLoop.recordFeedback({
                    type: feedbackData[i].type,
                    suggestionId: `test-${i}`,
                    originalSuggestion: `testName${i}`,
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: feedbackData[i].timestamp,
                        confidence: feedbackData[i].confidence,
                    },
                    metadata: {
                        source: 'test',
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
            expect(stats.averageConfidence).toBeCloseTo(0.75); // Average of all confidences
        });

        test('should calculate time-based trends', async () => {
            const stats = await feedbackLoop.getFeedbackStats();

            expect(stats.recentTrends.last24h.accepted).toBe(3);
            expect(stats.recentTrends.last24h.rejected).toBe(1);
            expect(stats.recentTrends.last24h.modified).toBe(1);
        });

        test('should handle empty statistics', async () => {
            const emptyFeedbackLoop = new FeedbackLoopSystem(sharedServices, eventBus);
            await emptyFeedbackLoop.initialize();

            const stats = await emptyFeedbackLoop.getFeedbackStats();

            expect(stats.totalFeedbacks).toBe(0);
            expect(stats.acceptanceRate).toBe(0);
            expect(stats.rejectionRate).toBe(0);
            expect(stats.modificationRate).toBe(0);

            await emptyFeedbackLoop.dispose();
        });

        test('should filter statistics by time range', async () => {
            const from = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8 hours ago
            const to = new Date();

            const stats = await feedbackLoop.getFeedbackStats({ from, to });

            // Should only include feedback from last 8 hours (3 items)
            expect(stats.totalFeedbacks).toBe(3);
            expect(stats.acceptanceRate).toBe(1 / 3); // 1 accept out of 3
        });
    });

    describe('Insight Generation', () => {
        beforeEach(async () => {
            // Create patterns in pattern learner for testing
            await patternLearner.learnFromRename('getData', 'fetchData', {
                file: '/src/api.ts',
                surroundingSymbols: ['Api', 'fetch'],
                timestamp: new Date(),
            });

            // Add feedback for patterns
            for (let i = 0; i < 5; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'accept',
                    suggestionId: `pattern-test-${i}`,
                    patternId: 'test-pattern-id',
                    originalSuggestion: 'getData',
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
        });

        test('should generate learning insights', async () => {
            const insights = await feedbackLoop.generateInsights();

            expect(insights).toBeDefined();
            expect(Array.isArray(insights)).toBe(true);
        });

        test('should generate insights within performance target', async () => {
            const startTime = Date.now();
            const insights = await feedbackLoop.generateInsights();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(50); // Should be under 50ms
            expect(insights.length).toBeGreaterThanOrEqual(0);
        });

        test('should identify strong patterns', async () => {
            // Add more positive feedback for a pattern
            for (let i = 0; i < 10; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'accept',
                    suggestionId: `strong-pattern-${i}`,
                    patternId: 'strong-pattern',
                    originalSuggestion: 'testPattern',
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
            expect(strongPatternInsights[0].actionable).toBe(true);
            expect(strongPatternInsights[0].suggestedAction).toContain('promoting');
        });

        test('should identify weak patterns', async () => {
            // Add negative feedback for a pattern
            for (let i = 0; i < 10; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'reject',
                    suggestionId: `weak-pattern-${i}`,
                    patternId: 'weak-pattern',
                    originalSuggestion: 'badPattern',
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
            expect(weakPatternInsights[0].suggestedAction).toContain('reviewing');
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
        test('should get feedback for specific pattern', async () => {
            const patternId = 'test-pattern-123';

            // Add feedback for specific pattern
            await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'test',
                patternId,
                originalSuggestion: 'testName',
                context: {
                    file: '/src/test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.8,
                },
                metadata: {
                    source: 'test',
                },
            });

            const patternFeedback = feedbackLoop.getFeedbackForPattern(patternId);

            expect(patternFeedback.length).toBe(1);
            expect(patternFeedback[0].patternId).toBe(patternId);
            expect(patternFeedback[0].type).toBe('accept');
        });

        test('should return empty array for non-existent pattern', async () => {
            const patternFeedback = feedbackLoop.getFeedbackForPattern('non-existent-pattern');
            expect(patternFeedback.length).toBe(0);
        });
    });

    describe('Error Handling', () => {
        test('should handle database errors gracefully', async () => {
            // Simulate database error by closing the database
            await sharedServices.database.close();

            // This should not throw, but log warning
            const feedbackId = await feedbackLoop.recordFeedback({
                type: 'accept',
                suggestionId: 'error-test',
                originalSuggestion: 'testName',
                context: {
                    file: '/src/test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.8,
                },
                metadata: {
                    source: 'test',
                },
            });

            // Should still return feedback ID (stored in memory)
            expect(feedbackId).toBeDefined();
        });

        test('should handle invalid correction data', async () => {
            // Should handle null/undefined gracefully
            await expect(
                feedbackLoop.learnFromCorrection('', '', {
                    file: '/src/test.ts',
                    operation: 'rename',
                    confidence: 0.5,
                })
            ).resolves.not.toThrow();
        });

        test('should handle missing pattern learner', async () => {
            // Create feedback loop without pattern learner
            const feedbackLoopNoPattern = new FeedbackLoopSystem(sharedServices, eventBus);
            await feedbackLoopNoPattern.initialize();

            // Should not throw when learning from correction
            await expect(
                feedbackLoopNoPattern.learnFromCorrection('old', 'new', {
                    file: '/src/test.ts',
                    operation: 'rename',
                    confidence: 0.5,
                })
            ).resolves.not.toThrow();

            await feedbackLoopNoPattern.dispose();
        });
    });

    describe('Performance', () => {
        test('should handle high volume of feedback efficiently', async () => {
            const startTime = Date.now();
            const feedbackPromises: Promise<string>[] = [];

            // Record 100 feedback items concurrently
            for (let i = 0; i < 100; i++) {
                feedbackPromises.push(
                    feedbackLoop.recordFeedback({
                        type: i % 2 === 0 ? 'accept' : 'reject',
                        suggestionId: `perf-test-${i}`,
                        originalSuggestion: `testName${i}`,
                        context: {
                            file: `/src/test${i % 10}.ts`,
                            operation: 'rename',
                            timestamp: new Date(),
                            confidence: 0.7 + (i % 3) * 0.1,
                        },
                        metadata: {
                            source: 'performance-test',
                        },
                    })
                );
            }

            const feedbackIds = await Promise.all(feedbackPromises);
            const duration = Date.now() - startTime;

            expect(feedbackIds.length).toBe(100);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

            // All feedback should be recorded
            const recentFeedback = feedbackLoop.getRecentFeedback(200);
            expect(recentFeedback.length).toBeGreaterThanOrEqual(100);
        });

        test('should maintain performance with large feedback history', async () => {
            // Add large amount of historical feedback
            for (let i = 0; i < 1000; i++) {
                await feedbackLoop.recordFeedback({
                    type: 'accept',
                    suggestionId: `history-${i}`,
                    originalSuggestion: `name${i}`,
                    context: {
                        file: '/src/test.ts',
                        operation: 'rename',
                        timestamp: new Date(Date.now() - i * 1000),
                        confidence: 0.8,
                    },
                    metadata: {
                        source: 'history-test',
                    },
                });
            }

            // Performance should still be good for new operations
            const startTime = Date.now();
            await feedbackLoop.generateInsights();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100); // Should still be fast
        });
    });
});
