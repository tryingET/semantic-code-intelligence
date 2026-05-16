/**
 * CodeEvolutionTracker - Tracks changes over time across the codebase
 * Identifies architectural evolution patterns and refactoring trends
 */

import { v4 as uuidv4 } from 'uuid';
import type { SharedServices } from '../core/services/index.js';
import { CoreError, type EventBus } from '../core/types.js';
import { Change, Concept, EvolutionHistory, RelationType } from '../types/core.js';

export interface EvolutionEvent {
    id: string;
    type:
        | 'file_created'
        | 'file_deleted'
        | 'file_renamed'
        | 'file_moved'
        | 'symbol_added'
        | 'symbol_removed'
        | 'symbol_renamed'
        | 'signature_changed'
        | 'import_added'
        | 'import_removed'
        | 'dependency_added'
        | 'dependency_removed'
        | 'refactoring';
    timestamp: Date;
    file: string;
    before?: {
        path?: string;
        content?: string;
        signature?: string;
        dependencies?: string[];
    };
    after?: {
        path?: string;
        content?: string;
        signature?: string;
        dependencies?: string[];
    };
    context: {
        commit?: string;
        author?: string;
        branch?: string;
        message?: string;
        refactoringType?: string;
    };
    impact: {
        filesAffected: number;
        symbolsAffected: number;
        testsAffected: number;
        severity: 'low' | 'medium' | 'high' | 'critical';
    };
    metadata: {
        diffSize: number; // Lines changed
        cycleTime?: number; // Time from creation to completion (for features)
        rollback?: boolean;
        automated?: boolean; // Was this change automated/generated?
    };
}

export interface EvolutionPattern {
    id: string;
    type: 'refactoring' | 'migration' | 'growth' | 'cleanup' | 'architectural';
    name: string;
    description: string;
    frequency: number; // How often this pattern occurs
    confidence: number;
    examples: EvolutionEvent[];
    characteristics: {
        typicalFiles: string[]; // File patterns commonly affected
        typicalOperations: string[]; // Operations commonly performed
        timespan: { min: number; max: number; avg: number }; // Duration in days
        impact: { files: number; symbols: number }; // Typical impact size
    };
    detectedAt: Date;
    lastSeen: Date;
}

export interface ArchitecturalTrend {
    type:
        | 'dependency_growth'
        | 'complexity_increase'
        | 'modularity_improvement'
        | 'code_duplication'
        | 'test_coverage_change'
        | 'performance_degradation';
    direction: 'increasing' | 'decreasing' | 'stable';
    strength: number; // 0-1, how strong the trend is
    timeframe: { start: Date; end: Date };
    dataPoints: Array<{ timestamp: Date; value: number }>;
    evidence: EvolutionEvent[];
    prediction?: {
        nextValue: number;
        confidence: number;
        timeframe: number; // Days
    };
}

export interface CodeQualityMetrics {
    timestamp: Date;
    complexity: {
        cyclomatic: number;
        cognitive: number;
        halstead: number;
    };
    duplication: {
        lines: number;
        blocks: number;
        percentage: number;
    };
    dependencies: {
        internal: number;
        external: number;
        circular: number;
    };
    testCoverage: {
        lines: number;
        branches: number;
        functions: number;
    };
    maintainability: {
        index: number;
        debt: number; // Technical debt in hours
        hotspots: string[]; // Files needing attention
    };
}

export interface EvolutionReport {
    period: { start: Date; end: Date };
    summary: {
        totalEvents: number;
        majorRefactorings: number;
        architecturalChanges: number;
        qualityTrend: 'improving' | 'degrading' | 'stable';
    };
    patterns: EvolutionPattern[];
    trends: ArchitecturalTrend[];
    qualityMetrics: {
        start: CodeQualityMetrics;
        end: CodeQualityMetrics;
        change: { [key: string]: { value: number; percentage: number } };
    };
    recommendations: Array<{
        type: 'refactoring' | 'architectural' | 'quality' | 'process';
        priority: 'low' | 'medium' | 'high' | 'critical';
        description: string;
        rationale: string;
        effort: number; // Estimated hours
        impact: number; // Expected improvement (0-1)
    }>;
}

export class CodeEvolutionTracker {
    private sharedServices: SharedServices;
    private eventBus: EventBus;
    private initialized = false;
    private evolutionEvents: Map<string, EvolutionEvent> = new Map();
    private detectedPatterns: Map<string, EvolutionPattern> = new Map();
    private qualityHistory: CodeQualityMetrics[] = [];

    // Performance targets: <20ms for tracking operations
    private performanceTargets = {
        recordEvent: 15, // ms
        detectPatterns: 20, // ms
        generateReport: 50, // ms - can be higher as it's not real-time
    };

    private patternDetectionThresholds = {
        minOccurrences: 3,
        minConfidence: 0.6,
        maxPatternAge: 90, // days
        similarityThreshold: 0.8,
    };

