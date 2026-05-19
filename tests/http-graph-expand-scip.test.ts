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
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;
const fooSymbol = 'scip-go gomod example.com/acme Foo().';

function writeSampleScipIndex(): string {
    const dir = join(process.cwd(), '.test-results', 'http-scip-graph-expand');
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
                    create(OccurrenceSchema, { range: [0, 7, 20], symbol: 'scip-go gomod fmt/', symbolRoles: SymbolRole.Import }),
                    create(OccurrenceSchema, { range: [2, 5, 8], symbol: fooSymbol, symbolRoles: SymbolRole.Definition }),
                ],
            }),
        ],
    });
    writeFileSync(indexPath, serializeSCIP(index));
    return indexPath;
}

bindDescribe('HTTP /api/v1/graph-expand SCIP parity', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7072;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.HTTP_API_PORT;
    });

    test('routes explicit scipIndexPath through graph_expand adapter semantics', async () => {
        const scipIndexPath = writeSampleScipIndex();
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: 'pkg/foo.go', edges: ['imports', 'exports'], scipIndexPath, limit: 10 }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data?.impactSummary?.backend).toBe('scip');
        expect(body.data?.neighbors?.imports).toHaveLength(1);
        expect(body.data?.neighbors?.exports).toHaveLength(1);
    });

    test('returns a client error for malformed explicit scipIndexPath instead of falling back', async () => {
        const dir = join(process.cwd(), '.test-results', 'http-scip-graph-expand');
        mkdirSync(dir, { recursive: true });
        const malformedPath = join(dir, `bad-${Date.now()}-${Math.random().toString(16).slice(2)}.scip`);
        writeFileSync(malformedPath, 'not a scip index');

        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: 'pkg/foo.go', edges: ['imports'], scipIndexPath: malformedPath, limit: 10 }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(body.error?.message).toContain('Failed to parse SCIP index');
        expect(body.data).toBeUndefined();
    });

    test('rejects workspace symlink escapes for explicit scipIndexPath', async () => {
        const outsideDir = join(tmpdir(), `sci-http-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        mkdirSync(outsideDir, { recursive: true });
        const outsideIndexPath = join(outsideDir, 'index.scip');
        writeFileSync(outsideIndexPath, 'outside');

        const dir = join(process.cwd(), '.test-results', 'http-scip-graph-expand');
        mkdirSync(dir, { recursive: true });
        const symlinkPath = join(dir, `outside-${Date.now()}-${Math.random().toString(16).slice(2)}.scip`);
        symlinkSync(outsideIndexPath, symlinkPath);

        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: 'pkg/foo.go', edges: ['imports'], scipIndexPath: symlinkPath, limit: 10 }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(body.error?.message).toContain('scipIndexPath must stay within the workspace');
        expect(body.data).toBeUndefined();
    });
});
