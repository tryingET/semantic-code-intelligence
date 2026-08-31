import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
    assertPathInWorkspaceRepository,
    loadOrCreateWorkspaceBinding,
    verifyWorkspaceBinding,
    workspaceBindingPath,
} from '../src/core/workspace-binding.js';
import {
    WORKSPACE_PATH_REF_SCHEMA,
    WORKSPACE_REF_SCHEMA,
    assertWorkspacePathRef,
    createWorkspacePathRef,
    isWorkspacePathRefV1,
    isWorkspaceRefV1,
    normalizeWorkspaceRelativePath,
} from '../src/core/workspace-ref.js';
import { captureWorkspaceState, sameWorkspaceState } from '../src/core/workspace-state.js';
import { workspacePathRefToPath, workspacePathRefToUri } from '../src/core/workspace-input.js';

const roots: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(label: string): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), `sci-${label}-`));
    roots.push(root);
    return root;
}

function git(root: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function initializedRepository(label: string): Promise<string> {
    const root = await temporaryRoot(label);
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'sci-test@example.invalid');
    git(root, 'config', 'user.name', 'SCI Test');
    await writeFile(path.join(root, 'tracked.ts'), 'export const value = 1;\n', 'utf8');
    git(root, 'add', 'tracked.ts');
    git(root, 'commit', '-qm', 'fixture');
    return root;
}

function reason(error: unknown): string | undefined {
    return (error as any)?.data?.reason;
}

async function expectReason(promise: Promise<unknown>, expected: string): Promise<void> {
    try {
        await promise;
        throw new Error(`expected rejection reason ${expected}`);
    } catch (error) {
        expect(reason(error)).toBe(expected);
    }
}

describe('NEXUS workspace references', () => {
    test('normalizes portable repo-relative paths and rejects unbound path shapes', () => {
        expect(normalizeWorkspaceRelativePath('./src\\example.ts')).toBe('src/example.ts');
        for (const invalid of ['', '.', '..', '../escape.ts', '/absolute.ts', 'C:\\outside.ts', 'file:///x.ts']) {
            expect(() => normalizeWorkspaceRelativePath(invalid)).toThrow();
        }
    });

    test('creates exact workspace and path reference shapes', async () => {
        const root = await initializedRepository('reference-shape');
        const binding = await loadOrCreateWorkspaceBinding(root);
        const file = createWorkspacePathRef(binding.workspace, 'tracked.ts');

        expect(binding.workspace).toEqual({ schema: WORKSPACE_REF_SCHEMA, workspaceId: binding.workspace.workspaceId });
        expect(isWorkspaceRefV1(binding.workspace)).toBe(true);
        expect(file).toEqual({
            schema: WORKSPACE_PATH_REF_SCHEMA,
            workspaceId: binding.workspace.workspaceId,
            path: 'tracked.ts',
        });
        expect(isWorkspacePathRefV1(file)).toBe(true);
        expect(workspacePathRefToPath(file, binding)).toBe(path.join(root, 'tracked.ts'));

        const rootRef = createWorkspacePathRef(binding.workspace, '.', { allowRoot: true });
        expect(isWorkspacePathRefV1(rootRef, { allowRoot: true })).toBe(true);
        expect(assertWorkspacePathRef(rootRef, binding.workspace, { allowRoot: true }).path).toBe('.');
        expect(workspacePathRefToUri(rootRef, binding, { allowRoot: true })).toMatch(/^file:/u);
        await expectReason(
            Promise.resolve().then(() => assertWorkspacePathRef(undefined, binding.workspace)),
            'workspace_ref_required'
        );
        await expectReason(
            Promise.resolve().then(() =>
                assertWorkspacePathRef(
                    { schema: WORKSPACE_PATH_REF_SCHEMA, workspaceId: binding.workspace.workspaceId },
                    binding.workspace
                )
            ),
            'workspace_path_invalid'
        );
        await expectReason(
            Promise.resolve().then(() => assertWorkspacePathRef({ ...file, path: '../escape.ts' }, binding.workspace)),
            'workspace_path_invalid'
        );
    });
});

