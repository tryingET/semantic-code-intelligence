import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateStructuralEvidenceReceipt } from '../src/core/workflows/structural-evidence-contract.js';

const roots: string[] = [];
const cli = resolve('src/servers/cli.ts');

function run(cwd: string, command: string, args: string[]) {
    return spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, PUSHGATEWAY_URL: '' } });
}

function createRepository(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-evidence-cli-target-'));
    roots.push(root);
    expect(run(root, 'git', ['init', '--quiet']).status).toBe(0);
    expect(run(root, 'git', ['config', 'user.email', 'sci@example.invalid']).status).toBe(0);
    expect(run(root, 'git', ['config', 'user.name', 'SCI Test']).status).toBe(0);
    writeFileSync(join(root, 'sample.ts'), 'const alpha = 1;\n', 'utf8');
    expect(run(root, 'git', ['add', 'sample.ts']).status).toBe(0);
    expect(run(root, 'git', ['commit', '--quiet', '-m', 'fixture']).status).toBe(0);
    return root;
}

function writeRequest(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-evidence-cli-request-'));
    roots.push(root);
    const requestPath = join(root, 'request.json');
    writeFileSync(
        requestPath,
        JSON.stringify({
            question: 'Where is alpha declared?',
            seeds: [
                { id: 'seed:language', kind: 'text', value: 'ts' },
                { id: 'seed:pattern', kind: 'text', value: 'const $A = $B' },
                { id: 'seed:sample', kind: 'path', value: 'sample.ts' },
            ],
            operations: ['structural_search'],
            limits: {
                maxCandidates: 10,
                maxCandidatesPerFile: 10,
                maxEvidenceBytes: 65_536,
                timeoutMs: 30_000,
            },
        }),
        'utf8'
    );
    return requestPath;
}

async function waitForFile(file: string): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (!existsSync(file)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
        await Bun.sleep(20);
    }
}

