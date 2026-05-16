/**
 * Tool Comparison Benchmark Suite
 *
 * Comprehensive performance benchmarks comparing:
 * 1. Claude's Grep/Glob/LS tools (via function calls)
 * 2. Enhanced tools (our implementations)
 * 3. Native implementations (ripgrep, fast-glob, fs.readdir)
 *
 * Each test runs 100 iterations for statistical significance
 */

import { afterAll, beforeAll, describe, test } from 'bun:test';

const perfOnly = process.env.PERF === '1';
const perfDescribe = perfOnly ? describe : describe.skip;

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { glob } from 'glob';
import { EnhancedGlob, EnhancedGrep, EnhancedLS } from '../../src/layers/enhanced-search-tools';

// Interface for Claude tools - these would be the actual Claude function calls
interface ClaudeToolResults {
    grep: (pattern: string, options?: any) => Promise<any>;
    glob: (pattern: string, options?: any) => Promise<any>;
    ls: (path: string, options?: any) => Promise<any>;
}

// Mock Claude tools that simulate calling the actual Claude functions
// In real implementation, these would be the actual function calls to Claude
class MockClaudeTools implements ClaudeToolResults {
    async grep(pattern: string, options: any = {}) {
        // Simulate Claude Grep call latency and processing
        await this.simulateClaudeLatency(30, 80); // 30-80ms typical latency

        const { path: searchPath = '.', outputMode = 'files_with_matches' } = options;

        // For benchmark purposes, use ripgrep but add Claude's processing overhead
        try {
            const args = [
                pattern,
                searchPath,
                '--files-with-matches',
                ...(options.caseInsensitive ? ['--ignore-case'] : []),
                ...(options.type ? [`--type=${options.type}`] : []),
            ];

            const result = execSync(`rg ${args.join(' ')}`, {
                encoding: 'utf8',
                timeout: 10000,
                cwd: process.cwd(),
            })
                .split('\n')
                .filter(Boolean);

            return outputMode === 'files_with_matches' ? result : result.length;
        } catch (error) {
            return [];
        }
    }

    async glob(pattern: string, options: any = {}) {
        // Simulate Claude Glob call latency
        await this.simulateClaudeLatency(20, 60);

        const { path: searchPath = '.' } = options;
        const fullPattern = path.join(searchPath, pattern);

        try {
            const files = await glob(fullPattern, {
                ignore: options.ignore || [],
                follow: options.followSymlinks || false,
                maxDepth: options.maxDepth,
            });

            return { files };
        } catch (error) {
            return { files: [] };
        }
    }

    async ls(dirPath: string, options: any = {}) {
        // Simulate Claude LS call latency
        await this.simulateClaudeLatency(15, 50);

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            return entries.map((entry) => ({
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file',
                path: path.join(dirPath, entry.name),
            }));
        } catch (error) {
            return [];
        }
    }

    private async simulateClaudeLatency(min: number, max: number) {
        const delay = min + Math.random() * (max - min);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
}

// Native implementations for comparison
class NativeTools {
    static async grep(pattern: string, options: any = {}) {
        const { path: searchPath = '.', outputMode = 'files_with_matches' } = options;

        try {
            const args = [
                pattern,
                searchPath,
                '--files-with-matches',
                ...(options.caseInsensitive ? ['--ignore-case'] : []),
                ...(options.type ? [`--type=${options.type}`] : []),
            ];

            const result = execSync(`rg ${args.join(' ')}`, {
                encoding: 'utf8',
                timeout: 10000,
                cwd: process.cwd(),
            })
                .split('\n')
                .filter(Boolean);

            return outputMode === 'files_with_matches' ? result : result.length;
        } catch (error) {
            return [];
        }
    }

    static async silverSearcher(pattern: string, options: any = {}) {
        const { path: searchPath = '.', outputMode = 'files_with_matches' } = options;

        try {
            const args = [
                ...(options.caseInsensitive ? ['--ignore-case'] : []),
                ...(outputMode === 'files_with_matches' ? ['--files-with-matches'] : []),
                ...(options.type ? [`--${options.type}`] : []),
                '--nocolor',
                '--nogroup',
                pattern,
                searchPath,
            ];

            const result = execSync(`ag ${args.join(' ')}`, {
                encoding: 'utf8',
                timeout: 10000,
                cwd: process.cwd(),
            })
                .split('\n')
                .filter(Boolean);

            return outputMode === 'files_with_matches' ? result : result.length;
        } catch (error) {
            return [];
        }
    }

