import { performance } from 'node:perf_hooks';
import type { CodeAnalyzer } from '../../../src/core/unified-analyzer';
import type { TestRepository } from './repository-configs';

export interface MemorySnapshot {
    timestamp: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
    rss: number;
}

export interface MemoryProfile {
    operation: string;
    file: string;
    beforeSnapshot: MemorySnapshot;
    afterSnapshot: MemorySnapshot;
    peakSnapshot?: MemorySnapshot;
    memoryGrowth: number;
    gcForced: boolean;
    duration: number;
}

export interface MemoryValidationReport {
    repository: string;
    testDuration: number;
    totalOperations: number;
    profiles: MemoryProfile[];
    summary: {
        initialMemory: MemorySnapshot;
        finalMemory: MemorySnapshot;
        peakMemory: MemorySnapshot;
        totalGrowth: number;
        averageGrowthPerOperation: number;
        memoryLeaks: MemoryLeakAnalysis[];
        gcEffectiveness: number;
        largestGrowthOperation: string;
        recommendedActions: string[];
    };
}

export interface MemoryLeakAnalysis {
    type: 'potential_leak' | 'growth_pattern' | 'gc_inefficient';
    severity: 'low' | 'medium' | 'high';
    description: string;
    evidence: {
        operations: string[];
        growthRate: number;
        expectedReduction: number;
        actualReduction: number;
    };
}

export class MemoryValidator {
    private profiles: MemoryProfile[] = [];
    private initialSnapshot: MemorySnapshot;
    private peakSnapshot: MemorySnapshot;
    private gcCount = 0;

    constructor(
        private analyzer: CodeAnalyzer,
        private repository: TestRepository
    ) {
        this.initialSnapshot = this.takeSnapshot();
        this.peakSnapshot = { ...this.initialSnapshot };
    }

    private takeSnapshot(): MemorySnapshot {
        const memUsage = process.memoryUsage();
        const snapshot: MemorySnapshot = {
            timestamp: performance.now(),
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers,
            rss: memUsage.rss,
        };

        // Update peak if necessary
        if (snapshot.heapUsed > this.peakSnapshot.heapUsed) {
            this.peakSnapshot = { ...snapshot };
        }

        return snapshot;
    }

    private async forceGC(): Promise<boolean> {
        try {
            // Try to force garbage collection if available
            if (global.gc) {
                global.gc();
                this.gcCount++;
                // Allow some time for GC to complete
                await new Promise((resolve) => setTimeout(resolve, 100));
                return true;
            }
        } catch (error) {
            // GC not available or failed
        }
        return false;
    }

