import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { NavigationWorkflowService, wordAt } from '../src/core/workflows/navigation-workflow.js';
import { resolveWorkspacePath } from '../src/core/workspace-path.js';

const roots: string[] = [];
function tempWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'sci-navigation-workflow-'));
    roots.push(root);
    return root;
}
function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('NavigationWorkflowService', () => {
    test('extracts word at position without protocol response objects', () => {
        expect(wordAt('const alphaValue = 1;\n', { line: 0, character: 8 })).toBe('alphaValue');
        expect(wordAt('const alphaValue = 1;\n', { line: 1, character: 0 })).toBeNull();
    });

    test('find_definition filters core result URIs to the configured workspace', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace();
        const insideFile = join(workspaceRoot, 'target.ts');
        const outsideFile = join(outsideRoot, 'target.ts');
        writeFileSync(insideFile, 'export class Target {}\n', 'utf8');
        writeFileSync(outsideFile, 'export class Target {}\n', 'utf8');

        const service = new NavigationWorkflowService({
            workspaceRoot: () => workspaceRoot,
            maxResults: () => 50,
            coreAnalyzer: {
                findDefinitionAsync: async () => ({
                    data: [definition(outsideFile, 'Target'), definition(insideFile, 'Target')],
                    performance: { total: 1 },
                    requestId: 'req-1',
                }),
            },
            resolveWorkspaceFile: async (value, inputLabel) => {
                const resolved = await resolveWorkspacePath(value, { workspaceRoot, inputLabel });
                return {
                    path: resolved.realPath,
                    uri: pathToFileURL(resolved.realPath).href,
                    relativePath: resolved.relativePath,
                };
            },
            containedUriOrNull: async (value, inputLabel) => {
                try {
                    const resolved = await resolveWorkspacePath(
                        value.startsWith('file://') ? new URL(value).pathname : value,
                        {
                            workspaceRoot,
                            inputLabel,
                        }
                    );
                    return pathToFileURL(resolved.realPath).href;
                } catch {
                    return null;
                }
            },
        });

        const result = payload(await service.findDefinition({ symbol: 'Target', file: 'target.ts' }));
        expect(result.count).toBe(1);
        expect(result.definitions[0].uri).toBe(pathToFileURL(insideFile).href);
    });

    test('file-scoped find_definition propagates precise requests to the core analyzer', async () => {
        const workspaceRoot = tempWorkspace();
        const insideFile = join(workspaceRoot, 'target.ts');
        writeFileSync(insideFile, 'export class Target {}\n', 'utf8');
        const seen: any[] = [];
        const service = new NavigationWorkflowService({
            workspaceRoot: () => workspaceRoot,
            maxResults: () => 50,
            coreAnalyzer: {
                findDefinitionAsync: async (request: any) => {
                    seen.push(request);
                    return {
                        data: [definition(insideFile, 'Target')],
                        performance: { total: 1 },
                        requestId: 'req-precise',
                    };
                },
            },
            resolveWorkspaceFile: async (value, inputLabel) => {
                const resolved = await resolveWorkspacePath(value, { workspaceRoot, inputLabel });
                return {
                    path: resolved.realPath,
                    uri: pathToFileURL(resolved.realPath).href,
                    relativePath: resolved.relativePath,
                };
            },
            containedUriOrNull: async (value) => value,
        });

        await service.findDefinition({ symbol: 'Target', file: 'target.ts', precise: true });
        expect(seen[0]?.precise).toBe(true);
    });

    test('workspace path containment accepts in-workspace names that begin with dot-dot text', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, '..fixtures.ts');
        writeFileSync(target, 'export const value = 1;\n', 'utf8');

        const resolved = await resolveWorkspacePath('..fixtures.ts', { workspaceRoot, inputLabel: 'test path' });
        expect(resolved.relativePath).toBe('..fixtures.ts');
        expect(resolved.realPath).toBe(target);
    });

    test('workspace path containment accepts realpath spelling under a symlinked workspace root', async () => {
        const realRoot = tempWorkspace();
        const linkRoot = join(
            tmpdir(),
            `sci-navigation-workflow-link-${Date.now()}-${Math.random().toString(16).slice(2)}`
        );
        roots.push(linkRoot);
        const target = join(realRoot, 'target.ts');
        writeFileSync(target, 'export const value = 1;\n', 'utf8');
        symlinkSync(realRoot, linkRoot, 'dir');

        const resolved = await resolveWorkspacePath(target, { workspaceRoot: linkRoot, inputLabel: 'test path' });
        expect(resolved.relativePath).toBe('target.ts');
        expect(resolved.realPath).toBe(target);
    });

    test('find_references returns bounded fallback metadata for symbol-only workspace scans', async () => {
        const workspaceRoot = tempWorkspace();
        const service = new NavigationWorkflowService({
            workspaceRoot: () => workspaceRoot,
            maxResults: () => 50,
            coreAnalyzer: {},
            resolveWorkspaceFile: async () => {
                throw new Error('not expected');
            },
            containedUriOrNull: async () => null,
        });

        const result = payload(await service.findReferences({ symbol: 'Target' }));
        expect(result).toMatchObject({
            schemaVersion: 2,
            references: [],
            count: 0,
            scope: 'workspace',
            fallback: true,
        });
    });

    test('find_references fallback keeps same-line references when declarations are excluded', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'same-line.ts'), 'const target = call(target);\n', 'utf8');
        const service = new NavigationWorkflowService({
            workspaceRoot: () => workspaceRoot,
            maxResults: () => 50,
            coreAnalyzer: {},
            resolveWorkspaceFile: async () => {
                throw new Error('not expected');
            },
            containedUriOrNull: async (uri) => uri,
        });

        const withoutDeclarations = payload(await service.findReferences({ symbol: 'target' }));
        expect(withoutDeclarations.references).toHaveLength(1);
        expect(withoutDeclarations.references[0].range.start.character).toBe(20);

        const withDeclarations = payload(await service.findReferences({ symbol: 'target', includeDeclaration: true }));
        expect(withDeclarations.references.map((reference: any) => reference.range.start.character)).toEqual([6, 20]);
    });
});

function definition(file: string, name: string) {
    return {
        identifier: name,
        uri: pathToFileURL(file).href,
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 13 + name.length } },
        kind: 'class',
        name,
        source: 'exact',
        confidence: 0.9,
    };
}
