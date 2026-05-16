/**
 * Command Manager
 * Handles all VS Code commands with sophisticated error handling and user feedback
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LanguageClient, State } from 'vscode-languageclient/node';
import { ConfigurationManager } from '../config/ConfigurationManager';

export class CommandManager {
    private commands: Map<string, vscode.Disposable> = new Map();
    
    constructor(
        private context: vscode.ExtensionContext,
        private client: LanguageClient | undefined,
        private config: ConfigurationManager
    ) {}
    
    async registerCommands(): Promise<void> {
        // Core commands
        this.registerCommand('ontology.enable', this.enableExtension);
        this.registerCommand('ontology.disable', this.disableExtension);
        this.registerCommand('ontology.restart', this.restartServer);
        
        // Analysis commands
        this.registerCommand('ontology.analyzeCodebase', this.analyzeCodebase);
        this.registerCommand('ontology.showGraph', this.showConceptGraph);
        this.registerCommand('ontology.showPatterns', this.showLearnedPatterns);
        this.registerCommand('ontology.showStats', this.showStatistics);
        // Layer 3 targeted features
        this.registerCommand('ontology.buildSymbolMap', this.buildSymbolMap);
        this.registerCommand('ontology.planRename', this.planRenamePreview);
        
        // Management commands
        this.registerCommand('ontology.clearCache', this.clearCache);
        this.registerCommand('ontology.exportOntology', this.exportOntology);
        this.registerCommand('ontology.importOntology', this.importOntology);
        
        // Learning commands
        this.registerCommand('ontology.trainPattern', this.trainPattern);
        this.registerCommand('ontology.suggestRefactoring', this.suggestRefactoring);
    }
    
    private registerCommand(command: string, handler: (...args: any[]) => any): void {
        const disposable = vscode.commands.registerCommand(
            command,
            handler.bind(this)
        );
        this.commands.set(command, disposable);
        this.context.subscriptions.push(disposable);
    }
    
    private async enableExtension(): Promise<void> {
        await this.config.set('enable', true);
        if (this.client?.state === State.Stopped) {
            await this.client.start();
        }
        vscode.window.showInformationMessage('Ontology LSP enabled');
    }
    
    private async disableExtension(): Promise<void> {
        await this.config.set('enable', false);
        if (this.client?.state === State.Running) {
            await this.client.stop();
        }
        vscode.window.showInformationMessage('Ontology LSP disabled');
    }
    
    private async restartServer(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not initialized');
            return;
        }
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Restarting Ontology Language Server',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Stopping server...' });
            await this.client!.stop();
            
            progress.report({ increment: 50, message: 'Starting server...' });
            await this.client!.start();
            
            progress.report({ increment: 100, message: 'Server restarted' });
        });
        
        vscode.window.showInformationMessage('Ontology Language Server restarted');
    }
    
    private async analyzeCodebase(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing Codebase',
            cancellable: true
        }, async (progress, token) => {
            try {
                const result = await this.client!.sendRequest('ontology/analyzeWorkspace', {
                    folders: folders.map(f => f.uri.toString()),
                    cancellationToken: token
                });
                
                if (result && typeof result === 'object') {
                    const resultObj = result as any;
                    vscode.window.showInformationMessage(
                        `Analysis complete: ${resultObj.concepts || 0} concepts, ${resultObj.patterns || 0} patterns discovered`
                    );
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
            }
        });
    }
    
    private async showConceptGraph(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        // Create webview panel for graph visualization
        const panel = vscode.window.createWebviewPanel(
            'ontologyGraph',
            'Ontology Concept Graph',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        
        // Get graph data from server
        const graphData = await this.client.sendRequest('ontology/getConceptGraph', {});
        
        // Generate HTML with D3.js visualization
        panel.webview.html = this.getGraphHtml(graphData);
    }
    
    private async showLearnedPatterns(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        const patterns = await this.client.sendRequest('ontology/getPatterns', {});
        
        // Create virtual document to show patterns
        const content = this.formatPatterns(Array.isArray(patterns) ? patterns : []);
        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });
        
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);
    }
    
    private async showStatistics(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        const stats = await this.client.sendRequest('ontology/getStatistics', {}) as any;
        
        // Show statistics in output channel
        const output = vscode.window.createOutputChannel('Ontology Statistics');
        output.clear();
        output.appendLine('=== Ontology LSP Statistics ===\n');
        output.appendLine(`Concepts: ${stats?.concepts || 0}`);
        output.appendLine(`Relationships: ${stats?.relationships || 0}`);
        output.appendLine(`Learned Patterns: ${stats?.patterns || 0}`);
        output.appendLine(`Cache Hit Rate: ${stats?.cacheHitRate || 0}%`);
        output.appendLine(`Average Response Time: ${stats?.avgResponseTime || 0}ms`);
        output.appendLine(`Memory Usage: ${stats?.memoryUsage || 0}MB`);
        output.appendLine('\n=== Recent Operations ===');
        
        for (const op of stats?.recentOperations || []) {
            output.appendLine(`${op.timestamp}: ${op.type} (${op.duration}ms)`);
        }
        
        output.show();
    }

    private async buildSymbolMap(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const activeSymbol = editor ? this.extractWordAtPosition(editor) : undefined;
        const symbol = await vscode.window.showInputBox({
            prompt: 'Enter symbol to build symbol map for',
            value: activeSymbol || ''
        });
        if (!symbol) return;
        const uri = editor?.document.uri.toString();
        const astOnlyPick = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'AST-only mode? (faster, more precise)'
        });
        const astOnly = astOnlyPick ? astOnlyPick === 'Yes' : true;
        const maxFilesStr = await vscode.window.showInputBox({
            prompt: 'Max files to analyze (default 10)',
            value: '10'
        });
        const maxFiles = Number(maxFilesStr || '10');

        try {
            const res = await this.client.sendRequest('symbol/buildSymbolMap', {
                symbol,
                uri,
                maxFiles,
                astOnly
            } as any);
            const doc = await vscode.workspace.openTextDocument({
                content: JSON.stringify(res, null, 2),
                language: 'json'
            });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to build symbol map: ${err.message || err}`);
        }
    }

    private async planRenamePreview(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const activeSymbol = editor ? this.extractWordAtPosition(editor) : undefined;
        const oldName = await vscode.window.showInputBox({
            prompt: 'Old symbol name',
            value: activeSymbol || ''
        });
        if (!oldName) return;
        const newName = await vscode.window.showInputBox({
            prompt: `New name for "${oldName}"`,
        });
        if (!newName) return;
        const uri = editor?.document.uri.toString();
        try {
            const res = await this.client.sendRequest('refactor/planRename', {
                oldName,
                newName,
                uri
            } as any);
            const summary = (res as any)?.summary || { filesAffected: 0, totalEdits: 0 };
            const doc = await vscode.workspace.openTextDocument({
                content: `// Plan Rename Preview\n// ${oldName} -> ${newName}\n// Files affected: ${summary.filesAffected}\n// Total edits: ${summary.totalEdits}\n\n${JSON.stringify(res, null, 2)}\n`,
                language: 'json'
            });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to plan rename: ${err.message || err}`);
        }
    }

    private extractWordAtPosition(editor: vscode.TextEditor): string | undefined {
        const pos = editor.selection.active;
        const range = editor.document.getWordRangeAtPosition(pos);
        return range ? editor.document.getText(range) : undefined;
    }
    
    private async clearCache(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        const confirm = await vscode.window.showWarningMessage(
            'Clear all ontology cache? This will reset learned patterns.',
            'Yes', 'No'
        );
        
        if (confirm === 'Yes') {
            await this.client.sendRequest('ontology/clearCache', {});
            vscode.window.showInformationMessage('Ontology cache cleared');
        }
    }
    
    private async exportOntology(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('ontology-export.json'),
            filters: {
                'JSON': ['json'],
                'YAML': ['yaml', 'yml']
            }
        });
        
        if (!uri) return;
        
        const data = await this.client.sendRequest('ontology/export', {});
        const content = JSON.stringify(data, null, 2);
        
        await fs.writeFile(uri.fsPath, content, 'utf8');
        vscode.window.showInformationMessage(`Ontology exported to ${uri.fsPath}`);
    }
    
    private async importOntology(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        const uri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Ontology Files': ['json', 'yaml', 'yml']
            }
        });
        
        if (!uri || uri.length === 0) return;
        
        const content = await fs.readFile(uri[0].fsPath, 'utf8');
        const data = JSON.parse(content);
        
        await this.client.sendRequest('ontology/import', { data });
        vscode.window.showInformationMessage('Ontology imported successfully');
    }
    
    private async trainPattern(): Promise<void> {
        if (!this.client) {
            vscode.window.showErrorMessage('Language server not running');
            return;
        }
        
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.selection) {
            vscode.window.showWarningMessage('Select code to train pattern');
            return;
        }
        
        const document = editor.document;
        const selection = editor.selection;
        const text = document.getText(selection);
        
        const patternName = await vscode.window.showInputBox({
            prompt: 'Enter pattern name',
            placeHolder: 'e.g., getter-setter-sync'
        });
        
        if (!patternName) return;
        
        const description = await vscode.window.showInputBox({
            prompt: 'Describe the pattern',
            placeHolder: 'e.g., Synchronize getter and setter names'
        });
        
        await this.client.sendRequest('ontology/trainPattern', {
            name: patternName,
            description,
            code: text,
            uri: document.uri.toString(),
            range: {
                start: { line: selection.start.line, character: selection.start.character },
                end: { line: selection.end.line, character: selection.end.character }
            }
        });
        
        vscode.window.showInformationMessage(`Pattern "${patternName}" trained successfully`);
    }
    
    private async suggestRefactoring(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        const range = selection.isEmpty
            ? (document.getWordRangeAtPosition(selection.active) || new vscode.Range(selection.active, selection.active))
            : selection;

        try {
            const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
                'vscode.executeCodeActionProvider',
                document.uri,
                range,
                'refactor'
            );

            const list = Array.isArray(actions) ? actions : [];
            if (list.length === 0) {
                vscode.window.showInformationMessage('No refactoring suggestions available');
                return;
            }

            const picks = list.map((a, idx) => {
                const isCA = (a as vscode.CodeAction).title !== undefined;
                const title = isCA ? (a as vscode.CodeAction).title : (a as vscode.Command).title;
                const kind = isCA && (a as vscode.CodeAction).kind ? String((a as vscode.CodeAction).kind) : 'refactor';
                return { label: title, description: kind, action: a, index: idx };
            });

            const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Select a refactoring' });
            if (!selected) return;

            const chosen = selected.action as vscode.CodeAction | vscode.Command;
            if ((chosen as vscode.CodeAction).edit) {
                const edit = (chosen as vscode.CodeAction).edit!;
                await vscode.workspace.applyEdit(edit);
            }
            if ((chosen as vscode.CodeAction).command) {
                const cmd = (chosen as vscode.CodeAction).command!;
                await vscode.commands.executeCommand(cmd.command, ...(cmd.arguments || []));
            } else if ((chosen as vscode.Command).command) {
                const cmd = chosen as vscode.Command;
                await vscode.commands.executeCommand(cmd.command, ...(cmd.arguments || []));
            }

            vscode.window.showInformationMessage('Refactoring applied');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to get refactorings: ${err?.message || String(err)}`);
        }
    }
    
    private async applyRefactoring(suggestion: any): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        
        for (const change of suggestion.changes) {
            const uri = vscode.Uri.parse(change.uri);
            const range = new vscode.Range(
                change.range.start.line,
                change.range.start.character,
                change.range.end.line,
                change.range.end.character
            );
            edit.replace(uri, range, change.newText);
        }
        
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage('Refactoring applied successfully');
        } else {
            vscode.window.showErrorMessage('Failed to apply refactoring');
        }
    }
    
    private getGraphHtml(data: any): string {
        return `<!DOCTYPE html>
        <html>
        <head>
            <script src="https://d3js.org/d3.v7.min.js"></script>
            <style>
                body { margin: 0; overflow: hidden; }
                .node { cursor: pointer; }
                .link { fill: none; stroke: #999; stroke-opacity: 0.6; stroke-width: 2px; }
                .node-label { font: 12px sans-serif; pointer-events: none; }
            </style>
        </head>
        <body>
            <svg id="graph"></svg>
            <script>
                const data = ${JSON.stringify(data)};
                // D3.js force-directed graph implementation
                // ... (full implementation would go here)
            </script>
        </body>
        </html>`;
    }
    
    private formatPatterns(patterns: any[]): string {
        let content = '# Learned Patterns\n\n';
        
        for (const pattern of patterns) {
            content += `## ${pattern.name}\n\n`;
            content += `**Description:** ${pattern.description}\n\n`;
            content += `**Confidence:** ${Math.round(pattern.confidence * 100)}%\n\n`;
            content += `**Usage Count:** ${pattern.usageCount}\n\n`;
            content += `**Example:**\n\`\`\`\n${pattern.example}\n\`\`\`\n\n`;
            content += '---\n\n';
        }
        
        return content;
    }
    
    dispose(): void {
        for (const disposable of this.commands.values()) {
            disposable.dispose();
        }
        this.commands.clear();
    }
}
