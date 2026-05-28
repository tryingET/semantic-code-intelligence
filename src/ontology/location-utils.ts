import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface LocationLike {
    uri: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

export function toFileUri(input: string): string {
    try {
        if (typeof input !== 'string' || input.length === 0) return '';
        if (input.startsWith('file://')) return input;
        const abs = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
        return pathToFileURL(abs).href;
    } catch {
        return input.startsWith('file://') ? input : '';
    }
}

export function normalizeUri(uri: string): string {
    try {
        if (!uri) return '';
        // Support workspace pseudo-URI: file://workspace[/subpath]
        const WORKSPACE_PREFIX = 'file://workspace';
        if (uri.startsWith(WORKSPACE_PREFIX)) {
            const ws = process.env.SEMANTIC_CODE_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();
            const sub = uri.length > WORKSPACE_PREFIX.length ? uri.substring(WORKSPACE_PREFIX.length) : '';
            const rel = sub.replace(/^\/+/, '');
            const p = rel ? path.join(ws, rel) : ws;
            return pathToFileURL(path.resolve(p)).href;
        }
        if (uri.startsWith('file://')) {
            // Ensure it round-trips
            const p = fileURLToPath(uri);
            return pathToFileURL(p).href;
        }
        return toFileUri(uri);
    } catch {
        return '';
    }
}

export function sanitizeRange(range: any): LocationLike['range'] | null {
    try {
        const rawRange = typeof range === 'string' ? JSON.parse(range) : range;
        const s = rawRange?.start ?? {};
        const e = rawRange?.end ?? {};
        const start = {
            line: toNumber(s.line),
            character: toNumber(s.character),
        };
        const end = {
            line: toNumber(e.line),
            character: toNumber(e.character),
        };
        if (
            !isFiniteNum(start.line) ||
            !isFiniteNum(start.character) ||
            !isFiniteNum(end.line) ||
            !isFiniteNum(end.character)
        ) {
            return null;
        }
        return { start, end };
    } catch {
        return null;
    }
}

export function isValidLocation(loc: any): loc is LocationLike {
    if (!loc || typeof loc !== 'object') return false;
    if (!loc.uri || typeof loc.uri !== 'string' || loc.uri.length === 0) return false;
    const r = sanitizeRange(loc.range);
    return !!r;
}

export function normalizeLocation(loc: any): LocationLike | null {
    const uri = normalizeUri(loc?.uri);
    const range = sanitizeRange(loc?.range);
    const normalized = uri && range ? { uri, range } : null;
    return normalized && isValidLocation(normalized) ? normalized : null;
}

function toNumber(v: any): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim().length > 0) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return NaN;
}

function isFiniteNum(v: any): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}
