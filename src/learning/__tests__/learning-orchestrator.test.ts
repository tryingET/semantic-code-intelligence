/**
 * Integration tests for LearningOrchestrator and complete learning pipeline
 * Tests coordination between all learning components and end-to-end workflows
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { LayerManager } from '../../core/layer-manager.js';
import { EventBusService } from '../../core/services/event-bus-service.js';
import { SharedServices } from '../../core/services/index.js';
import type { CoreConfig } from '../../core/types.js';
import { CodeAnalyzer } from '../../core/unified-analyzer.js';
import { LearningOrchestrator, type LearningPipeline } from '../learning-orchestrator.js';

// Test database path
const TEST_DB_PATH = path.join(process.cwd(), 'test-learning-integration.db');

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

describe('LearningOrchestrator Integration Tests', () => {
    let learningOrchestrator: LearningOrchestrator;
    let sharedServices: SharedServices;
    let eventBus: EventBusService;
    let codeAnalyzer: CodeAnalyzer;
    let layerManager: LayerManager;

    beforeEach(async () => {
        // Clean up test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }

        // Create fresh event bus and shared services
        eventBus = new EventBusService();
        sharedServices = new SharedServices(mockConfig, eventBus);
        await sharedServices.initialize();

        // Create layer manager (simplified mock)
        layerManager = new LayerManager(mockConfig, sharedServices, eventBus);
        await layerManager.initialize();

        // Create learning orchestrator
        learningOrchestrator = new LearningOrchestrator(sharedServices, eventBus, {
            enabledComponents: {
                patternLearning: true,
                feedbackLoop: true,
                evolutionTracking: true,
                teamKnowledge: true,
            },
            performanceTargets: {
                maxLearningTime: 200, // More lenient for integration tests
                maxPipelineTime: 1000,
                maxConcurrentOperations: 3,
            },
        });

        await learningOrchestrator.initialize();

        // Create unified analyzer with learning integration
        codeAnalyzer = new CodeAnalyzer(layerManager, sharedServices, mockConfig, eventBus);
        await codeAnalyzer.initialize();
    });

    afterEach(async () => {
        // Clean up
        await codeAnalyzer.dispose();
        await learningOrchestrator.dispose();
        await layerManager.dispose();
        await sharedServices.dispose();

        // Remove test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    describe('Orchestrator Initialization', () => {
        test('should initialize all learning components', async () => {
            const diagnostics = learningOrchestrator.getDiagnostics();

            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.enabledComponents.patternLearning).toBe(true);
            expect(diagnostics.enabledComponents.feedbackLoop).toBe(true);
            expect(diagnostics.enabledComponents.evolutionTracking).toBe(true);
            expect(diagnostics.enabledComponents.teamKnowledge).toBe(true);
            expect(diagnostics.pipelinesCount).toBeGreaterThan(0);
        });

        test('should initialize default pipelines', async () => {
            const diagnostics = learningOrchestrator.getDiagnostics();

            expect(diagnostics.pipelinesCount).toBeGreaterThanOrEqual(3);
            expect(diagnostics.activePipelinesCount).toBe(0); // None running initially
        });

        test('should report system health', async () => {
            const health = await learningOrchestrator.getSystemHealth();

            expect(health.overall).toBeDefined();
            expect(['healthy', 'degraded', 'critical']).toContain(health.overall);
            expect(health.components).toBeDefined();
            expect(health.components.patternLearner).toBeDefined();
            expect(health.components.feedbackLoop).toBeDefined();
            expect(health.components.evolutionTracker).toBeDefined();
            expect(health.components.teamKnowledge).toBeDefined();
            expect(health.metrics).toBeDefined();
        });
    });

    describe('Learning Operations', () => {
        test('should handle pattern learning operation', async () => {
            const context = {
                requestId: 'test-pattern-learning',
                operation: 'pattern_learning',
                file: '/src/user.ts',
                timestamp: new Date(),
                metadata: { test: 'pattern_learning' },
            };

            const data = {
                rename: {
                    oldName: 'getUserData',
                    newName: 'fetchUserData',
                    context: {
                        file: '/src/user.ts',
                        surroundingSymbols: ['User', 'data', 'service'],
                        timestamp: new Date(),
                    },
                },
            };

            const result = await learningOrchestrator.learn(context, data);

            expect(result.success).toBe(true);
            expect(result.performance.totalTimeMs).toBeLessThan(300);
            expect(result.data).toBeDefined();
        });

        test('should handle feedback recording operation', async () => {
            const context = {
                requestId: 'test-feedback-recording',
                operation: 'feedback_recording',
                file: '/src/api.ts',
                timestamp: new Date(),
                metadata: { test: 'feedback_recording' },
            };

            const data = {
                feedback: {
                    type: 'accept',
                    suggestionId: 'suggestion-123',
                    originalSuggestion: 'getData',
                    context: {
                        file: '/src/api.ts',
                        operation: 'rename',
                        timestamp: new Date(),
                        confidence: 0.85,
                    },
                    metadata: {
                        source: 'vscode',
                        timeToDecision: 2500,
                    },
                },
            };

            const result = await learningOrchestrator.learn(context, data);

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });

        test('should handle evolution tracking operation', async () => {
            const context = {
                requestId: 'test-evolution-tracking',
                operation: 'evolution_tracking',
                file: '/src/component.ts',
                timestamp: new Date(),
                metadata: { test: 'evolution_tracking' },
            };

            const data = {
                fileChange: {
                    path: '/src/component.ts',
                    type: 'modified',
                    before: 'export class OldComponent {}',
                    after: 'export class NewComponent {}',
                    context: {
                        commit: 'abc123',
                        author: 'developer',
                        message: 'Rename component',
                    },
                },
            };

            const result = await learningOrchestrator.learn(context, data);

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });

        test('should handle team sharing operation', async () => {
            // First register a team member
            const memberContext = {
                requestId: 'test-member-registration',
                operation: 'team_sharing',
                timestamp: new Date(),
                metadata: { action: 'register_member' },
            };

            // Create a pattern to share
            const pattern = {
                id: 'test-team-pattern',
                from: [
                    { type: 'literal', value: 'get' },
                    { type: 'variable', name: 'entity' },
                ],
                to: [
                    { type: 'literal', value: 'fetch' },
                    { type: 'variable', name: 'entity' },
                ],
                confidence: 0.8,
                occurrences: 5,
                examples: [],
                lastApplied: new Date(),
                category: 'Convention',
            };

            const context = {
                requestId: 'test-team-sharing',
                operation: 'team_sharing',
                timestamp: new Date(),
                metadata: { test: 'team_sharing' },
            };

            const data = {
                sharePattern: {
                    pattern,
                    contributorId: 'test-contributor',
                    documentation: {
                        description: 'Convert get to fetch',
                        whenToUse: 'For API calls',
                        whenNotToUse: 'For getters',
                        examples: ['getData -> fetchData'],
                        relatedPatterns: [],
                    },
                    scope: 'team',
                },
            };

            const result = await learningOrchestrator.learn(context, data);

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });

        test('should handle comprehensive analysis operation', async () => {
            const context = {
                requestId: 'test-comprehensive-analysis',
                operation: 'comprehensive_analysis',
                timestamp: new Date(),
                metadata: { test: 'comprehensive_analysis' },
            };

            const result = await learningOrchestrator.learn(context, {});

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.insights).toBeDefined();
            expect(result.recommendations).toBeDefined();
        });

        test('should enforce performance limits', async () => {
            // Try to exceed concurrent operations limit
            const contexts = [];
            const promises = [];

            for (let i = 0; i < 6; i++) {
                // More than maxConcurrentOperations (3)
                const context = {
                    requestId: `test-concurrent-${i}`,
                    operation: 'pattern_learning',
                    timestamp: new Date(),
                    metadata: { concurrent: i },
                };

                const data = {
                    rename: {
                        oldName: `old${i}`,
                        newName: `new${i}`,
                        context: {
                            file: `/src/file${i}.ts`,
                            surroundingSymbols: [],
                            timestamp: new Date(),
                        },
                    },
                };

                promises.push(learningOrchestrator.learn(context, data));
            }

            // Some operations should succeed, others may be rejected
            const results = await Promise.allSettled(promises);
            const successful = results.filter((r) => r.status === 'fulfilled').length;

            expect(successful).toBeGreaterThan(0);
            expect(successful).toBeLessThanOrEqual(6);
        });
    });

    describe('Pipeline Execution', () => {
        test('should register and execute custom pipeline', async () => {
            const pipeline: Omit<LearningPipeline, 'stats'> = {
                id: 'test-custom-pipeline',
                name: 'Test Custom Pipeline',
                description: 'Pipeline for integration testing',
                components: ['pattern_learning', 'feedback_loop'],
                trigger: 'manual',
                enabled: true,
            };

            const pipelineId = await learningOrchestrator.registerPipeline(pipeline);
            expect(pipelineId).toBe('test-custom-pipeline');

            const context = {
                requestId: 'test-pipeline-execution',
                operation: 'pipeline_execution',
                timestamp: new Date(),
                metadata: { pipeline: 'test-custom-pipeline' },
            };

            const result = await learningOrchestrator.executePipeline(pipelineId, context);

            expect(result.success).toBe(true);
            expect(result.performance.totalTimeMs).toBeGreaterThan(0);
            expect(result.performance.componentsTime).toBeDefined();
            expect(result.performance.componentsTime['pattern_learning']).toBeDefined();
            expect(result.performance.componentsTime['feedback_loop']).toBeDefined();
        });

        test('should execute default comprehensive pipeline', async () => {
            const context = {
                requestId: 'test-comprehensive-pipeline',
                operation: 'pipeline_execution',
                timestamp: new Date(),
                metadata: { pipeline: 'comprehensive_learning' },
            };

            const result = await learningOrchestrator.executePipeline('comprehensive_learning', context);

            expect(result.success).toBe(true);
            expect(result.performance.totalTimeMs).toBeLessThan(2000); // Should be under 2 seconds
        });

        test('should handle pipeline errors gracefully', async () => {
            const context = {
                requestId: 'test-error-pipeline',
                operation: 'pipeline_execution',
                timestamp: new Date(),
                metadata: { pipeline: 'non-existent' },
            };

            await expect(learningOrchestrator.executePipeline('non-existent-pipeline', context)).rejects.toThrow(
                'Pipeline non-existent-pipeline not found'
            );
        });

        test('should track pipeline statistics', async () => {
            // Execute a pipeline multiple times
            for (let i = 0; i < 3; i++) {
                const context = {
                    requestId: `stats-test-${i}`,
                    operation: 'pipeline_execution',
                    timestamp: new Date(),
                    metadata: { iteration: i },
                };

                await learningOrchestrator.executePipeline('pattern_feedback_cycle', context);
            }

            const stats = await learningOrchestrator.getLearningStats();

            expect(stats.pipelines).toBeDefined();
            expect(stats.pipelines.total).toBeGreaterThan(0);
            expect(stats.pipelines.totalRuns).toBeGreaterThanOrEqual(3);
        });
    });

    describe('End-to-End Learning Workflows', () => {
        test('should complete pattern learning to team sharing workflow', async () => {
            // Step 1: Learn a pattern from rename
            const patternLearningResult = await learningOrchestrator.learn(
                {
                    requestId: 'e2e-step1',
                    operation: 'pattern_learning',
                    file: '/src/api.ts',
                    timestamp: new Date(),
                    metadata: { workflow: 'e2e', step: 1 },
                },
                {
                    rename: {
                        oldName: 'getUserInfo',
                        newName: 'fetchUserInfo',
                        context: {
                            file: '/src/api.ts',
                            surroundingSymbols: ['User', 'Api', 'service'],
                            timestamp: new Date(),
                        },
                    },
                }
            );

            expect(patternLearningResult.success).toBe(true);

            // Step 2: Record positive feedback
            const feedbackResult = await learningOrchestrator.learn(
                {
                    requestId: 'e2e-step2',
                    operation: 'feedback_recording',
                    file: '/src/api.ts',
                    timestamp: new Date(),
                    metadata: { workflow: 'e2e', step: 2 },
                },
                {
                    feedback: {
                        type: 'accept',
                        suggestionId: 'pattern-suggestion-1',
                        originalSuggestion: 'getUserInfo',
                        finalValue: 'fetchUserInfo',
                        context: {
                            file: '/src/api.ts',
                            operation: 'rename',
                            timestamp: new Date(),
                            confidence: 0.9,
                        },
                        metadata: {
                            source: 'vscode',
                        },
                    },
                }
            );

            expect(feedbackResult.success).toBe(true);

            // Step 3: Get comprehensive insights
            const analysisResult = await learningOrchestrator.learn(
                {
                    requestId: 'e2e-step3',
                    operation: 'comprehensive_analysis',
                    timestamp: new Date(),
                    metadata: { workflow: 'e2e', step: 3 },
                },
                {}
            );

            expect(analysisResult.success).toBe(true);
            expect(analysisResult.insights).toBeDefined();
            expect(analysisResult.recommendations).toBeDefined();
        });

        test('should handle code evolution to architecture insights workflow', async () => {
            // Step 1: Track file changes
            const fileChanges = [
                {
                    path: '/src/user.ts',
                    type: 'created',
                    after: 'export class User { constructor(public name: string) {} }',
                    context: { message: 'Add user model' },
                },
                {
                    path: '/src/user.service.ts',
                    type: 'created',
                    after: 'export class UserService { getUser(id: string) { return new User("test"); } }',
                    context: { message: 'Add user service' },
                },
                {
                    path: '/src/user.controller.ts',
                    type: 'created',
                    after: 'export class UserController { constructor(private service: UserService) {} }',
                    context: { message: 'Add user controller' },
                },
            ];

            for (let i = 0; i < fileChanges.length; i++) {
                const change = fileChanges[i];
                const result = await learningOrchestrator.learn(
                    {
                        requestId: `evolution-step-${i}`,
                        operation: 'evolution_tracking',
                        file: change.path,
                        timestamp: new Date(Date.now() - (2 - i) * 24 * 60 * 60 * 1000), // Spread over 3 days
                        metadata: { workflow: 'evolution', step: i },
                    },
                    {
                        fileChange: {
                            path: change.path,
                            type: change.type,
                            after: change.after,
                            context: change.context,
                        },
                    }
                );

                expect(result.success).toBe(true);
            }

            // Step 2: Record quality metrics showing growth
            const qualityMetrics = [
                {
                    complexity: { cyclomatic: 5, cognitive: 8, halstead: 3 },
                    dependencies: { internal: 0, external: 2, circular: 0 },
                    testCoverage: { lines: 100, branches: 100, functions: 100 },
                },
                {
                    complexity: { cyclomatic: 12, cognitive: 18, halstead: 7 },
                    dependencies: { internal: 2, external: 3, circular: 0 },
                    testCoverage: { lines: 85, branches: 78, functions: 90 },
                },
                {
                    complexity: { cyclomatic: 20, cognitive: 30, halstead: 12 },
                    dependencies: { internal: 4, external: 4, circular: 1 },
                    testCoverage: { lines: 70, branches: 65, functions: 75 },
                },
            ];

            // Add quality metrics through evolution tracker directly
            for (let i = 0; i < qualityMetrics.length; i++) {
                const metrics = qualityMetrics[i];
                await learningOrchestrator.learn(
                    {
                        requestId: `quality-${i}`,
                        operation: 'evolution_tracking',
                        timestamp: new Date(Date.now() - (2 - i) * 24 * 60 * 60 * 1000),
                        metadata: { workflow: 'quality', step: i },
                    },
                    {
                        evolutionEvent: {
                            type: 'symbol_added',
                            timestamp: new Date(Date.now() - (2 - i) * 24 * 60 * 60 * 1000),
                            file: '/src/system.ts',
                            context: { message: `System growth step ${i}` },
                            impact: {
                                filesAffected: i + 1,
                                symbolsAffected: (i + 1) * 3,
                                testsAffected: i,
                                severity: i === 2 ? 'high' : 'medium',
                            },
                            metadata: {
                                diffSize: (i + 1) * 50,
                                automated: false,
                            },
                        },
                    }
                );
            }

            // Step 3: Generate comprehensive analysis
            const analysisResult = await learningOrchestrator.learn(
                {
                    requestId: 'evolution-analysis',
                    operation: 'comprehensive_analysis',
                    timestamp: new Date(),
                    metadata: { workflow: 'evolution-complete' },
                },
                {}
            );

            expect(analysisResult.success).toBe(true);
            expect(analysisResult.data).toBeDefined();
        });

        test('should integrate with unified analyzer for complete learning loop', async () => {
            // Step 1: Use CodeAnalyzer to record feedback
            await codeAnalyzer.recordFeedback('analyzer-feedback-1', 'accept', 'oldFunction', 'newFunction', {
                file: '/src/analyzer-test.ts',
                operation: 'rename',
                confidence: 0.85,
            });

            // Step 2: Track file change through CodeAnalyzer
            await codeAnalyzer.trackFileChange(
                '/src/analyzer-test.ts',
                'modified',
                'function oldFunction() {}',
                'function newFunction() {}',
                {
                    commit: 'analyzer123',
                    message: 'Rename function via analyzer',
                }
            );

            // Step 3: Get learning insights from CodeAnalyzer
            const insights = await codeAnalyzer.getLearningInsights();

            expect(insights).toBeDefined();
            expect(insights.systemHealth).toBeDefined();
            expect(insights.insights).toBeDefined();
            expect(insights.recommendations).toBeDefined();
            expect(insights.patterns).toBeDefined();
        });
    });

    describe('Performance and Scalability', () => {
        test('should handle concurrent learning operations', async () => {
            const startTime = Date.now();
            const operationPromises: Promise<any>[] = [];

            // Create multiple concurrent learning operations
            for (let i = 0; i < 5; i++) {
                operationPromises.push(
                    learningOrchestrator.learn(
                        {
                            requestId: `concurrent-${i}`,
                            operation: 'pattern_learning',
                            file: `/src/concurrent-${i}.ts`,
                            timestamp: new Date(),
                            metadata: { concurrent: i },
                        },
                        {
                            rename: {
                                oldName: `old${i}`,
                                newName: `new${i}`,
                                context: {
                                    file: `/src/concurrent-${i}.ts`,
                                    surroundingSymbols: [`symbol${i}`],
                                    timestamp: new Date(),
                                },
                            },
                        }
                    )
                );
            }

            const results = await Promise.allSettled(operationPromises);
            const duration = Date.now() - startTime;

            // Check that operations completed in reasonable time
            expect(duration).toBeLessThan(5000); // 5 seconds max

            // Check that most operations succeeded
            const successful = results.filter((r) => r.status === 'fulfilled').length;
            expect(successful).toBeGreaterThan(2); // At least some should succeed
        });

        test('should maintain performance under load', async () => {
            // Perform many sequential operations
            const operationCount = 20;
            const startTime = Date.now();

            for (let i = 0; i < operationCount; i++) {
                await learningOrchestrator.learn(
                    {
                        requestId: `load-test-${i}`,
                        operation: 'feedback_recording',
                        timestamp: new Date(),
                        metadata: { load: i },
                    },
                    {
                        feedback: {
                            type: i % 2 === 0 ? 'accept' : 'reject',
                            suggestionId: `load-suggestion-${i}`,
                            originalSuggestion: `loadTest${i}`,
                            context: {
                                file: '/src/load-test.ts',
                                operation: 'rename',
                                timestamp: new Date(),
                                confidence: 0.7,
                            },
                            metadata: {
                                source: 'load-test',
                            },
                        },
                    }
                );
            }

            const duration = Date.now() - startTime;
            const averageTime = duration / operationCount;

            // Should maintain reasonable performance
            expect(averageTime).toBeLessThan(200); // Average under 200ms per operation
        });

        test('should track performance metrics accurately', async () => {
            // Perform some operations
            for (let i = 0; i < 5; i++) {
                await learningOrchestrator.learn(
                    {
                        requestId: `metrics-${i}`,
                        operation: 'pattern_learning',
                        timestamp: new Date(),
                        metadata: { metrics: i },
                    },
                    {
                        rename: {
                            oldName: `metricsOld${i}`,
                            newName: `metricsNew${i}`,
                            context: {
                                file: `/src/metrics-${i}.ts`,
                                surroundingSymbols: [],
                                timestamp: new Date(),
                            },
                        },
                    }
                );
            }

            const stats = await learningOrchestrator.getLearningStats();

            expect(stats.performance).toBeDefined();
            expect(stats.performance.totalOperations).toBeGreaterThanOrEqual(5);
            expect(stats.performance.averageResponseTime).toBeGreaterThan(0);
            expect(stats.performance.errorRate).toBeGreaterThanOrEqual(0);
            expect(stats.performance.errorRate).toBeLessThanOrEqual(1);
        });
    });

    describe('System Health and Monitoring', () => {
        test('should report accurate system health', async () => {
            const health = await learningOrchestrator.getSystemHealth();

            expect(health.overall).toBeDefined();
            expect(['healthy', 'degraded', 'critical']).toContain(health.overall);

            // Check individual components
            for (const [component, status] of Object.entries(health.components)) {
                expect(status.status).toBeDefined();
                expect(['healthy', 'degraded', 'critical']).toContain(status.status);

                if (status.status !== 'healthy') {
                    expect(status.details).toBeDefined();
                }
            }

            // Check metrics
            expect(health.metrics.learningOperationsPerSecond).toBeGreaterThanOrEqual(0);
            expect(health.metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
            expect(health.metrics.errorRate).toBeGreaterThanOrEqual(0);
            expect(health.metrics.errorRate).toBeLessThanOrEqual(1);
        });

        test('should detect degraded health conditions', async () => {
            // Simulate some errors to degrade health
            const errorOperations: Promise<any>[] = [];

            for (let i = 0; i < 3; i++) {
                errorOperations.push(
                    learningOrchestrator
                        .learn(
                            {
                                requestId: `error-${i}`,
                                operation: 'invalid_operation' as any, // Invalid operation to cause errors
                                timestamp: new Date(),
                                metadata: { error: i },
                            },
                            {}
                        )
                        .catch(() => ({})) // Catch errors to continue test
                );
            }

            await Promise.allSettled(errorOperations);

            const health = await learningOrchestrator.getSystemHealth();

            // Health might be degraded due to errors, but test should still complete
            expect(health.overall).toBeDefined();
            expect(health.metrics.errorRate).toBeGreaterThanOrEqual(0);
        });

        test('should provide comprehensive diagnostics', async () => {
            const diagnostics = learningOrchestrator.getDiagnostics();

            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.enabledComponents).toBeDefined();
            expect(diagnostics.pipelinesCount).toBeGreaterThan(0);
            expect(diagnostics.performanceMetrics).toBeDefined();
            expect(diagnostics.componentStatus).toBeDefined();
            expect(diagnostics.timestamp).toBeGreaterThan(0);
        });
    });

    describe('Data Maintenance and Cleanup', () => {
        beforeEach(async () => {
            // Add some test data for cleanup testing
            for (let i = 0; i < 10; i++) {
                await learningOrchestrator.learn(
                    {
                        requestId: `cleanup-setup-${i}`,
                        operation: 'feedback_recording',
                        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Spread over 10 days
                        metadata: { cleanup: i },
                    },
                    {
                        feedback: {
                            type: 'accept',
                            suggestionId: `cleanup-${i}`,
                            originalSuggestion: `cleanupTest${i}`,
                            context: {
                                file: '/src/cleanup.ts',
                                operation: 'rename',
                                timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
                                confidence: 0.8,
                            },
                            metadata: {
                                source: 'cleanup-test',
                            },
                        },
                    }
                );
            }
        });

        test('should perform maintenance and cleanup', async () => {
            const result = await learningOrchestrator.performMaintenance();

            expect(result).toBeDefined();
            expect(result.feedbackEventsCleanedUp).toBeGreaterThanOrEqual(0);
            expect(result.evolutionEventsCleanedUp).toBeGreaterThanOrEqual(0);
            expect(result.patternsCleanedUp).toBeGreaterThanOrEqual(0);
            expect(result.duration).toBeGreaterThan(0);
        });

        test('should emit maintenance events', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('learning-maintenance:completed', (data: any) => {
                    resolve(data);
                });
            });

            await learningOrchestrator.performMaintenance();

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).result).toBeDefined();
        });
    });

    describe('Error Handling and Recovery', () => {
        test('should handle component initialization failures gracefully', async () => {
            // Create orchestrator with invalid configuration to test error handling
            const invalidOrchestrator = new LearningOrchestrator(sharedServices, eventBus, {
                enabledComponents: {
                    patternLearning: true,
                    feedbackLoop: true,
                    evolutionTracking: true,
                    teamKnowledge: true,
                },
            });

            // Should initialize despite potential issues
            await expect(invalidOrchestrator.initialize()).resolves.not.toThrow();

            await invalidOrchestrator.dispose();
        });

        test('should handle learning operation failures gracefully', async () => {
            const result = await learningOrchestrator.learn(
                {
                    requestId: 'error-handling-test',
                    operation: 'invalid_operation' as any,
                    timestamp: new Date(),
                    metadata: { error: 'test' },
                },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors!.length).toBeGreaterThan(0);
        });

        test('should recover from temporary failures', async () => {
            // Cause a failure
            const errorResult = await learningOrchestrator.learn(
                {
                    requestId: 'recovery-test-error',
                    operation: 'invalid_operation' as any,
                    timestamp: new Date(),
                    metadata: {},
                },
                {}
            );

            expect(errorResult.success).toBe(false);

            // Should recover and handle valid operation
            const successResult = await learningOrchestrator.learn(
                {
                    requestId: 'recovery-test-success',
                    operation: 'feedback_recording',
                    timestamp: new Date(),
                    metadata: {},
                },
                {
                    feedback: {
                        type: 'accept',
                        suggestionId: 'recovery-test',
                        originalSuggestion: 'recoveryTest',
                        context: {
                            file: '/src/recovery.ts',
                            operation: 'rename',
                            timestamp: new Date(),
                            confidence: 0.8,
                        },
                        metadata: {
                            source: 'recovery-test',
                        },
                    },
                }
            );

            expect(successResult.success).toBe(true);
        });

        test('should handle database connection issues', async () => {
            // Close database connection
            await sharedServices.database.close();

            // Operations should handle database errors gracefully
            const result = await learningOrchestrator.learn(
                {
                    requestId: 'db-error-test',
                    operation: 'feedback_recording',
                    timestamp: new Date(),
                    metadata: { dbError: true },
                },
                {
                    feedback: {
                        type: 'accept',
                        suggestionId: 'db-error',
                        originalSuggestion: 'dbErrorTest',
                        context: {
                            file: '/src/db-error.ts',
                            operation: 'rename',
                            timestamp: new Date(),
                            confidence: 0.8,
                        },
                        metadata: {
                            source: 'db-error-test',
                        },
                    },
                }
            );

            // Should not throw but may report failure
            expect(result).toBeDefined();
            expect(result.performance).toBeDefined();
        });
    });
});