    constructor(
        sharedServices: SharedServices,
        eventBus: EventBus,
        config?: {
            minOccurrences?: number;
            minConfidence?: number;
            maxPatternAge?: number;
        }
    ) {
        this.sharedServices = sharedServices;
        this.eventBus = eventBus;

        if (config) {
            this.patternDetectionThresholds = { ...this.patternDetectionThresholds, ...config };
        }

        this.setupEventListeners();
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.initializeDatabaseSchema();
            await this.loadEvolutionHistory();
            await this.loadQualityHistory();

            this.initialized = true;

            this.eventBus.emit('evolution-tracker:initialized', {
                timestamp: Date.now(),
                eventsLoaded: this.evolutionEvents.size,
                patternsDetected: this.detectedPatterns.size,
            });
        } catch (error) {
            throw new CoreError(
                `CodeEvolutionTracker initialization failed: ${error instanceof Error ? error.message : String(error)}`,
                'EVOLUTION_INIT_ERROR'
            );
        }
    }

    async dispose(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        this.evolutionEvents.clear();
        this.detectedPatterns.clear();
        this.qualityHistory = [];
        this.initialized = false;

        this.eventBus.emit('evolution-tracker:disposed', {
            timestamp: Date.now(),
        });
    }

    /**
     * Record a code evolution event
     * Target: <15ms performance
     */
    async recordEvolutionEvent(event: Omit<EvolutionEvent, 'id'>): Promise<string> {
        const startTime = Date.now();

        if (!this.initialized) {
            throw new CoreError('CodeEvolutionTracker not initialized', 'NOT_INITIALIZED');
        }

        let attempt = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
            try {
                // Generate unique ID with timestamp and random component to avoid collisions
                const eventId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${uuidv4().substr(0, 8)}`;
                const fullEvent: EvolutionEvent = {
                    id: eventId,
                    ...event,
                };

                // Store in memory for quick access
                this.evolutionEvents.set(eventId, fullEvent);

                // Persist to database with retry logic
                await this.storeEventToDatabase(fullEvent);

                // Check for new patterns (async to avoid blocking)
                setImmediate(() => this.detectNewPatterns([fullEvent]));

                // Emit event for other systems
                this.eventBus.emit('evolution-event-recorded', {
                    eventId,
                    type: event.type,
                    file: event.file,
                    impact: event.impact,
                    timestamp: Date.now(),
                });

                const duration = Date.now() - startTime;
                if (duration > this.performanceTargets.recordEvent) {
                    console.warn(
                        `CodeEvolutionTracker.recordEvolutionEvent took ${duration}ms (target: ${this.performanceTargets.recordEvent}ms)`
                    );
                }

                return eventId;
            } catch (error) {
                attempt++;

                // Check if it's a UNIQUE constraint violation
                if (
                    error instanceof CoreError &&
                    error.message.includes('UNIQUE constraint failed') &&
                    attempt < maxAttempts
                ) {
                    // Wait a bit before retrying to avoid rapid collision
                    await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
                    continue;
                }

                // If it's not a retryable error or we've exceeded max attempts
                this.eventBus.emit('evolution-tracker:error', {
                    operation: 'recordEvolutionEvent',
                    error: error instanceof Error ? error.message : String(error),
                    timestamp: Date.now(),
                    attempt,
                });
                throw error;
            }
        }

        throw new CoreError(`Failed to record evolution event after ${maxAttempts} attempts`, 'MAX_RETRIES_EXCEEDED');
    }

    /**
     * Track file system changes from git or file watchers
     */
    async trackFileChange(
        filePath: string,
        changeType: 'created' | 'modified' | 'deleted' | 'renamed',
        before?: string,
        after?: string,
        context?: { commit?: string; author?: string; message?: string }
    ): Promise<string> {
        // Calculate impact
        const impact = await this.calculateChangeImpact(filePath, changeType, before, after);

        // Determine event type based on change analysis
        const eventType = this.determineEvolutionEventType(filePath, changeType, before, after);

        return await this.recordEvolutionEvent({
            type: eventType,
            timestamp: new Date(),
            file: filePath,
            before: before ? { content: before, path: filePath } : undefined,
            after: after ? { content: after, path: filePath } : undefined,
            context: context || {},
            impact,
            metadata: {
                diffSize: this.calculateDiffSize(before, after),
                automated: this.isAutomatedChange(context?.message || ''),
            },
        });
    }

    /**
     * Record quality metrics snapshot
     */
    async recordQualityMetrics(metrics: CodeQualityMetrics): Promise<void> {
        this.qualityHistory.push(metrics);

        // Keep only last 365 days of metrics
        const cutoffDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        this.qualityHistory = this.qualityHistory.filter((m) => m.timestamp >= cutoffDate);

        // Store to database
        await this.storeQualityMetricsToDatabase(metrics);

        // Emit event for trend analysis
        this.eventBus.emit('quality-metrics-recorded', {
            timestamp: metrics.timestamp.getTime(),
            complexity: metrics.complexity.cyclomatic,
            coverage: metrics.testCoverage.lines,
            debt: metrics.maintainability.debt,
        });
    }

    /**
     * Detect evolution patterns from recent events
     * Target: <20ms performance
     */
    async detectEvolutionPatterns(events?: EvolutionEvent[]): Promise<EvolutionPattern[]> {
        const startTime = Date.now();

        try {
            const eventsToAnalyze = events || Array.from(this.evolutionEvents.values());
            const patterns: EvolutionPattern[] = [];

            // Group events by similarity for pattern detection
            const eventGroups = this.groupSimilarEvents(eventsToAnalyze);

            for (const group of eventGroups) {
                if (group.length >= this.patternDetectionThresholds.minOccurrences) {
                    const pattern = this.extractPattern(group);
                    if (pattern && pattern.confidence >= this.patternDetectionThresholds.minConfidence) {
                        patterns.push(pattern);
                        this.detectedPatterns.set(pattern.id, pattern);
                    }
                }
            }

            const duration = Date.now() - startTime;
            if (duration > this.performanceTargets.detectPatterns) {
                console.warn(
                    `CodeEvolutionTracker.detectEvolutionPatterns took ${duration}ms (target: ${this.performanceTargets.detectPatterns}ms)`
                );
            }

            return patterns;
        } catch (error) {
            console.error('Failed to detect evolution patterns:', error);
            throw error;
        }
    }

    /**
     * Analyze architectural trends
     */
    async analyzeArchitecturalTrends(timeframe?: { start: Date; end: Date }): Promise<ArchitecturalTrend[]> {
        const events = timeframe
            ? Array.from(this.evolutionEvents.values()).filter(
                  (e) => e.timestamp >= timeframe.start && e.timestamp <= timeframe.end
              )
            : Array.from(this.evolutionEvents.values());

        const trends: ArchitecturalTrend[] = [];

        // Dependency growth trend
        const dependencyTrend = this.analyzeDependencyTrend(events);
        if (dependencyTrend) trends.push(dependencyTrend);

        // Complexity trend
        const complexityTrend = this.analyzeComplexityTrend();
        if (complexityTrend) trends.push(complexityTrend);

        // Test coverage trend
        const coverageTrend = this.analyzeTestCoverageTrend();
        if (coverageTrend) trends.push(coverageTrend);

        return trends;
    }

    /**
     * Generate comprehensive evolution report
     * Target: <50ms performance (non-real-time operation)
     */
    async generateEvolutionReport(period: { start: Date; end: Date }): Promise<EvolutionReport> {
        const startTime = Date.now();

        try {
            const events = Array.from(this.evolutionEvents.values()).filter(
                (e) => e.timestamp >= period.start && e.timestamp <= period.end
            );

            const patterns = await this.detectEvolutionPatterns(events);
            const trends = await this.analyzeArchitecturalTrends(period);

            // Get quality metrics at start and end of period
            const startMetrics = this.getQualityMetricsNear(period.start);
            const endMetrics = this.getQualityMetricsNear(period.end);

            const report: EvolutionReport = {
                period,
                summary: {
                    totalEvents: events.length,
                    majorRefactorings: events.filter(
                        (e) => e.impact.severity === 'high' || e.impact.severity === 'critical'
                    ).length,
                    architecturalChanges: events.filter(
                        (e) => e.type.includes('dependency') || e.type.includes('signature')
                    ).length,
                    qualityTrend: this.determineQualityTrend(startMetrics, endMetrics),
                },
                patterns,
                trends,
                qualityMetrics: {
                    start: startMetrics || this.getDefaultMetrics(),
                    end: endMetrics || this.getDefaultMetrics(),
                    change: this.calculateMetricsChange(startMetrics, endMetrics),
                },
                recommendations: await this.generateRecommendations(events, patterns, trends),
            };

            const duration = Date.now() - startTime;
            console.log(`Evolution report generated in ${duration}ms`);

            return report;
        } catch (error) {
            console.error('Failed to generate evolution report:', error);
            throw error;
        }
    }

    /**
     * Get evolution events for a specific file or symbol
     */
    getEvolutionHistory(target: string): EvolutionEvent[] {
        return Array.from(this.evolutionEvents.values())
            .filter(
                (event) =>
                    event.file.includes(target) ||
                    event.before?.path?.includes(target) ||
                    event.after?.path?.includes(target)
            )
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    /**
     * Get detected patterns
     */
    getDetectedPatterns(): EvolutionPattern[] {
        return Array.from(this.detectedPatterns.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
    }

    // Private helper methods

    private setupEventListeners(): void {
        // Listen for file system changes
        this.eventBus.on('file:changed', (data: any) => {
            this.trackFileChange(data.path, data.type, data.before, data.after, data.context);
        });

        // Listen for refactoring operations
        this.eventBus.on('refactoring:completed', (data: any) => {
            this.recordEvolutionEvent({
                type: 'symbol_renamed',
                timestamp: new Date(),
                file: data.file,
                before: { signature: data.before },
                after: { signature: data.after },
                context: { message: 'Automated refactoring' },
                impact: {
                    filesAffected: data.filesAffected || 1,
                    symbolsAffected: data.symbolsAffected || 1,
                    testsAffected: data.testsAffected || 0,
                    severity: 'medium',
                },
                metadata: {
                    diffSize: 1,
                    automated: true,
                },
            });
        });
    }

    private async initializeDatabaseSchema(): Promise<void> {
        try {
            // The evolution_events and quality_metrics tables are already created
            // in the main database schema (database-service.ts). Just verify they exist.

            // Verify evolution_events table exists
            const evolutionTable = await this.sharedServices.database.query(
                'SELECT name FROM sqlite_master WHERE type="table" AND name="evolution_events"'
            );

            if (evolutionTable.length === 0) {
                throw new CoreError('evolution_events table not found in database schema', 'DB_SCHEMA_ERROR');
            }

            // Create quality_metrics table if it doesn't exist (this is evolution-tracker specific)
            await this.sharedServices.database.execute(`
        CREATE TABLE IF NOT EXISTS quality_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          cyclomatic_complexity REAL NOT NULL,
          cognitive_complexity REAL NOT NULL,
          halstead_complexity REAL NOT NULL,
          duplication_lines INTEGER NOT NULL,
          duplication_blocks INTEGER NOT NULL,
          duplication_percentage REAL NOT NULL,
          internal_dependencies INTEGER NOT NULL,
          external_dependencies INTEGER NOT NULL,
          circular_dependencies INTEGER NOT NULL,
          test_coverage_lines REAL NOT NULL,
          test_coverage_branches REAL NOT NULL,
          test_coverage_functions REAL NOT NULL,
          maintainability_index REAL NOT NULL,
          technical_debt REAL NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `);

            // Create quality_metrics index
            await this.sharedServices.database.execute(`
        CREATE INDEX IF NOT EXISTS idx_quality_metrics_timestamp ON quality_metrics(timestamp)
      `);
        } catch (error) {
            throw new CoreError(`Failed to initialize evolution database schema: ${error}`, 'DB_SCHEMA_ERROR');
        }
    }

    private async loadEvolutionHistory(): Promise<void> {
        try {
            const rows = await this.sharedServices.database.query(
                'SELECT * FROM evolution_events ORDER BY timestamp DESC LIMIT 5000'
            );

            for (const row of rows) {
                const event: EvolutionEvent = {
                    id: row.id,
                    type: row.type || row.event_type, // Handle both column names
                    timestamp: new Date(row.timestamp * 1000),
                    file: row.file_path,
                    before:
                        row.before_path || row.before_content || row.before_signature
                            ? {
                                  path: row.before_path,
                                  content: row.before_content,
                                  signature: row.before_signature,
                              }
                            : undefined,
                    after:
                        row.after_path || row.after_content || row.after_signature
                            ? {
                                  path: row.after_path,
                                  content: row.after_content,
                                  signature: row.after_signature,
                              }
                            : undefined,
                    context: {
                        commit: row.commit_hash,
                        author: row.author,
                        branch: row.branch,
                        message: row.message,
                    },
                    impact: {
                        filesAffected: row.files_affected,
                        symbolsAffected: row.symbols_affected,
                        testsAffected: row.tests_affected,
                        severity: row.severity,
                    },
                    metadata: {
                        diffSize: row.diff_size,
                        cycleTime: row.cycle_time,
                        rollback: row.rollback,
                        automated: row.automated,
                    },
                };

                this.evolutionEvents.set(event.id, event);
            }
        } catch (error) {
            console.warn('Failed to load evolution history:', error);
        }
    }

    private async loadQualityHistory(): Promise<void> {
        try {
            const rows = await this.sharedServices.database.query(
                'SELECT * FROM quality_metrics ORDER BY timestamp DESC LIMIT 365'
            );

            this.qualityHistory = rows.map((row) => ({
                timestamp: new Date(row.timestamp * 1000),
                complexity: {
                    cyclomatic: row.cyclomatic_complexity,
                    cognitive: row.cognitive_complexity,
                    halstead: row.halstead_complexity,
                },
                duplication: {
                    lines: row.duplication_lines,
                    blocks: row.duplication_blocks,
                    percentage: row.duplication_percentage,
                },
                dependencies: {
                    internal: row.internal_dependencies,
                    external: row.external_dependencies,
                    circular: row.circular_dependencies,
                },
                testCoverage: {
                    lines: row.test_coverage_lines,
                    branches: row.test_coverage_branches,
                    functions: row.test_coverage_functions,
                },
                maintainability: {
                    index: row.maintainability_index,
                    debt: row.technical_debt,
                    hotspots: [], // Would be populated from another query
                },
            }));
        } catch (error) {
            console.warn('Failed to load quality history:', error);
        }
    }

    private async storeEventToDatabase(event: EvolutionEvent): Promise<void> {
        try {
            // Use a transaction to prevent constraint violations and ensure atomicity
            await this.sharedServices.database.transaction(async (query) => {
                // First check if the event already exists
                const existing = await query('SELECT id FROM evolution_events WHERE id = ?', [event.id]);

                if (existing && existing.length > 0) {
                    // Event already exists, this is likely a race condition
                    console.warn(`Evolution event ${event.id} already exists, skipping insert`);
                    return;
                }

                // Insert the new event
                await query(
                    `INSERT INTO evolution_events (
            id, type, event_type, timestamp, file_path, before_path, before_content, before_signature,
            after_path, after_content, after_signature, commit_hash, author, branch, message,
            files_affected, symbols_affected, tests_affected, severity, diff_size,
            cycle_time, rollback, automated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        event.id,
                        event.type,
                        event.type,
                        Math.floor(event.timestamp.getTime() / 1000),
                        event.file,
                        event.before?.path,
                        event.before?.content,
                        event.before?.signature,
                        event.after?.path,
                        event.after?.content,
                        event.after?.signature,
                        event.context.commit,
                        event.context.author,
                        event.context.branch,
                        event.context.message,
                        event.impact.filesAffected,
                        event.impact.symbolsAffected,
                        event.impact.testsAffected,
                        event.impact.severity,
                        event.metadata.diffSize,
                        event.metadata.cycleTime,
                        event.metadata.rollback,
                        event.metadata.automated,
                    ]
                );
            });
        } catch (error) {
            console.error('Failed to store evolution event to database:', error);
            throw error; // Re-throw to trigger retry logic in caller
        }
    }

    private async storeQualityMetricsToDatabase(metrics: CodeQualityMetrics): Promise<void> {
        try {
            await this.sharedServices.database.execute(
                `INSERT INTO quality_metrics (
          timestamp, cyclomatic_complexity, cognitive_complexity, halstead_complexity,
          duplication_lines, duplication_blocks, duplication_percentage,
          internal_dependencies, external_dependencies, circular_dependencies,
          test_coverage_lines, test_coverage_branches, test_coverage_functions,
          maintainability_index, technical_debt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    Math.floor(metrics.timestamp.getTime() / 1000),
                    metrics.complexity.cyclomatic,
                    metrics.complexity.cognitive,
                    metrics.complexity.halstead,
                    metrics.duplication.lines,
                    metrics.duplication.blocks,
                    metrics.duplication.percentage,
                    metrics.dependencies.internal,
                    metrics.dependencies.external,
                    metrics.dependencies.circular,
                    metrics.testCoverage.lines,
                    metrics.testCoverage.branches,
                    metrics.testCoverage.functions,
                    metrics.maintainability.index,
                    metrics.maintainability.debt,
                ]
            );
        } catch (error) {
            console.error('Failed to store quality metrics to database:', error);
        }
    }

    private async detectNewPatterns(events: EvolutionEvent[]): Promise<void> {
        // Detect patterns asynchronously to avoid blocking main operations
        try {
            await this.detectEvolutionPatterns(events);
        } catch (error) {
            console.error('Failed to detect new patterns:', error);
        }
    }

    private async calculateChangeImpact(
        filePath: string,
        changeType: string,
        before?: string,
        after?: string
    ): Promise<EvolutionEvent['impact']> {
        // Simplified impact calculation - would be more sophisticated in practice
        const severity = this.determineSeverity(filePath, changeType, before, after);

        return {
            filesAffected: 1,
            symbolsAffected: changeType === 'modified' ? this.countSymbolChanges(before, after) : 0,
            testsAffected: filePath.includes('.test.') || filePath.includes('.spec.') ? 1 : 0,
            severity,
        };
    }

    private determineSeverity(
        filePath: string,
        changeType: string,
        before?: string,
        after?: string
    ): 'low' | 'medium' | 'high' | 'critical' {
        // Critical changes
        if (filePath.includes('package.json') || filePath.includes('tsconfig.json')) return 'critical';
        if (changeType === 'deleted' && filePath.includes('src/')) return 'high';

        // High impact changes
        if (filePath.includes('index.') || filePath.includes('main.')) return 'high';
        if (before && after && this.calculateDiffSize(before, after) > 100) return 'high';

        // Medium impact
        if (changeType === 'created' || changeType === 'renamed') return 'medium';

        return 'low';
    }

    private determineEvolutionEventType(
        filePath: string,
        changeType: string,
        before?: string,
        after?: string
    ): EvolutionEvent['type'] {
        switch (changeType) {
            case 'created':
                return 'file_created';
            case 'deleted':
                return 'file_deleted';
            case 'renamed':
                return 'file_renamed';
            case 'modified':
                // Analyze the content to determine what kind of modification
                if (this.hasSignatureChanges(before, after)) return 'signature_changed';
                if (this.hasImportChanges(before, after)) return 'dependency_added'; // or removed
                return 'symbol_added'; // Default for modifications
            default:
                return 'symbol_added';
        }
    }

    private calculateDiffSize(before?: string, after?: string): number {
        if (!before || !after) return 0;

        const beforeLines = before.split('\n');
        const afterLines = after.split('\n');

        return Math.abs(afterLines.length - beforeLines.length);
    }

    private countSymbolChanges(before?: string, after?: string): number {
        // Simplified symbol counting - would use AST parsing in practice
        if (!before || !after) return 0;

        const beforeSymbols = (before.match(/\b(function|class|interface|type|const|let|var)\s+\w+/g) || []).length;
        const afterSymbols = (after.match(/\b(function|class|interface|type|const|let|var)\s+\w+/g) || []).length;

        return Math.abs(afterSymbols - beforeSymbols);
    }

    private hasSignatureChanges(before?: string, after?: string): boolean {
        if (!before || !after) return false;
        // Simplified - would check for actual signature changes in practice
        return before.includes('(') !== after.includes('(') || before.includes('=>') !== after.includes('=>');
    }

    private hasImportChanges(before?: string, after?: string): boolean {
        if (!before || !after) return false;
        return (
            before.includes('import') !== after.includes('import') ||
            before.includes('require') !== after.includes('require')
        );
    }

    private isAutomatedChange(message: string): boolean {
        const automatedKeywords = ['automated', 'generated', 'auto', 'bot', 'ci', 'build'];
        return automatedKeywords.some((keyword) => message.toLowerCase().includes(keyword));
    }

    private groupSimilarEvents(events: EvolutionEvent[]): EvolutionEvent[][] {
        // Simple grouping by event type and file pattern
        const groups = new Map<string, EvolutionEvent[]>();

        for (const event of events) {
            const groupKey = `${event.type}:${this.getFilePattern(event.file)}`;
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(event);
        }

        return Array.from(groups.values());
    }

    private getFilePattern(filePath: string): string {
        // Extract pattern from file path (e.g., "src/*.ts", "test/*.spec.ts")
        const parts = filePath.split('/');
        const fileName = parts[parts.length - 1];
        const extension = fileName.split('.').slice(-1)[0];
        const directory = parts.length > 1 ? parts[parts.length - 2] : '';

        return `${directory}/*.${extension}`;
    }

    private extractPattern(events: EvolutionEvent[]): EvolutionPattern | null {
        if (events.length === 0) return null;

        const id = uuidv4();
        const type = this.inferPatternType(events);
        const characteristics = this.calculateCharacteristics(events);

        return {
            id,
            type,
            name: this.generatePatternName(type, characteristics),
            description: this.generatePatternDescription(type, events),
            frequency: events.length,
            confidence: Math.min(0.9, events.length / 10), // Higher confidence with more examples
            examples: events.slice(0, 5), // Keep first 5 as examples
            characteristics,
            detectedAt: new Date(),
            lastSeen: new Date(Math.max(...events.map((e) => e.timestamp.getTime()))),
        };
    }

    private inferPatternType(events: EvolutionEvent[]): EvolutionPattern['type'] {
        const types = events.map((e) => e.type);

        if (types.every((t) => t.includes('rename'))) return 'refactoring';
        if (types.every((t) => t.includes('dependency'))) return 'migration';
        if (types.every((t) => t === 'file_created')) return 'growth';
        if (types.every((t) => t === 'file_deleted')) return 'cleanup';

        return 'architectural';
    }

    private calculateCharacteristics(events: EvolutionEvent[]): EvolutionPattern['characteristics'] {
        const files = events.map((e) => this.getFilePattern(e.file));
        const operations = events.map((e) => e.type);
        const timespan = this.calculateTimespan(events);

        return {
            typicalFiles: Array.from(new Set(files)),
            typicalOperations: Array.from(new Set(operations)),
            timespan,
            impact: {
                files: Math.round(events.reduce((sum, e) => sum + e.impact.filesAffected, 0) / events.length),
                symbols: Math.round(events.reduce((sum, e) => sum + e.impact.symbolsAffected, 0) / events.length),
            },
        };
    }

    private calculateTimespan(events: EvolutionEvent[]): { min: number; max: number; avg: number } {
        if (events.length < 2) return { min: 0, max: 0, avg: 0 };

        const timestamps = events.map((e) => e.timestamp.getTime()).sort((a, b) => a - b);
        const intervals = [];

        for (let i = 1; i < timestamps.length; i++) {
            intervals.push((timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60 * 24)); // Convert to days
        }

        return {
            min: Math.min(...intervals),
            max: Math.max(...intervals),
            avg: intervals.reduce((sum, i) => sum + i, 0) / intervals.length,
        };
    }

    private generatePatternName(type: EvolutionPattern['type'], characteristics: any): string {
        switch (type) {
            case 'refactoring':
                return `${characteristics.typicalFiles[0]} refactoring`;
            case 'migration':
                return `Dependency migration`;
            case 'growth':
                return `New ${characteristics.typicalFiles[0]} files`;
            case 'cleanup':
                return `${characteristics.typicalFiles[0]} cleanup`;
            default:
                return `Architectural change`;
        }
    }

    private generatePatternDescription(type: EvolutionPattern['type'], events: EvolutionEvent[]): string {
        const fileCount = new Set(events.map((e) => e.file)).size;
        return `Pattern involving ${events.length} events across ${fileCount} files of type ${type}`;
    }

    private analyzeDependencyTrend(events: EvolutionEvent[]): ArchitecturalTrend | null {
        const dependencyEvents = events.filter((e) => e.type.includes('dependency'));
        if (dependencyEvents.length < 3) return null;

        const dataPoints = dependencyEvents.map((e) => ({
            timestamp: e.timestamp,
            value: e.type === 'dependency_added' ? 1 : -1,
        }));

        return {
            type: 'dependency_growth',
            direction: this.calculateTrendDirection(dataPoints),
            strength: this.calculateTrendStrength(dataPoints),
            timeframe: {
                start: dataPoints[0].timestamp,
                end: dataPoints[dataPoints.length - 1].timestamp,
            },
            dataPoints,
            evidence: dependencyEvents,
        };
    }

    private analyzeComplexityTrend(): ArchitecturalTrend | null {
        if (this.qualityHistory.length < 3) return null;

        const dataPoints = this.qualityHistory
            .slice(-30) // Last 30 measurements
            .map((m) => ({
                timestamp: m.timestamp,
                value: m.complexity.cyclomatic,
            }));

        return {
            type: 'complexity_increase',
            direction: this.calculateTrendDirection(dataPoints),
            strength: this.calculateTrendStrength(dataPoints),
            timeframe: {
                start: dataPoints[0].timestamp,
                end: dataPoints[dataPoints.length - 1].timestamp,
            },
            dataPoints,
            evidence: [],
        };
    }

    private analyzeTestCoverageTrend(): ArchitecturalTrend | null {
        if (this.qualityHistory.length < 3) return null;

        const dataPoints = this.qualityHistory.slice(-30).map((m) => ({
            timestamp: m.timestamp,
            value: m.testCoverage.lines,
        }));

        return {
            type: 'test_coverage_change',
            direction: this.calculateTrendDirection(dataPoints),
            strength: this.calculateTrendStrength(dataPoints),
            timeframe: {
                start: dataPoints[0].timestamp,
                end: dataPoints[dataPoints.length - 1].timestamp,
            },
            dataPoints,
            evidence: [],
        };
    }

    private calculateTrendDirection(
        dataPoints: Array<{ timestamp: Date; value: number }>
    ): 'increasing' | 'decreasing' | 'stable' {
        if (dataPoints.length < 2) return 'stable';

        const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
        const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));

        const firstAvg = firstHalf.reduce((sum, dp) => sum + dp.value, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, dp) => sum + dp.value, 0) / secondHalf.length;

        const change = (secondAvg - firstAvg) / firstAvg;

        if (Math.abs(change) < 0.05) return 'stable';
        return change > 0 ? 'increasing' : 'decreasing';
    }

    private calculateTrendStrength(dataPoints: Array<{ timestamp: Date; value: number }>): number {
        if (dataPoints.length < 2) return 0;

        // Simple linear regression to measure trend strength
        const n = dataPoints.length;
        const sumX = dataPoints.reduce((sum, _, i) => sum + i, 0);
        const sumY = dataPoints.reduce((sum, dp) => sum + dp.value, 0);
        const sumXY = dataPoints.reduce((sum, dp, i) => sum + i * dp.value, 0);
        const sumX2 = dataPoints.reduce((sum, _, i) => sum + i * i, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Calculate R-squared
        const avgY = sumY / n;
        const totalSumSquares = dataPoints.reduce((sum, dp) => sum + (dp.value - avgY) ** 2, 0);
        const residualSumSquares = dataPoints.reduce((sum, dp, i) => {
            const predicted = slope * i + intercept;
            return sum + (dp.value - predicted) ** 2;
        }, 0);

        const r2 = 1 - residualSumSquares / totalSumSquares;
        return Math.max(0, Math.min(1, r2));
    }

    private getQualityMetricsNear(date: Date): CodeQualityMetrics | null {
        const sortedMetrics = this.qualityHistory
            .map((m) => ({ metrics: m, distance: Math.abs(m.timestamp.getTime() - date.getTime()) }))
            .sort((a, b) => a.distance - b.distance);

        return sortedMetrics.length > 0 ? sortedMetrics[0].metrics : null;
    }

    private determineQualityTrend(
        start: CodeQualityMetrics | null,
        end: CodeQualityMetrics | null
    ): 'improving' | 'degrading' | 'stable' {
        if (!start || !end) return 'stable';

        const complexityChange =
            (end.complexity.cyclomatic - start.complexity.cyclomatic) / start.complexity.cyclomatic;
        const coverageChange = (end.testCoverage.lines - start.testCoverage.lines) / start.testCoverage.lines;
        const debtChange = (end.maintainability.debt - start.maintainability.debt) / start.maintainability.debt;

        // Quality improves if complexity decreases, coverage increases, and debt decreases
        const score = -complexityChange + coverageChange - debtChange;

        if (Math.abs(score) < 0.05) return 'stable';
        return score > 0 ? 'improving' : 'degrading';
    }

    private calculateMetricsChange(
        start: CodeQualityMetrics | null,
        end: CodeQualityMetrics | null
    ): { [key: string]: { value: number; percentage: number } } {
        if (!start || !end) return {};

        const changes: { [key: string]: { value: number; percentage: number } } = {};

        // Complexity changes
        changes.cyclomaticComplexity = {
            value: end.complexity.cyclomatic - start.complexity.cyclomatic,
            percentage: ((end.complexity.cyclomatic - start.complexity.cyclomatic) / start.complexity.cyclomatic) * 100,
        };

        // Coverage changes
        changes.testCoverage = {
            value: end.testCoverage.lines - start.testCoverage.lines,
            percentage: ((end.testCoverage.lines - start.testCoverage.lines) / start.testCoverage.lines) * 100,
        };

        // Debt changes
        changes.technicalDebt = {
            value: end.maintainability.debt - start.maintainability.debt,
            percentage: ((end.maintainability.debt - start.maintainability.debt) / start.maintainability.debt) * 100,
        };

        return changes;
    }

    private async generateRecommendations(
        events: EvolutionEvent[],
        patterns: EvolutionPattern[],
        trends: ArchitecturalTrend[]
    ): Promise<EvolutionReport['recommendations']> {
        const recommendations: EvolutionReport['recommendations'] = [];

        // Recommendations based on patterns
        for (const pattern of patterns) {
            if (pattern.type === 'refactoring' && pattern.confidence > 0.8) {
                recommendations.push({
                    type: 'process',
                    priority: 'medium',
                    description: `Consider automating the "${pattern.name}" pattern`,
                    rationale: `This pattern occurs frequently (${pattern.frequency} times) with high confidence`,
                    effort: 8,
                    impact: 0.7,
                });
            }
        }

        // Recommendations based on trends
        for (const trend of trends) {
            if (trend.type === 'complexity_increase' && trend.direction === 'increasing' && trend.strength > 0.7) {
                recommendations.push({
                    type: 'refactoring',
                    priority: 'high',
                    description: 'Address increasing code complexity',
                    rationale: 'Strong upward trend in complexity detected',
                    effort: 16,
                    impact: 0.8,
                });
            }

            if (trend.type === 'test_coverage_change' && trend.direction === 'decreasing' && trend.strength > 0.6) {
                recommendations.push({
                    type: 'quality',
                    priority: 'high',
                    description: 'Improve test coverage',
                    rationale: 'Test coverage is declining consistently',
                    effort: 12,
                    impact: 0.9,
                });
            }
        }

        return recommendations;
    }

    private getDefaultMetrics(): CodeQualityMetrics {
        return {
            timestamp: new Date(),
            complexity: { cyclomatic: 0, cognitive: 0, halstead: 0 },
            duplication: { lines: 0, blocks: 0, percentage: 0 },
            dependencies: { internal: 0, external: 0, circular: 0 },
            testCoverage: { lines: 0, branches: 0, functions: 0 },
            maintainability: { index: 0, debt: 0, hotspots: [] },
        };
    }

    /**
     * Track change - wrapper around recordEvolutionEvent for test compatibility
     */
    async trackChange(
        event: Omit<EvolutionEvent, 'id'>
    ): Promise<{ success: boolean; eventId?: string; error?: string }> {
        try {
            const eventId = await this.recordEvolutionEvent(event);
            return { success: true, eventId };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Get evolution patterns detected from the events
     */
    async getEvolutionPatterns(): Promise<EvolutionPattern[]> {
        return Array.from(this.detectedPatterns.values());
    }

    /**
     * Get architectural trends over time
     */
    async getArchitecturalTrends(): Promise<
        Array<{
            pattern: string;
            frequency: number;
            confidence: number;
            timeRange: { start: Date; end: Date };
        }>
    > {
        const trends = [];
        const events = Array.from(this.evolutionEvents.values());

        if (events.length === 0) {
            return [];
        }

        // Sort events by timestamp
        events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const firstEvent = events[0];
        const lastEvent = events[events.length - 1];

        // Analyze class to interface refactoring trend
        const classToInterfaceCount = events.filter(
            (e) => e.before?.content?.includes('class ') && e.after?.content?.includes('interface ')
        ).length;

        if (classToInterfaceCount > 0) {
            trends.push({
                pattern: 'class_to_interface_migration',
                frequency: classToInterfaceCount,
                confidence: Math.min(0.9, classToInterfaceCount * 0.3),
                timeRange: { start: firstEvent.timestamp, end: lastEvent.timestamp },
            });
        }

        return trends;
    }

    /**
     * Get refactoring patterns detected
     */
    async getRefactoringPatterns(): Promise<
        Array<{
            type: string;
            before: string;
            after: string;
            confidence: number;
        }>
    > {
        const patterns = [];
        const events = Array.from(this.evolutionEvents.values()).filter(
            (e) => e.type === 'refactoring' || (e.before?.content && e.after?.content)
        );

        for (const event of events) {
            if (event.before?.content && event.after?.content) {
                patterns.push({
                    type: event.context?.refactoringType || 'general_refactoring',
                    before: event.before.content,
                    after: event.after.content,
                    confidence: 0.7, // Base confidence for detected refactorings
                });
            }
        }

        return patterns;
    }

    /**
     * Get evolution metrics and analytics
     */
    async getEvolutionMetrics(): Promise<{
        totalChanges: number;
        averageChangeSize: number;
        mostActiveFiles: string[];
        changeVelocity: number;
    }> {
        const events = Array.from(this.evolutionEvents.values());
        const totalChanges = events.length;

        // Calculate average change size
        const totalDiffSize = events.reduce((sum, e) => sum + (e.metadata?.diffSize || 0), 0);
        const averageChangeSize = totalChanges > 0 ? totalDiffSize / totalChanges : 0;

        // Find most active files
        const fileActivity = new Map<string, number>();
        events.forEach((e) => {
            const count = fileActivity.get(e.file) || 0;
            fileActivity.set(e.file, count + 1);
        });

        const mostActiveFiles = Array.from(fileActivity.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([file]) => file);

        // Calculate change velocity (changes per day)
        let changeVelocity = 0;
        if (events.length > 1) {
            const sortedEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            const timespan =
                sortedEvents[sortedEvents.length - 1].timestamp.getTime() - sortedEvents[0].timestamp.getTime();
            const days = timespan / (1000 * 60 * 60 * 24);
            changeVelocity = days > 0 ? events.length / days : 0;
        }

        return {
            totalChanges,
            averageChangeSize,
            mostActiveFiles,
            changeVelocity,
        };
    }

    /**
     * Get diagnostic information for debugging
     */
    getDiagnostics(): Record<string, any> {
        return {
            initialized: this.initialized,
            evolutionEventsCount: this.evolutionEvents.size,
            detectedPatternsCount: this.detectedPatterns.size,
            qualityHistorySize: this.qualityHistory.length,
            patternDetectionThresholds: this.patternDetectionThresholds,
            performanceTargets: this.performanceTargets,
            timestamp: Date.now(),
        };
    }
}
