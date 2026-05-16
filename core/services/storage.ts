// Ontology Storage - SQLite-based persistence for concepts and relations
import { Database } from 'bun:sqlite';
import { Concept, Relation } from '../types/core';
import * as path from 'path';
import * as fs from 'fs';

// Database row type interfaces
interface ConceptRow {
    id: string;
    canonical_name: string;
    confidence: number;
    data: string;
    created_at: string;
    updated_at: string;
}

interface RepresentationRow {
    id: number;
    concept_id: string;
    name: string;
    location_uri: string;
    location_range: string;
    first_seen: string;
    last_seen: string;
    occurrences: number;
    context: string | null;
}

interface RelationRow {
    id: string;
    from_concept_id: string;
    to_concept_id: string;
    relation_type: string;
    confidence: number;
    evidence: string | null;
    created_at: string;
}

interface EvolutionRow {
    id: number;
    concept_id: string;
    timestamp: string;
    change_type: string;
    from_state: string;
    to_state: string;
    reason: string | null;
    confidence: number;
}

interface MetadataRow {
    concept_id: string;
    category: string | null;
    tags: string | null;
    is_interface: boolean;
    is_abstract: boolean;
    is_deprecated: boolean;
    documentation: string | null;
}

interface StatsRow {
    total_concepts: number;
    total_representations: number;
    total_relations: number;
}

export class OntologyStorage {
    private db: Database;
    
    constructor(private dbPath: string) {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        this.db = new Database(dbPath);
        this.db.exec('PRAGMA journal_mode = WAL');
    }
    
    async initialize(): Promise<void> {
        this.createTables();
        this.createIndices();
    }
    
