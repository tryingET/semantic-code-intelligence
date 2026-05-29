/**
 * Connection state management for MCP servers
 *
 * Handles connection lifecycle, state tracking, and recovery
 * for both stdio and HTTP (Streamable) transports.
 */

import { type ErrorContext, globalErrorHandler } from './error-handler.js';
import { fileLogger, mcpLogger } from './file-logger.js';

export interface ConnectionConfig {
    heartbeatInterval: number; // milliseconds
    connectionTimeout: number; // milliseconds
    maxReconnectAttempts: number;
    reconnectBackoff: number; // milliseconds
    enableHeartbeat: boolean;
    installProcessHandlers: boolean;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ConnectionMetrics {
    connectionCount: number;
    lastConnected: number | null;
    lastDisconnected: number | null;
    totalUptime: number; // milliseconds
    reconnectAttempts: number;
    messagesReceived: number;
    messagesSent: number;
    errors: number;
}

export interface ConnectionEventData {
    state: ConnectionState;
    previousState: ConnectionState;
    timestamp: number;
    error?: Error;
    metadata?: any;
}

export type ConnectionEventHandler = (event: ConnectionEventData) => void;

export class ConnectionManager {
    private state: ConnectionState = 'disconnected';
    private config: ConnectionConfig;
    private metrics: ConnectionMetrics;
    private eventHandlers: ConnectionEventHandler[] = [];
    private heartbeatTimer?: NodeJS.Timeout;
    private connectionTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private stateChangeTimestamp = Date.now();

    constructor(config: Partial<ConnectionConfig> = {}) {
        this.config = {
            heartbeatInterval: 30000, // 30 seconds
            connectionTimeout: 10000, // 10 seconds
            maxReconnectAttempts: 5,
            reconnectBackoff: 2000, // 2 seconds
            enableHeartbeat: false, // Disabled for stdio
            installProcessHandlers: false,
            ...config,
        };

        this.metrics = {
            connectionCount: 0,
            lastConnected: null,
            lastDisconnected: null,
            totalUptime: 0,
            reconnectAttempts: 0,
            messagesReceived: 0,
            messagesSent: 0,
            errors: 0,
        };

        if (this.config.installProcessHandlers) {
            this.setupShutdownHandlers();
        }
    }

    /**
     * Initialize connection
     */
    async connect(metadata?: any): Promise<void> {
        const context: ErrorContext = {
            component: 'ConnectionManager',
            operation: 'connect',
            timestamp: Date.now(),
        };

        await globalErrorHandler.withErrorHandling(context, async () => {
            this.setState('connecting', undefined, metadata);

            // Set connection timeout
            this.connectionTimer = setTimeout(() => {
                if (this.state === 'connecting') {
                    const error = new Error(`Connection timeout after ${this.config.connectionTimeout}ms`);
                    this.setState('failed', error);
                }
            }, this.config.connectionTimeout);

            // Simulate connection establishment (actual implementation would vary by transport)
            await this.establishConnection(metadata);

            // Clear connection timeout
            if (this.connectionTimer) {
                clearTimeout(this.connectionTimer);
                this.connectionTimer = undefined;
            }

            this.setState('connected', undefined, metadata);
            this.metrics.connectionCount++;
            this.metrics.lastConnected = Date.now();
            this.metrics.reconnectAttempts = 0;

            // Start heartbeat if enabled
            if (this.config.enableHeartbeat) {
                this.startHeartbeat();
            }

            mcpLogger.logConnection('connect', {
                connectionCount: this.metrics.connectionCount,
                metadata,
            });
        });
    }

    /**
     * Disconnect gracefully
     */
    async disconnect(): Promise<void> {
        if (this.state === 'disconnected') return;

        const context: ErrorContext = {
            component: 'ConnectionManager',
            operation: 'disconnect',
            timestamp: Date.now(),
        };

        await globalErrorHandler.withErrorHandling(context, async () => {
            this.stopHeartbeat();
            this.clearTimers();

            // Update uptime metrics
            if (this.metrics.lastConnected) {
                this.metrics.totalUptime += Date.now() - this.metrics.lastConnected;
            }

            this.setState('disconnected');
            this.metrics.lastDisconnected = Date.now();

            mcpLogger.logConnection('disconnect', {
                totalUptime: this.metrics.totalUptime,
                graceful: true,
            });
        });
    }

    /**
     * Handle connection loss and attempt recovery
     */
    async handleConnectionLoss(error: Error): Promise<void> {
        mcpLogger.error('Connection lost', error, {
            state: this.state,
            metrics: this.metrics,
        });

        this.metrics.errors++;
        this.setState('reconnecting', error);

        // Attempt reconnection
        await this.attemptReconnection();
    }

    /**
     * Record message activity
     */
    recordMessage(direction: 'incoming' | 'outgoing', message?: any): void {
        if (direction === 'incoming') {
            this.metrics.messagesReceived++;
        } else {
            this.metrics.messagesSent++;
        }

        // Log message if debug enabled
        if (process.env.DEBUG && message) {
            mcpLogger.logMCPMessage(direction, message);
        }
    }

