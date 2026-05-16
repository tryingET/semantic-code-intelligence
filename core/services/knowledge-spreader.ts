// Knowledge Spreader - Propagates changes across related concepts
import { EventEmitter } from 'events';
import { Graph } from 'graphlib';
import { 
    Change, Suggestion, PropagationPath, Concept, Pattern,
    RelatedConcept, Relation
} from '../types/core';
import { OntologyEngine } from '../ontology/ontology-engine';
import { PatternLearner } from '../patterns/pattern-learner';
import { PropagationRule, createDefaultRules } from './propagation-rules';

export interface PropagationContext {
    change: Change;
    concept?: Concept;
    relatedConcepts: RelatedConcept[];
    recentChanges: Change[];
    activePatterns: Pattern[];
    fileContext: string[];
    projectContext: ProjectContext;
}

export interface ProjectContext {
    rootPath: string;
    language: string;
    framework?: string;
    conventions: NamingConvention[];
}

export interface NamingConvention {
    pattern: RegExp;
    replacement: string;
    confidence: number;
    examples: string[];
}

export interface AffectedConcept {
    concept: Concept;
    reason: 'direct_relation' | 'historical_co_change' | 'same_module' | 'pattern_match';
    confidence: number;
    evidence: string[];
}

export class KnowledgeSpreader extends EventEmitter {
    private propagationGraph: Graph;
    private rules: PropagationRule[];
    private coChangeHistory = new Map<string, Map<string, number>>(); // concept -> related concept -> frequency
    private moduleAnalysis = new Map<string, Set<string>>(); // module -> concepts
    
    constructor(
        private ontology: OntologyEngine,
        private patterns: PatternLearner
    ) {
        super();
        this.propagationGraph = new Graph({ directed: true });
        this.rules = createDefaultRules();
        this.buildInitialGraph();
    }
    
    private async buildInitialGraph(): Promise<void> {
        // Build propagation graph from ontology concepts
        const concepts = await this.getAllConcepts();
        
        for (const concept of concepts) {
            this.propagationGraph.setNode(concept.id, concept);
            
            // Add relations as edges
            for (const [targetId, relation] of concept.relations) {
                this.propagationGraph.setEdge(concept.id, targetId, {
                    type: relation.type,
                    weight: relation.confidence
                });
            }
        }
    }
    
    async propagateChange(change: Change): Promise<Suggestion[]> {
        const suggestions: Suggestion[] = [];
        
        try {
            // Create propagation context
            const context = await this.createPropagationContext(change);
            
            // Find concepts affected by this change
            const affectedConcepts = await this.findAffectedConcepts(change, context);
            
            // Calculate propagation paths
            const paths = this.calculatePropagationPaths(change.identifier, affectedConcepts);
            
            // Generate suggestions for each path
            for (const path of paths) {
                const suggestion = await this.generateSuggestion(change, path, context);
                if (suggestion && suggestion.confidence > 0.3) {
                    suggestions.push(suggestion);
                }
            }
            
            // Apply propagation rules
            for (const rule of this.rules) {
                if (await rule.matches(change, context)) {
                    const ruleSuggestions = await rule.apply(change, context);
                    suggestions.push(...ruleSuggestions);
                }
            }
            
            // Update co-change history
            this.updateCoChangeHistory(change, suggestions);
            
            // Rank and filter suggestions
            const rankedSuggestions = this.rankSuggestions(suggestions);
            
            this.emit('propagationCompleted', {
                change,
                suggestions: rankedSuggestions,
                affectedConcepts: affectedConcepts.length
            });
            
            return rankedSuggestions;
            
        } catch (error) {
            this.emit('propagationError', { change, error });
            console.error('Propagation failed:', error);
            return [];
        }
    }
    
