/**
 * FeedbackLoopSystem - Tracks accepted/rejected suggestions and learns from user corrections
 * This system implements the continuous learning loop from user interactions
 */

import { v4 as uuidv4 } from 'uuid';
import type { SharedServices } from '../core/services/index.js';
import { CoreError, type EventBus } from '../core/types.js';
import type { PatternLearner } from '../patterns/pattern-learner.js';
import { Pattern, PatternCategory, Suggestion } from '../types/core.js';

export interface FeedbackEvent {
    id: string;
    type: 'accept' | 'reject' | 'modify' | 'ignore';
    suggestionId: string;
    patternId?: string;
    originalSuggestion: string;
    finalValue?: string; // What the user actually used
    context: {
        file: string;
        operation: string; // 'rename', 'refactor', 'completion', etc.
        timestamp: Date;
        userId?: string;
        confidence: number;
    };
    metadata: {
        timeToDecision?: number; // milliseconds from suggestion to decision
        keystrokes?: number; // if user modified the suggestion
        alternativesShown?: number;
        source: 'vscode' | 'claude' | 'cli' | 'web' | 'unknown';
    };
}

export interface FeedbackStats {
    totalFeedbacks: number;
    acceptanceRate: number;
    rejectionRate: number;
    modificationRate: number;
    averageConfidence: number;
    topRejectionReasons: Array<{ reason: string; count: number }>;
    patternPerformance: Array<{ patternId: string; acceptanceRate: number; usageCount: number }>;
    recentTrends: {
        last24h: { accepted: number; rejected: number; modified: number };
        last7d: { accepted: number; rejected: number; modified: number };
        last30d: { accepted: number; rejected: number; modified: number };
    };
}

export interface LearningInsight {
    type: 'pattern_weakness' | 'pattern_strength' | 'new_trend' | 'user_preference';
    description: string;
    confidence: number;
    actionable: boolean;
    suggestedAction?: string;
    evidence: string[];
    discoveredAt: Date;
}

export class FeedbackLoopSystem {
    private sharedServices: SharedServices;
    private eventBus: EventBus;
    private patternLearner: PatternLearner | null = null;
    private initialized = false;
    private feedbackHistory: Map<string, FeedbackEvent> = new Map();
    private learningThresholds = {
        minFeedbacksToLearn: 5,
        weakPatternThreshold: 0.3, // Below 30% acceptance rate
        strongPatternThreshold: 0.8, // Above 80% acceptance rate
        modificationSimilarityThreshold: 0.7, // How similar modification needs to be to original
    };

    // Performance target: <20ms for learning operations
    private performanceTargets = {
        recordFeedback: 10, // ms
        updatePatternStrength: 15, // ms
        generateInsights: 20, // ms
    };

