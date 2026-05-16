/**
 * Protocol-agnostic CodeAnalyzer
 * The single source of truth for all code analysis operations
 */

import { CacheService } from './services/cache.js'
import { DatabaseService } from './services/database.js'
import { LayerStack } from './layers/index.js'
import {
  FindDefinitionParams,
  FindDefinitionResult,
  FindReferencesParams,
  FindReferencesResult,
  FindImplementationsParams,
  FindImplementationsResult,
  HoverParams,
  HoverResult,
  CompletionParams,
  CompletionResult,
  RenameParams,
  RenameResult,
  DiagnosticParams,
  DiagnosticResult,
  PatternParams,
  FeedbackParams,
  ConceptParams,
  ConceptResult,
  RelationshipParams,
  RelationshipResult,
} from './types/api.js'

export class CodeAnalyzer {
  private layers: LayerStack
  private cache: CacheService
  private db: DatabaseService

  constructor(
    layers: LayerStack,
    cache: CacheService,
    db: DatabaseService
  ) {
    this.layers = layers
    this.cache = cache
    this.db = db
  }

  /**
   * Find where a symbol is defined
   * Progressive enhancement through layers with caching
   */
  async findDefinition(params: FindDefinitionParams): Promise<FindDefinitionResult> {
    // Check cache first
    const cacheKey = `def:${params.symbol}:${params.location?.uri || ''}`
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Start with fast search layer (5ms target)
    let result = await this.layers.search.findDefinition(params)
    
    // Enhance with AST if confidence is low (50ms target)
    if (result.confidence < 0.8) {
      result = await this.layers.ast.enhanceDefinition(result, params)
    }
    
    // Further enhance with semantic layer (10ms target)
    if (result.confidence < 0.9) {
      result = await this.layers.semantic.enhanceDefinition(result, params)
    }
    
    // Learn from this query for future improvements
    await this.layers.patterns.recordQuery(params, result)
    
    // Cache the result
    await this.cache.set(cacheKey, result, { ttl: 3600 })
    
    return result
  }

  /**
   * Find all references to a symbol
   */
  async findReferences(params: FindReferencesParams): Promise<FindReferencesResult> {
    const cacheKey = `ref:${params.symbol}:${params.location?.uri || ''}`
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Progressive enhancement through layers
    let result = await this.layers.search.findReferences(params)
    
    if (result.references.length < 100) {
      // Only enhance if result set is manageable
      result = await this.layers.ast.enhanceReferences(result, params)
      result = await this.layers.semantic.enhanceReferences(result, params)
    }
    
    // Learn from this query
    await this.layers.patterns.recordQuery(params, result)
    
    // Cache the result
    await this.cache.set(cacheKey, result, { ttl: 1800 })
    
    return result
  }

  /**
   * Find implementations of an interface/abstract class
   */
  async findImplementations(params: FindImplementationsParams): Promise<FindImplementationsResult> {
    const cacheKey = `impl:${params.symbol}:${params.location?.uri || ''}`
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Use semantic layer primarily for implementations
    const result = await this.layers.semantic.findImplementations(params)
    
    // Cache the result
    await this.cache.set(cacheKey, result, { ttl: 3600 })
    
    return result
  }

  /**
   * Get hover information for a symbol
   */
  async getHover(params: HoverParams): Promise<HoverResult> {
    const cacheKey = `hover:${params.symbol}:${params.location?.uri || ''}`
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Combine information from multiple layers
    const astInfo = await this.layers.ast.getHover(params)
    const semanticInfo = await this.layers.semantic.getHover(params)
    const patternInfo = await this.layers.patterns.getRelatedPatterns(params.symbol)
    
    const result: HoverResult = {
      content: {
        kind: 'markdown',
        value: this.formatHoverContent(astInfo, semanticInfo, patternInfo)
      },
      range: params.location ? this.getSymbolRange(params.location) : undefined
    }
    
    // Cache briefly (hover is context-sensitive)
    await this.cache.set(cacheKey, result, { ttl: 300 })
    
    return result
  }

  /**
   * Get code completions
   */
  async getCompletions(params: CompletionParams): Promise<CompletionResult> {
    // Don't cache completions - they're too context-sensitive
    
    // Get completions from multiple sources
    const searchCompletions = await this.layers.search.getCompletions(params)
    const astCompletions = await this.layers.ast.getCompletions(params)
    const patternCompletions = await this.layers.patterns.getSuggestedCompletions(params)
    
    // Merge and rank completions
    const merged = this.mergeCompletions(
      searchCompletions,
      astCompletions,
      patternCompletions
    )
    
    // Learn from completion selection (if user selects one)
    if (params.selectedCompletion) {
      await this.layers.patterns.recordCompletionChoice(params, params.selectedCompletion)
    }
    
    return {
      items: merged,
      isIncomplete: false
    }
  }

