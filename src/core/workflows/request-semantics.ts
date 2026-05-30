import { CoreError } from '../errors.js';
import { normalizeWorkspaceInputUri, workspaceInputToPath } from '../workspace-input.js';

export type TextSearchKind = 'literal' | 'word' | 'regex' | string;

export function uriToWorkspacePath(uri: string, workspaceRoot: string): string {
    return workspaceInputToPath(uri, workspaceRoot);
}

export function normalizeWorkspaceUri(
    uri: string | undefined | null,
    workspaceRoot: string,
    fallback = 'file://workspace'
): string {
    return normalizeWorkspaceInputUri(uri, workspaceRoot, fallback);
}

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasOverlappingAlternationQuantifier(pattern: string): boolean {
    const quantifiedAlternation = /\(([^()]*\|[^()]*)\)\s*(?:[+*]|\{\d*,?\d*\})/g;
    for (const match of pattern.matchAll(quantifiedAlternation)) {
        const alternatives = match[1]
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean);
        for (let i = 0; i < alternatives.length; i++) {
            for (let j = 0; j < alternatives.length; j++) {
                if (i !== j && alternatives[j].startsWith(alternatives[i])) return true;
            }
        }
    }
    return false;
}

export function unsafeTextSearchRegexReason(pattern: string): string | null {
    if (pattern.length > 512) return 'regex pattern exceeds 512 characters';
    if (/\\[1-9]/.test(pattern) || /\\k<[^>]+>/.test(pattern)) return 'backreferences are not allowed';
    if (/\(\?<[!=]/.test(pattern)) return 'lookbehind assertions are not allowed';
    if (/\([^)]*[+*][^)]*\)\s*(?:[+*]|\{\d*,?\d*\})/.test(pattern)) {
        return 'nested unbounded quantifiers are not allowed';
    }
    if (/\([^)]*\{\d+,\}?[^)]*\)\s*(?:[+*]|\{\d*,?\d*\})/.test(pattern)) {
        return 'nested repeated quantifiers are not allowed';
    }
    if (hasOverlappingAlternationQuantifier(pattern)) {
        return 'overlapping quantified alternations are not allowed';
    }
    return null;
}

export function textSearchPattern(
    query: string,
    kind: TextSearchKind = 'literal'
): { pattern: string; useRegex: boolean } {
    if (kind === 'word') return { pattern: `\\b${escapeRegex(query)}\\b`, useRegex: true };
    if (kind === 'regex') {
        const unsafeReason = unsafeTextSearchRegexReason(query);
        if (unsafeReason) {
            throw new CoreError('InvalidParams', `Unsafe text_search regex: ${unsafeReason}`, { field: 'query' });
        }
        return { pattern: query, useRegex: true };
    }
    return { pattern: query, useRegex: false };
}
