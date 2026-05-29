import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodeAnalyzer } from '../src/core/index';
import { HTTPServer } from '../src/servers/http';

const tempDirs: string[] = [];

async function tempWorkspace(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()!;
        await rm(dir, { recursive: true, force: true });
    }
});

describe('nexus boundary regressions', () => {
    test('buildSymbolMap preserves file URI reserved characters in paths', async () => {
        const workspaceRoot = await tempWorkspace('sci-nexus-uri-');
        await writeFile(
            path.join(workspaceRoot, 'a#b.ts'),
            'export function targetHash() { return 1; }\ntargetHash();\n'
        );

        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        try {
            await analyzer.initialize?.();
            const result = await analyzer.buildSymbolMap({
                identifier: 'targetHash',
                uri: 'file://workspace',
                maxFiles: 5,
                astOnly: true,
            });

            expect(result.files).toBe(1);
            expect(result.declarations.some((decl: any) => decl.name === 'targetHash')).toBe(true);
            expect(result.declarations[0]?.uri).toContain('a%23b.ts');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('buildSymbolMap reports destructured lexical declarations as declarations without default-value false positives', async () => {
        const workspaceRoot = await tempWorkspace('sci-nexus-destructure-');
        await writeFile(
            path.join(workspaceRoot, 'a.ts'),
            [
                'const { targetValue = fallbackValue, source: aliasedValue } = source;',
                'const [otherValue = defaultOther] = list;',
                'console.log(targetValue, aliasedValue, otherValue, fallbackValue, defaultOther);',
            ].join('\n')
        );

        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        try {
            await analyzer.initialize?.();
            const targetResult = await analyzer.buildSymbolMap({
                identifier: 'targetValue',
                uri: 'file://workspace',
                maxFiles: 5,
                astOnly: true,
            });
            const fallbackResult = await analyzer.buildSymbolMap({
                identifier: 'fallbackValue',
                uri: 'file://workspace',
                maxFiles: 5,
                astOnly: true,
            });

            expect(
                targetResult.declarations.some((decl: any) => decl.name === 'targetValue' && decl.kind === 'variable')
            ).toBe(true);
            expect(fallbackResult.declarations.some((decl: any) => decl.name === 'fallbackValue')).toBe(false);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('buildSymbolMap reports exported lexical declarations as declarations and exports', async () => {
        const workspaceRoot = await tempWorkspace('sci-nexus-export-');
        await writeFile(path.join(workspaceRoot, 'a.ts'), 'export const targetValue = 1;\nconsole.log(targetValue);\n');

        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        try {
            await analyzer.initialize?.();
            const result = await analyzer.buildSymbolMap({
                identifier: 'targetValue',
                uri: 'file://workspace',
                maxFiles: 5,
            });

            expect(
                result.declarations.some((decl: any) => decl.name === 'targetValue' && decl.kind === 'variable')
            ).toBe(true);
            expect(result.exports.some((exp: any) => exp.name === 'targetValue')).toBe(true);
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('buildSymbolMap classifies default exports once and preserves default type', async () => {
        const workspaceRoot = await tempWorkspace('sci-nexus-default-export-');
        await writeFile(path.join(workspaceRoot, 'a.ts'), 'export default function targetFactory() { return {}; }\n');

        const analyzer = await createCodeAnalyzer({ workspaceRoot });
        try {
            await analyzer.initialize?.();
            const result = await analyzer.buildSymbolMap({
                identifier: 'targetFactory',
                uri: 'file://workspace',
                maxFiles: 5,
            });
            const exports = result.exports.filter((exp: any) => exp.name === 'targetFactory');

            expect(exports).toHaveLength(1);
            expect(exports[0]?.kind).toBe('export');
            expect(exports[0]?.type).toBe('default');
        } finally {
            await analyzer.dispose?.();
        }
    });

    test('HTTP UI asset lookup is independent of process cwd', async () => {
        const originalCwd = process.cwd();
        const otherCwd = await tempWorkspace('sci-nexus-cwd-');

        try {
            process.chdir(otherCwd);
            const server = new HTTPServer({ workspaceRoot: otherCwd });
            const index = await (server as any).findWebUiFile('index.html', ['dist', null]);

            expect(index?.filePath).toContain(`${path.sep}web-ui${path.sep}index.html`);
            expect(Buffer.isBuffer(index.file)).toBe(true);
            expect(index.file.length).toBeGreaterThan(0);
        } finally {
            process.chdir(originalCwd);
        }
    });

    test('HTTP UI static path decoder rejects malformed percent encoding without throwing', () => {
        const server = new HTTPServer({ workspaceRoot: process.cwd() });
        expect((server as any).decodeStaticPath('%E0%A4%A')).toBeNull();
    });

    test('importable MCP server modules do not install stdio globals', () => {
        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        for (const modulePath of ['src/servers/mcp.ts', 'src/servers/mcp-fast.ts', 'src/servers/mcp-enhanced.ts']) {
            const proc = Bun.spawnSync(
                [
                    process.execPath,
                    '--conditions=development',
                    '-e',
                    `const before = console.log; await import('./${modulePath}'); if (console.log !== before || process.env.STDIO_MODE === 'true') process.exit(3); console.log('import-safe');`,
                ],
                { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' }
            );

            expect(proc.exitCode).toBe(0);
            expect(proc.stdout.toString().trim()).toBe('import-safe');
        }
    });
});
