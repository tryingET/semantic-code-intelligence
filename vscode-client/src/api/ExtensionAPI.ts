/**
 * Extension API
 * Public API for third-party extensions to integrate with Ontology LSP
 * 
 * Sixth-order consideration: Extensibility for future AI integration and ecosystem growth
 */

import { LanguageClient } from 'vscode-languageclient/node';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { TelemetryManager } from '../telemetry/TelemetryManager';
import * as vscode from 'vscode';

export interface OntologyAPI {
    /**
     * Get concept information for a symbol at a given position
     */
    getConcept(uri: string, position: vscode.Position): Promise<ConceptInfo | null>;
    
    /**
     * Find related concepts to a given concept
     */
    findRelatedConcepts(conceptId: string): Promise<ConceptInfo[]>;
    
    /**
     * Get learned patterns
     */
    getPatterns(): Promise<Pattern[]>;
    
    /**
     * Train a new pattern
     */
    trainPattern(pattern: PatternDefinition): Promise<void>;
    
    /**
     * Suggest refactorings for a given position
     */
    suggestRefactorings(uri: string, position: vscode.Position): Promise<Refactoring[]>;
    
    /**
     * Apply a refactoring
     */
    applyRefactoring(refactoring: Refactoring): Promise<boolean>;
    
    /**
     * Register a custom propagation rule
     */
    registerPropagationRule(rule: PropagationRule): void;
    
    /**
     * Subscribe to ontology events
     */
    onConceptDiscovered(callback: (concept: ConceptInfo) => void): vscode.Disposable;
    onPatternLearned(callback: (pattern: Pattern) => void): vscode.Disposable;
    onRefactoringApplied(callback: (refactoring: Refactoring) => void): vscode.Disposable;
    
    /**
     * Get performance statistics
     */
    getStatistics(): Promise<Statistics>;
    
    /**
     * Export ontology data
     */
    exportOntology(): Promise<OntologyData>;
    
    /**
     * Import ontology data
     */
    importOntology(data: OntologyData): Promise<void>;

    /**
     * Build a targeted symbol map for a symbol (Layer 3)
     */
    buildSymbolMap(symbol: string, options?: { uri?: string; maxFiles?: number; astOnly?: boolean }): Promise<any>;

    /**
     * Plan a rename and return a preview WorkspaceEdit summary (Layer 3)
     */
    planRename(oldName: string, newName: string, uri?: string): Promise<any>;
}

export interface ConceptInfo {
    id: string;
    name: string;
    type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'namespace';
    uri: string;
    range: vscode.Range;
    relationships: Relationship[];
    confidence: number;
    metadata: Record<string, any>;
}

export interface Relationship {
    type: 'uses' | 'usedBy' | 'extends' | 'implements' | 'references' | 'similar';
    targetId: string;
    confidence: number;
}

export interface Pattern {
    id: string;
    name: string;
    description: string;
    confidence: number;
    usageCount: number;
    example: string;
    applicableTo: string[];
}

export interface PatternDefinition {
    name: string;
    description: string;
    code: string;
    context?: Record<string, any>;
}

export interface Refactoring {
    id: string;
    title: string;
    description: string;
    confidence: number;
    changes: Change[];
}

export interface Change {
    uri: string;
    range: vscode.Range;
    newText: string;
}

export interface PropagationRule {
    name: string;
    description: string;
    matcher: (change: Change) => boolean;
    propagate: (change: Change) => Promise<Change[]>;
}

export interface Statistics {
    concepts: number;
    relationships: number;
    patterns: number;
    cacheHitRate: number;
    avgResponseTime: number;
    memoryUsage: number;
}

export interface OntologyData {
    version: string;
    concepts: ConceptInfo[];
    patterns: Pattern[];
    metadata: Record<string, any>;
}

export class ExtensionAPI implements OntologyAPI {
    private eventEmitter = new vscode.EventEmitter<any>();
    private customRules: PropagationRule[] = [];
    
    constructor(
        private client: LanguageClient | undefined,
        private config: ConfigurationManager,
        private telemetry: TelemetryManager | undefined
    ) {
        this.setupEventHandlers();
    }
    
    async getConcept(uri: string, position: vscode.Position): Promise<ConceptInfo | null> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        const result = await this.client.sendRequest('ontology/getConcept', {
            uri,
            position: { line: position.line, character: position.character }
        });
        
