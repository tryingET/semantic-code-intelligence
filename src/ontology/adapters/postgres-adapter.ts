import type { Concept, Relation, Symbol, Thing, ThingConceptLink, ThingSymbolLink } from '../../types/core';
import type { StoragePort } from '../storage-port';

// Postgres adapter implementing the Layer 4 StoragePort.
// Env: ONTOLOGY_PG_URL | DATABASE_URL | PG_URL | PGURL (postgres connection string)
export class PostgresStorageAdapter implements StoragePort {
    private client: any | null = null;
    private connected = false;
    private url: string | null;

    constructor() {
        this.url = process.env.ONTOLOGY_PG_URL || process.env.DATABASE_URL || process.env.PG_URL || process.env.PGURL || null;
    }

    private async getClient(): Promise<any> {
        if (!this.url) {
            throw new Error('PG_ADAPTER_NOT_CONFIGURED: Missing ONTOLOGY_PG_URL / DATABASE_URL / PG_URL / PGURL');
        }
        if (this.client) return this.client;
        const mod = await import('pg');
        const { Client } = mod as any;
        this.client = new Client({ connectionString: this.url });
        return this.client;
    }

    private ensureReady(): void {
        if (!this.connected || !this.client) {
            throw new Error('PG_ADAPTER_NOT_READY: Call initialize() with valid configuration');
        }
    }

    async initialize(): Promise<void> {
        if (!this.url) return; // allow initialize() in unconfigured envs
        const client = await this.getClient();
        await client.connect();
        this.connected = true;
        await this.createTables();
        await this.backfillDuplicateSymbols();
        await this.createIndices();
    }

    async close(): Promise<void> {
        if (!this.connected || !this.client) return;
        await this.client.end();
        this.connected = false;
        this.client = null;
    }

    private async createTables(): Promise<void> {
        this.ensureReady();
        const q = `
      CREATE TABLE IF NOT EXISTS concepts (
        id TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        semantic_type TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        signature_json JSONB,
        metadata_json JSONB,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint,
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint
      );

      CREATE TABLE IF NOT EXISTS concept_relations (
        id TEXT PRIMARY KEY,
        from_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        to_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        evidence_json JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS evolution_history (
        id SERIAL PRIMARY KEY,
        concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        timestamp TIMESTAMP NOT NULL,
        change_type TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason TEXT,
        confidence REAL NOT NULL DEFAULT 0.5
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        language TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint,
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint,
        UNIQUE(text, language)
      );

      CREATE TABLE IF NOT EXISTS symbol_aliases (
        alias_id TEXT PRIMARY KEY,
        canonical_id TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        location_uri TEXT NOT NULL,
        location_range JSONB NOT NULL,
        signature TEXT,
        type_info_json JSONB,
        confidence REAL NOT NULL DEFAULT 0,
        first_seen BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint,
        last_seen BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint,
        occurrences INT NOT NULL DEFAULT 1,
        context TEXT,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint,
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint
      );

      CREATE TABLE IF NOT EXISTS thing_symbols (
        thing_id TEXT NOT NULL REFERENCES things(id) ON DELETE CASCADE,
        symbol_id TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'unknown',
        PRIMARY KEY (thing_id, symbol_id, role)
      );

      CREATE TABLE IF NOT EXISTS thing_concepts (
        thing_id TEXT NOT NULL REFERENCES things(id) ON DELETE CASCADE,
        concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        confidence REAL NOT NULL DEFAULT 0.5,
        evidence_json JSONB,
        PRIMARY KEY (thing_id, concept_id)
      );
    `;
        await this.client.query(q);
    }

