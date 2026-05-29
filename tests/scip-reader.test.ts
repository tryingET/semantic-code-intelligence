import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { create } from '@bufbuild/protobuf';
import {
    DocumentSchema,
    IndexSchema,
    MetadataSchema,
    OccurrenceSchema,
    PositionEncoding,
    ProtocolVersion,
    SymbolRole,
    serializeSCIP,
    TextEncoding,
    ToolInfoSchema,
} from '@c4312/scip';
import { assertOpenedScipArtifactWithinWorkspace, loadScipIndex } from '../src/core/scip-reader.js';

const fooSymbol = 'scip-go gomod example.com/acme Foo().';
const barSymbol = 'scip-go gomod example.com/acme Bar().';

function writeSampleScipIndex(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sci-scip-reader-'));
    const indexPath = join(dir, 'index.scip');
    const index = create(IndexSchema, {
        metadata: create(MetadataSchema, {
            version: ProtocolVersion.UnspecifiedProtocolVersion,
            toolInfo: create(ToolInfoSchema, { name: 'sci-test', version: '0.0.0' }),
            projectRoot: 'file:///tmp/sci-scip-reader',
            textDocumentEncoding: TextEncoding.UTF8,
        }),
        documents: [
            create(DocumentSchema, {
                relativePath: 'pkg/foo.go',
                language: 'go',
                positionEncoding: PositionEncoding.UTF8CodeUnitOffsetFromLineStart,
                occurrences: [
                    create(OccurrenceSchema, {
                        range: [2, 5, 8],
                        symbol: fooSymbol,
                        symbolRoles: SymbolRole.Definition,
                    }),
                    create(OccurrenceSchema, {
                        range: [3, 9, 12],
                        symbol: barSymbol,
                        symbolRoles: SymbolRole.ReadAccess,
                    }),
                    create(OccurrenceSchema, {
                        range: [0, 7, 20],
                        symbol: 'scip-go gomod fmt/',
                        symbolRoles: SymbolRole.Import,
                    }),
                ],
            }),
            create(DocumentSchema, {
                relativePath: 'pkg/bar.go',
                language: 'go',
                positionEncoding: PositionEncoding.UTF8CodeUnitOffsetFromLineStart,
                occurrences: [
                    create(OccurrenceSchema, {
                        range: [1, 5, 8],
                        symbol: barSymbol,
                        symbolRoles: SymbolRole.Definition,
                    }),
                    create(OccurrenceSchema, {
                        range: [2, 9, 12],
                        symbol: fooSymbol,
                        symbolRoles: SymbolRole.ReadAccess,
                    }),
                ],
            }),
        ],
    });
    writeFileSync(indexPath, serializeSCIP(index));
    return indexPath;
}