        return result ? this.convertConcept(result) : null;
    }
    
    async findRelatedConcepts(conceptId: string): Promise<ConceptInfo[]> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        const results = await this.client.sendRequest('ontology/findRelated', {
            conceptId
        });
        
        return Array.isArray(results) ? results.map((r: any) => this.convertConcept(r)) : [];
    }
    
    async getPatterns(): Promise<Pattern[]> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        return await this.client.sendRequest('ontology/getPatterns', {});
    }
    
    async trainPattern(pattern: PatternDefinition): Promise<void> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        await this.client.sendRequest('ontology/trainPattern', pattern);
        
        this.telemetry?.logEvent('api.pattern.trained', {
            name: pattern.name
        });
    }
    
    async suggestRefactorings(uri: string, position: vscode.Position): Promise<Refactoring[]> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        const results = await this.client.sendRequest('ontology/suggestRefactoring', {
            uri,
            position: { line: position.line, character: position.character }
        });
        
        return Array.isArray(results) ? results.map((r: any) => this.convertRefactoring(r)) : [];
    }
    
    async applyRefactoring(refactoring: Refactoring): Promise<boolean> {
        const edit = new vscode.WorkspaceEdit();
        
        for (const change of refactoring.changes) {
            const uri = vscode.Uri.parse(change.uri);
            edit.replace(uri, change.range, change.newText);
        }
        
        const success = await vscode.workspace.applyEdit(edit);
        
        if (success) {
            this.telemetry?.logEvent('api.refactoring.applied', {
                id: refactoring.id,
                title: refactoring.title
            });
        }
        
        return success;
    }
    
    registerPropagationRule(rule: PropagationRule): void {
        this.customRules.push(rule);
        
        // Register with server
        if (this.client) {
            this.client.sendNotification('ontology/registerRule', {
                name: rule.name,
                description: rule.description
            });
        }
    }
    
    onConceptDiscovered(callback: (concept: ConceptInfo) => void): vscode.Disposable {
        return this.client?.onNotification('ontology/conceptDiscovered', (params: any) => {
            callback(this.convertConcept(params));
        }) || new vscode.Disposable(() => {});
    }
    
    onPatternLearned(callback: (pattern: Pattern) => void): vscode.Disposable {
        return this.client?.onNotification('ontology/patternLearned', callback) 
            || new vscode.Disposable(() => {});
    }
    
    onRefactoringApplied(callback: (refactoring: Refactoring) => void): vscode.Disposable {
        return this.eventEmitter.event((e) => {
            if (e.type === 'refactoringApplied') {
                callback(e.data);
            }
        });
    }
    
    async getStatistics(): Promise<Statistics> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        return await this.client.sendRequest('ontology/getStatistics', {});
    }
    
    async exportOntology(): Promise<OntologyData> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        return await this.client.sendRequest('ontology/export', {});
    }
    
    async importOntology(data: OntologyData): Promise<void> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        
        await this.client.sendRequest('ontology/import', { data });
    }

    async buildSymbolMap(symbol: string, options?: { uri?: string; maxFiles?: number; astOnly?: boolean }): Promise<any> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        const params = {
            symbol,
            uri: options?.uri,
            maxFiles: options?.maxFiles ?? 10,
            astOnly: options?.astOnly ?? true
        } as any;
        return await this.client.sendRequest('symbol/buildSymbolMap', params);
    }

    async planRename(oldName: string, newName: string, uri?: string): Promise<any> {
        if (!this.client) {
            throw new Error('Language server not available');
        }
        return await this.client.sendRequest('refactor/planRename', { oldName, newName, uri } as any);
    }
    
    private setupEventHandlers(): void {
        if (!this.client) return;
        
        // Setup custom rule processing
        this.client.onRequest('ontology/processCustomRule', async (params: any) => {
            const change = this.convertChange(params.change);
            
            for (const rule of this.customRules) {
                if (rule.matcher(change)) {
                    const propagated = await rule.propagate(change);
                    return propagated.map(c => ({
                        uri: c.uri,
                        range: {
                            start: { line: c.range.start.line, character: c.range.start.character },
                            end: { line: c.range.end.line, character: c.range.end.character }
                        },
                        newText: c.newText
                    }));
                }
            }
            
            return [];
        });
    }
    
    private convertConcept(data: any): ConceptInfo {
        return {
            id: data.id,
            name: data.name,
            type: data.type,
            uri: data.uri,
            range: new vscode.Range(
                data.range.start.line,
                data.range.start.character,
                data.range.end.line,
                data.range.end.character
            ),
            relationships: data.relationships || [],
            confidence: data.confidence || 1,
            metadata: data.metadata || {}
        };
    }
    
    private convertRefactoring(data: any): Refactoring {
        return {
            id: data.id,
            title: data.title,
            description: data.description,
            confidence: data.confidence,
            changes: data.changes.map((c: any) => this.convertChange(c))
        };
    }
    
    private convertChange(data: any): Change {
        return {
            uri: data.uri,
            range: new vscode.Range(
                data.range.start.line,
                data.range.start.character,
                data.range.end.line,
                data.range.end.character
            ),
            newText: data.newText
        };
    }
    
    /**
     * Advanced API for AI integration (future-proofing)
     */
    async analyzeWithAI(code: string, prompt: string): Promise<any> {
        // Placeholder for future AI integration
        // This would connect to an AI service for advanced analysis
        return {
            analysis: 'AI analysis not yet implemented',
            suggestions: []
        };
    }
    
    /**
     * Get the raw language client for advanced usage
     */
    getLanguageClient(): LanguageClient | undefined {
        return this.client;
    }
    
    /**
     * Get configuration
     */
    getConfiguration(): Record<string, any> {
        return this.config.getAll();
    }
}