    private createTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS concepts (
                id TEXT PRIMARY KEY,
                canonical_name TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                data JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS representations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                concept_id TEXT NOT NULL,
                name TEXT NOT NULL,
                location_uri TEXT NOT NULL,
                location_range JSON NOT NULL,
                first_seen TIMESTAMP NOT NULL,
                last_seen TIMESTAMP NOT NULL,
                occurrences INTEGER NOT NULL DEFAULT 1,
                context TEXT,
                FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS relations (
                id TEXT PRIMARY KEY,
                from_concept_id TEXT NOT NULL,
                to_concept_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                evidence JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
                FOREIGN KEY (to_concept_id) REFERENCES concepts(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS evolution_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                concept_id TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                change_type TEXT NOT NULL,
                from_state TEXT NOT NULL,
                to_state TEXT NOT NULL,
                reason TEXT,
                confidence REAL NOT NULL DEFAULT 0.5,
                FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS concept_metadata (
                concept_id TEXT PRIMARY KEY,
                category TEXT,
                tags JSON,
                is_interface BOOLEAN DEFAULT FALSE,
                is_abstract BOOLEAN DEFAULT FALSE,
                is_deprecated BOOLEAN DEFAULT FALSE,
                documentation TEXT,
                FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
            );
        `);
    }
    
    private createIndices(): void {
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_concepts_canonical_name 
                ON concepts(canonical_name);
            
            CREATE INDEX IF NOT EXISTS idx_representations_name 
                ON representations(name);
            CREATE INDEX IF NOT EXISTS idx_representations_concept_id 
                ON representations(concept_id);
            
            CREATE INDEX IF NOT EXISTS idx_relations_from 
                ON relations(from_concept_id);
            CREATE INDEX IF NOT EXISTS idx_relations_to 
                ON relations(to_concept_id);
            CREATE INDEX IF NOT EXISTS idx_relations_type 
                ON relations(relation_type);
            
            CREATE INDEX IF NOT EXISTS idx_evolution_concept_id 
                ON evolution_history(concept_id);
            CREATE INDEX IF NOT EXISTS idx_evolution_timestamp 
                ON evolution_history(timestamp);
        `);
    }
    
    async saveConcept(concept: Concept): Promise<void> {
        const transaction = this.db.transaction(() => {
            // Save main concept
            const conceptStmt = this.db.prepare(`
                INSERT OR REPLACE INTO concepts (id, canonical_name, confidence, data, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            conceptStmt.run(
                concept.id,
                concept.canonicalName,
                concept.confidence,
                JSON.stringify(this.serializeConcept(concept))
            );
            
            // Clear existing representations
            const clearRepsStmt = this.db.prepare(`
                DELETE FROM representations WHERE concept_id = ?
            `);
            clearRepsStmt.run(concept.id);
            
            // Save representations
            const repStmt = this.db.prepare(`
                INSERT INTO representations 
                (concept_id, name, location_uri, location_range, first_seen, last_seen, occurrences, context)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            for (const [name, rep] of concept.representations) {
                repStmt.run(
                    concept.id,
                    name,
                    rep.location.uri,
                    JSON.stringify(rep.location.range),
                    rep.firstSeen.toISOString(),
                    rep.lastSeen.toISOString(),
                    rep.occurrences,
                    rep.context || null
                );
            }
            
            // Save relations
            const clearRelationsStmt = this.db.prepare(`
                DELETE FROM relations WHERE from_concept_id = ?
            `);
            clearRelationsStmt.run(concept.id);
            
            const relationStmt = this.db.prepare(`
                INSERT OR REPLACE INTO relations 
                (id, from_concept_id, to_concept_id, relation_type, confidence, evidence, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            for (const [_, relation] of concept.relations) {
                relationStmt.run(
                    relation.id,
                    concept.id,
                    relation.targetConceptId,
                    relation.type,
                    relation.confidence,
                    JSON.stringify(relation.evidence),
                    relation.createdAt.toISOString()
                );
            }
            
            // Save evolution history
            const clearEvolutionStmt = this.db.prepare(`
                DELETE FROM evolution_history WHERE concept_id = ?
            `);
            clearEvolutionStmt.run(concept.id);
            
            const evolutionStmt = this.db.prepare(`
                INSERT INTO evolution_history 
                (concept_id, timestamp, change_type, from_state, to_state, reason, confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            for (const evolution of concept.evolution) {
                evolutionStmt.run(
                    concept.id,
                    evolution.timestamp.toISOString(),
                    evolution.type,
                    evolution.from,
                    evolution.to,
                    evolution.reason,
                    evolution.confidence
                );
            }
            
            // Save metadata
            const metadataStmt = this.db.prepare(`
                INSERT OR REPLACE INTO concept_metadata 
                (concept_id, category, tags, is_interface, is_abstract, is_deprecated, documentation)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            metadataStmt.run(
                concept.id,
                concept.metadata.category || null,
                JSON.stringify(concept.metadata.tags || []),
                concept.metadata.isInterface ? 1 : 0,
                concept.metadata.isAbstract ? 1 : 0,
                concept.metadata.isDeprecated ? 1 : 0,
                concept.metadata.documentation || null
            );
        });
        
        transaction();
    }
    
    async updateConcept(concept: Concept): Promise<void> {
        await this.saveConcept(concept); // Same as save for now
    }
    
    async loadConcept(conceptId: string): Promise<Concept | null> {
        const conceptRow = this.db.prepare(`
            SELECT * FROM concepts WHERE id = ?
        `).get(conceptId) as ConceptRow | undefined;
        
        if (!conceptRow) return null;
        
        return this.deserializeConcept(conceptRow);
    }
    
    async loadAllConcepts(): Promise<Concept[]> {
        const conceptRows = this.db.prepare(`
            SELECT * FROM concepts ORDER BY updated_at DESC
        `).all();
        
        const concepts: Concept[] = [];
        
        for (const row of conceptRows) {
            try {
                const concept = await this.deserializeConcept(row as ConceptRow);
                if (concept) {
                    concepts.push(concept);
                }
            } catch (error) {
                console.warn(`Failed to deserialize concept ${(row as ConceptRow).id}:`, error);
            }
        }
        
        return concepts;
    }
    
    async deleteConcept(conceptId: string): Promise<void> {
        const transaction = this.db.transaction(() => {
            // Relations and other dependent records will be deleted by CASCADE
            this.db.prepare(`DELETE FROM concepts WHERE id = ?`).run(conceptId);
        });
        
        transaction();
    }
    
    async findConceptsByName(name: string): Promise<Concept[]> {
        const conceptIds = this.db.prepare(`
            SELECT DISTINCT concept_id FROM representations WHERE name LIKE ?
        `).all(`%${name}%`).map(row => (row as { concept_id: string }).concept_id);
        
        const concepts: Concept[] = [];
        
        for (const id of conceptIds) {
            const concept = await this.loadConcept(id);
            if (concept) {
                concepts.push(concept);
            }
        }
        
        return concepts;
    }
    
    async getConceptStatistics(): Promise<{
        totalConcepts: number;
        totalRepresentations: number;
        totalRelations: number;
        averageRepresentationsPerConcept: number;
    }> {
        const stats = this.db.prepare(`
            SELECT 
                COUNT(*) as total_concepts,
                (SELECT COUNT(*) FROM representations) as total_representations,
                (SELECT COUNT(*) FROM relations) as total_relations
            FROM concepts
        `).get() as StatsRow;
        
        return {
            totalConcepts: stats.total_concepts,
            totalRepresentations: stats.total_representations,
            totalRelations: stats.total_relations,
            averageRepresentationsPerConcept: 
                stats.total_concepts > 0 ? stats.total_representations / stats.total_concepts : 0
        };
    }
    
    private async deserializeConcept(row: ConceptRow): Promise<Concept | null> {
        try {
            const data = JSON.parse(row.data);
            
            // Load representations
            const repRows = this.db.prepare(`
                SELECT * FROM representations WHERE concept_id = ?
            `).all(row.id);
            
            const representations = new Map();
            for (const repRow of repRows) {
                const row = repRow as RepresentationRow;
                representations.set(row.name, {
                    name: row.name,
                    location: {
                        uri: row.location_uri,
                        range: JSON.parse(row.location_range)
                    },
                    firstSeen: new Date(row.first_seen),
                    lastSeen: new Date(row.last_seen),
                    occurrences: row.occurrences,
                    context: row.context
                });
            }
            
            // Load relations
            const relationRows = this.db.prepare(`
                SELECT * FROM relations WHERE from_concept_id = ?
            `).all(row.id);
            
            const relations = new Map();
            for (const relRow of relationRows) {
                const row = relRow as RelationRow;
                relations.set(row.to_concept_id, {
                    id: row.id,
                    targetConceptId: row.to_concept_id,
                    type: row.relation_type,
                    confidence: row.confidence,
                    evidence: JSON.parse(row.evidence || '[]'),
                    createdAt: new Date(row.created_at)
                });
            }
            
            // Load evolution history
            const evolutionRows = this.db.prepare(`
                SELECT * FROM evolution_history WHERE concept_id = ? ORDER BY timestamp DESC
            `).all(row.id);
            
            const evolution = evolutionRows.map(evRow => {
                const row = evRow as EvolutionRow;
                return {
                    timestamp: new Date(row.timestamp),
                    type: row.change_type as 'rename' | 'signature' | 'relation' | 'canonical_rename' | 'move',
                    from: row.from_state,
                    to: row.to_state,
                    reason: row.reason || '',
                    confidence: row.confidence
                };
            });
            
            // Load metadata
            const metadataRow = this.db.prepare(`
                SELECT * FROM concept_metadata WHERE concept_id = ?
            `).get(row.id);
            
            const metadata = metadataRow ? {
                category: (metadataRow as MetadataRow).category || undefined,
                tags: JSON.parse((metadataRow as MetadataRow).tags || '[]'),
                isInterface: (metadataRow as MetadataRow).is_interface,
                isAbstract: (metadataRow as MetadataRow).is_abstract,
                isDeprecated: (metadataRow as MetadataRow).is_deprecated,
                documentation: (metadataRow as MetadataRow).documentation || undefined
            } : {
                tags: []
            };
            
            return {
                id: row.id,
                canonicalName: row.canonical_name,
                representations,
                relations,
                signature: data.signature || {
                    parameters: [],
                    sideEffects: [],
                    complexity: 0,
                    fingerprint: ''
                },
                evolution,
                metadata,
                confidence: row.confidence
            };
            
        } catch (error) {
            console.error(`Failed to deserialize concept ${row.id}:`, error);
            return null;
        }
    }
    
    private serializeConcept(concept: Concept): any {
        return {
            signature: concept.signature,
            // Other serializable data can be added here
        };
    }
    
    async close(): Promise<void> {
        this.db.close();
    }
    
    // Maintenance methods
    async vacuum(): Promise<void> {
        this.db.exec('VACUUM');
    }
    
    async analyze(): Promise<void> {
        this.db.exec('ANALYZE');
    }
    
    async backup(backupPath: string): Promise<void> {
        await this.db.backup(backupPath);
    }
}