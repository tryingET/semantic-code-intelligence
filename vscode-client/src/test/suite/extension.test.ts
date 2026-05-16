/**
 * Extension Integration Tests
 * Tests the main extension activation and lifecycle
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

suite('Extension Integration Test Suite', () => {
    let lspServer: ChildProcess | undefined;
    
    suiteSetup(async () => {
        // Start the real LSP server
        const serverPath = path.join(__dirname, '../../../../dist/server.js');
        lspServer = spawn('node', [serverPath, '--stdio'], {
            cwd: path.join(__dirname, '../../../..'),
            stdio: 'pipe'
        });
        
        // Give server time to start
        await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    suiteTeardown(() => {
        // Clean up LSP server
        if (lspServer) {
            lspServer.kill();
        }
    });
    
    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('ontology-team.ontology-lsp'));
    });
    
    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('ontology-team.ontology-lsp');
        assert.ok(ext);
        
        const api = await ext.activate();
        assert.ok(api);
        assert.ok(api.getConcept);
        assert.ok(api.getPatterns);
        assert.ok(api.suggestRefactorings);
    });
    
    test('All commands should be registered', async () => {
        const commands = await vscode.commands.getCommands();
        
        const expectedCommands = [
            'ontology.enable',
            'ontology.disable',
            'ontology.restart',
            'ontology.showGraph',
            'ontology.analyzeCodebase',
            'ontology.showPatterns',
            'ontology.showStats',
            'ontology.clearCache',
            'ontology.exportOntology',
            'ontology.importOntology',
            'ontology.trainPattern',
            'ontology.suggestRefactoring'
        ];
        
        for (const cmd of expectedCommands) {
            assert.ok(
                commands.includes(cmd),
                `Command ${cmd} should be registered`
            );
        }
    });
    
    test('Configuration should have correct defaults', () => {
        const config = vscode.workspace.getConfiguration('ontologyLSP');
        
        assert.strictEqual(config.get('enable'), true);
        assert.strictEqual(config.get('fuzzyMatching.enabled'), true);
        assert.strictEqual(config.get('fuzzyMatching.threshold'), 0.7);
        assert.strictEqual(config.get('patternLearning.enabled'), true);
        assert.strictEqual(config.get('propagation.enabled'), true);
        assert.strictEqual(config.get('propagation.autoApply'), false);
    });
    
    test('Status bar should be visible when enabled', async () => {
        const config = vscode.workspace.getConfiguration('ontologyLSP');
        await config.update('ui.showStatusBar', true, vscode.ConfigurationTarget.Workspace);
        
        // Give time for status bar to update
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const statusBarItems = (vscode.window as any).statusBarItems || [];
        const ontologyStatusBar = statusBarItems.find(item => 
            item.text.includes('Ontology')
        );
        
        assert.ok(ontologyStatusBar, 'Status bar should be visible');
    });
    
    test('Language client should connect to server', async () => {
        const ext = vscode.extensions.getExtension('ontology-team.ontology-lsp');
        const api = await ext!.activate();
        
        // Get the language client
        const client = api.getLanguageClient();
        assert.ok(client, 'Language client should exist');
        
        // Check if client is running
        const state = client.state;
        assert.strictEqual(state, 'running', 'Client should be running');
    });
});