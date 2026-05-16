import { describe, expect, test } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Layer 1 Text Search - Edge Cases', () => {
    const CLI = './ontology-lsp';

    test('word-boundary kind finds exact word matches (limit to src)', async () => {
        const { stdout } = await execAsync(`${CLI} text-search "CodeAnalyzer" -k word -p src -n 10 -j`);
        const result = JSON.parse(stdout);
        expect(result.count).toBeGreaterThan(0);
        const hasWord = result.results.some((r: any) => /\bCodeAnalyzer\b/.test(r.text));
        expect(hasWord).toBe(true);
    }, 15000);

    test('ignore-case returns results for uppercase query', async () => {
        const { stdout } = await execAsync(`${CLI} text-search "FUNCTION" -i -n 10 -j`);
        const result = JSON.parse(stdout);
        expect(result.count).toBeGreaterThan(0);
    }, 30000);

    test('regex kind works with basic character classes', async () => {
        const { stdout } = await execAsync(`${CLI} text-search "Code[A-Za-z]+" -k regex -p src -n 10 -j`);
        const result = JSON.parse(stdout);
        expect(result.count).toBeGreaterThan(0);
    }, 15000);
});