    static async glob(pattern: string, options: any = {}) {
        const { path: searchPath = '.' } = options;
        const fullPattern = path.join(searchPath, pattern);

        try {
            const files = await glob(fullPattern, {
                ignore: options.ignore || [],
                follow: options.followSymlinks || false,
                maxDepth: options.maxDepth,
            });

            return { files };
        } catch (error) {
            return { files: [] };
        }
    }

    static async ls(dirPath: string, options: any = {}) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const results = [];

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                let stats = null;

                try {
                    stats = await fs.stat(fullPath);
                } catch (e) {
                    // Skip files we can't stat
                    continue;
                }

                results.push({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    path: fullPath,
                    size: stats.size,
                    modified: stats.mtime,
                });
            }

            return results;
        } catch (error) {
            return [];
        }
    }
}

// Benchmark utilities
interface BenchmarkResult {
    toolName: string;
    testName: string;
    iterations: number;
    totalTime: number;
    averageTime: number;
    minTime: number;
    maxTime: number;
    standardDeviation: number;
    memoryUsage?: number;
    cacheHitRate?: number;
    errorRate: number;
}

class BenchmarkRunner {
    private results: BenchmarkResult[] = [];

    async runBenchmark<T>(
        toolName: string,
        testName: string,
        testFunction: () => Promise<T>,
        iterations: number = 100
    ): Promise<BenchmarkResult> {
        console.log(`\n🏃 Running ${toolName} - ${testName} (${iterations} iterations)...`);

        const times: number[] = [];
        let errors = 0;
        let memoryUsage = 0;

        // Warm up
        try {
            await testFunction();
        } catch (e) {
            // Ignore warmup errors
        }

        for (let i = 0; i < iterations; i++) {
            // Force garbage collection if available
            if ((global as any).gc) {
                (global as any).gc();
            }

            const startMemory = process.memoryUsage();
            const startTime = performance.now();

            try {
                await testFunction();
                const endTime = performance.now();
                times.push(endTime - startTime);
            } catch (error) {
                errors++;
                times.push(0); // Don't count failed attempts in timing
            }

            const endMemory = process.memoryUsage();
            memoryUsage += endMemory.heapUsed - startMemory.heapUsed;

            // Progress indicator
            if ((i + 1) % 20 === 0) {
                process.stdout.write('.');
            }
        }

        const validTimes = times.filter((t) => t > 0);
        const totalTime = validTimes.reduce((sum, time) => sum + time, 0);
        const averageTime = totalTime / validTimes.length;
        const minTime = Math.min(...validTimes);
        const maxTime = Math.max(...validTimes);

        // Calculate standard deviation
        const variance = validTimes.reduce((sum, time) => sum + (time - averageTime) ** 2, 0) / validTimes.length;
        const standardDeviation = Math.sqrt(variance);

        const result: BenchmarkResult = {
            toolName,
            testName,
            iterations,
            totalTime,
            averageTime: Number(averageTime.toFixed(2)),
            minTime: Number(minTime.toFixed(2)),
            maxTime: Number(maxTime.toFixed(2)),
            standardDeviation: Number(standardDeviation.toFixed(2)),
            memoryUsage: Math.round(memoryUsage / iterations),
            errorRate: Number(((errors / iterations) * 100).toFixed(1)),
        };

        this.results.push(result);
        console.log(` ✅ Completed - Avg: ${result.averageTime}ms`);

        return result;
    }

    getResults(): BenchmarkResult[] {
        return this.results;
    }

