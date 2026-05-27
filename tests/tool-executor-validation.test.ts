import { describe, expect, test } from 'bun:test';
import { ToolExecutor } from '../src/core/tools/executor.js';

describe('ToolExecutor schema validation', () => {
    test('rejects non-string command array items before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() => executor.validate('run_checks', { snapshot: 'snap-1', commands: [true] })).toThrow('commands[0] must be a string');
    });

    test('rejects command arrays above registry maxItems before dispatch', () => {
        const executor = new ToolExecutor();

        expect(() => executor.validate('run_checks', { snapshot: 'snap-1', commands: Array.from({ length: 21 }, () => 'true') })).toThrow('commands must contain at most 20 items');
    });
});
