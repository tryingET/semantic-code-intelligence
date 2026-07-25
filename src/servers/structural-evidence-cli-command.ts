import * as fs from 'node:fs';
import * as path from 'node:path';
import { strictJsonParse } from '../adapters/utils.js';
import { CoreError } from '../core/errors.js';
import type { StructuralEvidenceReceipt } from '../core/workflows/structural-evidence-contract.js';

interface OutputStream {
    write(content: string, callback: (error?: Error | null) => void): boolean;
}

export interface StructuralEvidenceCliOutcome {
    exitCode: number;
    success: boolean;
}

export interface StructuralEvidenceCliCommandOptions {
    requestFile: string;
    workspaceRoot: string;
    stdout: OutputStream;
    stderr: OutputStream;
    formatError(error: unknown): string;
    exportReceipt?: (
        input: unknown,
        options: { workspaceRoot: string; signal: AbortSignal }
    ) => Promise<StructuralEvidenceReceipt>;
}

type PublicationState = 'collecting' | 'aborted' | 'publishing' | 'published' | 'failed';

export function readBoundedStructuralEvidenceRequestFile(requestedPath: string): string {
    const inputPath = path.resolve(requestedPath);
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw new CoreError('Internal', 'request-file no-follow reads are unavailable on this platform');
    }
    const nonblock = typeof fs.constants.O_NONBLOCK === 'number' ? fs.constants.O_NONBLOCK : 0;
    const descriptor = fs.openSync(inputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | nonblock);
    try {
        const before = fs.fstatSync(descriptor);
        if (!before.isFile() || before.size > 1024 * 1024) {
            throw new CoreError('InvalidParams', 'request file must be a regular file of at most 1 MiB');
        }
        const chunks: Buffer[] = [];
        let total = 0;
        while (total <= 1024 * 1024) {
            const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, 1024 * 1024 + 1 - total));
            const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
            if (count === 0) break;
            chunks.push(chunk.subarray(0, count));
            total += count;
        }
        if (total > 1024 * 1024) throw new CoreError('InvalidParams', 'request file exceeds 1 MiB');
        const after = fs.fstatSync(descriptor);
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs
        ) {
            throw new CoreError('InvalidParams', 'request file changed while being read');
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
    } finally {
        fs.closeSync(descriptor);
    }
}

async function writeStream(stream: OutputStream, content: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        stream.write(content, (error) => (error ? reject(error) : resolve()));
    });
}

/**
 * Owns cancellation and the single receipt-publication commit point for the experimental command.
 * Signals before publishing abort with no stdout. Signals after publishing begins cannot change success to 130/143.
 */
export class StructuralEvidenceCliCommand {
    private readonly controller = new AbortController();
    private state: PublicationState = 'collecting';
    private signalExitCode?: number;

    constructor(private readonly options: StructuralEvidenceCliCommandOptions) {}

    handleSignal(exitCode: number): void {
        if (this.state !== 'collecting') return;
        this.signalExitCode = exitCode;
        this.state = 'aborted';
        this.controller.abort();
    }

    async run(): Promise<StructuralEvidenceCliOutcome> {
        try {
            const body = readBoundedStructuralEvidenceRequestFile(this.options.requestFile);
            const request = strictJsonParse(body);
            const exportReceipt =
                this.options.exportReceipt ??
                (await import('../core/workflows/structural-evidence-export-workflow.js'))
                    .exportStructuralEvidenceReceipt;
            if (this.state === 'aborted')
                throw new CoreError('Internal', 'structural evidence receipt publication aborted');
            const receipt = await exportReceipt(request, {
                workspaceRoot: this.options.workspaceRoot,
                signal: this.controller.signal,
            });
            if (this.state === 'aborted' || this.controller.signal.aborted) {
                throw new CoreError('Internal', 'structural evidence receipt publication aborted');
            }

            // This synchronous state transition is the cooperative-signal publication commit point.
            this.state = 'publishing';
            await writeStream(this.options.stdout, `${JSON.stringify(receipt, null, 2)}\n`);
            this.state = 'published';
            return { exitCode: 0, success: true };
        } catch (error) {
            if (this.state === 'aborted' && this.signalExitCode) {
                return { exitCode: this.signalExitCode, success: false };
            }
            this.state = 'failed';
            await writeStream(this.options.stderr, `${this.options.formatError(error)}\n`);
            return { exitCode: 1, success: false };
        }
    }
}
