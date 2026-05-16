/**
 * Status Bar Manager
 * Provides real-time feedback about server status, operations, and insights
 */

import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private progressBarItem: vscode.StatusBarItem;
    private statsBarItem: vscode.StatusBarItem;
    private currentStatus: 'inactive' | 'active' | 'error' | 'warning' = 'inactive';
    private stats = {
        concepts: 0,
        patterns: 0,
        lastOperation: '',
        operationTime: 0
    };
    
    constructor(private context: vscode.ExtensionContext) {
        // Main status indicator
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'ontology.showStats';
        
        // Progress indicator
        this.progressBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        
        // Statistics display
        this.statsBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            50
        );
        this.statsBarItem.command = 'ontology.showGraph';
        
        context.subscriptions.push(this.statusBarItem);
        context.subscriptions.push(this.progressBarItem);
        context.subscriptions.push(this.statsBarItem);
    }
    
    show(): void {
        this.statusBarItem.show();
        this.statsBarItem.show();
        this.updateDisplay();
    }
    
    hide(): void {
        this.statusBarItem.hide();
        this.progressBarItem.hide();
        this.statsBarItem.hide();
    }
    
    setActive(message?: string): void {
        this.currentStatus = 'active';
        this.statusBarItem.text = `$(symbol-class) ${message || 'Ontology LSP'}`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = 'Ontology LSP is active\nClick for statistics';
        this.updateDisplay();
    }
    
    setInactive(): void {
        this.currentStatus = 'inactive';
        this.statusBarItem.text = '$(symbol-class) Ontology LSP (Inactive)';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.tooltip = 'Ontology LSP is inactive\nClick to restart';
        this.updateDisplay();
    }
    
    setError(message: string): void {
        this.currentStatus = 'error';
        this.statusBarItem.text = `$(error) Ontology LSP: ${message}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.tooltip = `Error: ${message}\nClick for details`;
        this.updateDisplay();
    }
    
    setWarning(message: string): void {
        this.currentStatus = 'warning';
        this.statusBarItem.text = `$(warning) ${message}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.tooltip = `Warning: ${message}`;
        this.updateDisplay();
    }
    
    setMessage(message: string, timeout: number = 3000): void {
        const originalText = this.statusBarItem.text;
        this.statusBarItem.text = `$(info) ${message}`;
        
        setTimeout(() => {
            if (this.statusBarItem.text.includes(message)) {
                this.statusBarItem.text = originalText;
            }
        }, timeout);
    }
    
    setProgress(message: string, percentage?: number): void {
        if (percentage !== undefined) {
            const filled = Math.floor(percentage / 10);
            const empty = 10 - filled;
            const bar = '█'.repeat(filled) + '░'.repeat(empty);
            this.progressBarItem.text = `${message} [${bar}] ${percentage}%`;
        } else {
            this.progressBarItem.text = `$(sync~spin) ${message}`;
        }
        this.progressBarItem.show();
    }
    
    clearProgress(): void {
        this.progressBarItem.hide();
        this.progressBarItem.text = '';
    }
    
    updateStats(stats: Partial<typeof this.stats>): void {
        Object.assign(this.stats, stats);
        this.updateDisplay();
    }
    
    private updateDisplay(): void {
        if (this.currentStatus === 'active') {
            // Update statistics display
            const parts: string[] = [];
            
            if (this.stats.concepts > 0) {
                parts.push(`$(symbol-namespace) ${this.stats.concepts}`);
            }
            
            if (this.stats.patterns > 0) {
                parts.push(`$(symbol-method) ${this.stats.patterns}`);
            }
            
            if (this.stats.lastOperation) {
                const timeStr = this.stats.operationTime > 0 
                    ? ` (${this.stats.operationTime}ms)` 
                    : '';
                parts.push(`${this.stats.lastOperation}${timeStr}`);
            }
            
            if (parts.length > 0) {
                this.statsBarItem.text = parts.join(' | ');
                this.statsBarItem.tooltip = `Concepts: ${this.stats.concepts}\n` +
                    `Patterns: ${this.stats.patterns}\n` +
                    `Last: ${this.stats.lastOperation} ${this.stats.operationTime}ms\n` +
                    `Click to show concept graph`;
                this.statsBarItem.show();
            }
        } else {
            this.statsBarItem.hide();
        }
    }
    
    dispose(): void {
        this.statusBarItem.dispose();
        this.progressBarItem.dispose();
        this.statsBarItem.dispose();
    }
}