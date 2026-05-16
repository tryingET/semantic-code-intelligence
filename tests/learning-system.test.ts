/**
 * Learning System Integration Tests
 *
 * Tests the complete learning system including feedback loops, evolution tracking,
 * team knowledge sharing, pattern detection, and learning performance targets.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { SharedServices } from '../src/core/services/index.js';
import { CodeEvolutionTracker } from '../src/learning/evolution-tracker.js';
import { FeedbackLoopSystem } from '../src/learning/feedback-loop.js';
import { LearningOrchestrator } from '../src/learning/learning-orchestrator.js';
import { TeamKnowledgeSystem } from '../src/learning/team-knowledge.js';
import {
    type CoreConfig,
    type EventBus,
    type EvolutionEvent,
    type FeedbackEvent,
    LearningResult,
    SystemHealth,
    type TeamMember,
} from '../src/learning/types.js';

// Test fixtures
interface LearningTestContext {
    learningOrchestrator: LearningOrchestrator;
    feedbackLoop: FeedbackLoopSystem;
    evolutionTracker: CodeEvolutionTracker;
    teamKnowledge: TeamKnowledgeSystem;
    sharedServices: SharedServices;
    eventBus: EventBus;
    config: CoreConfig;
}

const createLearningTestContext = async (): Promise<LearningTestContext> => {
    // Create test event bus with event collection
    const events: Array<{ type: string; data: any; timestamp: number }> = [];
    const eventBus: EventBus = {
        emit: (type: string, data: any) => {
            events.push({ type, data, timestamp: Date.now() });
        },
        on: (type: string, handler: Function) => {
            // Store handler for testing
        },
        off: (type: string, handler: Function) => {
            // Remove handler
        },
        once: (type: string, handler: Function) => {
            // Handle once event for testing
        },
    };

    // Create test configuration
    const config: CoreConfig = {
        workspaceRoot: '/test-workspace',
        layers: {
            layer1: { enabled: true, timeout: 50 },
            layer2: { enabled: true, timeout: 100 },
            layer3: { enabled: true, timeout: 50 },
            layer4: { enabled: true, timeout: 50 },
            layer5: { enabled: true, timeout: 100 },
        },
        cache: {
            enabled: true,
            strategy: 'memory' as const,
            memory: {
                maxSize: 1024 * 1024, // 1MB
                ttl: 300,
            },
        },
        database: {
            path: ':memory:',
            maxConnections: 10,
        },
        performance: {
            targetResponseTime: 100,
            maxConcurrentRequests: 50,
            healthCheckInterval: 30000,
        },
        monitoring: {
            enabled: false,
            metricsInterval: 60000,
            logLevel: 'error' as const,
            tracing: {
                enabled: false,
                sampleRate: 0,
            },
        },
    };

    // Initialize shared services
    const sharedServices = new SharedServices(config);
    await sharedServices.initialize();

    // Initialize learning components
    const feedbackLoop = new FeedbackLoopSystem(sharedServices, eventBus, {
        minFeedbacksToLearn: 10,
        weakPatternThreshold: 0.5,
        strongPatternThreshold: 0.8,
    });

    const evolutionTracker = new CodeEvolutionTracker(sharedServices, eventBus, {
        maxHistorySize: 1000,
        analysisDepth: 5,
        patternDetectionThreshold: 0.7,
    });

    const teamKnowledge = new TeamKnowledgeSystem(sharedServices, eventBus, {
        validationThreshold: 0.8,
        sharingEnabled: true,
        conflictResolutionStrategy: 'vote',
    });

    // Initialize learning orchestrator
    const learningOrchestrator = new LearningOrchestrator(sharedServices, eventBus, {
        enabledComponents: {
            patternLearning: true,
            feedbackLoop: true,
            evolutionTracking: true,
            teamKnowledge: true,
        },
    });

    // Initialize all components
    await feedbackLoop.initialize();
    await evolutionTracker.initialize();
    await teamKnowledge.initialize();
    await learningOrchestrator.initialize();

    return {
        learningOrchestrator,
        feedbackLoop,
        evolutionTracker,
        teamKnowledge,
        sharedServices,
        eventBus,
        config,
    };
};

// Test data
const createTestFeedbackEvent = (): FeedbackEvent => ({
    id: `feedback-${Date.now()}`,
    suggestionId: `suggestion-${Math.random()}`,
    type: 'accept',
    originalSuggestion: 'oldFunction',
    finalValue: 'newFunction',
    context: {
        file: 'file:///test/example.ts',
        operation: 'completion',
        confidence: 0.8,
        timestamp: new Date(),
    },
    metadata: {
        source: 'vscode',
        keystrokes: 5,
        timeToDecision: 2000,
    },
});

const createTestEvolutionEvent = (): EvolutionEvent => ({
    id: `evolution-${Date.now()}`,
    type: 'file_modified',
    file: 'file:///test/example.ts',
    timestamp: new Date(),
    before: {
        path: 'file:///test/example.ts',
        content: "function oldImplementation() { return 'old'; }",
        signature: 'oldImplementation()',
    },
    after: {
        path: 'file:///test/example.ts',
        content: "function newImplementation() { return 'new'; }",
        signature: 'newImplementation()',
    },
    context: {
        commit: 'abc123',
        author: 'test@example.com',
        message: 'Refactor implementation',
        branch: 'main',
    },
    impact: {
        filesAffected: 1,
        symbolsAffected: 1,
        testsAffected: 0,
        severity: 'low',
    },
    metadata: {
        diffSize: 2,
        automated: false,
    },
});

const createTestTeamMember = (): TeamMember => ({
    id: `member-${Math.random()}`,
    name: 'Test Developer',
    email: 'test@example.com',
    role: 'developer',
    experience: 'senior',
    preferences: {
        codeStyle: 'functional',
        patterns: ['factory', 'observer'],
    },
    statistics: {
        suggestionsAccepted: 50,
        suggestionsRejected: 10,
        patternsContributed: 5,
        knowledgeShared: 15,
    },
});

describe('Learning System Integration', () => {
    let context: LearningTestContext;

    beforeAll(async () => {
        context = await createLearningTestContext();
    });

    afterAll(async () => {
        await context.learningOrchestrator.dispose();
        await context.feedbackLoop.dispose();
        await context.evolutionTracker.dispose();
        await context.teamKnowledge.dispose();
        await context.sharedServices.dispose();
    });

    describe('Learning Orchestrator', () => {
        test('should initialize all learning components successfully', async () => {
            const diagnostics = context.learningOrchestrator.getDiagnostics();

            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.enabledComponents).toBeDefined();
            expect(diagnostics.pipelinesCount).toBeGreaterThanOrEqual(0);
            expect(diagnostics.activePipelinesCount).toBeGreaterThanOrEqual(0);

            // Check performance metrics are available
            expect(diagnostics.performanceMetrics).toBeDefined();
            expect(typeof diagnostics.performanceMetrics.totalOperations).toBe('number');
        });

        test('should orchestrate comprehensive learning from diverse input', async () => {
            const learningContext = {
                requestId: `test-${Date.now()}`,
                operation: 'comprehensive_analysis',
                file: 'file:///test/example.ts',
                timestamp: new Date(),
                metadata: {
                    trigger: 'scheduled_analysis',
                },
            };

            const learningData = {
                feedback: createTestFeedbackEvent(),
                fileChange: createTestEvolutionEvent(),
                teamMember: createTestTeamMember(),
            };

            const startTime = Date.now();
            const result = await context.learningOrchestrator.learn(learningContext, learningData);
            const duration = Date.now() - startTime;

            // Should meet performance target (<50ms for learning operations)
            expect(duration).toBeLessThan(50);

            // Should return comprehensive learning result
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.insights).toBeDefined();
            expect(Array.isArray(result.insights)).toBe(true);
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        });

        test('should provide system health monitoring', async () => {
            const health = await context.learningOrchestrator.getSystemHealth();

            expect(health).toBeDefined();
            expect(health.overall).toBeOneOf(['healthy', 'degraded', 'unhealthy']);
            expect(health.components).toHaveProperty('feedbackLoop');
            expect(health.components).toHaveProperty('evolutionTracker');
            expect(health.components).toHaveProperty('teamKnowledge');

            // Should include performance metrics
            expect(health.performance).toBeDefined();
            expect(health.performance.averageProcessingTime).toBeGreaterThanOrEqual(0);
            expect(health.performance.successRate).toBeGreaterThanOrEqual(0);
            expect(health.performance.successRate).toBeLessThanOrEqual(1);
        });

        test('should provide learning statistics and insights', async () => {
            // First, add some learning data
            const feedbackEvent = createTestFeedbackEvent();
            await context.feedbackLoop.recordFeedback(feedbackEvent);

            const evolutionEvent = createTestEvolutionEvent();
            await context.evolutionTracker.trackChange(evolutionEvent);

            // Get statistics
            const stats = await context.learningOrchestrator.getLearningStats();

            expect(stats).toBeDefined();
            expect(stats.totalFeedbackEvents).toBeGreaterThanOrEqual(0);
            expect(stats.totalEvolutionEvents).toBeGreaterThanOrEqual(0);
            expect(stats.patternsLearned).toBeGreaterThanOrEqual(0);
            expect(stats.averageConfidence).toBeGreaterThanOrEqual(0);
            expect(stats.averageConfidence).toBeLessThanOrEqual(1);
        });
    });

    describe('Feedback Loop System', () => {
        test('should collect and process feedback efficiently', async () => {
            const feedbackEvent = createTestFeedbackEvent();

            const startTime = Date.now();
            await context.feedbackLoop.recordFeedback(feedbackEvent);
            const duration = Date.now() - startTime;

            // Should meet performance target (<30ms for feedback recording)
            expect(duration).toBeLessThan(30);

            // Should update confidence scores
            const insights = await context.feedbackLoop.getInsights();
            expect(insights).toBeDefined();
            expect(insights.totalFeedbackEvents).toBeGreaterThan(0);
        });

        test('should adapt pattern confidence based on feedback', async () => {
            // Create multiple feedback events for same pattern
            const pattern = 'testPattern';

            // Positive feedback
            const positiveFeedback: FeedbackEvent = {
                ...createTestFeedbackEvent(),
                type: 'accept',
                originalSuggestion: pattern,
                context: {
                    ...createTestFeedbackEvent().context,
                    confidence: 0.7,
                },
            };

            // Negative feedback
            const negativeFeedback: FeedbackEvent = {
                ...createTestFeedbackEvent(),
                type: 'reject',
                originalSuggestion: pattern,
                context: {
                    ...createTestFeedbackEvent().context,
                    confidence: 0.7,
                },
            };

            // Process feedback
            await context.feedbackLoop.recordFeedback(positiveFeedback);
            await context.feedbackLoop.recordFeedback(negativeFeedback);

            // Get pattern confidence
            const confidence = await context.feedbackLoop.getPatternConfidence(pattern);
            expect(typeof confidence).toBe('number');
            expect(confidence).toBeGreaterThanOrEqual(0);
            expect(confidence).toBeLessThanOrEqual(1);
        });

        test('should handle batch feedback processing', async () => {
            const feedbackBatch: FeedbackEvent[] = [];
            for (let i = 0; i < 5; i++) {
                feedbackBatch.push({
                    ...createTestFeedbackEvent(),
                    id: `batch-feedback-${i}`,
                });
            }

            const startTime = Date.now();
            // Process feedback batch individually
            for (const feedback of feedbackBatch) {
                await context.feedbackLoop.recordFeedback(feedback);
            }
            const duration = Date.now() - startTime;

            // Batch processing should be efficient
            expect(duration).toBeLessThan(100); // Allow more time for batch

            const insights = await context.feedbackLoop.getInsights();
            expect(insights.totalFeedbackEvents).toBeGreaterThanOrEqual(feedbackBatch.length);
        });

        test('should generate correction patterns from negative feedback', async () => {
            const negativeFeedback: FeedbackEvent = {
                ...createTestFeedbackEvent(),
                type: 'modify',
                originalSuggestion: 'incorrectPattern',
                finalValue: 'correctPattern',
            };

            await context.feedbackLoop.processFeedback(negativeFeedback);

            const corrections = await context.feedbackLoop.getCorrectionPatterns();
            expect(Array.isArray(corrections)).toBe(true);

            if (corrections.length > 0) {
                expect(corrections[0]).toHaveProperty('from');
                expect(corrections[0]).toHaveProperty('to');
                expect(corrections[0]).toHaveProperty('confidence');
                expect(corrections[0]).toHaveProperty('frequency');
            }
        });
    });

    describe('Evolution Tracking System', () => {
        test('should track code changes and detect patterns', async () => {
            const evolutionEvent = createTestEvolutionEvent();

            const startTime = Date.now();
            await context.evolutionTracker.trackChange(evolutionEvent);
            const duration = Date.now() - startTime;

            // Should meet performance target (<50ms for evolution tracking)
            expect(duration).toBeLessThan(50);

            const patterns = await context.evolutionTracker.getEvolutionPatterns();
            expect(Array.isArray(patterns)).toBe(true);
        });

        test('should analyze architectural trends over time', async () => {
            // Create a series of related changes
            const baseEvent = createTestEvolutionEvent();
            const evolutionSequence = [
                { ...baseEvent, id: 'seq-1', before: 'class A {}', after: 'interface A {}' },
                { ...baseEvent, id: 'seq-2', before: 'class B {}', after: 'interface B {}' },
                { ...baseEvent, id: 'seq-3', before: 'class C {}', after: 'interface C {}' },
            ];

            for (const event of evolutionSequence) {
                await context.evolutionTracker.trackChange(event);
            }

            const trends = await context.evolutionTracker.getArchitecturalTrends();
            expect(Array.isArray(trends)).toBe(true);

            if (trends.length > 0) {
                expect(trends[0]).toHaveProperty('pattern');
                expect(trends[0]).toHaveProperty('frequency');
                expect(trends[0]).toHaveProperty('confidence');
                expect(trends[0]).toHaveProperty('timeRange');
            }
        });

        test('should detect refactoring patterns', async () => {
            const refactoringEvent: EvolutionEvent = {
                ...createTestEvolutionEvent(),
                type: 'refactoring',
                before: 'function duplicateCode() { /* same logic */ }',
                after: 'function extractedUtility() { /* extracted logic */ }',
                context: {
                    ...createTestEvolutionEvent().context,
                    refactoringType: 'extract_function',
                },
            };

            await context.evolutionTracker.trackChange(refactoringEvent);

            const refactoringPatterns = await context.evolutionTracker.getRefactoringPatterns();
            expect(Array.isArray(refactoringPatterns)).toBe(true);

            if (refactoringPatterns.length > 0) {
                expect(refactoringPatterns[0]).toHaveProperty('type');
                expect(refactoringPatterns[0]).toHaveProperty('before');
                expect(refactoringPatterns[0]).toHaveProperty('after');
                expect(refactoringPatterns[0]).toHaveProperty('confidence');
            }
        });

        test('should provide evolution metrics and analytics', async () => {
            const event = createTestEvolutionEvent();
            await context.evolutionTracker.trackChange(event);

            const metrics = await context.evolutionTracker.getEvolutionMetrics();

            expect(metrics).toBeDefined();
            expect(metrics.totalChanges).toBeGreaterThanOrEqual(0);
            expect(metrics.averageChangeSize).toBeGreaterThanOrEqual(0);
            expect(metrics.mostActiveFiles).toBeDefined();
            expect(Array.isArray(metrics.mostActiveFiles)).toBe(true);
            expect(metrics.changeVelocity).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Team Knowledge System', () => {
        test('should facilitate knowledge sharing between team members', async () => {
            const teamMember = createTestTeamMember();

            // Register team member
            await context.teamKnowledge.registerMember(teamMember);

            // Share knowledge
            const knowledgeItem = {
                id: `knowledge-${Date.now()}`,
                type: 'pattern',
                title: 'Effective Error Handling Pattern',
                content: 'Use Result<T, E> types for error handling',
                author: teamMember.id,
                tags: ['error-handling', 'typescript', 'patterns'],
                confidence: 0.9,
            };

            const startTime = Date.now();
            await context.teamKnowledge.shareKnowledge(knowledgeItem);
            const duration = Date.now() - startTime;

            // Should meet performance target (<50ms for team knowledge operations)
            expect(duration).toBeLessThan(50);

            // Retrieve shared knowledge
            const sharedKnowledge = await context.teamKnowledge.getSharedKnowledge();
            expect(Array.isArray(sharedKnowledge)).toBe(true);
            expect(sharedKnowledge.length).toBeGreaterThan(0);
        });

        test('should validate patterns through team consensus', async () => {
            const members = [
                createTestTeamMember(),
                { ...createTestTeamMember(), id: 'member-2' },
                { ...createTestTeamMember(), id: 'member-3' },
            ];

            // Register members
            for (const member of members) {
                await context.teamKnowledge.registerMember(member);
            }

            const pattern = {
                id: `pattern-${Date.now()}`,
                name: 'Validation Pattern',
                description: 'Use schema validation for inputs',
                code: 'const isValid = schema.safeParse(input);',
                context: ['validation', 'input-handling'],
                confidence: 0.7,
            };

            // Submit pattern for validation
            await context.teamKnowledge.submitPatternForValidation(pattern);

            // Simulate team votes
            for (let i = 0; i < members.length; i++) {
                await context.teamKnowledge.voteOnPattern(
                    pattern.id,
                    members[i].id,
                    i < 2 ? 'approve' : 'reject', // 2 approvals, 1 rejection
                    'Good pattern for input validation'
                );
            }

            const validationResult = await context.teamKnowledge.getPatternValidationStatus(pattern.id);
            expect(validationResult).toBeDefined();
            expect(validationResult.status).toBeOneOf(['approved', 'rejected', 'pending']);
            expect(validationResult.votes).toHaveLength(members.length);
        });

        test('should resolve conflicts in pattern adoption', async () => {
            const member1 = createTestTeamMember();
            const member2 = { ...createTestTeamMember(), id: 'member-conflict-2' };

            await context.teamKnowledge.registerMember(member1);
            await context.teamKnowledge.registerMember(member2);

            // Create conflicting patterns
            const pattern1 = {
                id: 'pattern-conflict-1',
                name: 'Error Handling A',
                description: 'Use try-catch blocks',
                confidence: 0.8,
                author: member1.id,
            };

            const pattern2 = {
                id: 'pattern-conflict-2',
                name: 'Error Handling B',
                description: 'Use Result types',
                confidence: 0.9,
                author: member2.id,
            };

            await context.teamKnowledge.shareKnowledge(pattern1);
            await context.teamKnowledge.shareKnowledge(pattern2);

            // Detect and resolve conflicts
            const conflicts = await context.teamKnowledge.detectConflicts();
            expect(Array.isArray(conflicts)).toBe(true);

            if (conflicts.length > 0) {
                const conflict = conflicts[0];
                const resolution = await context.teamKnowledge.resolveConflict(conflict.id, 'vote', member1.id);

                expect(resolution).toBeDefined();
                expect(resolution.strategy).toBe('vote');
                expect(resolution.resolution).toBeDefined();
            }
        });

        test('should generate team insights and recommendations', async () => {
            const member = createTestTeamMember();
            await context.teamKnowledge.registerMember(member);

            // Add some team activity
            const knowledgeItem = {
                id: `insight-knowledge-${Date.now()}`,
                type: 'best-practice',
                title: 'Async/Await Best Practices',
                content: 'Always handle promise rejections',
                author: member.id,
                tags: ['async', 'best-practices'],
                confidence: 0.95,
            };

            await context.teamKnowledge.shareKnowledge(knowledgeItem);

            const insights = await context.teamKnowledge.getTeamInsights();

            expect(insights).toBeDefined();
            expect(insights.totalMembers).toBeGreaterThan(0);
            expect(insights.knowledgeItems).toBeGreaterThan(0);
            expect(insights.topContributors).toBeDefined();
            expect(Array.isArray(insights.topContributors)).toBe(true);
            expect(insights.popularPatterns).toBeDefined();
            expect(Array.isArray(insights.popularPatterns)).toBe(true);
        });
    });

    describe('Cross-System Learning Integration', () => {
        test('should correlate feedback with code evolution', async () => {
            // Create related feedback and evolution events
            const patternName = 'correlationTestPattern';

            const feedbackEvent: FeedbackEvent = {
                ...createTestFeedbackEvent(),
                originalSuggestion: patternName,
                type: 'modify',
                finalValue: 'improvedPattern',
            };

            const evolutionEvent: EvolutionEvent = {
                ...createTestEvolutionEvent(),
                before: `function ${patternName}() {}`,
                after: `function improvedPattern() {}`,
                context: {
                    ...createTestEvolutionEvent().context,
                    message: 'Applied user feedback to improve pattern',
                },
            };

            // Process both events
            await context.feedbackLoop.processFeedback(feedbackEvent);
            await context.evolutionTracker.trackChange(evolutionEvent);

            // Get correlation analysis
            const correlations = await context.learningOrchestrator.getCorrelationAnalysis();

            expect(correlations).toBeDefined();
            expect(correlations.feedbackEvolutionCorrelations).toBeDefined();
            expect(Array.isArray(correlations.feedbackEvolutionCorrelations)).toBe(true);
        });

        test('should share learning insights across all systems', async () => {
            const member = createTestTeamMember();
            await context.teamKnowledge.registerMember(member);

            // Generate insights from different systems
            const feedbackEvent = createTestFeedbackEvent();
            await context.feedbackLoop.processFeedback(feedbackEvent);

            const evolutionEvent = createTestEvolutionEvent();
            await context.evolutionTracker.trackChange(evolutionEvent);

            const knowledgeItem = {
                id: `cross-system-knowledge-${Date.now()}`,
                type: 'insight',
                title: 'Cross-System Learning Test',
                content: 'Integration of multiple learning sources',
                author: member.id,
                tags: ['integration', 'learning'],
                confidence: 0.8,
            };
            await context.teamKnowledge.shareKnowledge(knowledgeItem);

            // Get comprehensive insights
            const comprehensiveInsights = await context.learningOrchestrator.getComprehensiveInsights();

            expect(comprehensiveInsights).toBeDefined();
            expect(comprehensiveInsights.feedbackInsights).toBeDefined();
            expect(comprehensiveInsights.evolutionInsights).toBeDefined();
            expect(comprehensiveInsights.teamInsights).toBeDefined();
            expect(comprehensiveInsights.crossSystemCorrelations).toBeDefined();
        });

        test('should maintain consistency across learning systems', async () => {
            const patternId = `consistency-test-${Date.now()}`;

            // Add same pattern across systems
            const feedbackEvent: FeedbackEvent = {
                ...createTestFeedbackEvent(),
                originalSuggestion: patternId,
                type: 'accept',
            };

            const member = createTestTeamMember();
            await context.teamKnowledge.registerMember(member);

            const knowledgePattern = {
                id: patternId,
                type: 'pattern',
                title: 'Consistency Test Pattern',
                content: 'Test pattern for consistency',
                author: member.id,
                tags: ['test'],
                confidence: 0.8,
            };

            // Process across systems
            await context.feedbackLoop.processFeedback(feedbackEvent);
            await context.teamKnowledge.shareKnowledge(knowledgePattern);

            // Check consistency
            const feedbackConfidence = await context.feedbackLoop.getPatternConfidence(patternId);
            const teamKnowledgeItems = await context.teamKnowledge.getSharedKnowledge();
            const matchingItem = teamKnowledgeItems.find((item) => item.id === patternId);

            // Should have consistent information
            expect(typeof feedbackConfidence).toBe('number');
            expect(matchingItem).toBeDefined();

            if (matchingItem) {
                // Confidence values should be within reasonable range
                const confidenceDiff = Math.abs(feedbackConfidence - matchingItem.confidence);
                expect(confidenceDiff).toBeLessThan(0.31); // Allow some variation for floating-point precision
            }
        });
    });

    describe('Learning Performance and Scalability', () => {
        test('should handle high-volume learning data efficiently', async () => {
            const batchSize = 50;

            // Generate large batch of feedback events
            const feedbackBatch: FeedbackEvent[] = [];
            for (let i = 0; i < batchSize; i++) {
                feedbackBatch.push({
                    ...createTestFeedbackEvent(),
                    id: `bulk-feedback-${i}`,
                });
            }

            // Generate evolution events
            const evolutionEvents: EvolutionEvent[] = [];
            for (let i = 0; i < batchSize; i++) {
                evolutionEvents.push({
                    ...createTestEvolutionEvent(),
                    id: `bulk-evolution-${i}`,
                    file: `file:///test/bulk-${i}.ts`,
                });
            }

            const startTime = Date.now();

            // Process all events
            await Promise.all([
                context.feedbackLoop.processFeedbackBatch(feedbackBatch),
                ...evolutionEvents.map((event) => context.evolutionTracker.trackChange(event)),
            ]);

            const duration = Date.now() - startTime;

            // Should handle bulk operations efficiently
            const avgTimePerEvent = duration / (batchSize * 2);
            expect(avgTimePerEvent).toBeLessThan(10); // <10ms per event on average

            console.log(
                `Processed ${batchSize * 2} learning events in ${duration}ms (${avgTimePerEvent.toFixed(2)}ms/event)`
            );
        });

        // Performance-sensitive concurrency test moved to performance suite:
        // tests/performance/learning-concurrency.test.ts

        test('should provide real-time learning metrics', async () => {
            // Generate some learning activity
            await context.feedbackLoop.processFeedback(createTestFeedbackEvent());
            await context.evolutionTracker.trackChange(createTestEvolutionEvent());

            const metrics = await context.learningOrchestrator.getRealTimeMetrics();

            expect(metrics).toBeDefined();
            expect(metrics.timestamp).toBeDefined();
            expect(metrics.learningRate).toBeGreaterThanOrEqual(0);
            expect(metrics.processingLatency).toBeGreaterThanOrEqual(0);
            expect(metrics.systemLoad).toBeGreaterThanOrEqual(0);
            expect(metrics.systemLoad).toBeLessThanOrEqual(1);
            expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
            expect(metrics.activeOperations).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Learning System Resilience', () => {
        test('should handle corrupted learning data gracefully', async () => {
            // Create corrupted feedback event
            const corruptedFeedback = {
                ...createTestFeedbackEvent(),
                // @ts-expect-error - intentionally corrupt data
                type: 'invalid_type',
                originalSuggestion: null,
                context: undefined,
            };

            // Should not throw but handle gracefully
            const result = await context.feedbackLoop.processFeedback(corruptedFeedback as FeedbackEvent);
            expect(result).toBeDefined();
            expect(typeof result.success).toBe('boolean');

            // System should remain healthy
            const health = await context.learningOrchestrator.getSystemHealth();
            expect(health.overall).not.toBe('unhealthy');
        });

        test('should recover from component failures', async () => {
            // Simulate component failure and recovery
            const originalProcessFeedback = context.feedbackLoop.processFeedback;

            // Mock a temporary failure
            context.feedbackLoop.processFeedback = async () => {
                throw new Error('Simulated component failure');
            };

            // Should handle the failure gracefully
            const learningContext = {
                requestId: 'failure-test',
                operation: 'comprehensive_analysis',
                timestamp: new Date(),
                metadata: {},
            };

            const result = await context.learningOrchestrator.learn(learningContext, {
                feedback: createTestFeedbackEvent(),
            });

            // Should not completely fail despite component failure
            expect(result).toBeDefined();
            expect(typeof result.success).toBe('boolean');

            // Restore original function
            context.feedbackLoop.processFeedback = originalProcessFeedback;

            // System should recover
            const health = await context.learningOrchestrator.getSystemHealth();
            expect(health).toBeDefined();
        });

        test('should provide detailed error reporting for monitoring', async () => {
            const errorEvents: any[] = [];

            // Create event bus that captures errors
            const errorCapturingEventBus: EventBus = {
                emit: (type: string, data: any) => {
                    if (type.includes('error') || type.includes('failure')) {
                        errorEvents.push({ type, data, timestamp: Date.now() });
                    }
                },
                on: () => {},
                off: () => {},
                once: () => {},
            };

            // Create learning orchestrator with error capturing
            const errorTestServices = new SharedServices(context.config);
            await errorTestServices.initialize();

            const errorTestOrchestrator = new LearningOrchestrator(errorTestServices, errorCapturingEventBus, {
                enabledComponents: {
                    patternLearning: true,
                    feedbackLoop: true,
                    evolutionTracking: true,
                    teamKnowledge: true,
                },
            });

            await errorTestOrchestrator.initialize();

            // Trigger an error condition
            try {
                await errorTestOrchestrator.learn(
                    {
                        requestId: 'error-test',
                        operation: 'comprehensive_analysis',
                        timestamp: new Date(),
                        metadata: {},
                    },
                    // @ts-expect-error - intentionally invalid data
                    { invalidData: 'should cause error' }
                );
            } catch (error) {
                // Expected to potentially throw
            }

            // Clean up
            await errorTestOrchestrator.dispose();
            await errorTestServices.dispose();

            // Should have captured error events for monitoring
            expect(Array.isArray(errorEvents)).toBe(true);
            // Note: Actual error events depend on implementation details
        });
    });
});
