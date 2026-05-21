import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceQueryWorkflowService } from '../src/core/workflows/workspace-query-workflow.js';

const roots: string[] = [];
function tempWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'sci-workspace-query-'));
    roots.push(root);
    return root;
}
function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('WorkspaceQueryWorkflowService', () => {
    test('reads bounded files through configured workspace roots without MCP response objects', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'line 1\nline 2\nline 3\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {},
            pathInputFromMcpFile: (value) => value,
        });

        const out = payload(await service.readFile({ path: 'sample.ts', range: { startLine: 2, endLine: 3 } }));
        expect(out).toMatchObject({ path: 'sample.ts', content: 'line 2\nline 3', totalLines: 4 });
    });

    test('delegates text search to the configured analyzer with bounded path resolution', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'needle\n', 'utf8');
        const calls: any[] = [];
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async initialize() {},
                async textSearch(pattern: string, options: any) {
                    calls.push({ pattern, options });
                    return { count: 1, results: [{ file: 'sample.ts', line: 1, text: 'needle' }] };
                },
            },
            pathInputFromMcpFile: (value) => value,
        });

        const out = payload(await service.textSearch({ query: 'needle', path: '.', kind: 'literal' }));
        expect(out.count).toBe(1);
        expect(calls[0].pattern).toBe('needle');
        expect(calls[0].options.path).toBe(workspaceRoot);
    });
});
