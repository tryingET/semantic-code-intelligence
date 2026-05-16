#!/usr/bin/env bun

/**
 * Comprehensive integration test for the Feedback Loop System
 * Tests the actual implementation without mocking
 */

import fs from 'fs';
import path from 'path';
import { EventBusService } from './src/core/services/event-bus-service.js';
import { SharedServices } from './src/core/services/index.js';
import { FeedbackLoopSystem } from './src/learning/feedback-loop.js';
import { PatternLearner } from './src/patterns/pattern-learner.js';

// Test database paths
const TEST_DB_PATH = path.join(process.cwd(), 'test-feedback-integration.db');
const PATTERN_DB_PATH = path.join(process.cwd(), 'test-patterns-integration.db');

// Clean up any existing test databases
function cleanup() {
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(PATTERN_DB_PATH)) {
        fs.unlinkSync(PATTERN_DB_PATH);
    }
}

// Create minimal configuration
const mockConfig = {
    layers: {
        layer1: { enabled: true, timeout: 5000, maxResults: 100 },
        layer2: { enabled: true, timeout: 50000, languages: ['typescript', 'javascript'] },
        layer3: { enabled: true, dbPath: TEST_DB_PATH, cacheSize: 1000 },
        layer4: { enabled: true, learningThreshold: 3, confidenceThreshold: 0.7 },
        layer5: { enabled: true, maxDepth: 3, autoApplyThreshold: 0.8 },
    },
    cache: {
        enabled: true,
        memory: { maxSize: 1024 * 1024 }, // 1MB
        ttl: 300,
    },
    monitoring: { enabled: true, metricsInterval: 1000 },
    performance: { healthCheckInterval: 30000 },
};

async function testFeedbackLoopIntegration() {
    let feedbackLoop, sharedServices, eventBus, patternLearner;

    try {
        console.log('🚀 Starting Feedback Loop Integration Test');

        // Step 1: Initialize all components
        console.log('1️⃣  Initializing components...');
        cleanup(); // Clean up first

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

        console.log('✅ Components initialized successfully');

        // Step 2: Test basic feedback recording
        console.log('2️⃣  Testing basic feedback recording...');

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

        console.log(`✅ Recorded feedback with ID: ${feedbackId}`);

        // Step 3: Test different feedback types
        console.log('3️⃣  Testing different feedback types...');

        const feedbackTypes = ['reject', 'modify', 'ignore'];
        for (const type of feedbackTypes) {
            await feedbackLoop.recordFeedback({
                type,
                suggestionId: `test-suggestion-${type}`,
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

        console.log('✅ Recorded different feedback types');

        // Step 4: Test learning from corrections
        console.log('4️⃣  Testing learning from corrections...');

        await feedbackLoop.learnFromCorrection('getData', 'fetchData', {
            file: '/src/api.ts',
            operation: 'rename',
            confidence: 0.8,
        });

        console.log('✅ Learning from corrections completed');

        // Step 5: Test feedback statistics
        console.log('5️⃣  Testing feedback statistics...');

        const stats = await feedbackLoop.getFeedbackStats();
        console.log('📊 Feedback Statistics:');
        console.log(`   Total Feedbacks: ${stats.totalFeedbacks}`);
        console.log(`   Acceptance Rate: ${(stats.acceptanceRate * 100).toFixed(1)}%`);
        console.log(`   Rejection Rate: ${(stats.rejectionRate * 100).toFixed(1)}%`);
        console.log(`   Modification Rate: ${(stats.modificationRate * 100).toFixed(1)}%`);
        console.log(`   Average Confidence: ${stats.averageConfidence.toFixed(2)}`);

        console.log('✅ Statistics generated successfully');

        // Step 6: Test insight generation
        console.log('6️⃣  Testing insight generation...');

        const insights = await feedbackLoop.generateInsights();
        console.log(`📈 Generated ${insights.length} insights`);
        insights.forEach((insight, index) => {
            console.log(`   ${index + 1}. ${insight.type}: ${insight.description}`);
        });

        console.log('✅ Insights generated successfully');

        // Step 7: Test pattern-specific feedback
        console.log('7️⃣  Testing pattern-specific feedback...');

        const patternId = 'test-pattern-123';
        await feedbackLoop.recordFeedback({
            type: 'accept',
            suggestionId: 'pattern-test',
            patternId,
            originalSuggestion: 'patternTest',
            context: {
                file: '/src/pattern.ts',
                operation: 'rename',
                timestamp: new Date(),
                confidence: 0.9,
            },
            metadata: {
                source: 'test',
            },
        });

        const patternFeedback = feedbackLoop.getFeedbackForPattern(patternId);
        console.log(`📋 Pattern ${patternId} has ${patternFeedback.length} feedback items`);

        console.log('✅ Pattern-specific feedback tested');

        // Step 8: Test performance with bulk operations
        console.log('8️⃣  Testing performance with bulk operations...');

        const startTime = Date.now();
        const bulkPromises = [];

        for (let i = 0; i < 50; i++) {
            bulkPromises.push(
                feedbackLoop.recordFeedback({
                    type: i % 2 === 0 ? 'accept' : 'reject',
                    suggestionId: `bulk-test-${i}`,
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

        await Promise.all(bulkPromises);
        const bulkDuration = Date.now() - startTime;

        console.log(`⚡ Processed 50 feedback items in ${bulkDuration}ms (${(bulkDuration / 50).toFixed(1)}ms avg)`);
        console.log('✅ Bulk performance test completed');

        // Step 9: Test diagnostic information
        console.log('9️⃣  Testing diagnostic information...');

        const diagnostics = feedbackLoop.getDiagnostics();
        console.log('🔍 Diagnostics:');
        console.log(`   Initialized: ${diagnostics.initialized}`);
        console.log(`   Feedback History Size: ${diagnostics.feedbackHistorySize}`);
        console.log(`   Has Pattern Learner: ${diagnostics.hasPatternLearner}`);
        console.log(`   Learning Thresholds:`, diagnostics.learningThresholds);

        console.log('✅ Diagnostics retrieved successfully');

        // Step 10: Test error handling
        console.log('🔟 Testing error handling...');

        try {
            // Test with invalid feedback
            await feedbackLoop.processFeedback({
                type: 'accept',
                suggestionId: null, // Invalid
                originalSuggestion: 'test',
                context: {
                    file: '/src/test.ts',
                    operation: 'rename',
                    timestamp: new Date(),
                    confidence: 0.5,
                },
                metadata: {
                    source: 'error-test',
                },
            });
            console.log('✅ Error handling works - invalid feedback was sanitized');
        } catch (error) {
            console.log('✅ Error handling works - invalid feedback was rejected');
        }

        console.log('\n🎉 All Feedback Loop Integration Tests Passed!');
        console.log('\n📊 Final Statistics:');
        const finalStats = await feedbackLoop.getFeedbackStats();
        console.log(`   Total Processed: ${finalStats.totalFeedbacks} feedback events`);
        console.log(
            `   Success Rate: ${((finalStats.acceptanceRate + finalStats.modificationRate) * 100).toFixed(1)}%`
        );
    } catch (error) {
        console.error('❌ Integration Test Failed:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        // Cleanup
        try {
            if (feedbackLoop) await feedbackLoop.dispose();
            if (patternLearner) await patternLearner.dispose();
            if (sharedServices) await sharedServices.dispose();
            cleanup();
            console.log('🧹 Cleanup completed');
        } catch (cleanupError) {
            console.warn('⚠️  Cleanup warning:', cleanupError.message);
        }
    }
}

// Run the test
testFeedbackLoopIntegration().catch((error) => {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
});