afterEach(() => {
    while (roots.length) {
        const root = roots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

describe('experimental structural evidence CLI', () => {
    test('prints one valid receipt and leaves the target unchanged', () => {
        const root = createRepository();
        const requestPath = writeRequest();
        const before = run(root, 'git', ['status', '--porcelain=v1', '--untracked-files=all']).stdout;

        const result = run(root, 'bun', ['run', cli, 'experimental', 'structural-evidence-receipt', '-F', requestPath]);

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const receipt = JSON.parse(result.stdout);
        expect(validateStructuralEvidenceReceipt(receipt).ok).toBe(true);
        expect(receipt.evidence).toHaveLength(1);
        expect(run(root, 'git', ['status', '--porcelain=v1', '--untracked-files=all']).stdout).toBe(before);
        expect(existsSync(join(root, '.ontology'))).toBe(false);
    });

    test('SIGTERM during post-publication shutdown preserves a valid receipt and exit 0', async () => {
        const root = createRepository();
        const requestPath = writeRequest();
        let observePush!: () => void;
        const pushObserved = new Promise<void>((resolve) => {
            observePush = resolve;
        });
        const server = createServer(() => {
            observePush();
            // Keep the response pending so the CLI remains in asynchronous shutdown.
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('missing test pushgateway address');

        const child = spawn('bun', ['run', cli, 'experimental', 'structural-evidence-receipt', '-F', requestPath], {
            cwd: root,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PUSHGATEWAY_URL: `http://127.0.0.1:${address.port}`,
                PUSHGATEWAY_TIMEOUT_MS: '250',
            },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });
        await Promise.race([
            pushObserved,
            Bun.sleep(3_000).then(() => {
                throw new Error('timed out waiting for post-publication shutdown');
            }),
        ]);
        child.kill('SIGTERM');
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            child.on('close', (code, signal) => resolve({ code, signal }));
        });
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));

        expect(exit).toEqual({ code: 0, signal: null });
        expect(stderr).toBe('');
        expect(validateStructuralEvidenceReceipt(JSON.parse(stdout)).ok).toBe(true);
    });

    test('uses stderr and no receipt stdout for invalid or symlinked request files', () => {
        const root = createRepository();
        const requestPath = writeRequest();
        writeFileSync(requestPath, '{"invalid":true}', 'utf8');

        const invalid = run(root, 'bun', [
            'run',
            cli,
            'experimental',
            'structural-evidence-receipt',
            '-F',
            requestPath,
        ]);
        expect(invalid.status).toBe(1);
        expect(invalid.stdout).toBe('');
        expect(JSON.parse(invalid.stderr).success).toBe(false);

        const link = join(root, '..', `sci-evidence-request-link-${process.pid}.json`);
        roots.push(link);
        symlinkSync(requestPath, link);
        const symlinked = run(root, 'bun', ['run', cli, 'experimental', 'structural-evidence-receipt', '-F', link]);
        expect(symlinked.status).toBe(1);
        expect(symlinked.stdout).toBe('');
        expect(JSON.parse(symlinked.stderr).success).toBe(false);

        const fifo = `${requestPath}.fifo`;
        expect(spawnSync('mkfifo', [fifo], { encoding: 'utf8' }).status).toBe(0);
        const nonRegular = run(root, 'bun', ['run', cli, 'experimental', 'structural-evidence-receipt', '-F', fifo]);
        expect(nonRegular.status).toBe(1);
        expect(nonRegular.stdout).toBe('');
        expect(JSON.parse(nonRegular.stderr).success).toBe(false);
    });

    test('SIGTERM aborts the backend, awaits cleanup, and exits with code 143', async () => {
        const root = createRepository();
        const requestPath = writeRequest();
        const harnessRoot = mkdtempSync(join(tmpdir(), 'sci-evidence-cli-signal-'));
        roots.push(harnessRoot);
        const binRoot = join(harnessRoot, 'bin');
        const captureBase = join(harnessRoot, 'captures');
        const pidFile = join(harnessRoot, 'backend.pid');
        expect(spawnSync('mkdir', ['-p', binRoot, captureBase]).status).toBe(0);
        const fakeBackend = join(binRoot, 'ast-grep');
        writeFileSync(
            fakeBackend,
            `#!/usr/bin/env bash\nif [[ "$1" == "--version" ]]; then echo 'ast-grep 9.9.9'; exit 0; fi\ntrap '' TERM\necho $$ > "$SCI_TEST_PID_FILE"\nwhile :; do sleep 1; done\n`,
            'utf8'
        );
        chmodSync(fakeBackend, 0o755);
        const child = spawn('bun', ['run', cli, 'experimental', 'structural-evidence-receipt', '-F', requestPath], {
            cwd: root,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PATH: `${binRoot}:${process.env.PATH ?? ''}`,
                PUSHGATEWAY_URL: '',
                TMPDIR: captureBase,
                SCI_TEST_PID_FILE: pidFile,
            },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });
        await waitForFile(pidFile);
        child.kill('SIGTERM');
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            child.on('close', (code, signal) => resolve({ code, signal }));
        });

        expect(exit).toEqual({ code: 143, signal: null });
        expect(stdout).toBe('');
        expect(stderr).toBe('');
        expect(readdirSync(captureBase)).toEqual([]);
        expect(run(root, 'git', ['status', '--porcelain=v1', '--untracked-files=all']).stdout).toBe('');
        expect(existsSync(join(root, '.ontology'))).toBe(false);
    });

    test('SIGTERM preserves code 143 for a non-export workflow command', async () => {
        const root = createRepository();
        const harnessRoot = mkdtempSync(join(tmpdir(), 'sci-workflow-cli-signal-'));
        roots.push(harnessRoot);
        const binRoot = join(harnessRoot, 'bin');
        const pidFile = join(harnessRoot, 'backend.pid');
        expect(spawnSync('mkdir', ['-p', binRoot]).status).toBe(0);
        const fakeBackend = join(binRoot, 'ast-grep');
        writeFileSync(
            fakeBackend,
            `#!/usr/bin/env bash\nif [[ "$1" == "--version" ]]; then echo 'ast-grep 9.9.9'; exit 0; fi\necho $$ > "$SCI_TEST_PID_FILE"\nwhile :; do sleep 1; done\n`,
            'utf8'
        );
        chmodSync(fakeBackend, 0o755);
        const child = spawn(
            'bun',
            [
                'run',
                cli,
                'workflow',
                'structural_search',
                '--args',
                JSON.stringify({ language: 'ts', pattern: 'const $A = $B', paths: ['sample.ts'] }),
                '--json',
            ],
            {
                cwd: root,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PATH: `${binRoot}:${process.env.PATH ?? ''}`,
                    PUSHGATEWAY_URL: '',
                    SCI_TEST_PID_FILE: pidFile,
                },
            }
        );
        await waitForFile(pidFile);
        child.kill('SIGTERM');
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            child.on('close', (code, signal) => resolve({ code, signal }));
        });
        const backendPid = Number(readFileSync(pidFile, 'utf8').trim());
        try {
            process.kill(backendPid, 'SIGKILL');
        } catch {}

        expect(exit).toEqual({ code: 143, signal: null });
    });
});
