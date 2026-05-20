import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readText(path: string): string {
    return readFileSync(path, 'utf8');
}

function recipeBody(justfile: string, recipeName: string): string {
    const recipePattern = new RegExp(`^${recipeName}:\\n(?<body>(?:[ \\t].*\\n|\\n)+)`, 'm');
    const match = justfile.match(recipePattern);
    expect(match, `${recipeName} recipe should exist`).not.toBeNull();
    return match?.groups?.body ?? '';
}

describe('Alpha MVP validation command surface', () => {
    test('Just alpha-mvp-check delegates to the canonical package validation bundle', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        expect(packageJson.scripts?.['alpha:mvp:check']).toBeTruthy();
        expect(packageJson.scripts?.['alpha:mvp:check']).toContain('bun run typecheck');

        const justfile = readText('justfile');
        const body = recipeBody(justfile, 'alpha-mvp-check');

        expect(body.trim()).toBe('bun run alpha:mvp:check');
        expect(body).not.toContain('build:tsc');
    });

    test('active Just guidance does not reintroduce the retired build:tsc alias', () => {
        const justfile = readText('justfile');
        expect(justfile).not.toContain('build:tsc');
        expect(justfile).toContain('bun run typecheck');
        expect(justfile).toContain('bun run alpha:mvp:check');
    });
});
