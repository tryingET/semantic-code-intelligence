import { expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { createDefaultCoreConfig } from '../src/adapters/utils';
import { createCodeAnalyzer } from '../src/core/index';

async function withMcp<T>(fn: (mcp: MCPAdapter) => Promise<T>): Promise<T> {
    const cfg = createDefaultCoreConfig();
    const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot: process.cwd() });
    await analyzer.initialize();
    try {
        return await fn(new MCPAdapter(analyzer, { surface: 'registry' }));
    } finally {
        await analyzer.dispose?.();
    }
}

function parseContent(res: any): any {
    try {
        const txt = res?.content?.[0]?.text;
        return txt ? JSON.parse(txt) : res;
    } catch {
        return res;
    }
}

const staleApplyPatch = `*** Begin Patch
*** Update File: tests/fixtures/example.ts
@@
-export const definitely_missing_line = 1;
+export const definitely_missing_line = 2;
*** End Patch
`;

test('apply_after_checks fails closed before checks when patch staging fails', async () => {
    await withMcp(async (mcp) => {
        const res = await mcp.handleToolCall('apply_after_checks', {
            patch: staleApplyPatch,
            commands: ['bash -lc "echo SHOULD_NOT_RUN"'],
            timeoutSec: 30,
        });
        const out = parseContent(res);

        expect(res.isError).toBe(false);
        expect(out.ok).toBe(false);
        expect(out.reason).toBe('patch_stage_failed');
        expect(out.applied).toBe(false);
        expect(out.output_tail).toBe('');
        expect(String(JSON.stringify(out.stage))).toContain('apply_patch hunk did not match');
    });
});

test('patch_checks_in_snapshot fails closed before checks when patch staging fails', async () => {
    await withMcp(async (mcp) => {
        const res = await mcp.handleToolCall('patch_checks_in_snapshot', {
            patch: staleApplyPatch,
            commands: ['bash -lc "echo SHOULD_NOT_RUN"'],
            timeoutSec: 30,
        });
        const out = parseContent(res);

        expect(res.isError).toBe(false);
        expect(out.workflow).toBe('patch_checks_in_snapshot');
        expect(out.ok).toBe(false);
        expect(out.reason).toBe('patch_stage_failed');
        expect(out.checks).toBe(null);
        expect(String(JSON.stringify(out.stage))).toContain('apply_patch hunk did not match');
    });
});

test('run_checks command failures remain domain outcomes rather than tool errors', async () => {
    await withMcp(async (mcp) => {
        const snapRes = await mcp.handleToolCall('get_snapshot', { preferExisting: false });
        const snapshot = parseContent(snapRes).snapshot;
        const res = await mcp.handleToolCall('run_checks', { snapshot, commands: ['false'], timeoutSec: 30 });
        const out = parseContent(res);

        expect(res.isError).toBe(false);
        expect(out.ok).toBe(false);
        expect(out.commands?.[0]?.ok).toBe(false);
    });
});

test('propose_patch rejects non-diff input before accepting an empty overlay', async () => {
    await withMcp(async (mcp) => {
        const snapRes = await mcp.handleToolCall('get_snapshot', { preferExisting: false });
        const snapshot = parseContent(snapRes).snapshot;
        const res = await mcp.handleToolCall('propose_patch', { snapshot, patch: 'console.log("not a diff");\n' });
        const out = parseContent(res);

        expect(res.isError).toBe(true);
        expect(out.accepted).toBe(false);
        expect(String(out.message || '')).toContain('invalid_patch');
    });
});
