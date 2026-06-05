import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();

test('CLI init rejects an existing .ontology symlink before writing config', () => {
    const root = mkdtempSync(join(tmpdir(), 'sci-cli-init-boundary-'));
    const outside = mkdtempSync(join(tmpdir(), 'sci-cli-init-outside-'));
    try {
        symlinkSync(outside, join(root, '.ontology'), 'dir');
        const proc = spawnSync(process.execPath, ['run', join(repoRoot, 'src/servers/cli.ts'), 'init'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, SILENT_MODE: 'true' },
            timeout: 10_000,
        });
        const output = `${proc.stdout || ''}${proc.stderr || ''}`;
        expect(proc.status).not.toBe(0);
        expect(output).toContain('.ontology path must not be a symlink');
        expect(output).not.toContain('Semantic Code Intelligence initialized');
    } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
    }
});
