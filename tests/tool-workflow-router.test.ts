import { describe, expect, test } from 'bun:test';
import { ToolWorkflowRouter } from '../src/core/workflows/tool-workflow-router.js';

function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

describe('ToolWorkflowRouter', () => {
    test('routes tool calls to core workflows without MCP protocol envelopes', async () => {
        const router = new ToolWorkflowRouter({
            buildSymbolMap: async (request: any) => ({ identifier: request.identifier, files: [request.uri] }),
        } as any);

        const result = await router.execute('build_symbol_map', { symbol: 'Target', file: 'src/target.ts' });
        expect(result).not.toHaveProperty('content');
        expect(payload(result)).toMatchObject({ schemaVersion: 2, identifier: 'Target' });
    });

    test('preserves workflow aliases and inline stub behavior', async () => {
        const router = new ToolWorkflowRouter({} as any);

        expect(payload(await router.execute('suggest_refactoring', {}))).toEqual({ suggestions: [] });
        expect(await router.execute('extract_snapshot_artifacts', {})).toEqual({ text: 'snapshot required', isError: true });
    });

    test('routes all advertised diagnostics/cache/knowledge tools', async () => {
        const calls: string[] = [];
        const router = new ToolWorkflowRouter({
            getDiagnostics: async () => ({ healthy: true }),
            getKnowledgeInsights: async () => ({ patterns: 0 }),
            warmCache: async () => { calls.push('warm'); },
            clearCache: async () => { calls.push('clear'); },
        } as any);

        expect(payload(await router.execute('diagnostics', {}))).toMatchObject({ tool: 'diagnostics', diagnostics: { healthy: true } });
        expect(payload(await router.execute('knowledge_insights', {}))).toMatchObject({ tool: 'knowledge_insights', insights: { patterns: 0 } });
        expect(payload(await router.execute('cache_controls', { action: 'warm' }))).toMatchObject({ tool: 'cache_controls', action: 'warm', ok: true });
        expect(payload(await router.execute('cache_controls', { action: 'clear' }))).toMatchObject({ tool: 'cache_controls', action: 'clear', ok: true });
        expect(calls).toEqual(['warm', 'clear']);
    });

    test('cache_controls does not report success when analyzer cache hooks are unavailable', async () => {
        const router = new ToolWorkflowRouter({} as any);

        await expect(router.execute('cache_controls', { action: 'warm' })).rejects.toThrow('cache warm is not supported');
        await expect(router.execute('cache_controls', { action: 'clear' })).rejects.toThrow('cache clear is not supported');
    });
});
