import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import path from 'node:path';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

async function callTool(base: string, name: string, args: Record<string, any>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    return body.result;
}

function parseContent(result: any): any {
    try {
        const txt = result?.content?.[0]?.text;
        if (!txt) return result;
        return JSON.parse(txt);
    } catch {
        return result;
    }
}

bindDescribe('HTTP tools: list_symbols (regex and AST paths)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7017; // dedicated test port for list_symbols
    const base = `http://${host}:${port}`;

    const fixtureFile = path.join(process.cwd(), 'tests', 'fixtures', 'example.ts');

    beforeAll(async () => {
        // Exercise AST-backed path where available
        process.env.LIST_SYMBOLS_AST = '1';
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.LIST_SYMBOLS_AST;
    });

    test('list_symbols returns symbols with positions', async () => {
        const result = await callTool(base, 'list_symbols', { file: fixtureFile });
        const out = parseContent(result);
        expect(out).toBeDefined();
        expect(typeof out.file).toBe('string');
        expect(Array.isArray(out.symbols)).toBe(true);
        expect(out.symbols.length).toBeGreaterThan(0);
        const first = out.symbols[0];
        expect(typeof first.name).toBe('string');
        expect(typeof first.kind).toBe('string');
        expect(typeof first.line).toBe('number');
        expect(typeof first.character).toBe('number');
    });
});
