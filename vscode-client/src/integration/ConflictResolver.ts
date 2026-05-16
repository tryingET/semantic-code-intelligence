/**
 * Conflict Resolver
 * Handles conflicts with built-in TypeScript server and other extensions
 */

import * as vscode from 'vscode';

export class ConflictResolver {
    constructor(private context: vscode.ExtensionContext) {}
    
    async resolveConflicts(): Promise<void> {
        // Check for TypeScript extension
        const tsExtension = vscode.extensions.getExtension('vscode.typescript-language-features');
        
        if (tsExtension && tsExtension.isActive) {
            // In augment mode, keep the TS server enabled to leverage native features
            // like implementations, refactorings, etc. Just log for visibility.
            const skip = await this.context.globalState.get<boolean>('ontology.skipTsConflict');
            if (!skip) {
                vscode.window.showInformationMessage(
                    'Ontology LSP will augment the built-in TypeScript features. You can change this behavior in settings.',
                    'OK', 'Don\'t show again'
                ).then(async (choice) => {
                    if (choice === "Don't show again") {
                        await this.context.globalState.update('ontology.skipTsConflict', true);
                    }
                });
            }
        }
        
        // Check for other language servers
        this.checkForConflictingExtensions();
    }
    
    private checkForConflictingExtensions(): void {
        const potentialConflicts = [
            'ms-python.python',
            'dbaeumer.vscode-eslint',
            'esbenp.prettier-vscode'
        ];
        
        for (const extensionId of potentialConflicts) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (extension && extension.isActive) {
                console.log(`[Ontology] Detected ${extensionId}, adjusting compatibility settings`);
            }
        }
    }
}
