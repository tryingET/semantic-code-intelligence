/**
 * Ontology LSP VS Code Extension
 * 
 * Architecture considerations:
 * - First-order: Basic LSP protocol implementation
 * - Second-order: Performance monitoring, conflict resolution with built-in TS server
 * - Third-order: Memory management, pattern validation, cross-file dependencies
 * - Fourth-order: Team collaboration, repository integration, CI/CD hooks
 * - Fifth-order: Security (pattern privacy), scalability (large codebases)
 * - Sixth-order: AI integration readiness, extensibility for future features
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    State,
    RevealOutputChannelOn,
    DidChangeConfigurationNotification,
    ErrorAction,
    CloseAction
} from 'vscode-languageclient/node';

import { ConfigurationManager } from './config/ConfigurationManager';
import { StatusBarManager } from './ui/StatusBarManager';
import { CommandManager } from './commands/CommandManager';
import { TelemetryManager } from './telemetry/TelemetryManager';
import { OntologyViewProvider } from './views/OntologyViewProvider';
import { GraphWebviewProvider } from './webview/GraphWebviewProvider';
import { ExtensionAPI } from './api/ExtensionAPI';
import { PerformanceMonitor } from './monitoring/PerformanceMonitor';
import { ConflictResolver } from './integration/ConflictResolver';
import { SecurityManager } from './security/SecurityManager';
import { TeamSyncManager } from './collaboration/TeamSyncManager';

let client: LanguageClient | undefined;
let statusBar: StatusBarManager;
let configManager: ConfigurationManager;
let commandManager: CommandManager;
let telemetry: TelemetryManager;
let performanceMonitor: PerformanceMonitor;
let conflictResolver: ConflictResolver;
let securityManager: SecurityManager;
let teamSync: TeamSyncManager;

// Extension API for third-party integration
let extensionAPI: ExtensionAPI;

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionAPI> {
    console.log('[Ontology LSP] Extension activating...');
    
    try {
        // Initialize configuration manager first
        configManager = new ConfigurationManager(context);
        await configManager.initialize();
        
        // Check if we're in test mode
        const isTestMode = process.env.VSCODE_TEST === '1' || process.env.NODE_ENV === 'test';
        
        // Check if extension is enabled
        if (!configManager.get<boolean>('enable')) {
            console.log('[Ontology LSP] Extension is disabled by configuration');
            return createMinimalAPI();
        }
        
        // Initialize security manager (handles sensitive pattern filtering)
        securityManager = new SecurityManager(configManager);
        await securityManager.initialize();
        
        // Initialize performance monitor
        performanceMonitor = new PerformanceMonitor(context);
        performanceMonitor.start();
        
        // Initialize telemetry (respects user privacy settings)
        telemetry = new TelemetryManager(context, configManager);
        if (configManager.get<boolean>('telemetry.enabled')) {
            await telemetry.initialize();
        }
        
        // Initialize status bar
        statusBar = new StatusBarManager(context);
        if (configManager.get<boolean>('ui.showStatusBar')) {
            statusBar.show();
        }
        
        // Initialize conflict resolver (handles TypeScript server conflicts)
        conflictResolver = new ConflictResolver(context);
        await conflictResolver.resolveConflicts();
        
        // Initialize team sync manager (handles shared patterns)
        teamSync = new TeamSyncManager(context, configManager);
        await teamSync.initialize();
        
        // Setup the language server
        const serverModule = getServerPath(context);
        const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
        
        // Server options with automatic restart on crash
        // Use Bun to run the server for native SQLite support
        const bunPath = '/home/lightningralf/.bun/bin/bun';
        // Prefer workspace root as CWD so server resolves paths correctly
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || context.extensionPath;
        const serverOptions: ServerOptions = {
            run: {
                command: bunPath,
                args: [serverModule, '--stdio'],
                transport: TransportKind.stdio,
                options: {
                    cwd: workspaceRoot,
                    env: {
                        ...process.env,
                        ONTOLOGY_EXTENSION_MODE: 'production',
                        ONTOLOGY_SECURITY_LEVEL: securityManager.getSecurityLevel(),
                        STDIO_MODE: '1'
                    }
                }
            },
            debug: {
                command: bunPath,
                args: [serverModule, '--stdio'],
                transport: TransportKind.stdio,
                options: {
                    cwd: workspaceRoot,
                    env: {
                        ...process.env,
                        ONTOLOGY_EXTENSION_MODE: 'debug',
                        ONTOLOGY_SECURITY_LEVEL: securityManager.getSecurityLevel(),
                        STDIO_MODE: '1'
                    }
                }
            }
        };
        
        // Client options with comprehensive document selectors
        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'typescript' },
                { scheme: 'file', language: 'typescriptreact' },
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'javascriptreact' },
                { scheme: 'file', language: 'python' },
                { scheme: 'untitled', language: 'typescript' },
                { scheme: 'untitled', language: 'javascript' },
                { scheme: 'untitled', language: 'python' }
            ],
            synchronize: {
                // Synchronize configuration changes
                configurationSection: 'ontologyLSP',
                // Watch for .ontology config files
                fileEvents: [
                    vscode.workspace.createFileSystemWatcher('**/.ontology'),
                    vscode.workspace.createFileSystemWatcher('**/.ontologyignore'),
                    vscode.workspace.createFileSystemWatcher('**/ontology.config.{json,yaml,yml}')
                ]
            },
            // Control output channel
            revealOutputChannelOn: RevealOutputChannelOn.Error,
            // Middleware for intercepting requests/responses
            middleware: {
                // Intercept completion requests to add AI suggestions if enabled
                provideCompletionItem: async (document, position, context, token, next) => {
                    performanceMonitor.startTimer('completion');
                    const result = await next(document, position, context, token);
                    performanceMonitor.endTimer('completion');
                    
                    if (configManager.get<boolean>('experimental.aiSuggestions')) {
                        // Enhance with AI suggestions
                        return enhanceWithAISuggestions(result);
                    }
                    return result;
                },
                // Intercept rename requests to handle propagation
                provideRenameEdits: async (document, position, newName, token, next) => {
                    performanceMonitor.startTimer('rename');
                    const result = await next(document, position, newName, token);
                    performanceMonitor.endTimer('rename');
                    
                    if (configManager.get<boolean>('propagation.enabled')) {
                        // Add propagated changes
                        return addPropagatedChanges(result || undefined, document, position, newName);
                    }
                    return result;
                }
            },
            // Error handler with automatic recovery
            errorHandler: {
                error: (error, message, count) => {
                    telemetry.logError('LSP error', error);
                    statusBar.setError(`LSP Error: ${error.message}`);
                    
                    // Implement exponential backoff for retries
                    if (count && count < 5) {
                        return { action: 'restart' as any, delay: Math.pow(2, count) * 1000 };
                    }
                    return { action: ErrorAction.Shutdown };
                },
                closed: () => {
                    telemetry.logEvent('LSP connection closed');
                    statusBar.setInactive();
                    
                    // Auto-restart after unexpected closure
                    setTimeout(() => {
                        client?.start();
                    }, 5000);
                    
                    return { action: CloseAction.Restart };
                }
            }
        };
        
        // Skip server connection in test mode unless explicitly enabled
        if (!isTestMode || process.env.ONTOLOGY_TEST_WITH_SERVER === 'true') {
            // Create the language client
            client = new LanguageClient(
                'ontologyLSP',
                'Ontology Language Server',
                serverOptions,
                clientOptions
            );
            
            // Register client capabilities
            client.registerProposedFeatures();
            
            // Start the client
            await client.start();
            
            // Setup post-initialization features
            await setupPostInitialization(context);
        }
        // Initialize command manager with client reference
        commandManager = new CommandManager(context, client, configManager);
        await commandManager.registerCommands();
        
        // Initialize views
        const ontologyProvider = new OntologyViewProvider(context, client);
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('ontologyExplorer', ontologyProvider)
        );
        
        // Initialize webview for graph visualization
        const graphProvider = new GraphWebviewProvider(context, client);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('ontologyGraph', graphProvider)
        );
        
        // Setup configuration change listener
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(async (e) => {
                if (e.affectsConfiguration('ontologyLSP')) {
                    await handleConfigurationChange(e);
                }
            })
        );
        
        // Setup workspace change listeners for learning
        if (configManager.get<boolean>('patternLearning.enabled')) {
            setupPatternLearning(context);
        }
        
        // Create and return extension API
        extensionAPI = new ExtensionAPI(client, configManager, telemetry);
        
        // Log successful activation
        telemetry.logEvent('extension.activated', {
            version: context.extension.packageJSON.version,
            mode: context.extensionMode === vscode.ExtensionMode.Development ? 'dev' : 'prod'
        });
        
        statusBar.setActive('Ontology LSP Ready');
        console.log('[Ontology LSP] Extension activated successfully');
        
        return extensionAPI;
        
    } catch (error) {
        console.error('[Ontology LSP] Failed to activate extension:', error);
        telemetry?.logError('activation.failed', error);
        vscode.window.showErrorMessage(`Failed to activate Ontology LSP: ${error}`);
        throw error;
    }
}

