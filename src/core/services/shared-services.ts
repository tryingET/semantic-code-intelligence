/**
 * SharedServices - Central service container for all unified services
 * Manages lifecycle and provides unified access to cache, database, monitoring, etc.
 */

import * as path from 'path';
import { type CoreConfig, CoreError, type EventBus } from '../types.js';
import { CacheService } from './cache-service.js';
import { type DatabaseConfig, DatabaseService } from './database-service.js';
import { EventBusService } from './event-bus-service.js';
import { MonitoringService } from './monitoring-service.js';

/**
 * Container for all shared services used by the unified architecture
 */
export class SharedServices {
    public readonly cache: CacheService;
    public readonly database: DatabaseService;
    public readonly monitoring: MonitoringService;
    public readonly eventBus: EventBus;

    private initialized = false;
    private config: CoreConfig;
    private healthCheckTimer?: NodeJS.Timeout;

    constructor(config: CoreConfig, eventBus?: EventBus) {
        this.config = config;

        // Use provided event bus or create default one
        this.eventBus = eventBus || new EventBusService();

        // Initialize services
        this.cache = new CacheService(config.cache, this.eventBus);

        const dbConfig: DatabaseConfig = {
            path: this.resolveDatabasePath(config),
            maxConnections: config.database?.maxConnections ?? 10,
            busyTimeout: 5000,
            enableWAL: true,
            enableForeignKeys: true,
        };
        this.database = new DatabaseService(dbConfig, this.eventBus);

        this.monitoring = new MonitoringService(config.monitoring, this.eventBus);

        // Set up cross-service event handling
        this.setupEventHandling();
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            this.eventBus.emit('shared-services:initializing', {
                timestamp: Date.now(),
            });

            // Initialize services in dependency order
            await this.database.initialize();
            await this.cache.initialize();
            await this.monitoring.initialize();

            this.initialized = true;

            this.eventBus.emit('shared-services:initialized', {
                timestamp: Date.now(),
                services: ['database', 'cache', 'monitoring'],
            });
        } catch (error) {
            this.eventBus.emit('shared-services:initialization-error', {
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw new CoreError(
                `SharedServices initialization failed: ${error instanceof Error ? error.message : String(error)}`,
                'SHARED_SERVICES_INIT_ERROR'
            );
        }
    }

    async dispose(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        try {
            this.eventBus.emit('shared-services:disposing', {
                timestamp: Date.now(),
            });

            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
                this.healthCheckTimer = undefined;
            }

            // Dispose services in reverse dependency order
            await this.monitoring.dispose();
            await this.cache.dispose();
            await this.database.dispose();

            this.initialized = false;

            this.eventBus.emit('shared-services:disposed', {
                timestamp: Date.now(),
            });
        } catch (error) {
            console.error('Error disposing SharedServices:', error);
            throw new CoreError(
                `SharedServices disposal failed: ${error instanceof Error ? error.message : String(error)}`,
                'SHARED_SERVICES_DISPOSE_ERROR'
            );
        }
    }

    /**
     * Check if all services are healthy
     */
    isHealthy(): boolean {
        return this.initialized && this.database.isHealthy() && this.cache.isHealthy() && this.monitoring.isHealthy();
    }

    /**
     * Get combined statistics from all services
     */
    async getStats(): Promise<{
        database: any;
        cache: any;
        monitoring: any;
        healthy: boolean;
        initialized: boolean;
    }> {
        try {
            const [databaseStats, cacheStats, monitoringStats] = await Promise.allSettled([
                this.database.getStats(),
                Promise.resolve(this.cache.getStats()),
                this.monitoring.getStats(),
            ]);

            return {
                database:
                    databaseStats.status === 'fulfilled'
                        ? databaseStats.value
                        : { error: 'Failed to get database stats' },
                cache: cacheStats.status === 'fulfilled' ? cacheStats.value : { error: 'Failed to get cache stats' },
                monitoring:
                    monitoringStats.status === 'fulfilled'
                        ? monitoringStats.value
                        : { error: 'Failed to get monitoring stats' },
                healthy: this.isHealthy(),
                initialized: this.initialized,
            };
        } catch (error) {
            return {
                database: { error: 'Service unavailable' },
                cache: { error: 'Service unavailable' },
                monitoring: { error: 'Service unavailable' },
                healthy: false,
                initialized: this.initialized,
            };
        }
    }

    /**
     * Get diagnostic information for debugging
     */
    getDiagnostics(): Record<string, any> {
        return {
            initialized: this.initialized,
            healthy: this.isHealthy(),
            config: {
                cache: this.config.cache,
                monitoring: this.config.monitoring,
            },
            services: {
                database: this.database.getDiagnostics(),
                cache: this.cache.getDiagnostics(),
                monitoring: this.monitoring.getDiagnostics(),
            },
            timestamp: Date.now(),
        };
    }

