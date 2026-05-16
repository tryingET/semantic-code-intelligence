/**
 * Learning System - Type Definitions
 *
 * This module contains all the type definitions for the learning system components.
 */

// Feedback Loop System Types
export interface FeedbackEvent {
    id: string;
    suggestionId: string;
    accepted: boolean;
    timestamp: number;
    context?: string;
    confidence?: number;
}

export interface CorrectionData {
    originalSuggestion: string;
    correctedSuggestion: string;
    context: string;
    correctionType: 'replacement' | 'addition' | 'removal' | 'modification';
    confidence: number;
    weight?: number;
}

export interface FeedbackInsights {
    acceptanceRate: number;
    averageConfidence: number;
    commonRejectionReasons: Array<{
        reason: string;
        frequency: number;
    }>;
    improvementSuggestions: string[];
    trendsOverTime: Array<{
        period: string;
        acceptanceRate: number;
        averageConfidence: number;
    }>;
}

export interface FeedbackConfig {
    retentionPeriodDays: number;
    minConfidenceThreshold: number;
    learningRateAdjustment: number;
    enableRealTimeLearning: boolean;
}

// Code Evolution Tracker Types
export interface EvolutionEvent {
    id: string;
    filePath: string;
    eventType: 'file_created' | 'file_modified' | 'file_deleted' | 'file_moved' | 'refactored';
    changeSummary: string;
    impactScore: number;
    architecturalImpact?: string;
    commitHash?: string;
    author?: string;
    timestamp: number;
    metadata?: Record<string, any>;
}

export interface EvolutionPattern {
    id: string;
    type: 'architectural' | 'stylistic' | 'performance' | 'maintainability';
    description: string;
    frequency: number;
    impactLevel: 'low' | 'medium' | 'high';
    examples: Array<{
        filePath: string;
        changeDescription: string;
        timestamp: number;
    }>;
    confidence: number;
}

export interface ArchitecturalTrend {
    name: string;
    description: string;
    trend: 'increasing' | 'decreasing' | 'stable';
    confidence: number;
    timeframe: {
        start: number;
        end: number;
    };
    metrics: Record<string, number>;
    implications: string[];
}

export interface EvolutionConfig {
    trackingEnabled: boolean;
    minImpactScore: number;
    patternDetectionThreshold: number;
    trendAnalysisWindowDays: number;
}

// Team Knowledge System Types
export interface TeamMember {
    id: string;
    name: string;
    email?: string;
    expertise: string[];
    joinedAt: number;
    lastActive: number;
    contributionScore: number;
}

export interface PatternValidation {
    id: string;
    patternId: string;
    validatorId: string;
    status: 'pending' | 'approved' | 'rejected' | 'needs_revision';
    feedback: string;
    confidence: number;
    validatedAt: number;
}

export interface PatternAdoption {
    id: string;
    patternId: string;
    adopterId: string;
    adoptedAt: number;
    usageCount: number;
    successRate: number;
    feedback?: string;
}

export interface TeamInsights {
    totalMembers: number;
    activePatternsCount: number;
    averageAdoptionRate: number;
    topContributors: Array<{
        memberId: string;
        name: string;
        contributionScore: number;
    }>;
    expertiseDistribution: Record<string, number>;
    collaborationMetrics: {
        patternsSharedLastWeek: number;
        averageValidationTime: number;
        crossTeamAdoptions: number;
    };
}

export interface TeamKnowledgeConfig {
    autoValidationThreshold: number;
    expertiseDecayPeriodDays: number;
    minValidatorsRequired: number;
    contributionScoreWeights: {
        patternSharing: number;
        validation: number;
        adoption: number;
        feedback: number;
    };
}

// Learning Orchestrator Types
export interface LearningPipeline {
    id: string;
    name: string;
    description: string;
    type: 'feedback_analysis' | 'pattern_extraction' | 'trend_analysis' | 'team_insights' | 'composite';
    steps: Array<{
        name: string;
        component: 'feedback_loop' | 'evolution_tracker' | 'team_knowledge' | 'pattern_learner';
        operation: string;
        parameters: Record<string, any>;
        dependencies: string[];
    }>;
    schedule?: {
        frequency: 'realtime' | 'hourly' | 'daily' | 'weekly';
        cron?: string;
    };
    enabled: boolean;
}

export interface PipelineExecution {
    id: string;
    pipelineId: string;
    startTime: number;
    endTime?: number;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress: {
        currentStep: number;
        totalSteps: number;
        stepName: string;
    };
    results?: LearningResult[];
    errors?: string[];
    metrics: {
        duration?: number;
        memoryUsage: number;
        cpuUsage: number;
    };
}

export interface LearningResult {
    type: 'insight' | 'pattern' | 'recommendation' | 'alert' | 'metric';
    title: string;
    description: string;
    confidence: number;
    priority: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    data: Record<string, any>;
    actionable: boolean;
    suggestions?: string[];
    timestamp: number;
}

export interface SystemHealth {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    components: {
        feedbackLoop: {
            status: 'healthy' | 'degraded' | 'unhealthy';
            lastUpdate: number;
            errorRate: number;
            averageLatency: number;
        };
        evolutionTracker: {
            status: 'healthy' | 'degraded' | 'unhealthy';
            lastUpdate: number;
            eventsProcessed: number;
            processingLatency: number;
        };
        teamKnowledge: {
            status: 'healthy' | 'degraded' | 'unhealthy';
            lastUpdate: number;
            activeMembers: number;
            syncLatency: number;
        };
    };
    metrics: {
        uptime: number;
        totalLearningOperations: number;
        averageOperationLatency: number;
        errorRate: number;
        memoryUsage: number;
    };
    lastHealthCheck: number;
}

export interface LearningConfig {
    enableFeedbackLearning: boolean;
    enableEvolutionTracking: boolean;
    enableTeamKnowledge: boolean;
    globalConfidenceThreshold: number;
    learningRateAdjustment: number;
    retentionPolicyDays: number;
    performanceTargets: {
        maxLatencyMs: number;
        maxMemoryMB: number;
        minAccuracy: number;
    };
    pipelines: LearningPipeline[];
    database: {
        path: string;
        maxConnections: number;
    };
    cache: {
        enabled: boolean;
        ttlSeconds: number;
        maxSize: number;
    };
}

// Utility Types
export type LearningEventType =
    | 'feedback_received'
    | 'pattern_learned'
    | 'evolution_detected'
    | 'team_pattern_shared'
    | 'validation_completed'
    | 'pipeline_executed'
    | 'system_health_check';

export interface LearningEvent {
    type: LearningEventType;
    timestamp: number;
    source: string;
    data: Record<string, any>;
    correlationId?: string;
}

export type LearningMetric = {
    name: string;
    value: number;
    unit: string;
    timestamp: number;
    tags?: Record<string, string>;
};

export type ConfidenceScore = {
    value: number;
    factors: Array<{
        name: string;
        weight: number;
        contribution: number;
    }>;
    explanation?: string;
};