export async function deactivate(): Promise<void> {
    console.log('[Ontology LSP] Extension deactivating...');
    
    try {
        // Save learned patterns before shutdown
        if (teamSync) {
            await teamSync.saveLocalPatterns();
        }
        
        // Cleanup telemetry
        if (telemetry) {
            telemetry.logEvent('extension.deactivated');
            await telemetry.dispose();
        }
        
        // Stop performance monitoring
        performanceMonitor?.stop();
        
        // Cleanup status bar
        statusBar?.dispose();
        
        // Stop the language client
        if (client) {
            await client.stop();
        }
        
        console.log('[Ontology LSP] Extension deactivated successfully');
    } catch (error) {
        console.error('[Ontology LSP] Error during deactivation:', error);
    }
}

/**
 * Get the server module path, considering custom paths and bundled server
 */
function getServerPath(context: vscode.ExtensionContext): string {
    const customPath = configManager.get<string>('server.path');
    if (customPath) {
        return path.isAbsolute(customPath) ? customPath : path.join(context.extensionPath, customPath);
    }
    
    // Try multiple locations for the server
    const serverLocations = [
        // Typical packaged locations (if server bundled with the extension)
        path.join(context.extensionPath, 'server.js'),
        path.join(context.extensionPath, 'dist', 'server.js'),
        // Correct current project build locations
        path.join(context.extensionPath, 'dist', 'lsp', 'lsp.js'),
        // Absolute fallback for local dev workspace
        '/home/lightningralf/programming/ontology-lsp/dist/lsp/lsp.js',
        '/home/lightningralf/programming/ontology-lsp/dist/server.js' // legacy fallback
    ];
    
    const fs = require('fs');
    for (const location of serverLocations) {
        if (fs.existsSync(location)) {
            console.log(`[Ontology LSP] Found server at: ${location}`);
            return location;
        }
    }
    
    // Default fallback
    console.error('[Ontology LSP] Server not found in expected locations');
    return serverLocations[0];
}