    /**
     * Flush all caches and reset performance counters
     */
    async flush(): Promise<void> {
        if (!this.initialized) {
            throw new CoreError('SharedServices not initialized', 'NOT_INITIALIZED');
        }

        try {
            await this.cache.clear();
            this.monitoring.reset();

            this.eventBus.emit('shared-services:flushed', {
                timestamp: Date.now(),
            });
        } catch (error) {
            this.eventBus.emit('shared-services:flush-error', {
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    /**
     * Backup database to specified location
     */
    async backup(backupPath: string): Promise<void> {
        if (!this.initialized) {
            throw new CoreError('SharedServices not initialized', 'NOT_INITIALIZED');
        }

        try {
            // For SQLite, we can copy the database file
            // In a production system, you'd want to use SQLite's backup API
            const fs = require('fs');
            const sourcePath = this.resolveDatabasePath(this.config);

            if (fs.existsSync(sourcePath)) {
                fs.copyFileSync(sourcePath, backupPath);

                this.eventBus.emit('shared-services:backup-created', {
                    backupPath,
                    timestamp: Date.now(),
                });
            } else {
                throw new CoreError('Database file does not exist', 'DB_FILE_NOT_FOUND');
            }
        } catch (error) {
            this.eventBus.emit('shared-services:backup-error', {
                backupPath,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw new CoreError(
                `Backup failed: ${error instanceof Error ? error.message : String(error)}`,
                'BACKUP_ERROR'
            );
        }
    }

    /**
     * Perform maintenance tasks (optimize database, cleanup caches, etc.)
     */
    async performMaintenance(): Promise<{
        databaseOptimized: boolean;
        cachesCleaned: boolean;
        oldDataPurged: boolean;
        duration: number;
    }> {
        const startTime = Date.now();
        const results = {
            databaseOptimized: false,
            cachesCleaned: false,
            oldDataPurged: false,
            duration: 0,
        };

        if (!this.initialized) {
            throw new CoreError('SharedServices not initialized', 'NOT_INITIALIZED');
        }

        try {
            this.eventBus.emit('shared-services:maintenance-started', {
                timestamp: Date.now(),
            });

            // Optimize database (VACUUM, ANALYZE)
            try {
                await this.database.execute('VACUUM');
                await this.database.execute('ANALYZE');
                results.databaseOptimized = true;
            } catch (error) {
                console.warn('Database optimization failed:', error);
            }

            // Clean up expired cache entries
            try {
                await this.cache.clear(); // For now, just clear all
                results.cachesCleaned = true;
            } catch (error) {
                console.warn('Cache cleanup failed:', error);
            }

            // Purge old analytics data (keep last 30 days)
            try {
                const cutoffTime = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // 30 days ago
                await this.database.execute('DELETE FROM usage_events WHERE timestamp < ?', [cutoffTime]);
                await this.database.execute('DELETE FROM performance_metrics WHERE timestamp < ?', [cutoffTime]);
                results.oldDataPurged = true;
            } catch (error) {
                console.warn('Old data purge failed:', error);
            }

            results.duration = Date.now() - startTime;

            this.eventBus.emit('shared-services:maintenance-completed', {
                results,
                timestamp: Date.now(),
            });

            return results;
        } catch (error) {
            results.duration = Date.now() - startTime;

            this.eventBus.emit('shared-services:maintenance-error', {
                results,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });

            throw new CoreError(
                `Maintenance failed: ${error instanceof Error ? error.message : String(error)}`,
                'MAINTENANCE_ERROR'
            );
        }
    }

    private resolveDatabasePath(config: CoreConfig): string {
        // Prefer explicit shared DB config (learning/pipelines/monitoring).
        if (config.database?.path) {
            return config.database.path;
        }

        // Fallback to a local default (separate from Layer 4 storage).
        return path.join(process.cwd(), '.ontology', 'ontology.db');
    }

    private setupEventHandling(): void {
        // Set up cross-service event handlers for better observability

        // Database events
        this.eventBus.on('database-service:query-error', (data: any) => {
            this.monitoring.recordError('database', data.error, data.timestamp);
        });

        // Cache events
        this.eventBus.on('cache-service:hit', (data: any) => {
            this.monitoring.recordCacheHit(data.key, data.source, data.timestamp);
        });

        this.eventBus.on('cache-service:miss', (data: any) => {
            this.monitoring.recordCacheMiss(data.key, data.timestamp);
        });

        // General error handling
        this.eventBus.on('shared-services:error', (data: any) => {
            console.error('SharedServices error:', data);
        });

        // Layer performance -> Monitoring bridge
        this.eventBus.on('layer-manager:performance-recorded', (data: any) => {
            try {
                this.monitoring.recordPerformance(data);
            } catch {}
        });

        // CodeAnalyzer fast-path performance bridge (e.g., layer1 async, layer2 AST quick pass)
        this.eventBus.on('code-analyzer:performance-recorded', (data: any) => {
            try {
                this.monitoring.recordPerformance(data);
            } catch {}
        });

        // Persist monitoring snapshots to SQLite for rolling windows
        this.eventBus.on('monitoring-service:metrics-report', async (payload: any) => {
            try {
                const s = payload?.summary || {};
                // Insert snapshot
                await this.database.execute(
                    `INSERT INTO monitoring_snapshots (ts, request_count, average_latency, p95_latency, p99_latency, error_rate, cache_hit_rate)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        Date.now(),
                        s.requestCount || 0,
                        s.averageLatency || 0,
                        s.p95Latency || 0,
                        s.p99Latency || 0,
                        s.errorRate || 0,
                        s.cacheHitRate || 0,
                    ]
                );
                // Retention: keep last 200 rows
                await this.database.execute(
                    `DELETE FROM monitoring_snapshots WHERE id NOT IN (SELECT id FROM monitoring_snapshots ORDER BY ts DESC LIMIT 200)`
                );
            } catch (err) {
                // Non-fatal
                // eslint-disable-next-line no-console
                console.warn('Failed to persist monitoring snapshot:', err);
            }
        });

        // Health monitoring
        if (this.config?.monitoring?.enabled) {
            this.healthCheckTimer = setInterval(
                () => {
                    this.eventBus.emit('shared-services:health-check', {
                        healthy: this.isHealthy(),
                        timestamp: Date.now(),
                    });
                },
                (this.config as any)?.performance?.healthCheckInterval || 30000
            ); // Every 30 seconds
            this.healthCheckTimer?.unref?.();
        }
    }
}
