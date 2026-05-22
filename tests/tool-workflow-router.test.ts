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
});