  /**
   * Get rename edits for a symbol
   */
  async getRenameEdits(params: RenameParams): Promise<RenameResult> {
    // Find all references first
    const references = await this.findReferences({
      symbol: params.symbol,
      location: params.location,
      context: params.context,
      includeDeclaration: true
    })
    
    // Convert references to edits
    const edits = references.references.map(ref => ({
      uri: ref.location.uri,
      edits: [{
        range: this.getSymbolRange(ref.location),
        newText: params.newName
      }]
    }))
    
    // Check for cascading changes (knowledge propagation)
    const cascading = await this.layers.knowledge.getCascadingChanges(params)
    edits.push(...cascading)
    
    return {
      edits,
      affectedFiles: [...new Set(edits.map(e => e.uri))],
      preview: this.generateRenamePreview(edits)
    }
  }

  /**
   * Get diagnostics for a file or workspace
   */
  async getDiagnostics(params: DiagnosticParams): Promise<DiagnosticResult> {
    const cacheKey = `diag:${params.uri || 'workspace'}`
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Collect diagnostics from all layers
    const syntaxDiagnostics = await this.layers.ast.getDiagnostics(params)
    const semanticDiagnostics = await this.layers.semantic.getDiagnostics(params)
    const patternDiagnostics = await this.layers.patterns.getDiagnostics(params)
    
    const result = {
      diagnostics: [
        ...syntaxDiagnostics,
        ...semanticDiagnostics,
        ...patternDiagnostics
      ].sort((a, b) => a.severity - b.severity)
    }
    
    // Cache diagnostics briefly
    await this.cache.set(cacheKey, result, { ttl: 60 })
    
    return result
  }

  /**
   * Learn a new pattern from user actions
   */
  async learnPattern(params: PatternParams): Promise<void> {
    // Record the pattern
    await this.layers.patterns.learn(params)
    
    // Propagate learning through knowledge graph
    await this.layers.knowledge.propagate(params)
    
    // Update confidence scores
    await this.layers.patterns.updateConfidence(params)
    
    // Store in database
    await this.db.savePattern(params)
  }

  /**
   * Provide feedback on an operation
   */
  async provideFeedback(params: FeedbackParams): Promise<void> {
    // Update pattern confidence based on feedback
    await this.layers.patterns.processFeedback(params)
    
    // Store feedback for analysis
    await this.db.saveFeedback(params)
    
    // Adjust layer weights if needed
    if (params.rating === 'negative') {
      await this.adjustLayerWeights(params.operationId)
    }
  }

  /**
   * Get concepts from the knowledge graph
   */
  async getConcepts(params: ConceptParams): Promise<ConceptResult> {
    const concepts = await this.layers.semantic.getConcepts(params)
    const enriched = await this.layers.knowledge.enrichConcepts(concepts)
    
    return {
      concepts: enriched,
      total: enriched.length,
      confidence: this.calculateAverageConfidence(enriched)
    }
  }

  /**
   * Get relationships between concepts
   */
  async getRelationships(params: RelationshipParams): Promise<RelationshipResult> {
    const relationships = await this.layers.semantic.getRelationships(params)
    const enriched = await this.layers.knowledge.enrichRelationships(relationships)
    
    return {
      relationships: enriched,
      total: enriched.length
    }
  }

  // Helper methods
  private formatHoverContent(ast: any, semantic: any, patterns: any): string {
    let content = ''
    
    if (ast?.documentation) {
      content += ast.documentation + '\n\n'
    }
    
    if (semantic?.type) {
      content += `**Type:** ${semantic.type}\n`
    }
    
    if (semantic?.signature) {
      content += `\`\`\`typescript\n${semantic.signature}\n\`\`\`\n`
    }
    
    if (patterns?.length > 0) {
      content += '\n**Related Patterns:**\n'
      patterns.slice(0, 3).forEach((p: any) => {
        content += `- ${p.name} (${Math.round(p.confidence * 100)}% confidence)\n`
      })
    }
    
    return content || 'No information available'
  }

  private getSymbolRange(location: any): any {
    // Implementation would calculate actual symbol range
    return {
      start: location,
      end: location
    }
  }

  private mergeCompletions(...completionSets: any[]): any[] {
    const merged = new Map()
    
    for (const set of completionSets) {
      for (const item of set) {
        const existing = merged.get(item.label)
        if (!existing || item.score > existing.score) {
          merged.set(item.label, item)
        }
      }
    }
    
    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 100) // Limit to 100 completions
  }

  private generateRenamePreview(edits: any[]): string {
    const fileCount = new Set(edits.map(e => e.uri)).size
    const editCount = edits.reduce((sum, e) => sum + e.edits.length, 0)
    return `Renaming ${editCount} occurrences across ${fileCount} files`
  }

  private calculateAverageConfidence(items: any[]): number {
    if (items.length === 0) return 0
    const sum = items.reduce((acc, item) => acc + (item.confidence || 0), 0)
    return sum / items.length
  }

  private async adjustLayerWeights(operationId: string): Promise<void> {
    // Analyze which layer contributed to the poor result
    const analysis = await this.db.getOperationAnalysis(operationId)
    
    // Adjust weights for future operations
    if (analysis.primaryLayer) {
      await this.layers.adjustWeight(analysis.primaryLayer, -0.1)
    }
  }
}