/**
 * Setup post-initialization features that require server connection
 */
async function setupPostInitialization(context: vscode.ExtensionContext): Promise<void> {
    if (!client) return;
    
    // Register custom notifications from server
    client.onNotification('ontology/patternLearned', (params: any) => {
        if (configManager.get<boolean>('ui.showStatusBar')) {
            statusBar.setMessage(`Pattern learned: ${params.pattern}`);
        }
        telemetry.logEvent('pattern.learned', params);
    });
    
    client.onNotification('ontology/conceptDiscovered', (params: any) => {
        telemetry.logEvent('concept.discovered', params);
    });
    
    client.onNotification('ontology/performanceWarning', (params: any) => {
        vscode.window.showWarningMessage(`Performance warning: ${params.message}`);
        performanceMonitor.logWarning(params);
    });
    
    // Setup progress reporting with proper ProgressType
    const progressType = 'ontology/analyzing' as any;
    client.onProgress(progressType, 'begin', (params: any) => {
        statusBar.setProgress('Analyzing codebase...', params.percentage);
    });
    
    client.onProgress(progressType, 'report', (params: any) => {
        statusBar.setProgress(params.message, params.percentage);
    });
    
    client.onProgress(progressType, 'end', () => {
        statusBar.clearProgress();
    });
}

