import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type TextSearchKind = 'literal' | 'word' | 'regex' | string;

export function uriToWorkspacePath(uri: string, workspaceRoot: string): string {
    const root = path.resolve(workspaceRoot || process.cwd());
    const workspacePrefix = 'file://workspace';
    if (uri.startsWith(workspacePrefix)) {
        const sub = uri.length > workspacePrefix.length ? uri.substring(workspacePrefix.length) : '';
        const rel = decodeURIComponent(sub.replace(/^\/+/, ''));
        return path.resolve(rel ? path.join(root, rel) : root);
    }
    if (uri.startsWith('file://')) {
        try {
            return fileURLToPath(uri);
        } catch {
            const body = uri.replace(/^file:\/\//, '');
            return path.isAbsolute(body) ? body : path.resolve('/', body);
        }
    }
    return path.isAbsolute(uri) ? path.resolve(uri) : path.resolve(root, uri);
}

export function normalizeWorkspaceUri(uri: string | undefined | null, workspaceRoot: string, fallback = 'file://workspace'): string {
    const raw = typeof uri === 'string' && uri.trim() ? uri.trim() : fallback;
    return pathToFileURL(uriToWorkspacePath(raw, workspaceRoot)).href;
}

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textSearchPattern(query: string, kind: TextSearchKind = 'literal'): { pattern: string; useRegex: boolean } {
    if (kind === 'word') return { pattern: `\\b${escapeRegex(query)}\\b`, useRegex: true };
    if (kind === 'regex') return { pattern: query, useRegex: true };
    return { pattern: query, useRegex: false };
}
