/**
 * Learning System - Main exports
 *
 * This module provides a unified interface to the learning system components,
 * enabling intelligent adaptation and continuous improvement of the LSP capabilities.
 */

export { CodeEvolutionTracker } from './evolution-tracker.js';
// Core learning components
export { FeedbackLoopSystem } from './feedback-loop.js';
export { LearningOrchestrator } from './learning-orchestrator.js';
export { TeamKnowledgeSystem } from './team-knowledge.js';

// Types and interfaces
export type {
    ArchitecturalTrend,
    CorrectionData,
    EvolutionConfig,
    // Evolution Tracker types
    EvolutionEvent,
    EvolutionPattern,
    FeedbackConfig,
    // Feedback Loop types
    FeedbackEvent,
    FeedbackInsights,
    LearningConfig,
    // Learning Orchestrator types
    LearningPipeline,
    LearningResult,
    PatternAdoption,
    PatternValidation,
    PipelineExecution,
    SystemHealth,
    TeamInsights,
    TeamKnowledgeConfig,
    // Team Knowledge types
    TeamMember,
} from './types.js';

/**
 * Factory function to create a fully configured learning system
 */
export async function createLearningSystem(config: {
    database: any;
    cache: any;
    eventBus: any;
    workspaceRoot: string;
}): Promise<LearningOrchestrator> {
    const { database, cache, eventBus, workspaceRoot } = config;

    // Initialize learning orchestrator with all components
    const learningOrchestrator = new LearningOrchestrator({
        database,
        cache,
        eventBus,
        workspaceRoot,
    });

    await learningOrchestrator.initialize();

    return learningOrchestrator;
}

/**
 * Learning system version and metadata
 */
export const LEARNING_SYSTEM_VERSION = '1.0.0';
export const LEARNING_SYSTEM_METADATA = {
    version: LEARNING_SYSTEM_VERSION,
    description: 'Intelligent learning system for ontology-enhanced LSP',
    capabilities: [
        'Feedback-driven pattern learning',
        'Code evolution tracking and analysis',
        'Team knowledge sharing and validation',
        'Automated learning pipeline orchestration',
        'Performance optimization through learning',
        'Architectural trend detection',
    ],
    performance: {
        feedbackRecording: '< 10ms',
        evolutionTracking: '< 15ms',
        teamKnowledgeSharing: '< 20ms',
        learningPipelineExecution: '< 100ms',
    },
} as const;
