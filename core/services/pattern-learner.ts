// Pattern Learning System - Learns refactoring patterns from developer actions
import { EventEmitter } from 'events';
import { 
    Pattern, TokenPattern, Example, RenameContext, PatternCategory,
    Concept, Change
} from '../types/core';
import { PatternStorage } from './pattern-storage';
import { ConfidenceCalculator } from './confidence-calculator';
import { v4 as uuidv4 } from 'uuid';

export interface PatternCandidate {
    key: string;
    from: TokenPattern[];
    to: TokenPattern[];
    occurrences: number;
    examples: Example[];
    category: PatternCategory;
    confidence: number;
}

export interface Prediction {
    original: string;
    suggested: string;
    pattern: Pattern;
    confidence: number;
    reason: string;
}

export interface LearningResult {
    pattern?: Pattern;
    strengthened?: boolean;
    newCandidate?: boolean;
}

export class PatternLearner extends EventEmitter {
    private patterns = new Map<string, Pattern>();
    private candidates = new Map<string, PatternCandidate>();
    private storage: PatternStorage;
    private confidenceCalculator: ConfidenceCalculator;
    private learningThreshold = 3;
    private confidenceThreshold = 0.7;
    private initPromise: Promise<void> | null = null;
    
    constructor(dbPath: string, config?: { learningThreshold?: number; confidenceThreshold?: number }) {
        super();
        this.storage = new PatternStorage(dbPath);
        this.confidenceCalculator = new ConfidenceCalculator();
        
        if (config) {
            this.learningThreshold = config.learningThreshold || 3;
            this.confidenceThreshold = config.confidenceThreshold || 0.7;
        }
        
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
        await this.loadExistingPatterns();
    }
    
    private async loadExistingPatterns(): Promise<void> {
        const patterns = await this.storage.loadAllPatterns();
        
        for (const pattern of patterns) {
            this.patterns.set(pattern.id, pattern);
        }
        
        console.log(`Loaded ${patterns.length} patterns from storage`);
    }
    
    async learnFromRename(
        oldName: string,
        newName: string,
        context: RenameContext
    ): Promise<LearningResult> {
        if (oldName === newName) {
            return {}; // No change, nothing to learn
        }
        
        // Extract pattern from the rename
        const patternKey = this.extractPatternKey(oldName, newName);
        
        // Check if pattern already exists
        const existingPattern = this.findPatternByKey(patternKey);
        
        if (existingPattern) {
            // Strengthen existing pattern
            return this.strengthenPattern(existingPattern, oldName, newName, context);
        }
        
        // Check if candidate exists
        const candidateKey = this.generateCandidateKey(patternKey);
        const existingCandidate = this.candidates.get(candidateKey);
        
        if (existingCandidate) {
            // Add to existing candidate
            existingCandidate.occurrences++;
            existingCandidate.examples.push({
                oldName,
                newName,
                context,
                confidence: 0.8
            });
            
            // Check if candidate should be promoted to pattern
            if (existingCandidate.occurrences >= this.learningThreshold) {
                const pattern = await this.promoteToPattern(existingCandidate);
                this.candidates.delete(candidateKey);
                return { pattern, newCandidate: false };
            }
            
            return { newCandidate: false };
        }
        
        // Create new candidate
        const newCandidate = this.createPatternCandidate(oldName, newName, context);
        this.candidates.set(candidateKey, newCandidate);
        
        console.log(`Created new pattern candidate: ${oldName} -> ${newName}`);
        
        return { newCandidate: true };
    }
    
    private async strengthenPattern(
        pattern: Pattern,
        oldName: string,
        newName: string,
        context: RenameContext
    ): Promise<LearningResult> {
        pattern.occurrences++;
        pattern.examples.push({
            oldName,
            newName,
            context,
            confidence: 0.9
        });
        
        // Update confidence
        pattern.confidence = this.confidenceCalculator.calculate(pattern);
        
        // Update last applied
        pattern.lastApplied = new Date();
        
        // Limit examples to prevent memory bloat
        if (pattern.examples.length > 20) {
            pattern.examples = this.selectBestExamples(pattern.examples, 15);
        }
        
        // Save updated pattern
        await this.storage.updatePattern(pattern);
        
        this.emit('patternStrengthened', pattern);
        
        console.log(`Strengthened pattern: ${pattern.id} (confidence: ${pattern.confidence.toFixed(2)})`);
        
        return { pattern, strengthened: true };
    }
    
