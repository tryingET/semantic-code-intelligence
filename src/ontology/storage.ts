// Semantic Graph Storage - SQLite persistence for Thing / Concept / Symbol (Ullmann triangle)
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import type { Concept, Relation, Symbol, Thing, ThingConceptLink, ThingSymbolLink } from '../types/core';
import { isValidLocation, normalizeUri, sanitizeRange } from './location-utils';
import type { StoragePort } from './storage-port';

interface ConceptRow {
    id: string;
    canonical_name: string;
    semantic_type: string | null;
    confidence: number;
    signature_json: string | null;
    metadata_json: string | null;
    created_at: number;
    updated_at: number;
}

interface SymbolRow {
    id: string;
    text: string;
    language: string | null;
    confidence: number;
    created_at: number;
    updated_at: number;
}

interface ThingRow {
    id: string;
    kind: string;
    location_uri: string;
    location_range: string;
    signature: string | null;
    type_info_json: string | null;
    confidence: number;
    first_seen: number;
    last_seen: number;
    occurrences: number;
    context: string | null;
    created_at: number;
    updated_at: number;
}

interface ThingSymbolRow {
    thing_id: string;
    symbol_id: string;
    role: string;
}

interface ThingConceptRow {
    thing_id: string;
    concept_id: string;
    confidence: number;
    evidence_json: string | null;
}

interface ConceptRelationRow {
    id: string;
    from_concept_id: string;
    to_concept_id: string;
    relation_type: string;
    confidence: number;
    evidence_json: string | null;
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

// SQLite-backed implementation of StoragePort
export class SemanticGraphStorage implements StoragePort {
    private db: Database;
    private schemaInitialized = false;