describe('persisted workspace binding', () => {
    test('is restart-stable, opaque publicly, and stored with restrictive permissions', async () => {
        const root = await initializedRepository('binding-stable');
        const first = await loadOrCreateWorkspaceBinding(root);
        const second = await loadOrCreateWorkspaceBinding(root);
        const bindingFile = workspaceBindingPath(root);
        const stored = JSON.parse(await readFile(bindingFile, 'utf8'));
        const fileStat = await stat(bindingFile);

        expect(second.workspace).toEqual(first.workspace);
        expect(first.workspace.workspaceId).toMatch(/^wsp_[0-9a-f]{32}$/);
        expect(JSON.stringify(first.workspace)).not.toContain(root);
        expect(stored.realRoot).toBe(root);
        expect(fileStat.mode & 0o077).toBe(0);

        const concurrent = await Promise.all(Array.from({ length: 24 }, () => loadOrCreateWorkspaceBinding(root)));
        expect(new Set(concurrent.map((item) => item.workspace.workspaceId)).size).toBe(1);
    });

    test('mints exactly one identity during concurrent first creation', async () => {
        const root = await initializedRepository('binding-concurrent-create');
        const bindings = await Promise.all(Array.from({ length: 32 }, () => loadOrCreateWorkspaceBinding(root)));
        expect(new Set(bindings.map((item) => item.workspace.workspaceId)).size).toBe(1);
    });

    test('mints exactly one identity across concurrent producer processes', async () => {
        const root = await initializedRepository('binding-concurrent-processes');
        const scripts = await temporaryRoot('binding-concurrent-scripts');
        const moduleUrl = pathToFileURL(path.resolve('src/core/workspace-binding.ts')).href;
        const child = path.join(scripts, 'load-binding.ts');
        await writeFile(
            child,
            `import { loadOrCreateWorkspaceBinding } from ${JSON.stringify(moduleUrl)};\n` +
                `const binding = await loadOrCreateWorkspaceBinding(process.argv[2]);\n` +
                `process.stdout.write(binding.workspace.workspaceId);\n`,
            'utf8'
        );
        const results = await Promise.all(
            Array.from({ length: 16 }, () =>
                execFile(process.execPath, [child, root], { encoding: 'utf8', timeout: 15_000 })
            )
        );
        expect(new Set(results.map((result) => result.stdout.trim())).size).toBe(1);
    });

    test('rejects a symlinked runtime directory or binding file', async () => {
        // The binding path is fixed local runtime state; malformed bytes never receive a fallback identity.
        const root = await initializedRepository('binding-symlink-directory');
        const external = await temporaryRoot('binding-external');
        await symlink(external, path.join(root, '.ontology'));
        await expectReason(loadOrCreateWorkspaceBinding(root), 'workspace_binding_mismatch');

        const second = await initializedRepository('binding-symlink-file');
        await mkdir(path.join(second, '.ontology', 'nexus'), { recursive: true });
        const externalFile = path.join(external, 'binding.json');
        await writeFile(externalFile, '{}', 'utf8');
        await symlink(externalFile, workspaceBindingPath(second));
        await expectReason(loadOrCreateWorkspaceBinding(second), 'workspace_binding_mismatch');
    });

    test('rejects permission drift and replacement at the same lexical root', async () => {
        const malformedRoot = await initializedRepository('binding-malformed');
        await mkdir(path.dirname(workspaceBindingPath(malformedRoot)), { recursive: true });
        await writeFile(workspaceBindingPath(malformedRoot), '{"truncated":', { encoding: 'utf8', mode: 0o600 });
        await expectReason(loadOrCreateWorkspaceBinding(malformedRoot), 'workspace_binding_mismatch');

        const root = await initializedRepository('binding-replacement');
        const binding = await loadOrCreateWorkspaceBinding(root);
        await chmod(workspaceBindingPath(root), 0o644);
        await expectReason(loadOrCreateWorkspaceBinding(root), 'workspace_binding_mismatch');
        await chmod(workspaceBindingPath(root), 0o600);

        const moved = `${root}-moved`;
        roots.push(moved);
        await rename(root, moved);
        await mkdir(root, { recursive: true });
        await expectReason(verifyWorkspaceBinding(binding), 'workspace_binding_mismatch');
    });

    test('rejects paths entering a nested repository boundary', async () => {
        const root = await initializedRepository('nested-repository');
        const binding = await loadOrCreateWorkspaceBinding(root);
        const ordinary = path.join(root, 'ordinary.ts');
        await writeFile(ordinary, 'export {};\n', 'utf8');
        await expect(assertPathInWorkspaceRepository(binding, ordinary)).resolves.toBeUndefined();

        const nested = path.join(root, 'vendor', 'child');
        await mkdir(nested, { recursive: true });
        git(nested, 'init', '-q');
        const nestedFile = path.join(nested, 'child.ts');
        await writeFile(nestedFile, 'export const nested = true;\n', 'utf8');
        await expectReason(assertPathInWorkspaceRepository(binding, nestedFile), 'workspace_ref_mismatch');
    });
});

