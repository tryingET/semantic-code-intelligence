import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

describe('LSP module import lifecycle', () => {
    test('importing the server module does not activate stdio listeners', () => {
        const result = spawnSync('bun', ['--eval', "await import('./src/servers/lsp.ts'); console.log('imported')"], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 3000,
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('imported');
        expect(result.stderr.trim()).toBe('');
    });
});