    private createPatternCandidate(
        oldName: string,
        newName: string,
        context: RenameContext
    ): PatternCandidate {
        const fromTokens = this.analyzeIdentifier(oldName);
        const toTokens = this.analyzeIdentifier(newName);
        
        return {
            key: this.generateCandidateKey(this.extractPatternKey(oldName, newName)),
            from: fromTokens,
            to: toTokens,
            occurrences: 1,
            examples: [{
                oldName,
                newName,
                context,
                confidence: 0.7
            }],
            category: this.inferPatternCategory(oldName, newName),
            confidence: 0.5
        };
    }
    
    private async promoteToPattern(candidate: PatternCandidate): Promise<Pattern> {
        const pattern: Pattern = {
            id: uuidv4(),
            from: candidate.from,
            to: candidate.to,
            confidence: this.confidenceCalculator.calculateFromCandidate(candidate),
            occurrences: candidate.occurrences,
            examples: candidate.examples,
            lastApplied: new Date(),
            category: candidate.category
        };
        
        this.patterns.set(pattern.id, pattern);
        await this.storage.savePattern(pattern);
        
        this.emit('patternCreated', pattern);
        
        console.log(`Promoted candidate to pattern: ${pattern.id} (confidence: ${pattern.confidence.toFixed(2)})`);
        
        return pattern;
    }
    
    async applyPattern(pattern: Pattern, identifier: string): Promise<string | null> {
        if (!this.patternMatches(pattern.from, identifier)) {
            return null;
        }
        
        const tokens = this.tokenize(identifier);
        const result = this.transformTokens(tokens, pattern.from, pattern.to);
        
        if (!result) {
            return null;
        }
        
        // Update pattern usage statistics
        pattern.lastApplied = new Date();
        await this.storage.updatePattern(pattern);
        
        return this.reconstructIdentifier(result, identifier);
    }
    
    async predictNextRename(
        identifier: string,
        context?: { recentRenames?: Array<{ from: string; to: string; timestamp: Date }> }
    ): Promise<Prediction[]> {
        const predictions: Prediction[] = [];
        
        // Find applicable patterns
        for (const pattern of this.patterns.values()) {
            if (pattern.confidence < this.confidenceThreshold) {
                continue;
            }
            
            const result = await this.applyPattern(pattern, identifier);
            
            if (result && result !== identifier) {
                const confidence = this.calculatePredictionConfidence(
                    pattern,
                    identifier,
                    context?.recentRenames || []
                );
                
                predictions.push({
                    original: identifier,
                    suggested: result,
                    pattern,
                    confidence,
                    reason: this.explainPattern(pattern, identifier, result)
                });
            }
        }
        
        // Sort by confidence
        return predictions.sort((a, b) => b.confidence - a.confidence);
    }
    
    async findApplicablePatterns(identifier: string): Promise<Pattern[]> {
        const applicable: Pattern[] = [];
        
        for (const pattern of this.patterns.values()) {
            if (this.patternMatches(pattern.from, identifier) && 
                pattern.confidence >= this.confidenceThreshold) {
                applicable.push(pattern);
            }
        }
        
        return applicable.sort((a, b) => b.confidence - a.confidence);
    }
    
    async getActivePatterns(): Promise<Pattern[]> {
        return Array.from(this.patterns.values())
            .filter(p => p.confidence >= this.confidenceThreshold)
            .sort((a, b) => b.confidence - a.confidence);
    }
    
    // Pattern matching and transformation logic
    
