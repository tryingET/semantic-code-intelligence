import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreError } from '../src/core/errors.js';
import type { StructuralEvidenceReceipt } from '../src/core/workflows/structural-evidence-contract.js';
import {
    StructuralEvidenceCliCommand,
    type StructuralEvidenceCliOutcome,
} from '../src/servers/structural-evidence-cli-command.js';
import receiptFixture from './fixtures/structural-evidence-receipt.v1.json';

const roots: string[] = [];

class CapturingStream {
    content = '';

    write(content: string, callback: (error?: Error | null) => void): boolean {
        this.content += content;
        queueMicrotask(() => callback());
        return true;
    }
}

class BackpressuredStream extends CapturingStream {
    release?: (error?: Error | null) => void;

    override write(content: string, callback: (error?: Error | null) => void): boolean {
        this.content += content;
        this.release = callback;
        return false;
    }
}

function requestFile(): string {
    const root = mkdtempSync(join(tmpdir(), 'sci-evidence-cli-command-'));
    roots.push(root);
    const file = join(root, 'request.json');
    writeFileSync(file, '{}\n', 'utf8');
    return file;
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for publication state');
        await Bun.sleep(5);
    }
}

afterEach(() => {
    while (roots.length) {
        const root = roots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

describe('experimental structural evidence CLI publication gate', () => {
    test('a signal before publication aborts with no receipt bytes', async () => {
        const stdout = new CapturingStream();
        const stderr = new CapturingStream();
        let exporterStarted = false;
        const command = new StructuralEvidenceCliCommand({
            requestFile: requestFile(),
            workspaceRoot: process.cwd(),
            stdout,
            stderr,
            formatError: (error) => String(error),
            exportReceipt: async (_input, { signal }) => {
                exporterStarted = true;
                return await new Promise<StructuralEvidenceReceipt>((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => reject(new CoreError('Internal', 'aborted before publication')),
                        { once: true }
                    );
                });
            },
        });

        const running = command.run();
        await waitFor(() => exporterStarted);
        command.handleSignal(143);
        const outcome: StructuralEvidenceCliOutcome = await running;

        expect(outcome).toEqual({ exitCode: 143, success: false });
        expect(stdout.content).toBe('');
        expect(stderr.content).toBe('');
    });

    test('a signal during a backpressured committed publication cannot flip success to 143', async () => {
        const stdout = new BackpressuredStream();
        const stderr = new CapturingStream();
        const command = new StructuralEvidenceCliCommand({
            requestFile: requestFile(),
            workspaceRoot: process.cwd(),
            stdout,
            stderr,
            formatError: (error) => String(error),
            exportReceipt: async () => receiptFixture as StructuralEvidenceReceipt,
        });

        const running = command.run();
        await waitFor(() => typeof stdout.release === 'function');
        command.handleSignal(143);
        stdout.release?.();
        const outcome = await running;

        expect(outcome).toEqual({ exitCode: 0, success: true });
        expect(JSON.parse(stdout.content)).toEqual(receiptFixture);
        expect(stderr.content).toBe('');
    });
});