    private async createPropagationContext(change: Change): Promise<PropagationContext> {
        const concept = await this.ontology.findConcept(change.identifier);
        const relatedConcepts = concept ? 
            this.ontology.getRelatedConcepts(concept.id, 2) : [];
        
        const recentChanges = await this.getRecentChanges(24); // Last 24 hours
        const activePatterns = await this.patterns.getActivePatterns();
        
        return {
            change,
            concept: concept || undefined,
            relatedConcepts: relatedConcepts.map(rc => ({
                concept: rc.concept,
                relationship: {
                    id: '',
                    targetConceptId: rc.concept.id,
                    type: rc.relation as any,
                    confidence: rc.confidence,
                    evidence: [],
                    createdAt: new Date()
                } as Relation,
                distance: rc.distance,
                path: []
            })),
            recentChanges,
            activePatterns,
            fileContext: await this.getFileContext(change.location),
            projectContext: await this.getProjectContext()
        };
    }
    
    private async findAffectedConcepts(
        change: Change,
        context: PropagationContext
    ): Promise<AffectedConcept[]> {
        const affected: AffectedConcept[] = [];
        const processed = new Set<string>();
        
        // 1. Direct relations from ontology
        if (context.concept) {
            for (const related of context.relatedConcepts) {
                if (!processed.has(related.concept.id)) {
                    affected.push({
                        concept: related.concept,
                        reason: 'direct_relation',
                        confidence: related.relationship.confidence,
                        evidence: [`Related via ${related.relationship.type}`]
                    });
                    processed.add(related.concept.id);
                }
            }
        }
        
        // 2. Historical co-changes
        const coChangedConcepts = this.findHistoricalCoChanges(change.identifier);
        for (const [conceptId, frequency] of coChangedConcepts) {
            if (!processed.has(conceptId)) {
                const concept = await this.getConceptById(conceptId);
                if (concept) {
                    affected.push({
                        concept,
                        reason: 'historical_co_change',
                        confidence: Math.min(0.9, frequency / 10), // Normalize frequency
                        evidence: [`Co-changed ${frequency} times`]
                    });
                    processed.add(conceptId);
                }
            }
        }
        
        // 3. Same module concepts
        const sameModuleConcepts = this.findSameModuleConcepts(change.location);
        for (const conceptId of sameModuleConcepts) {
            if (!processed.has(conceptId)) {
                const concept = await this.getConceptById(conceptId);
                if (concept) {
                    affected.push({
                        concept,
                        reason: 'same_module',
                        confidence: 0.6,
                        evidence: [`In same module: ${change.location}`]
                    });
                    processed.add(conceptId);
                }
            }
        }
        
        // 4. Pattern-based matches
        for (const pattern of context.activePatterns) {
            const patternMatches = await this.findPatternMatches(pattern, change);
            for (const match of patternMatches) {
                const concept = await this.ontology.findConcept(match);
                if (concept && !processed.has(concept.id)) {
                    affected.push({
                        concept,
                        reason: 'pattern_match',
                        confidence: pattern.confidence * 0.8,
                        evidence: [`Matches pattern: ${pattern.id}`]
                    });
                    processed.add(concept.id);
                }
            }
        }
        
        return affected.filter(a => a.confidence > 0.2); // Filter low confidence
    }
    
    private calculatePropagationPaths(
        sourceIdentifier: string,
        affectedConcepts: AffectedConcept[]
    ): PropagationPath[] {
        const paths: PropagationPath[] = [];
        
        for (const affected of affectedConcepts) {
            // Calculate path confidence based on reason and distance
            let pathConfidence = affected.confidence;
            
            // Apply reason-specific weights
            const reasonWeights = {
                'direct_relation': 1.0,
                'historical_co_change': 0.8,
                'same_module': 0.6,
                'pattern_match': 0.7
            };
            
            pathConfidence *= reasonWeights[affected.reason];
            
            paths.push({
                source: sourceIdentifier,
                target: affected.concept.id,
                steps: [sourceIdentifier, affected.concept.id],
                confidence: pathConfidence,
                reason: affected.reason
            });
        }
        
        return paths.sort((a, b) => b.confidence - a.confidence);
    }
    