    private extractPatternKey(oldName: string, newName: string): string {
        const oldTokens = this.tokenize(oldName);
        const newTokens = this.tokenize(newName);
        
        if (oldTokens.length !== newTokens.length) {
            // Different structure, create a generic pattern key
            return `${oldTokens.length}to${newTokens.length}`;
        }
        
        const transformations: string[] = [];
        
        for (let i = 0; i < oldTokens.length; i++) {
            const oldToken = oldTokens[i];
            const newToken = newTokens[i];
            
            if (oldToken === newToken) {
                transformations.push('KEEP');
            } else {
                transformations.push(`${oldToken}->${newToken}`);
            }
        }
        
        return transformations.join('|');
    }
    
    private generateCandidateKey(patternKey: string): string {
        return `candidate_${patternKey}`;
    }
    
    private findPatternByKey(patternKey: string): Pattern | null {
        // This is a simplified approach - in practice, you might want more sophisticated matching
        for (const pattern of this.patterns.values()) {
            if (this.getPatternKey(pattern) === patternKey) {
                return pattern;
            }
        }
        return null;
    }
    
    private getPatternKey(pattern: Pattern): string {
        // Reconstruct pattern key from pattern structure
        const transformations: string[] = [];
        
        for (let i = 0; i < Math.min(pattern.from.length, pattern.to.length); i++) {
            const fromToken = pattern.from[i];
            const toToken = pattern.to[i];
            
            if (fromToken.type === 'literal' && toToken.type === 'literal') {
                if (fromToken.value === toToken.value) {
                    transformations.push('KEEP');
                } else {
                    transformations.push(`${fromToken.value}->${toToken.value}`);
                }
            } else {
                transformations.push('TRANSFORM');
            }
        }
        
        return transformations.join('|');
    }
    
    private analyzeIdentifier(identifier: string): TokenPattern[] {
        const tokens = this.tokenize(identifier);
        const patterns: TokenPattern[] = [];
        
        for (const token of tokens) {
            // Classify token
            if (this.isCommonVerb(token)) {
                patterns.push({ type: 'class', class: 'verb', value: token });
            } else if (this.isCommonNoun(token)) {
                patterns.push({ type: 'class', class: 'noun', value: token });
            } else {
                patterns.push({ type: 'literal', value: token });
            }
        }
        
        return patterns;
    }
    
    private patternMatches(pattern: TokenPattern[], identifier: string): boolean {
        const tokens = this.tokenize(identifier);
        
        if (pattern.length !== tokens.length) {
            return false;
        }
        
        for (let i = 0; i < pattern.length; i++) {
            const patternToken = pattern[i];
            const token = tokens[i];
            
            if (!this.tokenMatches(patternToken, token)) {
                return false;
            }
        }
        
        return true;
    }
    
    private tokenMatches(patternToken: TokenPattern, token: string): boolean {
        switch (patternToken.type) {
            case 'literal':
                return patternToken.value === token;
            
            case 'class':
                return this.tokenMatchesClass(token, patternToken.class!);
            
            case 'variable':
                return true; // Variables match anything
            
            default:
                return false;
        }
    }
    
    private tokenMatchesClass(token: string, className: string): boolean {
        switch (className) {
            case 'verb':
                return this.isCommonVerb(token);
            case 'noun':
                return this.isCommonNoun(token);
            case 'adjective':
                return this.isCommonAdjective(token);
            default:
                return false;
        }
    }
    
    private transformTokens(
        tokens: string[],
        fromPattern: TokenPattern[],
        toPattern: TokenPattern[]
    ): string[] | null {
        if (tokens.length !== fromPattern.length) {
            return null;
        }
        
        const result: string[] = [];
        const variables = new Map<string, string>();
        
        // First pass: collect variables
        for (let i = 0; i < tokens.length; i++) {
            const fromToken = fromPattern[i];
            const token = tokens[i];
            
            if (fromToken.type === 'variable') {
                variables.set(fromToken.name!, token);
            }
        }
        
        // Second pass: generate result
        for (let i = 0; i < toPattern.length; i++) {
            const toToken = toPattern[i];
            
            switch (toToken.type) {
                case 'literal':
                    result.push(toToken.value!);
                    break;
                
                case 'variable':
                    const variableValue = variables.get(toToken.name!);
                    if (variableValue) {
                        result.push(variableValue);
                    } else {
                        return null; // Variable not found
                    }
                    break;
                
                case 'transform':
                    if (i < tokens.length) {
                        const transformed = this.applyTransformation(tokens[i], toToken.transform!);
                        result.push(transformed);
                    }
                    break;
                
                default:
                    result.push(tokens[i] || '');
            }
        }
        
        return result;
    }
    