    private async createIndices(): Promise<void> {
        this.ensureReady();
        const q = `
      CREATE INDEX IF NOT EXISTS idx_concepts_canonical_name ON concepts(canonical_name);
      CREATE INDEX IF NOT EXISTS idx_concept_relations_from ON concept_relations(from_concept_id);
      CREATE INDEX IF NOT EXISTS idx_concept_relations_to ON concept_relations(to_concept_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_text ON symbols(text);
      CREATE INDEX IF NOT EXISTS idx_symbol_aliases_canonical_id ON symbol_aliases(canonical_id);
      CREATE INDEX IF NOT EXISTS idx_things_location_uri ON things(location_uri);
      CREATE INDEX IF NOT EXISTS idx_thing_concepts_concept_id ON thing_concepts(concept_id);
    `;
        await this.client.query(q);
    }

    async upsertConcept(concept: Concept): Promise<void> {
        this.ensureReady();
        const c = this.client;
        await c.query('BEGIN');
        try {
            await c.query(
                `INSERT INTO concepts (id, canonical_name, semantic_type, confidence, signature_json, metadata_json, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,EXTRACT(EPOCH FROM NOW())::bigint)
         ON CONFLICT (id) DO UPDATE SET canonical_name = EXCLUDED.canonical_name,
           semantic_type = EXCLUDED.semantic_type,
           confidence = EXCLUDED.confidence,
           signature_json = EXCLUDED.signature_json,
           metadata_json = EXCLUDED.metadata_json,
           updated_at = EXTRACT(EPOCH FROM NOW())::bigint`,
                [
                    concept.id,
                    concept.canonicalName,
                    concept.type ?? null,
                    concept.confidence ?? 0,
                    JSON.stringify(concept.signature ?? null),
                    JSON.stringify(concept.metadata ?? null),
                ]
            );

            await c.query('DELETE FROM concept_relations WHERE from_concept_id = $1', [concept.id]);
            for (const [, relation] of concept.relations) {
                await c.query(
                    `INSERT INTO concept_relations (id, from_concept_id, to_concept_id, relation_type, confidence, evidence_json, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET confidence = EXCLUDED.confidence, evidence_json = EXCLUDED.evidence_json`,
                    [
                        relation.id,
                        concept.id,
                        relation.targetConceptId,
                        relation.type,
                        relation.confidence ?? 0.5,
                        JSON.stringify(relation.evidence ?? []),
                        relation.createdAt?.toISOString?.() ?? new Date().toISOString(),
                    ]
                );
            }

            await c.query('DELETE FROM evolution_history WHERE concept_id = $1', [concept.id]);
            for (const ev of concept.evolution ?? []) {
                await c.query(
                    `INSERT INTO evolution_history (concept_id, timestamp, change_type, from_state, to_state, reason, confidence)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [concept.id, ev.timestamp, ev.type, ev.from, ev.to, ev.reason || null, ev.confidence ?? 0.5]
                );
            }

            await c.query('COMMIT');
        } catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
    }

    async deleteConcept(conceptId: string): Promise<void> {
        this.ensureReady();
        await this.client.query('DELETE FROM concepts WHERE id = $1', [conceptId]);
    }

    async loadConcept(conceptId: string): Promise<Concept | null> {
        this.ensureReady();
        const row = await this.client
            .query('SELECT * FROM concepts WHERE id = $1', [conceptId])
            .then((r: any) => r.rows[0]);
        if (!row) return null;
        const relations = await this.loadRelationsForConceptIds([conceptId]);
        const evolution = await this.loadEvolutionForConceptIds([conceptId]);
        return this.rowToConcept(row, relations.get(conceptId) ?? new Map(), evolution.get(conceptId) ?? []);
    }

    async loadAllConcepts(): Promise<Concept[]> {
        this.ensureReady();
        const rows: any[] = await this.client
            .query('SELECT * FROM concepts ORDER BY updated_at DESC')
            .then((r: any) => r.rows as any[]);
        const ids = rows.map((r) => r.id);
        const relations = await this.loadRelationsForConceptIds(ids);
        const evolution = await this.loadEvolutionForConceptIds(ids);
        return rows.map((r) => this.rowToConcept(r, relations.get(r.id) ?? new Map(), evolution.get(r.id) ?? []));
    }

    async upsertSymbol(symbol: Symbol): Promise<void> {
        this.ensureReady();
        const language = symbol.language ?? null;
        const existing = await this.client.query(
            `SELECT id FROM symbols
             WHERE text = $1 AND ((language IS NULL AND $2::text IS NULL) OR language = $2) AND id <> $3
             ORDER BY id
             LIMIT 1`,
            [symbol.text, language, symbol.id]
        );
        const existingId = existing.rows?.[0]?.id;
        const c = this.client;
        await c.query('BEGIN');
        try {
            if (existingId) {
                await c.query(
                    `UPDATE symbols SET confidence = $1, updated_at = EXTRACT(EPOCH FROM NOW())::bigint WHERE id = $2`,
                    [symbol.confidence ?? 0, existingId]
                );
                await this.migrateSymbolAlias(symbol.id, existingId);
            } else {
                await c.query(`DELETE FROM symbol_aliases WHERE alias_id = $1`, [symbol.id]);
                await c.query(
                    `INSERT INTO symbols (id, text, language, confidence, updated_at)
       VALUES ($1,$2,$3,$4,EXTRACT(EPOCH FROM NOW())::bigint)
       ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text,
         language = EXCLUDED.language,
         confidence = EXCLUDED.confidence,
         updated_at = EXTRACT(EPOCH FROM NOW())::bigint`,
                    [symbol.id, symbol.text, language, symbol.confidence ?? 0]
                );
            }
            await c.query('COMMIT');
        } catch (error) {
            await c.query('ROLLBACK').catch(() => undefined);
            throw error;
        }
    }

    async loadAllSymbols(): Promise<Symbol[]> {
        this.ensureReady();
        const rows: any[] = await this.client.query('SELECT * FROM symbols').then((r: any) => r.rows as any[]);
        return rows.map((r) => ({
            id: r.id,
            text: r.text,
            language: r.language ?? undefined,
            confidence: r.confidence ?? 0,
        }));
    }

    async upsertThing(thing: Thing): Promise<void> {
        this.ensureReady();
        await this.client.query(
            `INSERT INTO things
        (id, kind, location_uri, location_range, signature, type_info_json, confidence, first_seen, last_seen, occurrences, context, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,EXTRACT(EPOCH FROM NOW())::bigint)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         location_uri = EXCLUDED.location_uri,
         location_range = EXCLUDED.location_range,
         signature = EXCLUDED.signature,
         type_info_json = EXCLUDED.type_info_json,
         confidence = EXCLUDED.confidence,
         first_seen = EXCLUDED.first_seen,
         last_seen = EXCLUDED.last_seen,
         occurrences = EXCLUDED.occurrences,
         context = EXCLUDED.context,
         updated_at = EXTRACT(EPOCH FROM NOW())::bigint`,
            [
                thing.id,
                thing.kind,
                (thing.location as any)?.uri,
                JSON.stringify((thing.location as any)?.range),
                thing.signature ?? null,
                JSON.stringify((thing as any).typeInfo ?? null),
                thing.confidence ?? 0,
                thing.firstSeen ? Math.floor(new Date(thing.firstSeen).getTime() / 1000) : Math.floor(Date.now() / 1000),
                thing.lastSeen ? Math.floor(new Date(thing.lastSeen).getTime() / 1000) : Math.floor(Date.now() / 1000),
                typeof thing.occurrences === 'number' ? thing.occurrences : 1,
                thing.context ?? null,
            ]
        );
    }

    async loadAllThings(): Promise<Thing[]> {
        this.ensureReady();
        const rows: any[] = await this.client.query('SELECT * FROM things').then((r: any) => r.rows as any[]);
        return rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            location: { uri: r.location_uri, range: r.location_range } as any,
            signature: r.signature ?? undefined,
            typeInfo: r.type_info_json ?? undefined,
            confidence: r.confidence ?? 0,
            firstSeen: new Date((Number(r.first_seen) || 0) * 1000),
            lastSeen: new Date((Number(r.last_seen) || 0) * 1000),
            occurrences: r.occurrences ?? 1,
            context: r.context ?? undefined,
        }));
    }

    async upsertThingSymbol(link: ThingSymbolLink): Promise<void> {
        this.ensureReady();
        const symbolId = await this.resolveSymbolAlias(link.symbolId);
        await this.client.query(
            `INSERT INTO thing_symbols (thing_id, symbol_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (thing_id, symbol_id, role) DO NOTHING`,
            [link.thingId, symbolId, link.role]
        );
    }

    async upsertThingConcept(link: ThingConceptLink): Promise<void> {
        this.ensureReady();
        await this.client.query(
            `INSERT INTO thing_concepts (thing_id, concept_id, confidence, evidence_json)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (thing_id, concept_id) DO UPDATE SET confidence = EXCLUDED.confidence, evidence_json = EXCLUDED.evidence_json`,
            [link.thingId, link.conceptId, link.confidence ?? 0.5, JSON.stringify(link.evidence ?? [])]
        );
    }

    private async backfillDuplicateSymbols(): Promise<void> {
        this.ensureReady();
        const res = await this.client.query(`SELECT id, text, language FROM symbols ORDER BY text, language, id`);
        const groups = new Map<string, Array<{ id: string; text: string; language: string | null }>>();
        for (const row of res.rows as Array<{ id: string; text: string; language: string | null }>) {
            const key = `${row.text}\u0000${row.language ?? '<null>'}`;
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
        }

        const c = this.client;
        await c.query('BEGIN');
        try {
            for (const group of groups.values()) {
                if (group.length < 2) continue;
                const [canonical, ...aliases] = group.sort((a, b) => a.id.localeCompare(b.id));
                if (!canonical) continue;
                for (const alias of aliases) await this.migrateSymbolAlias(alias.id, canonical.id);
            }
            await c.query('COMMIT');
        } catch (error) {
            await c.query('ROLLBACK').catch(() => undefined);
            throw error;
        }
    }

    private async migrateSymbolAlias(aliasId: string, canonicalId: string): Promise<void> {
        if (aliasId === canonicalId) return;
        await this.client.query(`UPDATE symbol_aliases SET canonical_id = $1 WHERE canonical_id = $2`, [canonicalId, aliasId]);
        await this.client.query(
            `INSERT INTO symbol_aliases (alias_id, canonical_id)
             VALUES ($1, $2)
             ON CONFLICT (alias_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id`,
            [aliasId, canonicalId]
        );
        await this.client.query(
            `INSERT INTO thing_symbols (thing_id, symbol_id, role)
             SELECT thing_id, $1, role FROM thing_symbols WHERE symbol_id = $2
             ON CONFLICT (thing_id, symbol_id, role) DO NOTHING`,
            [canonicalId, aliasId]
        );
        await this.client.query(`DELETE FROM thing_symbols WHERE symbol_id = $1`, [aliasId]);
        await this.client.query(`DELETE FROM symbols WHERE id = $1`, [aliasId]);
    }

    private async resolveSymbolAlias(symbolId: string): Promise<string> {
        this.ensureReady();
        const res = await this.client.query(`SELECT canonical_id FROM symbol_aliases WHERE alias_id = $1`, [symbolId]);
        return res.rows?.[0]?.canonical_id ?? symbolId;
    }

    async loadAllThingSymbols(): Promise<ThingSymbolLink[]> {
        this.ensureReady();
        const rows: any[] = await this.client.query('SELECT * FROM thing_symbols').then((r: any) => r.rows as any[]);
        return rows.map((r) => ({ thingId: r.thing_id, symbolId: r.symbol_id, role: r.role }));
    }

    async loadAllThingConcepts(): Promise<ThingConceptLink[]> {
        this.ensureReady();
        const rows: any[] = await this.client.query('SELECT * FROM thing_concepts').then((r: any) => r.rows as any[]);
        return rows.map((r) => ({
            thingId: r.thing_id,
            conceptId: r.concept_id,
            confidence: r.confidence ?? 0.5,
            evidence: r.evidence_json ?? undefined,
        }));
    }

    async findConceptsByName(name: string): Promise<Concept[]> {
        this.ensureReady();
        const rows: any[] = await this.client
            .query('SELECT * FROM concepts WHERE canonical_name ILIKE $1 ORDER BY updated_at DESC', ['%' + name + '%'])
            .then((r: any) => r.rows as any[]);
        const ids = rows.map((r) => r.id);
        const relations = await this.loadRelationsForConceptIds(ids);
        const evolution = await this.loadEvolutionForConceptIds(ids);
        return rows.map((r) => this.rowToConcept(r, relations.get(r.id) ?? new Map(), evolution.get(r.id) ?? []));
    }

    async getConceptStatistics(): Promise<{
        totalConcepts: number;
        totalSymbols: number;
        totalThings: number;
        totalConceptRelations: number;
    }> {
        this.ensureReady();
        const totalConcepts = await this.client.query('SELECT COUNT(*)::int as c FROM concepts').then((r: any) => r.rows[0].c);
        const totalSymbols = await this.client.query('SELECT COUNT(*)::int as c FROM symbols').then((r: any) => r.rows[0].c);
        const totalThings = await this.client.query('SELECT COUNT(*)::int as c FROM things').then((r: any) => r.rows[0].c);
        const totalConceptRelations = await this.client
            .query('SELECT COUNT(*)::int as c FROM concept_relations')
            .then((r: any) => r.rows[0].c);
        return { totalConcepts, totalSymbols, totalThings, totalConceptRelations };
    }

    async vacuum(): Promise<void> {}
    async analyze(): Promise<void> {}
    async backup(_backupPath: string): Promise<void> {}

    private async loadRelationsForConceptIds(ids: string[]): Promise<Map<string, Map<string, Relation>>> {
        const out = new Map<string, Map<string, Relation>>();
        if (ids.length === 0) return out;
        const rows = await this.client
            .query('SELECT * FROM concept_relations WHERE from_concept_id = ANY($1)', [ids])
            .then((r: any) => r.rows as any[]);
        for (const rr of rows) {
            const rel: Relation = {
                id: rr.id,
                targetConceptId: rr.to_concept_id,
                type: rr.relation_type,
                confidence: rr.confidence ?? 0.5,
                evidence: rr.evidence_json ?? [],
                createdAt: new Date(rr.created_at),
            };
            if (!out.has(rr.from_concept_id)) out.set(rr.from_concept_id, new Map());
            out.get(rr.from_concept_id)!.set(rr.to_concept_id, rel);
        }
        return out;
    }

    private async loadEvolutionForConceptIds(ids: string[]): Promise<Map<string, any[]>> {
        const out = new Map<string, any[]>();
        if (ids.length === 0) return out;
        const rows = await this.client
            .query('SELECT * FROM evolution_history WHERE concept_id = ANY($1) ORDER BY timestamp DESC', [ids])
            .then((r: any) => r.rows as any[]);
        for (const ev of rows) {
            if (!out.has(ev.concept_id)) out.set(ev.concept_id, []);
            out.get(ev.concept_id)!.push({
                timestamp: new Date(ev.timestamp),
                type: ev.change_type,
                from: ev.from_state,
                to: ev.to_state,
                reason: ev.reason || '',
                confidence: ev.confidence ?? 0.5,
            });
        }
        return out;
    }

    private rowToConcept(row: any, relations: Map<string, Relation>, evolution: any[]): Concept {
        return {
            id: row.id,
            canonicalName: row.canonical_name,
            type: row.semantic_type ?? undefined,
            relations,
            signature: row.signature_json ?? { parameters: [], sideEffects: [], complexity: 0, fingerprint: '' },
            evolution,
            metadata: row.metadata_json ?? { tags: [] },
            confidence: row.confidence ?? 0,
        };
    }
}

