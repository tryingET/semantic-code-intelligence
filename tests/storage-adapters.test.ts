import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresStorageAdapter } from '../src/ontology/adapters/postgres-adapter';
import { TripleStoreStorageAdapter } from '../src/ontology/adapters/triple-adapter';
import { OntologyStorage } from '../src/ontology/storage';
import { createStorageAdapter } from '../src/ontology/storage-factory';

function innerAdapter(adapter: any) {
    return adapter.inner || adapter._inner || adapter;
}

describe('Layer 4 StoragePort factory', () => {
    test('defaults to sqlite when no adapter specified', async () => {
        const adapter: any = createStorageAdapter(undefined);
        // Instrumented wrapper expected; inner should be OntologyStorage
        expect(typeof adapter.getMetrics).toBe('function');
        expect(adapter.inner || adapter._inner || adapter).toBeTruthy();
        const inner = innerAdapter(adapter);
        expect(inner).toBeInstanceOf(OntologyStorage);
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
        expect(innerAdapter(adapter)).toBeInstanceOf(PostgresStorageAdapter);
        await adapter.initialize();
        await adapter.close();
    });

    test('returns Triple Store adapter when selected', async () => {
        const adapter = createStorageAdapter({ enabled: true, adapter: 'triplestore' });
        expect(innerAdapter(adapter)).toBeInstanceOf(TripleStoreStorageAdapter);
        await adapter.initialize();
        await adapter.close();
    });

    test('rejects unknown storage adapters instead of silently falling back', () => {
        expect(() => createStorageAdapter({ enabled: true, adapter: 'postgress' as any })).toThrow('Unsupported Layer 4 storage adapter');
    });

    test('SQLite backup uses the live database backup path and can overwrite an existing backup', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sci-storage-backup-'));
        const dbPath = join(dir, 'ontology.db');
        const backupPath = join(dir, 'ontology.backup.db');
        const storage = new OntologyStorage(dbPath);
        try {
            await storage.initialize();
            await storage.backup(backupPath);
            expect(existsSync(backupPath)).toBe(true);
            await storage.backup(backupPath);
            expect(existsSync(backupPath)).toBe(true);
        } finally {
            await storage.close().catch(() => undefined);
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
