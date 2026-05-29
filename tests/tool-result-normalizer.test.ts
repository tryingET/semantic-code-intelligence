import { describe, expect, test } from 'bun:test';
import { workflowErrorPayload } from '../src/core/workflows/tool-result-normalizer';

describe('workflow tool-result normalization', () => {
    test('normalizes unknown error codes instead of leaking arbitrary protocol values', () => {
        const error = workflowErrorPayload(
            {
                payload: { error: { code: 'CallerInventedCode', message: 'Invalid snapshot id' } },
                isError: true,
            },
            'fallback'
        );

        expect(error.code).toBe('InvalidParams');
        expect(error.message).toBe('Invalid snapshot id');
    });

    test('defaults unknown non-caller codes to Internal when message is not classifiable', () => {
        const error = workflowErrorPayload(
            {
                payload: { error: { code: 'CallerInventedCode', message: 'surprising failure' } },
                isError: true,
            },
            'fallback'
        );

        expect(error.code).toBe('Internal');
        expect(error.message).toBe('surprising failure');
    });
});
