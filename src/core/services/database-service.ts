/**
 * DatabaseService - Unified database layer using Bun's native SQLite
 * Provides schema management, connection pooling, and query optimization
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { CoreError, type EventBus } from '../types.js';

export interface DatabaseConfig {
    path: string;
    maxConnections?: number;
    busyTimeout?: number;
    enableWAL?: boolean;
    enableForeignKeys?: boolean;
}

const isMemoryDbPath = (dbPath: string): boolean => {
    if (dbPath === ':memory:') return true;
    // SQLite URI filenames: file::memory:?cache=shared&mode=memory
    if (dbPath.startsWith('file:') && dbPath.includes('mode=memory')) return true;
    return false;
};

/**
 * Database schema definitions for the unified system
 */
const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Patterns table
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  from_pattern TEXT NOT NULL, -- JSON representation
  to_pattern TEXT NOT NULL,   -- JSON representation
  confidence REAL NOT NULL DEFAULT 0.0,
  occurrences INTEGER DEFAULT 1,
  category TEXT NOT NULL,
  last_applied INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  examples TEXT -- JSON array of examples
);

-- Usage analytics table
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  language TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  latency INTEGER, -- milliseconds
  cache_hit INTEGER DEFAULT 0,
  user_id TEXT,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Legacy learning feedback table. Kept for backward compatibility with older
-- callers that only modeled accept/reject feedback.
CREATE TABLE IF NOT EXISTS learning_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  accepted INTEGER NOT NULL,
  suggestion TEXT, -- Allow NULL suggestions
  actual_choice TEXT,
  confidence REAL,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Full-fidelity feedback event table used by FeedbackLoopSystem.
CREATE TABLE IF NOT EXISTS feedback_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  suggestion_id TEXT NOT NULL,
  pattern_id TEXT,
  original_suggestion TEXT NOT NULL,
  final_value TEXT,
  file_path TEXT NOT NULL,
  operation TEXT NOT NULL,
  user_id TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'unknown',
  time_to_decision INTEGER,
  keystrokes INTEGER,
  alternatives_shown INTEGER,
  timestamp INTEGER NOT NULL
);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  operation TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  duration INTEGER NOT NULL, -- milliseconds
  cache_hit INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Learning system tables
-- Code evolution events table
CREATE TABLE IF NOT EXISTS evolution_events (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'unknown',
  type TEXT NOT NULL DEFAULT 'unknown', -- Add legacy 'type' column for compatibility
  change_summary TEXT,
  impact_score REAL NOT NULL DEFAULT 0.0,
  architectural_impact TEXT,
  commit_hash TEXT,
  author TEXT,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  metadata TEXT, -- JSON metadata
  -- Additional columns for evolution tracker compatibility
  before_path TEXT,
  before_content TEXT,
  before_signature TEXT,
  after_path TEXT,
  after_content TEXT,
  after_signature TEXT,
  branch TEXT,
  message TEXT,
  files_affected INTEGER DEFAULT 0,
  symbols_affected INTEGER DEFAULT 0,
  tests_affected INTEGER DEFAULT 0,
  severity TEXT DEFAULT 'low',
  diff_size INTEGER DEFAULT 0,
  cycle_time INTEGER,
  rollback BOOLEAN DEFAULT FALSE,
  automated BOOLEAN DEFAULT FALSE
);

-- Team knowledge table for shared patterns
CREATE TABLE IF NOT EXISTS team_knowledge (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  pattern_id TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  validation_feedback TEXT,
  adoption_count INTEGER DEFAULT 0,
  confidence_vote REAL,
  shared_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  validated_at INTEGER,
  last_used INTEGER,
  expertise_score REAL DEFAULT 0.0
);

-- Learning pipeline executions table
CREATE TABLE IF NOT EXISTS learning_pipeline_executions (
  id TEXT PRIMARY KEY,
  pipeline_type TEXT NOT NULL,
  input_data TEXT NOT NULL, -- JSON
  execution_status TEXT NOT NULL DEFAULT 'pending',
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration INTEGER,
  error_message TEXT,
  results TEXT, -- JSON
  confidence_scores TEXT -- JSON
);

