// Similarity Calculator - Computes semantic and syntactic similarity between identifiers
import leven from 'leven';

export class SimilarityCalculator {
    private synonyms = new Map<string, string[]>();
    private embeddings = new Map<string, number[]>();
    private tokenCache = new Map<string, string[]>();

    constructor() {
        this.initializeSynonyms();
    }

    private initializeSynonyms(): void {
        const synonymGroups = [
            ['get', 'fetch', 'retrieve', 'load', 'obtain', 'find'],
            ['set', 'update', 'modify', 'change', 'assign', 'put'],
            ['create', 'make', 'build', 'generate', 'produce', 'new'],
            ['delete', 'remove', 'destroy', 'eliminate', 'clear'],
            ['validate', 'check', 'verify', 'confirm', 'ensure'],
            ['handle', 'process', 'execute', 'run', 'perform'],
            ['calculate', 'compute', 'determine', 'evaluate'],
            ['convert', 'transform', 'translate', 'parse'],
            ['send', 'transmit', 'emit', 'dispatch', 'publish'],
            ['receive', 'accept', 'consume', 'listen'],
            ['save', 'store', 'persist', 'write'],
            ['load', 'read', 'import', 'restore'],
            ['user', 'person', 'account', 'profile'],
            ['item', 'element', 'entity', 'object'],
            ['list', 'array', 'collection', 'set'],
            ['data', 'info', 'information', 'details'],
            ['config', 'configuration', 'settings', 'options'],
            ['service', 'manager', 'handler', 'controller'],
            ['util', 'utility', 'helper', 'tool'],
        ];

        for (const group of synonymGroups) {
            for (const word of group) {
                this.synonyms.set(
                    word,
                    group.filter((w) => w !== word)
                );
            }
        }
    }

    async calculate(identifier1: string, identifier2: string): Promise<number> {
        if (identifier1 === identifier2) {
            return 1.0;
        }

        // Combine multiple similarity measures
        const editSimilarity = this.calculateEditSimilarity(identifier1, identifier2);
        const tokenSimilarity = await this.calculateTokenSimilarity(identifier1, identifier2);
        const semanticSimilarity = await this.calculateSemanticSimilarity(identifier1, identifier2);
        const structuralSimilarity = this.calculateStructuralSimilarity(identifier1, identifier2);

        // Weighted combination
        const weights = {
            edit: 0.2,
            token: 0.3,
            semantic: 0.3,
            structural: 0.2,
        };

        const totalSimilarity =
            editSimilarity * weights.edit +
            tokenSimilarity * weights.token +
            semanticSimilarity * weights.semantic +
            structuralSimilarity * weights.structural;

        return Math.min(1.0, totalSimilarity);
    }

    private calculateEditSimilarity(str1: string, str2: string): number {
        const maxLength = Math.max(str1.length, str2.length);
        if (maxLength === 0) return 1.0;

        const distance = leven(str1.toLowerCase(), str2.toLowerCase());
        return 1 - distance / maxLength;
    }