    printComparisonTable(testName: string) {
        const testResults = this.results.filter((r) => r.testName === testName);
        if (testResults.length === 0) return;

        console.log(`\n📊 ${testName.toUpperCase()} PERFORMANCE COMPARISON`);
        console.log(
            '┌' +
                '─'.repeat(18) +
                '┬' +
                '─'.repeat(13) +
                '┬' +
                '─'.repeat(13) +
                '┬' +
                '─'.repeat(13) +
                '┬' +
                '─'.repeat(10) +
                '┐'
        );
        console.log('│ Tool Name        │ Avg Time    │ Min Time    │ Max Time    │ Winner   │');
        console.log(
            '├' +
                '─'.repeat(18) +
                '┼' +
                '─'.repeat(13) +
                '┼' +
                '─'.repeat(13) +
                '┼' +
                '─'.repeat(13) +
                '┼' +
                '─'.repeat(10) +
                '┤'
        );

        // Find winner (lowest average time)
        const winner = testResults.reduce((min, result) => (result.averageTime < min.averageTime ? result : min));

        testResults.forEach((result) => {
            const isWinner = result === winner ? ' ⭐' : '   ';
            console.log(
                `│ ${result.toolName.padEnd(16)} │ ${(result.averageTime + 'ms').padEnd(11)} │ ` +
                    `${(result.minTime + 'ms').padEnd(11)} │ ${(result.maxTime + 'ms').padEnd(11)} │ ${isWinner.padEnd(8)} │`
            );
        });

        console.log(
            '└' +
                '─'.repeat(18) +
                '┴' +
                '─'.repeat(13) +
                '┴' +
                '─'.repeat(13) +
                '┴' +
                '─'.repeat(13) +
                '┴' +
                '─'.repeat(10) +
                '┘'
        );

        // Print additional metrics
        console.log('\n📈 Additional Metrics:');
        testResults.forEach((result) => {
            console.log(`${result.toolName}:`);
            console.log(`  - Standard Deviation: ${result.standardDeviation}ms`);
            console.log(`  - Memory Usage: ${(result.memoryUsage || 0) / 1024}KB`);
            console.log(`  - Error Rate: ${result.errorRate}%`);
        });
    }

    printSummaryReport() {
        console.log('\n🎯 BENCHMARK SUMMARY REPORT');
        console.log('=' + '='.repeat(80));

        const testNames = [...new Set(this.results.map((r) => r.testName))];

        testNames.forEach((testName) => {
            this.printComparisonTable(testName);
        });

        // Overall performance summary
        console.log('\n🏆 OVERALL WINNERS BY CATEGORY:');
        testNames.forEach((testName) => {
            const testResults = this.results.filter((r) => r.testName === testName);
            const winner = testResults.reduce((min, result) => (result.averageTime < min.averageTime ? result : min));
            console.log(`  ${testName}: ${winner.toolName} (${winner.averageTime}ms avg)`);
        });
    }
}

// Test data preparation
class TestDataPreparation {
    static async createTestFiles() {
        const testDir = path.join(process.cwd(), 'temp-benchmark-files');

        try {
            await fs.mkdir(testDir, { recursive: true });

            // Create various test files
            await fs.writeFile(path.join(testDir, 'small.txt'), "function test() { return 'hello'; }");
            await fs.writeFile(
                path.join(testDir, 'medium.js'),
                `
function complexFunction() {
  const data = { key: 'value' }
  async function asyncOperation() {
    return new Promise(resolve => {
      setTimeout(() => resolve(data), 100)
    })
  }
  return asyncOperation()
}
`.repeat(50)
            ); // ~50KB file

            // Create large file
            const largeContent = `
export class LargeClass {
  private data: string[] = []
  
  async processData() {
    for (let i = 0; i < 1000; i++) {
      this.data.push(\`Item \${i}\`)
    }
    return this.data
  }
}
`.repeat(500); // ~500KB file

            await fs.writeFile(path.join(testDir, 'large.ts'), largeContent);

            // Create nested directories
            await fs.mkdir(path.join(testDir, 'nested', 'deep', 'deeper'), { recursive: true });
            await fs.writeFile(path.join(testDir, 'nested', 'index.js'), "console.log('nested')");
            await fs.writeFile(path.join(testDir, 'nested', 'deep', 'component.tsx'), '<div>React Component</div>');
            await fs.writeFile(path.join(testDir, 'nested', 'deep', 'deeper', 'util.py'), 'def helper(): pass');

            // Create many small files for glob testing
            for (let i = 0; i < 100; i++) {
                await fs.writeFile(path.join(testDir, `file${i}.txt`), `Content ${i}`);
            }

            console.log(`📁 Test data created in ${testDir}`);
            return testDir;
        } catch (error) {
            console.error('Failed to create test files:', error);
            return null;
        }
    }

