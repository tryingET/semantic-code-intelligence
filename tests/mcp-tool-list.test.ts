import { describe, expect, test } from 'bun:test';
import { ALPHA_MVP_TOOL_NAMES } from '../src/core/tools/alpha-surface';
import { fastStdioToolListOptions, listMcpTools } from '../src/mcp/tool-list';

describe('MCP tool list formatting', () => {
    test('formats registry tools as MCP tool descriptors', () => {
        const tools = listMcpTools();
        const names = tools.map((tool) => tool.name).sort();
        const readFile = tools.find((tool) => tool.name === 'read_file');
        const patchChecks = tools.find((tool) => tool.name === 'patch_checks_in_snapshot');

        expect(names).toEqual([...ALPHA_MVP_TOOL_NAMES].sort());
        expect(names).not.toContain('rename_symbol');
        expect(names).not.toContain('generate_tests');
        expect(readFile?.description).toContain('Read');
        expect(readFile?.inputSchema?.required).toContain('path');
        expect(readFile?.annotations).toEqual({ recommended: false });
        expect(patchChecks?.annotations).toEqual({ category: 'workflow', recommended: true });
    });

    test('fast-stdio defaults to the full Alpha surface and keeps workflow filtering opt-in', () => {
        const defaultOptions = fastStdioToolListOptions({});
        expect(defaultOptions.mode).toBeUndefined();
        expect(
            listMcpTools(defaultOptions)
                .map((tool) => tool.name)
                .sort()
        ).toEqual([...ALPHA_MVP_TOOL_NAMES].sort());

        const workflows = listMcpTools({ mode: 'workflows', preferRenamed: true });
        const names = new Set(workflows.map((tool) => tool.name));

        expect(names.has('patch_checks_in_snapshot')).toBe(true);
        expect(names.has('structural_patch_checks')).toBe(true);
        expect(names.has('safe_write')).toBe(true);
        expect(names.has('rename_safely')).toBe(true);
        expect(names.has('workflow_safe_rename')).toBe(false);
        expect(workflows.every((tool) => tool.annotations.category === 'workflow')).toBe(true);
    });
});
