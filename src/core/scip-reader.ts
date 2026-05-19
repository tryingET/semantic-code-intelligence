import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { deserializeSCIP, SymbolRole, type Index, type Occurrence } from '@c4312/scip';

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
        const normalized = normalizeRelativePath(file);
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

export async function loadScipIndex(indexPath: string): Promise<ScipIndexReader> {
    const bytes = await fs.readFile(indexPath);
    const index = deserializeSCIP(bytes);
    return new ScipIndexReader(index, indexPath);
}

function normalizeRelativePath(file: string): string {
    return file.split(path.sep).join('/').replace(/^\.\//, '');
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
