import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { normalizeWorkspaceInputUri, workspaceInputToPath } from '../core/workspace-input.js';
import { openWorkspaceFileForRead } from '../core/workspace-path.js';
import { wordAtPosition } from './lsp-document-utils.js';
import { normalizeUri } from './utils.js';

export function resolveLspWorkspaceRoot(config: { workspaceRoot?: string }, coreAnalyzer: any): string {
    const configured = config.workspaceRoot || coreAnalyzer?.config?.workspaceRoot;
    return path.resolve(typeof configured === 'string' && configured.trim() ? configured : process.cwd());
}

export function normalizeLspDocumentUri(uri: string, workspaceRoot: string): string {
    return normalizeWorkspaceInputUri(uri, workspaceRoot);
}

export function lspInputPathOrNull(uri: string, workspaceRoot: string): string | null {
    try {
        return workspaceInputToPath(uri, workspaceRoot);
    } catch {
        return null;
    }
}

export function isOutsideWorkspaceRelative(relativePath: string): boolean {
    return !relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
}

export async function extractIdentifierAtPosition(
    uri: string,
    position: { line: number; character: number },
    options: { workspaceRoot: string; documentTextByUri: Map<string, string> }
): Promise<string> {
    const fallback = `symbol_at_${position.line}_${position.character}`;
    let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
    try {
        const cachedText = options.documentTextByUri.get(uri);
        if (cachedText !== undefined) return wordAtPosition(cachedText, position) || fallback;
        const fsPath = workspaceInputToPath(uri, options.workspaceRoot);
        opened = await openWorkspaceFileForRead(fsPath, {
            workspaceRoot: options.workspaceRoot,
            inputLabel: 'LSP document uri',
        });
        const text = await opened.handle.readFile('utf8');
        return wordAtPosition(text, position) || fallback;
    } catch {
        return fallback;
    } finally {
        await opened?.handle.close().catch(() => undefined);
    }
}

export async function containedLspUriOrNull(
    uri: string,
    options: { workspaceRoot: string; documentTextByUri: Map<string, string> }
): Promise<string | null> {
    let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
    const fsPath = lspInputPathOrNull(uri, options.workspaceRoot);
    if (!fsPath) return null;
    try {
        opened = await openWorkspaceFileForRead(fsPath, {
            workspaceRoot: options.workspaceRoot,
            inputLabel: 'LSP document uri',
        });
        return normalizeUri(opened.realPath);
    } catch {
        const cachedText = options.documentTextByUri.get(uri) ?? options.documentTextByUri.get(normalizeUri(fsPath));
        if (cachedText === undefined) return null;

        const absPath = path.resolve(fsPath);
        const rel = path.relative(options.workspaceRoot, absPath);
        if (isOutsideWorkspaceRelative(rel)) return null;

        try {
            await fs.lstat(absPath);
            return null;
        } catch (error: any) {
            if (error?.code !== 'ENOENT') return null;
            return normalizeUri(absPath);
        }
    } finally {
        await opened?.handle.close().catch(() => undefined);
    }
}