    private async calculateTokenSimilarity(identifier1: string, identifier2: string): Promise<number> {
        const tokens1 = this.tokenize(identifier1);
        const tokens2 = this.tokenize(identifier2);

        if (tokens1.length === 0 || tokens2.length === 0) {
            return 0;
        }

        // Calculate Jaccard similarity with semantic expansion
        const expandedTokens1 = this.expandTokens(tokens1);
        const expandedTokens2 = this.expandTokens(tokens2);

        const set1 = new Set(expandedTokens1);
        const set2 = new Set(expandedTokens2);

        const intersection = new Set([...set1].filter((x) => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return intersection.size / union.size;
    }

    private async calculateSemanticSimilarity(identifier1: string, identifier2: string): Promise<number> {
        // This is a simplified implementation
        // In a real system, you might use word embeddings like Word2Vec, GloVe, or BERT

        const tokens1 = this.tokenize(identifier1);
        const tokens2 = this.tokenize(identifier2);

        let semanticScore = 0;
        let comparisons = 0;

        for (const token1 of tokens1) {
            for (const token2 of tokens2) {
                const score = this.getTokenSemanticSimilarity(token1, token2);
                semanticScore += score;
                comparisons++;
            }
        }

        return comparisons > 0 ? semanticScore / comparisons : 0;
    }

    private calculateStructuralSimilarity(identifier1: string, identifier2: string): number {
        // Compare structural patterns like naming conventions
        const patterns1 = this.extractStructuralPatterns(identifier1);
        const patterns2 = this.extractStructuralPatterns(identifier2);

        let matches = 0;
        const totalPatterns = Math.max(patterns1.length, patterns2.length);

        for (let i = 0; i < Math.min(patterns1.length, patterns2.length); i++) {
            if (patterns1[i] === patterns2[i]) {
                matches++;
            }
        }

        return totalPatterns > 0 ? matches / totalPatterns : 0;
    }

    private tokenize(identifier: string): string[] {
        if (this.tokenCache.has(identifier)) {
            return this.tokenCache.get(identifier)!;
        }

        // Split on various boundaries
        const tokens = identifier
            .split(/(?=[A-Z])|_|-|\s+/) // camelCase, snake_case, kebab-case, spaces
            .map((token) => token.toLowerCase())
            .filter((token) => token.length > 0)
            .filter((token) => !this.isStopWord(token));

        this.tokenCache.set(identifier, tokens);
        return tokens;
    }

    private expandTokens(tokens: string[]): string[] {
        const expanded = [...tokens];

        for (const token of tokens) {
            const synonyms = this.synonyms.get(token);
            if (synonyms) {
                expanded.push(...synonyms);
            }
        }

        return expanded;
    }

    private getTokenSemanticSimilarity(token1: string, token2: string): number {
        if (token1 === token2) {
            return 1.0;
        }

        // Check if they're synonyms
        const synonyms1 = this.synonyms.get(token1) || [];
        const synonyms2 = this.synonyms.get(token2) || [];

        if (synonyms1.includes(token2) || synonyms2.includes(token1)) {
            return 0.9;
        }

        // Check if they share synonyms (transitively related)
        const sharedSynonyms = synonyms1.filter((syn) => synonyms2.includes(syn));
        if (sharedSynonyms.length > 0) {
            return 0.7;
        }

        // Check edit distance for morphological similarity
        const editSim = this.calculateEditSimilarity(token1, token2);
        if (editSim > 0.7) {
            return editSim * 0.6; // Reduce confidence for edit similarity
        }

        return 0;
    }

    private extractStructuralPatterns(identifier: string): string[] {
        const patterns = [];

        // Naming convention patterns
        if (/^[a-z][a-zA-Z0-9]*$/.test(identifier)) {
            patterns.push('camelCase');
        }
        if (/^[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
            patterns.push('PascalCase');
        }
        if (/^[a-z][a-z0-9_]*$/.test(identifier)) {
            patterns.push('snake_case');
        }
        if (/^[A-Z][A-Z0-9_]*$/.test(identifier)) {
            patterns.push('SCREAMING_SNAKE_CASE');
        }
        if (/^[a-z][a-z0-9-]*$/.test(identifier)) {
            patterns.push('kebab-case');
        }

        // Prefix patterns
        const prefixes = ['get', 'set', 'is', 'has', 'can', 'should', 'will', 'create', 'delete', 'update', 'handle'];
        for (const prefix of prefixes) {
            if (identifier.toLowerCase().startsWith(prefix)) {
                patterns.push(`prefix_${prefix}`);
            }
        }

        // Suffix patterns
        const suffixes = ['er', 'or', 'ing', 'ed', 'able', 'ible', 'service', 'manager', 'controller', 'handler'];
        for (const suffix of suffixes) {
            if (identifier.toLowerCase().endsWith(suffix)) {
                patterns.push(`suffix_${suffix}`);
            }
        }

        // Length patterns
        if (identifier.length <= 3) {
            patterns.push('short');
        } else if (identifier.length <= 10) {
            patterns.push('medium');
        } else {
            patterns.push('long');
        }

        // Character type patterns
        if (/\d/.test(identifier)) {
            patterns.push('contains_numbers');
        }
        if (/_/.test(identifier)) {
            patterns.push('contains_underscores');
        }
        if (/-/.test(identifier)) {
            patterns.push('contains_hyphens');
        }

        return patterns;
    }

    private isStopWord(word: string): boolean {
        const stopWords = new Set([
            'a',
            'an',
            'and',
            'are',
            'as',
            'at',
            'be',
            'by',
            'for',
            'from',
            'has',
            'he',
            'in',
            'is',
            'it',
            'its',
            'of',
            'on',
            'that',
            'the',
            'to',
            'was',
            'will',
            'with',
            'var',
            'let',
            'const',
            'function',
            'class',
            'interface',
            'type',
            'enum',
            'public',
            'private',
            'protected',
        ]);

        return stopWords.has(word.toLowerCase());
    }

    // Utility methods for external use

    async calculateBatchSimilarity(
        target: string,
        candidates: string[]
    ): Promise<{ identifier: string; similarity: number }[]> {
        const results = await Promise.all(
            candidates.map(async (candidate) => ({
                identifier: candidate,
                similarity: await this.calculate(target, candidate),
            }))
        );

        return results.filter((result) => result.similarity > 0).sort((a, b) => b.similarity - a.similarity);
    }

    findMostSimilar(target: string, candidates: string[]): string | null {
        let mostSimilar: string | null = null;
        let highestSimilarity = 0;

        for (const candidate of candidates) {
            // Use synchronous similarity for performance
            const similarity = this.calculateQuickSimilarity(target, candidate);

            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                mostSimilar = candidate;
            }
        }

        return highestSimilarity > 0.3 ? mostSimilar : null;
    }

    private calculateQuickSimilarity(str1: string, str2: string): number {
        if (str1 === str2) return 1.0;

        // Quick similarity based on edit distance and token overlap
        const editSim = this.calculateEditSimilarity(str1, str2);

        const tokens1 = this.tokenize(str1);
        const tokens2 = this.tokenize(str2);

        const set1 = new Set(tokens1);
        const set2 = new Set(tokens2);
        const intersection = new Set([...set1].filter((x) => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        const tokenSim = union.size > 0 ? intersection.size / union.size : 0;

        return editSim * 0.4 + tokenSim * 0.6;
    }

    // Configuration methods

    addSynonymGroup(words: string[]): void {
        for (const word of words) {
            this.synonyms.set(
                word,
                words.filter((w) => w !== word)
            );
        }
    }

    addSynonym(word: string, synonym: string): void {
        const existing = this.synonyms.get(word) || [];
        if (!existing.includes(synonym)) {
            existing.push(synonym);
            this.synonyms.set(word, existing);
        }

        // Add reverse mapping
        const reverseExisting = this.synonyms.get(synonym) || [];
        if (!reverseExisting.includes(word)) {
            reverseExisting.push(word);
            this.synonyms.set(synonym, reverseExisting);
        }
    }

    clearCache(): void {
        this.tokenCache.clear();
        this.embeddings.clear();
    }

    getStatistics(): {
        synonymGroups: number;
        totalSynonyms: number;
        cacheSize: number;
    } {
        const uniqueGroups = new Set();
        for (const synonyms of this.synonyms.values()) {
            uniqueGroups.add(synonyms.sort().join(','));
        }

        return {
            synonymGroups: uniqueGroups.size,
            totalSynonyms: this.synonyms.size,
            cacheSize: this.tokenCache.size,
        };
    }
}