    constructor(
        sharedServices: SharedServices,
        eventBus: EventBus,
        config?: {
            minFeedbacksToLearn?: number;
            weakPatternThreshold?: number;
            strongPatternThreshold?: number;
        }
    ) {
        this.sharedServices = sharedServices;
        this.eventBus = eventBus;

        if (config) {
            this.learningThresholds = { ...this.learningThresholds, ...config };
        }

        this.setupEventListeners();
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.initializeDatabaseSchema();
            await this.loadFeedbackHistory();

            this.initialized = true;

            this.eventBus.emit('feedback-loop:initialized', {
                timestamp: Date.now(),
                historySize: this.feedbackHistory.size,
            });
        } catch (error) {
            throw new CoreError(
                `FeedbackLoopSystem initialization failed: ${error instanceof Error ? error.message : String(error)}`,
                'FEEDBACK_INIT_ERROR'
            );
        }
    }

    async dispose(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        this.feedbackHistory.clear();
        this.initialized = false;

        this.eventBus.emit('feedback-loop:disposed', {
            timestamp: Date.now(),
        });
    }

    /**
     * Record user feedback on a suggestion
     * Target: <10ms performance
     */
    async recordFeedback(feedback: Omit<FeedbackEvent, 'id'>): Promise<string> {
        const startTime = Date.now();

        if (!this.initialized) {
            throw new CoreError('FeedbackLoopSystem not initialized', 'NOT_INITIALIZED');
        }

        try {
            // Validate and sanitize input data for corrupted/invalid feedback
            const sanitizedFeedback = this.validateAndSanitizeFeedback(feedback);

            const feedbackId = uuidv4();
            const fullFeedback: FeedbackEvent = {
                id: feedbackId,
                ...sanitizedFeedback,
            };

            // Store in memory for quick access
            this.feedbackHistory.set(feedbackId, fullFeedback);

            // Persist to database
            await this.storeFeedbackToDatabase(fullFeedback);

            // Update pattern confidence immediately for real-time learning
            if (sanitizedFeedback.patternId) {
                const confidence = sanitizedFeedback.context?.confidence ?? 0.5;
                await this.updatePatternConfidence(sanitizedFeedback.patternId, sanitizedFeedback.type, confidence);
            }

            // Emit event for other systems
            this.eventBus.emit('feedback-recorded', {
                feedbackId,
                type: sanitizedFeedback.type,
                patternId: sanitizedFeedback.patternId,
                timestamp: Date.now(),
            });

            const duration = Date.now() - startTime;
            if (duration > this.performanceTargets.recordFeedback) {
                console.warn(
                    `FeedbackLoopSystem.recordFeedback took ${duration}ms (target: ${this.performanceTargets.recordFeedback}ms)`
                );
            }

            return feedbackId;
        } catch (error) {
            this.eventBus.emit('feedback-loop:error', {
                operation: 'recordFeedback',
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    /**
     * Validate and sanitize feedback data to handle corrupted input
     */
    private validateAndSanitizeFeedback(feedback: any): Omit<FeedbackEvent, 'id'> {
        // Handle null/undefined original feedback
        if (!feedback) {
            throw new CoreError('Feedback cannot be null or undefined', 'INVALID_FEEDBACK');
        }

        // Provide defaults for required fields if missing/corrupted
        const sanitized: Omit<FeedbackEvent, 'id'> = {
            suggestionId: feedback.suggestionId || `fallback-${Date.now()}`,
            type: this.validateFeedbackType(feedback.type) ? feedback.type : 'accept',
            originalSuggestion: feedback.originalSuggestion || 'unknown',
            finalValue: feedback.finalValue || feedback.originalSuggestion || 'unknown',
            context: this.sanitizeContext(feedback.context),
            metadata: this.sanitizeMetadata(feedback.metadata),
            patternId: feedback.patternId || undefined,
        };

        return sanitized;
    }

    /**
     * Validate feedback type
     */
    private validateFeedbackType(type: any): boolean {
        const validTypes = ['accept', 'reject', 'modify', 'ignore'];
        return typeof type === 'string' && validTypes.includes(type);
    }

    /**
     * Sanitize context data
     */
    private sanitizeContext(context: any): FeedbackEvent['context'] {
        if (!context || typeof context !== 'object') {
            return {
                file: 'unknown',
                operation: 'unknown',
                confidence: 0.5,
                timestamp: new Date(),
            };
        }

        return {
            file: typeof context.file === 'string' ? context.file : 'unknown',
            operation: typeof context.operation === 'string' ? context.operation : 'unknown',
            confidence: typeof context.confidence === 'number' ? Math.max(0, Math.min(1, context.confidence)) : 0.5,
            timestamp: context.timestamp instanceof Date ? context.timestamp : new Date(),
        };
    }

    /**
     * Sanitize metadata
     */
    private sanitizeMetadata(metadata: any): FeedbackEvent['metadata'] {
        if (!metadata || typeof metadata !== 'object') {
            return {
                source: 'unknown',
                keystrokes: 0,
                timeToDecision: 0,
            };
        }

        return {
            source: typeof metadata.source === 'string' ? metadata.source : 'unknown',
            keystrokes: typeof metadata.keystrokes === 'number' ? Math.max(0, metadata.keystrokes) : 0,
            timeToDecision: typeof metadata.timeToDecision === 'number' ? Math.max(0, metadata.timeToDecision) : 0,
        };
    }

    /**
     * Learn from user corrections - when user modifies a suggestion
     * Target: <15ms performance
     */
    async learnFromCorrection(
        originalSuggestion: string,
        userCorrection: string,
        context: {
            file: string;
            operation: string;
            patternId?: string;
            confidence: number;
        }
    ): Promise<void> {
        const startTime = Date.now();

        try {
            // Calculate similarity between original and correction
            const similarity = this.calculateSimilarity(originalSuggestion, userCorrection);

            if (similarity >= this.learningThresholds.modificationSimilarityThreshold) {
                // User made minor modification - strengthen pattern with adjustment
                if (context.patternId && this.patternLearner) {
                    await this.refinePattern(context.patternId, originalSuggestion, userCorrection, context);
                }
            } else {
                // User made major change - this might indicate a new pattern
                if (this.patternLearner) {
                    await this.patternLearner.learnFromRename(originalSuggestion, userCorrection, {
                        file: context.file,
                        surroundingSymbols: [], // Would be populated from real context
                        timestamp: new Date(),
                    });
                }
            }

            // Record the correction as feedback
            await this.recordFeedback({
                type: 'modify',
                suggestionId: uuidv4(), // Would be passed from calling code
                patternId: context.patternId,
                originalSuggestion,
                finalValue: userCorrection,
                context: {
                    file: context.file,
                    operation: context.operation,
                    timestamp: new Date(),
                    confidence: context.confidence,
                },
                metadata: {
                    source: 'vscode', // Would be detected from calling context
                    keystrokes: Math.abs(userCorrection.length - originalSuggestion.length),
                },
            });

            const duration = Date.now() - startTime;
            if (duration > this.performanceTargets.updatePatternStrength) {
                console.warn(
                    `FeedbackLoopSystem.learnFromCorrection took ${duration}ms (target: ${this.performanceTargets.updatePatternStrength}ms)`
                );
            }
        } catch (error) {
            console.error('Failed to learn from correction:', error);
            // Don't throw - system should continue working even if learning fails
            this.eventBus.emit('feedback-loop:error', {
                operation: 'learnFromCorrection',
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Set pattern learner reference for integration
     */
    setPatternLearner(patternLearner: PatternLearner): void {
        this.patternLearner = patternLearner;
    }

    /**
     * Get feedback statistics and performance metrics
     */
    async getFeedbackStats(timeRange?: { from: Date; to: Date }): Promise<FeedbackStats> {
        const feedbacks = timeRange
            ? Array.from(this.feedbackHistory.values()).filter(
                  (f) => f.context.timestamp >= timeRange.from && f.context.timestamp <= timeRange.to
              )
            : Array.from(this.feedbackHistory.values());

        if (feedbacks.length === 0) {
            return this.getEmptyStats();
        }

        const totalFeedbacks = feedbacks.length;
        const accepted = feedbacks.filter((f) => f.type === 'accept').length;
        const rejected = feedbacks.filter((f) => f.type === 'reject').length;
        const modified = feedbacks.filter((f) => f.type === 'modify').length;

        // Pattern performance analysis
        const patternPerformance = new Map<string, { accepted: number; total: number }>();
        for (const feedback of feedbacks) {
            if (feedback.patternId) {
                const stats = patternPerformance.get(feedback.patternId) || { accepted: 0, total: 0 };
                stats.total++;
                if (feedback.type === 'accept') {
                    stats.accepted++;
                }
                patternPerformance.set(feedback.patternId, stats);
            }
        }

        // Time-based trends
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        return {
            totalFeedbacks,
            acceptanceRate: accepted / totalFeedbacks,
            rejectionRate: rejected / totalFeedbacks,
            modificationRate: modified / totalFeedbacks,
            averageConfidence:
                Math.round((feedbacks.reduce((sum, f) => sum + f.context.confidence, 0) / totalFeedbacks) * 100) / 100,
            topRejectionReasons: [], // Would be implemented based on rejection categorization
            patternPerformance: Array.from(patternPerformance.entries()).map(([patternId, stats]) => ({
                patternId,
                acceptanceRate: stats.accepted / stats.total,
                usageCount: stats.total,
            })),
            recentTrends: {
                last24h: this.getTrendStats(feedbacks, last24h),
                last7d: this.getTrendStats(feedbacks, last7d),
                last30d: this.getTrendStats(feedbacks, last30d),
            },
        };
    }

    /**
     * Generate learning insights based on feedback patterns
     * Target: <20ms performance
     */
    async generateInsights(): Promise<LearningInsight[]> {
        const startTime = Date.now();
        const insights: LearningInsight[] = [];

        try {
            const stats = await this.getFeedbackStats();

            // Insight 1: Weak patterns
            for (const pattern of stats.patternPerformance) {
                const acceptanceRate = Number(pattern.acceptanceRate) || 0;
                const usageCount = Number(pattern.usageCount) || 0;

                if (
                    acceptanceRate < this.learningThresholds.weakPatternThreshold &&
                    usageCount >= this.learningThresholds.minFeedbacksToLearn
                ) {
                    insights.push({
                        type: 'pattern_weakness',
                        description: `Pattern ${pattern.patternId} has low acceptance rate (${(acceptanceRate * 100).toFixed(1)}%)`,
                        confidence: 1 - acceptanceRate,
                        actionable: true,
                        suggestedAction: 'Consider reviewing and refining this pattern',
                        evidence: [`${usageCount} usages with ${(acceptanceRate * 100).toFixed(1)}% acceptance`],
                        discoveredAt: new Date(),
                    });
                }
            }

            // Insight 2: Strong patterns
            for (const pattern of stats.patternPerformance) {
                const acceptanceRate = Number(pattern.acceptanceRate) || 0;
                const usageCount = Number(pattern.usageCount) || 0;

                if (
                    acceptanceRate > this.learningThresholds.strongPatternThreshold &&
                    usageCount >= this.learningThresholds.minFeedbacksToLearn
                ) {
                    insights.push({
                        type: 'pattern_strength',
                        description: `Pattern ${pattern.patternId} has high acceptance rate (${(acceptanceRate * 100).toFixed(1)}%)`,
                        confidence: acceptanceRate,
                        actionable: true,
                        suggestedAction: 'Consider promoting this pattern for wider use',
                        evidence: [`${usageCount} usages with ${(acceptanceRate * 100).toFixed(1)}% acceptance`],
                        discoveredAt: new Date(),
                    });
                }
            }

            // Insight 3: High modification rate
            const modificationRate = Number(stats.modificationRate) || 0;
            const totalFeedbacks = Number(stats.totalFeedbacks) || 0;

            if (modificationRate > 0.4) {
                insights.push({
                    type: 'user_preference',
                    description: `High modification rate (${(modificationRate * 100).toFixed(1)}%) suggests suggestions need refinement`,
                    confidence: modificationRate,
                    actionable: true,
                    suggestedAction: 'Analyze modified suggestions to improve pattern accuracy',
                    evidence: [
                        `${Math.round(totalFeedbacks * modificationRate)} modifications out of ${totalFeedbacks} suggestions`,
                    ],
                    discoveredAt: new Date(),
                });
            }

            const duration = Date.now() - startTime;
            if (duration > this.performanceTargets.generateInsights) {
                console.warn(
                    `FeedbackLoopSystem.generateInsights took ${duration}ms (target: ${this.performanceTargets.generateInsights}ms)`
                );
            }

            return insights;
        } catch (error) {
            console.error('Failed to generate insights:', error);
            throw error;
        }
    }

    /**
     * Get feedback events for a specific pattern
     */
    getFeedbackForPattern(patternId: string): FeedbackEvent[] {
        return Array.from(this.feedbackHistory.values())
            .filter((feedback) => feedback.patternId === patternId)
            .sort((a, b) => b.context.timestamp.getTime() - a.context.timestamp.getTime());
    }

    /**
     * Get recent feedback events
     */
    getRecentFeedback(limit: number = 100): FeedbackEvent[] {
        return Array.from(this.feedbackHistory.values())
            .sort((a, b) => b.context.timestamp.getTime() - a.context.timestamp.getTime())
            .slice(0, limit);
    }

    // Private helper methods

    private setupEventListeners(): void {
        // Listen for pattern application events to potentially record feedback
        this.eventBus.on('pattern:applied', (data: any) => {
            // This would trigger when patterns are used, allowing us to prepare for feedback
            console.log('Pattern applied, ready to receive feedback:', data.patternId);
        });

        // Listen for suggestion events
        this.eventBus.on('suggestion:provided', (data: any) => {
            // Track suggestions provided to users for later feedback correlation
            console.log('Suggestion provided:', data.suggestionId);
        });
    }

    private async initializeDatabaseSchema(): Promise<void> {
        try {
            // The feedback tables are created in database-service.ts. Verify the
            // full-fidelity table and legacy compatibility tables are accessible.
            for (const tableName of ['feedback_events', 'learning_feedback', 'feedback_corrections']) {
                const rows = await this.sharedServices.database.query(
                    'SELECT name FROM sqlite_master WHERE type="table" AND name=?',
                    [tableName]
                );
                if (rows.length === 0) {
                    throw new CoreError(`Missing feedback table: ${tableName}`, 'DB_SCHEMA_ERROR');
                }
            }
        } catch (error) {
            throw new CoreError(`Failed to verify feedback database schema: ${error}`, 'DB_SCHEMA_ERROR');
        }
    }

    private async loadFeedbackHistory(): Promise<void> {
        try {
            const rows = await this.sharedServices.database.query(
                'SELECT * FROM feedback_events ORDER BY timestamp DESC LIMIT 1000'
            );

            for (const row of rows) {
                const rawTimestamp = typeof row.timestamp === 'number' ? row.timestamp : Number(row.timestamp);
                const timestamp = rawTimestamp > 0 && rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
                const feedback: FeedbackEvent = {
                    id: String(row.id),
                    type: this.validateFeedbackType(row.type) ? row.type : 'ignore',
                    suggestionId: String(row.suggestion_id || ''),
                    patternId: row.pattern_id || undefined,
                    originalSuggestion: String(row.original_suggestion || ''),
                    finalValue: row.final_value || undefined,
                    context: {
                        file: String(row.file_path || 'unknown'),
                        operation: String(row.operation || 'unknown'),
                        timestamp: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()),
                        userId: row.user_id || undefined,
                        confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence || 0.5),
                    },
                    metadata: {
                        timeToDecision: row.time_to_decision ?? undefined,
                        keystrokes: row.keystrokes ?? undefined,
                        alternativesShown: row.alternatives_shown ?? undefined,
                        source: typeof row.source === 'string' ? row.source : 'unknown',
                    },
                };

                this.feedbackHistory.set(feedback.id, feedback);
            }

            if (this.feedbackHistory.size === 0) {
                await this.loadLegacyFeedbackHistory();
            }
        } catch (error) {
            console.warn('Failed to load feedback history:', error);
            // Don't throw - system can start with empty history
        }
    }

    private async loadLegacyFeedbackHistory(): Promise<void> {
        const rows = await this.sharedServices.database.query(
            'SELECT * FROM learning_feedback ORDER BY timestamp DESC LIMIT 1000'
        );

        for (const row of rows) {
            const feedback: FeedbackEvent = {
                id: `legacy-${String(row.id)}`,
                type: row.accepted ? 'accept' : 'reject',
                suggestionId: String(row.request_id || ''),
                patternId: undefined,
                originalSuggestion: String(row.suggestion || ''),
                finalValue: row.actual_choice || undefined,
                context: {
                    file: 'unknown',
                    operation: 'unknown',
                    timestamp: new Date(Number(row.timestamp || 0) * 1000),
                    userId: undefined,
                    confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence || 0.5),
                },
                metadata: {
                    source: 'unknown',
                },
            };

            this.feedbackHistory.set(feedback.id, feedback);
        }
    }

    private async storeFeedbackToDatabase(feedback: FeedbackEvent): Promise<void> {
        try {
            const confidence = feedback.context?.confidence ?? 0.5;
            const timestamp = feedback.context?.timestamp ?? new Date();

            await this.sharedServices.database.execute(
                `INSERT OR REPLACE INTO feedback_events (
          id, type, suggestion_id, pattern_id, original_suggestion, final_value,
          file_path, operation, user_id, confidence, source, time_to_decision,
          keystrokes, alternatives_shown, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    feedback.id,
                    feedback.type,
                    feedback.suggestionId,
                    feedback.patternId || null,
                    feedback.originalSuggestion,
                    feedback.finalValue || null,
                    feedback.context.file,
                    feedback.context.operation,
                    feedback.context.userId || null,
                    confidence,
                    feedback.metadata.source || 'unknown',
                    feedback.metadata.timeToDecision ?? null,
                    feedback.metadata.keystrokes ?? null,
                    feedback.metadata.alternativesShown ?? null,
                    timestamp.getTime(),
                ]
            );
        } catch (error) {
            console.error('Failed to store feedback to database:', error);
            // Don't throw - we have in-memory backup
        }
    }

    private async updatePatternConfidence(
        patternId: string,
        feedbackType: string,
        originalConfidence: number
    ): Promise<void> {
        // This would integrate with PatternLearner to adjust pattern confidence
        // based on user feedback in real-time

        if (!this.patternLearner) {
            return;
        }

        const adjustment = this.calculateConfidenceAdjustment(feedbackType, originalConfidence);

        this.eventBus.emit('pattern:confidence-update', {
            patternId,
            feedbackType,
            adjustment,
            timestamp: Date.now(),
        });
    }

    private calculateConfidenceAdjustment(feedbackType: string, originalConfidence: number): number {
        switch (feedbackType) {
            case 'accept':
                return Math.min(0.1, (1 - originalConfidence) * 0.2); // Increase by up to 0.1
            case 'reject':
                return -Math.min(0.2, originalConfidence * 0.3); // Decrease by up to 0.2
            case 'modify':
                return -Math.min(0.05, originalConfidence * 0.1); // Small decrease
            case 'ignore':
                return -Math.min(0.02, originalConfidence * 0.05); // Very small decrease
            default:
                return 0;
        }
    }

    private async refinePattern(patternId: string, original: string, correction: string, context: any): Promise<void> {
        // This would work with PatternLearner to refine patterns based on corrections
        if (this.patternLearner) {
            // For now, just emit an event that PatternLearner can listen to
            this.eventBus.emit('pattern:refinement-needed', {
                patternId,
                original,
                correction,
                context,
                timestamp: Date.now(),
            });
        }
    }

    private calculateSimilarity(str1: string, str2: string): number {
        // Simple Levenshtein distance-based similarity
        const maxLen = Math.max(str1.length, str2.length);
        if (maxLen === 0) return 1.0;

        const distance = this.levenshteinDistance(str1, str2);
        return 1 - distance / maxLen;
    }

    private levenshteinDistance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1)
            .fill(null)
            .map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1, // deletion
                    matrix[j - 1][i] + 1, // insertion
                    matrix[j - 1][i - 1] + indicator // substitution
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    private getTrendStats(feedbacks: FeedbackEvent[], fromDate: Date) {
        const filtered = feedbacks.filter((f) => f.context.timestamp >= fromDate);
        return {
            accepted: filtered.filter((f) => f.type === 'accept').length,
            rejected: filtered.filter((f) => f.type === 'reject').length,
            modified: filtered.filter((f) => f.type === 'modify').length,
        };
    }

    private getEmptyStats(): FeedbackStats {
        return {
            totalFeedbacks: 0,
            acceptanceRate: 0,
            rejectionRate: 0,
            modificationRate: 0,
            averageConfidence: 0,
            topRejectionReasons: [],
            patternPerformance: [],
            recentTrends: {
                last24h: { accepted: 0, rejected: 0, modified: 0 },
                last7d: { accepted: 0, rejected: 0, modified: 0 },
                last30d: { accepted: 0, rejected: 0, modified: 0 },
            },
        };
    }

    /**
     * Get insights - wrapper around generateInsights for test compatibility
     */
    async getInsights(): Promise<{ totalFeedbackEvents: number }> {
        const insights = await this.generateInsights();

        // Return the expected structure for tests that check totalFeedbackEvents
        return {
            totalFeedbackEvents: this.feedbackHistory.size,
        };
    }

    /**
     * Get pattern confidence for a specific pattern
     */
    async getPatternConfidence(patternId: string): Promise<number> {
        const patternFeedback = this.getFeedbackForPattern(patternId);
        if (patternFeedback.length === 0) {
            return 0.5; // Default confidence when no feedback
        }

        const acceptedCount = patternFeedback.filter((f) => f.type === 'accept').length;
        const totalCount = patternFeedback.length;

        return acceptedCount / totalCount;
    }

    /**
     * Process feedback - wrapper around recordFeedback for test compatibility
     */
    async processFeedback(
        feedback: Omit<FeedbackEvent, 'id'>
    ): Promise<{ success: boolean; feedbackId?: string; error?: string }> {
        try {
            const feedbackId = await this.recordFeedback(feedback);
            return { success: true, feedbackId };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Process multiple feedback events efficiently
     */
    async processFeedbackBatch(
        feedbackBatch: Array<Omit<FeedbackEvent, 'id'>>
    ): Promise<Array<{ success: boolean; feedbackId?: string; error?: string }>> {
        const results: Array<{ success: boolean; feedbackId?: string; error?: string }> = [];

        for (const feedback of feedbackBatch) {
            const result = await this.processFeedback(feedback);
            results.push(result);
        }

        return results;
    }

    /**
     * Get correction patterns from negative feedback
     */
    async getCorrectionPatterns(): Promise<
        Array<{
            from: string;
            to: string;
            confidence: number;
            frequency: number;
        }>
    > {
        const corrections: Array<{
            from: string;
            to: string;
            confidence: number;
            frequency: number;
        }> = [];

        // Find all modify and rejection feedback events
        const modifyEvents = Array.from(this.feedbackHistory.values()).filter(
            (f) => f.type === 'modify' && f.originalSuggestion && f.finalValue
        );

        // Group by (original -> final) pairs
        const correctionMap = new Map<string, { count: number; confidence: number }>();

        for (const event of modifyEvents) {
            const key = `${event.originalSuggestion} -> ${event.finalValue}`;
            const existing = correctionMap.get(key);

            if (existing) {
                existing.count++;
                existing.confidence = (existing.confidence + event.context.confidence) / 2;
            } else {
                correctionMap.set(key, {
                    count: 1,
                    confidence: event.context.confidence,
                });
            }
        }

        // Convert to correction patterns
        for (const [key, data] of correctionMap) {
            const [from, to] = key.split(' -> ');
            corrections.push({
                from,
                to,
                confidence: data.confidence,
                frequency: data.count,
            });
        }

        // Sort by frequency and confidence
        corrections.sort((a, b) => {
            if (a.frequency !== b.frequency) {
                return b.frequency - a.frequency;
            }
            return b.confidence - a.confidence;
        });

        return corrections;
    }

    /**
     * Get diagnostic information for debugging
     */
    getDiagnostics(): Record<string, any> {
        return {
            initialized: this.initialized,
            feedbackHistorySize: this.feedbackHistory.size,
            learningThresholds: this.learningThresholds,
            performanceTargets: this.performanceTargets,
            hasPatternLearner: !!this.patternLearner,
            timestamp: Date.now(),
        };
    }
}
