import type { Concept, Symbol, Thing, ThingConceptLink, ThingSymbolLink } from '../types/core';

// StoragePort abstracts Layer 4 persistence behind interchangeable adapters.
// Implementations must be fast, safe, and support basic maintenance.
export interface StoragePort {
    // Lifecycle
    initialize(): Promise<void>;
    close(): Promise<void>;

    /**
     * Ensure the database schema exists (idempotent).
     * Called automatically in SQLite adapter constructor when L4_AUTO_MIGRATE=1.
     * Safe to call multiple times - no-op if schema already exists.
     * Optional: adapters that don't need schema setup can omit this.
     */
    ensureSchema?(): void;

    // Concepts (Conceptualization)
    upsertConcept(concept: Concept): Promise<void>;
    deleteConcept(conceptId: string): Promise<void>;
    loadConcept(conceptId: string): Promise<Concept | null>;
    loadAllConcepts(): Promise<Concept[]>;

    // Symbols (Notation)
    upsertSymbol(symbol: Symbol): Promise<void>;
    loadAllSymbols(): Promise<Symbol[]>;

    // Things (Referents / anchors)
    upsertThing(thing: Thing): Promise<void>;
    loadAllThings(): Promise<Thing[]>;

    // Links (Thing ↔ Symbol, Thing ↔ Concept)
    upsertThingSymbol(link: ThingSymbolLink): Promise<void>;
    upsertThingConcept(link: ThingConceptLink): Promise<void>;
    loadAllThingSymbols(): Promise<ThingSymbolLink[]>;
    loadAllThingConcepts(): Promise<ThingConceptLink[]>;

    // Optional helpers (adapters may no-op or throw if unsupported)
    findConceptsByName?(name: string): Promise<Concept[]>;
    getConceptStatistics?(): Promise<{
        totalConcepts: number;
        totalSymbols: number;
        totalThings: number;
        totalConceptRelations: number;
    }>;
    vacuum?(): Promise<void>;
    analyze?(): Promise<void>;
    backup?(backupPath: string): Promise<void>;
}

// Adapter type identifiers for configuration
export type StorageAdapterKind = 'sqlite' | 'postgres' | 'triplestore';
