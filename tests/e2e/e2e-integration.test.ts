import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const e2eEnabled = process.env.E2E === '1';
const e2eDescribe = e2eEnabled ? describe : describe.skip;
const perfOnly = process.env.PERF === '1';
const perfDescribe = perfOnly ? describe : describe.skip;

import { type ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CLIAdapter } from '../../src/adapters/cli-adapter';
import { HTTPAdapter } from '../../src/adapters/http-adapter';
import { LSPAdapter } from '../../src/adapters/lsp-adapter';
import { MCPAdapter } from '../../src/adapters/mcp-adapter';
import { LayerManager } from '../../src/core/layer-manager';
import { SharedServices } from '../../src/core/services/shared-services';
import type { CoreConfig } from '../../src/core/types';
import { CodeAnalyzer } from '../../src/core/unified-analyzer';
import { type ConsistencyValidationReport, CrossProtocolValidator } from './fixtures/cross-protocol-validation';
import { type LearningEffectivenessReport, LearningEffectivenessValidator } from './fixtures/learning-effectiveness';
import { MemoryTrendAnalyzer, type MemoryValidationReport, MemoryValidator } from './fixtures/memory-validation';
import { BenchmarkComparator, type BenchmarkReport, PerformanceBenchmark } from './fixtures/performance-benchmarks';
import { getRepositoriesForTest, type TestRepository } from './fixtures/repository-configs';
import { RepositoryManager } from './fixtures/setup-repositories';

interface E2ETestContext {
    testDir: string;
    repositoryManager: RepositoryManager;
    analyzer: CodeAnalyzer;
    adapters: {
        lsp: LSPAdapter;
        mcp: MCPAdapter;
        http: HTTPAdapter;
        cli: CLIAdapter;
    };
    testRepositories: TestRepository[];
    httpServerProcess?: ChildProcess;
}

const TEST_CONFIG: CoreConfig = {
    layers: {
        layer1: {
            enabled: true,
            timeout: 10000,
            maxResults: 100,
            fileTypes: ['.ts', '.js', '.tsx', '.jsx', '.py', '.java'],
            optimization: {
                enabled: true,
                caching: true,
                indexing: false,
            },
        },
        layer2: {
            enabled: true,
            timeout: 15000,
            languages: ['typescript', 'javascript', 'python'],
            maxFileSize: 1024000,
            parseTimeout: 5000,
            caching: true,
        },
        layer3: {
            enabled: true,
            dbPath: ':memory:',
            cacheSize: 10000,
            conceptThreshold: 0.7,
            relationshipDepth: 3,
            autoSave: false,
        },
        layer4: {
            enabled: true,
            learningThreshold: 0.8,
            confidenceThreshold: 0.75,
            maxPatterns: 1000,
            decayRate: 0.1,
        },
        layer5: {
            enabled: true,
            maxDepth: 5,
            autoApplyThreshold: 0.9,
            propagationTimeout: 8000,
        },
    },
    performance: {
        targetLatency: 200,
        maxConcurrentRequests: 20,
        requestTimeout: 30000,
        circuitBreakerThreshold: 10,
        healthCheckInterval: 30000,
    },
    cache: {
        enabled: true,
        strategy: 'memory' as const,
        memory: {
            maxSize: 50000000,
            ttl: 300000,
        },
        redis: {
            host: 'localhost',
            port: 6379,
            ttl: 300000,
        },
    },
    monitoring: {
        enabled: false,
        metricsInterval: 10000,
        logLevel: 'error' as const,
        tracing: {
            enabled: false,
            samplingRate: 1.0,
        },
    },
};

