// Concept Builder - Creates concepts from various sources of information
import { Concept, ConceptSignature, ConceptMetadata, SymbolRepresentation, ASTNode, EnhancedMatches } from '../types/core';
import { TreeSitterResult } from '../layers/tree-sitter';
import { v4 as uuidv4 } from 'uuid';

export interface BuildContext {
    identifier?: string;
    location?: {
        uri: string;
        range: any;
    };
    astNodes?: ASTNode[];
    matches?: EnhancedMatches;
    treeResults?: TreeSitterResult;
    usage?: UsageExample[];
}

export interface UsageExample {
    file: string;
    line: number;
    context: string;
    type: 'call' | 'reference' | 'definition';
}

export class ConceptBuilder {
    
    async buildFromContext(identifier: string, context: BuildContext): Promise<Concept | null> {
        if (!this.isValidIdentifier(identifier)) {
            return null;
        }
        
        const concept: Concept = {
            id: uuidv4(),
            canonicalName: this.inferCanonicalName(identifier, context),
            representations: new Map(),
            relations: new Map(),
            signature: await this.buildSignature(identifier, context),
            evolution: [],
            metadata: await this.buildMetadata(identifier, context),
            confidence: this.calculateInitialConfidence(context)
        };
        
        // Add primary representation
        if (context.location) {
            concept.representations.set(identifier, {
                name: identifier,
                location: context.location,
                firstSeen: new Date(),
                lastSeen: new Date(),
                occurrences: 1,
                context: this.extractContextString(context)
            });
        }
        
        // Add alternative representations from matches
        if (context.matches) {
            await this.addRepresentationsFromMatches(concept, context.matches);
        }
        
        // Build relations from AST analysis
        if (context.astNodes) {
            await this.buildRelationsFromAST(concept, context.astNodes);
        }
        
        return concept;
    }
    
    async buildFromMatches(identifier: string, matches: EnhancedMatches): Promise<Concept | null> {
        const context: BuildContext = {
            identifier,
            matches
        };
        
        // Find the best location from matches
        const bestMatch = this.findBestMatch(matches);
        if (bestMatch) {
            context.location = {
                uri: `file://${bestMatch.file}`,
                range: {
                    start: { line: bestMatch.line, character: bestMatch.column },
                    end: { line: bestMatch.line, character: bestMatch.column + bestMatch.length }
                }
            };
        }
        
        return this.buildFromContext(identifier, context);
    }
    
    async buildFromASTNode(node: ASTNode, context: BuildContext = {}): Promise<Concept | null> {
        const identifier = context.identifier || this.extractIdentifierFromNode(node);
        if (!identifier) return null;
        
        const buildContext: BuildContext = {
            ...context,
            identifier,
            location: {
                uri: node.id.split(':')[0], // Extract file path from node ID
                range: node.range
            },
            astNodes: [node]
        };
        
        return this.buildFromContext(identifier, buildContext);
    }
    
    private isValidIdentifier(identifier: string): boolean {
        // Basic validation
        if (!identifier || identifier.trim().length === 0) {
            return false;
        }
        
        // Check if it's a valid programming identifier
        const validPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
        
        // Allow some common patterns like camelCase, PascalCase, snake_case
        const commonPatterns = [
            /^[a-zA-Z_$][a-zA-Z0-9_$]*$/, // Standard identifier
            /^[a-zA-Z][a-zA-Z0-9]*$/, // Alphanumeric
            /^[a-z][a-zA-Z0-9]*$/, // camelCase
            /^[A-Z][a-zA-Z0-9]*$/, // PascalCase
            /^[a-z][a-z0-9_]*$/, // snake_case
        ];
        
        return commonPatterns.some(pattern => pattern.test(identifier));
    }
    
    private inferCanonicalName(identifier: string, context: BuildContext): string {
        // Use the identifier as-is for now, but could be enhanced with:
        // - Convention detection (camelCase vs snake_case)
        // - Domain-specific rules
        // - Statistical analysis of the codebase
        
        return identifier;
    }
    
    private async buildSignature(identifier: string, context: BuildContext): Promise<ConceptSignature> {
        const signature: ConceptSignature = {
            parameters: [],
            sideEffects: [],
            complexity: 1,
            fingerprint: this.generateFingerprint(identifier, context)
        };
        
        // Extract signature from AST nodes
        if (context.astNodes) {
            for (const node of context.astNodes) {
                if (node.type === 'function_declaration' || node.type === 'method_definition') {
                    signature.parameters = node.metadata.parameters || [];
                    signature.returnType = node.metadata.returnType;
                    signature.complexity = this.calculateComplexityFromNode(node);
                }
            }
        }
        
        // Detect side effects from usage patterns
        if (context.usage) {
            signature.sideEffects = this.detectSideEffects(context.usage);
        }
        
        return signature;
    }
    
