// Ontology Engine - Core concept management and semantic understanding
import { EventEmitter } from 'events';
import { Graph } from 'graphlib';
import { 
    Concept, Relation, RelationType, ConceptSignature, EvolutionHistory,
    ConceptMetadata, SymbolRepresentation, SearchQuery, Match, ASTNode
} from '../types/core';
import { OntologyStorage } from './storage';
import { ConceptBuilder } from './concept-builder';
import { SimilarityCalculator } from './similarity-calculator';
import { v4 as uuidv4 } from 'uuid';

export interface RelatedConcept {
    concept: Concept;
    relation: string;
    distance: number;
    confidence: number;
}

export interface ConceptChange {
    type: 'rename' | 'signature' | 'relation' | 'move';
    conceptId: string;
    newName?: string;
    newSignature?: ConceptSignature;
    targetConcept?: string;
    relationType?: RelationType;
    location?: string;
    evidence?: string[];
}

export class OntologyEngine extends EventEmitter {
    private conceptGraph: Graph;
    private concepts = new Map<string, Concept>();
    private nameToConceptMap = new Map<string, string[]>(); // name -> concept IDs
    private similarityCalculator: SimilarityCalculator;
    private conceptBuilder: ConceptBuilder;
    private storage: OntologyStorage;
    private initPromise: Promise<void> | null = null;
    
    constructor(dbPath: string) {
        super();
        this.conceptGraph = new Graph({ directed: true, multigraph: true });
        this.similarityCalculator = new SimilarityCalculator();
        this.conceptBuilder = new ConceptBuilder();
        this.storage = new OntologyStorage(dbPath);
        
        // Store initialization promise for later awaiting
        this.initPromise = this.initialize();
    }
    
    async ensureInitialized(): Promise<void> {
        if (this.initPromise) {
            await this.initPromise;
            this.initPromise = null;
        }
    }
    
    private async initialize(): Promise<void> {
        await this.storage.initialize();
        await this.loadExistingConcepts();
    }
    
    private async loadExistingConcepts(): Promise<void> {
        const concepts = await this.storage.loadAllConcepts();
        
        for (const concept of concepts) {
            this.concepts.set(concept.id, concept);
            this.conceptGraph.setNode(concept.id, concept);
            
            // Build name mapping
            for (const [name] of concept.representations) {
                this.addToNameMapping(name, concept.id);
            }
            
            // Restore relations
            for (const [targetId, relation] of concept.relations) {
                this.conceptGraph.setEdge(concept.id, targetId, relation);
            }
        }
        
        console.log(`Loaded ${concepts.length} concepts from storage`);
    }
    
    async findConcept(identifier: string, options?: { inferIfMissing?: boolean }): Promise<Concept | null> {
        // 1. Direct lookup by representation
        const directMatch = await this.findByRepresentation(identifier);
        if (directMatch) return directMatch;
        
        // 2. Fuzzy search by similarity
        const fuzzyMatch = await this.fuzzySearchConcepts(identifier);
        if (fuzzyMatch.length > 0 && fuzzyMatch[0].confidence > 0.8) {
            return fuzzyMatch[0].concept;
        }
        
        // 3. Infer if enabled (default: true for backward compatibility)
        if (options?.inferIfMissing !== false) {
            return this.inferConcept(identifier);
        }
        
        return null;
    }
    
    async findConceptStrict(identifier: string): Promise<Concept | null> {
        return this.findConcept(identifier, { inferIfMissing: false });
    }
    
    private async findByRepresentation(name: string): Promise<Concept | null> {
        const conceptIds = this.nameToConceptMap.get(name);
        if (!conceptIds || conceptIds.length === 0) return null;
        
        // Return the most relevant concept (highest confidence)
        let bestConcept: Concept | null = null;
        let bestScore = 0;
        
        for (const conceptId of conceptIds) {
            const concept = this.concepts.get(conceptId);
            if (concept) {
                const representation = concept.representations.get(name);
                const score = representation ? representation.occurrences : 0;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestConcept = concept;
                }
            }
        }
        