    constructor(private dbPath: string) {
        // Ensure directory exists (skip for :memory:)
        if (dbPath !== ':memory:') {
            const dir = path.dirname(dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        this.db = new Database(dbPath);
        this.db.exec('PRAGMA journal_mode = WAL');

        const autoMigrate = (process.env.L4_AUTO_MIGRATE ?? '1') !== '0';
        if (autoMigrate) {
            this.ensureSchema();
        }
    }

    ensureSchema(): void {
        if (this.schemaInitialized) return;
        try {
            this.createTables();
            this.createIndices();
            this.schemaInitialized = true;
        } catch (e) {
            // Keep stdout clean for protocol servers; warnings go to stderr.
            console.warn('[L4] Failed to ensure semantic graph schema:', e);
        }
    }

    async initialize(): Promise<void> {
        this.ensureSchema();
    }

    async close(): Promise<void> {
        try {
            this.db.close();
        } catch {}
    }

    private createTables(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS concepts (
        id TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        semantic_type TEXT,
        confidence REAL NOT NULL DEFAULT 0.0,
        signature_json TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS concept_relations (
        id TEXT PRIMARY KEY,
        from_concept_id TEXT NOT NULL,
        to_concept_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        evidence_json TEXT,
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

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        language TEXT,
        confidence REAL NOT NULL DEFAULT 0.0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE(text, language)
      );

      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        location_uri TEXT NOT NULL,
        location_range TEXT NOT NULL,
        signature TEXT,
        type_info_json TEXT,
        confidence REAL NOT NULL DEFAULT 0.0,
        first_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        occurrences INTEGER NOT NULL DEFAULT 1,
        context TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS thing_symbols (
        thing_id TEXT NOT NULL,
        symbol_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'unknown',
        PRIMARY KEY (thing_id, symbol_id, role),
        FOREIGN KEY (thing_id) REFERENCES things(id) ON DELETE CASCADE,
        FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thing_concepts (
        thing_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        evidence_json TEXT,
        PRIMARY KEY (thing_id, concept_id),
        FOREIGN KEY (thing_id) REFERENCES things(id) ON DELETE CASCADE,
        FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
      );
    `);
    }

    private createIndices(): void {
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_concepts_canonical_name ON concepts(canonical_name);
      CREATE INDEX IF NOT EXISTS idx_concepts_updated_at ON concepts(updated_at);

      CREATE INDEX IF NOT EXISTS idx_concept_relations_from ON concept_relations(from_concept_id);
      CREATE INDEX IF NOT EXISTS idx_concept_relations_to ON concept_relations(to_concept_id);
      CREATE INDEX IF NOT EXISTS idx_concept_relations_type ON concept_relations(relation_type);

      CREATE INDEX IF NOT EXISTS idx_evolution_concept_id ON evolution_history(concept_id);
      CREATE INDEX IF NOT EXISTS idx_evolution_timestamp ON evolution_history(timestamp);

      CREATE INDEX IF NOT EXISTS idx_symbols_text ON symbols(text);

      CREATE INDEX IF NOT EXISTS idx_things_location_uri ON things(location_uri);
      CREATE INDEX IF NOT EXISTS idx_things_kind ON things(kind);

      CREATE INDEX IF NOT EXISTS idx_thing_symbols_symbol_id ON thing_symbols(symbol_id);
      CREATE INDEX IF NOT EXISTS idx_thing_concepts_concept_id ON thing_concepts(concept_id);
    `);
    }

    async upsertConcept(concept: Concept): Promise<void> {
        const tx = this.db.transaction(() => {
            const conceptStmt = this.db.prepare(`
        INSERT OR REPLACE INTO concepts (id, canonical_name, semantic_type, confidence, signature_json, metadata_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      `);

            conceptStmt.run(
                concept.id,
                concept.canonicalName,
                concept.type ?? null,
                concept.confidence ?? 0,
                JSON.stringify(concept.signature ?? null),
                JSON.stringify(concept.metadata ?? null)
            );

            // Relations (concept ↔ concept)
            const clearRelationsStmt = this.db.prepare(`DELETE FROM concept_relations WHERE from_concept_id = ?`);
            clearRelationsStmt.run(concept.id);

            const relationStmt = this.db.prepare(`
        INSERT OR REPLACE INTO concept_relations
          (id, from_concept_id, to_concept_id, relation_type, confidence, evidence_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

            for (const [, relation] of concept.relations) {
                relationStmt.run(
                    relation.id,
                    concept.id,
                    relation.targetConceptId,
                    relation.type,
                    relation.confidence ?? 0.5,
                    JSON.stringify(relation.evidence ?? []),
                    relation.createdAt?.toISOString?.() ?? new Date().toISOString()
                );
            }

            // Evolution history
            const clearEvolutionStmt = this.db.prepare(`DELETE FROM evolution_history WHERE concept_id = ?`);
            clearEvolutionStmt.run(concept.id);

            const evolutionStmt = this.db.prepare(`
        INSERT INTO evolution_history
          (concept_id, timestamp, change_type, from_state, to_state, reason, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

            const evolution = Array.isArray(concept.evolution) ? concept.evolution : [];
            for (const ev of evolution) {
                evolutionStmt.run(
                    concept.id,
                    (ev.timestamp instanceof Date ? ev.timestamp : new Date(ev.timestamp)).toISOString(),
                    ev.type,
                    ev.from,
                    ev.to,
                    ev.reason || null,
                    ev.confidence ?? 0.5
                );
            }
        });

        tx();
    }

    async deleteConcept(conceptId: string): Promise<void> {
        const tx = this.db.transaction(() => {
            this.db.prepare(`DELETE FROM concepts WHERE id = ?`).run(conceptId);
        });
        tx();
    }

    async loadConcept(conceptId: string): Promise<Concept | null> {
        const row = this.db.prepare(`SELECT * FROM concepts WHERE id = ?`).get(conceptId) as ConceptRow | undefined;
        if (!row) return null;
        const concepts = await this.deserializeConceptRows([row]);
        return concepts[0] ?? null;
    }

    async loadAllConcepts(): Promise<Concept[]> {
        const rows = this.db
            .prepare(`SELECT * FROM concepts ORDER BY updated_at DESC`)
            .all() as unknown as ConceptRow[];
        return this.deserializeConceptRows(rows);
    }

    async upsertSymbol(symbol: Symbol): Promise<void> {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols (id, text, language, confidence, updated_at)
      VALUES (?, ?, ?, ?, strftime('%s', 'now'))
    `);
        stmt.run(symbol.id, symbol.text, symbol.language ?? null, symbol.confidence ?? 0);
    }

    async loadAllSymbols(): Promise<Symbol[]> {
        const rows = this.db.prepare(`SELECT * FROM symbols`).all() as unknown as SymbolRow[];
        return rows.map((r) => ({
            id: r.id,
            text: r.text,
            language: r.language ?? undefined,
            confidence: r.confidence ?? 0,
        }));
    }

    async upsertThing(thing: Thing): Promise<void> {
        const loc = thing.location
            ? { uri: normalizeUri((thing.location as any).uri), range: sanitizeRange((thing.location as any).range) }
            : null;
        if (!loc?.uri || !loc.range || !isValidLocation(loc)) {
            // Skip malformed things; callers should validate before persisting.
            return;
        }

        const firstSeenSec = thing.firstSeen instanceof Date ? Math.floor(thing.firstSeen.getTime() / 1000) : undefined;
        const lastSeenSec = thing.lastSeen instanceof Date ? Math.floor(thing.lastSeen.getTime() / 1000) : undefined;
        const occurrences = typeof thing.occurrences === 'number' ? Math.max(1, thing.occurrences) : 1;

        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO things
        (id, kind, location_uri, location_range, signature, type_info_json, confidence, first_seen, last_seen, occurrences, context, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);

        stmt.run(
            thing.id,
            thing.kind,
            loc.uri,
            JSON.stringify(loc.range),
            thing.signature ?? null,
            JSON.stringify((thing as any).typeInfo ?? null),
            thing.confidence ?? 0,
            firstSeenSec ?? Math.floor(Date.now() / 1000),
            lastSeenSec ?? Math.floor(Date.now() / 1000),
            occurrences,
            thing.context ?? null
        );
    }

    async loadAllThings(): Promise<Thing[]> {
        const rows = this.db.prepare(`SELECT * FROM things`).all() as unknown as ThingRow[];
        const things: Thing[] = [];
        for (const r of rows) {
            let range: any = null;
            try {
                range = JSON.parse(r.location_range);
            } catch {
                range = null;
            }
            const loc = { uri: r.location_uri, range } as any;
            if (!isValidLocation(loc)) continue;

            things.push({
                id: r.id,
                kind: r.kind as any,
                location: loc,
                signature: r.signature ?? undefined,
                typeInfo: r.type_info_json ? JSON.parse(r.type_info_json) : undefined,
                confidence: r.confidence ?? 0,
                firstSeen: new Date((r.first_seen ?? 0) * 1000),
                lastSeen: new Date((r.last_seen ?? 0) * 1000),
                occurrences: r.occurrences ?? 1,
                context: r.context ?? undefined,
            });
        }
        return things;
    }

    async upsertThingSymbol(link: ThingSymbolLink): Promise<void> {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO thing_symbols (thing_id, symbol_id, role)
      VALUES (?, ?, ?)
    `);
        stmt.run(link.thingId, link.symbolId, link.role ?? 'unknown');
    }

    async upsertThingConcept(link: ThingConceptLink): Promise<void> {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO thing_concepts (thing_id, concept_id, confidence, evidence_json)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(link.thingId, link.conceptId, link.confidence ?? 0.5, JSON.stringify(link.evidence ?? []));
    }

    async loadAllThingSymbols(): Promise<ThingSymbolLink[]> {
        const rows = this.db.prepare(`SELECT * FROM thing_symbols`).all() as unknown as ThingSymbolRow[];
        return rows.map((r) => ({
            thingId: r.thing_id,
            symbolId: r.symbol_id,
            role: (r.role as any) ?? 'unknown',
        }));
    }

    async loadAllThingConcepts(): Promise<ThingConceptLink[]> {
        const rows = this.db.prepare(`SELECT * FROM thing_concepts`).all() as unknown as ThingConceptRow[];
        return rows.map((r) => ({
            thingId: r.thing_id,
            conceptId: r.concept_id,
            confidence: r.confidence ?? 0.5,
            evidence: r.evidence_json ? JSON.parse(r.evidence_json) : undefined,
        }));
    }

    async findConceptsByName(name: string): Promise<Concept[]> {
        const rows = this.db
            .prepare(`SELECT * FROM concepts WHERE canonical_name LIKE ? ORDER BY updated_at DESC`)
            .all(`%${name}%`) as unknown as ConceptRow[];
        return this.deserializeConceptRows(rows);
    }

    async getConceptStatistics(): Promise<{
        totalConcepts: number;
        totalSymbols: number;
        totalThings: number;
        totalConceptRelations: number;
    }> {
        const totalConcepts = (this.db.prepare(`SELECT COUNT(*) as c FROM concepts`).get() as any)?.c ?? 0;
        const totalSymbols = (this.db.prepare(`SELECT COUNT(*) as c FROM symbols`).get() as any)?.c ?? 0;
        const totalThings = (this.db.prepare(`SELECT COUNT(*) as c FROM things`).get() as any)?.c ?? 0;
        const totalConceptRelations =
            (this.db.prepare(`SELECT COUNT(*) as c FROM concept_relations`).get() as any)?.c ?? 0;
        return { totalConcepts, totalSymbols, totalThings, totalConceptRelations };
    }

    async vacuum(): Promise<void> {
        this.db.exec('VACUUM');
    }

    async analyze(): Promise<void> {
        this.db.exec('ANALYZE');
    }

    async backup(backupPath: string): Promise<void> {
        if (this.dbPath === ':memory:') {
            throw new Error('BACKUP_NOT_SUPPORTED_FOR_MEMORY_DB');
        }
        fs.copyFileSync(this.dbPath, backupPath);
    }

    private async deserializeConceptRows(rows: ConceptRow[]): Promise<Concept[]> {
        if (rows.length === 0) return [];

        const relationRows = this.db
            .prepare(`SELECT * FROM concept_relations WHERE from_concept_id IN (${rows.map(() => '?').join(',')})`)
            .all(...rows.map((r) => r.id)) as unknown as ConceptRelationRow[];

        const evolutionRows = this.db
            .prepare(`SELECT * FROM evolution_history WHERE concept_id IN (${rows.map(() => '?').join(',')})`)
            .all(...rows.map((r) => r.id)) as unknown as EvolutionRow[];

        const relationsByConcept = new Map<string, Map<string, Relation>>();
        for (const rr of relationRows) {
            const rel: Relation = {
                id: rr.id,
                targetConceptId: rr.to_concept_id,
                type: rr.relation_type as any,
                confidence: rr.confidence ?? 0.5,
                evidence: rr.evidence_json ? JSON.parse(rr.evidence_json) : [],
                createdAt: new Date(rr.created_at),
            };
            if (!relationsByConcept.has(rr.from_concept_id)) relationsByConcept.set(rr.from_concept_id, new Map());
            relationsByConcept.get(rr.from_concept_id)!.set(rr.to_concept_id, rel);
        }

        const evolutionByConcept = new Map<string, any[]>();
        for (const ev of evolutionRows) {
            if (!evolutionByConcept.has(ev.concept_id)) evolutionByConcept.set(ev.concept_id, []);
            evolutionByConcept.get(ev.concept_id)!.push({
                timestamp: new Date(ev.timestamp),
                type: ev.change_type as any,
                from: ev.from_state,
                to: ev.to_state,
                reason: ev.reason || '',
                confidence: ev.confidence ?? 0.5,
            });
        }

        return rows.map((r) => ({
            id: r.id,
            canonicalName: r.canonical_name,
            type: r.semantic_type ?? undefined,
            relations: relationsByConcept.get(r.id) ?? new Map(),
            signature: r.signature_json ? JSON.parse(r.signature_json) : { parameters: [], sideEffects: [], complexity: 0, fingerprint: '' },
            evolution: evolutionByConcept.get(r.id) ?? [],
            metadata: r.metadata_json ? JSON.parse(r.metadata_json) : { tags: [] },
            confidence: r.confidence ?? 0,
        }));
    }
}

// Back-compat alias inside the codebase: many call sites still import OntologyStorage.
export { SemanticGraphStorage as OntologyStorage };