    private applyTransformation(token: string, transformation: string): string {
        switch (transformation) {
            case 'uppercase':
                return token.toUpperCase();
            case 'lowercase':
                return token.toLowerCase();
            case 'capitalize':
                return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
            default:
                return token;
        }
    }
    
    private reconstructIdentifier(tokens: string[], originalIdentifier: string): string {
        // Infer original naming convention and apply it
        const convention = this.inferNamingConvention(originalIdentifier);
        
        switch (convention) {
            case 'camelCase':
                return this.toCamelCase(tokens);
            case 'PascalCase':
                return this.toPascalCase(tokens);
            case 'snake_case':
                return this.toSnakeCase(tokens);
            case 'kebab-case':
                return this.toKebabCase(tokens);
            default:
                return tokens.join('');
        }
    }
    
    // Utility methods
    
    private tokenize(identifier: string): string[] {
        return identifier
            .split(/(?=[A-Z])|_|-|\s+/)
            .map(token => token.toLowerCase())
            .filter(token => token.length > 0);
    }
    
    private inferNamingConvention(identifier: string): string {
        if (/^[a-z][a-zA-Z0-9]*$/.test(identifier)) {
            return 'camelCase';
        }
        if (/^[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
            return 'PascalCase';
        }
        if (/^[a-z][a-z0-9_]*$/.test(identifier)) {
            return 'snake_case';
        }
        if (/^[a-z][a-z0-9-]*$/.test(identifier)) {
            return 'kebab-case';
        }
        return 'camelCase'; // Default
    }
    
    private toCamelCase(tokens: string[]): string {
        if (tokens.length === 0) return '';
        
        return tokens[0].toLowerCase() + 
               tokens.slice(1).map(token => 
                   token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
               ).join('');
    }
    
    private toPascalCase(tokens: string[]): string {
        return tokens.map(token => 
            token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
        ).join('');
    }
    
    private toSnakeCase(tokens: string[]): string {
        return tokens.map(token => token.toLowerCase()).join('_');
    }
    
    private toKebabCase(tokens: string[]): string {
        return tokens.map(token => token.toLowerCase()).join('-');
    }
    
    private isCommonVerb(token: string): boolean {
        const commonVerbs = new Set([
            'get', 'set', 'fetch', 'create', 'delete', 'update', 'find', 'search',
            'load', 'save', 'handle', 'process', 'execute', 'run', 'start', 'stop',
            'validate', 'check', 'verify', 'parse', 'format', 'convert', 'transform'
        ]);
        return commonVerbs.has(token.toLowerCase());
    }
    
    private isCommonNoun(token: string): boolean {
        const commonNouns = new Set([
            'user', 'data', 'info', 'item', 'list', 'array', 'object', 'element',
            'service', 'manager', 'controller', 'handler', 'helper', 'util', 'tool',
            'config', 'setting', 'option', 'value', 'result', 'response', 'request'
        ]);
        return commonNouns.has(token.toLowerCase());
    }
    
    private isCommonAdjective(token: string): boolean {
        const commonAdjectives = new Set([
            'new', 'old', 'active', 'inactive', 'enabled', 'disabled', 'valid', 'invalid',
            'current', 'previous', 'next', 'first', 'last', 'primary', 'secondary'
        ]);
        return commonAdjectives.has(token.toLowerCase());
    }
    
    private inferPatternCategory(oldName: string, newName: string): PatternCategory {
        const oldLower = oldName.toLowerCase();
        const newLower = newName.toLowerCase();
        
        // Check for common refactoring patterns
        if (oldLower.includes('get') && newLower.includes('fetch')) {
            return PatternCategory.Convention;
        }
        
        if (oldLower.includes('service') || newLower.includes('service')) {
            return PatternCategory.Refactor;
        }
        
        if (this.isVersionChange(oldName, newName)) {
            return PatternCategory.Migration;
        }
        
        return PatternCategory.Rename;
    }
    
    private isVersionChange(oldName: string, newName: string): boolean {
        return /v\d+/i.test(oldName) && /v\d+/i.test(newName);
    }
    
    private selectBestExamples(examples: Example[], count: number): Example[] {
        return examples
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, count);
    }
    