-- Feedback corrections table for detailed learning
CREATE TABLE IF NOT EXISTS feedback_corrections (
  id TEXT PRIMARY KEY,
  original_feedback_id INTEGER NOT NULL,
  correction_type TEXT NOT NULL,
  original_suggestion TEXT NOT NULL,
  corrected_suggestion TEXT NOT NULL,
  correction_context TEXT,
  learning_weight REAL NOT NULL DEFAULT 1.0,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (original_feedback_id) REFERENCES learning_feedback (id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns (category);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns (confidence);

CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events (event_type);
CREATE INDEX IF NOT EXISTS idx_usage_events_identifier ON usage_events (identifier);
CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events (timestamp);

CREATE INDEX IF NOT EXISTS idx_feedback_request_id ON learning_feedback (request_id);
CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON learning_feedback (timestamp);
CREATE INDEX IF NOT EXISTS idx_feedback_events_type ON feedback_events (type);
CREATE INDEX IF NOT EXISTS idx_feedback_events_pattern_id ON feedback_events (pattern_id);
CREATE INDEX IF NOT EXISTS idx_feedback_events_timestamp ON feedback_events (timestamp);

CREATE INDEX IF NOT EXISTS idx_performance_layer ON performance_metrics (layer);
CREATE INDEX IF NOT EXISTS idx_performance_operation ON performance_metrics (operation);
CREATE INDEX IF NOT EXISTS idx_performance_timestamp ON performance_metrics (timestamp);

-- Learning system indexes
CREATE INDEX IF NOT EXISTS idx_evolution_events_file_path ON evolution_events (file_path);
CREATE INDEX IF NOT EXISTS idx_evolution_events_type ON evolution_events (event_type);
CREATE INDEX IF NOT EXISTS idx_evolution_events_timestamp ON evolution_events (timestamp);

CREATE INDEX IF NOT EXISTS idx_team_knowledge_member_id ON team_knowledge (member_id);
CREATE INDEX IF NOT EXISTS idx_team_knowledge_pattern_id ON team_knowledge (pattern_id);
CREATE INDEX IF NOT EXISTS idx_team_knowledge_status ON team_knowledge (validation_status);

CREATE INDEX IF NOT EXISTS idx_pipeline_executions_type ON learning_pipeline_executions (pipeline_type);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_status ON learning_pipeline_executions (execution_status);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_start_time ON learning_pipeline_executions (start_time);

CREATE INDEX IF NOT EXISTS idx_feedback_corrections_original_id ON feedback_corrections (original_feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_corrections_type ON feedback_corrections (correction_type);
CREATE INDEX IF NOT EXISTS idx_feedback_corrections_applied_at ON feedback_corrections (applied_at);

-- Monitoring snapshots (rolling window for dashboards)
CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  request_count INTEGER,
  average_latency REAL,
  p95_latency REAL,
  p99_latency REAL,
  error_rate REAL,
  cache_hit_rate REAL
);
CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_ts ON monitoring_snapshots (ts);

-- Learning pipelines (L5) - minimal persistence
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  components TEXT NOT NULL, -- JSON array of component keys
  trigger TEXT NOT NULL,    -- manual|automatic|scheduled|event_driven
  schedule TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT,              -- JSON for future use
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  metrics TEXT, -- JSON summary
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pipelines_trigger ON pipelines (trigger);
CREATE INDEX IF NOT EXISTS idx_pipelines_enabled ON pipelines (enabled);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs (status);
`;

/**
 * Connection pool for SQLite databases
 */
class ConnectionPool {
    private connections: Database[] = [];
    private maxConnections: number;
    private activeConnections = 0;
    private waitQueue: Array<{
        resolve: (db: Database) => void;
        reject: (error: Error) => void;
        timeoutId: NodeJS.Timeout;
    }> = [];

    constructor(dbPath: string, maxConnections: number = 10) {
        this.maxConnections = maxConnections;

        // Pre-create connections with optimized settings
        for (let i = 0; i < maxConnections; i++) {
            try {
                const db = new Database(dbPath);

                // Configure each connection for optimal concurrency
                db.exec('PRAGMA busy_timeout = 30000');
                db.exec('PRAGMA synchronous = NORMAL');
                db.exec('PRAGMA cache_size = -8000'); // 8MB cache per connection
                db.exec('PRAGMA temp_store = MEMORY');

                this.connections.push(db);
            } catch (error) {
                console.error(`Failed to create database connection ${i}:`, error);
                break;
            }
        }
    }

    async acquire(): Promise<Database> {
        if (this.connections.length > 0) {
            const db = this.connections.pop()!;
            this.activeConnections++;
            return db;
        }

        // Wait for a connection to become available
        return new Promise((resolve, reject) => {
            const waiter = {
                resolve,
                reject,
                timeoutId: setTimeout(() => {
                    const index = this.waitQueue.indexOf(waiter);
                    if (index !== -1) {
                        this.waitQueue.splice(index, 1);
                        reject(new CoreError('Database connection timeout', 'DB_TIMEOUT'));
                    }
                }, 5000), // 5 second timeout
            };

            this.waitQueue.push(waiter);
        });
    }

    release(db: Database): void {
        this.activeConnections--;

        if (this.waitQueue.length > 0) {
            const waiter = this.waitQueue.shift()!;
            clearTimeout(waiter.timeoutId);
            this.activeConnections++;
            waiter.resolve(db);
        } else {
            this.connections.push(db);
        }
    }

    async dispose(): Promise<void> {
        // Close all connections
        for (const db of this.connections) {
            try {
                db.close();
            } catch (error) {
                console.error('Error closing database connection:', error);
            }
        }
        this.connections.length = 0;

        // Reject any waiting requests
        for (const waiter of this.waitQueue) {
            clearTimeout(waiter.timeoutId);
            waiter.reject(new CoreError('Database service shutting down', 'DB_SHUTDOWN'));
        }
        this.waitQueue.length = 0;
    }

    getStats(): {
        maxConnections: number;
        availableConnections: number;
        activeConnections: number;
        waitingRequests: number;
    } {
        return {
            maxConnections: this.maxConnections,
            availableConnections: this.connections.length,
            activeConnections: this.activeConnections,
            waitingRequests: this.waitQueue.length,
        };
    }
}

/**
 * Unified database service using Bun's native SQLite
 */
export class DatabaseService {
    private pool?: ConnectionPool;
    private config: DatabaseConfig;
    private eventBus: EventBus;
    private initialized = false;
    private schemaVersion = 0;

    constructor(config: DatabaseConfig, eventBus: EventBus) {
        this.config = config;
        this.eventBus = eventBus;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            const isMemory = isMemoryDbPath(this.config.path);

            // Ensure directory exists (skip for in-memory)
            if (!isMemory) {
                const dbDir = path.dirname(this.config.path);
                if (!fs.existsSync(dbDir)) {
                    fs.mkdirSync(dbDir, { recursive: true });
                }
            }

            // Create connection pool
            const maxConnections = isMemory ? 1 : (this.config.maxConnections || 10);
            if (isMemory) {
                this.config.enableWAL = false;
            }
            this.pool = new ConnectionPool(this.config.path, maxConnections);

            // Initialize database schema
            await this.initializeSchema();

            this.initialized = true;

            this.eventBus.emit('database-service:initialized', {
                dbPath: this.config.path,
                schemaVersion: this.schemaVersion,
                timestamp: Date.now(),
            });
        } catch (error) {
            this.eventBus.emit('database-service:error', {
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        if (this.pool) {
            await this.pool.dispose();
            this.pool = undefined;
        }

        this.initialized = false;

        this.eventBus.emit('database-service:disposed', {
            timestamp: Date.now(),
        });
    }

    async close(): Promise<void> {
        await this.dispose();
    }

    /**
     * Execute a query with automatic connection management and retry logic
     */
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
        if (!this.initialized || !this.pool) {
            throw new CoreError('Database service not initialized', 'DB_NOT_INITIALIZED');
        }

        const maxRetries = 2; // Fewer retries for queries since they're typically faster
        let attempt = 0;

        while (attempt < maxRetries) {
            const db = await this.pool.acquire();

            try {
                // Set busy timeout for better concurrency handling
                db.exec('PRAGMA busy_timeout = 3000'); // 3 second timeout for queries

                const stmt = db.prepare(sql);
                const result = stmt.all(...params) as T[];

                this.pool.release(db);
                return result;
            } catch (error) {
                this.pool.release(db);

                const errorMessage = error instanceof Error ? error.message : String(error);
                const isRetryable =
                    errorMessage.includes('database is locked') ||
                    errorMessage.includes('SQLITE_BUSY') ||
                    errorMessage.includes('database is busy');

                attempt++;

                if (isRetryable && attempt < maxRetries) {
                    // Short delay for query retries
                    const delay = 5 * attempt + Math.random() * 5;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }

                this.eventBus.emit('database-service:query-error', {
                    sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
                    error: errorMessage,
                    attempt,
                    retryable: isRetryable,
                    timestamp: Date.now(),
                });

                throw new CoreError(
                    `Database query failed after ${attempt} attempts: ${errorMessage}`,
                    'DB_QUERY_ERROR'
                );
            }
        }

        throw new CoreError('Database query failed: max retries exceeded', 'DB_QUERY_ERROR');
    }

    /**
     * Execute a single query and return first result
     */
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
        const results = await this.query<T>(sql, params);
        return results.length > 0 ? results[0] : null;
    }

    /**
     * Execute a query that doesn't return data (INSERT, UPDATE, DELETE) with retry logic
     */
    async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
        if (!this.initialized || !this.pool) {
            throw new CoreError('Database service not initialized', 'DB_NOT_INITIALIZED');
        }

        const maxRetries = 3;
        let attempt = 0;

        while (attempt < maxRetries) {
            const db = await this.pool.acquire();

            try {
                // Set busy timeout for better concurrency handling
                db.exec('PRAGMA busy_timeout = 5000'); // 5 second timeout

                const stmt = db.prepare(sql);
                const result = stmt.run(...params);

                this.pool.release(db);
                return {
                    changes: result.changes,
                    lastInsertRowid: Number(result.lastInsertRowid),
                };
            } catch (error) {
                this.pool.release(db);

                const errorMessage = error instanceof Error ? error.message : String(error);
                const isRetryable =
                    errorMessage.includes('database is locked') ||
                    errorMessage.includes('SQLITE_BUSY') ||
                    errorMessage.includes('database is busy') ||
                    (errorMessage.includes('FOREIGN KEY constraint') && attempt === 0);

                attempt++;

                if (isRetryable && attempt < maxRetries) {
                    // Reduced backoff with jitter for faster retries
                    const delay = Math.min(10 * 2 ** attempt + Math.random() * 10, 250);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }

                this.eventBus.emit('database-service:execute-error', {
                    sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
                    error: errorMessage,
                    attempt,
                    retryable: isRetryable,
                    timestamp: Date.now(),
                });

                throw new CoreError(
                    `Database execute failed after ${attempt} attempts: ${errorMessage}`,
                    'DB_EXECUTE_ERROR'
                );
            }
        }

        throw new CoreError('Database execute failed: max retries exceeded', 'DB_EXECUTE_ERROR');
    }

    /**
     * Execute multiple queries in a transaction with retry logic and proper isolation
     */
    async transaction<T>(callback: (query: (sql: string, params?: any[]) => Promise<any>) => Promise<T>): Promise<T> {
        if (!this.initialized || !this.pool) {
            throw new CoreError('Database service not initialized', 'DB_NOT_INITIALIZED');
        }

        const maxRetries = 3;
        let attempt = 0;

        while (attempt < maxRetries) {
            const db = await this.pool.acquire();
            let transactionStarted = false;

            try {
                // Set busy timeout and isolation level for better concurrency
                db.exec('PRAGMA busy_timeout = 10000'); // 10 second timeout
                db.exec('PRAGMA synchronous = NORMAL'); // Faster than FULL sync
                db.exec('PRAGMA cache_size = -16000'); // 16MB cache for better performance

                // Start transaction with deferred mode for better concurrency
                db.exec('BEGIN DEFERRED TRANSACTION');
                transactionStarted = true;

                const transactionQuery = async (sql: string, params: any[] = []) => {
                    const stmt = db.prepare(sql);
                    if (sql.trim().toUpperCase().startsWith('SELECT')) {
                        return stmt.all(...params);
                    } else {
                        return stmt.run(...params);
                    }
                };

                const result = await callback(transactionQuery);

                // Commit transaction
                db.exec('COMMIT');

                this.pool.release(db);
                return result;
            } catch (error) {
                // Rollback on error if transaction was started
                if (transactionStarted) {
                    try {
                        db.exec('ROLLBACK');
                    } catch (rollbackError) {
                        console.error('Rollback failed:', rollbackError);
                    }
                }

                this.pool.release(db);

                // Check if this is a retryable error
                const errorMessage = error instanceof Error ? error.message : String(error);
                const isRetryable =
                    errorMessage.includes('database is locked') ||
                    errorMessage.includes('SQLITE_BUSY') ||
                    errorMessage.includes('database is busy');

                attempt++;

                if (isRetryable && attempt < maxRetries) {
                    // Reduced backoff with jitter for faster retries
                    const delay = Math.min(25 * 2 ** attempt + Math.random() * 25, 500);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }

                this.eventBus.emit('database-service:transaction-error', {
                    error: errorMessage,
                    attempt,
                    retryable: isRetryable,
                    timestamp: Date.now(),
                });

                throw new CoreError(
                    `Database transaction failed after ${attempt} attempts: ${errorMessage}`,
                    'DB_TRANSACTION_ERROR'
                );
            }
        }

        throw new CoreError('Database transaction failed: max retries exceeded', 'DB_TRANSACTION_ERROR');
    }

    private async initializeSchema(): Promise<void> {
        if (!this.pool) {
            throw new CoreError('Connection pool not available', 'DB_POOL_ERROR');
        }

        const db = await this.pool.acquire();

        try {
            // Configure SQLite for better performance and concurrency
            if (this.config.enableWAL !== false) {
                try {
                    db.exec('PRAGMA journal_mode = WAL');
                } catch (e) {
                    // Fall back to non-WAL journaling on filesystems/environments where WAL can be flaky.
                    try {
                        db.exec('PRAGMA journal_mode = DELETE');
                    } catch {}
                    this.config.enableWAL = false;
                    this.eventBus.emit('database-service:wal-disabled', {
                        error: e instanceof Error ? e.message : String(e),
                        timestamp: Date.now(),
                    });
                }
            }
            // Temporarily disable foreign keys during schema creation
            db.exec('PRAGMA foreign_keys = OFF');

            if (this.config.busyTimeout) {
                db.exec(`PRAGMA busy_timeout = ${this.config.busyTimeout}`);
            } else {
                db.exec('PRAGMA busy_timeout = 30000'); // Default 30 second timeout
            }

            // Additional performance settings
            db.exec('PRAGMA synchronous = NORMAL'); // Better performance than FULL
            db.exec('PRAGMA cache_size = -64000'); // 64MB cache
            db.exec('PRAGMA temp_store = MEMORY'); // Store temp tables in memory

            // Execute schema SQL
            db.exec(SCHEMA_SQL);

            // Lightweight migrations for backward compatibility
            try {
                // Ensure patterns.examples column exists (older DBs may miss it)
                const patternCols = db.prepare("PRAGMA table_info('patterns')").all() as Array<{ name: string }>;
                const hasExamples =
                    Array.isArray(patternCols) && patternCols.some((c) => (c as any).name === 'examples');
                if (!hasExamples) {
                    db.exec('ALTER TABLE patterns ADD COLUMN examples TEXT');
                }
            } catch (migErr) {
                // Non-fatal: log and continue; future schema runs may fix it
                console.warn('DatabaseService: schema compatibility check failed:', migErr);
            }

            // Re-enable foreign keys after schema creation
            if (this.config.enableForeignKeys !== false) {
                db.exec('PRAGMA foreign_keys = ON');
            }

            // Check/update schema version
            const versionResult = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
                version: number | null;
            };
            this.schemaVersion = versionResult.version || 0;

            if (this.schemaVersion < SCHEMA_VERSION) {
                // Insert new schema version
                db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
                this.schemaVersion = SCHEMA_VERSION;
            }
        } catch (error) {
            throw new CoreError(
                `Schema initialization failed: ${error instanceof Error ? error.message : String(error)}`,
                'DB_SCHEMA_ERROR'
            );
        } finally {
            this.pool.release(db);
        }
    }

    /**
     * Get database statistics and health information
     */
    async getStats(): Promise<{
        schemaVersion: number;
        connectionPool: any;
        tableStats: Record<string, number>;
        dbSize: number;
    }> {
        const tableStats: Record<string, number> = {};

        // Get row counts for main tables
        const tables = [
            'patterns',
            'usage_events',
            'learning_feedback',
            'performance_metrics',
            'evolution_events',
            'team_knowledge',
            'learning_pipeline_executions',
            'feedback_corrections',
            'pipelines',
            'pipeline_runs',
        ];

        for (const table of tables) {
            try {
                const result = await this.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
                tableStats[table] = result?.count || 0;
            } catch (error) {
                tableStats[table] = -1; // Error indicator
            }
        }

        // Get database file size
        let dbSize = 0;
        try {
            const stats = fs.statSync(this.config.path);
            dbSize = stats.size;
        } catch (error) {
            // File might not exist yet
        }

        return {
            schemaVersion: this.schemaVersion,
            connectionPool: this.pool?.getStats() || {},
            tableStats,
            dbSize,
        };
    }

    isHealthy(): boolean {
        return this.initialized && !!this.pool;
    }

    /**
     * Ensure a record exists before inserting a child record with FOREIGN KEY constraint
     */
    async ensureRecordExists(
        table: string,
        idColumn: string,
        id: string,
        defaultRecord?: Record<string, any>
    ): Promise<boolean> {
        try {
            const existing = await this.queryOne(`SELECT ${idColumn} FROM ${table} WHERE ${idColumn} = ?`, [id]);

            if (!existing && defaultRecord) {
                // Insert default record if provided
                const columns = Object.keys(defaultRecord);
                const placeholders = columns.map(() => '?').join(', ');
                const values = Object.values(defaultRecord);

                await this.execute(
                    `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
                    values
                );
                return true;
            }

            return !!existing;
        } catch (error) {
            console.warn(`Failed to ensure record exists in ${table}:`, error);
            return false;
        }
    }

    /**
     * Insert record with FOREIGN KEY constraint validation
     */
    async insertWithConstraintValidation(
        table: string,
        data: Record<string, any>,
        foreignKeys?: Array<{ table: string; column: string; value: any; defaultRecord?: Record<string, any> }>
    ): Promise<{ changes: number; lastInsertRowid: number }> {
        // Validate FOREIGN KEY constraints first
        if (foreignKeys) {
            for (const fk of foreignKeys) {
                if (fk.value !== null && fk.value !== undefined) {
                    const exists = await this.ensureRecordExists(fk.table, fk.column, fk.value, fk.defaultRecord);
                    if (!exists && !fk.defaultRecord) {
                        throw new CoreError(
                            `FOREIGN KEY constraint would fail: ${fk.table}.${fk.column} = ${fk.value} does not exist`,
                            'FK_CONSTRAINT_ERROR'
                        );
                    }
                }
            }
        }

        // Proceed with insert
        const columns = Object.keys(data);
        const placeholders = columns.map(() => '?').join(', ');
        const values = Object.values(data);

        return await this.execute(
            `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
            values
        );
    }

    /**
     * Execute transaction with constraint validation
     */
    async transactionWithConstraintValidation<T>(
        callback: (
            query: (sql: string, params?: any[]) => Promise<any>,
            insertSafe: (
                table: string,
                data: Record<string, any>,
                foreignKeys?: Array<{ table: string; column: string; value: any; defaultRecord?: Record<string, any> }>
            ) => Promise<any>
        ) => Promise<T>
    ): Promise<T> {
        return await this.transaction(async (query) => {
            const insertSafe = async (
                table: string,
                data: Record<string, any>,
                foreignKeys?: Array<{ table: string; column: string; value: any; defaultRecord?: Record<string, any> }>
            ) => {
                // Validate FOREIGN KEY constraints within transaction
                if (foreignKeys) {
                    for (const fk of foreignKeys) {
                        if (fk.value !== null && fk.value !== undefined) {
                            const existing = await query(
                                `SELECT ${fk.column} FROM ${fk.table} WHERE ${fk.column} = ?`,
                                [fk.value]
                            );

                            if ((!existing || existing.length === 0) && fk.defaultRecord) {
                                // Insert default record if provided
                                const columns = Object.keys(fk.defaultRecord);
                                const placeholders = columns.map(() => '?').join(', ');
                                const values = Object.values(fk.defaultRecord);

                                await query(
                                    `INSERT OR IGNORE INTO ${fk.table} (${columns.join(', ')}) VALUES (${placeholders})`,
                                    values
                                );
                            }
                        }
                    }
                }

                // Proceed with insert
                const columns = Object.keys(data);
                const placeholders = columns.map(() => '?').join(', ');
                const values = Object.values(data);

                return await query(
                    `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
                    values
                );
            };

            return await callback(query, insertSafe);
        });
    }

    getDiagnostics(): Record<string, any> {
        return {
            initialized: this.initialized,
            config: this.config,
            schemaVersion: this.schemaVersion,
            connectionPool: this.pool?.getStats(),
            healthy: this.isHealthy(),
            timestamp: Date.now(),
        };
    }
}