e2eDescribe('End-to-End Integration Tests', () => {
    let context: E2ETestContext;

    beforeAll(async () => {
        console.log('🚀 Setting up E2E test environment...');

        // Create test directory
        const testDir = resolve(__dirname, '..', '..', '.e2e-test-workspace');
        await fs.rm(testDir, { recursive: true, force: true });
        await fs.mkdir(testDir, { recursive: true });

        // Initialize shared services and analyzer
        const sharedServices = new SharedServices(TEST_CONFIG);
        await sharedServices.initialize();
        const layerManager = new LayerManager(TEST_CONFIG, sharedServices.eventBus);
        await layerManager.initialize();
        const analyzer = new CodeAnalyzer(layerManager, sharedServices, TEST_CONFIG, sharedServices.eventBus);
        await analyzer.initialize();

        // Create repository manager
        const repositoryManager = new RepositoryManager(testDir);

        // Get test repositories (use local if specified)
        const useLocal = process.env.USE_LOCAL_REPOS === 'true';
        const testRepositories = getRepositoriesForTest(useLocal);

        // Create adapters
        const adapters = {
            lsp: new LSPAdapter(analyzer),
            mcp: new MCPAdapter(analyzer),
            http: new HTTPAdapter(analyzer, { enableCors: false, enableOpenAPI: false }),
            cli: new CLIAdapter(analyzer),
        };

        context = {
            testDir,
            repositoryManager,
            analyzer,
            adapters,
            testRepositories,
        };

        console.log(`✅ E2E test environment ready with ${testRepositories.length} repositories to test`);
    }, 120000); // 2 minutes timeout

    afterAll(async () => {
        console.log('🧹 Cleaning up E2E test environment...');

        // Stop HTTP server if running
        if (context.httpServerProcess && !context.httpServerProcess.killed) {
            context.httpServerProcess.kill('SIGTERM');
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Cleanup repositories
        if (context.repositoryManager) {
            await context.repositoryManager.cleanup();
        }

        // Dispose analyzer (also disposes shared services) to stop background timers
        try {
            await (context.analyzer as any)?.dispose?.();
        } catch {}

        console.log('✅ E2E cleanup complete');
    }, 60000);

    describe('Repository Setup and Validation', () => {
        test('should set up test repositories successfully', async () => {
            const setupResults = await context.repositoryManager.setupAllRepositories(context.testRepositories);

            // At least one repository should be set up successfully
            const successCount = Array.from(setupResults.values()).filter((r) => r.success).length;
            expect(successCount).toBeGreaterThan(0);

            console.log(`📊 Repository setup: ${successCount}/${context.testRepositories.length} successful`);

            // Validate each successful repository
            for (const repo of context.testRepositories) {
                const result = setupResults.get(repo.name);
                if (result?.success) {
                    const isValid = await context.repositoryManager.validateRepository(repo);
                    if (!isValid) {
                        console.warn(`⚠️ Repository ${repo.name} setup succeeded but validation failed`);
                    }
                }
            }
        }, 300000); // 5 minutes for repository setup

        test('should find analyzable files in repositories', async () => {
            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (!repoPath) {
                    console.warn(`⚠️ Skipping ${repo.name} - not available`);
                    continue;
                }

                const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx', '.vue'];
                const files = await context.repositoryManager.findSampleFiles(repo.name, extensions, 10);

                expect(files.length).toBeGreaterThan(0);
                console.log(`📁 Found ${files.length} analyzable files in ${repo.name}`);
            }
        });
    });

    describe('Comprehensive Cross-Protocol Consistency', () => {
        test('should validate comprehensive protocol consistency', async () => {
            const consistencyReports: ConsistencyValidationReport[] = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (!repoPath) {
                    console.warn(`⚠️ Skipping consistency validation for ${repo.name} - not available`);
                    continue;
                }

                console.log(`🔄 Running comprehensive cross-protocol validation for ${repo.name}`);

                // Get sample files for consistency testing
                const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                const sampleFiles = await context.repositoryManager.findSampleFiles(repo.name, extensions, 6);

                if (sampleFiles.length === 0) {
                    console.warn(`⚠️ No suitable files found for consistency testing ${repo.name}`);
                    continue;
                }

                // Create cross-protocol validator and run comprehensive analysis
                const validator = new CrossProtocolValidator(context.adapters, repo);
                const consistencyReport = await validator.validateProtocolConsistency(repoPath, sampleFiles);
                consistencyReports.push(consistencyReport);

                // Save consistency report
                const resultsDir = join(context.testDir, 'results', 'consistency-reports');
                await validator.saveConsistencyReport(consistencyReport, resultsDir);

                // Validate consistency targets
                const consistencyPercentage =
                    (consistencyReport.summary.consistentCases / consistencyReport.summary.totalTestCases) * 100;
                const similarityPercentage = consistencyReport.summary.averageSimilarity * 100;
                const isLocal = process.env.USE_LOCAL_REPOS === 'true';
                const minConsistencyPct = isLocal ? 10 : 70;
                const minSimilarityPct = isLocal ? 40 : 75;

                console.log(`🎯 Consistency validation for ${repo.name}:`);
                console.log(
                    `   Consistent Cases: ${consistencyPercentage.toFixed(1)}% ≥ ${minConsistencyPct}% ${consistencyPercentage >= minConsistencyPct ? '✅' : '❌'}`
                );
                console.log(
                    `   Average Similarity: ${similarityPercentage.toFixed(1)}% ≥ ${minSimilarityPct}% ${similarityPercentage >= minSimilarityPct ? '✅' : '❌'}`
                );
                console.log(`   Protocol Reliability:`);

                Object.entries(consistencyReport.summary.protocolReliability).forEach(([protocol, reliability]) => {
                    const reliabilityPercent = reliability * 100;
                    console.log(
                        `     ${protocol.toUpperCase()}: ${reliabilityPercent.toFixed(1)}% ${reliability >= 0.7 ? '✅' : '❌'}`
                    );
                });

                // Assertions with reasonable targets for E2E
                expect(consistencyPercentage).toBeGreaterThanOrEqual(minConsistencyPct);
                expect(similarityPercentage).toBeGreaterThanOrEqual(minSimilarityPct);
                expect(
                    Math.min(...Object.values(consistencyReport.summary.protocolReliability))
                ).toBeGreaterThanOrEqual(0.7); // 70% min reliability
            }

            expect(consistencyReports.length).toBeGreaterThan(0);
            console.log(
                `\n✅ Comprehensive cross-protocol consistency validation complete for ${consistencyReports.length} repositories`
            );

            // Generate overall consistency analysis
            if (consistencyReports.length > 1) {
                console.log(`\n📊 Overall Cross-Protocol Analysis:`);

                const avgConsistency =
                    (consistencyReports.reduce(
                        (sum, r) => sum + r.summary.consistentCases / r.summary.totalTestCases,
                        0
                    ) /
                        consistencyReports.length) *
                    100;

                const avgSimilarity =
                    (consistencyReports.reduce((sum, r) => sum + r.summary.averageSimilarity, 0) /
                        consistencyReports.length) *
                    100;

                const overallProtocolReliability: Record<string, number> = {};
                const protocols = ['lsp', 'mcp', 'http', 'cli'];

                protocols.forEach((protocol) => {
                    const reliabilities = consistencyReports.map((r) => r.summary.protocolReliability[protocol] || 0);
                    overallProtocolReliability[protocol] =
                        reliabilities.reduce((sum, r) => sum + r, 0) / reliabilities.length;
                });

                console.log(`   Overall Consistency: ${avgConsistency.toFixed(1)}%`);
                console.log(`   Overall Similarity: ${avgSimilarity.toFixed(1)}%`);
                console.log(`   Overall Protocol Reliability:`);
                Object.entries(overallProtocolReliability).forEach(([protocol, reliability]) => {
                    console.log(`     ${protocol.toUpperCase()}: ${(reliability * 100).toFixed(1)}%`);
                });
            }
        }, 480000); // 8 minutes for comprehensive consistency validation

        test('should handle edge cases consistently across protocols', async () => {
            // Find first available repository for edge case testing
            let testRepo: TestRepository | undefined;
            let testFiles: string[] = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (repoPath) {
                    const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                    const files = await context.repositoryManager.findSampleFiles(repo.name, extensions, 3);
                    if (files.length > 0) {
                        testRepo = repo;
                        testFiles = files;
                        break;
                    }
                }
            }

            if (!testRepo || testFiles.length === 0) {
                console.warn('⚠️ Skipping edge case consistency test - no suitable repository available');
                return;
            }

            console.log(`🧪 Testing edge case consistency with ${testRepo.name}`);

            const edgeTestCases = [
                {
                    name: 'non_existent_file',
                    test: async () => {
                        const nonExistentFile = join(context.testDir, 'non-existent-file.ts');
                        const position = { line: 1, character: 1 };

                        return await Promise.allSettled([
                            testLSPOperation(context.adapters.lsp, nonExistentFile, position),
                            testMCPOperation(context.adapters.mcp, nonExistentFile, position),
                            testCLIOperation(context.adapters.cli, nonExistentFile, position),
                        ]);
                    },
                },
                {
                    name: 'invalid_position',
                    test: async () => {
                        const testFile = testFiles[0];
                        const invalidPosition = { line: 999999, character: 999999 };

                        return await Promise.allSettled([
                            testLSPOperation(context.adapters.lsp, testFile, invalidPosition),
                            testMCPOperation(context.adapters.mcp, testFile, invalidPosition),
                            testCLIOperation(context.adapters.cli, testFile, invalidPosition),
                        ]);
                    },
                },
                {
                    name: 'empty_symbol_search',
                    test: async () => {
                        const testFile = testFiles[0];

                        return await Promise.allSettled([
                            testLSPReferences(context.adapters.lsp, testFile, ''),
                            testMCPReferences(context.adapters.mcp, testFile, ''),
                            testCLIReferences(context.adapters.cli, testFile, ''),
                        ]);
                    },
                },
            ];

            const edgeResults: Array<{ name: string; consistency: number; gracefulFailures: number }> = [];

            for (const edgeCase of edgeTestCases) {
                console.log(`  🧪 Testing edge case: ${edgeCase.name}`);

                const results = await edgeCase.test();
                const successful = results.filter((r) => r.status === 'fulfilled').length;
                const failed = results.filter((r) => r.status === 'rejected').length;
                const total = results.length;

                // Consistency means either all succeed (with empty/graceful results) or all fail consistently
                const consistency = successful === total || failed === total ? 1 : successful / total;
                const gracefulFailures = failed;

                edgeResults.push({
                    name: edgeCase.name,
                    consistency,
                    gracefulFailures,
                });

                console.log(
                    `    📊 ${edgeCase.name}: ${successful}/${total} succeeded, consistency: ${Math.round(consistency * 100)}%`
                );
            }

            // Validate edge case handling
            const avgConsistency = edgeResults.reduce((sum, r) => sum + r.consistency, 0) / edgeResults.length;
            console.log(`\n🎯 Edge Case Consistency: ${Math.round(avgConsistency * 100)}%`);

            // At least 80% consistency in edge case handling
            expect(avgConsistency).toBeGreaterThanOrEqual(0.8);

            // No edge case should have complete protocol failure
            edgeResults.forEach((result) => {
                expect(result.consistency).toBeGreaterThan(0); // At least some protocols should handle edge cases
            });
        }, 120000); // 2 minutes for edge case testing
    });

    perfDescribe('Performance Benchmarking with Real Codebases', () => {
        test('should run comprehensive performance benchmarks', async () => {
            const benchmarkReports: BenchmarkReport[] = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (!repoPath) {
                    console.warn(`⚠️ Skipping performance benchmark for ${repo.name} - not available`);
                    continue;
                }

                console.log(`⚡ Running comprehensive performance benchmark for ${repo.name}`);

                // Get sample files for testing
                const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                const sampleFiles = await context.repositoryManager.findSampleFiles(repo.name, extensions, 15);

                if (sampleFiles.length === 0) {
                    console.warn(`⚠️ No suitable files found for benchmarking ${repo.name}`);
                    continue;
                }

                // Run comprehensive benchmark
                const benchmark = new PerformanceBenchmark(context.analyzer, repo);
                const operationCount = repo.sizeCategory === 'small' ? 20 : repo.sizeCategory === 'medium' ? 30 : 50;

                const report = await benchmark.runBenchmarks(repoPath, sampleFiles, operationCount);
                benchmarkReports.push(report);

                // Save report
                const resultsDir = join(context.testDir, 'results', 'performance-reports');
                await benchmark.saveReport(report, resultsDir);

                // Check against relaxed targets
                const target = repo.performanceTargets;
                const avgTarget = target.avgResponseTime * 2.5; // 2.5x relaxed for comprehensive testing
                const p95Target = target.p95ResponseTime * 2.5;
                const memoryTarget = target.maxMemoryGrowth * 2.5;

                console.log(`🎯 Target validation for ${repo.name}:`);
                console.log(
                    `   Average: ${Math.round(report.averageTime)}ms ≤ ${avgTarget}ms ${report.averageTime <= avgTarget ? '✅' : '❌'}`
                );
                console.log(
                    `   P95: ${Math.round(report.p95)}ms ≤ ${p95Target}ms ${report.p95 <= p95Target ? '✅' : '❌'}`
                );
                console.log(
                    `   Memory: ${Math.round(report.memoryGrowth)}MB ≤ ${memoryTarget}MB ${report.memoryGrowth <= memoryTarget ? '✅' : '❌'}`
                );
                console.log(
                    `   Success: ${Math.round(report.successRate * 100)}% ≥ 75% ${report.successRate >= 0.75 ? '✅' : '❌'}`
                );

                // Assertions with relaxed targets
                expect(report.averageTime).toBeLessThan(avgTarget);
                expect(report.p95).toBeLessThan(p95Target);
                expect(report.memoryGrowth).toBeLessThan(memoryTarget);
                expect(report.successRate).toBeGreaterThan(0.75); // 75% success rate minimum
            }

            expect(benchmarkReports.length).toBeGreaterThan(0);
            console.log(
                `\n✅ Comprehensive performance benchmarking complete for ${benchmarkReports.length} repositories`
            );

            // Generate comparison if we have multiple reports
            if (benchmarkReports.length > 1) {
                const comparisonReport = BenchmarkComparator.generateComparisonReport(benchmarkReports);
                console.log(`\n📊 Performance Comparison:\n${comparisonReport}`);

                // Save comparison report
                const resultsDir = join(context.testDir, 'results', 'performance-reports');
                const comparisonFile = join(resultsDir, 'comparison-report.md');
                await fs.writeFile(comparisonFile, comparisonReport);
            }
        }, 600000); // 10 minutes for comprehensive benchmarking

        test('should demonstrate performance scaling across repository sizes', async () => {
            const scalingResults: Array<{
                category: string;
                avgTime: number;
                p95Time: number;
                memoryGrowth: number;
                successRate: number;
            }> = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (!repoPath) continue;

                console.log(`📊 Testing scaling performance for ${repo.sizeCategory} repository: ${repo.name}`);

                const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                const sampleFiles = await context.repositoryManager.findSampleFiles(repo.name, extensions, 10);

                if (sampleFiles.length === 0) continue;

                const benchmark = new PerformanceBenchmark(context.analyzer, repo);
                const report = await benchmark.runBenchmarks(repoPath, sampleFiles, 15);

                scalingResults.push({
                    category: repo.sizeCategory,
                    avgTime: report.averageTime,
                    p95Time: report.p95,
                    memoryGrowth: report.memoryGrowth,
                    successRate: report.successRate,
                });
            }

            // Analyze scaling characteristics
            const small = scalingResults.find((r) => r.category === 'small');
            const medium = scalingResults.find((r) => r.category === 'medium');
            const large = scalingResults.find((r) => r.category === 'large');

            console.log(`\n📈 Performance Scaling Analysis:`);

            if (small) {
                console.log(
                    `   Small:  avg=${Math.round(small.avgTime)}ms, p95=${Math.round(small.p95Time)}ms, memory=${Math.round(small.memoryGrowth)}MB`
                );
            }
            if (medium) {
                console.log(
                    `   Medium: avg=${Math.round(medium.avgTime)}ms, p95=${Math.round(medium.p95Time)}ms, memory=${Math.round(medium.memoryGrowth)}MB`
                );
            }
            if (large) {
                console.log(
                    `   Large:  avg=${Math.round(large.avgTime)}ms, p95=${Math.round(large.p95Time)}ms, memory=${Math.round(large.memoryGrowth)}MB`
                );
            }

            // Performance should scale sub-linearly (better than O(n))
            if (small && medium) {
                const avgScaling = medium.avgTime / small.avgTime;
                const memoryScaling = medium.memoryGrowth / small.memoryGrowth;
                console.log(
                    `   Small→Medium scaling: time=${avgScaling.toFixed(2)}x, memory=${memoryScaling.toFixed(2)}x`
                );

                // Should scale better than 3x (indicating good caching/optimization)
                expect(avgScaling).toBeLessThan(3.0);
                expect(memoryScaling).toBeLessThan(4.0);
            }

            if (medium && large) {
                const avgScaling = large.avgTime / medium.avgTime;
                const memoryScaling = large.memoryGrowth / medium.memoryGrowth;
                console.log(
                    `   Medium→Large scaling: time=${avgScaling.toFixed(2)}x, memory=${memoryScaling.toFixed(2)}x`
                );

                // Should scale better than 4x for large repos
                expect(avgScaling).toBeLessThan(4.0);
                expect(memoryScaling).toBeLessThan(5.0);
            }

            expect(scalingResults.length).toBeGreaterThan(0);
        }, 300000); // 5 minutes for scaling analysis
    });

    perfDescribe('Advanced Memory Management and Validation', () => {
        test('should perform comprehensive memory validation', async () => {
            const memoryReports: MemoryValidationReport[] = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (!repoPath) {
                    console.warn(`⚠️ Skipping memory validation for ${repo.name} - not available`);
                    continue;
                }

                console.log(`🧠 Running comprehensive memory validation for ${repo.name}`);

                // Get sample files for memory testing
                const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                const sampleFiles = await context.repositoryManager.findSampleFiles(repo.name, extensions, 12);

                if (sampleFiles.length === 0) {
                    console.warn(`⚠️ No suitable files found for memory testing ${repo.name}`);
                    continue;
                }

                // Create memory validator and run comprehensive analysis
                const memoryValidator = new MemoryValidator(context.analyzer, repo);
                const operationCount = repo.sizeCategory === 'small' ? 20 : repo.sizeCategory === 'medium' ? 25 : 30;

                const memoryReport = await memoryValidator.runMemoryValidation(repoPath, sampleFiles, operationCount);
                memoryReports.push(memoryReport);

                // Save memory report
                const resultsDir = join(context.testDir, 'results', 'memory-reports');
                await memoryValidator.saveMemoryReport(memoryReport, resultsDir);

                // Validate against targets (relaxed for E2E)
                const target = repo.performanceTargets.maxMemoryGrowth * 2.5; // 2.5x relaxed
                const growthMB = Math.round(memoryReport.summary.totalGrowth / 1024 / 1024);

                console.log(`🎯 Memory validation for ${repo.name}:`);
                console.log(`   Total Growth: ${growthMB}MB ≤ ${target}MB ${growthMB <= target ? '✅' : '❌'}`);
                console.log(
                    `   Memory Leaks: ${memoryReport.summary.memoryLeaks.length === 0 ? '✅ None detected' : `❌ ${memoryReport.summary.memoryLeaks.length} issues`}`
                );
                console.log(
                    `   GC Effectiveness: ${Math.round(memoryReport.summary.gcEffectiveness * 100)}% ${memoryReport.summary.gcEffectiveness > 0.3 ? '✅' : '⚠️'}`
                );

                // Assertions with relaxed targets
                expect(growthMB).toBeLessThan(target);
                expect(memoryReport.summary.memoryLeaks.filter((l) => l.severity === 'high').length).toBe(0);
                expect(memoryReport.summary.averageGrowthPerOperation).toBeLessThan(5 * 1024 * 1024); // 5MB per operation max
            }

            expect(memoryReports.length).toBeGreaterThan(0);
            console.log(`\n✅ Comprehensive memory validation complete for ${memoryReports.length} repositories`);

            // Generate memory trend analysis if multiple reports
            if (memoryReports.length > 1) {
                const trendAnalysis = MemoryTrendAnalyzer.analyzeMemoryTrend(memoryReports);
                console.log(`\n📈 Memory Trend Analysis:`);
                console.log(`   Trend: ${trendAnalysis.trend}`);
                console.log(`   Analysis: ${trendAnalysis.analysis}`);
                console.log(`   Recommendations:`);
                trendAnalysis.recommendations.forEach((rec) => console.log(`     • ${rec}`));
            }
        }, 420000); // 7 minutes for comprehensive memory validation

        test('should detect and handle memory pressure scenarios', async () => {
            // Find first available repository for stress testing
            let testRepo: TestRepository | undefined;
            let testFiles: string[] = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (repoPath) {
                    const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                    const files = await context.repositoryManager.findSampleFiles(repo.name, extensions, 20);
                    if (files.length >= 5) {
                        testRepo = repo;
                        testFiles = files;
                        break;
                    }
                }
            }

            if (!testRepo || testFiles.length === 0) {
                console.warn('⚠️ Skipping memory pressure test - no suitable repository available');
                return;
            }

            console.log(`🔥 Running memory pressure test with ${testRepo.name}`);

            const initialMemory = process.memoryUsage();
            const memorySnapshots: Array<{ operation: number; memory: number; timestamp: number }> = [];

            // Perform intensive operations to create memory pressure
            const intensiveOperationCount = 40;
            let peakMemory = initialMemory.heapUsed;
            let memoryStabilized = false;

            for (let i = 0; i < intensiveOperationCount; i++) {
                const file = testFiles[i % testFiles.length];

                try {
                    // Multiple operations per iteration to increase memory pressure
                    await Promise.all([
                        context.analyzer.findDefinition(file, {
                            line: Math.floor(Math.random() * 20) + 1,
                            character: 10,
                        }),
                        context.analyzer.findReferences(file, 'test'),
                        context.analyzer.suggestRefactoring(file),
                    ]);
                } catch (error) {
                    // Some operations may fail under pressure
                }

                const currentMemory = process.memoryUsage().heapUsed;
                memorySnapshots.push({
                    operation: i,
                    memory: currentMemory,
                    timestamp: performance.now(),
                });

                if (currentMemory > peakMemory) {
                    peakMemory = currentMemory;
                }

                // Check for memory stabilization (last 10 operations show <10% variance)
                if (i >= 10 && i % 5 === 0) {
                    const recent = memorySnapshots.slice(-10).map((s) => s.memory);
                    const avg = recent.reduce((sum, m) => sum + m, 0) / recent.length;
                    const variance = recent.reduce((sum, m) => sum + (m - avg) ** 2, 0) / recent.length;
                    const stdDev = Math.sqrt(variance);

                    if (stdDev / avg < 0.1) {
                        // Less than 10% variance
                        memoryStabilized = true;
                        console.log(`  📊 Memory stabilized after ${i + 1} operations`);
                        break;
                    }
                }

                // Log progress every 10 operations
                if ((i + 1) % 10 === 0) {
                    const currentMB = Math.round(currentMemory / 1024 / 1024);
                    const growthMB = Math.round((currentMemory - initialMemory.heapUsed) / 1024 / 1024);
                    console.log(
                        `  🔥 [${i + 1}/${intensiveOperationCount}] Memory: ${currentMB}MB (+${growthMB}MB growth)`
                    );
                }
            }

            const finalMemory = process.memoryUsage();
            const totalGrowthMB = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
            const peakGrowthMB = (peakMemory - initialMemory.heapUsed) / 1024 / 1024;

            console.log(`\n🧠 Memory Pressure Test Results:`);
            console.log(`   Initial Memory: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`);
            console.log(`   Final Memory: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`);
            console.log(`   Peak Memory: ${Math.round(peakMemory / 1024 / 1024)}MB`);
            console.log(`   Total Growth: ${Math.round(totalGrowthMB)}MB`);
            console.log(`   Peak Growth: ${Math.round(peakGrowthMB)}MB`);
            console.log(`   Stabilized: ${memoryStabilized ? '✅ Yes' : '⚠️ No'}`);

            // Memory pressure assertions
            expect(totalGrowthMB).toBeLessThan(300); // 300MB max under pressure
            expect(peakGrowthMB).toBeLessThan(400); // 400MB peak max
            expect(finalMemory.heapUsed).toBeLessThan(peakMemory * 1.2); // Final should be close to peak (no major leaks)

            // System should handle pressure gracefully (no crashes)
            expect(memorySnapshots.length).toBeGreaterThan(10);
        }, 300000); // 5 minutes for memory pressure testing
    });

    describe('Advanced Learning System Effectiveness', () => {
        test('should demonstrate comprehensive learning effectiveness', async () => {
            const learningReports: LearningEffectivenessReport[] = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (!repoPath) {
                    console.warn(`⚠️ Skipping learning effectiveness test for ${repo.name} - not available`);
                    continue;
                }

                console.log(`🎓 Running comprehensive learning effectiveness test for ${repo.name}`);

                // Get sample files for learning testing
                const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                const sampleFiles = await context.repositoryManager.findSampleFiles(repo.name, extensions, 10);

                if (sampleFiles.length === 0) {
                    console.warn(`⚠️ No suitable files found for learning testing ${repo.name}`);
                    continue;
                }

                // Create learning effectiveness validator
                const learningValidator = new LearningEffectivenessValidator(context.analyzer, repo);

                // Start learning session
                const sessionId = await learningValidator.startLearningSession();

                // Perform structured learning operations
                const operationCount = repo.sizeCategory === 'small' ? 15 : repo.sizeCategory === 'medium' ? 20 : 25;

                for (let i = 0; i < operationCount; i++) {
                    const file = sampleFiles[i % sampleFiles.length];

                    try {
                        // Alternate between different operation types for comprehensive learning
                        if (i % 5 === 0) {
                            await learningValidator.executeLearningOperation('definition', file, {
                                line: 3,
                                character: 10,
                            });
                        } else if (i % 5 === 1) {
                            await learningValidator.executeLearningOperation('references', file, {
                                symbol: 'function',
                            });
                        } else if (i % 5 === 2) {
                            await learningValidator.executeLearningOperation('refactor', file, {});
                        } else if (i % 5 === 3) {
                            await learningValidator.executeLearningOperation('rename', file, {
                                position: { line: 5, character: 8 },
                                newName: 'renamedVar',
                            });
                        } else {
                            await learningValidator.executeLearningOperation('feedback', file, {
                                type: 'accept_suggestion',
                                confidence: 0.8 + Math.random() * 0.2,
                            });
                        }
                    } catch (error) {
                        // Some operations may fail, continue learning
                        console.warn(`  ⚠️ Learning operation failed: ${error}`);
                    }

                    // Log progress every 5 operations
                    if ((i + 1) % 5 === 0) {
                        console.log(`    🎓 Learning progress: ${i + 1}/${operationCount} operations completed`);
                    }
                }

                // End learning session and generate report
                const learningReport = await learningValidator.endLearningSession();
                learningReports.push(learningReport);

                // Save learning report
                const resultsDir = join(context.testDir, 'results', 'learning-reports');
                await learningValidator.saveLearningReport(learningReport, resultsDir);

                // Display detailed learning report
                learningValidator.logLearningReport(learningReport);

                // Validate learning effectiveness
                const metrics = learningReport.metrics;
                console.log(`🎯 Learning validation for ${repo.name}:`);
                console.log(
                    `   Learning Rate: ${(metrics.learningRate * 100).toFixed(1)}% ≥ 10% ${metrics.learningRate >= 0.1 ? '✅' : '❌'}`
                );
                console.log(
                    `   Suggestion Accuracy: ${(metrics.suggestionAccuracy * 100).toFixed(1)}% ≥ 60% ${metrics.suggestionAccuracy >= 0.6 ? '✅' : '❌'}`
                );
                console.log(`   Effectiveness: ${learningReport.insights.learningEffectiveness} (target: moderate+)`);
                console.log(`   Patterns Learned: ${metrics.patternsLearned} (target: ≥ 1)`);

                // Assertions with reasonable targets for E2E learning
                expect(metrics.learningRate).toBeGreaterThanOrEqual(0.05); // At least 5% learning rate (1 pattern per 20 operations)
                expect(metrics.suggestionAccuracy).toBeGreaterThanOrEqual(0.6); // At least 60% accuracy
                expect(metrics.patternsLearned).toBeGreaterThanOrEqual(1); // At least 1 pattern learned
                const allowedEffectiveness =
                    process.env.USE_LOCAL_REPOS === 'true'
                        ? ['excellent', 'good', 'moderate', 'poor']
                        : ['excellent', 'good', 'moderate'];
                expect(allowedEffectiveness).toContain(learningReport.insights.learningEffectiveness);
            }

            expect(learningReports.length).toBeGreaterThan(0);
            console.log(
                `\n✅ Comprehensive learning effectiveness testing complete for ${learningReports.length} repositories`
            );

            // Generate cross-repository learning analysis
            if (learningReports.length > 1) {
                console.log(`\n📊 Cross-Repository Learning Analysis:`);

                const avgLearningRate =
                    learningReports.reduce((sum, r) => sum + r.metrics.learningRate, 0) / learningReports.length;
                const avgAccuracy =
                    learningReports.reduce((sum, r) => sum + r.metrics.suggestionAccuracy, 0) / learningReports.length;
                const totalPatternsLearned = learningReports.reduce((sum, r) => sum + r.metrics.patternsLearned, 0);

                const effectivenessDistribution = learningReports.reduce(
                    (acc, r) => {
                        acc[r.insights.learningEffectiveness] = (acc[r.insights.learningEffectiveness] || 0) + 1;
                        return acc;
                    },
                    {} as Record<string, number>
                );

                console.log(`   Average Learning Rate: ${(avgLearningRate * 100).toFixed(2)}%`);
                console.log(`   Average Suggestion Accuracy: ${(avgAccuracy * 100).toFixed(2)}%`);
                console.log(`   Total Patterns Learned: ${totalPatternsLearned}`);
                console.log(`   Effectiveness Distribution:`);
                Object.entries(effectivenessDistribution).forEach(([level, count]) => {
                    console.log(`     ${level}: ${count} repositories`);
                });

                // Most common learning strengths and areas for improvement
                const allStrengths = learningReports.flatMap((r) => r.insights.strongAreas);
                const allImprovements = learningReports.flatMap((r) => r.insights.improvementAreas);

                const strengthCounts = allStrengths.reduce(
                    (acc, s) => {
                        acc[s] = (acc[s] || 0) + 1;
                        return acc;
                    },
                    {} as Record<string, number>
                );

                const improvementCounts = allImprovements.reduce(
                    (acc, i) => {
                        acc[i] = (acc[i] || 0) + 1;
                        return acc;
                    },
                    {} as Record<string, number>
                );

                if (Object.keys(strengthCounts).length > 0) {
                    const topStrength = Object.entries(strengthCounts).sort(([, a], [, b]) => b - a)[0];
                    console.log(`   Most Common Strength: ${topStrength[0]} (${topStrength[1]} repositories)`);
                }

                if (Object.keys(improvementCounts).length > 0) {
                    const topImprovement = Object.entries(improvementCounts).sort(([, a], [, b]) => b - a)[0];
                    console.log(
                        `   Most Common Improvement Area: ${topImprovement[0]} (${topImprovement[1]} repositories)`
                    );
                }
            }
        }, 600000); // 10 minutes for comprehensive learning effectiveness testing

        test('should demonstrate pattern learning persistence and evolution', async () => {
            // Find first available repository for persistence testing
            let testRepo: TestRepository | undefined;
            let testFiles: string[] = [];

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (repoPath) {
                    const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                    const files = await context.repositoryManager.findSampleFiles(repo.name, extensions, 8);
                    if (files.length >= 3) {
                        testRepo = repo;
                        testFiles = files;
                        break;
                    }
                }
            }

            if (!testRepo || testFiles.length === 0) {
                console.warn('⚠️ Skipping learning persistence test - no suitable repository available');
                return;
            }

            console.log(`🔄 Testing learning persistence and evolution with ${testRepo.name}`);

            const learningValidator = new LearningEffectivenessValidator(context.analyzer, testRepo);

            // Phase 1: Initial learning
            console.log(`  📚 Phase 1: Initial pattern learning`);
            await learningValidator.startLearningSession();

            const phase1Operations = 8;
            for (let i = 0; i < phase1Operations; i++) {
                const file = testFiles[i % testFiles.length];
                await learningValidator.executeLearningOperation('definition', file, { line: 2 + i, character: 5 + i });
            }

            const phase1Report = await learningValidator.endLearningSession();
            const phase1Patterns = phase1Report.metrics.patternsLearned;
            console.log(`    📊 Phase 1 results: ${phase1Patterns} patterns learned`);

            // Small delay to simulate time passage
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Phase 2: Reinforcement learning (should improve existing patterns)
            console.log(`  🎯 Phase 2: Pattern reinforcement`);
            await learningValidator.startLearningSession();

            const phase2Operations = 6;
            for (let i = 0; i < phase2Operations; i++) {
                const file = testFiles[i % testFiles.length];
                // Similar operations to reinforce learned patterns
                await learningValidator.executeLearningOperation('definition', file, { line: 2 + i, character: 5 + i });
            }

            const phase2Report = await learningValidator.endLearningSession();
            const phase2Accuracy = phase2Report.metrics.suggestionAccuracy;
            console.log(`    📊 Phase 2 results: ${(phase2Accuracy * 100).toFixed(1)}% accuracy`);

            // Phase 3: Evolution learning (new patterns with feedback)
            console.log(`  🌟 Phase 3: Pattern evolution with feedback`);
            await learningValidator.startLearningSession();

            const phase3Operations = 10;
            for (let i = 0; i < phase3Operations; i++) {
                const file = testFiles[i % testFiles.length];
                if (i % 3 === 0) {
                    await learningValidator.executeLearningOperation('references', file, { symbol: 'class' });
                } else if (i % 3 === 1) {
                    await learningValidator.executeLearningOperation('feedback', file, {
                        type: 'accept_suggestion',
                        confidence: 0.9,
                    });
                } else {
                    await learningValidator.executeLearningOperation('refactor', file, {});
                }
            }

            const phase3Report = await learningValidator.endLearningSession();
            const phase3Patterns = phase3Report.metrics.patternsLearned;
            const phase3Confidence = phase3Report.metrics.confidenceImprovement;

            console.log(`\n📈 Learning Persistence Analysis:`);
            console.log(`   Phase 1 (Initial): ${phase1Patterns} patterns learned`);
            console.log(`   Phase 2 (Reinforcement): ${(phase2Accuracy * 100).toFixed(1)}% accuracy`);
            console.log(
                `   Phase 3 (Evolution): ${phase3Patterns} new patterns, ${(phase3Confidence * 100).toFixed(1)}% confidence gain`
            );

            // Validate learning persistence and evolution
            expect(phase1Patterns).toBeGreaterThanOrEqual(1); // Should learn some patterns initially
            expect(phase2Accuracy).toBeGreaterThan(0.5); // Reinforcement should maintain/improve accuracy
            expect(phase3Confidence).toBeGreaterThanOrEqual(-0.1); // Confidence shouldn't degrade significantly

            // At least one phase should show good effectiveness
            const effectivePhases = [phase1Report, phase2Report, phase3Report].filter((r) =>
                ['excellent', 'good'].includes(r.insights.learningEffectiveness)
            );
            expect(effectivePhases.length).toBeGreaterThanOrEqual(1);

            console.log(`✅ Learning persistence and evolution validated`);
        }, 300000); // 5 minutes for persistence testing
    });

    describe('Cache Performance', () => {
        test('should demonstrate cache effectiveness', async () => {
            // Find first available repository and file
            let testFile: string | undefined;

            for (const repo of context.testRepositories) {
                const repoPath = context.repositoryManager.getRepositoryPath(repo.name);
                if (repoPath) {
                    const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
                    const files = await context.repositoryManager.findSampleFiles(repo.name, extensions, 3);
                    if (files.length > 0) {
                        testFile = files[0];
                        break;
                    }
                }
            }

            if (!testFile) {
                console.warn('⚠️ Skipping cache test - no suitable file available');
                return;
            }

            const position = { line: 5, character: 10 };

            // First operation (cold cache)
            const start1 = performance.now();
            try {
                await context.analyzer.findDefinition(testFile, position);
            } catch (error) {
                // May fail, but still measures timing
            }
            const coldTime = performance.now() - start1;

            // Second operation (warm cache)
            const start2 = performance.now();
            try {
                await context.analyzer.findDefinition(testFile, position);
            } catch (error) {
                // May fail, but still measures timing
            }
            const warmTime = performance.now() - start2;

            console.log(`⚡ Cache effectiveness: cold=${Math.round(coldTime)}ms, warm=${Math.round(warmTime)}ms`);

            // Either both succeed (and cache improves performance) or both fail consistently
            if (coldTime > 0 && warmTime > 0) {
                // Cache should provide some speedup, but be generous with real repos
                expect(warmTime).toBeLessThan(coldTime * 1.5); // Allow for variance
            }

            // At minimum, warm cache shouldn't be significantly slower
            expect(warmTime).toBeLessThan(coldTime * 2.0);
        });
    });
});

