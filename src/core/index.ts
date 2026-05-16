/**
 * Core module - Entry point for the unified architecture
 * Export all main components and utilities
 */

import { createLearningSystem } from '../learning/index';
// Import for internal use
import { AnalyzerFactory } from './analyzer-factory';

// Learning system types
export type * from '../learning/types';
export { DefaultEventBus, LayerManager } from './layer-manager';
export { SharedServices } from './services/index';
// Core types
export * from './types';
// Main analyzer components
export { CodeAnalyzer } from './unified-analyzer';
export { AnalyzerFactory };

// Learning system components
export {
    CodeEvolutionTracker,
    createLearningSystem as createLearningSystemExport,
    FeedbackLoopSystem,
    LEARNING_SYSTEM_METADATA,
    LEARNING_SYSTEM_VERSION,
    LearningOrchestrator,
    TeamKnowledgeSystem,
} from '../learning/index';
// Individual services
export {
    CacheService,
    DatabaseService,
    EventBusService,
    MonitoringService,
} from './services/index';

// Convenience function to create a fully configured analyzer
export async function createUnifiedAnalyzer(workspacePath?: string, config?: Partial<import('./types').CoreConfig>) {
    if (workspacePath) {
        return AnalyzerFactory.createWorkspaceAnalyzer(workspacePath, config);
    }
    return AnalyzerFactory.createAnalyzer(config);
}

// Convenience function for testing
export async function createTestAnalyzer() {
    return AnalyzerFactory.createTestAnalyzer();
}

// Convenience function to create a complete system with learning enabled
export async function createLearningEnabledAnalyzer(
    workspacePath?: string,
    config?: Partial<import('./types').CoreConfig>
): Promise<{
    analyzer: import('./unified-analyzer').CodeAnalyzer;
    learningSystem: import('../learning/learning-orchestrator').LearningOrchestrator;
}> {
    // Create the unified analyzer
    const created = await createUnifiedAnalyzer(workspacePath, config);
    const analyzer = created.analyzer;

    // Extract shared services from the analyzer
    const sharedServices = (created as any).sharedServices;
    if (!sharedServices) {
        throw new Error('Shared services not available in analyzer');
    }

    // Create the learning system
    const learningSystem = await createLearningSystem({
        database: sharedServices.database,
        cache: sharedServices.cache,
        eventBus: sharedServices.eventBus,
        workspaceRoot: workspacePath || process.cwd(),
    });

    return {
        analyzer,
        learningSystem,
    };
}

// Convenience function that matches adapter expectations
export async function createCodeAnalyzer(
    config: Partial<import('./types').CoreConfig> & { workspaceRoot?: string }
): Promise<import('./unified-analyzer').CodeAnalyzer> {
    const { workspaceRoot, ...coreConfig } = config;

    if (workspaceRoot) {
        const result = await AnalyzerFactory.createWorkspaceAnalyzer(workspaceRoot, coreConfig);
        return result.analyzer;
    } else {
        const result = await AnalyzerFactory.createAnalyzer(coreConfig);
        return result.analyzer;
    }
}
