import { beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeToolsLayer } from '../../src/layers/claude-tools';
import { TreeSitterLayer } from '../../src/layers/tree-sitter';
import { OntologyEngine } from '../../src/ontology/ontology-engine';
import { OntologyStorage } from '../../src/ontology/storage';
import { PatternLearner } from '../../src/patterns/pattern-learner';
import { KnowledgeSpreader } from '../../src/propagation/knowledge-spreader';
import { ThingKind } from '../../src/types/core';
import { createTestFile, testPaths } from '../test-helpers';

const perfOnly = process.env.PERF === '1';
const perfDescribe = perfOnly ? describe : describe.skip;

perfDescribe('Performance Benchmarks', () => {
    let claudeTools: ClaudeToolsLayer;
    let treeSitter: TreeSitterLayer;
    let ontology: OntologyEngine;
    let patterns: PatternLearner;
    let propagation: KnowledgeSpreader;

    beforeAll(async () => {
        // Initialize all layers
        claudeTools = new ClaudeToolsLayer({
            grep: { defaultTimeout: 100, maxResults: 100 },
            glob: { defaultTimeout: 100 },
            ls: { defaultTimeout: 100 },
            optimization: {
                bloomFilter: true,
                frequencyCache: true,
                recentSearches: true,
                negativeLookup: true,
            },
            caching: { enabled: true, ttl: 3600, maxEntries: 1000 },
        });

        treeSitter = new TreeSitterLayer({
            languages: ['typescript', 'javascript', 'python'],
            timeout: 500,
            maxFileSize: 1048576,
            caching: { enabled: true, ttl: 3600, maxEntries: 100 },
        });

        ontology = new OntologyEngine(new OntologyStorage('/tmp/test-ontology.db'));
        patterns = new PatternLearner('/tmp/test-patterns.db', {
            learningThreshold: 3,
            confidenceThreshold: 0.7,
        });
        propagation = new KnowledgeSpreader(ontology, patterns);

        // Warm-up cache for async grep and file listing to reduce cold start variance
        try {
            const warmups = ['InitGrepA', 'InitGrepB', 'InitGrepC'];
            for (const w of warmups) {
                await claudeTools.process({ identifier: w, searchPath: '.', fileTypes: ['ts', 'js'] });
            }
        } catch {}
    });

    const envNum = (name: string, def: number): number => {
        const v = parseInt(process.env[name] || '', 10);
        return Number.isFinite(v) && v > 0 ? v : def;
    };

    test('Find Definition - Performance', async () => {
        const iterations = 100;
        const start = performance.now();

        for (let i = 0; i < iterations; i++) {
            await claudeTools.process({
                identifier: `testFunction${i}`,
                searchPath: '.',
                fileTypes: ['ts'],
            });
        }

        const end = performance.now();
        const avgTime = (end - start) / iterations;

        console.log(`Find Definition: ${avgTime.toFixed(2)}ms avg (${iterations} iterations)`);
        const p95Target = envNum('PERF_P95_TARGET_MS', 200);
        expect(avgTime).toBeLessThan(p95Target);
    });

    test('Find References - Performance', async () => {
        const iterations = 50;
        const start = performance.now();

        for (let i = 0; i < iterations; i++) {
            const result = await claudeTools.process({
                identifier: `commonFunction`,
                searchPath: '.',
                fileTypes: ['ts', 'js'],
            });
        }

        const end = performance.now();
        const avgTime = (end - start) / iterations;

        console.log(`Find References: ${avgTime.toFixed(2)}ms avg (${iterations} iterations)`);
        const p99Target = envNum('PERF_P99_TARGET_MS', 500);
        expect(avgTime).toBeLessThan(p99Target);
    });

    test('Pattern Learning - Performance', async () => {
        const iterations = 100;
        const start = performance.now();

        for (let i = 0; i < iterations; i++) {
            await patterns.learnFromRename(`oldName${i}`, `newName${i}`, { file: 'test.ts', line: i });
        }

        const end = performance.now();
        const avgTime = (end - start) / iterations;

        console.log(`Pattern Learning: ${avgTime.toFixed(2)}ms avg (${iterations} iterations)`);
        expect(avgTime).toBeLessThan(50); // Should be under 50ms
    });

    test('Rename with Propagation - Performance', async () => {
        const iterations = 20;
        const start = performance.now();

        for (let i = 0; i < iterations; i++) {
            const change = {
                type: 'rename' as const,
                identifier: `component${i}`,
                from: `OldComponent${i}`,
                to: `NewComponent${i}`,
                location: 'test.ts',
                source: 'user_action' as const,
                timestamp: new Date(),
            };

            await propagation.propagateChange(change);
        }

        const end = performance.now();
        const avgTime = (end - start) / iterations;

        console.log(`Rename with Propagation: ${avgTime.toFixed(2)}ms avg (${iterations} iterations)`);
        expect(avgTime).toBeLessThan(1000); // Should be under 1s
    });

    test('Memory Usage - Ontology', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        // Add 1000 concepts
        for (let i = 0; i < 1000; i++) {
            await ontology.addConcept(
                {
                    id: `concept-${i}`,
                    canonicalName: `Concept${i}`,
                    relations: new Map(),
                    signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: `fp-${i}` },
                    evolution: [],
                    metadata: { tags: ['test'] },
                    confidence: 0.9,
                },
                [
                    {
                        symbolText: `concept${i}`,
                        location: {
                            uri: `file:///${i}.ts`,
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 10 },
                            },
                        },
                        kind: ThingKind.Function,
                        role: 'declaration',
                        occurrences: 1,
                        confidence: 0.9,
                    },
                    {
                        symbolText: `getConcept${i}`,
                        location: {
                            uri: `file:///${i}.ts`,
                            range: {
                                start: { line: 1, character: 0 },
                                end: { line: 1, character: 10 },
                            },
                        },
                        kind: ThingKind.Function,
                        role: 'reference',
                        occurrences: 1,
                        confidence: 0.9,
                    },
                ]
            );
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryUsed = (finalMemory - initialMemory) / 1024 / 1024; // MB

        console.log(`Ontology Memory (1000 concepts): ${memoryUsed.toFixed(2)}MB`);
        expect(memoryUsed).toBeLessThan(200); // Should be under 200MB
    });

    test('Cache Hit Rate', async () => {
        const queries = ['getUserData', 'fetchUserInfo', 'loadUser'];
        const iterations = 100;
        let cacheHits = 0;

        // Warm up cache
        for (const query of queries) {
            await claudeTools.process({
                identifier: query,
                searchPath: '.',
                fileTypes: ['ts'],
            });
        }

        // Test cache hit rate
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            const query = queries[i % queries.length];
            const result = await claudeTools.process({
                identifier: query,
                searchPath: '.',
                fileTypes: ['ts'],
            });

            // Check if it was a cache hit (very fast response)
            if (result.searchTime < 5) {
                cacheHits++;
            }
        }
        const end = performance.now();

        const hitRate = (cacheHits / iterations) * 100;
        const avgTime = (end - start) / iterations;

        console.log(`Cache Hit Rate: ${hitRate.toFixed(1)}% (${avgTime.toFixed(2)}ms avg)`);
        expect(hitRate).toBeGreaterThan(80); // Should have >80% cache hit rate
    });

    test('Concurrent Operations', async () => {
        const concurrentOps = 50;
        const start = performance.now();

        const promises = [];
        for (let i = 0; i < concurrentOps; i++) {
            promises.push(
                claudeTools.process({
                    identifier: `concurrentTest${i}`,
                    searchPath: '.',
                    fileTypes: ['ts'],
                })
            );
        }

        await Promise.all(promises);
        const end = performance.now();
        const totalTime = end - start;

        console.log(`Concurrent Operations (${concurrentOps}): ${totalTime.toFixed(2)}ms total`);
        const concTarget = envNum('PERF_CONCURRENCY_P95_TARGET_MS', 5000);
        expect(totalTime).toBeLessThan(concTarget);
    });

    test('Large File Handling', async () => {
        // Create a large test file
        const largeContent = Array(10000).fill('function test() { return true; }\n').join('');
        const testFile = createTestFile('tests/temp/large-test.ts', largeContent);

        const start = performance.now();
        const result = await treeSitter.process({
            identifier: 'test',
            searchPath: testFile,
            fileTypes: ['ts'],
        });
        const end = performance.now();

        const parseTime = end - start;
        console.log(`Large File Parse (10K functions): ${parseTime.toFixed(2)}ms`);

        // Clean up
        fs.unlinkSync(testFile);

        expect(parseTime).toBeLessThan(1000); // Should parse in under 1s
    });
});
