import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresStorageAdapter } from '../src/ontology/adapters/postgres-adapter';
import { TripleStoreStorageAdapter } from '../src/ontology/adapters/triple-adapter';
import { OntologyStorage } from '../src/ontology/storage';
import { createStorageAdapter } from '../src/ontology/storage-factory';
import { ThingKind } from '../src/types/core';

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

    test('SQLite canonicalizes duplicate symbol text and migrates existing links from alias ids', async () => {
        const storage = new OntologyStorage(':memory:');
        try {
            await storage.initialize();
            await storage.upsertSymbol({ id: 's1', text: 'SharedName', language: 'ts', confidence: 0.5 });
            await storage.upsertSymbol({ id: 's2', text: 'OtherName', language: 'ts', confidence: 0.4 });
            await storage.upsertThing({
                id: 't1',
                kind: ThingKind.Function,
                location: { uri: 'file:///tmp/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
                confidence: 0.7,
            });
            await storage.upsertThingSymbol({ thingId: 't1', symbolId: 's2', role: 'declaration' });

            await storage.upsertSymbol({ id: 's2', text: 'SharedName', language: 'ts', confidence: 0.9 });

            expect(await storage.loadAllSymbols()).toEqual([{ id: 's1', text: 'SharedName', language: 'ts', confidence: 0.9 }]);
            expect(await storage.loadAllThingSymbols()).toEqual([{ thingId: 't1', symbolId: 's1', role: 'declaration' }]);
        } finally {
            await storage.close().catch(() => undefined);
        }
    });

    test('SQLite backfills historical null-language duplicate symbols during schema initialization', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sci-storage-alias-backfill-'));
        const dbPath = join(dir, 'ontology.db');
        const storage = new OntologyStorage(dbPath);
        try {
            await storage.initialize();
            const db = (storage as any).db;
            db.prepare(`INSERT INTO symbols (id, text, language, confidence) VALUES (?, ?, NULL, ?)`).run('s1', 'SharedName', 0.5);
            db.prepare(`INSERT INTO symbols (id, text, language, confidence) VALUES (?, ?, NULL, ?)`).run('s2', 'SharedName', 0.7);
            await storage.upsertThing({
                id: 't1',
                kind: ThingKind.Function,
                location: { uri: 'file:///tmp/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
                confidence: 0.7,
            });
            db.prepare(`INSERT INTO thing_symbols (thing_id, symbol_id, role) VALUES (?, ?, ?)`).run('t1', 's2', 'declaration');
        } finally {
            await storage.close().catch(() => undefined);
        }

        const reopened = new OntologyStorage(dbPath);
        try {
            await reopened.initialize();
            expect(await reopened.loadAllSymbols()).toEqual([{ id: 's1', text: 'SharedName', language: undefined, confidence: 0.5 }]);
            expect(await reopened.loadAllThingSymbols()).toEqual([{ thingId: 't1', symbolId: 's1', role: 'declaration' }]);
        } finally {
            await reopened.close().catch(() => undefined);
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('TripleStore rejects orphan links like FK-backed adapters and resolves symbol aliases', async () => {
        const adapter = new TripleStoreStorageAdapter();
        await adapter.initialize();

        await expect(adapter.upsertThingSymbol({ thingId: 'missingThing', symbolId: 'missingSymbol', role: 'declaration' })).rejects.toThrow(
            'FOREIGN_KEY_VIOLATION'
        );
        await expect(adapter.upsertThingConcept({ thingId: 'missingThing', conceptId: 'missingConcept', confidence: 0.5 })).rejects.toThrow(
            'FOREIGN_KEY_VIOLATION'
        );

        await adapter.upsertSymbol({ id: 's1', text: 'SharedName', language: 'ts', confidence: 0.5 });
        await adapter.upsertSymbol({ id: 's2', text: 'OtherName', language: 'ts', confidence: 0.4 });
        await adapter.upsertThing({
            id: 't1',
            kind: ThingKind.Function,
            location: { uri: 'file:///tmp/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
            confidence: 0.7,
        });
        await adapter.upsertThingSymbol({ thingId: 't1', symbolId: 's2', role: 'declaration' });
        await adapter.upsertSymbol({ id: 's2', text: 'SharedName', language: 'ts', confidence: 0.9 });
        expect(await adapter.loadAllSymbols()).toEqual([{ id: 's1', text: 'SharedName', language: 'ts', confidence: 0.9 }]);
        expect(await adapter.loadAllThingSymbols()).toEqual([{ thingId: 't1', symbolId: 's1', role: 'declaration' }]);
    });

    (hasPg ? test : test.skip)('Postgres canonicalizes duplicate symbol text and migrates links like other adapters', async () => {
        const adapter = new PostgresStorageAdapter();
        await adapter.initialize();
        try {
            await adapter.upsertSymbol({ id: 's1', text: 'SharedName', language: 'ts', confidence: 0.5 });
            await adapter.upsertSymbol({ id: 's2', text: 'OtherName', language: 'ts', confidence: 0.4 });
            await adapter.upsertThing({
                id: 't1',
                kind: ThingKind.Function,
                location: { uri: 'file:///tmp/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
                confidence: 0.7,
            });
            await adapter.upsertThingSymbol({ thingId: 't1', symbolId: 's2', role: 'declaration' });
            await adapter.upsertSymbol({ id: 's2', text: 'SharedName', language: 'ts', confidence: 0.9 });
            expect((await adapter.loadAllThingSymbols()).filter((link) => link.thingId === 't1')).toEqual([
                { thingId: 't1', symbolId: 's1', role: 'declaration' },
            ]);
        } finally {
            await adapter.close().catch(() => undefined);
        }
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
