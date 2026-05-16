/**
 * Ontology View Provider
 * Provides tree view of concepts in the explorer
 */

import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

export class OntologyViewProvider implements vscode.TreeDataProvider<ConceptItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConceptItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private concepts: ConceptItem[] = [];
    
    constructor(
        private context: vscode.ExtensionContext,
        private client: LanguageClient | undefined
    ) {
        this.refresh();
    }
    
    refresh(): void {
        this.loadConcepts();
        this._onDidChangeTreeData.fire();
    }
    
    getTreeItem(element: ConceptItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: ConceptItem): Thenable<ConceptItem[]> {
        if (!element) {
            return Promise.resolve(this.concepts);
        }
        return Promise.resolve(element.children || []);
    }
    
    private async loadConcepts(): Promise<void> {
        if (!this.client) return;
        
        try {
            const data = await this.client.sendRequest('ontology/getConcepts', {});
            this.concepts = this.buildTree(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load concepts:', error);
            this.concepts = [];
        }
    }
    
    private buildTree(data: any[]): ConceptItem[] {
        return data.map(item => new ConceptItem(
            item.name,
            item.type,
            vscode.TreeItemCollapsibleState.Collapsed,
            item.children ? this.buildTree(item.children) : undefined
        ));
    }
}

class ConceptItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly children?: ConceptItem[]
    ) {
        super(label, collapsibleState);
        
        this.tooltip = `${this.type}: ${this.label}`;
        this.contextValue = this.type;
        
        // Set appropriate icon
        switch (this.type) {
            case 'class':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
                break;
            case 'function':
                this.iconPath = new vscode.ThemeIcon('symbol-method');
                break;
            case 'variable':
                this.iconPath = new vscode.ThemeIcon('symbol-variable');
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        }
    }
}