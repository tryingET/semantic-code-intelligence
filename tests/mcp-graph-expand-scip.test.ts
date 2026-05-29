import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from '@bufbuild/protobuf';
import {
    DocumentSchema,
    IndexSchema,
    MetadataSchema,
    OccurrenceSchema,
    PositionEncoding,
    ProtocolVersion,
    SymbolRole,
    TextEncoding,
    ToolInfoSchema,
    serializeSCIP,
} from '@c4312/scip';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig } from './test-helpers';

const fooSymbol = 'scip-go gomod example.com/acme Foo().';
const barSymbol = 'scip-go gomod example.com/acme Bar().';

async function parse(res: any) {
    const txt = res?.content?.[0]?.text;
    try {
        return JSON.parse(txt);
    } catch {
        return null;
    }
}

function writeSampleScipIndex(): string {
    const dir = join(process.cwd(), '.test-results', 'scip-graph-expand');
    mkdirSync(dir, { recursive: true });
    const indexPath = join(dir, `index-${Date.now()}-${Math.random().toString(16).slice(2)}.scip`);
    const index = create(IndexSchema, {
        metadata: create(MetadataSchema, {
            version: ProtocolVersion.UnspecifiedProtocolVersion,
            toolInfo: create(ToolInfoSchema, { name: 'sci-test', version: '0.0.0' }),
            projectRoot: `file://${process.cwd()}`,
            textDocumentEncoding: TextEncoding.UTF8,
        }),
        documents: [
            create(DocumentSchema, {
                relativePath: 'pkg/foo.go',
                language: 'go',
                positionEncoding: PositionEncoding.UTF8CodeUnitOffsetFromLineStart,
                occurrences: [
                    create(OccurrenceSchema, {
                        range: [0, 7, 20],
                        symbol: 'scip-go gomod fmt/',
                        symbolRoles: SymbolRole.Import,
                    }),
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

describe('MCP graph_expand SCIP backend', () => {
    let analyzer: CodeAnalyzer;
    let mcp: MCPAdapter;

    beforeAll(async () => {
        const config = createTestConfig({ workspaceRoot: process.cwd() });
        const shared = new SharedServices(config);
        await shared.initialize();
        const lm = new LayerManager(config, shared.eventBus);
        await lm.initialize();
        analyzer = new CodeAnalyzer(lm, shared, config, shared.eventBus);
        await analyzer.initialize();
        mcp = new MCPAdapter(analyzer);
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
    });

    test('uses explicit SCIP index for file import/export evidence without auto-indexing', async () => {
        const scipIndexPath = writeSampleScipIndex();
        const res = await mcp.handleToolCall('graph_expand', {
            file: 'pkg/foo.go',
            edges: ['imports', 'exports'],
            scipIndexPath,
            limit: 10,
        });
        const obj = await parse(res);

        expect(obj.impactSummary?.backend).toBe('scip');
        expect(obj.impactSummary?.freshness).toBe('unknown');
        expect(obj.impactSummary?.provenance?.indexPath).toBe(scipIndexPath);
        expect(obj.scip?.documentCount).toBe(2);
        expect(obj.neighbors.imports).toHaveLength(1);
        expect(obj.neighbors.exports).toHaveLength(1);
        expect(obj.neighbors.exports[0].symbol).toBe(fooSymbol);
    });

    test('uses explicit SCIP index for symbol reference evidence', async () => {
        const scipIndexPath = writeSampleScipIndex();
        const res = await mcp.handleToolCall('graph_expand', {
            symbol: fooSymbol,
            edges: ['callers', 'exports', 'callees'],
            scipIndexPath,
            limit: 10,
        });
        const obj = await parse(res);

        expect(obj.impactSummary?.backend).toBe('scip');
        expect(obj.impactSummary?.counts?.callers).toBe(1);
        expect(obj.impactSummary?.counts?.exports).toBe(1);
        expect(obj.neighbors.callers[0].file).toBe('pkg/bar.go');
        expect(obj.neighbors.exports[0].file).toBe('pkg/foo.go');
        expect(obj.impactSummary?.limitations).toContain(
            'callers: SCIP backend returns symbol references, not proven call sites'
        );
        expect(obj.impactSummary?.limitations).toContain('callees: SCIP reader does not infer callee edges yet');
    });

    test('fails closed for explicit invalid SCIP artifacts', async () => {
        const malformedPath = join(process.cwd(), '.test-results', 'scip-graph-expand', 'not-scip.scip');
        mkdirSync(join(process.cwd(), '.test-results', 'scip-graph-expand'), { recursive: true });
        writeFileSync(malformedPath, 'not a scip index');

        const malformed = await mcp.handleToolCall('graph_expand', {
            file: 'pkg/foo.go',
            edges: ['imports'],
            scipIndexPath: malformedPath,
        });
        expect(malformed.isError).toBe(true);

        const outsidePath = join(tmpdir(), 'outside-sci-index.scip');
        writeFileSync(outsidePath, 'not a scip index');
        const outside = await mcp.handleToolCall('graph_expand', {
            file: 'pkg/foo.go',
            edges: ['imports'],
            scipIndexPath: outsidePath,
        });
        expect(outside.isError).toBe(true);
        expect(String(outside.content?.[0]?.text || '')).toContain('scipIndexPath must stay within the workspace');

        const symlinkDir = join(process.cwd(), '.test-results', 'scip-graph-expand');
        mkdirSync(symlinkDir, { recursive: true });
        const symlinkPath = join(symlinkDir, `outside-${Date.now()}-${Math.random().toString(16).slice(2)}.scip`);
        symlinkSync(outsidePath, symlinkPath);
        const symlink = await mcp.handleToolCall('graph_expand', {
            file: 'pkg/foo.go',
            edges: ['imports'],
            scipIndexPath: symlinkPath,
        });
        expect(symlink.isError).toBe(true);
        expect(String(symlink.content?.[0]?.text || '')).toContain('scipIndexPath must stay within the workspace');
    });

    test('matches absolute file seeds against SCIP project root', async () => {
        const scipIndexPath = writeSampleScipIndex();
        const res = await mcp.handleToolCall('graph_expand', {
            file: join(process.cwd(), 'pkg/foo.go'),
            edges: ['imports', 'exports'],
            scipIndexPath,
            limit: 10,
        });
        const obj = await parse(res);

        expect(obj.impactSummary?.backend).toBe('scip');
        expect(obj.neighbors.imports).toHaveLength(1);
        expect(obj.neighbors.exports).toHaveLength(1);
    });
});
