// Pattern Storage - Manages persistence of learned patterns
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import type { Example, Pattern, PatternCategory, TokenPattern } from '../types/core';

// Helper to remove undefined fields from an object
function pruneUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) cleaned[key] = value;
    }
    return cleaned as Partial<T>;
}

// Database row type interfaces
interface PatternRow {
    id: string;
    from_pattern: string;
    to_pattern: string;
    confidence: number;
    occurrences: number;
    category: string;
    last_applied: string;
    created_at: string;
    updated_at: string;
}

interface PatternExampleRow {
    id: number;
    pattern_id: string;
    old_name: string;
    new_name: string;
    confidence: number;
    context_data: string | null;
    created_at: string;
}

interface PatternMetricsRow {
    pattern_id: string;
    total_applications: number;
    successful_applications: number;
    average_confidence: number;
    last_success: string | null;
    last_failure: string | null;
}

interface GlobalStatsRow {
    total_patterns: number;
    total_applications: number;
    avg_success_rate: number;
}

interface TopPerformingPatternRow {
    pattern_id: string;
    category: string;
    success_rate: number;
    total_applications: number;
}

export class PatternStorage {
    private db: Database;

    constructor(private dbPath: string) {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.exec('PRAGMA journal_mode = WAL');
    }

    async initialize(): Promise<void> {
        this.createTables();
        this.createIndices();
    }

