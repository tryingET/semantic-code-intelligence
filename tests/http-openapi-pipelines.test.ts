import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7015;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP OpenAPI includes contract endpoints', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7015; // dedicated test port
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: true });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.HTTP_API_PORT;
    });

    test('paths present', async () => {
        const res = await fetch(`${base}/openapi.json`);
        expect(res.status).toBe(200);
        const spec = await res.json();
        const paths = spec?.paths || {};
        expect(paths['/api/v1/pipelines/status']).toBeDefined();
        expect(paths['/api/v1/pipelines/runs']).toBeDefined();
        expect(paths['/api/v1/pipelines/run']).toBeDefined();
        expect(paths['/api/v1/pipelines/run-stream']).toBeDefined();
        expect(
            paths['/api/v1/pipelines/run-stream'].post.responses['200'].content['application/x-ndjson']
        ).toBeDefined();
        expect(paths['/api/v1/pipelines']).toBeDefined();
        expect(paths['/api/v1/plan-rename']).toBeDefined();
        expect(paths['/api/v1/apply-rename']).toBeDefined();
        expect(paths['/api/v1/symbol-map']).toBeDefined();
    });

    test('legacy OpenAPI documents MCP-compatible aliases and preview-first rename posture', async () => {
        const res = await fetch(`${base}/openapi.json`);
        expect(res.status).toBe(200);
        const spec = await res.json();
        const renamePost = spec.paths['/api/v1/rename'].post;
        const renameSchema = renamePost.requestBody.content['application/json'].schema;
        const planSchema = spec.paths['/api/v1/plan-rename'].post.requestBody.content['application/json'].schema;
        const applyRenamePost = spec.paths['/api/v1/apply-rename'].post;
        const symbolMapSchema = spec.paths['/api/v1/symbol-map'].post.requestBody.content['application/json'].schema;
        const exploreSchema = spec.paths['/api/v1/explore'].post.requestBody.content['application/json'].schema;

        expect(planSchema.properties.oldName).toBeDefined();
        expect(planSchema.anyOf).toEqual([{ required: ['identifier'] }, { required: ['oldName'] }]);
        expect(renamePost.summary).toContain('Preview');
        expect(renameSchema.properties.dryRun.description).toContain('preview-only');
        expect(applyRenamePost.summary).toContain('Disabled legacy mutation endpoint');
        expect(applyRenamePost.responses['200']).toBeUndefined();
        expect(applyRenamePost.responses['400']).toBeDefined();
        expect(symbolMapSchema.properties.symbol).toBeDefined();
        expect(exploreSchema.properties.symbol).toBeDefined();
    });
});
