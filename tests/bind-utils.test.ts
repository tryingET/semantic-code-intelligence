import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { canBindTcp } from './helpers/bind-utils';

const originalStrict = process.env.SCI_FAIL_PORT_SKIP;

afterEach(() => {
    if (originalStrict === undefined) delete process.env.SCI_FAIL_PORT_SKIP;
    else process.env.SCI_FAIL_PORT_SKIP = originalStrict;
});

describe('test bind utilities', () => {
    test('strict mode fails closed instead of silently allowing endpoint suite skips', async () => {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('expected TCP server address');

        process.env.SCI_FAIL_PORT_SKIP = '1';
        try {
            await expect(canBindTcp('127.0.0.1', address.port)).rejects.toThrow('refusing to silently skip');
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });
});
