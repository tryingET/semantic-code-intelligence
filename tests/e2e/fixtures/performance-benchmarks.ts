import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { CodeAnalyzer } from '../../../src/core/unified-analyzer';
import type { TestRepository } from './repository-configs';

export interface BenchmarkOperation {
    name: string;
    type: 'findDefinition' | 'findReferences' | 'rename' | 'suggestRefactoring' | 'completion';
    description: string;
    execute: (analyzer: CodeAnalyzer, file: string, context: any) => Promise<any>;
}

export interface BenchmarkResult {
    operation: string;
    file: string;
    duration: number;
    success: boolean;
    error?: string;
    metadata?: any;
}

export interface BenchmarkReport {
    repository: string;
    category: string;
    timestamp: string;
    totalOperations: number;
    successRate: number;
    averageTime: number;
    p50: number;
    p95: number;
    p99: number;
    minTime: number;
    maxTime: number;
    memoryGrowth: number;
    results: BenchmarkResult[];
    summary: {
        findDefinition: OperationSummary;
        findReferences: OperationSummary;
        rename: OperationSummary;
        suggestRefactoring: OperationSummary;
    };
}

export interface OperationSummary {
    count: number;
    successRate: number;
    avgTime: number;
    p95Time: number;
    errors: string[];
}

// Define benchmark operations
export const BENCHMARK_OPERATIONS: BenchmarkOperation[] = [
    {
        name: 'find_definition_import',
        type: 'findDefinition',
        description: 'Find definition of imported symbols',
        execute: async (analyzer, file, context) => {
            // Try common positions where imports are defined
            const positions = [
                { line: 1, character: 15 },
                { line: 2, character: 20 },
                { line: 3, character: 10 },
            ];
            for (const pos of positions) {
                try {
                    const result = await analyzer.findDefinition(file, pos);
                    if (result && result.length > 0) {
                        return result;
                    }
                } catch (error) {
                    // Continue to next position
                }
            }
            return [];
        },
    },
    {
        name: 'find_definition_function',
        type: 'findDefinition',
        description: 'Find definition of function calls',
        execute: async (analyzer, file, context) => {
            // Try positions common for function calls
            const positions = [
                { line: 10, character: 15 },
                { line: 15, character: 20 },
                { line: 20, character: 10 },
            ];
            for (const pos of positions) {
                try {
                    const result = await analyzer.findDefinition(file, pos);
                    if (result && result.length > 0) {
                        return result;
                    }
                } catch (error) {
                    // Continue
                }
            }
            return [];
        },
    },
    {
        name: 'find_references_common',
        type: 'findReferences',
        description: 'Find references to common symbols',
        execute: async (analyzer, file, context) => {
            const symbols = ['function', 'const', 'class', 'interface', 'export', 'import'];
            for (const symbol of symbols) {
                try {
                    const result = await analyzer.findReferences(file, symbol);
                    if (result && result.length > 0) {
                        return result;
                    }
                } catch (error) {
                    // Continue
                }
            }
            return [];
        },
    },
    {
        name: 'find_references_variable',
        type: 'findReferences',
        description: 'Find references to variables',
        execute: async (analyzer, file, context) => {
            const symbols = ['app', 'config', 'data', 'result', 'item', 'value'];
            for (const symbol of symbols) {
                try {
                    const result = await analyzer.findReferences(file, symbol);
                    if (result && result.length > 0) {
                        return result;
                    }
                } catch (error) {
                    // Continue
                }
            }
            return [];
        },
    },
    {
        name: 'suggest_refactoring',
        type: 'suggestRefactoring',
        description: 'Generate refactoring suggestions',
        execute: async (analyzer, file, context) => {
            return await analyzer.suggestRefactoring(file);
        },
    },
    {
        name: 'rename_variable',
        type: 'rename',
        description: 'Rename variable at common positions',
        execute: async (analyzer, file, context) => {
            const positions = [
                { line: 5, character: 10 },
                { line: 10, character: 15 },
                { line: 15, character: 5 },
            ];
            for (const pos of positions) {
                try {
                    const result = await analyzer.rename(file, pos, 'renamedVariable');
                    if (result && result.changes && result.changes.length > 0) {
                        return result;
                    }
                } catch (error) {
                    // Continue
                }
            }
            return { changes: [] };
        },
    },
];