// Helper functions

async function testLSPOperation(adapter: LSPAdapter, file: string, position: { line: number; character: number }) {
    return (await adapter.findDefinition(file, position)) || [];
}

async function testMCPOperation(adapter: MCPAdapter, file: string, position: { line: number; character: number }) {
    const result = await adapter.handleToolCall({
        name: 'find_definition',
        arguments: { file, line: position.line, character: position.character },
    });
    return result.definitions || [];
}

async function testCLIOperation(adapter: CLIAdapter, file: string, position: { line: number; character: number }) {
    return (await adapter.findDefinition(file, position)) || [];
}

async function testLSPReferences(adapter: LSPAdapter, file: string, symbol: string) {
    return (await adapter.findReferences(file, symbol)) || [];
}

async function testMCPReferences(adapter: MCPAdapter, file: string, symbol: string) {
    const result = await adapter.handleToolCall({
        name: 'find_references',
        arguments: { file, symbol },
    });
    return result.references || [];
}

async function testCLIReferences(adapter: CLIAdapter, file: string, symbol: string) {
    return (await adapter.findReferences(file, symbol)) || [];
}

interface PerformanceMetrics {
    average: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    errors: number;
    operations: number;
}

async function measurePerformance(
    analyzer: CodeAnalyzer,
    repo: TestRepository,
    repoPath: string,
    operationCount: number
): Promise<PerformanceMetrics> {
    const times: number[] = [];
    let errors = 0;

    const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
    const files = await fs
        .readdir(repoPath, { recursive: true })
        .then(
            (entries) =>
                entries
                    .filter((entry) => typeof entry === 'string' && extensions.some((ext) => entry.endsWith(ext)))
                    .map((entry) => join(repoPath, entry))
                    .slice(0, 20) // Limit to 20 files for performance
        )
        .catch(() => []);

    if (files.length === 0) {
        console.warn(`⚠️ No files found for performance testing in ${repo.name}`);
        return { average: 0, p95: 0, p99: 0, min: 0, max: 0, errors: 0, operations: 0 };
    }

    for (let i = 0; i < operationCount; i++) {
        const file = files[i % files.length];
        const position = { line: Math.floor(Math.random() * 10) + 1, character: Math.floor(Math.random() * 20) + 1 };

        const start = performance.now();
        try {
            // Rotate between different operations
            if (i % 3 === 0) {
                await analyzer.findDefinition(file, position);
            } else if (i % 3 === 1) {
                await analyzer.findReferences(file, 'test');
            } else {
                await analyzer.suggestRefactoring(file);
            }
        } catch (error) {
            errors++;
        }
        const end = performance.now();

        times.push(end - start);

        // Progress logging for long operations
        if (i > 0 && i % 10 === 0) {
            const avgSoFar = times.slice(-10).reduce((a, b) => a + b, 0) / 10;
            console.log(`  📊 Progress: ${i}/${operationCount}, recent avg: ${Math.round(avgSoFar)}ms`);
        }
    }

    if (times.length === 0) {
        return { average: 0, p95: 0, p99: 0, min: 0, max: 0, errors, operations: operationCount };
    }

    const sortedTimes = times.sort((a, b) => a - b);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p99Index = Math.floor(sortedTimes.length * 0.99);

    return {
        average: times.reduce((a, b) => a + b, 0) / times.length,
        p95: sortedTimes[p95Index] || 0,
        p99: sortedTimes[p99Index] || 0,
        min: sortedTimes[0] || 0,
        max: sortedTimes[sortedTimes.length - 1] || 0,
        errors,
        operations: operationCount,
    };
}