    private async buildMetadata(identifier: string, context: BuildContext): Promise<ConceptMetadata> {
        const metadata: ConceptMetadata = {
            tags: [],
            category: this.inferCategory(identifier, context)
        };
        
        // Detect if it's an interface, class, etc.
        if (context.astNodes) {
            for (const node of context.astNodes) {
                if (node.type === 'interface_declaration') {
                    metadata.isInterface = true;
                }
                if (node.type === 'class_declaration' && node.text.includes('abstract')) {
                    metadata.isAbstract = true;
                }
            }
        }
        
        // Add tags based on naming patterns
        metadata.tags = this.generateTags(identifier, context);
        
        return metadata;
    }
    
    private calculateInitialConfidence(context: BuildContext): number {
        let confidence = 0.5; // Base confidence
        
        // Boost confidence based on available information
        if (context.location) confidence += 0.1;
        if (context.astNodes && context.astNodes.length > 0) confidence += 0.2;
        if (context.matches) {
            confidence += Math.min(0.2, context.matches.exact.length * 0.05);
        }
        if (context.usage && context.usage.length > 0) {
            confidence += Math.min(0.1, context.usage.length * 0.02);
        }
        
        return Math.min(1.0, confidence);
    }
    
    private async addRepresentationsFromMatches(concept: Concept, matches: EnhancedMatches): Promise<void> {
        const allMatches = [...matches.exact, ...matches.fuzzy, ...matches.conceptual];
        
        for (const match of allMatches) {
            if (!concept.representations.has(match.text)) {
                concept.representations.set(match.text, {
                    name: match.text,
                    location: {
                        uri: `file://${match.file}`,
                        range: {
                            start: { line: match.line, character: match.column },
                            end: { line: match.line, character: match.column + match.length }
                        }
                    },
                    firstSeen: new Date(),
                    lastSeen: new Date(),
                    occurrences: 1,
                    context: match.context
                });
            }
        }
    }
    
    private async buildRelationsFromAST(concept: Concept, astNodes: ASTNode[]): Promise<void> {
        // This would analyze AST nodes to find relationships
        // For now, just a placeholder implementation
        
        for (const node of astNodes) {
            // Look for import/export relationships
            if (node.metadata.imports) {
                for (const imp of node.metadata.imports) {
                    // Could create "imports" relations here
                }
            }
            
            // Look for calls/references
            if (node.metadata.calls) {
                for (const call of node.metadata.calls) {
                    // Could create "calls" relations here
                }
            }
        }
    }
    
    private findBestMatch(matches: EnhancedMatches): any | null {
        // Prefer exact matches first
        if (matches.exact.length > 0) {
            return matches.exact.reduce((best, current) => 
                current.confidence > best.confidence ? current : best
            );
        }
        
        // Then fuzzy matches
        if (matches.fuzzy.length > 0) {
            return matches.fuzzy.reduce((best, current) => 
                current.confidence > best.confidence ? current : best
            );
        }
        
        // Finally conceptual matches
        if (matches.conceptual.length > 0) {
            return matches.conceptual.reduce((best, current) => 
                current.confidence > best.confidence ? current : best
            );
        }
        
        return null;
    }
    
