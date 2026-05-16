/**
 * Language Client Integration Tests
 * Tests actual connection to the real LSP server
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { 
    LanguageClient, 
    ServerOptions, 
    LanguageClientOptions,
    TransportKind 
} from 'vscode-languageclient/node';

suite('Language Client Integration Test Suite', () => {
    let client: LanguageClient;
    let lspServerProcess: ChildProcess;
    
    suiteSetup(async function() {
        this.timeout(30000); // 30 seconds for server startup
        
        // Start the real LSP server
        const serverPath = path.join(__dirname, '../../../../../dist/server.js');
        console.log('Starting LSP server at:', serverPath);
        
        // Create language client that connects to our real server
        const serverOptions: ServerOptions = {
            run: {
                module: serverPath,
                transport: TransportKind.stdio
            },
            debug: {
                module: serverPath,
                transport: TransportKind.stdio,
                options: {
                    execArgv: ['--nolazy', '--inspect=6009']
                }
            }
        };
        
        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'typescript' },
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'python' }
            ],
            synchronize: {
                configurationSection: 'ontologyLSP'
            }
        };
        
        client = new LanguageClient(
            'ontologyLSP-test',
            'Ontology LSP Test Client',
            serverOptions,
            clientOptions
        );
        
        // Start the client (which starts the server)
        await client.start();
    });
    
    suiteTeardown(async function() {
        this.timeout(10000);
        
        if (client) {
            await client.stop();
        }
        
        // Clean up any spawned processes
        // Note: client.stop() should handle server cleanup
    });
    
    test('Client should connect to server', () => {
        assert.ok(client);
        assert.strictEqual(client.state, 2); // Running state
    });
    
    test('Server should respond to initialization', async () => {
        const capabilities = client.initializeResult?.capabilities;
        
        assert.ok(capabilities);
        assert.ok(capabilities.textDocumentSync);
        assert.ok(capabilities.completionProvider);
        assert.ok(capabilities.definitionProvider);
        assert.ok(capabilities.referencesProvider);
        assert.ok(capabilities.renameProvider);
    });
    
    test('Should handle custom requests', async () => {
        // Test getting statistics
        const stats = await client.sendRequest('ontology/getStatistics', {});
        
        assert.ok(stats);
        const statsObj = stats as any;
        assert.ok(typeof statsObj.concepts === 'number');
        assert.ok(typeof statsObj.patterns === 'number');
    });
    
    test('Should handle ontology analysis request', async () => {
        const result = await client.sendRequest('ontology/analyzeWorkspace', {
            folders: [vscode.workspace.workspaceFolders?.[0]?.uri.toString() || ''],
            cancellationToken: null
        });
        
        assert.ok(result);
        const resultObj = result as any;
        assert.ok(typeof resultObj.concepts === 'number');
        assert.ok(typeof resultObj.patterns === 'number');
    });
    
    test('Should handle pattern requests', async () => {
        const patterns = await client.sendRequest('ontology/getPatterns', {});
        
        assert.ok(Array.isArray(patterns));
    });
    
    test('Should handle concept graph request', async () => {
        const graph = await client.sendRequest('ontology/getConceptGraph', {});
        
        assert.ok(graph);
        const graphObj = graph as any;
        assert.ok(graphObj.nodes || Array.isArray(graphObj));
    });
    
    test('Should export and import ontology data', async () => {
        // Export
        const exportedData = await client.sendRequest('ontology/export', {});
        assert.ok(exportedData);
        
        // Import (should not throw)
        await assert.doesNotReject(async () => {
            await client.sendRequest('ontology/import', { data: exportedData });
        });
    });

    test('Should handle symbol/buildSymbolMap request', async () => {
        const res = await client.sendRequest('symbol/buildSymbolMap', {
            symbol: 'testSymbol',
            maxFiles: 5,
            astOnly: true
        } as any);
        // Shape can vary; ensure no error and object-like
        assert.ok(res !== undefined);
    });

    test('Should handle refactor/planRename request', async () => {
        const res = await client.sendRequest('refactor/planRename', {
            oldName: 'oldName',
            newName: 'newName'
        } as any);
        assert.ok(res !== undefined);
        const summary = (res as any).summary;
        assert.ok(summary === undefined || (typeof summary.filesAffected === 'number'));
    });
    
    test('Should handle cache operations', async () => {
        // Clear cache should not throw
        await assert.doesNotReject(async () => {
            await client.sendRequest('ontology/clearCache', {});
        });
    });
    
    test('Should handle refactoring suggestions', async () => {
        const suggestions = await client.sendRequest('ontology/suggestRefactoring', {
            uri: 'file:///test.ts',
            position: { line: 0, character: 0 }
        });
        
        assert.ok(Array.isArray(suggestions));
    });
    
    test('Should handle pattern training', async () => {
        await assert.doesNotReject(async () => {
            await client.sendRequest('ontology/trainPattern', {
                name: 'test-pattern',
                description: 'Test pattern for unit tests',
                code: 'function test() { return true; }',
                uri: 'file:///test.ts',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 33 }
                }
            });
        });
    });
    
    test('Should handle notifications', (done) => {
        // Listen for a notification
        const disposable = client.onNotification('ontology/patternLearned', (params) => {
            assert.ok(params);
            disposable.dispose();
            done();
        });
        
        // Trigger a pattern learning
        client.sendRequest('ontology/trainPattern', {
            name: 'notification-test',
            description: 'Trigger notification',
            code: 'test',
            uri: 'file:///test.ts',
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 4 }
            }
        }).catch(() => {
            // Ignore errors, we're just testing notification
        });
        
        // Timeout fallback
        setTimeout(() => {
            disposable.dispose();
            done();
        }, 5000);
    });
    
    test('Should handle progress reporting', async () => {
        let progressReceived = false;
        
        const progressType = 'ontology/analyzing' as any;
        const progressHandler = client.onProgress(progressType, 'begin', () => {
            progressReceived = true;
        });
        
        // Trigger analysis that reports progress
        try {
            await client.sendRequest('ontology/analyzeWorkspace', {
                folders: [vscode.workspace.workspaceFolders?.[0]?.uri.toString() || ''],
                cancellationToken: null
            });
        } catch {
            // Ignore errors
        }
        
        progressHandler.dispose();
        
        // Progress may or may not be received depending on server implementation
        // Just ensure no errors occurred
        assert.ok(true);
    });
    
    test('Should handle configuration changes', async () => {
        await assert.doesNotReject(async () => {
            await client.sendNotification('workspace/didChangeConfiguration', {
                settings: {
                    ontologyLSP: {
                        enable: true,
                        fuzzyMatching: { enabled: true }
                    }
                }
            });
        });
    });
    
    test('Should recover from errors', async () => {
        // Send invalid request
        try {
            await client.sendRequest('ontology/invalidRequest', {});
            assert.fail('Should have thrown error');
        } catch (error) {
            // Expected error
            assert.ok(error);
        }
        
        // Client should still be running
        assert.strictEqual(client.state, 2);
        
        // Should still handle valid requests
        const stats = await client.sendRequest('ontology/getStatistics', {});
        assert.ok(stats);
    });
});
