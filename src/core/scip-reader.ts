import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeSCIP, SymbolRole, type Index, type Occurrence } from '@c4312/scip';
import { CoreError } from './errors.js';

export type ScipRange = {
    start: { line: number; character: number };
    end: { line: number; character: number };
};

export type ScipOccurrenceRecord = {
    file: string;
    language: string;
    symbol: string;
    range: ScipRange;
    roles: {
        definition: boolean;
        import: boolean;
        reference: boolean;
        read: boolean;
        write: boolean;
        generated: boolean;
        test: boolean;
        forwardDefinition: boolean;
    };
};

export type ScipIndexSummary = {
    indexPath: string;
    generatedAt: string | null;
    workspaceRoot: string | null;
    documentCount: number;
    occurrenceCount: number;
    symbolCount: number;
    languages: string[];
};

export type ScipLoadOptions = {
    workspaceRoot?: string;
    maxBytes?: number;
};

const DEFAULT_MAX_SCIP_BYTES = 50 * 1024 * 1024;

export class ScipIndexReader {
    readonly indexPath: string;
    readonly index: Index;
    private readonly occurrences: ScipOccurrenceRecord[];

    constructor(index: Index, indexPath: string) {
        this.index = index;
        this.indexPath = path.resolve(indexPath);
        this.occurrences = this.flattenOccurrences(index);
    }

    summary(): ScipIndexSummary {
        const languages = Array.from(new Set(this.index.documents.map((doc) => doc.language).filter(Boolean))).sort();
        const symbolCount = this.index.documents.reduce((sum, doc) => sum + doc.symbols.length, 0) + this.index.externalSymbols.length;
        return {
            indexPath: this.indexPath,
            generatedAt: null,
            workspaceRoot: this.index.metadata?.projectRoot || null,
            documentCount: this.index.documents.length,
            occurrenceCount: this.occurrences.length,
            symbolCount,
            languages,
        };
    }

    allOccurrences(): ScipOccurrenceRecord[] {
        return [...this.occurrences];
    }

    occurrencesForFile(file: string): ScipOccurrenceRecord[] {
        const normalized = normalizeInputFilePath(file, this.index.metadata?.projectRoot || null);
        return this.occurrences.filter((occurrence) => occurrence.file === normalized);
    }

    definitions(symbol?: string): ScipOccurrenceRecord[] {
        return this.occurrences.filter((occurrence) => occurrence.roles.definition && (!symbol || occurrence.symbol === symbol));
    }

    references(symbol: string): ScipOccurrenceRecord[] {
        return this.occurrences.filter((occurrence) => occurrence.symbol === symbol && occurrence.roles.reference);
    }

    private flattenOccurrences(index: Index): ScipOccurrenceRecord[] {
        const records: ScipOccurrenceRecord[] = [];
        for (const doc of index.documents) {
            const file = normalizeRelativePath(doc.relativePath);
            for (const occurrence of doc.occurrences) {
                if (!occurrence.symbol) continue;
                records.push({
                    file,
                    language: doc.language,
                    symbol: occurrence.symbol,
                    range: normalizeRange(occurrence),
                    roles: rolesFor(occurrence.symbolRoles),
                });
            }
        }
        return records;
    }
}

export async function loadScipIndex(indexPath: string, options: ScipLoadOptions = {}): Promise<ScipIndexReader> {
    const resolved = await resolveScipArtifact(indexPath, options);
    const handle = await fs.open(resolved.path, 'r').catch((error) => {
        throw new CoreError('InvalidParams', `Failed to open SCIP index: ${error instanceof Error ? error.message : String(error)}`, { scipIndexPath: indexPath });
    });

    try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
            throw new CoreError('InvalidParams', 'scipIndexPath must point to a file', { scipIndexPath: indexPath });
        }
        if (stat.size > resolved.maxBytes) {
            throw new CoreError('InvalidParams', 'SCIP index exceeds maximum allowed size', { scipIndexPath: indexPath, bytes: stat.size, maxBytes: resolved.maxBytes });
        }
        const bytes = await handle.readFile();
        const index = deserializeScipBytes(bytes, indexPath);
        return new ScipIndexReader(index, resolved.path);
    } finally {
        await handle.close().catch(() => undefined);
    }
}

