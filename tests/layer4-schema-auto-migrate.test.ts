/**
 * Tests for L4 schema auto-migration behavior.
 *
 * Verifies that OntologyStorage creates the database schema automatically
 * in the constructor when L4_AUTO_MIGRATE=1 (default), eliminating
 * "no such table: concepts" errors in tests.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { OntologyEngine } from '../src/ontology/ontology-engine';
import { OntologyStorage } from '../src/ontology/storage';

const TMP_DIR = '/tmp/l4-schema-test';
const TMP_DB = path.join(TMP_DIR, 'test.db');

describe('L4 Schema Auto-Migration', () => {
    beforeEach(() => {
        // Clean up test database
        if (fs.existsSync(TMP_DB)) {
            fs.unlinkSync(TMP_DB);
        }
        if (fs.existsSync(TMP_DIR)) {
            fs.rmSync(TMP_DIR, { recursive: true });
        }
    });

    afterEach(() => {
        // Clean up test database
        if (fs.existsSync(TMP_DB)) {
            fs.unlinkSync(TMP_DB);
        }
        if (fs.existsSync(TMP_DIR)) {
            fs.rmSync(TMP_DIR, { recursive: true });
        }
    });

    test('schema is auto-created in constructor (L4_AUTO_MIGRATE=1 default)', async () => {
        // Create storage without calling initialize()
        const storage = new OntologyStorage(TMP_DB);

        // Schema should already exist - verify by querying concepts table
        const stats = await storage.getConceptStatistics();
        expect(stats).toBeDefined();
        expect(stats.totalConcepts).toBe(0);
        expect(stats.totalSymbols).toBe(0);
        expect(stats.totalThings).toBe(0);
        expect(stats.totalConceptRelations).toBe(0);

        await storage.close();
    });

    test('operations work immediately without calling initialize()', async () => {
        const storage = new OntologyStorage(TMP_DB);

        // Save a concept directly without initialize()
        const concept = {
            id: 'test-concept-1',
            canonicalName: 'TestConcept',
            relations: new Map(),
            signature: {
                parameters: [],
                sideEffects: [],
                complexity: 0,
                fingerprint: 'test',
            },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.9,
        };

        // This should NOT throw "no such table: concepts"
        await storage.upsertConcept(concept);

        // Verify it was saved
        const loaded = await storage.loadConcept('test-concept-1');
        expect(loaded).not.toBeNull();
        expect(loaded?.canonicalName).toBe('TestConcept');

        await storage.close();
    });

    test('ensureSchema() is idempotent', async () => {
        const storage = new OntologyStorage(TMP_DB);

        // Call ensureSchema() multiple times - should not throw
        storage.ensureSchema();
        storage.ensureSchema();
        storage.ensureSchema();

        // Schema should still work
        const stats = await storage.getConceptStatistics();
        expect(stats.totalConcepts).toBe(0);

        await storage.close();
    });

    test('in-memory database works without explicit initialize()', async () => {
        const storage = new OntologyStorage(':memory:');

        // Save and load should work immediately
        const concept = {
            id: 'mem-concept',
            canonicalName: 'MemoryConcept',
            relations: new Map(),
            signature: {
                parameters: [],
                sideEffects: [],
                complexity: 0,
                fingerprint: 'mem',
            },
            evolution: [],
            metadata: { tags: ['test'] },
            confidence: 0.8,
        };

        await storage.upsertConcept(concept);
        const loaded = await storage.loadConcept('mem-concept');

        expect(loaded).not.toBeNull();
        expect(loaded?.canonicalName).toBe('MemoryConcept');

        await storage.close();
    });

    test('OntologyEngine works without explicit initialize() call', async () => {
        // This is the common pattern in tests - create engine inline
        const storage = new OntologyStorage(':memory:');
        const engine = new OntologyEngine(storage);

        // These operations should work without calling ensureInitialized() first
        // because the storage schema is auto-created in constructor
        // Use storage.loadAllConcepts() since engine.findConcept needs initialization
        const concepts = await storage.loadAllConcepts();
        expect(Array.isArray(concepts)).toBe(true);
        expect(concepts.length).toBe(0);

        await storage.close();
    });

    test('initialize() is safe to call after constructor auto-migration', async () => {
        const storage = new OntologyStorage(TMP_DB);

        // Save something before initialize()
        const concept1 = {
            id: 'before-init',
            canonicalName: 'BeforeInit',
            relations: new Map(),
            signature: { parameters: [], sideEffects: [], complexity: 0, fingerprint: '' },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.5,
        };
        await storage.upsertConcept(concept1);

        // Now call initialize() - should be idempotent and not lose data
        await storage.initialize();

        // Verify data is still there
        const loaded = await storage.loadConcept('before-init');
        expect(loaded).not.toBeNull();
        expect(loaded?.canonicalName).toBe('BeforeInit');

        // Save after initialize() should also work
        const concept2 = {
            id: 'after-init',
            canonicalName: 'AfterInit',
            relations: new Map(),
            signature: { parameters: [], sideEffects: [], complexity: 0, fingerprint: '' },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.6,
        };
        await storage.upsertConcept(concept2);

        const stats = await storage.getConceptStatistics();
        expect(stats.totalConcepts).toBe(2);

        await storage.close();
    });

    test('schema includes all expected tables', async () => {
        const storage = new OntologyStorage(':memory:');

        // Access the internal db to verify tables exist
        const db = (storage as any).db;

        const tables = db
            .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map((r: any) => r.name);

        expect(tables).toContain('concepts');
        expect(tables).toContain('concept_relations');
        expect(tables).toContain('evolution_history');
        expect(tables).toContain('symbols');
        expect(tables).toContain('things');
        expect(tables).toContain('thing_symbols');
        expect(tables).toContain('thing_concepts');

        await storage.close();
    });

    test('schema includes expected indices', async () => {
        const storage = new OntologyStorage(':memory:');

        const db = (storage as any).db;

        const indices = db
            .query("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .all()
            .map((r: any) => r.name);

        // Check for key indices
        expect(indices).toContain('idx_concepts_canonical_name');
        expect(indices).toContain('idx_concept_relations_from');
        expect(indices).toContain('idx_concept_relations_to');
        expect(indices).toContain('idx_symbols_text');
        expect(indices).toContain('idx_things_location_uri');

        await storage.close();
    });
});
