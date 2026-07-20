import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listMcpTools } from '../src/mcp/tool-list.js';

const COMPOSITE_WORKFLOWS = [
    'explore_symbol_impact',
    'locate_confirm_definition',
    'patch_checks_in_snapshot',
    'structural_patch_checks',
    'rename_safely',
    'safe_write',
] as const;

const root = join(import.meta.dir, '..');

describe('composite workflow discoverability', () => {
    test('MCP descriptions make the six high-level workflows preferred entrypoints', () => {
        const tools = new Map(listMcpTools({ surface: 'alpha' }).map((tool) => [tool.name, tool]));

        for (const name of COMPOSITE_WORKFLOWS) {
            const tool = tools.get(name);
            expect(tool, `${name} must remain on the Alpha MCP surface`).toBeDefined();
            expect(tool?.description.startsWith('PREFERRED')).toBe(true);
        }

        expect(tools.get('explore_symbol_impact')?.description).toContain('Do not manually chain');
        expect(tools.get('safe_write')?.description).toContain('apply:false');
    });

    test('agent guidance routes real tasks to composites while preserving native exact edits', () => {
        const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
        const guide = readFileSync(join(root, 'docs/project/interface-choice-guide.md'), 'utf8');

        for (const name of COMPOSITE_WORKFLOWS) {
            expect(`${agents}\n${guide}`).toContain(name);
        }

        expect(agents).toContain('Do not decompose a composite into primitive SCI calls');
        expect(agents).toContain('Use bounded native `read`/`edit` after the workflow identifies');
        expect(agents).toContain('**Real-task usage:** composite first');
        expect(agents).toContain('**Contract coverage:** primitive calls may be exercised individually');
        expect(guide).toContain('sciCompositeCalls');
        expect(guide).toContain('nativeFallbacks');
        expect(guide).toContain('rawShellAvoided');
    });
});
