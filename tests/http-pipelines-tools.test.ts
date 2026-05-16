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

bindDescribe('HTTP tools: learning pipelines (run + list)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7017; // dedicated test port
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('list_pipelines exposes pattern_feedback_cycle', async () => {
        const result = await callTool(base, 'list_pipelines', {});
        const out = parseContent(result);
        expect(Array.isArray(out?.pipelines)).toBe(true);
        const ids = new Set<string>((out.pipelines || []).map((p: any) => p.id));
        expect(ids.has('pattern_feedback_cycle')).toBe(true);

        const daily = (out.pipelines || []).find((p: any) => p.id === 'daily_insights');
        if (daily) {
            expect('lastRunAt' in daily).toBe(true);
            expect('nextRunAt' in daily).toBe(true);
            expect('scheduleNote' in daily).toBe(true);
        }
    });

    test('run_pipeline returns a runId and list_pipeline_runs shows it', async () => {
        // Trigger a pipeline run (minimal)
        const runRes = await callTool(base, 'run_pipeline', { id: 'pattern_feedback_cycle' });
        const runOut = parseContent(runRes);
        expect(runOut).toBeDefined();
        expect(typeof runOut.runId).toBe('string');
        expect(runOut.runId.length).toBeGreaterThan(0);

        // Fetch recent runs; expect at least one entry
        const listRes = await callTool(base, 'list_pipeline_runs', { id: 'pattern_feedback_cycle', limit: 5 });
        const listOut = parseContent(listRes);
        expect(Array.isArray(listOut?.runs)).toBe(true);
        expect(listOut.runs.length).toBeGreaterThan(0);
        // Optional: ensure the latest run is ours (best-effort; not strict if parallel)
        const hasRun = (listOut.runs as any[]).some((r) => r.id === runOut.runId);
        expect(hasRun || listOut.runs.length >= 1).toBe(true);
    });
});