export class PerformanceBenchmark {
    private results: BenchmarkResult[] = [];
    private startMemory: NodeJS.MemoryUsage;

    constructor(
        private analyzer: CodeAnalyzer,
        private repository: TestRepository
    ) {
        this.startMemory = process.memoryUsage();
    }

    async runBenchmarks(
        repositoryPath: string,
        sampleFiles: string[],
        operationCount: number = 50
    ): Promise<BenchmarkReport> {
        console.log(`🔥 Starting performance benchmark for ${this.repository.name}`);
        console.log(`📊 Running ${operationCount} operations across ${sampleFiles.length} files`);

        this.results = [];

        // Run benchmark operations
        for (let i = 0; i < operationCount; i++) {
            const file = sampleFiles[i % sampleFiles.length];
            const operation = BENCHMARK_OPERATIONS[i % BENCHMARK_OPERATIONS.length];

            console.log(`  🔍 [${i + 1}/${operationCount}] ${operation.name} on ${file.split('/').pop()}`);

            const startTime = performance.now();
            let result: any;
            let success = true;
            let error: string | undefined;

            try {
                result = await operation.execute(this.analyzer, file, {
                    operationIndex: i,
                    totalOperations: operationCount,
                });
            } catch (err) {
                success = false;
                error = err instanceof Error ? err.message : String(err);
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            this.results.push({
                operation: operation.name,
                file: file.split('/').pop() || file,
                duration,
                success,
                error,
                metadata: {
                    type: operation.type,
                    description: operation.description,
                    resultCount: Array.isArray(result)
                        ? result.length
                        : result?.changes
                          ? result.changes.length
                          : result
                            ? 1
                            : 0,
                },
            });

            // Log progress every 10 operations
            if ((i + 1) % 10 === 0) {
                const recentResults = this.results.slice(-10);
                const recentAvg = recentResults.reduce((sum, r) => sum + r.duration, 0) / 10;
                const recentSuccessRate = recentResults.filter((r) => r.success).length / 10;
                console.log(
                    `    📈 Recent 10 operations: avg=${Math.round(recentAvg)}ms, success=${Math.round(recentSuccessRate * 100)}%`
                );
            }
        }

        return this.generateReport();
    }

    private generateReport(): BenchmarkReport {
        const endMemory = process.memoryUsage();
        const memoryGrowth = (endMemory.heapUsed - this.startMemory.heapUsed) / 1024 / 1024;

        const successfulResults = this.results.filter((r) => r.success);
        const durations = successfulResults.map((r) => r.duration).sort((a, b) => a - b);

        const report: BenchmarkReport = {
            repository: this.repository.name,
            category: this.repository.sizeCategory,
            timestamp: new Date().toISOString(),
            totalOperations: this.results.length,
            successRate: successfulResults.length / this.results.length,
            averageTime: durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
            p50: durations[Math.floor(durations.length * 0.5)] || 0,
            p95: durations[Math.floor(durations.length * 0.95)] || 0,
            p99: durations[Math.floor(durations.length * 0.99)] || 0,
            minTime: durations[0] || 0,
            maxTime: durations[durations.length - 1] || 0,
            memoryGrowth,
            results: this.results,
            summary: {
                findDefinition: this.generateOperationSummary('findDefinition'),
                findReferences: this.generateOperationSummary('findReferences'),
                rename: this.generateOperationSummary('rename'),
                suggestRefactoring: this.generateOperationSummary('suggestRefactoring'),
            },
        };

        this.logReport(report);
        return report;
    }

    private generateOperationSummary(operationType: string): OperationSummary {
        const operationResults = this.results.filter((r) => r.metadata?.type === operationType);

        if (operationResults.length === 0) {
            return {
                count: 0,
                successRate: 0,
                avgTime: 0,
                p95Time: 0,
                errors: [],
            };
        }

        const successful = operationResults.filter((r) => r.success);
        const durations = successful.map((r) => r.duration).sort((a, b) => a - b);
        const errors = operationResults
            .filter((r) => !r.success && r.error)
            .map((r) => r.error!)
            .slice(0, 5); // Limit to first 5 errors

        return {
            count: operationResults.length,
            successRate: successful.length / operationResults.length,
            avgTime: durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
            p95Time: durations[Math.floor(durations.length * 0.95)] || 0,
            errors,
        };
    }

    private logReport(report: BenchmarkReport) {
        console.log(`\n📊 Performance Benchmark Results for ${report.repository}`);
        console.log(`═══════════════════════════════════════════════════════════`);
        console.log(`📈 Overall Performance:`);
        console.log(`   Total Operations: ${report.totalOperations}`);
        console.log(`   Success Rate: ${Math.round(report.successRate * 100)}%`);
        console.log(`   Average Time: ${Math.round(report.averageTime)}ms`);
        console.log(`   P95 Time: ${Math.round(report.p95)}ms`);
        console.log(`   P99 Time: ${Math.round(report.p99)}ms`);
        console.log(`   Memory Growth: ${Math.round(report.memoryGrowth)}MB`);
        console.log(``);
        console.log(`🔍 Operation Breakdown:`);

        Object.entries(report.summary).forEach(([operation, summary]) => {
            if (summary.count > 0) {
                console.log(`   ${operation}:`);
                console.log(`     Count: ${summary.count}`);
                console.log(`     Success: ${Math.round(summary.successRate * 100)}%`);
                console.log(`     Avg Time: ${Math.round(summary.avgTime)}ms`);
                console.log(`     P95 Time: ${Math.round(summary.p95Time)}ms`);
                if (summary.errors.length > 0) {
                    console.log(
                        `     Errors: ${summary.errors.slice(0, 2).join(', ')}${summary.errors.length > 2 ? '...' : ''}`
                    );
                }
            }
        });
        console.log(``);

        // Performance assessment
        const targets = this.repository.performanceTargets;
        const avgTarget = targets.avgResponseTime * 2; // 2x relaxed for E2E
        const p95Target = targets.p95ResponseTime * 2;
        const memoryTarget = targets.maxMemoryGrowth * 2;

        console.log(`🎯 Target Assessment (2x relaxed for E2E):`);
        console.log(
            `   Average Time: ${Math.round(report.averageTime)}ms / ${avgTarget}ms ${report.averageTime <= avgTarget ? '✅' : '❌'}`
        );
        console.log(
            `   P95 Time: ${Math.round(report.p95)}ms / ${p95Target}ms ${report.p95 <= p95Target ? '✅' : '❌'}`
        );
        console.log(
            `   Memory Growth: ${Math.round(report.memoryGrowth)}MB / ${memoryTarget}MB ${report.memoryGrowth <= memoryTarget ? '✅' : '❌'}`
        );
        console.log(
            `   Success Rate: ${Math.round(report.successRate * 100)}% / 80% ${report.successRate >= 0.8 ? '✅' : '❌'}`
        );
    }

    async saveReport(report: BenchmarkReport, outputPath: string) {
        await fs.mkdir(outputPath, { recursive: true });

        const reportFile = join(outputPath, `${report.repository}-${Date.now()}.json`);
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

        const latestFile = join(outputPath, 'latest.json');
        await fs.writeFile(latestFile, JSON.stringify(report, null, 2));

        console.log(`💾 Benchmark report saved to ${reportFile}`);
        return reportFile;
    }
}

export class BenchmarkComparator {
    static async compareReports(
        baselineReport: BenchmarkReport,
        currentReport: BenchmarkReport
    ): Promise<{
        regressions: string[];
        improvements: string[];
        summary: string;
    }> {
        const regressions: string[] = [];
        const improvements: string[] = [];

        // Compare average times
        const avgChange = ((currentReport.averageTime - baselineReport.averageTime) / baselineReport.averageTime) * 100;
        if (avgChange > 10) {
            regressions.push(
                `Average response time increased by ${Math.round(avgChange)}% (${Math.round(baselineReport.averageTime)}ms → ${Math.round(currentReport.averageTime)}ms)`
            );
        } else if (avgChange < -10) {
            improvements.push(
                `Average response time decreased by ${Math.round(Math.abs(avgChange))}% (${Math.round(baselineReport.averageTime)}ms → ${Math.round(currentReport.averageTime)}ms)`
            );
        }

        // Compare P95 times
        const p95Change = ((currentReport.p95 - baselineReport.p95) / baselineReport.p95) * 100;
        if (p95Change > 15) {
            regressions.push(
                `P95 response time increased by ${Math.round(p95Change)}% (${Math.round(baselineReport.p95)}ms → ${Math.round(currentReport.p95)}ms)`
            );
        } else if (p95Change < -15) {
            improvements.push(
                `P95 response time decreased by ${Math.round(Math.abs(p95Change))}% (${Math.round(baselineReport.p95)}ms → ${Math.round(currentReport.p95)}ms)`
            );
        }

        // Compare success rates
        const successRateChange = currentReport.successRate - baselineReport.successRate;
        if (successRateChange < -0.05) {
            regressions.push(
                `Success rate decreased by ${Math.round(Math.abs(successRateChange) * 100)}% (${Math.round(baselineReport.successRate * 100)}% → ${Math.round(currentReport.successRate * 100)}%)`
            );
        } else if (successRateChange > 0.05) {
            improvements.push(
                `Success rate increased by ${Math.round(successRateChange * 100)}% (${Math.round(baselineReport.successRate * 100)}% → ${Math.round(currentReport.successRate * 100)}%)`
            );
        }

        // Compare memory usage
        const memoryChange =
            ((currentReport.memoryGrowth - baselineReport.memoryGrowth) / baselineReport.memoryGrowth) * 100;
        if (memoryChange > 20) {
            regressions.push(
                `Memory growth increased by ${Math.round(memoryChange)}% (${Math.round(baselineReport.memoryGrowth)}MB → ${Math.round(currentReport.memoryGrowth)}MB)`
            );
        } else if (memoryChange < -20) {
            improvements.push(
                `Memory growth decreased by ${Math.round(Math.abs(memoryChange))}% (${Math.round(baselineReport.memoryGrowth)}MB → ${Math.round(currentReport.memoryGrowth)}MB)`
            );
        }

        const summary = `
Performance Comparison Summary:
- ${regressions.length} regressions detected
- ${improvements.length} improvements found
- Overall trend: ${regressions.length > improvements.length ? 'Performance degraded' : improvements.length > regressions.length ? 'Performance improved' : 'Performance stable'}
    `.trim();

        return { regressions, improvements, summary };
    }

