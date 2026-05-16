// Confidence Calculator - Calculates confidence scores for patterns
import type { Example, Pattern } from '../types/core';
import type { PatternCandidate } from './pattern-learner';

export class ConfidenceCalculator {
    calculate(pattern: Pattern): number {
        let confidence = 0;

        // Base confidence from occurrences (logarithmic growth)
        confidence += this.occurrenceScore(pattern.occurrences);

        // Consistency score based on examples
        confidence += this.consistencyScore(pattern.examples);

        // Recency bonus
        confidence += this.recencyScore(pattern.lastApplied);

        // Category-specific adjustments
        confidence += this.categoryScore(pattern.category);

        // Complexity penalty (simpler patterns are more reliable)
        confidence -= this.complexityPenalty(pattern);

        // Example quality bonus
        confidence += this.exampleQualityScore(pattern.examples);

        return Math.max(0, Math.min(1, confidence));
    }

    calculateFromCandidate(candidate: PatternCandidate): number {
        let confidence = candidate.confidence;

        // Boost based on occurrences
        confidence += this.occurrenceScore(candidate.occurrences);

        // Consistency score
        confidence += this.consistencyScore(candidate.examples);

        // Category bonus
        confidence += this.categoryScore(candidate.category);

        return Math.max(0, Math.min(1, confidence));
    }

    private occurrenceScore(occurrences: number): number {
        if (occurrences <= 0) return 0;

        // Logarithmic growth with diminishing returns
        const baseScore = Math.log10(occurrences + 1) * 0.15;

        // Bonus for reaching certain milestones
        let bonus = 0;
        if (occurrences >= 3) bonus += 0.1; // First milestone
        if (occurrences >= 10) bonus += 0.05; // Second milestone
        if (occurrences >= 50) bonus += 0.05; // Third milestone

        return Math.min(0.4, baseScore + bonus);
    }

    private consistencyScore(examples: Example[]): number {
        if (examples.length < 2) return 0;

        // Group examples by transformation pattern
        const transformationGroups = new Map<string, number>();

        for (const example of examples) {
            const transformation = this.extractTransformation(example.oldName, example.newName);
            const count = transformationGroups.get(transformation) || 0;
            transformationGroups.set(transformation, count + 1);
        }

        // Calculate consistency as the dominance of the most common transformation
        const maxCount = Math.max(...transformationGroups.values());
        const consistency = maxCount / examples.length;

        // Score based on consistency
        let score = 0;
        if (consistency >= 0.8)
            score = 0.2; // Very consistent
        else if (consistency >= 0.6)
            score = 0.15; // Moderately consistent
        else if (consistency >= 0.4) score = 0.1; // Somewhat consistent

        return score;
    }

    private recencyScore(lastApplied: Date): number {
        const now = Date.now();
        const lastAppliedTime = lastApplied.getTime();
        const daysSince = (now - lastAppliedTime) / (1000 * 60 * 60 * 24);

        // Decay function for recency
        if (daysSince < 1) return 0.15; // Very recent
        if (daysSince < 7) return 0.1; // Recent
        if (daysSince < 30) return 0.05; // Somewhat recent
        if (daysSince < 90) return 0.02; // Old
        return 0; // Very old
    }

    private categoryScore(category: string): number {
        // Different categories have different reliability
        const categoryScores: Record<string, number> = {
            rename: 0.05, // Basic renaming
            refactor: 0.1, // Structural refactoring
            convention: 0.15, // Naming convention changes (most reliable)
            migration: 0.08, // Version/API migrations
        };

        return categoryScores[category] || 0.05;
    }

    private complexityPenalty(pattern: Pattern): number {
        // Calculate pattern complexity
        const fromComplexity = this.calculatePatternComplexity(pattern.from);
        const toComplexity = this.calculatePatternComplexity(pattern.to);
        const totalComplexity = fromComplexity + toComplexity;

        // Penalty for overly complex patterns
        if (totalComplexity > 10) return 0.2;
        if (totalComplexity > 6) return 0.1;
        if (totalComplexity > 4) return 0.05;

        return 0;
    }

    private calculatePatternComplexity(tokenPatterns: any[]): number {
        let complexity = tokenPatterns.length;

        for (const token of tokenPatterns) {
            // More complex token types increase complexity
            switch (token.type) {
                case 'literal':
                    complexity += 0; // Base case
                    break;
                case 'variable':
                    complexity += 1;
                    break;
                case 'class':
                    complexity += 2;
                    break;
                case 'transform':
                    complexity += 3;
                    break;
                default:
                    complexity += 1;
            }
        }

        return complexity;
    }

    private exampleQualityScore(examples: Example[]): number {
        if (examples.length === 0) return 0;

        let qualityScore = 0;

        // Average confidence of examples
        const avgConfidence =
            examples.reduce((sum, ex) => sum + (Number.isFinite(ex.confidence) ? ex.confidence : 0), 0) /
            examples.length;
        qualityScore += avgConfidence * 0.1;

        // Bonus for having examples from different contexts
        const uniqueFiles = new Set(examples.map((ex, i) => (ex as any)?.context?.file ?? `unknown-${i}`));
        const contextDiversity = uniqueFiles.size / examples.length;
        qualityScore += contextDiversity * 0.05;

        // Bonus for having recent examples
        const recentExamples = examples.filter((ex) => {
            const ts = (ex as any)?.context?.timestamp;
            const t = ts instanceof Date ? ts.getTime() : 0;
            const daysSince = (Date.now() - t) / (1000 * 60 * 60 * 24);
            return daysSince <= 30 && t > 0;
        });

        if (recentExamples.length > 0) {
            qualityScore += Math.min(0.05, recentExamples.length * 0.01);
        }

        return Math.min(0.15, qualityScore);
    }

