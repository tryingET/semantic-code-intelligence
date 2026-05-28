import { describe, expect, test } from 'bun:test';
import { ToolExecutor } from '../src/core/tools/executor.js';

describe('ToolExecutor schema validation', () => {
    test('rejects non-string command array items before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() => executor.validate('run_checks', { snapshot: 'snap-1', commands: [true] })).toThrow(
            'commands[0] must be a string'
        );
    });

    test('rejects command arrays above registry maxItems before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() =>
            executor.validate('run_checks', { snapshot: 'snap-1', commands: Array.from({ length: 21 }, () => 'true') })
        ).toThrow('commands must contain at most 20 items');
    });

    test('rejects unsupported enum values before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() => executor.validate('ast_query', { language: 'rust', query: '(function_item)' })).toThrow(
            'language must be one of'
        );
    });

    test('rejects primitive type mismatches before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() =>
            executor.validate('ast_query', { language: 'typescript', query: '(identifier) @id', limit: '5' })
        ).toThrow('limit must be a number');
    });

    test('rejects nested object schema mismatches before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() => executor.validate('get_completions', { file: 'src/index.ts', position: null })).toThrow(
            'Missing required parameters: position'
        );
        expect(() => executor.validate('get_completions', { file: 'src/index.ts', position: {} })).toThrow(
            'Missing required parameters: position.line, position.character'
        );
        expect(() =>
            executor.validate('get_completions', { file: 'src/index.ts', position: { line: '1', character: 2 } })
        ).toThrow('position.line must be a number');
        expect(() =>
            executor.validate('find_definition', { symbol: 'Foo', position: { line: -1, character: 2 } })
        ).toThrow('position.line must be >= 0');
    });

    test('rejects unsupported array enum values before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() =>
            executor.validate('graph_expand', { file: 'src/index.ts', edges: ['imports', 'unknown'] })
        ).toThrow('edges[1] must be one of');
    });
});
