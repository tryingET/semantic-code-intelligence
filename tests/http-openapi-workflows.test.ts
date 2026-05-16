import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP OpenAPI workflows', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7018;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: true });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('OpenAPI includes named workflow schemas and normalized ToolCallResponse', async () => {
        const res = await fetch(`${base}/openapi.json`);
        expect(res.status).toBe(200);
        const spec = await res.json();
        expect(spec.openapi).toBeDefined();
        expect(typeof spec.openapi).toBe('string');

        const schemas = spec?.components?.schemas || {};
        expect(schemas).toHaveProperty('LocateConfirmDefinitionResult');
        expect(schemas).toHaveProperty('SafeRenameResult');
        expect(schemas).toHaveProperty('PatchChecksInSnapshotResult');
        expect(schemas).toHaveProperty('ToolCallResponse');

        const tcr = schemas.ToolCallResponse;
        expect(tcr?.properties?.success?.type).toBe('boolean');
        // result is normalized (parsed JSON) and error is optional object with message
        expect(tcr?.properties?.result).toBeDefined();
        expect(tcr?.properties?.error).toBeDefined();
    });

});