    private calculatePredictionConfidence(
        pattern: Pattern,
        identifier: string,
        recentRenames: Array<{ from: string; to: string; timestamp: Date }>
    ): number {
        let confidence = pattern.confidence;
        
        // Boost if pattern was recently used
        const recentUse = recentRenames.find(rename => {
            const extractedPattern = this.extractPatternKey(rename.from, rename.to);
            return extractedPattern === this.getPatternKey(pattern);
        });
        
        if (recentUse) {
            const recencyBoost = Math.max(0, 1 - 
                (Date.now() - recentUse.timestamp.getTime()) / (1000 * 60 * 60)); // 1 hour
            confidence += recencyBoost * 0.2;
        }
        
        // Penalty for old patterns
        const daysSinceLastApplied = (Date.now() - pattern.lastApplied.getTime()) / (1000 * 60 * 60 * 24);
        const agePenalty = Math.min(0.3, daysSinceLastApplied / 30); // Max penalty after 30 days
        confidence -= agePenalty;
        
        return Math.max(0, Math.min(1, confidence));
    }
    
    private explainPattern(pattern: Pattern, original: string, suggested: string): string {
        const category = pattern.category;
        const occurrences = pattern.occurrences;
        
        return `${category} pattern applied (used ${occurrences} times, confidence: ${(pattern.confidence * 100).toFixed(0)}%)`;
    }
    
    // Management methods
    
    async getStatistics(): Promise<{
        totalPatterns: number;
        activePatternspatterns: number;
        totalCandidates: number;
        averageConfidence: number;
        topPatterns: Array<{ id: string; occurrences: number; confidence: number }>;
    }> {
        const patterns = Array.from(this.patterns.values());
        const activePatterns = patterns.filter(p => p.confidence >= this.confidenceThreshold);
        
        const totalConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0);
        const averageConfidence = patterns.length > 0 ? totalConfidence / patterns.length : 0;
        
        const topPatterns = patterns
            .sort((a, b) => b.occurrences - a.occurrences)
            .slice(0, 10)
            .map(p => ({ id: p.id, occurrences: p.occurrences, confidence: p.confidence }));
        
        return {
            totalPatterns: patterns.length,
            activePatternspatterns: activePatterns.length,
            totalCandidates: this.candidates.size,
            averageConfidence,
            topPatterns
        };
    }
    
    async dispose(): Promise<void> {
        await this.storage.close();
        this.removeAllListeners();
    }

    async importPattern(patternData: any): Promise<void> {
        const pattern: Pattern = {
            id: patternData.id || uuidv4(),
            from: patternData.from,
            to: patternData.to,
            category: patternData.category || PatternCategory.General,
            confidence: patternData.confidence || 0.5,
            examples: patternData.examples || [],
            metadata: patternData.metadata || {},
            createdAt: patternData.createdAt ? new Date(patternData.createdAt) : new Date(),
            lastApplied: patternData.lastApplied ? new Date(patternData.lastApplied) : new Date(),
            occurrences: patternData.occurrences || 0
        };
        
        this.patterns.set(pattern.id, pattern);
        await this.storage.savePattern(pattern);
    }

    async exportPatterns(): Promise<any[]> {
        const patterns: any[] = [];
        
        for (const [id, pattern] of this.patterns) {
            patterns.push({
                id: pattern.id,
                from: pattern.from,
                to: pattern.to,
                category: pattern.category,
                confidence: pattern.confidence,
                examples: pattern.examples,
                metadata: pattern.metadata,
                createdAt: pattern.createdAt,
                lastApplied: pattern.lastApplied,
                occurrences: pattern.occurrences
            });
        }
        
        return patterns;
    }
}