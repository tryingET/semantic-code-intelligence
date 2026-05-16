import type { Concept, Relation, Symbol, Thing, ThingConceptLink, ThingSymbolLink } from '../../types/core';
import type { StoragePort } from '../storage-port';

// Triple Store adapter (in-memory) for CRUD parity and tests.
// No external network required; TRIPLESTORE_URL is intentionally ignored.
export class TripleStoreStorageAdapter implements StoragePort {
    private concepts = new Map<string, Concept>();
    private symbols = new Map<string, Symbol>();
    private things = new Map<string, Thing>();
    private thingSymbols = new Map<string, ThingSymbolLink>(); // key: thing|symbol|role
    private thingConcepts = new Map<string, ThingConceptLink>(); // key: thing|concept
    private initialized = false;

    async initialize(): Promise<void> {
        this.initialized = true;
    }

    async close(): Promise<void> {
        // no-op
    }

    private ensure(): void {
        if (!this.initialized) throw new Error('TRIPLESTORE_NOT_INITIALIZED');
    }

    async upsertConcept(concept: Concept): Promise<void> {
        this.ensure();
        this.concepts.set(concept.id, this.cloneConcept(concept));
    }

    async deleteConcept(conceptId: string): Promise<void> {
        this.ensure();
        this.concepts.delete(conceptId);
        // Remove links to deleted concept
        for (const [k, link] of this.thingConcepts.entries()) {
            if (link.conceptId === conceptId) this.thingConcepts.delete(k);
        }
        for (const [, c] of this.concepts) {
            if (c.relations.has(conceptId)) c.relations.delete(conceptId);
        }
    }

    async loadConcept(conceptId: string): Promise<Concept | null> {
        this.ensure();
        const c = this.concepts.get(conceptId);
        return c ? this.cloneConcept(c) : null;
    }

    async loadAllConcepts(): Promise<Concept[]> {
        this.ensure();
        return [...this.concepts.values()].map((c) => this.cloneConcept(c));
    }

    async upsertSymbol(symbol: Symbol): Promise<void> {
        this.ensure();
        this.symbols.set(symbol.id, { ...symbol });
    }

    async loadAllSymbols(): Promise<Symbol[]> {
        this.ensure();
        return [...this.symbols.values()].map((s) => ({ ...s }));
    }

    async upsertThing(thing: Thing): Promise<void> {
        this.ensure();
        this.things.set(thing.id, { ...thing });
    }

    async loadAllThings(): Promise<Thing[]> {
        this.ensure();
        return [...this.things.values()].map((t) => ({ ...t }));
    }

    async upsertThingSymbol(link: ThingSymbolLink): Promise<void> {
        this.ensure();
        const key = `${link.thingId}|${link.symbolId}|${link.role}`;
        this.thingSymbols.set(key, { ...link });
    }

    async upsertThingConcept(link: ThingConceptLink): Promise<void> {
        this.ensure();
        const key = `${link.thingId}|${link.conceptId}`;
        this.thingConcepts.set(key, { ...link });
    }

    async loadAllThingSymbols(): Promise<ThingSymbolLink[]> {
        this.ensure();
        return [...this.thingSymbols.values()].map((l) => ({ ...l }));
    }

    async loadAllThingConcepts(): Promise<ThingConceptLink[]> {
        this.ensure();
        return [...this.thingConcepts.values()].map((l) => ({ ...l }));
    }

    async findConceptsByName(name: string): Promise<Concept[]> {
        this.ensure();
        const res: Concept[] = [];
        for (const [, c] of this.concepts) {
            if (c.canonicalName.includes(name)) res.push(this.cloneConcept(c));
        }
        return res;
    }

    async getConceptStatistics(): Promise<{
        totalConcepts: number;
        totalSymbols: number;
        totalThings: number;
        totalConceptRelations: number;
    }> {
        this.ensure();
        const totalConcepts = this.concepts.size;
        const totalSymbols = this.symbols.size;
        const totalThings = this.things.size;
        let totalConceptRelations = 0;
        for (const [, c] of this.concepts) totalConceptRelations += c.relations.size;
        return { totalConcepts, totalSymbols, totalThings, totalConceptRelations };
    }

    async vacuum(): Promise<void> {}
    async analyze(): Promise<void> {}
    async backup(_backupPath: string): Promise<void> {}

    private cloneConcept(c: Concept): Concept {
        const relations = new Map<string, Relation>();
        for (const [k, v] of c.relations.entries()) relations.set(k, { ...v });
        return {
            id: c.id,
            canonicalName: c.canonicalName,
            type: c.type,
            relations,
            signature: c.signature,
            evolution: Array.isArray(c.evolution) ? [...c.evolution] : [],
            metadata: c.metadata,
            confidence: c.confidence,
        };
    }
}

