/**
 * EventBusService - Simple event bus implementation for inter-service communication
 * Provides pub/sub functionality for the unified architecture
 */

import { EventEmitter } from 'events';
import type { EventBus } from '../types.js';

/**
 * Default event bus implementation using Node.js EventEmitter
 */
export class EventBusService implements EventBus {
    private emitter: EventEmitter;
    private maxListeners: number;

    constructor(maxListeners: number = 100) {
        this.emitter = new EventEmitter();
        this.maxListeners = maxListeners;
        this.emitter.setMaxListeners(maxListeners);
    }

    emit<T>(event: string, data: T): void {
        this.emitter.emit(event, data);
    }

    on<T>(event: string, handler: (data: T) => void): void {
        this.emitter.on(event, handler);
    }

    off<T>(event: string, handler: (data: T) => void): void {
        this.emitter.off(event, handler);
    }

    once<T>(event: string, handler: (data: T) => void): void {
        this.emitter.once(event, handler);
    }

    /**
     * Get current listener count for an event
     */
    getListenerCount(event: string): number {
        return this.emitter.listenerCount(event);
    }

    /**
     * Get all registered event names
     */
    getEventNames(): (string | symbol)[] {
        return this.emitter.eventNames();
    }

    /**
     * Remove all listeners
     */
    removeAllListeners(event?: string): void {
        if (event) {
            this.emitter.removeAllListeners(event);
        } else {
            this.emitter.removeAllListeners();
        }
    }

    /**
     * Get diagnostic information
     */
    getDiagnostics(): {
        maxListeners: number;
        eventNames: (string | symbol)[];
        listenerCounts: Record<string, number>;
    } {
        const eventNames = this.getEventNames();
        const listenerCounts: Record<string, number> = {};

        for (const eventName of eventNames) {
            if (typeof eventName === 'string') {
                listenerCounts[eventName] = this.getListenerCount(eventName);
            }
        }

        return {
            maxListeners: this.maxListeners,
            eventNames,
            listenerCounts,
        };
    }
}
