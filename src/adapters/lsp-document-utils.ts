import { wordAtIdentifierPosition } from '../core/identifier-token.js';
import { normalizeUri } from './utils.js';

export function rememberDocumentText(documentTextByUri: Map<string, string>, uri: string, text: string): void {
    documentTextByUri.set(uri, text);
    try {
        documentTextByUri.set(normalizeUri(uri), text);
    } catch {}
}

export function forgetDocumentText(documentTextByUri: Map<string, string>, uri: string): void {
    documentTextByUri.delete(uri);
    try {
        documentTextByUri.delete(normalizeUri(uri));
    } catch {}
}

export function applyDocumentChanges(documentTextByUri: Map<string, string>, uri: string, contentChanges: any[]): string | undefined {
    if (!Array.isArray(contentChanges)) return undefined;
    let text = documentTextByUri.get(uri);
    try {
        text = text ?? documentTextByUri.get(normalizeUri(uri));
    } catch {}

    for (const change of contentChanges) {
        if (typeof change?.text !== 'string') continue;
        if (!change.range && change.rangeLength === undefined) {
            text = change.text;
            continue;
        }
        if (text === undefined || !change.range) continue;
        text = applyRangeChange(text, change.range, change.text);
    }

    return text;
}

function applyRangeChange(text: string, range: any, replacement: string): string {
    const start = positionToOffset(text, range.start);
    const end = positionToOffset(text, range.end);
    return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function positionToOffset(text: string, position: any): number {
    const targetLine = Math.max(0, Number(position?.line ?? 0));
    const targetCharacter = Math.max(0, Number(position?.character ?? 0));
    let offset = 0;
    let line = 0;
    while (line < targetLine && offset < text.length) {
        const next = text.indexOf('\n', offset);
        if (next === -1) return text.length;
        offset = next + 1;
        line += 1;
    }
    return Math.min(offset + targetCharacter, text.length);
}

export function wordAtPosition(text: string, pos: { line: number; character: number }): string | null {
    return wordAtIdentifierPosition(text, pos);
}