/**
 * Handle configuration changes
 */
async function handleConfigurationChange(e: vscode.ConfigurationChangeEvent): Promise<void> {
    if (!client) return;
    
    // Notify server of configuration change
    await client.sendNotification(DidChangeConfigurationNotification.type, {
        settings: vscode.workspace.getConfiguration('ontologyLSP')
    });
    
    // Handle specific configuration changes
    if (e.affectsConfiguration('ontologyLSP.enable')) {
        const enabled = configManager.get<boolean>('enable');
        if (enabled && client.state === State.Stopped) {
            await client.start();
        } else if (!enabled && client.state === State.Running) {
            await client.stop();
        }
    }
    
    if (e.affectsConfiguration('ontologyLSP.ui.showStatusBar')) {
        if (configManager.get<boolean>('ui.showStatusBar')) {
            statusBar.show();
        } else {
            statusBar.hide();
        }
    }
    
    if (e.affectsConfiguration('ontologyLSP.telemetry.enabled')) {
        if (configManager.get<boolean>('telemetry.enabled')) {
            await telemetry.initialize();
        } else {
            await telemetry.dispose();
        }
    }
}

/**
 * Setup pattern learning from user actions
 */
function setupPatternLearning(context: vscode.ExtensionContext): void {
    // Track rename operations for pattern learning
    context.subscriptions.push(
        vscode.workspace.onDidRenameFiles(async (e) => {
            for (const file of e.files) {
                await client?.sendNotification('ontology/fileRenamed', {
                    oldUri: file.oldUri.toString(),
                    newUri: file.newUri.toString()
                });
            }
        })
    );
    
    // Track text edits for pattern learning
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (e) => {
            if (e.contentChanges.length > 0 && e.document.languageId) {
                const changes = e.contentChanges.map(change => ({
                    range: client?.code2ProtocolConverter.asRange(change.range),
                    text: change.text
                }));
                
                await client?.sendNotification('ontology/documentChanged', {
                    uri: e.document.uri.toString(),
                    changes
                });
            }
        })
    );
}

/**
 * Enhance completion items with AI suggestions
 */
async function enhanceWithAISuggestions(items: any): Promise<any> {
    // This would integrate with an AI service
    // For now, just return the original items
    return items;
}

/**
 * Add propagated changes to rename results
 */
async function addPropagatedChanges(
    workspaceEdit: vscode.WorkspaceEdit | undefined,
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
): Promise<vscode.WorkspaceEdit | undefined> {
    if (!workspaceEdit || !client) return workspaceEdit;
    
    // Request propagated changes from server
    const propagated = await client.sendRequest('ontology/getPropagatedChanges', {
        uri: document.uri.toString(),
        position: client.code2ProtocolConverter.asPosition(position),
        newName
    });
    
    // Add propagated changes to workspace edit
    if (propagated && Array.isArray(propagated)) {
        for (const change of propagated) {
            const uri = vscode.Uri.parse(change.uri);
            const range = client.protocol2CodeConverter.asRange(change.range);
            workspaceEdit.replace(uri, range || new vscode.Range(0, 0, 0, 0), change.newText);
        }
    }
    
    return workspaceEdit;
}

/**
 * Create minimal API when extension is disabled
 */
function createMinimalAPI(): ExtensionAPI {
    return new ExtensionAPI(undefined, configManager, undefined);
}