describe('SCIP reader', () => {
    test('loads a SCIP index and summarizes documents, occurrences, and languages', async () => {
        const reader = await loadScipIndex(writeSampleScipIndex());
        const summary = reader.summary();

        expect(summary.documentCount).toBe(2);
        expect(summary.occurrenceCount).toBe(5);
        expect(summary.languages).toEqual(['go']);
        expect(summary.workspaceRoot).toBe('file:///tmp/sci-scip-reader');
        expect(summary.indexPath.endsWith('/index.scip')).toBe(true);
    });

    test('returns symbol definitions and references with normalized roles', async () => {
        const reader = await loadScipIndex(writeSampleScipIndex());
        const definitions = reader.definitions(fooSymbol);
        const references = reader.references(fooSymbol);

        expect(definitions).toHaveLength(1);
        expect(definitions[0].file).toBe('pkg/foo.go');
        expect(definitions[0].roles.definition).toBe(true);
        expect(definitions[0].roles.reference).toBe(false);
        expect(definitions[0].range).toEqual({ start: { line: 2, character: 5 }, end: { line: 2, character: 8 } });

        expect(references).toHaveLength(1);
        expect(references[0].file).toBe('pkg/bar.go');
        expect(references[0].roles.reference).toBe(true);
        expect(references[0].roles.read).toBe(true);
    });

    test('returns file-local occurrences and import role metadata', async () => {
        const reader = await loadScipIndex(writeSampleScipIndex());
        const occurrences = reader.occurrencesForFile('pkg/foo.go');
        const imported = occurrences.find((occurrence) => occurrence.roles.import);

        expect(occurrences).toHaveLength(3);
        expect(imported?.symbol).toBe('scip-go gomod fmt/');
        expect(imported?.roles.reference).toBe(true);
    });

    test('normalizes absolute file seeds relative to SCIP project root', async () => {
        const reader = await loadScipIndex(writeSampleScipIndex());
        const occurrences = reader.occurrencesForFile('/tmp/sci-scip-reader/pkg/foo.go');

        expect(occurrences).toHaveLength(3);
        expect(occurrences[0].file).toBe('pkg/foo.go');
    });

    test('normalizes absolute file seeds relative to the supplied workspace root when SCIP metadata omits projectRoot', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sci-scip-workspace-root-'));
        const otherCwd = mkdtempSync(join(tmpdir(), 'sci-scip-other-cwd-'));
        const indexPath = join(dir, 'index.scip');
        const index = create(IndexSchema, {
            metadata: create(MetadataSchema, {
                version: ProtocolVersion.UnspecifiedProtocolVersion,
                toolInfo: create(ToolInfoSchema, { name: 'sci-test', version: '0.0.0' }),
                textDocumentEncoding: TextEncoding.UTF8,
            }),
            documents: [
                create(DocumentSchema, {
                    relativePath: 'pkg/foo.go',
                    language: 'go',
                    positionEncoding: PositionEncoding.UTF8CodeUnitOffsetFromLineStart,
                    occurrences: [
                        create(OccurrenceSchema, {
                            range: [1, 1, 4],
                            symbol: fooSymbol,
                            symbolRoles: SymbolRole.Definition,
                        }),
                    ],
                }),
            ],
        });
        writeFileSync(indexPath, serializeSCIP(index));

        const previousCwd = process.cwd();
        try {
            process.chdir(otherCwd);
            const reader = await loadScipIndex(indexPath, { workspaceRoot: dir });
            const occurrences = reader.occurrencesForFile(join(dir, 'pkg', 'foo.go'));
            expect(occurrences).toHaveLength(1);
            expect(occurrences[0].file).toBe('pkg/foo.go');
        } finally {
            process.chdir(previousCwd);
        }
    });

    test('normalizes absolute SCIP file seeds whose basename begins with dot-dot text', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sci-scip-dotdot-'));
        const indexPath = join(dir, 'index.scip');
        const index = create(IndexSchema, {
            metadata: create(MetadataSchema, {
                version: ProtocolVersion.UnspecifiedProtocolVersion,
                toolInfo: create(ToolInfoSchema, { name: 'sci-test', version: '0.0.0' }),
                projectRoot: pathToFileURL(dir).href,
                textDocumentEncoding: TextEncoding.UTF8,
            }),
            documents: [
                create(DocumentSchema, {
                    relativePath: '..foo.go',
                    language: 'go',
                    positionEncoding: PositionEncoding.UTF8CodeUnitOffsetFromLineStart,
                    occurrences: [
                        create(OccurrenceSchema, {
                            range: [1, 1, 4],
                            symbol: fooSymbol,
                            symbolRoles: SymbolRole.Definition,
                        }),
                    ],
                }),
            ],
        });
        writeFileSync(indexPath, serializeSCIP(index));

        const reader = await loadScipIndex(indexPath, { workspaceRoot: dir });
        const occurrences = reader.occurrencesForFile(join(dir, '..foo.go'));
        expect(occurrences).toHaveLength(1);
        expect(occurrences[0].file).toBe('..foo.go');
    });

    test('can enforce workspace containment and max artifact size', async () => {
        const indexPath = writeSampleScipIndex();
        await expect(loadScipIndex(indexPath, { workspaceRoot: process.cwd() })).rejects.toThrow(
            'scipIndexPath must stay within the workspace'
        );
        await expect(loadScipIndex(indexPath, { maxBytes: 1 })).rejects.toThrow(
            'SCIP index exceeds maximum allowed size'
        );
    });

    test('rejects workspace-contained symlinks that resolve outside the workspace', async () => {
        const outsideIndexPath = writeSampleScipIndex();
        const workspace = mkdtempSync(join(tmpdir(), 'sci-scip-workspace-'));
        const nestedDir = join(workspace, 'artifacts');
        mkdirSync(nestedDir, { recursive: true });
        const symlinkPath = join(nestedDir, 'index.scip');
        symlinkSync(outsideIndexPath, symlinkPath);

        await expect(loadScipIndex(symlinkPath, { workspaceRoot: workspace })).rejects.toThrow(
            'scipIndexPath must stay within the workspace'
        );
    });

    test('reports malformed SCIP bytes as invalid caller input', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'sci-scip-malformed-'));
        const malformedPath = join(workspace, 'bad.scip');
        writeFileSync(malformedPath, 'not a scip index');

        await expect(loadScipIndex(malformedPath, { workspaceRoot: workspace })).rejects.toThrow(
            'Failed to parse SCIP index'
        );
    });

    test('verifies opened artifact file descriptors stay within the workspace', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'sci-scip-fd-workspace-'));
        const insidePath = join(workspace, 'inside.scip');
        const outsideDir = mkdtempSync(join(tmpdir(), 'sci-scip-fd-outside-'));
        const outsidePath = join(outsideDir, 'outside.scip');
        writeFileSync(insidePath, 'inside');
        writeFileSync(outsidePath, 'outside');
        const realWorkspaceRoot = await realpath(workspace);

        const insideHandle = await open(insidePath, 'r');
        try {
            await expect(
                assertOpenedScipArtifactWithinWorkspace(insideHandle, realWorkspaceRoot, insidePath)
            ).resolves.toBeUndefined();
        } finally {
            await insideHandle.close();
        }

        const outsideHandle = await open(outsidePath, 'r');
        try {
            await expect(
                assertOpenedScipArtifactWithinWorkspace(outsideHandle, realWorkspaceRoot, outsidePath)
            ).rejects.toThrow('scipIndexPath must stay within the workspace');
        } finally {
            await outsideHandle.close();
        }
    });
});
