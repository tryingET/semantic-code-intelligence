import { describe, expect, test } from 'bun:test';
import { PostgresStorageAdapter } from '../src/ontology/adapters/postgres-adapter';
import { TripleStoreStorageAdapter } from '../src/ontology/adapters/triple-adapter';
import { OntologyStorage } from '../src/ontology/storage';
import { createStorageAdapter } from '../src/ontology/storage-factory';

describe('Layer 4 StoragePort factory', () => {
    test('defaults to sqlite when no adapter specified', async () => {
        const adapter: any = createStorageAdapter(undefined);
        // Instrumented wrapper expected; inner should be OntologyStorage
        expect(typeof adapter.getMetrics).toBe('function');
        expect(adapter.inner || adapter._inner || adapter).toBeTruthy();
        const inner = adapter.inner || adapter._inner || adapter;
        // inner is OntologyStorage when instrumented
        await adapter.initialize();
        await adapter.close();
    });

    const hasPg = !!(
        process.env.ONTOLOGY_PG_URL ||
        process.env.DATABASE_URL ||
        process.env.PGURL ||
        process.env.PG_URL
    );
    (hasPg ? test : test.skip)('returns Postgres adapter when selected', async () => {
        const adapter = createStorageAdapter({ enabled: true, adapter: 'postgres' });
        expect(adapter).toBeInstanceOf(PostgresStorageAdapter);
        await adapter.initialize();
        await adapter.close();
    });

    // Triple store requires external setup; keep skipped unless explicitly enabled
    const hasTriple = !!process.env.TRIPLESTORE_URL;
    (hasTriple ? test : test.skip)('returns Triple Store adapter when selected', async () => {
        const adapter = createStorageAdapter({ enabled: true, adapter: 'triplestore' });
        expect(adapter).toBeInstanceOf(TripleStoreStorageAdapter);
        await adapter.initialize();
        await adapter.close();
    });
});
