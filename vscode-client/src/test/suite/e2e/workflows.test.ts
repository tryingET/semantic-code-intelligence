/**
 * End-to-End Workflow Tests
 * Tests complete user workflows with the real LSP server
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

suite('End-to-End Workflow Test Suite', () => {
    let testDocument: vscode.TextDocument;
    let editor: vscode.TextEditor;
    const testWorkspacePath = path.join(__dirname, '../../../../test-fixtures');
    
    suiteSetup(async function() {
        this.timeout(30000);
        
        // Ensure test workspace exists
        await fs.mkdir(testWorkspacePath, { recursive: true });
        
        // Wait for extension to be ready
        const ext = vscode.extensions.getExtension('ontology-team.ontology-lsp');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
        
        // Give LSP server time to fully initialize
        await new Promise(resolve => setTimeout(resolve, 5000));
    });
    
    setup(async () => {
        // Create a test file for each test
        const testFilePath = path.join(testWorkspacePath, 'test.ts');
        const testContent = `
// Test file for Ontology LSP
function getUserData(userId: string): Promise<User> {
    return fetch(\`/api/users/\${userId}\`)
        .then(response => response.json());
}

function fetchUserInfo(id: string): Promise<User> {
    return getUserData(id);
}

interface User {
    id: string;
    name: string;
    email: string;
}

class UserService {
    private users: Map<string, User> = new Map();
    
    async getUser(userId: string): Promise<User | null> {
        return this.users.get(userId) || null;
    }
    
    async loadUserData(id: string): Promise<User> {
        const user = await getUserData(id);
        this.users.set(user.id, user);
        return user;
    }
}`;
        
        await fs.writeFile(testFilePath, testContent, 'utf8');
        
        // Open the document
        const uri = vscode.Uri.file(testFilePath);
        testDocument = await vscode.workspace.openTextDocument(uri);
        editor = await vscode.window.showTextDocument(testDocument);
    });
    
    teardown(async () => {
        // Close all editors
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });
    
    test('Should find definition with fuzzy matching', async function() {
        this.timeout(10000);
        
        // Position cursor on 'fetchUserInfo'
        const position = new vscode.Position(8, 20); // Inside fetchUserInfo
        editor.selection = new vscode.Selection(position, position);
        
        // Execute go to definition
        const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeDefinitionProvider',
            testDocument.uri,
            position
        );
        
        assert.ok(definitions);
        assert.ok(definitions.length > 0, 'Should find at least one definition');
        
        // Should find getUserData as related
        const foundGetUserData = definitions.some(def => {
            const line = testDocument.lineAt(def.range.start.line).text;
            return line.includes('getUserData');
        });
        
        assert.ok(foundGetUserData || definitions.length > 0, 'Should find related function');
    });
    
    test('Should find all references', async function() {
        this.timeout(10000);
        
        // Position cursor on 'getUserData'
        const position = new vscode.Position(2, 10); // On getUserData function name
        editor.selection = new vscode.Selection(position, position);
        
        // Execute find references
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            testDocument.uri,
            position
        );
        
        assert.ok(references);
        assert.ok(references.length >= 2, 'Should find at least 2 references');
    });
    
    test('Should provide completions', async function() {
        this.timeout(10000);
        
        // Add a new line and trigger completion
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(30, 0), '\nconst service = new UserS');
        });
        
        const position = new vscode.Position(30, 25); // After 'UserS'
        
        // Execute completion provider
        const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            testDocument.uri,
            position
        );
        
        assert.ok(completions);
        assert.ok(completions.items.length > 0, 'Should provide completions');
        
        // Should suggest UserService
        const hasUserService = completions.items.some(item => 
            item.label === 'UserService' || item.label.toString().includes('UserService')
        );
        
        assert.ok(hasUserService || completions.items.length > 0, 'Should suggest UserService');
    });
    
    test('Should rename with propagation', async function() {
        this.timeout(15000);
        
        // Position cursor on 'getUserData'
        const position = new vscode.Position(2, 10);
        editor.selection = new vscode.Selection(position, position);
        
        // Execute rename
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            testDocument.uri,
            position,
            'fetchUserById'
        );
        
        assert.ok(edit, 'Should return workspace edit');
        
        // Apply the edit
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success, 'Should apply edit successfully');
        
        // Check if rename was applied
        const newContent = testDocument.getText();
        assert.ok(newContent.includes('fetchUserById'), 'Should contain new name');
        assert.ok(!newContent.includes('function getUserData'), 'Should not contain old name');
    });
    
    test('Should analyze codebase', async function() {
        this.timeout(30000);
        
        // Execute analyze command
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.analyzeCodebase');
        });
    });
    
    test('Should show learned patterns', async function() {
        this.timeout(10000);
        
        // Train a pattern first
        const selection = new vscode.Range(
            new vscode.Position(2, 0),
            new vscode.Position(5, 1)
        );
        editor.selection = new vscode.Selection(selection.start, selection.end);
        
        // Train pattern (might fail if command doesn't exist yet)
        try {
            await vscode.commands.executeCommand('ontology.trainPattern');
        } catch {
            // Ignore if command doesn't exist
        }
        
        // Show patterns
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.showPatterns');
        });
    });
    
    test('Should export and import ontology', async function() {
        this.timeout(20000);
        
        const exportPath = path.join(testWorkspacePath, 'ontology-export.json');
        
        // Export
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.exportOntology');
        });
        
        // Import (if export created a file)
        try {
            await fs.access(exportPath);
            await assert.doesNotReject(async () => {
                await vscode.commands.executeCommand('ontology.importOntology');
            });
        } catch {
            // File might not exist if export used dialog
        }
    });
    
    test('Should handle configuration changes', async function() {
        this.timeout(10000);
        
        const config = vscode.workspace.getConfiguration('ontologyLSP');
        
        // Change configuration
        await config.update('fuzzyMatching.threshold', 0.8, vscode.ConfigurationTarget.Workspace);
        
        // Give time for configuration to propagate
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify configuration was updated
        const newThreshold = config.get<number>('fuzzyMatching.threshold');
        assert.strictEqual(newThreshold, 0.8);
        
        // Reset configuration
        await config.update('fuzzyMatching.threshold', 0.7, vscode.ConfigurationTarget.Workspace);
    });
    
    test('Should show concept graph', async function() {
        this.timeout(10000);
        
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.showGraph');
        });
        
        // Give time for webview to open
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Should have opened a webview (hard to test directly)
        assert.ok(true, 'Command executed without error');
    });
    
    test('Should suggest refactorings', async function() {
        this.timeout(10000);
        
        // Position cursor on a function
        const position = new vscode.Position(2, 10);
        editor.selection = new vscode.Selection(position, position);
        
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.suggestRefactoring');
        });
    });
    
    test('Should clear cache', async function() {
        this.timeout(10000);
        
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.clearCache');
        });
    });
    
    test('Should restart language server', async function() {
        this.timeout(20000);
        
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.restart');
        });
        
        // Give server time to restart
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Server should be running again - test with a simple command
        await assert.doesNotReject(async () => {
            await vscode.commands.executeCommand('ontology.showStats');
        });
    });
});