    static generateComparisonReport(reports: BenchmarkReport[]): string {
        if (reports.length < 2) {
            return 'Not enough reports for comparison (need at least 2)';
        }

        const sortedReports = reports.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        let report = `# Performance Benchmark Comparison Report\n\n`;
        report += `Generated: ${new Date().toISOString()}\n`;
        report += `Reports analyzed: ${reports.length}\n\n`;

        // Overall trends
        const firstReport = sortedReports[0];
        const lastReport = sortedReports[sortedReports.length - 1];

        const avgTrend = ((lastReport.averageTime - firstReport.averageTime) / firstReport.averageTime) * 100;
        const p95Trend = ((lastReport.p95 - firstReport.p95) / firstReport.p95) * 100;
        const memoryTrend = ((lastReport.memoryGrowth - firstReport.memoryGrowth) / firstReport.memoryGrowth) * 100;

        report += `## Overall Trends\n\n`;
        report += `| Metric | First | Latest | Change |\n`;
        report += `|--------|-------|--------|--------|\n`;
        report += `| Average Time | ${Math.round(firstReport.averageTime)}ms | ${Math.round(lastReport.averageTime)}ms | ${avgTrend >= 0 ? '+' : ''}${Math.round(avgTrend)}% |\n`;
        report += `| P95 Time | ${Math.round(firstReport.p95)}ms | ${Math.round(lastReport.p95)}ms | ${p95Trend >= 0 ? '+' : ''}${Math.round(p95Trend)}% |\n`;
        report += `| Memory Growth | ${Math.round(firstReport.memoryGrowth)}MB | ${Math.round(lastReport.memoryGrowth)}MB | ${memoryTrend >= 0 ? '+' : ''}${Math.round(memoryTrend)}% |\n`;
        report += `| Success Rate | ${Math.round(firstReport.successRate * 100)}% | ${Math.round(lastReport.successRate * 100)}% | ${Math.round((lastReport.successRate - firstReport.successRate) * 100)}% |\n\n`;

        return report;
    }
}
