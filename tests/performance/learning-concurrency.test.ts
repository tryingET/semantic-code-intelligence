/**
 * Learning Concurrency Performance Test (moved from learning-system.test.ts)
 * Environment-sensitive; belongs in performance suite.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

// Gate performance-sensitive suite behind PERF=1 to avoid flakiness in default runs
const perfOnly = process.env.PERF === '1';
const perfDescribe = perfOnly ? describe : describe.skip;

import { SharedServices } from '../../src/core/services/index.js';
import { CodeEvolutionTracker } from '../../src/learning/evolution-tracker.js';
import { FeedbackLoopSystem } from '../../src/learning/feedback-loop.js';
import { LearningOrchestrator } from '../../src/learning/learning-orchestrator.js';
import { TeamKnowledgeSystem } from '../../src/learning/team-knowledge.js';
import type { CoreConfig, EventBus, EvolutionEvent, FeedbackEvent } from '../../src/learning/types.js';

interface Ctx {
    learningOrchestrator: LearningOrchestrator;
    feedbackLoop: FeedbackLoopSystem;
    evolutionTracker: CodeEvolutionTracker;
    teamKnowledge: TeamKnowledgeSystem;
    sharedServices: SharedServices;
}

const createCtx = async (): Promise<Ctx> => {
    const eventBus: EventBus = {
        emit: () => {},
        on: () => {},
        off: () => {},
        once: () => {},
    };

    const config: CoreConfig = {
        workspaceRoot: '/test-workspace',
        layers: {
            layer1: { enabled: true, timeout: 50 },
            layer2: { enabled: true, timeout: 100 },
            layer3: { enabled: true, timeout: 50 },
            layer4: { enabled: true, timeout: 50 },
            layer5: { enabled: true, timeout: 100 },
        },
        cache: { enabled: true, strategy: 'memory', memory: { maxSize: 1024 * 1024, ttl: 300 } },
        database: { path: ':memory:', maxConnections: 20 },
        performance: { targetResponseTime: 100, maxConcurrentRequests: 100, healthCheckInterval: 30000 },
        monitoring: {
            enabled: false,
            metricsInterval: 60000,
            logLevel: 'error',
            tracing: { enabled: false, sampleRate: 0 },
        },
    } as CoreConfig;

    const sharedServices = new SharedServices(config);
    await sharedServices.initialize();
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
    const learningOrchestrator = new LearningOrchestrator(sharedServices, eventBus, {
        enabledComponents: { patternLearning: true, feedbackLoop: true, evolutionTracking: true, teamKnowledge: true },
    });

    await feedbackLoop.initialize();
    await evolutionTracker.initialize();
    await teamKnowledge.initialize();
    await learningOrchestrator.initialize();

    return { learningOrchestrator, feedbackLoop, evolutionTracker, teamKnowledge, sharedServices };
};

const makeFeedback = (): FeedbackEvent => ({
    id: `feedback-${Date.now()}`,
    suggestionId: `suggestion-${Math.random()}`,
    type: 'accept',
    originalSuggestion: 'oldFunction',
    finalValue: 'newFunction',
    context: { file: 'file:///test/example.ts', operation: 'completion', confidence: 0.8, timestamp: new Date() },
    metadata: { source: 'vscode', keystrokes: 5, timeToDecision: 2000 },
});

const makeEvolution = (): EvolutionEvent => ({
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
    context: { commit: 'abc123', author: 'test@example.com', message: 'Refactor implementation', branch: 'main' },
    impact: { filesAffected: 1, symbolsAffected: 1, testsAffected: 0, severity: 'low' },
    metadata: { diffSize: 2, automated: false },
});

perfDescribe('Learning Concurrency Performance', () => {
    let ctx: Ctx;
    beforeAll(async () => {
        ctx = await createCtx();
    });
    afterAll(async () => {
        await ctx.learningOrchestrator.dispose();
        await ctx.feedbackLoop.dispose();
        await ctx.evolutionTracker.dispose();
        await ctx.teamKnowledge.dispose();
        await ctx.sharedServices.dispose();
    });

    test('should maintain performance under 10 concurrent learning operations', async () => {
        const concurrentOperations = 10;
        const operations = [] as Array<Promise<any>>;
        for (let i = 0; i < concurrentOperations; i++) {
            operations.push(
                ctx.learningOrchestrator.learn(
                    {
                        requestId: `concurrent-${i}`,
                        operation: 'comprehensive_analysis',
                        timestamp: new Date(),
                        metadata: { index: i },
                    },
                    { feedback: makeFeedback(), fileChange: makeEvolution() }
                )
            );
        }

        const startTime = Date.now();
        const results = await Promise.all(operations);
        const duration = Date.now() - startTime;

        // This is intentionally a performance assertion; tolerate modest variance
        const envVal = parseInt(process.env.PERF_CONCURRENCY_P95_TARGET_MS || '', 10);
        const target = Number.isFinite(envVal) && envVal > 0 ? envVal : 250;
        expect(duration).toBeLessThan(target);

        results.forEach((result) => {
            expect(result.success).toBe(true);
            expect(result).toHaveProperty('insights');
        });
    });
});