    private createTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS patterns (
                id TEXT PRIMARY KEY,
                from_pattern JSON NOT NULL,
                to_pattern JSON NOT NULL,
                confidence REAL NOT NULL,
                occurrences INTEGER NOT NULL DEFAULT 0,
                category TEXT NOT NULL,
                last_applied TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS pattern_examples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_id TEXT NOT NULL,
                old_name TEXT NOT NULL,
                new_name TEXT NOT NULL,
                confidence REAL NOT NULL,
                context_data JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS pattern_applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_id TEXT NOT NULL,
                original_identifier TEXT NOT NULL,
                suggested_identifier TEXT NOT NULL,
                applied BOOLEAN DEFAULT FALSE,
                feedback_positive BOOLEAN,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS pattern_metrics (
                pattern_id TEXT PRIMARY KEY,
                total_applications INTEGER DEFAULT 0,
                successful_applications INTEGER DEFAULT 0,
                average_confidence REAL DEFAULT 0.0,
                last_success TIMESTAMP,
                last_failure TIMESTAMP,
                FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
            );
        `);
    }

    private createIndices(): void {
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_patterns_category 
                ON patterns(category);
            CREATE INDEX IF NOT EXISTS idx_patterns_confidence 
                ON patterns(confidence);
            CREATE INDEX IF NOT EXISTS idx_patterns_occurrences 
                ON patterns(occurrences);
            CREATE INDEX IF NOT EXISTS idx_patterns_last_applied 
                ON patterns(last_applied);
            
            CREATE INDEX IF NOT EXISTS idx_examples_pattern_id 
                ON pattern_examples(pattern_id);
            CREATE INDEX IF NOT EXISTS idx_examples_old_name 
                ON pattern_examples(old_name);
            CREATE INDEX IF NOT EXISTS idx_examples_new_name 
                ON pattern_examples(new_name);
            
            CREATE INDEX IF NOT EXISTS idx_applications_pattern_id 
                ON pattern_applications(pattern_id);
            CREATE INDEX IF NOT EXISTS idx_applications_applied 
                ON pattern_applications(applied);
            CREATE INDEX IF NOT EXISTS idx_applications_timestamp 
                ON pattern_applications(timestamp);
        `);
    }

    async savePattern(pattern: Pattern): Promise<void> {
        const transaction = this.db.transaction(() => {
            // Insert or update pattern
            const patternStmt = this.db.prepare(`
                INSERT OR REPLACE INTO patterns 
                (id, from_pattern, to_pattern, confidence, occurrences, category, last_applied, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);

            patternStmt.run(
                pattern.id,
                JSON.stringify(pattern.from),
                JSON.stringify(pattern.to),
                pattern.confidence,
                pattern.occurrences,
                pattern.category,
                pattern.lastApplied.toISOString()
            );

            // Clear existing examples
            const clearExamplesStmt = this.db.prepare(`
                DELETE FROM pattern_examples WHERE pattern_id = ?
            `);
            clearExamplesStmt.run(pattern.id);

            // Insert examples
            const exampleStmt = this.db.prepare(`
                INSERT INTO pattern_examples 
                (pattern_id, old_name, new_name, confidence, context_data)
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const example of pattern.examples) {
                // Guard optional context/timestamp per NEXT_STEPS A1
                const ctx = (example as Partial<Example>).context as Partial<Example['context']> | undefined;
                const timestampISO =
                    (ctx?.timestamp instanceof Date ? ctx.timestamp : undefined)?.toISOString() ||
                    new Date(0).toISOString();

                const contextPayload = pruneUndefined({
                    file: typeof ctx?.file === 'string' ? ctx.file : undefined,
                    concept: ctx?.concept?.id,
                    surroundingSymbols: Array.isArray(ctx?.surroundingSymbols) ? ctx!.surroundingSymbols : undefined,
                    timestamp: timestampISO,
                });

                const contextJSON = Object.keys(contextPayload).length ? JSON.stringify(contextPayload) : null;

                exampleStmt.run(pattern.id, example.oldName, example.newName, example.confidence, contextJSON);
            }

            // Initialize or update metrics
            const metricsStmt = this.db.prepare(`
                INSERT OR IGNORE INTO pattern_metrics (pattern_id) VALUES (?)
            `);
            metricsStmt.run(pattern.id);
        });

        transaction();
    }

    async updatePattern(pattern: Pattern): Promise<void> {
        await this.savePattern(pattern); // Same logic for updates
    }

    async loadPattern(patternId: string): Promise<Pattern | null> {
        const patternRow = this.db
            .prepare(`
            SELECT * FROM patterns WHERE id = ?
        `)
            .get(patternId);

        if (!patternRow) {
            return null;
        }

        return this.deserializePattern(patternRow as PatternRow);
    }

    async loadAllPatterns(): Promise<Pattern[]> {
        const patternRows = this.db
            .prepare(`
            SELECT * FROM patterns 
            ORDER BY confidence DESC, occurrences DESC
        `)
            .all();

        const patterns: Pattern[] = [];

        for (const row of patternRows) {
            try {
                const pattern = await this.deserializePattern(row as PatternRow);
                if (pattern) {
                    patterns.push(pattern);
                }
            } catch (error) {
                console.warn(`Failed to deserialize pattern ${(row as PatternRow).id}:`, error);
            }
        }

        return patterns;
    }

    async loadPatternsByCategory(category: PatternCategory): Promise<Pattern[]> {
        const patternRows = this.db
            .prepare(`
            SELECT * FROM patterns 
            WHERE category = ?
            ORDER BY confidence DESC
        `)
            .all(category);

        const patterns: Pattern[] = [];

        for (const row of patternRows) {
            try {
                const pattern = await this.deserializePattern(row as PatternRow);
                if (pattern) {
                    patterns.push(pattern);
                }
            } catch (error) {
                console.warn(`Failed to deserialize pattern ${(row as PatternRow).id}:`, error);
            }
        }

        return patterns;
    }

    async deletePattern(patternId: string): Promise<void> {
        const transaction = this.db.transaction(() => {
            // Foreign key constraints will handle cascading deletes
            this.db.prepare(`DELETE FROM patterns WHERE id = ?`).run(patternId);
        });

        transaction();
    }

    async recordPatternApplication(
        patternId: string,
        originalIdentifier: string,
        suggestedIdentifier: string,
        applied: boolean = false
    ): Promise<void> {
        const stmt = this.db.prepare(`
            INSERT INTO pattern_applications 
            (pattern_id, original_identifier, suggested_identifier, applied)
            VALUES (?, ?, ?, ?)
        `);

        stmt.run(patternId, originalIdentifier, suggestedIdentifier, applied);

        // Update metrics
        await this.updatePatternMetrics(patternId, applied);
    }

    async recordPatternFeedback(applicationId: number, positive: boolean): Promise<void> {
        const stmt = this.db.prepare(`
            UPDATE pattern_applications 
            SET feedback_positive = ?
            WHERE id = ?
        `);

        stmt.run(positive, applicationId);
    }

    async getPatternMetrics(patternId: string): Promise<{
        totalApplications: number;
        successfulApplications: number;
        successRate: number;
        averageConfidence: number;
        lastSuccess?: Date;
        lastFailure?: Date;
    } | null> {
        const metricsRow = this.db
            .prepare(`
            SELECT * FROM pattern_metrics WHERE pattern_id = ?
        `)
            .get(patternId) as PatternMetricsRow | undefined;

        if (!metricsRow) {
            return null;
        }

        return {
            totalApplications: metricsRow.total_applications,
            successfulApplications: metricsRow.successful_applications,
            successRate:
                metricsRow.total_applications > 0
                    ? metricsRow.successful_applications / metricsRow.total_applications
                    : 0,
            averageConfidence: metricsRow.average_confidence,
            lastSuccess: metricsRow.last_success ? new Date(metricsRow.last_success) : undefined,
            lastFailure: metricsRow.last_failure ? new Date(metricsRow.last_failure) : undefined,
        };
    }

    async getGlobalStatistics(): Promise<{
        totalPatterns: number;
        totalApplications: number;
        averageSuccessRate: number;
        topPerformingPatterns: Array<{
            patternId: string;
            category: string;
            successRate: number;
            totalApplications: number;
        }>;
    }> {
        const statsRow = this.db
            .prepare(`
            SELECT 
                COUNT(*) as total_patterns,
                AVG(CAST(successful_applications AS REAL) / NULLIF(total_applications, 0)) as avg_success_rate,
                SUM(total_applications) as total_applications
            FROM pattern_metrics
        `)
            .get() as GlobalStatsRow;

        const topPerformingRows = this.db
            .prepare(`
            SELECT 
                pm.pattern_id,
                p.category,
                CAST(pm.successful_applications AS REAL) / NULLIF(pm.total_applications, 0) as success_rate,
                pm.total_applications
            FROM pattern_metrics pm
            JOIN patterns p ON pm.pattern_id = p.id
            WHERE pm.total_applications >= 3
            ORDER BY success_rate DESC, pm.total_applications DESC
            LIMIT 10
        `)
            .all();

        return {
            totalPatterns: statsRow.total_patterns || 0,
            totalApplications: statsRow.total_applications || 0,
            averageSuccessRate: statsRow.avg_success_rate || 0,
            topPerformingPatterns: topPerformingRows.map((row) => ({
                patternId: (row as TopPerformingPatternRow).pattern_id,
                category: (row as TopPerformingPatternRow).category,
                successRate: (row as TopPerformingPatternRow).success_rate || 0,
                totalApplications: (row as TopPerformingPatternRow).total_applications,
            })),
        };
    }

    private async updatePatternMetrics(patternId: string, successful: boolean): Promise<void> {
        const updateStmt = this.db.prepare(`
            UPDATE pattern_metrics 
            SET 
                total_applications = total_applications + 1,
                successful_applications = successful_applications + ?,
                last_success = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_success END,
                last_failure = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_failure END
            WHERE pattern_id = ?
        `);

        updateStmt.run(successful ? 1 : 0, successful, !successful, patternId);

        // Update average confidence
        const avgStmt = this.db.prepare(`
            UPDATE pattern_metrics 
            SET average_confidence = (
                SELECT AVG(confidence) 
                FROM pattern_examples 
                WHERE pattern_id = ?
            )
            WHERE pattern_id = ?
        `);

        avgStmt.run(patternId, patternId);
    }

    private async deserializePattern(row: PatternRow): Promise<Pattern | null> {
        try {
            // Load examples
            const exampleRows = this.db
                .prepare(`
                SELECT * FROM pattern_examples WHERE pattern_id = ?
                ORDER BY created_at DESC
            `)
                .all(row.id);

            const examples: Example[] = exampleRows.map((exRow) => {
                const typedExRow = exRow as PatternExampleRow;
                const contextData = JSON.parse(typedExRow.context_data || '{}') || {};
                const ts = contextData.timestamp ? new Date(contextData.timestamp) : new Date(0);

                return {
                    oldName: typedExRow.old_name,
                    newName: typedExRow.new_name,
                    confidence: typedExRow.confidence,
                    context: {
                        file: contextData.file || '',
                        concept: contextData.concept ? { id: contextData.concept } : undefined,
                        surroundingSymbols: contextData.surroundingSymbols || [],
                        // Default to epoch when missing to satisfy determinism
                        timestamp: ts,
                    },
                } as Example;
            });

            return {
                id: row.id,
                from: JSON.parse(row.from_pattern) as TokenPattern[],
                to: JSON.parse(row.to_pattern) as TokenPattern[],
                confidence: row.confidence,
                occurrences: row.occurrences,
                examples,
                lastApplied: new Date(row.last_applied),
                category: row.category as PatternCategory,
            };
        } catch (error) {
            console.error(`Failed to deserialize pattern ${row.id}:`, error);
            return null;
        }
    }

    // Maintenance and cleanup methods

    async cleanupOldPatterns(olderThanDays: number = 365): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

        const deleteStmt = this.db.prepare(`
            DELETE FROM patterns 
            WHERE last_applied < ? AND occurrences < 5 AND confidence < 0.5
        `);

        const result = deleteStmt.run(cutoffDate.toISOString());
        return result.changes;
    }

    async optimizeDatabase(): Promise<void> {
        // Remove patterns with very low success rates
        const lowSuccessStmt = this.db.prepare(`
            DELETE FROM patterns 
            WHERE id IN (
                SELECT pm.pattern_id 
                FROM pattern_metrics pm
                WHERE pm.total_applications >= 10 
                AND CAST(pm.successful_applications AS REAL) / pm.total_applications < 0.1
            )
        `);

        lowSuccessStmt.run();

        // Vacuum and analyze
        this.db.exec('VACUUM');
        this.db.exec('ANALYZE');
    }

    async backup(backupPath: string): Promise<void> {
        await this.db.backup(backupPath);
    }

    async close(): Promise<void> {
        this.db.close();
    }
}
