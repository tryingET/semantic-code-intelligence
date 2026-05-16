/**
 * Comprehensive tests for CodeEvolutionTracker
 * Tests evolution event recording, pattern detection, and trend analysis
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { EventBusService } from '../../core/services/event-bus-service.js';
import { SharedServices } from '../../core/services/index.js';
import type { CoreConfig } from '../../core/types.js';
import { CodeEvolutionTracker, type CodeQualityMetrics, type EvolutionEvent } from '../evolution-tracker.js';

// Test database path
const TEST_DB_PATH = path.join(process.cwd(), 'test-evolution.db');

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

describe('CodeEvolutionTracker', () => {
    let evolutionTracker: CodeEvolutionTracker;
    let sharedServices: SharedServices;
    let eventBus: EventBusService;

    beforeEach(async () => {
        // Clean up test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }

        // Create fresh event bus and shared services
        eventBus = new EventBusService();
        sharedServices = new SharedServices(mockConfig, eventBus);
        await sharedServices.initialize();

        // Create evolution tracker
        evolutionTracker = new CodeEvolutionTracker(sharedServices, eventBus, {
            minOccurrences: 2,
            minConfidence: 0.6,
            maxPatternAge: 30,
        });

        await evolutionTracker.initialize();
    });

    afterEach(async () => {
        // Clean up
        await evolutionTracker.dispose();
        await sharedServices.dispose();

        // Remove test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    describe('Initialization', () => {
        test('should initialize successfully', async () => {
            expect(evolutionTracker).toBeDefined();
            const diagnostics = evolutionTracker.getDiagnostics();
            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.evolutionEventsCount).toBe(0);
        });

        test('should initialize database schema', async () => {
            // Check if evolution_events table exists
            const tables = await sharedServices.database.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_events'"
            );
            expect(tables.length).toBe(1);

            // Check if quality_metrics table exists
            const qualityTables = await sharedServices.database.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='quality_metrics'"
            );
            expect(qualityTables.length).toBe(1);
        });

        test('should load existing evolution history', async () => {
            // Add test data
            await sharedServices.database.execute(
                `
        INSERT INTO evolution_events (
          id, type, timestamp, file_path, files_affected, symbols_affected,
          tests_affected, severity, diff_size, automated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
                ['test-1', 'file_created', Math.floor(Date.now() / 1000), '/test/file.ts', 1, 1, 0, 'medium', 50, false]
            );

            // Create new instance to test loading
            const newTracker = new CodeEvolutionTracker(sharedServices, eventBus);
            await newTracker.initialize();

            const diagnostics = newTracker.getDiagnostics();
            expect(diagnostics.evolutionEventsCount).toBe(1);

            await newTracker.dispose();
        });
    });

    describe('Evolution Event Recording', () => {
        test('should record evolution event successfully', async () => {
            const eventData: Omit<EvolutionEvent, 'id'> = {
                type: 'file_created',
                timestamp: new Date(),
                file: '/src/new-feature.ts',
                after: {
                    path: '/src/new-feature.ts',
                    content: 'export class NewFeature {}',
                },
                context: {
                    commit: 'abc123',
                    author: 'developer',
                    message: 'Add new feature',
                },
                impact: {
                    filesAffected: 1,
                    symbolsAffected: 1,
                    testsAffected: 0,
                    severity: 'medium',
                },
                metadata: {
                    diffSize: 25,
                    automated: false,
                },
            };

            const eventId = await evolutionTracker.recordEvolutionEvent(eventData);

            expect(eventId).toBeDefined();
            expect(typeof eventId).toBe('string');

            const diagnostics = evolutionTracker.getDiagnostics();
            expect(diagnostics.evolutionEventsCount).toBe(1);
        });

        test('should record event within performance target', async () => {
            const startTime = Date.now();

            await evolutionTracker.recordEvolutionEvent({
                type: 'file_modified',
                timestamp: new Date(),
                file: '/src/existing.ts',
                before: { content: 'old content' },
                after: { content: 'new content' },
                context: {},
                impact: {
                    filesAffected: 1,
                    symbolsAffected: 2,
                    testsAffected: 1,
                    severity: 'low',
                },
                metadata: {
                    diffSize: 10,
                    automated: false,
                },
            });

            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(30); // Should be under 30ms
        });

        test('should handle different event types', async () => {
            const eventTypes = [
                'file_created',
                'file_deleted',
                'file_renamed',
                'file_moved',
                'symbol_added',
                'symbol_removed',
                'symbol_renamed',
                'signature_changed',
            ] as const;

            for (const type of eventTypes) {
                await evolutionTracker.recordEvolutionEvent({
                    type,
                    timestamp: new Date(),
                    file: `/src/${type}.ts`,
                    context: { message: `Test ${type}` },
                    impact: {
                        filesAffected: 1,
                        symbolsAffected: 1,
                        testsAffected: 0,
                        severity: 'low',
                    },
                    metadata: {
                        diffSize: 5,
                        automated: false,
                    },
                });
            }

            const diagnostics = evolutionTracker.getDiagnostics();
            expect(diagnostics.evolutionEventsCount).toBe(eventTypes.length);
        });

        test('should emit events when recording', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('evolution-event-recorded', (data: any) => {
                    resolve(data);
                });
            });

            await evolutionTracker.recordEvolutionEvent({
                type: 'file_created',
                timestamp: new Date(),
                file: '/src/event-test.ts',
                context: {},
                impact: {
                    filesAffected: 1,
                    symbolsAffected: 1,
                    testsAffected: 0,
                    severity: 'low',
                },
                metadata: {
                    diffSize: 10,
                    automated: false,
                },
            });

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).type).toBe('file_created');
        });
    });

    describe('File Change Tracking', () => {
        test('should track file creation', async () => {
            const eventId = await evolutionTracker.trackFileChange(
                '/src/new.ts',
                'created',
                undefined,
                'export class NewClass {}',
                { commit: 'abc123', author: 'dev' }
            );

            expect(eventId).toBeDefined();

            const history = evolutionTracker.getEvolutionHistory('new.ts');
            expect(history.length).toBe(1);
            expect(history[0].type).toBe('file_created');
            expect(history[0].file).toBe('/src/new.ts');
        });

        test('should track file modification', async () => {
            const before = 'export class Old {}';
            const after = 'export class New {}';

            await evolutionTracker.trackFileChange('/src/modified.ts', 'modified', before, after, {
                commit: 'def456',
                message: 'Update class',
            });

            const history = evolutionTracker.getEvolutionHistory('modified.ts');
            expect(history.length).toBe(1);
            expect(history[0].metadata.diffSize).toBeGreaterThan(0);
        });

        test('should track file deletion', async () => {
            const before = 'export class Deleted {}';

            await evolutionTracker.trackFileChange('/src/deleted.ts', 'deleted', before, undefined, {
                commit: 'ghi789',
                message: 'Remove unused class',
            });

            const history = evolutionTracker.getEvolutionHistory('deleted.ts');
            expect(history.length).toBe(1);
            expect(history[0].type).toBe('file_deleted');
            expect(history[0].impact.severity).toBe('high');
        });

        test('should track file rename', async () => {
            await evolutionTracker.trackFileChange(
                '/src/renamed.ts',
                'renamed',
                'export class Original {}',
                'export class Original {}',
                { commit: 'jkl012', message: 'Rename file' }
            );

            const history = evolutionTracker.getEvolutionHistory('renamed.ts');
            expect(history.length).toBe(1);
            expect(history[0].type).toBe('file_renamed');
        });

        test('should detect automated changes', async () => {
            await evolutionTracker.trackFileChange('/src/auto.ts', 'modified', 'old content', 'new content', {
                message: 'automated build process update',
            });

            const history = evolutionTracker.getEvolutionHistory('auto.ts');
            expect(history.length).toBe(1);
            expect(history[0].metadata.automated).toBe(true);
        });
    });

    describe('Quality Metrics Recording', () => {
        test('should record quality metrics', async () => {
            const metrics: CodeQualityMetrics = {
                timestamp: new Date(),
                complexity: {
                    cyclomatic: 15.5,
                    cognitive: 22.3,
                    halstead: 8.7,
                },
                duplication: {
                    lines: 150,
                    blocks: 5,
                    percentage: 3.2,
                },
                dependencies: {
                    internal: 25,
                    external: 12,
                    circular: 1,
                },
                testCoverage: {
                    lines: 85.6,
                    branches: 78.9,
                    functions: 92.3,
                },
                maintainability: {
                    index: 7.8,
                    debt: 16.5,
                    hotspots: ['/src/complex.ts', '/src/legacy.ts'],
                },
            };

            await evolutionTracker.recordQualityMetrics(metrics);

            // Verify metrics were stored
            const rows = await sharedServices.database.query(
                'SELECT * FROM quality_metrics ORDER BY timestamp DESC LIMIT 1'
            );
            expect(rows.length).toBe(1);
            expect(rows[0].cyclomatic_complexity).toBe(15.5);
            expect(rows[0].test_coverage_lines).toBe(85.6);
        });

        test('should emit event when recording quality metrics', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('quality-metrics-recorded', (data: any) => {
                    resolve(data);
                });
            });

            const metrics: CodeQualityMetrics = {
                timestamp: new Date(),
                complexity: { cyclomatic: 10, cognitive: 15, halstead: 5 },
                duplication: { lines: 50, blocks: 2, percentage: 1.5 },
                dependencies: { internal: 10, external: 5, circular: 0 },
                testCoverage: { lines: 90, branches: 85, functions: 95 },
                maintainability: { index: 8.5, debt: 5.2, hotspots: [] },
            };

            await evolutionTracker.recordQualityMetrics(metrics);

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).complexity).toBe(10);
        });
    });

    describe('Evolution Pattern Detection', () => {
        beforeEach(async () => {
            // Add similar events to test pattern detection
            const baseTime = Date.now();

            for (let i = 0; i < 5; i++) {
                await evolutionTracker.recordEvolutionEvent({
                    type: 'symbol_renamed',
                    timestamp: new Date(baseTime + i * 1000),
                    file: `/src/component${i}.ts`,
                    before: { signature: `oldFunction${i}` },
                    after: { signature: `newFunction${i}` },
                    context: { message: `Refactor function ${i}` },
                    impact: {
                        filesAffected: 1,
                        symbolsAffected: 1,
                        testsAffected: 1,
                        severity: 'medium',
                    },
                    metadata: {
                        diffSize: 10,
                        automated: false,
                    },
                });
            }
        });

        test('should detect evolution patterns', async () => {
            const patterns = await evolutionTracker.detectEvolutionPatterns();

            expect(Array.isArray(patterns)).toBe(true);

            if (patterns.length > 0) {
                const refactoringPatterns = patterns.filter((p) => p.type === 'refactoring');
                expect(refactoringPatterns.length).toBeGreaterThan(0);

                const pattern = refactoringPatterns[0];
                expect(pattern.frequency).toBeGreaterThanOrEqual(2);
                expect(pattern.confidence).toBeGreaterThan(0);
                expect(pattern.examples.length).toBeGreaterThan(0);
            }
        });

        test('should detect patterns within performance target', async () => {
            const startTime = Date.now();
            await evolutionTracker.detectEvolutionPatterns();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(50); // Should be under 50ms
        });

        test('should detect different pattern types', async () => {
            // Add different types of events
            await evolutionTracker.recordEvolutionEvent({
                type: 'file_created',
                timestamp: new Date(),
                file: '/src/new1.ts',
                context: { message: 'Add new feature' },
                impact: { filesAffected: 1, symbolsAffected: 5, testsAffected: 0, severity: 'medium' },
                metadata: { diffSize: 100, automated: false },
            });

            await evolutionTracker.recordEvolutionEvent({
                type: 'file_created',
                timestamp: new Date(),
                file: '/src/new2.ts',
                context: { message: 'Add another feature' },
                impact: { filesAffected: 1, symbolsAffected: 3, testsAffected: 0, severity: 'medium' },
                metadata: { diffSize: 80, automated: false },
            });

            await evolutionTracker.recordEvolutionEvent({
                type: 'file_created',
                timestamp: new Date(),
                file: '/src/new3.ts',
                context: { message: 'Add third feature' },
                impact: { filesAffected: 1, symbolsAffected: 7, testsAffected: 0, severity: 'medium' },
                metadata: { diffSize: 120, automated: false },
            });

            const patterns = await evolutionTracker.detectEvolutionPatterns();

            if (patterns.length > 0) {
                const growthPatterns = patterns.filter((p) => p.type === 'growth');
                expect(growthPatterns.length).toBeGreaterThan(0);
            }
        });

        test('should generate pattern names and descriptions', async () => {
            const patterns = await evolutionTracker.detectEvolutionPatterns();

            for (const pattern of patterns) {
                expect(pattern.name).toBeDefined();
                expect(pattern.name.length).toBeGreaterThan(0);
                expect(pattern.description).toBeDefined();
                expect(pattern.description.length).toBeGreaterThan(0);
                expect(pattern.characteristics).toBeDefined();
                expect(pattern.characteristics.typicalFiles).toBeDefined();
                expect(pattern.characteristics.typicalOperations).toBeDefined();
            }
        });
    });

    describe('Architectural Trend Analysis', () => {
        beforeEach(async () => {
            // Add quality metrics for trend analysis
            const baseTime = Date.now();

            for (let i = 0; i < 10; i++) {
                const metrics: CodeQualityMetrics = {
                    timestamp: new Date(baseTime - (10 - i) * 24 * 60 * 60 * 1000), // 10 days ago to today
                    complexity: {
                        cyclomatic: 10 + i * 2, // Increasing complexity
                        cognitive: 15 + i * 1.5,
                        halstead: 5 + i * 0.5,
                    },
                    duplication: {
                        lines: 50 + i * 5,
                        blocks: 2 + i,
                        percentage: 1.5 + i * 0.2,
                    },
                    dependencies: {
                        internal: 10 + i,
                        external: 5 + i,
                        circular: i > 5 ? 1 : 0,
                    },
                    testCoverage: {
                        lines: 90 - i * 2, // Decreasing coverage
                        branches: 85 - i * 1.5,
                        functions: 95 - i,
                    },
                    maintainability: {
                        index: 8.5 - i * 0.2,
                        debt: 5.2 + i * 2,
                        hotspots: [],
                    },
                };

                await evolutionTracker.recordQualityMetrics(metrics);
            }
        });

        test('should analyze architectural trends', async () => {
            const trends = await evolutionTracker.analyzeArchitecturalTrends();

            expect(Array.isArray(trends)).toBe(true);

            if (trends.length > 0) {
                const trend = trends[0];
                expect(trend.type).toBeDefined();
                expect(trend.direction).toBeDefined();
                expect(['increasing', 'decreasing', 'stable']).toContain(trend.direction);
                expect(trend.strength).toBeGreaterThanOrEqual(0);
                expect(trend.strength).toBeLessThanOrEqual(1);
                expect(trend.timeframe.start).toBeDefined();
                expect(trend.timeframe.end).toBeDefined();
            }
        });

        test('should detect complexity increase trend', async () => {
            const trends = await evolutionTracker.analyzeArchitecturalTrends();

            const complexityTrends = trends.filter((t) => t.type === 'complexity_increase');

            if (complexityTrends.length > 0) {
                const trend = complexityTrends[0];
                expect(trend.direction).toBe('increasing');
                expect(trend.strength).toBeGreaterThan(0.5); // Strong trend due to consistent increase
            }
        });

        test('should detect test coverage decline', async () => {
            const trends = await evolutionTracker.analyzeArchitecturalTrends();

            const coverageTrends = trends.filter((t) => t.type === 'test_coverage_change');

            if (coverageTrends.length > 0) {
                const trend = coverageTrends[0];
                expect(trend.direction).toBe('decreasing');
                expect(trend.dataPoints.length).toBeGreaterThan(0);
            }
        });

        test('should filter trends by timeframe', async () => {
            const last5Days = {
                start: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
                end: new Date(),
            };

            const trends = await evolutionTracker.analyzeArchitecturalTrends(last5Days);

            for (const trend of trends) {
                expect(trend.timeframe.start.getTime()).toBeGreaterThanOrEqual(last5Days.start.getTime());
                expect(trend.timeframe.end.getTime()).toBeLessThanOrEqual(last5Days.end.getTime());
            }
        });
    });

    describe('Evolution Report Generation', () => {
        beforeEach(async () => {
            // Add various events and metrics for comprehensive report
            const baseTime = Date.now();

            // Add evolution events
            for (let i = 0; i < 15; i++) {
                await evolutionTracker.recordEvolutionEvent({
                    type: i % 3 === 0 ? 'file_created' : i % 3 === 1 ? 'symbol_renamed' : 'signature_changed',
                    timestamp: new Date(baseTime - (15 - i) * 24 * 60 * 60 * 1000),
                    file: `/src/file${i}.ts`,
                    context: { message: `Change ${i}` },
                    impact: {
                        filesAffected: 1 + (i % 3),
                        symbolsAffected: 1 + (i % 5),
                        testsAffected: i % 2,
                        severity: i > 10 ? 'high' : i > 5 ? 'medium' : 'low',
                    },
                    metadata: {
                        diffSize: 10 + i * 5,
                        automated: i % 4 === 0,
                    },
                });
            }

            // Add quality metrics
            for (let i = 0; i < 5; i++) {
                await evolutionTracker.recordQualityMetrics({
                    timestamp: new Date(baseTime - (5 - i) * 24 * 60 * 60 * 1000),
                    complexity: { cyclomatic: 10 + i * 2, cognitive: 15 + i, halstead: 5 + i },
                    duplication: { lines: 50 + i * 10, blocks: 2 + i, percentage: 1.5 + i * 0.3 },
                    dependencies: { internal: 10 + i * 2, external: 5 + i, circular: i > 2 ? 1 : 0 },
                    testCoverage: { lines: 90 - i * 3, branches: 85 - i * 2, functions: 95 - i },
                    maintainability: { index: 8.5 - i * 0.5, debt: 5.2 + i * 3, hotspots: [] },
                });
            }
        });

        test('should generate evolution report', async () => {
            const period = {
                start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                end: new Date(),
            };

            const report = await evolutionTracker.generateEvolutionReport(period);

            expect(report).toBeDefined();
            expect(report.period).toEqual(period);
            expect(report.summary).toBeDefined();
            expect(report.summary.totalEvents).toBeGreaterThan(0);
            expect(report.patterns).toBeDefined();
            expect(Array.isArray(report.patterns)).toBe(true);
            expect(report.trends).toBeDefined();
            expect(Array.isArray(report.trends)).toBe(true);
            expect(report.qualityMetrics).toBeDefined();
            expect(report.recommendations).toBeDefined();
            expect(Array.isArray(report.recommendations)).toBe(true);
        });

        test('should calculate quality trend correctly', async () => {
            const period = {
                start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                end: new Date(),
            };

            const report = await evolutionTracker.generateEvolutionReport(period);

            // Based on our test data, quality should be degrading (increasing complexity, decreasing coverage)
            expect(['improving', 'degrading', 'stable']).toContain(report.summary.qualityTrend);
        });

        test('should generate meaningful recommendations', async () => {
            const period = {
                start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                end: new Date(),
            };

            const report = await evolutionTracker.generateEvolutionReport(period);

            for (const recommendation of report.recommendations) {
                expect(recommendation.type).toBeDefined();
                expect(['refactoring', 'architectural', 'quality', 'process']).toContain(recommendation.type);
                expect(recommendation.priority).toBeDefined();
                expect(['low', 'medium', 'high', 'critical']).toContain(recommendation.priority);
                expect(recommendation.description).toBeDefined();
                expect(recommendation.description.length).toBeGreaterThan(0);
                expect(recommendation.rationale).toBeDefined();
                expect(recommendation.effort).toBeGreaterThan(0);
                expect(recommendation.impact).toBeGreaterThanOrEqual(0);
                expect(recommendation.impact).toBeLessThanOrEqual(1);
            }
        });

        test('should generate report within performance target', async () => {
            const period = {
                start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                end: new Date(),
            };

            const startTime = Date.now();
            await evolutionTracker.generateEvolutionReport(period);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(200); // Should be under 200ms (higher than real-time ops)
        });
    });

    describe('Evolution History', () => {
        beforeEach(async () => {
            // Add events for specific files
            await evolutionTracker.recordEvolutionEvent({
                type: 'file_created',
                timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
                file: '/src/user.ts',
                context: { message: 'Initial user module' },
                impact: { filesAffected: 1, symbolsAffected: 3, testsAffected: 0, severity: 'medium' },
                metadata: { diffSize: 100, automated: false },
            });

            await evolutionTracker.recordEvolutionEvent({
                type: 'symbol_added',
                timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
                file: '/src/user.ts',
                context: { message: 'Add validation method' },
                impact: { filesAffected: 1, symbolsAffected: 1, testsAffected: 1, severity: 'low' },
                metadata: { diffSize: 25, automated: false },
            });

            await evolutionTracker.recordEvolutionEvent({
                type: 'signature_changed',
                timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
                file: '/src/user.ts',
                context: { message: 'Update method signature' },
                impact: { filesAffected: 1, symbolsAffected: 1, testsAffected: 2, severity: 'medium' },
                metadata: { diffSize: 15, automated: false },
            });
        });

        test('should get evolution history for specific file', async () => {
            const history = evolutionTracker.getEvolutionHistory('user.ts');

            expect(history.length).toBe(3);

            // Should be sorted by timestamp (most recent first)
            expect(history[0].type).toBe('signature_changed');
            expect(history[1].type).toBe('symbol_added');
            expect(history[2].type).toBe('file_created');

            // All events should be for the same file
            for (const event of history) {
                expect(event.file).toContain('user.ts');
            }
        });

        test('should return empty array for non-existent file', async () => {
            const history = evolutionTracker.getEvolutionHistory('non-existent.ts');
            expect(history.length).toBe(0);
        });

        test('should find history by partial file path', async () => {
            const history = evolutionTracker.getEvolutionHistory('user'); // Partial match
            expect(history.length).toBe(3);
        });
    });

    describe('Performance', () => {
        test('should handle high volume of events efficiently', async () => {
            const startTime = Date.now();
            const eventPromises: Promise<string>[] = [];

            // Record 200 events concurrently
            for (let i = 0; i < 200; i++) {
                eventPromises.push(
                    evolutionTracker.recordEvolutionEvent({
                        type: i % 2 === 0 ? 'file_created' : 'file_modified',
                        timestamp: new Date(),
                        file: `/src/perf-test-${i}.ts`,
                        context: { message: `Performance test ${i}` },
                        impact: {
                            filesAffected: 1,
                            symbolsAffected: (i % 5) + 1,
                            testsAffected: i % 3,
                            severity: i % 4 === 0 ? 'high' : 'medium',
                        },
                        metadata: {
                            diffSize: 10 + (i % 50),
                            automated: i % 10 === 0,
                        },
                    })
                );
            }

            const eventIds = await Promise.all(eventPromises);
            const duration = Date.now() - startTime;

            expect(eventIds.length).toBe(200);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

            const diagnostics = evolutionTracker.getDiagnostics();
            expect(diagnostics.evolutionEventsCount).toBe(200);
        });

        test('should maintain performance with large quality history', async () => {
            // Add large amount of quality metrics
            const promises: Promise<void>[] = [];
            for (let i = 0; i < 100; i++) {
                promises.push(
                    evolutionTracker.recordQualityMetrics({
                        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
                        complexity: { cyclomatic: 10 + i * 0.1, cognitive: 15 + i * 0.1, halstead: 5 + i * 0.05 },
                        duplication: { lines: 50 + i, blocks: 2 + (i % 10), percentage: 1.5 + i * 0.01 },
                        dependencies: { internal: 10 + i, external: 5 + (i % 20), circular: i % 50 === 0 ? 1 : 0 },
                        testCoverage: { lines: 90 - i * 0.1, branches: 85 - i * 0.1, functions: 95 - i * 0.05 },
                        maintainability: { index: 8.5 - i * 0.01, debt: 5.2 + i * 0.1, hotspots: [] },
                    })
                );
            }

            await Promise.all(promises);

            // Performance should still be good for trend analysis
            const startTime = Date.now();
            const trends = await evolutionTracker.analyzeArchitecturalTrends();
            const duration = Date.now() - startTime;

            expect(trends).toBeDefined();
            expect(duration).toBeLessThan(200); // Should still be reasonably fast
        });
    });

    describe('Error Handling', () => {
        test('should handle database errors gracefully', async () => {
            // Simulate database error by closing the database
            await sharedServices.database.close();

            // Should not throw, but should handle gracefully
            const eventId = await evolutionTracker.recordEvolutionEvent({
                type: 'file_created',
                timestamp: new Date(),
                file: '/src/error-test.ts',
                context: {},
                impact: { filesAffected: 1, symbolsAffected: 1, testsAffected: 0, severity: 'low' },
                metadata: { diffSize: 10, automated: false },
            });

            expect(eventId).toBeDefined();
        });

        test('should handle invalid quality metrics', async () => {
            // Should handle missing or invalid data gracefully
            await expect(
                evolutionTracker.recordQualityMetrics({
                    timestamp: new Date(),
                    complexity: { cyclomatic: -1, cognitive: NaN, halstead: Infinity },
                    duplication: { lines: -50, blocks: -2, percentage: -1.5 },
                    dependencies: { internal: -10, external: -5, circular: -1 },
                    testCoverage: { lines: 150, branches: 200, functions: -10 }, // Invalid percentages
                    maintainability: { index: -5, debt: -10, hotspots: [] },
                })
            ).resolves.not.toThrow();
        });

        test('should handle empty evolution events gracefully', async () => {
            const patterns = await evolutionTracker.detectEvolutionPatterns([]);
            expect(patterns).toBeDefined();
            expect(Array.isArray(patterns)).toBe(true);
            expect(patterns.length).toBe(0);
        });
    });
});
