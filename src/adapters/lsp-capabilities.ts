import type { ServerCapabilities } from 'vscode-languageserver';
import { TextDocumentSyncKind } from 'vscode-languageserver';

export function createLspCapabilities(config: {
    enableCodeLens?: boolean;
    enableFolding?: boolean;
}): ServerCapabilities<any> {
    return {
        textDocumentSync: {
            openClose: true,
            change: TextDocumentSyncKind.Incremental,
            willSave: false,
            willSaveWaitUntil: false,
            save: { includeText: false },
        },
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        completionProvider: {
            triggerCharacters: ['.', ':', '(', '<'],
            allCommitCharacters: [' ', '\t', '\n', ';', ',', ')'],
        },
        executeCommandProvider: {
            commands: ['ontology.explore'],
        },
        hoverProvider: false,
        documentSymbolProvider: false,
        workspaceSymbolProvider: false,
        codeActionProvider: false,
        codeLensProvider: config.enableCodeLens ? { resolveProvider: false } : undefined,
        documentFormattingProvider: false,
        foldingRangeProvider: config.enableFolding ? true : undefined,
    };
}