    /**
     * Get current connection state
     */
    getState(): ConnectionState {
        return this.state;
    }

    /**
     * Get connection metrics
     */
    getMetrics(): ConnectionMetrics {
        // Calculate current uptime if connected
        const currentUptime =
            this.state === 'connected' && this.metrics.lastConnected ? Date.now() - this.metrics.lastConnected : 0;

        return {
            ...this.metrics,
            totalUptime: this.metrics.totalUptime + currentUptime,
        };
    }

    /**
     * Check if connection is healthy
     */
    isHealthy(): boolean {
        return this.state === 'connected';
    }

    /**
     * Add event handler
     */
    onStateChange(handler: ConnectionEventHandler): void {
        this.eventHandlers.push(handler);
    }

    /**
     * Remove event handler
     */
    removeStateChangeHandler(handler: ConnectionEventHandler): void {
        const index = this.eventHandlers.indexOf(handler);
        if (index > -1) {
            this.eventHandlers.splice(index, 1);
        }
    }

    /**
     * Get health check information
     */
    getHealthCheck(): any {
        const metrics = this.getMetrics();
        return {
            status: this.isHealthy() ? 'healthy' : 'unhealthy',
            state: this.state,
            uptime: metrics.totalUptime,
            connections: metrics.connectionCount,
            messages: {
                received: metrics.messagesReceived,
                sent: metrics.messagesSent,
            },
            errors: metrics.errors,
            lastConnected: metrics.lastConnected,
            lastDisconnected: metrics.lastDisconnected,
        };
    }

    private setState(newState: ConnectionState, error?: Error, metadata?: any): void {
        const previousState = this.state;
        this.state = newState;
        this.stateChangeTimestamp = Date.now();

        const eventData: ConnectionEventData = {
            state: newState,
            previousState,
            timestamp: this.stateChangeTimestamp,
            error,
            metadata,
        };

        // Notify event handlers
        for (const handler of this.eventHandlers) {
            try {
                handler(eventData);
            } catch (handlerError) {
                mcpLogger.error('Event handler error', handlerError);
            }
        }

        mcpLogger.debug(`Connection state changed: ${previousState} -> ${newState}`, {
            error: error?.message,
            metadata,
        });
    }

    private async establishConnection(metadata?: any): Promise<void> {
        // This would be implemented differently for stdio vs SSE
        // For stdio, this might just verify the streams are available
        // For SSE, this might establish the HTTP connection

        // For now, we'll just simulate connection establishment
        await new Promise((resolve) => setTimeout(resolve, 100));

        mcpLogger.debug('Connection established', { metadata });
    }

    private async attemptReconnection(): Promise<void> {
        if (this.metrics.reconnectAttempts >= this.config.maxReconnectAttempts) {
            mcpLogger.error('Max reconnection attempts exceeded', undefined, {
                attempts: this.metrics.reconnectAttempts,
                maxAttempts: this.config.maxReconnectAttempts,
            });
            this.setState('failed', new Error('Max reconnection attempts exceeded'));
            return;
        }

        this.metrics.reconnectAttempts++;

        const delay = this.config.reconnectBackoff * 2 ** (this.metrics.reconnectAttempts - 1);

        mcpLogger.info(`Attempting reconnection in ${delay}ms`, {
            attempt: this.metrics.reconnectAttempts,
            maxAttempts: this.config.maxReconnectAttempts,
        });

        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect({ reconnection: true });
            } catch (error) {
                mcpLogger.error('Reconnection failed', error);
                await this.attemptReconnection();
            }
        }, delay);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat(); // Ensure no duplicate timers

        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, this.config.heartbeatInterval);
        this.heartbeatTimer?.unref?.();
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    private sendHeartbeat(): void {
        // Implementation would vary by transport
        // For stdio, heartbeat might not be necessary
        // For SSE, could send a ping message
        mcpLogger.debug('Heartbeat sent');
    }

    private clearTimers(): void {
        if (this.connectionTimer) {
            clearTimeout(this.connectionTimer);
            this.connectionTimer = undefined;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        this.stopHeartbeat();
    }

    private setupShutdownHandlers(): void {
        const shutdown = async () => {
            mcpLogger.info('Graceful shutdown initiated');
            await this.disconnect();
        };

        // Handle various shutdown signals
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

        // Handle pipe errors (common with stdio)
        process.on('EPIPE', (error) => {
            mcpLogger.warn('Pipe error detected', error);
            this.handleConnectionLoss(error);
        });

        // Handle other process errors
        process.on('uncaughtException', (error) => {
            mcpLogger.error('Uncaught exception', error);
            this.metrics.errors++;
            // Don't exit immediately - let the application handle it
        });

        process.on('unhandledRejection', (reason, promise) => {
            mcpLogger.error('Unhandled rejection', new Error(String(reason)), { promise });
            this.metrics.errors++;
        });
    }
}

// Export a default connection manager instance without process-wide side effects.
export const defaultConnectionManager = new ConnectionManager();
