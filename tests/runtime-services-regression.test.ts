import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheService } from '../src/core/services/cache-service.js';
import { DatabaseService } from '../src/core/services/database-service.js';
import { EventBusService } from '../src/core/services/event-bus-service.js';

const roots: string[] = [];
function tempWorkspace(prefix = 'sci-runtime-services-') {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('runtime service regressions', () => {
    test('memory cache enforces maxSize as bytes rather than approximate entry count', async () => {
        const cache = new CacheService(
            { enabled: true, strategy: 'memory', memory: { maxSize: 64, ttl: 60 } },
            new EventBusService()
        );
        await cache.initialize();
        await cache.set('small', 'ok');
        await cache.set('large', 'x'.repeat(1024));

        expect(await cache.get('small')).toBe('ok');
        expect(await cache.get('large')).toBeNull();
        expect(cache.getStats().memoryStats.byteSize).toBeLessThanOrEqual(64);
        await cache.dispose();
    });

    test('database transactions can finish after service disposal without returning handles to a disposed pool', async () => {
        const root = tempWorkspace();
        const service = new DatabaseService(
            {
                path: join(root, 'ontology.db'),
                maxConnections: 1,
                busyTimeout: 1000,
                enableWAL: false,
                enableForeignKeys: true,
            },
            new EventBusService()
        );
        await service.initialize();

        let unblock!: () => void;
        const blocked = new Promise<void>((resolve) => {
            unblock = resolve;
        });
        const tx = service.transaction(async (query) => {
            await blocked;
            const rows = await query('SELECT 1 AS value');
            return rows[0].value;
        });

        await service.dispose();
        unblock();
        await expect(tx).resolves.toBe(1);
        await expect(service.query('SELECT 1')).rejects.toThrow('Database service not initialized');
    });
});
