import { describe, expect, test } from 'bun:test';
import { listMcpTools } from '../src/mcp/tool-list';

describe('MCP tool list formatting', () => {
    test('formats registry tools as MCP tool descriptors', () => {
        const tools = listMcpTools();
        const readFile = tools.find((tool) => tool.name === 'read_file');
        const patchChecks = tools.find((tool) => tool.name === 'patch_checks_in_snapshot');

        expect(readFile?.description).toContain('Read');
        expect(readFile?.inputSchema?.required).toContain('path');
        expect(readFile?.annotations).toEqual({ recommended: false });
        expect(patchChecks?.annotations).toEqual({ category: 'workflow', recommended: true });
    });

    test('supports fast-stdio workflow filtering and renamed aliases preference', () => {
        const workflows = listMcpTools({ mode: 'workflows', preferRenamed: true });
        const names = new Set(workflows.map((tool) => tool.name));

        expect(names.has('rename_safely')).toBe(true);
        expect(names.has('workflow_safe_rename')).toBe(false);
        expect(workflows.every((tool) => tool.annotations.category === 'workflow')).toBe(true);
    });
});