    static async cleanupTestFiles() {
        const testDir = path.join(process.cwd(), 'temp-benchmark-files');
        try {
            await fs.rm(testDir, { recursive: true, force: true });
            console.log('🧹 Test files cleaned up');
        } catch (error) {
            console.warn('Warning: Could not clean up test files:', error);
        }
    }
}

// Main benchmark suite
perfDescribe('Tool Performance Benchmarks', () => {
    let benchmarkRunner: BenchmarkRunner;
    let claudeTools: ClaudeToolResults;
    let enhancedGrep: EnhancedGrep;
    let enhancedGlob: EnhancedGlob;
    let enhancedLS: EnhancedLS;
    let testDir: string | null;

    beforeAll(async () => {
        console.log('🚀 Starting Tool Performance Benchmarks');
        console.log('=' + '='.repeat(80));

        benchmarkRunner = new BenchmarkRunner();
        claudeTools = new MockClaudeTools();
        enhancedGrep = new EnhancedGrep();
        enhancedGlob = new EnhancedGlob();
        enhancedLS = new EnhancedLS();

        // Create test data
        testDir = await TestDataPreparation.createTestFiles();
    });

    afterAll(async () => {
        await TestDataPreparation.cleanupTestFiles();
        benchmarkRunner.printSummaryReport();
    });

    describe('Grep Performance Benchmarks', () => {
        test('Simple pattern search', async () => {
            const pattern = 'function';
            const options = { path: testDir || '.', outputMode: 'files_with_matches' };

            // Claude Grep
            await benchmarkRunner.runBenchmark('Claude Grep', 'Simple pattern', () =>
                claudeTools.grep(pattern, options)
            );

            // Enhanced Grep
            await benchmarkRunner.runBenchmark('Enhanced Grep', 'Simple pattern', () =>
                enhancedGrep.search({ pattern, path: testDir || '.', outputMode: 'files_with_matches' })
            );

            // Native ripgrep
            await benchmarkRunner.runBenchmark('Native ripgrep', 'Simple pattern', () =>
                NativeTools.grep(pattern, options)
            );

            // Silver Searcher
            await benchmarkRunner.runBenchmark('Silver Searcher', 'Simple pattern', () =>
                NativeTools.silverSearcher(pattern, options)
            );
        });

        test('Complex regex pattern', async () => {
            const pattern = 'async\\s+function\\s+\\w+';
            const options = { path: testDir || '.', outputMode: 'files_with_matches' };

            await benchmarkRunner.runBenchmark('Claude Grep', 'Complex regex', () =>
                claudeTools.grep(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Enhanced Grep', 'Complex regex', () =>
                enhancedGrep.search({ pattern, path: testDir || '.', outputMode: 'files_with_matches' })
            );

            await benchmarkRunner.runBenchmark('Native ripgrep', 'Complex regex', () =>
                NativeTools.grep(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Silver Searcher', 'Complex regex', () =>
                NativeTools.silverSearcher(pattern, options)
            );
        });

        test('Case-insensitive search', async () => {
            const pattern = 'CLASS';
            const options = { path: testDir || '.', outputMode: 'files_with_matches', caseInsensitive: true };

            await benchmarkRunner.runBenchmark('Claude Grep', 'Case insensitive', () =>
                claudeTools.grep(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Enhanced Grep', 'Case insensitive', () =>
                enhancedGrep.search({
                    pattern,
                    path: testDir || '.',
                    outputMode: 'files_with_matches',
                    caseInsensitive: true,
                })
            );

            await benchmarkRunner.runBenchmark('Native ripgrep', 'Case insensitive', () =>
                NativeTools.grep(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Silver Searcher', 'Case insensitive', () =>
                NativeTools.silverSearcher(pattern, options)
            );
        });

        test('Type-specific search', async () => {
            const pattern = 'export';
            const options = { path: testDir || '.', outputMode: 'files_with_matches', type: 'ts' };

            await benchmarkRunner.runBenchmark('Claude Grep', 'Type specific', () =>
                claudeTools.grep(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Enhanced Grep', 'Type specific', () =>
                enhancedGrep.search({ pattern, path: testDir || '.', outputMode: 'files_with_matches', type: 'ts' })
            );

            await benchmarkRunner.runBenchmark('Native ripgrep', 'Type specific', () =>
                NativeTools.grep(pattern, options)
            );

            // Note: ag uses different file type flags
            await benchmarkRunner.runBenchmark(
                'Silver Searcher',
                'Type specific',
                () => NativeTools.silverSearcher(pattern, { ...options, type: 'js' }) // ag groups JS/TS together
            );
        });

        test('Cached vs uncached performance', async () => {
            const pattern = 'data';
            const options = { path: testDir || '.', outputMode: 'files_with_matches' };

            // First run (uncached)
            await benchmarkRunner.runBenchmark('Enhanced Grep', 'Uncached search', () =>
                enhancedGrep.search({ pattern, path: testDir || '.', outputMode: 'files_with_matches' })
            );

            // Second run (should be cached)
            await benchmarkRunner.runBenchmark('Enhanced Grep', 'Cached search', () =>
                enhancedGrep.search({ pattern, path: testDir || '.', outputMode: 'files_with_matches' })
            );
        });
    });

    describe('Glob Performance Benchmarks', () => {
        test('Simple pattern matching', async () => {
            const pattern = '*.txt';
            const options = { path: testDir || '.' };

            await benchmarkRunner.runBenchmark('Claude Glob', 'Simple pattern', () =>
                claudeTools.glob(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Enhanced Glob', 'Simple pattern', () =>
                enhancedGlob.search({ pattern, path: testDir || '.' })
            );

            await benchmarkRunner.runBenchmark('Native fast-glob', 'Simple pattern', () =>
                NativeTools.glob(pattern, options)
            );
        });

        test('Complex pattern matching', async () => {
            const pattern = '**/*.{ts,js,tsx,jsx}';
            const options = { path: testDir || '.' };

            await benchmarkRunner.runBenchmark('Claude Glob', 'Complex pattern', () =>
                claudeTools.glob(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Enhanced Glob', 'Complex pattern', () =>
                enhancedGlob.search({ pattern, path: testDir || '.' })
            );

            await benchmarkRunner.runBenchmark('Native fast-glob', 'Complex pattern', () =>
                NativeTools.glob(pattern, options)
            );
        });

        test('Deep directory traversal', async () => {
            const pattern = '**/deeper/*';
            const options = { path: testDir || '.' };

            await benchmarkRunner.runBenchmark('Claude Glob', 'Deep traversal', () =>
                claudeTools.glob(pattern, options)
            );

            await benchmarkRunner.runBenchmark('Enhanced Glob', 'Deep traversal', () =>
                enhancedGlob.search({ pattern, path: testDir || '.' })
            );

            await benchmarkRunner.runBenchmark('Native fast-glob', 'Deep traversal', () =>
                NativeTools.glob(pattern, options)
            );
        });

        test('Many files matching', async () => {
            const pattern = 'file*.txt';
            const options = { path: testDir || '.' };

            await benchmarkRunner.runBenchmark('Claude Glob', 'Many matches', () => claudeTools.glob(pattern, options));

            await benchmarkRunner.runBenchmark('Enhanced Glob', 'Many matches', () =>
                enhancedGlob.search({ pattern, path: testDir || '.' })
            );

            await benchmarkRunner.runBenchmark('Native fast-glob', 'Many matches', () =>
                NativeTools.glob(pattern, options)
            );
        });
    });

    describe('LS Performance Benchmarks', () => {
        test('Small directory listing', async () => {
            const dirPath = path.join(testDir || '.', 'nested');

            await benchmarkRunner.runBenchmark('Claude LS', 'Small directory', () => claudeTools.ls(dirPath));

            await benchmarkRunner.runBenchmark('Enhanced LS', 'Small directory', () =>
                enhancedLS.list({ path: dirPath })
            );

            await benchmarkRunner.runBenchmark('Native fs.readdir', 'Small directory', () => NativeTools.ls(dirPath));
        });

        test('Large directory listing', async () => {
            const dirPath = testDir || '.';

            await benchmarkRunner.runBenchmark('Claude LS', 'Large directory', () => claudeTools.ls(dirPath));

            await benchmarkRunner.runBenchmark('Enhanced LS', 'Large directory', () =>
                enhancedLS.list({ path: dirPath })
            );

            await benchmarkRunner.runBenchmark('Native fs.readdir', 'Large directory', () => NativeTools.ls(dirPath));
        });

        test('With metadata extraction', async () => {
            const dirPath = testDir || '.';

            await benchmarkRunner.runBenchmark('Enhanced LS', 'With metadata', () =>
                enhancedLS.list({ path: dirPath, includeMetadata: true })
            );

            await benchmarkRunner.runBenchmark('Native fs.readdir', 'With metadata', () => NativeTools.ls(dirPath));
        });

        test('Recursive listing', async () => {
            const dirPath = path.join(testDir || '.', 'nested');

            await benchmarkRunner.runBenchmark('Enhanced LS', 'Recursive listing', () =>
                enhancedLS.list({ path: dirPath, recursive: true })
            );

            // Note: Claude LS and Native fs.readdir don't have built-in recursive options
            // so we'll skip them for this test
        });

        test('Permission checking', async () => {
            const dirPath = testDir || '.';

            await benchmarkRunner.runBenchmark('Enhanced LS', 'Permission checks', () =>
                enhancedLS.list({ path: dirPath, includeMetadata: true })
            );
        });
    });

    describe('Memory Usage Benchmarks', () => {
        test('Memory efficiency comparison', async () => {
            console.log('\n💾 MEMORY USAGE COMPARISON');
            console.log('Testing memory consumption across tools...');

            const pattern = 'function';
            const iterations = 50;

            // Test memory usage for each tool type
            const memoryTests = [
                {
                    name: 'Claude Grep',
                    test: () => claudeTools.grep(pattern, { path: testDir || '.' }),
                },
                {
                    name: 'Enhanced Grep',
                    test: () => enhancedGrep.search({ pattern, path: testDir || '.' }),
                },
                {
                    name: 'Native ripgrep',
                    test: () => NativeTools.grep(pattern, { path: testDir || '.' }),
                },
                {
                    name: 'Silver Searcher',
                    test: () => NativeTools.silverSearcher(pattern, { path: testDir || '.' }),
                },
            ];

            for (const { name, test } of memoryTests) {
                const startMemory = process.memoryUsage();

                for (let i = 0; i < iterations; i++) {
                    await test();
                }

                const endMemory = process.memoryUsage();
                const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;

                console.log(
                    `${name}: ${Math.round(memoryDiff / 1024)}KB total, ${Math.round(memoryDiff / iterations / 1024)}KB per operation`
                );
            }
        });
    });

    describe('Cache Performance Analysis', () => {
        test('Cache hit rate analysis', async () => {
            console.log('\n📊 CACHE PERFORMANCE ANALYSIS');

            // Test enhanced tools cache performance
            const pattern = 'test';
            const repetitions = 20;

            // Clear cache first
            enhancedGrep.clearCache();

            console.log('Testing Enhanced Grep cache performance...');

            // First pass - populate cache
            for (let i = 0; i < repetitions; i++) {
                await enhancedGrep.search({ pattern, path: testDir || '.' });
            }

            // Get cache stats (this would need to be implemented in the Enhanced tools)
            console.log('Cache statistics would be displayed here if implemented in enhanced tools');

            // Test different patterns to measure cache efficiency
            const patterns = ['function', 'class', 'export', 'import', 'const'];

            for (const testPattern of patterns) {
                const start = performance.now();
                await enhancedGrep.search({ pattern: testPattern, path: testDir || '.' });
                const end = performance.now();
                console.log(`Pattern "${testPattern}": ${(end - start).toFixed(2)}ms`);
            }
        });
    });
});
