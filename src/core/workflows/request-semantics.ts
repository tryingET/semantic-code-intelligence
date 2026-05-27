import { normalizeWorkspaceInputUri, workspaceInputToPath } from '../workspace-input.js';

export type TextSearchKind = 'literal' | 'word' | 'regex' | string;

export function uriToWorkspacePath(uri: string, workspaceRoot: string): string {
    return workspaceInputToPath(uri, workspaceRoot);
}

export function normalizeWorkspaceUri(uri: string | undefined | null, workspaceRoot: string, fallback = 'file://workspace'): string {
    return normalizeWorkspaceInputUri(uri, workspaceRoot, fallback);
}

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textSearchPattern(query: string, kind: TextSearchKind = 'literal'): { pattern: string; useRegex: boolean } {
    if (kind === 'word') return { pattern: `\\b${escapeRegex(query)}\\b`, useRegex: true };
    if (kind === 'regex') return { pattern: query, useRegex: true };
    return { pattern: query, useRegex: false };
}