    private extractIdentifierFromNode(node: ASTNode): string | null {
        // Extract identifier based on node type
        switch (node.type) {
            case 'function_declaration':
                return node.metadata.functionName || null;
            
            case 'class_declaration':
                return node.metadata.className || null;
            
            case 'identifier':
                return node.text;
            
            case 'variable_declaration':
                // Would need to parse the node to extract variable name
                return this.parseVariableName(node.text);
            
            default:
                // Try to extract from text
                const match = node.text.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/);
                return match ? match[1] : null;
        }
    }
    
    private parseVariableName(text: string): string | null {
        // Simple variable name extraction
        const patterns = [
            /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
            /let\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
            /var\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
            /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
            /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1];
            }
        }
        
        return null;
    }
    
    private generateFingerprint(identifier: string, context: BuildContext): string {
        // Create a unique fingerprint for this concept
        const components = [
            identifier,
            context.location?.uri || '',
            (context.astNodes?.length || 0).toString(),
            (context.usage?.length || 0).toString()
        ];
        
        // Simple hash-like fingerprint
        return components.join('|').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    }
    
    private calculateComplexityFromNode(node: ASTNode): number {
        // Calculate cyclomatic complexity from AST node
        let complexity = 1; // Base complexity
        
        const text = node.text.toLowerCase();
        
        // Count decision points
        const patterns = [
            /\bif\b/g,
            /\belse\b/g,
            /\bfor\b/g,
            /\bwhile\b/g,
            /\bswitch\b/g,
            /\bcase\b/g,
            /\btry\b/g,
            /\bcatch\b/g,
            /\b&&\b/g,
            /\b\|\|\b/g
        ];
        
        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                complexity += matches.length;
            }
        }
        
        return complexity;
    }
    
    private detectSideEffects(usage: UsageExample[]): string[] {
        const sideEffects: string[] = [];
        
        for (const example of usage) {
            const context = example.context.toLowerCase();
            
            // Look for common side effect patterns
            if (context.includes('console.') || context.includes('log')) {
                sideEffects.push('logging');
            }
            if (context.includes('fetch') || context.includes('http') || context.includes('ajax')) {
                sideEffects.push('network');
            }
            if (context.includes('localstorage') || context.includes('sessionstorage')) {
                sideEffects.push('storage');
            }
            if (context.includes('dom') || context.includes('document') || context.includes('window')) {
                sideEffects.push('dom');
            }
            if (context.includes('settimeout') || context.includes('setinterval')) {
                sideEffects.push('async');
            }
        }
        
        return [...new Set(sideEffects)]; // Remove duplicates
    }
    
    private inferCategory(identifier: string, context: BuildContext): string | undefined {
        const lower = identifier.toLowerCase();
        
        // Service/utility patterns
        if (lower.includes('service') || lower.includes('util') || lower.includes('helper')) {
            return 'service';
        }
        
        // Controller patterns
        if (lower.includes('controller') || lower.includes('handler')) {
            return 'controller';
        }
        
        // Model/data patterns
        if (lower.includes('model') || lower.includes('entity') || lower.includes('data')) {
            return 'model';
        }
        
        // Component patterns
        if (lower.includes('component') || lower.includes('widget')) {
            return 'component';
        }
        
        // API patterns
        if (lower.includes('api') || lower.includes('endpoint') || lower.includes('route')) {
            return 'api';
        }
        
        // Based on AST node types
        if (context.astNodes) {
            for (const node of context.astNodes) {
                if (node.type === 'class_declaration') {
                    return 'class';
                }
                if (node.type === 'interface_declaration') {
                    return 'interface';
                }
                if (node.type === 'function_declaration') {
                    return 'function';
                }
            }
        }
        
        return undefined;
    }
    
    private generateTags(identifier: string, context: BuildContext): string[] {
        const tags: string[] = [];
        const lower = identifier.toLowerCase();
        
        // Naming convention tags
        if (/^[a-z][a-zA-Z0-9]*$/.test(identifier)) {
            tags.push('camelCase');
        }
        if (/^[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
            tags.push('PascalCase');
        }
        if (/^[a-z][a-z0-9_]*$/.test(identifier)) {
            tags.push('snake_case');
        }
        
        // Semantic tags based on naming patterns
        if (lower.startsWith('get') || lower.startsWith('fetch') || lower.startsWith('retrieve')) {
            tags.push('getter');
        }
        if (lower.startsWith('set') || lower.startsWith('update') || lower.startsWith('modify')) {
            tags.push('setter');
        }
        if (lower.startsWith('create') || lower.startsWith('make') || lower.startsWith('build')) {
            tags.push('factory');
        }
        if (lower.startsWith('delete') || lower.startsWith('remove') || lower.startsWith('destroy')) {
            tags.push('destructor');
        }
        if (lower.startsWith('validate') || lower.startsWith('check') || lower.startsWith('verify')) {
            tags.push('validator');
        }
        if (lower.startsWith('handle') || lower.startsWith('process') || lower.startsWith('execute')) {
            tags.push('handler');
        }
        
        // Domain-specific tags
        if (lower.includes('user') || lower.includes('person') || lower.includes('account')) {
            tags.push('user-management');
        }
        if (lower.includes('auth') || lower.includes('login') || lower.includes('permission')) {
            tags.push('authentication');
        }
        if (lower.includes('payment') || lower.includes('billing') || lower.includes('invoice')) {
            tags.push('payment');
        }
        if (lower.includes('email') || lower.includes('mail') || lower.includes('notification')) {
            tags.push('communication');
        }
        
        return tags;
    }
    
    private extractContextString(context: BuildContext): string | undefined {
        // Extract a meaningful context string from the build context
        if (context.usage && context.usage.length > 0) {
            return context.usage[0].context;
        }
        
        if (context.astNodes && context.astNodes.length > 0) {
            const node = context.astNodes[0];
            // Return a snippet of the surrounding code
            return node.text.length > 100 ? 
                node.text.substring(0, 100) + '...' : 
                node.text;
        }
        
        return undefined;
    }
}