    private extractTransformation(oldName: string, newName: string): string {
        // Extract the type of transformation for consistency analysis
        const oldTokens = this.tokenize(oldName);
        const newTokens = this.tokenize(newName);

        if (oldTokens.length !== newTokens.length) {
            return `${oldTokens.length}->${newTokens.length}`;
        }

        const transformations: string[] = [];

        for (let i = 0; i < oldTokens.length; i++) {
            const oldToken = oldTokens[i];
            const newToken = newTokens[i];

            if (oldToken === newToken) {
                transformations.push('=');
            } else {
                // Check for common transformation patterns
                if (this.areSynonyms(oldToken, newToken)) {
                    transformations.push('syn');
                } else if (this.isInflection(oldToken, newToken)) {
                    transformations.push('inf');
                } else {
                    transformations.push('sub');
                }
            }
        }

        return transformations.join('-');
    }

    private tokenize(identifier: string): string[] {
        return identifier
            .split(/(?=[A-Z])|_|-|\s+/)
            .map((token) => token.toLowerCase())
            .filter((token) => token.length > 0);
    }

    private areSynonyms(token1: string, token2: string): boolean {
        const synonymGroups = [
            ['get', 'fetch', 'retrieve', 'load'],
            ['set', 'update', 'modify', 'change'],
            ['create', 'make', 'build', 'generate'],
            ['delete', 'remove', 'destroy', 'clear'],
            ['find', 'search', 'locate', 'discover'],
            ['handle', 'process', 'execute', 'perform'],
            ['validate', 'check', 'verify', 'confirm'],
        ];

        for (const group of synonymGroups) {
            if (group.includes(token1) && group.includes(token2)) {
                return true;
            }
        }

        return false;
    }

    private isInflection(token1: string, token2: string): boolean {
        // Check for common inflections (pluralization, tense changes, etc.)

        // Plural/singular
        if (
            (token1.endsWith('s') && token1.slice(0, -1) === token2) ||
            (token2.endsWith('s') && token2.slice(0, -1) === token1)
        ) {
            return true;
        }

        // Past tense variations
        if (
            (token1.endsWith('ed') && token1.slice(0, -2) === token2) ||
            (token2.endsWith('ed') && token2.slice(0, -2) === token1)
        ) {
            return true;
        }

        // Progressive tense variations
        if (
            (token1.endsWith('ing') && token1.slice(0, -3) === token2) ||
            (token2.endsWith('ing') && token2.slice(0, -3) === token1)
        ) {
            return true;
        }

        return false;
    }

    // Public utility methods

    calculatePredictionConfidence(
        pattern: Pattern,
        identifier: string,
        contextFactors: {
            recentlyUsed?: boolean;
            similarContext?: boolean;
            highExampleQuality?: boolean;
        } = {}
    ): number {
        let baseConfidence = pattern.confidence;

        // Apply context-specific adjustments
        if (contextFactors.recentlyUsed) {
            baseConfidence += 0.1;
        }

        if (contextFactors.similarContext) {
            baseConfidence += 0.05;
        }

        if (contextFactors.highExampleQuality) {
            baseConfidence += 0.05;
        }

        // Identifier-specific factors
        const identifierTokens = this.tokenize(identifier);
        const patternComplexity = this.calculatePatternComplexity(pattern.from);

        // Penalty for applying complex patterns to simple identifiers
        if (patternComplexity > identifierTokens.length * 2) {
            baseConfidence -= 0.1;
        }

        // Bonus for exact pattern match complexity
        if (patternComplexity === identifierTokens.length) {
            baseConfidence += 0.05;
        }

        return Math.max(0, Math.min(1, baseConfidence));
    }

    shouldPromoteCandidate(candidate: PatternCandidate, threshold: number = 0.7): boolean {
        const candidateConfidence = this.calculateFromCandidate(candidate);
        return candidateConfidence >= threshold && candidate.occurrences >= 3;
    }

    rankPatterns(patterns: Pattern[]): Pattern[] {
        return patterns
            .map((pattern) => ({
                pattern,
                score: this.calculate(pattern),
            }))
            .sort((a, b) => b.score - a.score)
            .map((item) => item.pattern);
    }

    getConfidenceExplanation(pattern: Pattern): {
        totalConfidence: number;
        breakdown: {
            occurrences: number;
            consistency: number;
            recency: number;
            category: number;
            complexity: number;
            exampleQuality: number;
        };
        factors: string[];
    } {
        const breakdown = {
            occurrences: this.occurrenceScore(pattern.occurrences),
            consistency: this.consistencyScore(pattern.examples),
            recency: this.recencyScore(pattern.lastApplied),
            category: this.categoryScore(pattern.category),
            complexity: -this.complexityPenalty(pattern),
            exampleQuality: this.exampleQualityScore(pattern.examples),
        };

        const totalConfidence = this.calculate(pattern);

        const factors: string[] = [];

        if (breakdown.occurrences > 0.2) factors.push('High usage frequency');
        if (breakdown.consistency > 0.15) factors.push('Very consistent transformations');
        if (breakdown.recency > 0.1) factors.push('Recently used');
        if (breakdown.category > 0.1) factors.push('Reliable pattern category');
        if (breakdown.complexity < -0.1) factors.push('High pattern complexity');
        if (breakdown.exampleQuality > 0.1) factors.push('High-quality examples');

        if (factors.length === 0) {
            factors.push('Basic pattern with limited evidence');
        }

        return {
            totalConfidence,
            breakdown,
            factors,
        };
    }
}
