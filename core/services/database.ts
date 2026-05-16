/**
 * Unified Database Service
 * Manages persistent storage for patterns, concepts, and feedback
 */

import { Database } from 'bun:sqlite'
import { 
  Pattern, 
  PatternParams, 
  FeedbackParams,
  Concept,
  Relationship
} from '../types/api.js'

export class DatabaseService {
  private db: Database
  
  constructor(dbPath: string = '.ontology/ontology.db') {
    this.db = new Database(dbPath, { create: true })
    this.initializeSchema()
  }
  
  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Concepts table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS concepts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        metadata TEXT,
        confidence REAL DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Relationships table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_id) REFERENCES concepts(id),
        FOREIGN KEY (target_id) REFERENCES concepts(id),
        UNIQUE(source_id, target_id, type)
      )
    `)
    
    // Patterns table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        template TEXT NOT NULL,
        examples TEXT,
        confidence REAL DEFAULT 0.5,
        usage_count INTEGER DEFAULT 0,
        last_used DATETIME,
        tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Feedback table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL,
        rating TEXT NOT NULL,
        comment TEXT,
        suggestion TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Operation history table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        params TEXT,
        result TEXT,
        layers_used TEXT,
        duration_ms INTEGER,
        success BOOLEAN,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_concepts_name ON concepts(name)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_concepts_type ON concepts(type)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_feedback_operation ON feedback(operation_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_operations_type ON operations(type)`)
  }
  
  /**
   * Save a pattern to the database
   */
  async savePattern(params: PatternParams): Promise<void> {
    const pattern: Pattern = {
      id: this.generateId('pattern'),
      name: this.extractPatternName(params.code),
      description: '',
      template: params.code,
      examples: [],
      confidence: 0.5,
      usageCount: 0,
      lastUsed: new Date(),
      tags: []
    }
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO patterns 
      (id, name, description, template, examples, confidence, usage_count, last_used, tags, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    
    stmt.run(
      pattern.id,
      pattern.name,
      pattern.description,
      pattern.template,
      JSON.stringify(pattern.examples),
      pattern.confidence,
      pattern.usageCount,
      pattern.lastUsed.toISOString(),
      JSON.stringify(pattern.tags)
    )
  }
  
  /**
   * Get pattern by ID
   */
  async getPattern(id: string): Promise<Pattern | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM patterns WHERE id = ?
    `)
    
    const row = stmt.get(id) as any
    if (!row) return null
    
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      template: row.template,
      examples: JSON.parse(row.examples || '[]'),
      confidence: row.confidence,
      usageCount: row.usage_count,
      lastUsed: new Date(row.last_used),
      tags: JSON.parse(row.tags || '[]')
    }
  }
  
  /**
   * Get all patterns above confidence threshold
   */
  async getPatterns(minConfidence: number = 0.5): Promise<Pattern[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM patterns 
      WHERE confidence >= ? 
      ORDER BY confidence DESC, usage_count DESC
    `)
    
    const rows = stmt.all(minConfidence) as any[]
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      template: row.template,
      examples: JSON.parse(row.examples || '[]'),
      confidence: row.confidence,
      usageCount: row.usage_count,
      lastUsed: new Date(row.last_used),
      tags: JSON.parse(row.tags || '[]')
    }))
  }
  
  /**
   * Save feedback
   */
  async saveFeedback(params: FeedbackParams): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO feedback 
      (operation_id, rating, comment, suggestion, metadata)
      VALUES (?, ?, ?, ?, ?)
    `)
    
    stmt.run(
      params.operationId,
      params.rating,
      params.comment || null,
      params.suggestion || null,
      JSON.stringify({ timestamp: Date.now() })
    )
  }
  
  /**
   * Save operation for analysis
   */
  async saveOperation(
    id: string,
    type: string,
    params: any,
    result: any,
    layersUsed: string[],
    durationMs: number,
    success: boolean
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO operations 
      (id, type, params, result, layers_used, duration_ms, success)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(
      id,
      type,
      JSON.stringify(params),
      JSON.stringify(result),
      JSON.stringify(layersUsed),
      durationMs,
      success ? 1 : 0
    )
  }
  
  /**
   * Get operation analysis for feedback adjustment
   */
  async getOperationAnalysis(operationId: string): Promise<{
    primaryLayer?: string
    duration: number
    success: boolean
  }> {
    const stmt = this.db.prepare(`
      SELECT layers_used, duration_ms, success 
      FROM operations 
      WHERE id = ?
    `)
    
    const row = stmt.get(operationId) as any
    if (!row) {
      return { duration: 0, success: false }
    }
    
    const layers = JSON.parse(row.layers_used || '[]')
    return {
      primaryLayer: layers[0],
      duration: row.duration_ms,
      success: row.success === 1
    }
  }
  
  /**
   * Save concept
   */
  async saveConcept(concept: Concept): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO concepts 
      (id, name, type, description, metadata, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    
    stmt.run(
      concept.id,
      concept.name,
      concept.type,
      concept.description || null,
      JSON.stringify(concept.metadata || {}),
      concept.confidence
    )
  }
  
  /**
   * Get concept by ID
   */
  async getConcept(id: string): Promise<Concept | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM concepts WHERE id = ?
    `)
    
    const row = stmt.get(id) as any
    if (!row) return null
    
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      metadata: JSON.parse(row.metadata || '{}'),
      confidence: row.confidence
    }
  }
  
  /**
   * Search concepts
   */
  async searchConcepts(query: string, type?: string): Promise<Concept[]> {
    let sql = `
      SELECT * FROM concepts 
      WHERE name LIKE ? 
    `
    const params: any[] = [`%${query}%`]
    
    if (type) {
      sql += ` AND type = ?`
      params.push(type)
    }
    
    sql += ` ORDER BY confidence DESC LIMIT 100`
    
    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as any[]
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      metadata: JSON.parse(row.metadata || '{}'),
      confidence: row.confidence
    }))
  }
  
  /**
   * Save relationship
   */
  async saveRelationship(relationship: Relationship): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO relationships 
      (source_id, target_id, type, confidence, metadata)
      VALUES (?, ?, ?, ?, ?)
    `)
    
    stmt.run(
      relationship.source,
      relationship.target,
      relationship.type,
      relationship.confidence,
      JSON.stringify(relationship.metadata || {})
    )
  }
  
  /**
   * Get relationships for a concept
   */
  async getRelationships(conceptId: string): Promise<Relationship[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM relationships 
      WHERE source_id = ? OR target_id = ?
      ORDER BY confidence DESC
    `)
    
    const rows = stmt.all(conceptId, conceptId) as any[]
    
    return rows.map(row => ({
      source: row.source_id,
      target: row.target_id,
      type: row.type,
      confidence: row.confidence,
      metadata: JSON.parse(row.metadata || '{}')
    }))
  }
  
  /**
   * Update pattern confidence
   */
  async updatePatternConfidence(id: string, confidence: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE patterns 
      SET confidence = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `)
    
    stmt.run(confidence, id)
  }
  
  /**
   * Increment pattern usage
   */
  async incrementPatternUsage(id: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE patterns 
      SET usage_count = usage_count + 1, 
          last_used = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `)
    
    stmt.run(id)
  }
  
  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    concepts: number
    relationships: number
    patterns: number
    feedback: number
    operations: number
  }> {
    return {
      concepts: (this.db.prepare('SELECT COUNT(*) as count FROM concepts').get() as any).count,
      relationships: (this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as any).count,
      patterns: (this.db.prepare('SELECT COUNT(*) as count FROM patterns').get() as any).count,
      feedback: (this.db.prepare('SELECT COUNT(*) as count FROM feedback').get() as any).count,
      operations: (this.db.prepare('SELECT COUNT(*) as count FROM operations').get() as any).count
    }
  }
  
  /**
   * Close database connection
   */
  close(): void {
    this.db.close()
  }
  
  // Helper methods
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  private extractPatternName(code: string): string {
    // Try to extract a meaningful name from the code
    const lines = code.split('\n')
    const firstNonEmpty = lines.find(l => l.trim().length > 0)
    if (firstNonEmpty) {
      return firstNonEmpty.trim().slice(0, 50)
    }
    return 'Unnamed Pattern'
  }
}