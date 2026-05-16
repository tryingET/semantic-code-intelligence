/**
 * Telemetry Manager
 * Handles anonymous telemetry with privacy protection
 */

import * as vscode from 'vscode';
import { ConfigurationManager } from '../config/ConfigurationManager';

export class TelemetryManager {
    private enabled = false;
    private queue: any[] = [];
    
    constructor(
        private context: vscode.ExtensionContext,
        private config: ConfigurationManager
    ) {}
    
    async initialize(): Promise<void> {
        this.enabled = this.config.get<boolean>('telemetry.enabled', false);
        
        if (this.enabled) {
            // Process queued events
            await this.flushQueue();
        }
    }
    
    logEvent(event: string, properties?: Record<string, any>): void {
        if (!this.enabled) return;
        
        const telemetryEvent = {
            event,
            properties: {
                ...properties,
                timestamp: Date.now(),
                version: this.context.extension.packageJSON.version
            }
        };
        
        this.queue.push(telemetryEvent);
        
        // Batch send events
        if (this.queue.length >= 10) {
            this.flushQueue();
        }
    }
    
    logError(event: string, error: any): void {
        this.logEvent(`error.${event}`, {
            message: error.message,
            stack: error.stack
        });
    }
    
    private async flushQueue(): Promise<void> {
        if (this.queue.length === 0) return;
        
        // In production, this would send to telemetry service
        console.log('[Telemetry]', this.queue);
        this.queue = [];
    }
    
    async dispose(): Promise<void> {
        await this.flushQueue();
    }
}