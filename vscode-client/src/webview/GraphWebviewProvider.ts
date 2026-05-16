/**
 * Graph Webview Provider
 * Provides interactive visualization of the concept graph
 */

import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

export class GraphWebviewProvider implements vscode.WebviewViewProvider {
    constructor(
        private context: vscode.ExtensionContext,
        private client: LanguageClient | undefined
    ) {}
    
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };
        
        webviewView.webview.html = this.getHtmlContent(webviewView.webview);
        
        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'refresh':
                    await this.updateGraph(webviewView.webview);
                    break;
                case 'nodeClick':
                    await this.handleNodeClick(message.nodeId);
                    break;
            }
        });
    }
    
    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ontology Graph</title>
            <style>
                body { margin: 0; padding: 0; overflow: hidden; }
                #graph { width: 100vw; height: 100vh; }
                .controls { position: absolute; top: 10px; right: 10px; }
                button { margin: 5px; padding: 5px 10px; }
            </style>
        </head>
        <body>
            <div class="controls">
                <button onclick="refresh()">Refresh</button>
                <button onclick="zoomIn()">Zoom In</button>
                <button onclick="zoomOut()">Zoom Out</button>
                <button onclick="resetView()">Reset</button>
            </div>
            <div id="graph"></div>
            <script src="https://d3js.org/d3.v7.min.js"></script>
            <script>
                const vscode = acquireVsCodeApi();
                let simulation;
                
                function refresh() {
                    vscode.postMessage({ command: 'refresh' });
                }
                
                function renderGraph(data) {
                    // D3.js force-directed graph implementation
                    const width = window.innerWidth;
                    const height = window.innerHeight;
                    
                    d3.select("#graph").selectAll("*").remove();
                    
                    const svg = d3.select("#graph")
                        .append("svg")
                        .attr("width", width)
                        .attr("height", height);
                    
                    // Simplified graph rendering
                    // Full implementation would include nodes, links, forces, etc.
                }
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'updateGraph') {
                        renderGraph(message.data);
                    }
                });
                
                // Initial load
                refresh();
            </script>
        </body>
        </html>`;
    }
    
    private async updateGraph(webview: vscode.Webview): Promise<void> {
        if (!this.client) return;
        
        const graphData = await this.client.sendRequest('ontology/getConceptGraph', {});
        webview.postMessage({ command: 'updateGraph', data: graphData });
    }
    
    private async handleNodeClick(nodeId: string): Promise<void> {
        // Navigate to node definition
        if (!this.client) return;
        
        const location = await this.client.sendRequest('ontology/getConceptLocation', { id: nodeId });
        if (location && (location as any).uri && (location as any).range) {
            const locationObj = location as any;
            const uri = vscode.Uri.parse(locationObj.uri);
            const position = new vscode.Position(locationObj.range.start.line, locationObj.range.start.character);
            await vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position) });
        }
    }
}