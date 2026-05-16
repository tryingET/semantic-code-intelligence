/**
 * File-based logging system for MCP server debugging
 *
 * This logger writes to disk files to avoid polluting stdio streams
 * which are used for MCP protocol communication.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface LogEntry {
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    component: string;
    message: string;
    data?: any;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}

export interface FileLoggerConfig {
    logDir: string;
    maxFileSize: number; // in bytes
    maxFiles: number;
    enableConsole: boolean; // for non-stdio modes
}

export class FileLogger {
    private config: FileLoggerConfig;
    private currentLogFile: string;

    constructor(config: Partial<FileLoggerConfig> = {}) {
        this.config = {
            logDir: process.env.MCP_LOG_DIR || join(process.cwd(), '.ontology', 'logs'),
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            enableConsole: !process.env.STDIO_MODE && !process.env.SILENT_MODE,
            ...config,
        };

        // Ensure log directory exists
        this.ensureLogDir();

        // Set current log file
        this.currentLogFile = join(this.config.logDir, `mcp-server-${new Date().toISOString().split('T')[0]}.log`);

        // Rotate logs if needed
        this.rotateLogs();
    }

    private ensureLogDir(): void {
        try {
            if (!existsSync(this.config.logDir)) {
                mkdirSync(this.config.logDir, { recursive: true });
            }
        } catch (error) {
            // Fallback to current directory if can't create log dir
            this.config.logDir = process.cwd();
        }
    }

    private rotateLogs(): void {
        try {
            if (existsSync(this.currentLogFile)) {
                const stats = require('fs').statSync(this.currentLogFile);
                if (stats.size > this.config.maxFileSize) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const rotatedFile = this.currentLogFile.replace('.log', `-${timestamp}.log`);
                    require('fs').renameSync(this.currentLogFile, rotatedFile);
                }
            }
        } catch (error) {
            // Ignore rotation errors - we'll overwrite the file instead
        }
    }

    private formatLogEntry(entry: LogEntry): string {
        const baseEntry = {
            timestamp: entry.timestamp,
            level: entry.level,
            component: entry.component,
            message: entry.message,
        };

        if (entry.data) {
            return JSON.stringify({ ...baseEntry, data: entry.data }) + '\n';
        }

        if (entry.error) {
            return JSON.stringify({ ...baseEntry, error: entry.error }) + '\n';
        }

        return JSON.stringify(baseEntry) + '\n';
    }

    private writeToFile(entry: LogEntry): void {
        try {
            const logLine = this.formatLogEntry(entry);
            appendFileSync(this.currentLogFile, logLine, 'utf8');
        } catch (error) {
            // Fallback to console if file writing fails
            if (this.config.enableConsole) {
                console.error('Failed to write to log file:', error);
                console.error('Original log entry:', entry);
            }
        }
    }

    private writeToConsole(entry: LogEntry): void {
        if (!this.config.enableConsole || process.env.STDIO_MODE || process.env.SILENT_MODE) return;

        const message = `[${entry.level.toUpperCase()}] ${entry.component}: ${entry.message}`;

        switch (entry.level) {
            case 'error':
                console.error(message, entry.error || entry.data || '');
                break;
            case 'warn':
                console.warn(message, entry.data || '');
                break;
            case 'info':
                console.info(message, entry.data || '');
                break;
            case 'debug':
                if (process.env.DEBUG) {
                    console.log(message, entry.data || '');
                }
                break;
        }
    }

    debug(component: string, message: string, data?: any): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'debug',
            component,
            message,
            data,
        };

        this.writeToFile(entry);
        this.writeToConsole(entry);
    }

    info(component: string, message: string, data?: any): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'info',
            component,
            message,
            data,
        };

        this.writeToFile(entry);
        this.writeToConsole(entry);
    }

    warn(component: string, message: string, data?: any): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'warn',
            component,
            message,
            data,
        };

        this.writeToFile(entry);
        this.writeToConsole(entry);
    }

    error(component: string, message: string, error?: Error | any, data?: any): void {
        const errorInfo =
            error instanceof Error
                ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                  }
                : undefined;

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'error',
            component,
            message,
            error: errorInfo,
            data,
        };

        this.writeToFile(entry);
        this.writeToConsole(entry);
    }

    // Log MCP protocol messages for debugging
    logMCPMessage(direction: 'incoming' | 'outgoing', message: any): void {
        this.debug('MCP-Protocol', `${direction} message`, {
            type: message?.method || message?.result ? 'request/response' : 'unknown',
            method: message?.method,
            id: message?.id,
            hasError: !!message?.error,
            messageSize: JSON.stringify(message).length,
        });
    }

    // Log connection events
    logConnection(event: 'connect' | 'disconnect' | 'error', details?: any): void {
        if (event === 'error') {
            this.error('Connection', `Connection ${event}`, details);
        } else {
            this.info('Connection', `Connection ${event}`, details);
        }
    }

    // Log performance metrics
    logPerformance(operation: string, duration: number, success: boolean, details?: any): void {
        this.info('Performance', `${operation} completed in ${duration}ms`, {
            operation,
            duration,
            success,
            ...details,
        });
    }

    // Create a child logger for specific components
    child(component: string): ComponentLogger {
        return new ComponentLogger(this, component);
    }
}

// Component-specific logger that automatically includes component name
class ComponentLogger {
    constructor(
        private parent: FileLogger,
        private component: string
    ) {}

    debug(message: string, data?: any): void {
        this.parent.debug(this.component, message, data);
    }

    info(message: string, data?: any): void {
        this.parent.info(this.component, message, data);
    }

    warn(message: string, data?: any): void {
        this.parent.warn(this.component, message, data);
    }

    error(message: string, error?: Error | any, data?: any): void {
        this.parent.error(this.component, message, error, data);
    }

    logMCPMessage(direction: 'incoming' | 'outgoing', message: any): void {
        this.parent.logMCPMessage(direction, message);
    }

    logConnection(event: 'connect' | 'disconnect' | 'error', details?: any): void {
        this.parent.logConnection(event, details);
    }

    logPerformance(operation: string, duration: number, success: boolean, details?: any): void {
        this.parent.logPerformance(operation, duration, success, details);
    }
}

// Global logger instance
export const fileLogger = new FileLogger();

// Export component loggers for common components
export const mcpLogger = fileLogger.child('MCP-Server');
export const adapterLogger = fileLogger.child('MCP-Adapter');
export const coreLogger = fileLogger.child('Core-Analyzer');
