/**
 * Configuration Manager
 * Handles all configuration with validation, caching, and migration
 */

import * as vscode from 'vscode';

export class ConfigurationManager {
    private config: vscode.WorkspaceConfiguration;
    private cache: Map<string, any> = new Map();
    private listeners: Map<string, ((value: any) => void)[]> = new Map();
    
    constructor(private context: vscode.ExtensionContext) {
        this.config = vscode.workspace.getConfiguration('ontologyLSP');
    }
    
    async initialize(): Promise<void> {
        // Migrate old configurations if needed
        await this.migrateConfiguration();
        
        // Validate configuration
        this.validateConfiguration();
        
        // Setup configuration change listener
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('ontologyLSP')) {
                    this.config = vscode.workspace.getConfiguration('ontologyLSP');
                    this.cache.clear();
                    this.notifyListeners();
                }
            })
        );
    }
    
    get<T>(key: string, defaultValue?: T): T {
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        
        const value = this.config.get<T>(key, defaultValue!);
        this.cache.set(key, value);
        return value;
    }
    
    async set(key: string, value: any, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
        await this.config.update(key, value, target);
        this.cache.set(key, value);
        this.notifyListeners(key);
    }
    
    onDidChange(key: string, callback: (value: any) => void): vscode.Disposable {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key)!.push(callback);
        
        return new vscode.Disposable(() => {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        });
    }
    
    private notifyListeners(key?: string): void {
        if (key) {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                const value = this.get(key);
                callbacks.forEach(cb => cb(value));
            }
        } else {
            // Notify all listeners
            for (const [k, callbacks] of this.listeners) {
                const value = this.get(k);
                callbacks.forEach(cb => cb(value));
            }
        }
    }
    
    private validateConfiguration(): void {
        // Validate numeric ranges
        const fuzzyThreshold = this.get<number>('fuzzyMatching.threshold');
        if (fuzzyThreshold < 0 || fuzzyThreshold > 1) {
            vscode.window.showWarningMessage('Fuzzy matching threshold must be between 0 and 1');
            this.set('fuzzyMatching.threshold', 0.7);
        }
        
        const minConfidence = this.get<number>('patternLearning.minConfidence');
        if (minConfidence < 0 || minConfidence > 1) {
            vscode.window.showWarningMessage('Pattern learning confidence must be between 0 and 1');
            this.set('patternLearning.minConfidence', 0.8);
        }
        
        const maxDepth = this.get<number>('propagation.maxDepth');
        if (maxDepth < 1 || maxDepth > 10) {
            vscode.window.showWarningMessage('Propagation depth must be between 1 and 10');
            this.set('propagation.maxDepth', 3);
        }
    }
    
    private async migrateConfiguration(): Promise<void> {
        // Migrate from old configuration keys to new ones
        const migrations = [
            { old: 'ontology.fuzzyMatch', new: 'fuzzyMatching.enabled' },
            { old: 'ontology.learnPatterns', new: 'patternLearning.enabled' },
            { old: 'ontology.autoPropagate', new: 'propagation.autoApply' }
        ];
        
        for (const migration of migrations) {
            if (this.config.has(migration.old)) {
                const value = this.config.get(migration.old);
                await this.set(migration.new, value);
                await this.config.update(migration.old, undefined, vscode.ConfigurationTarget.Global);
            }
        }
    }
    
    getAll(): Record<string, any> {
        return {
            enable: this.get('enable'),
            fuzzyMatching: {
                enabled: this.get('fuzzyMatching.enabled'),
                threshold: this.get('fuzzyMatching.threshold')
            },
            patternLearning: {
                enabled: this.get('patternLearning.enabled'),
                minConfidence: this.get('patternLearning.minConfidence')
            },
            propagation: {
                enabled: this.get('propagation.enabled'),
                autoApply: this.get('propagation.autoApply'),
                maxDepth: this.get('propagation.maxDepth')
            },
            performance: {
                cacheSize: this.get('performance.cacheSize'),
                parallelWorkers: this.get('performance.parallelWorkers')
            },
            ui: {
                showStatusBar: this.get('ui.showStatusBar'),
                showInlineHints: this.get('ui.showInlineHints')
            },
            telemetry: {
                enabled: this.get('telemetry.enabled')
            },
            experimental: {
                aiSuggestions: this.get('experimental.aiSuggestions')
            }
        };
    }
}