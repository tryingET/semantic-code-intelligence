/**
 * Example usage of the unified architecture
 * This demonstrates how to use the protocol-agnostic core
 */

import {
    AnalyzerFactory,
    createTestAnalyzer,
    createUnifiedAnalyzer,
    ErrorHandler,
    HealthChecker,
    PerformanceValidator,
} from './index.js';

import type {
    CompletionRequest,
    CoreConfig,
    FindDefinitionRequest,
    FindReferencesRequest,
    RenameRequest,
} from './types.js';

/**
 * Example 1: Basic usage with default configuration
 */
export async function basicExample() {
    console.log('=== Basic Example ===');

    // Create analyzer with default configuration
    const { analyzer, layerManager, sharedServices } = await createUnifiedAnalyzer();

    try {
        // Find definition example
        const definitionRequest: FindDefinitionRequest = {
            uri: 'file:///example/src/utils.ts',
            position: { line: 10, character: 15 },
            identifier: 'parseJSON',
            maxResults: 10,
            fuzzyMatching: true,
        };

        console.log('Finding definitions for "parseJSON"...');
        const definitions = await analyzer.findDefinition(definitionRequest);

        console.log(`Found ${definitions.data.length} definitions`);
        console.log(`Total time: ${definitions.performance.total}ms`);
        console.log(`Layer breakdown:`);
        console.log(`  Layer 1 (Fast Search): ${definitions.performance.layer1}ms`);
        console.log(`  Layer 2 (AST): ${definitions.performance.layer2}ms`);
        console.log(`  Layer 4 (Ontology): ${definitions.performance.layer4}ms`);
        console.log(`  Layer 5 (Patterns): ${definitions.performance.layer5}ms`);
        console.log(`  Layer 5 (Propagation): ${definitions.performance.layer5}ms`);
        console.log(`Cache hit: ${definitions.cacheHit}`);

        // Find references example
        const referencesRequest: FindReferencesRequest = {
            uri: 'file:///example/src/utils.ts',
            position: { line: 10, character: 15 },
            identifier: 'parseJSON',
            includeDeclaration: true,
            maxResults: 50,
        };

        console.log('\nFinding references for "parseJSON"...');
        const references = await analyzer.findReferences(referencesRequest);

        console.log(`Found ${references.data.length} references`);
        console.log(`Total time: ${references.performance.total}ms`);
    } finally {
        // Always clean up
        await analyzer.dispose();
    }
}

/**
 * Example 2: Advanced configuration with custom settings
 */
export async function advancedExample() {
    console.log('\n=== Advanced Example ===');

    // Custom configuration optimized for speed
    const customConfig: Partial<CoreConfig> = {
        layers: {
            layer1: {
                enabled: true,
                timeout: 5, // Very fast timeout
                maxResults: 20,
                fileTypes: ['ts', 'tsx', 'js', 'jsx'],
                optimization: {
                    bloomFilter: true,
                    frequencyCache: true,
                    negativeLookup: true,
                },
            },
            layer2: {
                enabled: true,
                timeout: 30, // Reduced from 50ms
                languages: ['typescript', 'javascript'],
                maxFileSize: 512 * 1024, // 512KB max
                parseTimeout: 25,
            },
            layer3: {
                enabled: true,
                dbPath: ':memory:', // In-memory for demo
                cacheSize: 500,
                conceptThreshold: 0.8,
                relationshipDepth: 2,
            },
            layer4: {
                enabled: true,
                dbPath: ':memory:',
            },
            layer5: {
                enabled: true,
                learningThreshold: 2, // Learn faster
                confidenceThreshold: 0.6,
                maxPatterns: 500,
                decayRate: 0.95,
                maxDepth: 2, // Reduced propagation depth
                autoApplyThreshold: 0.85,
                propagationTimeout: 15,
            },
        },
        performance: {
            targetLatency: 80, // Stricter target
            maxConcurrentRequests: 5,
            requestTimeout: 3000,
            circuitBreakerThreshold: 3,
            healthCheckInterval: 15000,
        },
        cache: {
            enabled: true,
            strategy: 'memory',
            memory: {
                maxSize: 50 * 1024 * 1024, // 50MB
                ttl: 180, // 3 minutes
            },
        },
        monitoring: {
            enabled: true,
            metricsInterval: 10000, // 10 seconds
            logLevel: 'info',
            tracing: {
                enabled: true,
                sampleRate: 0.1,
            },
        },
    };

    const { analyzer, layerManager, sharedServices } = await AnalyzerFactory.createAnalyzer(customConfig);

    try {
        // Demonstrate rename operation with learning
        const renameRequest: RenameRequest = {
            uri: 'file:///example/src/api.ts',
            position: { line: 5, character: 10 },
            oldName: 'getData',
            newName: 'fetchUserData',
            propagate: true,
            dryRun: false,
        };

        console.log('Executing rename with learning...');
        const renameResult = await analyzer.rename(renameRequest);

        console.log(`Rename completed in ${renameResult.performance.total}ms`);
        console.log(`Files affected: ${Object.keys(renameResult.data.changes || {}).length}`);

        // Show layer performance
        const performance = renameResult.performance;
        if (performance.layer5 > 0) {
            console.log('Pattern learning engaged!');
        }
        // In the updated mapping, propagation may be included with pattern learning
    } finally {
        await analyzer.dispose();
    }
}

