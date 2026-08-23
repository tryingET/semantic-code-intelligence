import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CoreError, WORKSPACE_BOUNDARY_REASON, WORKSPACE_BOUNDARY_REMEDIATION } from '../src/core/errors.js';
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
        expect(await router.execute('extract_snapshot_artifacts', {})).toEqual({
            text: 'snapshot required',
            isError: true,
        });
    });

    test('routes all advertised diagnostics/cache/knowledge tools', async () => {
        const calls: string[] = [];
        const router = new ToolWorkflowRouter({
            getDiagnostics: async () => ({ healthy: true }),
            getKnowledgeInsights: async () => ({ patterns: 0 }),
            warmCache: async () => {
                calls.push('warm');
            },
            clearCache: async () => {
                calls.push('clear');
            },
        } as any);

        expect(payload(await router.execute('diagnostics', {}))).toMatchObject({
            tool: 'diagnostics',
            diagnostics: { healthy: true },
        });
        expect(payload(await router.execute('knowledge_insights', {}))).toMatchObject({
            tool: 'knowledge_insights',
            insights: { patterns: 0 },
        });
        expect(payload(await router.execute('cache_controls', { action: 'warm' }))).toMatchObject({
            tool: 'cache_controls',
            action: 'warm',
            ok: true,
        });
        expect(payload(await router.execute('cache_controls', { action: 'clear' }))).toMatchObject({
            tool: 'cache_controls',
            action: 'clear',
            ok: true,
        });
        expect(calls).toEqual(['warm', 'clear']);
    });

    test('definition workflows preserve contained paths and reject escapes with bounded recovery data', async () => {
        const workspaceRoot = mkdtempSync(join(tmpdir(), 'sci-router-boundary-'));
        const target = join(workspaceRoot, 'target.ts');
        const outsidePath = join(dirname(workspaceRoot), 'ak4862-outside.ts');
        writeFileSync(target, 'export class Target {}\n', 'utf8');

        const router = new ToolWorkflowRouter(
            {
                findDefinitionAsync: async (request: any) => ({
                    data:
                        request.identifier === 'Target'
                            ? [
                                  {
                                      uri: pathToFileURL(target).href,
                                      range: {
                                          start: { line: 0, character: 13 },
                                          end: { line: 0, character: 19 },
                                      },
                                      name: 'Target',
                                  },
                              ]
                            : [],
                    performance: { total: 1 },
                    requestId: 'router-boundary-test',
                }),
            } as any,
            { workspaceRoot: () => workspaceRoot }
        );

        try {
            for (const file of ['target.ts', target]) {
                const direct = await router.execute('find_definition', { symbol: 'Target', file });
                expect(direct.isError).toBe(false);
                expect(payload(direct)).toMatchObject({ count: 1, definitions: [{ name: 'Target' }] });

                const located = await router.execute('locate_confirm_definition', { symbol: 'Target', file });
                expect(located.isError).toBe(false);
                expect(payload(located)).toMatchObject({ ok: true, definitions: [{ name: 'Target' }] });
            }

            const missingDirect = await router.execute('find_definition', {
                symbol: 'MissingForAk4862',
                file: 'target.ts',
            });
            expect(missingDirect.isError).toBe(false);
            expect(payload(missingDirect)).toMatchObject({ count: 0, definitions: [] });

            const missingLocate = await router.execute('locate_confirm_definition', {
                symbol: 'MissingForAk4862',
                file: 'target.ts',
            });
            expect(missingLocate.isError).toBe(false);
            expect(payload(missingLocate)).toMatchObject({ ok: false, definitions: [] });

            for (const tool of ['find_definition', 'locate_confirm_definition']) {
                try {
                    await router.execute(tool, { symbol: 'Target', file: outsidePath });
                    throw new Error(`Expected ${tool} to reject an outside-workspace path`);
                } catch (error) {
                    expect(error).toBeInstanceOf(CoreError);
                    expect((error as Error).message).toBe('find_definition file must stay within the workspace');
                    expect((error as CoreError).data).toEqual({
                        reason: WORKSPACE_BOUNDARY_REASON,
                        remediation: WORKSPACE_BOUNDARY_REMEDIATION,
                    });
                    const serialized = JSON.stringify({
                        message: (error as Error).message,
                        data: (error as CoreError).data,
                    });
                    expect(serialized).not.toContain(outsidePath);
                    expect(serialized).not.toContain(workspaceRoot);
                }
            }
        } finally {
            rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });

    test('cache_controls does not report success when analyzer cache hooks are unavailable', async () => {
        const router = new ToolWorkflowRouter({} as any);

        await expect(router.execute('cache_controls', { action: 'warm' })).rejects.toThrow(
            'cache warm is not supported'
        );
        await expect(router.execute('cache_controls', { action: 'clear' })).rejects.toThrow(
            'cache clear is not supported'
        );
    });
});
