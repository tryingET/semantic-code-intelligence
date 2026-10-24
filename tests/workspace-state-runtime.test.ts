import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, open, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { loadOrCreateWorkspaceBinding } from '../src/core/workspace-binding.js';
import { captureWorkspaceState, sameWorkspaceState } from '../src/core/workspace-state.js';

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function fixture(ignore = '.build/\n.pio/\n'): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'sci-runtime-state-'));
    roots.push(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'sci-test@example.invalid');
    git(root, 'config', 'user.name', 'SCI Test');
    await writeFile(path.join(root, '.gitignore'), ignore);
    await writeFile(path.join(root, 'source.ts'), 'export const value = 1;\n');
    git(root, 'add', '-f', '.gitignore', 'source.ts');
    git(root, 'commit', '-qm', 'fixture');
    return root;
}

async function sparseFile(file: string): Promise<void> {
    const handle = await open(file, 'w');
    try {
        await handle.truncate(512 * 1024 * 1024 + 1);
    } finally {
        await handle.close();
    }
}

async function expectReason(promise: Promise<unknown>, expected: string): Promise<void> {
    let failure: any;
    try {
        await promise;
    } catch (error) {
        failure = error;
    }
    expect(failure?.data?.reason).toBe(expected);
}

describe('ignored root build runtimes in workspace receipts', () => {
    test('does not inventory ignored .build nested repositories or .pio dependency blobs', async () => {
        const root = await fixture();
        const binding = await loadOrCreateWorkspaceBinding(root);
        const before = await captureWorkspaceState(binding);
        const nested = path.join(root, '.build', 'scratch', 'child');
        await mkdir(nested, { recursive: true });
        git(nested, 'init', '-q');
        await writeFile(path.join(nested, 'private.ts'), 'not parent source');
        await mkdir(path.join(root, '.pio', 'libdeps'), { recursive: true });
        await sparseFile(path.join(root, '.pio', 'libdeps', 'large.bin'));
        await symlink('/outside-not-readable', path.join(root, '.build', 'outside'));
        const after = await captureWorkspaceState(binding);
        expect(sameWorkspaceState(before, after)).toBe(true);
        expect(sameWorkspaceState(after, await captureWorkspaceState(binding))).toBe(true);
    });

    test('does not exclude unignored source merely because its root is .build or .pio', async () => {
        const root = await fixture('');
        const binding = await loadOrCreateWorkspaceBinding(root);
        for (const name of ['.build', '.pio']) {
            await mkdir(path.join(root, name));
            const file = path.join(root, name, 'source.ts');
            await writeFile(file, 'export const value = 1;');
            const first = await captureWorkspaceState(binding);
            await writeFile(file, 'export const value = 2;');
            expect(sameWorkspaceState(first, await captureWorkspaceState(binding))).toBe(false);
        }
    });

    test('keeps ignored source in similar and nested paths in the digest', async () => {
        const root = await fixture('*.ts\n.build/\n.pio/\n');
        const binding = await loadOrCreateWorkspaceBinding(root);
        for (const relative of ['ignored.ts', '.build-tools/source.ts', 'src/.pio/source.ts']) {
            const file = path.join(root, relative);
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, 'first');
            const first = await captureWorkspaceState(binding);
            await writeFile(file, 'other');
            expect(sameWorkspaceState(first, await captureWorkspaceState(binding))).toBe(false);
        }
    });

    test('keeps tracked source inside an ignored runtime root in the digest', async () => {
        const root = await fixture();
        const file = path.join(root, '.build', 'tracked.ts');
        await mkdir(path.dirname(file));
        await writeFile(file, 'first');
        git(root, 'add', '-f', '.build/tracked.ts');
        git(root, 'commit', '-qm', 'tracked source');
        const binding = await loadOrCreateWorkspaceBinding(root);
        const first = await captureWorkspaceState(binding);
        await writeFile(file, 'other');
        expect(sameWorkspaceState(first, await captureWorkspaceState(binding))).toBe(false);
    });

    test('explicit files remain descriptor-checked and content-bound even in ignored runtime roots', async () => {
        const root = await fixture();
        const file = path.join(root, '.build', 'requested.ts');
        await mkdir(path.dirname(file));
        await writeFile(file, 'first');
        const binding = await loadOrCreateWorkspaceBinding(root);
        const options = { additionalPaths: ['.build/requested.ts'] };
        const first = await captureWorkspaceState(binding, options);
        await writeFile(file, 'other');
        expect(sameWorkspaceState(first, await captureWorkspaceState(binding, options))).toBe(false);
        const nested = path.join(root, '.build', 'child');
        await mkdir(nested);
        git(nested, 'init', '-q');
        await writeFile(path.join(nested, 'source.ts'), 'child source');
        await expectReason(
            captureWorkspaceState(binding, { additionalPaths: ['.build/child/source.ts'] }),
            'workspace_ref_mismatch'
        );
    });

    test('classifies a stable non-runtime nested repository directory as unavailable, not drift', async () => {
        const root = await fixture('vendor/\n');
        const nested = path.join(root, 'vendor', 'child');
        await mkdir(nested, { recursive: true });
        git(nested, 'init', '-q');
        await writeFile(path.join(nested, 'source.ts'), 'child source');
        const binding = await loadOrCreateWorkspaceBinding(root);
        await expectReason(captureWorkspaceState(binding), 'workspace_state_unavailable');
    });

    test('does not silently exclude POSIX filenames containing literal backslashes', async () => {
        if (process.platform === 'win32') return;
        for (const prefix of ['.build', '.pio']) {
            const root = await fixture('*.backup\n');
            await writeFile(path.join(root, `${prefix}\\source.backup`), 'must not be silently excluded');
            await expectReason(
                captureWorkspaceState(await loadOrCreateWorkspaceBinding(root)),
                'workspace_state_unavailable'
            );
        }
    });

    test('retains the existing byte budget for other ignored content', async () => {
        const root = await fixture('large.bin\n');
        await sparseFile(path.join(root, 'large.bin'));
        await expectReason(
            captureWorkspaceState(await loadOrCreateWorkspaceBinding(root)),
            'workspace_state_unavailable'
        );
    });
});