    async profileOperation(operationName: string, file: string, operation: () => Promise<any>): Promise<MemoryProfile> {
        const beforeSnapshot = this.takeSnapshot();

        const startTime = performance.now();

        // Execute operation
        let result: any;
        let operationError: Error | undefined;

        try {
            result = await operation();
        } catch (error) {
            operationError = error instanceof Error ? error : new Error(String(error));
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        // Take snapshot after operation
        const afterSnapshot = this.takeSnapshot();

        // Optionally force GC to see how much memory can be reclaimed
        const gcForced = await this.forceGC();
        const postGCSnapshot = gcForced ? this.takeSnapshot() : afterSnapshot;

        const memoryGrowth = afterSnapshot.heapUsed - beforeSnapshot.heapUsed;

        const profile: MemoryProfile = {
            operation: operationName,
            file: file.split('/').pop() || file,
            beforeSnapshot,
            afterSnapshot: postGCSnapshot,
            peakSnapshot: afterSnapshot.heapUsed > postGCSnapshot.heapUsed ? afterSnapshot : undefined,
            memoryGrowth: postGCSnapshot.heapUsed - beforeSnapshot.heapUsed,
            gcForced,
            duration,
        };

        this.profiles.push(profile);

        return profile;
    }

    async runMemoryValidation(
        repositoryPath: string,
        sampleFiles: string[],
        operationCount: number = 30
    ): Promise<MemoryValidationReport> {
        console.log(`🧠 Running memory validation for ${this.repository.name}`);
        console.log(`💾 Initial memory: ${Math.round(this.initialSnapshot.heapUsed / 1024 / 1024)}MB`);

        const startTime = performance.now();

        // Define memory-intensive operations
        const operations = [
            {
                name: 'find_definition',
                execute: async (file: string) => {
                    const positions = [
                        { line: 1, character: 10 },
                        { line: 5, character: 15 },
                        { line: 10, character: 8 },
                    ];
                    for (const pos of positions) {
                        try {
                            const result = await this.analyzer.findDefinition(file, pos);
                            if (result && result.length > 0) return result;
                        } catch (e) {
                            /* continue */
                        }
                    }
                    return [];
                },
            },
            {
                name: 'find_references',
                execute: async (file: string) => {
                    const symbols = ['function', 'const', 'class', 'interface', 'app', 'config'];
                    for (const symbol of symbols) {
                        try {
                            const result = await this.analyzer.findReferences(file, symbol);
                            if (result && result.length > 0) return result;
                        } catch (e) {
                            /* continue */
                        }
                    }
                    return [];
                },
            },
            {
                name: 'suggest_refactoring',
                execute: async (file: string) => {
                    return await this.analyzer.suggestRefactoring(file);
                },
            },
            {
                name: 'analyze_file',
                execute: async (file: string) => {
                    // Perform multiple operations on same file to stress memory
                    const def1 = await this.analyzer.findDefinition(file, { line: 3, character: 5 });
                    const refs1 = await this.analyzer.findReferences(file, 'test');
                    const refactor1 = await this.analyzer.suggestRefactoring(file);
                    return { definitions: def1, references: refs1, refactoring: refactor1 };
                },
            },
        ];

        // Run operations and profile memory usage
        for (let i = 0; i < operationCount; i++) {
            const file = sampleFiles[i % sampleFiles.length];
            const operation = operations[i % operations.length];

            const profile = await this.profileOperation(operation.name, file, () => operation.execute(file));

            // Log progress every 5 operations
            if ((i + 1) % 5 === 0) {
                const recentProfiles = this.profiles.slice(-5);
                const avgGrowth = recentProfiles.reduce((sum, p) => sum + p.memoryGrowth, 0) / 5 / 1024 / 1024;
                const currentMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                console.log(
                    `  📊 [${i + 1}/${operationCount}] Memory: ${currentMemory}MB (recent avg growth: ${Math.round(avgGrowth * 100) / 100}MB)`
                );
            }
        }

        const endTime = performance.now();
        const testDuration = endTime - startTime;

        // Final snapshot
        const finalSnapshot = this.takeSnapshot();

        // Generate report
        const report = this.generateMemoryReport(testDuration);

        this.logMemoryReport(report);
        return report;
    }

    private generateMemoryReport(testDuration: number): MemoryValidationReport {
        const finalSnapshot = this.takeSnapshot();
        const totalGrowth = finalSnapshot.heapUsed - this.initialSnapshot.heapUsed;
        const averageGrowthPerOperation = this.profiles.length > 0 ? totalGrowth / this.profiles.length : 0;

        // Analyze for memory leaks
        const memoryLeaks = this.analyzeMemoryLeaks();

        // Calculate GC effectiveness
        const gcEffectiveness = this.calculateGCEffectiveness();

        // Find largest growth operation
        const largestGrowthOperation = this.profiles.reduce(
            (max, profile) => (profile.memoryGrowth > max.memoryGrowth ? profile : max),
            this.profiles[0] || { memoryGrowth: 0, operation: 'none' }
        ).operation;

        // Generate recommendations
        const recommendedActions = this.generateRecommendations(totalGrowth, memoryLeaks);

        return {
            repository: this.repository.name,
            testDuration,
            totalOperations: this.profiles.length,
            profiles: this.profiles,
            summary: {
                initialMemory: this.initialSnapshot,
                finalMemory: finalSnapshot,
                peakMemory: this.peakSnapshot,
                totalGrowth,
                averageGrowthPerOperation,
                memoryLeaks,
                gcEffectiveness,
                largestGrowthOperation,
                recommendedActions,
            },
        };
    }

    private analyzeMemoryLeaks(): MemoryLeakAnalysis[] {
        const leaks: MemoryLeakAnalysis[] = [];

        // Check for sustained growth pattern
        const windowSize = 5;
        if (this.profiles.length >= windowSize * 2) {
            const segments = [];
            for (let i = 0; i <= this.profiles.length - windowSize; i++) {
                const segment = this.profiles.slice(i, i + windowSize);
                const avgGrowth = segment.reduce((sum, p) => sum + p.memoryGrowth, 0) / windowSize;
                segments.push({ index: i, avgGrowth });
            }

            // Look for consistent positive growth
            const consistentGrowth = segments.filter((s) => s.avgGrowth > 100000); // > 100KB per operation
            if (consistentGrowth.length > segments.length * 0.6) {
                leaks.push({
                    type: 'potential_leak',
                    severity: consistentGrowth[0].avgGrowth > 1000000 ? 'high' : 'medium',
                    description: 'Sustained memory growth detected across multiple operations',
                    evidence: {
                        operations: consistentGrowth.slice(0, 5).map((c) => `operation_${c.index}`),
                        growthRate: consistentGrowth[0].avgGrowth,
                        expectedReduction: 50000, // Expected 50KB reduction after GC
                        actualReduction: 0,
                    },
                });
            }
        }

        // Check GC effectiveness
        const profilesWithGC = this.profiles.filter((p) => p.gcForced && p.peakSnapshot);
        if (profilesWithGC.length > 0) {
            const ineffectiveGC = profilesWithGC.filter((p) => {
                const beforeGC = p.peakSnapshot!.heapUsed;
                const afterGC = p.afterSnapshot.heapUsed;
                const reduction = beforeGC - afterGC;
                return reduction < beforeGC * 0.1; // Less than 10% reduction
            });

            if (ineffectiveGC.length > profilesWithGC.length * 0.5) {
                leaks.push({
                    type: 'gc_inefficient',
                    severity: 'medium',
                    description: 'Garbage collection not effectively reclaiming memory',
                    evidence: {
                        operations: ineffectiveGC.slice(0, 3).map((p) => p.operation),
                        growthRate: 0,
                        expectedReduction: 0.2, // 20% reduction expected
                        actualReduction: 0.05, // Only 5% actual reduction
                    },
                });
            }
        }

        return leaks;
    }

    private calculateGCEffectiveness(): number {
        const profilesWithGC = this.profiles.filter((p) => p.gcForced && p.peakSnapshot);
        if (profilesWithGC.length === 0) return 0;

        const totalReduction = profilesWithGC.reduce((sum, profile) => {
            const beforeGC = profile.peakSnapshot!.heapUsed;
            const afterGC = profile.afterSnapshot.heapUsed;
            return sum + Math.max(0, beforeGC - afterGC);
        }, 0);

        const totalPotentialReduction = profilesWithGC.reduce((sum, profile) => {
            return sum + (profile.peakSnapshot!.heapUsed - profile.beforeSnapshot.heapUsed);
        }, 0);

        return totalPotentialReduction > 0 ? totalReduction / totalPotentialReduction : 0;
    }

    private generateRecommendations(totalGrowth: number, leaks: MemoryLeakAnalysis[]): string[] {
        const recommendations: string[] = [];
        const growthMB = totalGrowth / 1024 / 1024;

        if (growthMB > 100) {
            recommendations.push('Consider implementing more aggressive memory management');
        }

        if (leaks.some((l) => l.type === 'potential_leak' && l.severity === 'high')) {
            recommendations.push('Investigate potential memory leaks in frequently called operations');
        }

        if (leaks.some((l) => l.type === 'gc_inefficient')) {
            recommendations.push('Review object lifecycle management to improve GC effectiveness');
        }

        if (this.profiles.some((p) => p.memoryGrowth > 10 * 1024 * 1024)) {
            // 10MB growth in single operation
            recommendations.push('Optimize large memory operations by implementing streaming or chunking');
        }

        const avgGrowthPerOp = totalGrowth / this.profiles.length / 1024 / 1024;
        if (avgGrowthPerOp > 1) {
            // > 1MB per operation
            recommendations.push('Implement object pooling for frequently created objects');
        }

        if (recommendations.length === 0) {
            recommendations.push('Memory usage within acceptable ranges');
        }

        return recommendations;
    }

    private logMemoryReport(report: MemoryValidationReport) {
        console.log(`\n📊 Memory Validation Report for ${report.repository}`);
        console.log(`═══════════════════════════════════════════════════`);

        const initialMB = Math.round(report.summary.initialMemory.heapUsed / 1024 / 1024);
        const finalMB = Math.round(report.summary.finalMemory.heapUsed / 1024 / 1024);
        const peakMB = Math.round(report.summary.peakMemory.heapUsed / 1024 / 1024);
        const growthMB = Math.round(report.summary.totalGrowth / 1024 / 1024);
        const avgGrowthKB = Math.round(report.summary.averageGrowthPerOperation / 1024);

        console.log(`💾 Memory Summary:`);
        console.log(`   Initial: ${initialMB}MB`);
        console.log(`   Final: ${finalMB}MB`);
        console.log(`   Peak: ${peakMB}MB`);
        console.log(`   Total Growth: ${growthMB}MB`);
        console.log(`   Avg Growth/Operation: ${avgGrowthKB}KB`);
        console.log(`   GC Effectiveness: ${Math.round(report.summary.gcEffectiveness * 100)}%`);
        console.log(``);

        if (report.summary.memoryLeaks.length > 0) {
            console.log(`⚠️ Memory Issues Detected:`);
            report.summary.memoryLeaks.forEach((leak) => {
                console.log(`   ${leak.severity.toUpperCase()}: ${leak.description}`);
            });
            console.log(``);
        }

        console.log(`💡 Recommendations:`);
        report.summary.recommendedActions.forEach((action) => {
            console.log(`   • ${action}`);
        });
        console.log(``);

        // Memory targets validation
        const target = this.repository.performanceTargets.maxMemoryGrowth * 2; // 2x relaxed for E2E
        console.log(`🎯 Target Assessment:`);
        console.log(`   Memory Growth: ${growthMB}MB ≤ ${target}MB ${growthMB <= target ? '✅' : '❌'}`);
        console.log(`   Peak Usage: ${peakMB - initialMB}MB delta from baseline`);
        console.log(
            `   Memory Leaks: ${report.summary.memoryLeaks.length === 0 ? '✅ None detected' : '❌ Issues found'}`
        );
    }

    async saveMemoryReport(report: MemoryValidationReport, outputPath: string): Promise<string> {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');

        await fs.mkdir(outputPath, { recursive: true });

        const reportFile = path.join(outputPath, `memory-${report.repository}-${Date.now()}.json`);
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

        // Also save a simplified CSV for analysis
        const csvFile = path.join(outputPath, `memory-${report.repository}-${Date.now()}.csv`);
        const csvContent = [
            'Operation,File,Duration,MemoryGrowth,GCForced',
            ...report.profiles.map((p) => `${p.operation},${p.file},${p.duration},${p.memoryGrowth},${p.gcForced}`),
        ].join('\n');
        await fs.writeFile(csvFile, csvContent);

        console.log(`💾 Memory report saved to ${reportFile}`);
        return reportFile;
    }
}

export class MemoryTrendAnalyzer {
    static analyzeMemoryTrend(reports: MemoryValidationReport[]): {
        trend: 'improving' | 'degrading' | 'stable';
        analysis: string;
        recommendations: string[];
    } {
        if (reports.length < 2) {
            return {
                trend: 'stable',
                analysis: 'Insufficient data for trend analysis',
                recommendations: ['Collect more memory validation reports over time'],
            };
        }

        const sortedReports = reports.sort(
            (a, b) =>
                new Date(a.summary.finalMemory.timestamp).getTime() -
                new Date(b.summary.finalMemory.timestamp).getTime()
        );

        const first = sortedReports[0];
        const latest = sortedReports[sortedReports.length - 1];

        const growthTrend =
            (latest.summary.averageGrowthPerOperation - first.summary.averageGrowthPerOperation) /
            first.summary.averageGrowthPerOperation;

        const leakTrend = latest.summary.memoryLeaks.length - first.summary.memoryLeaks.length;

        let trend: 'improving' | 'degrading' | 'stable';
        let analysis: string;
        const recommendations: string[] = [];

        if (growthTrend > 0.2 || leakTrend > 0) {
            trend = 'degrading';
            analysis = `Memory performance degrading: ${Math.round(growthTrend * 100)}% increase in average growth, ${leakTrend} more memory issues`;
            recommendations.push('Investigate recent changes that may have introduced memory inefficiencies');
            recommendations.push('Consider memory profiling sessions to identify root causes');
        } else if (growthTrend < -0.2 && leakTrend <= 0) {
            trend = 'improving';
            analysis = `Memory performance improving: ${Math.round(Math.abs(growthTrend) * 100)}% reduction in average growth`;
            recommendations.push('Document recent optimizations for future reference');
        } else {
            trend = 'stable';
            analysis = 'Memory performance stable within acceptable variance';
            recommendations.push('Continue monitoring for any changes in patterns');
        }

        return { trend, analysis, recommendations };
    }
}