    private async generateSuggestion(
        change: Change,
        path: PropagationPath,
        context: PropagationContext
    ): Promise<Suggestion | null> {
        const targetConcept = await this.getConceptById(path.target);
        if (!targetConcept) return null;
        
        let suggestedChange: string | null = null;
        
        // Try different transformation strategies
        
        // 1. Pattern-based transformation
        if (change.type === 'rename' && change.to) {
            for (const pattern of context.activePatterns) {
                const result = await this.patterns.applyPattern(pattern, targetConcept.canonicalName);
                if (result && result !== targetConcept.canonicalName) {
                    suggestedChange = result;
                    break;
                }
            }
        }
        
        // 2. Rule-based transformation
        if (!suggestedChange) {
            for (const rule of this.rules) {
                if (await rule.canPropagate(change, targetConcept)) {
                    suggestedChange = await rule.transform(targetConcept.canonicalName, change);
                    if (suggestedChange) break;
                }
            }
        }
        
        // 3. Direct propagation (same change)
        if (!suggestedChange && change.type === 'rename' && change.to) {
            // For direct relations with high confidence, suggest same change
            if (path.reason === 'direct_relation' && path.confidence > 0.8) {
                suggestedChange = change.to;
            }
        }
        
        if (!suggestedChange) return null;
        
        return {
            type: `propagated_${change.type}`,
            target: targetConcept.canonicalName,
            suggestion: suggestedChange,
            confidence: path.confidence,
            reason: this.generateExplanation(change, path, targetConcept),
            path: path.steps,
            autoApply: path.confidence > 0.9,
            evidence: await this.gatherEvidence(change, targetConcept, path)
        };
    }
    
    private generateExplanation(
        change: Change,
        path: PropagationPath,
        targetConcept: Concept
    ): string {
        const explanations: Record<string, string> = {
            'direct_relation': `Directly related to ${change.identifier}`,
            'historical_co_change': `Historically changes with ${change.identifier}`,
            'same_module': `In same module as ${change.identifier}`,
            'pattern_match': `Follows same naming pattern as ${change.identifier}`
        };
        
        let explanation = explanations[path.reason] || 'Related concept';
        
        if (change.type === 'rename' && change.to) {
            explanation += `. Following rename pattern: ${change.from} → ${change.to}`;
        }
        
        return explanation;
    }
    
    private async gatherEvidence(
        change: Change,
        targetConcept: Concept,
        path: PropagationPath
    ): Promise<string[]> {
        const evidence: string[] = [];
        
        // Add confidence information
        evidence.push(`Propagation confidence: ${(path.confidence * 100).toFixed(0)}%`);
        
        // Add reason-specific evidence
        switch (path.reason) {
            case 'direct_relation':
                evidence.push('Concepts are directly linked in the ontology');
                break;
            case 'historical_co_change':
                const frequency = this.getCoChangeFrequency(change.identifier, targetConcept.id);
                if (frequency > 0) {
                    evidence.push(`Previously changed together ${frequency} times`);
                }
                break;
            case 'same_module':
                evidence.push(`Both concepts exist in ${path.source}`);
                break;
            case 'pattern_match':
                evidence.push('Similar naming patterns detected');
                break;
        }
        
        return evidence;
    }
    
    private rankSuggestions(suggestions: Suggestion[]): Suggestion[] {
        return suggestions
            .sort((a, b) => {
                // Primary sort: confidence
                if (Math.abs(a.confidence - b.confidence) > 0.1) {
                    return b.confidence - a.confidence;
                }
                
                // Secondary sort: auto-apply suggestions first
                if (a.autoApply !== b.autoApply) {
                    return a.autoApply ? -1 : 1;
                }
                
                // Tertiary sort: evidence count
                return (b.evidence?.length || 0) - (a.evidence?.length || 0);
            })
            .slice(0, 20); // Limit to top 20 suggestions
    }
    
    // Utility methods
    
    private findHistoricalCoChanges(identifier: string): Map<string, number> {
        return this.coChangeHistory.get(identifier) || new Map();
    }
    
