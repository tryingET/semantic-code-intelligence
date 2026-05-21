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

describe('build command surface', () => {
    test('package test delegates to the sliced normal-test runner', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        const runner = readText('scripts/run-normal-tests.sh');

        expect(packageJson.scripts?.test).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:nonperf']).toBe('scripts/run-normal-tests.sh');
        expect(packageJson.scripts?.['test:raw']).toBe('bun test');
        expect(runner).toContain('bin/test-slicer.sh');
        expect(runner).toContain('BUN_JOBS=${BUN_JOBS:-1}');
        expect(runner).not.toContain('bun test\n');
    });

    test('release and review surfaces use the normal package test command for broad tests', () => {
        const npmPublish = readText('.github/workflows/npm-publish.yml');
        const prTemplate = readText('.github/pull_request_template.md');

        expect(npmPublish).toContain('run: bun run test');
        expect(npmPublish).not.toMatch(/^\s*run:\s*bun test\s*$/m);
        expect(prTemplate).toContain('bun run test');
        expect(prTemplate).not.toMatch(/^bun test$/m);
    });

    test('package build delegates to the canonical all-adapter build', () => {
        const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
        expect(packageJson.scripts?.build).toBe('bun run build:all');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:mcp-stdio');
        expect(packageJson.scripts?.['build:all']).toContain('bun run build:http');
        expect(packageJson.scripts?.['build:http']).toContain('--outdir=dist/http');
        expect(packageJson.scripts?.['build:mcp-stdio']).toContain('--outdir=dist/mcp');
    });

    test('Just build delegates to the package build instead of hand-rolling divergent artifacts', () => {
        const justfile = readText('justfile');
        const body = recipeBody(justfile, 'build');

        expect(body).toContain('{{bun}} run build:all');
        expect(body).not.toContain('dist/api');
        expect(body).not.toContain('src/servers/mcp-fast.ts');
        expect(body).not.toContain('dist/mcp-fast');
    });
});