describe('workspace state receipts', () => {
    test('are restart-stable and change for tracked and untracked content', async () => {
        const root = await initializedRepository('state-digest');
        const binding = await loadOrCreateWorkspaceBinding(root);
        const first = await captureWorkspaceState(binding);
        const repeated = await captureWorkspaceState(await loadOrCreateWorkspaceBinding(root));
        expect(sameWorkspaceState(first, repeated)).toBe(true);

        await writeFile(path.join(root, 'tracked.ts'), 'export const value = 2;\n', 'utf8');
        const trackedChange = await captureWorkspaceState(binding);
        expect(sameWorkspaceState(first, trackedChange)).toBe(false);

        await writeFile(path.join(root, 'tracked.ts'), 'export const value = 1;\n', 'utf8');
        await writeFile(path.join(root, 'untracked.ts'), 'export const extra = true;\n', 'utf8');
        const untrackedChange = await captureWorkspaceState(binding);
        expect(sameWorkspaceState(first, untrackedChange)).toBe(false);

        await writeFile(path.join(root, '.gitignore'), 'ignored-source.ts\n', 'utf8');
        git(root, 'add', '.gitignore');
        git(root, 'commit', '-qm', 'ignore fixture source');
        await rm(path.join(root, 'untracked.ts'));
        await writeFile(path.join(root, 'ignored-source.ts'), 'export const ignored = 1;\n', 'utf8');
        const ignoredFirst = await captureWorkspaceState(binding);
        await writeFile(path.join(root, 'ignored-source.ts'), 'export const ignored = 2;\n', 'utf8');
        const ignoredSecond = await captureWorkspaceState(binding);
        expect(sameWorkspaceState(ignoredFirst, ignoredSecond)).toBe(false);

        await writeFile(path.join(root, 'same-a.ts'), 'export const same = true;\n', 'utf8');
        await writeFile(path.join(root, 'same-b.ts'), 'export const same = true;\n', 'utf8');
        await writeFile(path.join(root, '.gitignore'), 'ignored-source.ts\nignored-link.ts\n', 'utf8');
        git(root, 'add', '.gitignore', 'same-a.ts', 'same-b.ts');
        git(root, 'commit', '-qm', 'symlink digest fixture');
        await symlink('same-a.ts', path.join(root, 'ignored-link.ts'));
        const symlinkFirst = await captureWorkspaceState(binding);
        await rm(path.join(root, 'ignored-link.ts'));
        await symlink('same-b.ts', path.join(root, 'ignored-link.ts'));
        const symlinkSecond = await captureWorkspaceState(binding);
        expect(sameWorkspaceState(symlinkFirst, symlinkSecond)).toBe(false);
    });
});