    private getCoChangeFrequency(identifier1: string, identifier2: string): number {
        const coChanges = this.coChangeHistory.get(identifier1);
        return coChanges?.get(identifier2) || 0;
    }
    
    private findSameModuleConcepts(location: string): string[] {
        // Extract module from location
        const module = this.extractModuleFromLocation(location);
        return Array.from(this.moduleAnalysis.get(module) || new Set());
    }
    
    private extractModuleFromLocation(location: string): string {
        // Simple module extraction based on directory structure
        const parts = location.split('/');
        if (parts.length > 2) {
            return parts.slice(0, -1).join('/'); // Directory path
        }
        return location;
    }
    
    private async findPatternMatches(pattern: Pattern, change: Change): Promise<string[]> {
        // This would find identifiers that match the pattern
        // Implementation depends on having access to all identifiers in the codebase
        return [];
    }
    
    private updateCoChangeHistory(change: Change, suggestions: Suggestion[]): void {
        const identifier = change.identifier;
        
        if (!this.coChangeHistory.has(identifier)) {
            this.coChangeHistory.set(identifier, new Map());
        }
        
        const coChanges = this.coChangeHistory.get(identifier)!;
        
        for (const suggestion of suggestions) {
            if (suggestion.autoApply || suggestion.confidence > 0.8) {
                const current = coChanges.get(suggestion.target) || 0;
                coChanges.set(suggestion.target, current + 1);
            }
        }
    }
    
    private async getAllConcepts(): Promise<Concept[]> {
        // This would get all concepts from the ontology
        // For now, return empty array
        return [];
    }
    
    private async getConceptById(conceptId: string): Promise<Concept | null> {
        // Get concept by ID from ontology
        return null;
    }
    
    private async getRecentChanges(hours: number): Promise<Change[]> {
        // Get recent changes from history
        return [];
    }
    
    private async getFileContext(location: string): Promise<string[]> {
        // Get file context information
        return [];
    }
    
    private async getProjectContext(): Promise<ProjectContext> {
        // Get project context information
        return {
            rootPath: process.cwd(),
            language: 'typescript',
            conventions: []
        };
    }
    
    // Public API
    
    addPropagationRule(rule: PropagationRule): void {
        this.rules.push(rule);
    }
    
    async analyzePropagationPotential(identifier: string): Promise<{
        directRelations: number;
        historicalCoChanges: number;
        sameModuleConcepts: number;
        patternMatches: number;
        overallPotential: 'high' | 'medium' | 'low';
    }> {
        const concept = await this.ontology.findConcept(identifier);
        const relatedConcepts = concept ? this.ontology.getRelatedConcepts(concept.id) : [];
        const coChanges = this.findHistoricalCoChanges(identifier);
        const sameModule = this.findSameModuleConcepts(''); // Would need actual location
        
        const directRelations = relatedConcepts.length;
        const historicalCoChanges = coChanges.size;
        const sameModuleConcepts = sameModule.length;
        const patternMatches = 0; // Would need to calculate
        
        const totalConnections = directRelations + historicalCoChanges + sameModuleConcepts + patternMatches;
        
        let overallPotential: 'high' | 'medium' | 'low';
        if (totalConnections > 10) overallPotential = 'high';
        else if (totalConnections > 3) overallPotential = 'medium';
        else overallPotential = 'low';
        
        return {
            directRelations,
            historicalCoChanges,
            sameModuleConcepts,
            patternMatches,
            overallPotential
        };
    }
    
    getStatistics(): {
        totalRules: number;
        coChangeEntries: number;
        moduleEntries: number;
        averageConnections: number;
    } {
        let totalConnections = 0;
        let totalConcepts = 0;
        
        for (const [_, connections] of this.coChangeHistory) {
            totalConnections += connections.size;
            totalConcepts++;
        }
        
        return {
            totalRules: this.rules.length,
            coChangeEntries: this.coChangeHistory.size,
            moduleEntries: this.moduleAnalysis.size,
            averageConnections: totalConcepts > 0 ? totalConnections / totalConcepts : 0
        };
    }
}