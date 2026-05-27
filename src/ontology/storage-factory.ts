import type { Layer4Config } from '../core/types';
import { PostgresStorageAdapter } from './adapters/postgres-adapter';
import { TripleStoreStorageAdapter } from './adapters/triple-adapter';
import { InstrumentedStoragePort } from './instrumented-storage';
import { SemanticGraphStorage as SQLiteStorageAdapter } from './storage';
import type { StorageAdapterKind, StoragePort } from './storage-port';

// Factory to create a StoragePort implementation based on configuration
export function createStorageAdapter(config: Layer4Config | undefined): StoragePort {
    const adapter: StorageAdapterKind = (config?.adapter as StorageAdapterKind) || 'sqlite';

    switch (adapter) {
        case 'sqlite': {
            const dbPath = config?.dbPath || '.semantic-graph/semantic-graph.db';
            return new InstrumentedStoragePort(new SQLiteStorageAdapter(dbPath));
        }
        case 'postgres':
            return new InstrumentedStoragePort(new PostgresStorageAdapter());
        case 'triplestore':
            return new InstrumentedStoragePort(new TripleStoreStorageAdapter());
        default: {
            throw new Error(`Unsupported Layer 4 storage adapter: ${String(config?.adapter || adapter)}`);
        }
    }
}