export async function resolveScipArtifact(indexPath: string, options: ScipLoadOptions = {}): Promise<{ path: string; bytes: number; maxBytes: number }> {
    const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
    const candidate = path.resolve(workspaceRoot || process.cwd(), indexPath);
    const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_SCIP_BYTES);

    if (workspaceRoot) {
        const lexicalRel = path.relative(workspaceRoot, candidate);
        if (!lexicalRel || lexicalRel.startsWith('..') || path.isAbsolute(lexicalRel)) {
            throw new CoreError('InvalidParams', 'scipIndexPath must stay within the workspace', { scipIndexPath: indexPath });
        }
    }

    const realCandidate = await fs.realpath(candidate).catch((error) => {
        throw new CoreError('InvalidParams', `Failed to stat SCIP index: ${error instanceof Error ? error.message : String(error)}`, { scipIndexPath: indexPath });
    });

    if (workspaceRoot) {
        const realWorkspaceRoot = await fs.realpath(workspaceRoot).catch((error) => {
            throw new CoreError('InvalidParams', `Failed to stat workspace root: ${error instanceof Error ? error.message : String(error)}`, { scipIndexPath: indexPath });
        });
        const realRel = path.relative(realWorkspaceRoot, realCandidate);
        if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel)) {
            throw new CoreError('InvalidParams', 'scipIndexPath must stay within the workspace', { scipIndexPath: indexPath });
        }
    }

    const stat = await fs.stat(realCandidate).catch((error) => {
        throw new CoreError('InvalidParams', `Failed to stat SCIP index: ${error instanceof Error ? error.message : String(error)}`, { scipIndexPath: indexPath });
    });
    if (!stat.isFile()) {
        throw new CoreError('InvalidParams', 'scipIndexPath must point to a file', { scipIndexPath: indexPath });
    }

    if (stat.size > maxBytes) {
        throw new CoreError('InvalidParams', 'SCIP index exceeds maximum allowed size', { scipIndexPath: indexPath, bytes: stat.size, maxBytes });
    }

    return { path: realCandidate, bytes: stat.size, maxBytes };
}

function deserializeScipBytes(bytes: Uint8Array, indexPath: string): Index {
    try {
        return deserializeSCIP(bytes);
    } catch (error) {
        throw new CoreError('InvalidParams', `Failed to parse SCIP index: ${error instanceof Error ? error.message : String(error)}`, { scipIndexPath: indexPath });
    }
}

function normalizeRelativePath(file: string): string {
    return file.split(path.sep).join('/').replace(/^\.\//, '');
}

function normalizeInputFilePath(file: string, projectRoot: string | null): string {
    if (!path.isAbsolute(file)) return normalizeRelativePath(file);

    const roots = [projectRoot, process.cwd()]
        .map((root) => rootToPath(root))
        .filter((root): root is string => !!root)
        .map((root) => path.resolve(root));

    for (const root of roots) {
        const rel = path.relative(root, file);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return normalizeRelativePath(rel);
    }
    return normalizeRelativePath(file);
}

function rootToPath(root: string | null | undefined): string | null {
    if (!root) return null;
    if (root.startsWith('file://')) {
        try {
            return fileURLToPath(root);
        } catch {
            return null;
        }
    }
    return root;
}

function normalizeRange(occurrence: Occurrence): ScipRange {
    const range = occurrence.range;
    const startLine = range[0] ?? 0;
    const startCharacter = range[1] ?? 0;
    const endLine = range.length === 3 ? startLine : (range[2] ?? startLine);
    const endCharacter = range.length === 3 ? (range[2] ?? startCharacter) : (range[3] ?? startCharacter);
    return {
        start: { line: startLine, character: startCharacter },
        end: { line: endLine, character: endCharacter },
    };
}

function rolesFor(symbolRoles: number) {
    const definition = hasRole(symbolRoles, SymbolRole.Definition) || hasRole(symbolRoles, SymbolRole.ForwardDefinition);
    return {
        definition,
        import: hasRole(symbolRoles, SymbolRole.Import),
        reference: !definition,
        read: hasRole(symbolRoles, SymbolRole.ReadAccess),
        write: hasRole(symbolRoles, SymbolRole.WriteAccess),
        generated: hasRole(symbolRoles, SymbolRole.Generated),
        test: hasRole(symbolRoles, SymbolRole.Test),
        forwardDefinition: hasRole(symbolRoles, SymbolRole.ForwardDefinition),
    };
}

function hasRole(symbolRoles: number, role: SymbolRole): boolean {
    return (symbolRoles & role) !== 0;
}