        return bestConcept;
    }
    
    private async fuzzySearchConcepts(identifier: string): Promise<{ concept: Concept; confidence: number }[]> {
        const candidates: { concept: Concept; confidence: number }[] = [];
        
        for (const [_, concept] of this.concepts) {
            const similarity = await this.calculateConceptSimilarity(identifier, concept);
            
            if (similarity > 0.5) { // Minimum threshold
                candidates.push({ concept, confidence: similarity });
            }
        }
        
        return candidates.sort((a, b) => b.confidence - a.confidence);
    }
    
    private async calculateConceptSimilarity(identifier: string, concept: Concept): Promise<number> {
        let maxSimilarity = 0;
        
        // Check similarity to all representations
        for (const [name] of concept.representations) {
            const similarity = await this.similarityCalculator.calculate(identifier, name);
            maxSimilarity = Math.max(maxSimilarity, similarity);
        }
        
        // Check canonical name similarity
        const canonicalSimilarity = await this.similarityCalculator.calculate(
            identifier,
            concept.canonicalName
        );
        
        return Math.max(maxSimilarity, canonicalSimilarity * 0.9);
    }
    
    private async inferConcept(identifier: string): Promise<Concept | null> {
        // Try to gather context about this identifier
        const context = await this.gatherIdentifierContext(identifier);
        
        if (!context) return null;
        
        // Build concept from context
        const concept = await this.conceptBuilder.buildFromContext(identifier, context);
        
        if (concept) {
            await this.addConcept(concept);
            return concept;
        }
        
        return null;
    }
    
    private async gatherIdentifierContext(identifier: string): Promise<any> {
        // This would integrate with the Claude Tools and Tree-sitter layers
        // to gather context about the identifier
        // For now, return basic context
        return {
            identifier,
            location: null,
            signature: null,
            usage: []
        };
    }
    
    async addConcept(concept: Concept): Promise<void> {
        // Validate concept
        if (!concept.id || !concept.canonicalName) {
            throw new Error('Invalid concept: missing id or canonicalName');
        }
        
        // Add to maps
        this.concepts.set(concept.id, concept);
        this.conceptGraph.setNode(concept.id, concept);
        
        // Update name mappings
        for (const [name] of concept.representations) {
            this.addToNameMapping(name, concept.id);
        }
        
        // Add relations
        for (const [targetId, relation] of concept.relations) {
            this.conceptGraph.setEdge(concept.id, targetId, relation);
        }
        
        // Persist to storage
        await this.storage.saveConcept(concept);
        
        // Emit event
        this.emit('conceptAdded', concept);
        
        console.log(`Added concept: ${concept.canonicalName} (${concept.id})`);
    }
    
    async evolveConcept(change: ConceptChange): Promise<void> {
        const concept = this.concepts.get(change.conceptId);
        if (!concept) {
            throw new Error(`Concept not found: ${change.conceptId}`);
        }
        
        const evolutionEntry: EvolutionHistory = {
            timestamp: new Date(),
            type: change.type,
            from: this.getCurrentState(concept),
            to: this.getNewState(change),
            reason: this.generateChangeReason(change),
            confidence: 0.9
        };
        
        // Apply the change
        await this.applyConceptChange(concept, change);
        
        // Record evolution
        concept.evolution.push(evolutionEntry);
        
        // Update storage
        await this.storage.updateConcept(concept);
        
        // Emit event
        this.emit('conceptEvolved', { concept, change });
        
        console.log(`Evolved concept: ${concept.canonicalName} - ${change.type}`);
    }
    
    private async applyConceptChange(concept: Concept, change: ConceptChange): Promise<void> {
        switch (change.type) {
            case 'rename':
                if (change.newName) {
                    await this.renameConcept(concept, change.newName);
                }
                break;
                
            case 'signature':
                if (change.newSignature) {
                    concept.signature = change.newSignature;
                }
                break;
                
            case 'relation':
                if (change.targetConcept && change.relationType) {
                    await this.addRelation(concept.id, change.targetConcept, change.relationType);
                }
                break;
                
            case 'move':
                if (change.location) {
                    // Update location information for all representations
                    for (const [_, rep] of concept.representations) {
                        rep.location.uri = change.location;
                    }
                }
                break;
        }
    }
    
    private async renameConcept(concept: Concept, newName: string): Promise<void> {
        // Remove old name mappings
        for (const [oldName] of concept.representations) {
            this.removeFromNameMapping(oldName, concept.id);
        }
        
        // Update canonical name
        const oldCanonical = concept.canonicalName;
        concept.canonicalName = newName;
        
        // Add new representation
        concept.representations.set(newName, {
            name: newName,
            location: concept.representations.values().next().value?.location || {
                uri: '',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
            },
            firstSeen: new Date(),
            lastSeen: new Date(),
            occurrences: 1
        });
        
        // Update name mappings
        this.addToNameMapping(newName, concept.id);
        
        console.log(`Renamed concept: ${oldCanonical} -> ${newName}`);
    }
    
    async addRelation(
        fromConceptId: string,
        toConceptId: string,
        relationType: RelationType,
        confidence: number = 0.9,
        evidence: string[] = []
    ): Promise<void> {
        const fromConcept = this.concepts.get(fromConceptId);
        const toConcept = this.concepts.get(toConceptId);
        
        if (!fromConcept || !toConcept) {
            throw new Error('One or both concepts not found for relation');
        }
        
        const relation: Relation = {
            id: uuidv4(),
            targetConceptId: toConceptId,
            type: relationType,
            confidence,
            evidence,
            createdAt: new Date()
        };
        
        // Add to concept
        fromConcept.relations.set(toConceptId, relation);
        
        // Add to graph
        this.conceptGraph.setEdge(fromConceptId, toConceptId, relation);
        
        // Update storage
        await this.storage.updateConcept(fromConcept);
        
        console.log(`Added relation: ${fromConcept.canonicalName} ${relationType} ${toConcept.canonicalName}`);
    }
    
    getRelatedConcepts(conceptId: string, maxDepth: number = 2): RelatedConcept[] {
        const related: RelatedConcept[] = [];
        const visited = new Set<string>();
        
        this.traverseRelations(conceptId, 0, maxDepth, visited, related);
        
        return related
            .filter(r => r.confidence > 0.3) // Filter low-confidence relations
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 20); // Limit results
    }
    
    private traverseRelations(
        conceptId: string,
        currentDepth: number,
        maxDepth: number,
        visited: Set<string>,
        result: RelatedConcept[]
    ): void {
        if (currentDepth >= maxDepth || visited.has(conceptId)) {
            return;
        }
        
        visited.add(conceptId);
        
        // Get outgoing edges
        const outEdges = this.conceptGraph.outEdges(conceptId) || [];
        
        for (const edge of outEdges) {
            const targetConcept = this.concepts.get(edge.w);
            if (!targetConcept) continue;
            
            const relation = this.conceptGraph.edge(edge) as Relation;
            const confidence = this.calculateRelationConfidence(relation, currentDepth);
            
            result.push({
                concept: targetConcept,
                relation: relation.type,
                distance: currentDepth + 1,
                confidence
            });
            
            // Recurse
            this.traverseRelations(edge.w, currentDepth + 1, maxDepth, visited, result);
        }
        
        // Get incoming edges (bidirectional traversal)
        const inEdges = this.conceptGraph.inEdges(conceptId) || [];
        
        for (const edge of inEdges) {
            const sourceConcept = this.concepts.get(edge.v);
            if (!sourceConcept || visited.has(edge.v)) continue;
            
            const relation = this.conceptGraph.edge(edge) as Relation;
            const confidence = this.calculateRelationConfidence(relation, currentDepth) * 0.8; // Slightly lower confidence for reverse relations
            
            result.push({
                concept: sourceConcept,
                relation: `inverse_${relation.type}`,
                distance: currentDepth + 1,
                confidence
            });
        }
    }
    
    private calculateRelationConfidence(relation: Relation, depth: number): number {
        let confidence = relation.confidence;
        
        // Decay by depth
        confidence *= Math.pow(0.8, depth);
        
        // Adjust by relation type
        const relationWeights = {
            [RelationType.Extends]: 0.95,
            [RelationType.Implements]: 0.9,
            [RelationType.Uses]: 0.7,
            [RelationType.Calls]: 0.6,
            [RelationType.References]: 0.5,
            [RelationType.SimilarTo]: 0.4,
            [RelationType.CoChanges]: 0.8
        };
        
        confidence *= relationWeights[relation.type] || 0.3;
        
        // Boost by evidence count
        confidence += Math.min(0.1, relation.evidence.length * 0.02);
        
        return Math.min(1.0, confidence);
    }
    
    async findSimilarConcepts(concept: Concept, threshold: number = 0.7): Promise<Concept[]> {
        const similar: Concept[] = [];
        
        for (const [_, otherConcept] of this.concepts) {
            if (otherConcept.id === concept.id) continue;
            
            const similarity = await this.calculateConceptSimilarity(concept.canonicalName, otherConcept);
            
            if (similarity >= threshold) {
                similar.push(otherConcept);
            }
        }
        
        return similar;
    }
    
    async mergeConcepts(conceptIds: string[], primaryConceptId: string): Promise<Concept> {
        const primaryConcept = this.concepts.get(primaryConceptId);
        if (!primaryConcept) {
            throw new Error(`Primary concept not found: ${primaryConceptId}`);
        }
        
        const conceptsToMerge = conceptIds
            .filter(id => id !== primaryConceptId)
            .map(id => this.concepts.get(id))
            .filter(Boolean) as Concept[];
        
        // Merge representations
        for (const concept of conceptsToMerge) {
            for (const [name, rep] of concept.representations) {
                if (!primaryConcept.representations.has(name)) {
                    primaryConcept.representations.set(name, rep);
                    this.addToNameMapping(name, primaryConceptId);
                }
            }
            
            // Merge relations
            for (const [targetId, relation] of concept.relations) {
                if (!primaryConcept.relations.has(targetId)) {
                    primaryConcept.relations.set(targetId, relation);
                    this.conceptGraph.setEdge(primaryConceptId, targetId, relation);
                }
            }
            
            // Merge evolution history
            primaryConcept.evolution.push(...concept.evolution);
            
            // Remove merged concept
            await this.removeConcept(concept.id);
        }
        
        // Update primary concept
        await this.storage.updateConcept(primaryConcept);
        
        this.emit('conceptsMerged', { primary: primaryConcept, merged: conceptsToMerge });
        
        return primaryConcept;
    }
    
    private async removeConcept(conceptId: string): Promise<void> {
        const concept = this.concepts.get(conceptId);
        if (!concept) return;
        
        // Remove from name mappings
        for (const [name] of concept.representations) {
            this.removeFromNameMapping(name, conceptId);
        }
        
        // Remove from graph
        this.conceptGraph.removeNode(conceptId);
        
        // Remove from maps
        this.concepts.delete(conceptId);
        
        // Remove from storage
        await this.storage.deleteConcept(conceptId);
    }
    
    // Utility methods
    private addToNameMapping(name: string, conceptId: string): void {
        const existing = this.nameToConceptMap.get(name) || [];
        if (!existing.includes(conceptId)) {
            existing.push(conceptId);
            this.nameToConceptMap.set(name, existing);
        }
    }
    
    private removeFromNameMapping(name: string, conceptId: string): void {
        const existing = this.nameToConceptMap.get(name) || [];
        const filtered = existing.filter(id => id !== conceptId);
        
        if (filtered.length === 0) {
            this.nameToConceptMap.delete(name);
        } else {
            this.nameToConceptMap.set(name, filtered);
        }
    }
    
    private getCurrentState(concept: Concept): string {
        return concept.canonicalName;
    }
    
    private getNewState(change: ConceptChange): string {
        switch (change.type) {
            case 'rename':
                return change.newName || 'unknown';
            case 'signature':
                return 'signature_changed';
            case 'relation':
                return `+${change.relationType}`;
            case 'move':
                return change.location || 'moved';
            default:
                return 'changed';
        }
    }
    
    private generateChangeReason(change: ConceptChange): string {
        switch (change.type) {
            case 'rename':
                return `Renamed to ${change.newName}`;
            case 'signature':
                return 'Signature updated';
            case 'relation':
                return `Added ${change.relationType} relation`;
            case 'move':
                return `Moved to ${change.location}`;
            default:
                return 'Unknown change';
        }
    }
    
    // Statistics and health
    getStatistics(): {
        totalConcepts: number;
        totalRelations: number;
        averageRepresentations: number;
        topConcepts: { name: string; representations: number }[];
    } {
        const totalConcepts = this.concepts.size;
        const totalRelations = this.conceptGraph.edgeCount();
        
        let totalRepresentations = 0;
        const conceptStats: { name: string; representations: number }[] = [];
        
        for (const [_, concept] of this.concepts) {
            const repCount = concept.representations.size;
            totalRepresentations += repCount;
            conceptStats.push({ name: concept.canonicalName, representations: repCount });
        }
        
        const averageRepresentations = totalConcepts > 0 ? totalRepresentations / totalConcepts : 0;
        const topConcepts = conceptStats
            .sort((a, b) => b.representations - a.representations)
            .slice(0, 10);
        
        return {
            totalConcepts,
            totalRelations,
            averageRepresentations,
            topConcepts
        };
    }
    
    async dispose(): Promise<void> {
        await this.storage.close();
        this.removeAllListeners();
    }

    async importConcept(conceptData: any): Promise<void> {
        const concept: Concept = {
            id: conceptData.id || uuidv4(),
            canonicalName: conceptData.canonicalName,
            representations: new Map(conceptData.representations || []),
            relations: new Map(conceptData.relations || []),
            confidence: conceptData.confidence || 0.5,
            signature: conceptData.signature,
            metadata: conceptData.metadata || {},
            evolution: conceptData.evolution || []
        };
        
        await this.addConcept(concept);
    }

    async exportConcepts(): Promise<any[]> {
        const concepts: any[] = [];
        
        for (const [id, concept] of this.concepts) {
            concepts.push({
                id: concept.id,
                canonicalName: concept.canonicalName,
                representations: Array.from(concept.representations.entries()),
                relations: Array.from(concept.relations.entries()),
                confidence: concept.confidence,
                signature: concept.signature,
                metadata: concept.metadata,
                evolution: concept.evolution
            });
        }
        
        return concepts;
    }
}