/**
 * Example 3: Performance monitoring and health checks
 */
export async function monitoringExample() {
    console.log('\n=== Monitoring Example ===');

    const { analyzer, layerManager, sharedServices } = await createTestAnalyzer();

    // Set up performance monitoring
    const performanceValidator = new PerformanceValidator(sharedServices.eventBus);
    performanceValidator.startPeriodicValidation(5000); // Every 5 seconds

    // Set up error handling
    const errorHandler = new ErrorHandler(sharedServices.eventBus);

    // Set up health monitoring
    const healthChecker = new HealthChecker(sharedServices.eventBus);

    // Listen for events
    sharedServices.eventBus.on('performance-validator:report', (report: any) => {
        console.log(`\nPerformance Report:`);
        console.log(`System Status: ${report.systemStatus}`);
        console.log(`Overall Compliance: ${(report.overallCompliance * 100).toFixed(1)}%`);

        report.layerResults.forEach((result: any) => {
            if (result.layer !== 'total') {
                console.log(
                    `  ${result.layer}: ${result.current.toFixed(1)}ms avg (target: ${result.target}ms) - ${result.status}`
                );
            }
        });

        if (report.recommendations.length > 0) {
            console.log('Recommendations:');
            report.recommendations.forEach((rec: string) => console.log(`  - ${rec}`));
        }
    });

    sharedServices.eventBus.on('performance-validator:critical-violation', (data: any) => {
        console.error('\n🚨 CRITICAL PERFORMANCE VIOLATION:');
        data.violations.forEach((violation: string) => console.error(`  - ${violation}`));
    });

    sharedServices.eventBus.on('health-checker:status-change', (data: any) => {
        const status = data.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY';
        console.log(`\nSystem Status Changed: ${status}`);
    });

    try {
        // Simulate some operations to generate metrics
        console.log('Simulating operations to generate performance data...');

        for (let i = 0; i < 10; i++) {
            const request: FindDefinitionRequest = {
                uri: `file:///test/file${i}.ts`,
                position: { line: i, character: 5 },
                identifier: `symbol${i}`,
                maxResults: 5,
            };

            const result = await analyzer.findDefinition(request);
            performanceValidator.recordPerformance(result.performance);

            // Add some delay to simulate real usage
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Wait for monitoring reports
        await new Promise((resolve) => setTimeout(resolve, 6000));

        // Show final stats
        const stats = performanceValidator.getPerformanceStats();
        console.log('\nFinal Performance Statistics:');
        console.log(`Total measurements: ${stats.total.measurements}`);
        console.log(`Average latency: ${stats.total.average.toFixed(1)}ms`);
        console.log(`P95 latency: ${stats.total.p95.toFixed(1)}ms`);
        console.log(`Compliance: ${(stats.total.compliance * 100).toFixed(1)}%`);
    } finally {
        performanceValidator.stopPeriodicValidation();
        healthChecker.stopHealthCheck();
        await analyzer.dispose();
    }
}

/**
 * Example 4: Error handling and recovery
 */
export async function errorHandlingExample() {
    console.log('\n=== Error Handling Example ===');

    const { analyzer, layerManager, sharedServices } = await createTestAnalyzer();
    const errorHandler = new ErrorHandler(sharedServices.eventBus);

    // Listen for error events
    sharedServices.eventBus.on('error-handler:error', (data: any) => {
        console.log(`Layer ${data.layerName} error: ${data.error}`);
    });

    sharedServices.eventBus.on('error-handler:degradation-applied', (data: any) => {
        console.log(`Applied ${data.strategy} degradation for layer ${data.layerName}`);
    });

    sharedServices.eventBus.on('error-handler:circuit-breaker-reset', (data: any) => {
        console.log(`Circuit breaker reset for layer ${data.layerName}`);
    });

    try {
        // Simulate operations that might fail
        console.log('Testing error handling and circuit breakers...');

        // Try operations with invalid data to trigger errors
        const invalidRequests = [
            { uri: '', position: { line: -1, character: -1 }, identifier: '' },
            { uri: 'invalid://uri', position: { line: 0, character: 0 }, identifier: 'test' },
            { uri: 'file:///nonexistent.ts', position: { line: 1000, character: 1000 }, identifier: 'missing' },
        ];

        for (const request of invalidRequests) {
            try {
                await analyzer.findDefinition(request as FindDefinitionRequest);
            } catch (error) {
                console.log(`Expected error handled: ${(error as Error).message}`);
            }
        }

        // Show circuit breaker stats
        const cbStats = errorHandler.getCircuitBreakerStats();
        console.log('\nCircuit Breaker Statistics:');
        Object.entries(cbStats).forEach(([layer, stats]) => {
            console.log(`  ${layer}: ${(stats as any).state} (failures: ${(stats as any).failureCount})`);
        });
    } finally {
        await analyzer.dispose();
    }
}

/**
 * Example 5: Workspace-specific analyzer
 */
export async function workspaceExample(workspacePath: string) {
    console.log('\n=== Workspace Example ===');

    const { analyzer, sharedServices } = await createUnifiedAnalyzer(workspacePath);

    try {
        // Get workspace statistics
        const stats = await sharedServices.getStats();
        console.log('Workspace Statistics:');
        console.log(`Database tables:`, stats.database.tableStats);
        console.log(`Cache hits: ${stats.cache.hitCount}, misses: ${stats.cache.missCount}`);
        console.log(`Cache hit rate: ${(stats.cache.hitRate * 100).toFixed(1)}%`);

        // Demonstrate completions
        const completionRequest: CompletionRequest = {
            uri: `file://${workspacePath}/src/index.ts`,
            position: { line: 5, character: 10 },
            maxResults: 10,
        };

        console.log('\nGetting intelligent completions...');
        const completions = await analyzer.getCompletions(completionRequest);

        console.log(`Found ${completions.data.length} completions:`);
        completions.data.forEach((completion) => {
            console.log(
                `  ${completion.label} (${completion.kind}) - confidence: ${(completion.confidence * 100).toFixed(0)}%`
            );
        });

        // Show system diagnostics
        const diagnostics = analyzer.getDiagnostics();
        console.log('\nSystem Diagnostics:');
        console.log(`Initialized: ${diagnostics.initialized}`);
        console.log(`Layer Manager Health: ${diagnostics.layerManager.initialized}`);
        console.log(`Shared Services Health: ${diagnostics.sharedServices.healthy}`);
    } finally {
        await analyzer.dispose();
    }
}

/**
 * Run all examples
 */
export async function runAllExamples(workspacePath?: string) {
    console.log('🚀 Running Unified Architecture Examples\n');

    try {
        await basicExample();
        await advancedExample();
        await monitoringExample();
        await errorHandlingExample();

        if (workspacePath) {
            await workspaceExample(workspacePath);
        }

        console.log('\n✅ All examples completed successfully!');
    } catch (error) {
        console.error('\n❌ Example failed:', error);
        throw error;
    }
}

// Run examples if this file is executed directly
if (import.meta.main) {
    const workspacePath = process.argv[2] || process.cwd();
    runAllExamples(workspacePath)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
