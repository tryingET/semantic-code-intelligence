import { spawn } from 'node:child_process';
import { CoreError } from '../errors.js';

export interface StructuralEvidenceProcessResult {
    status: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    outputExceeded: boolean;
    /** Optional only for narrow injected test doubles; the real runner always sets it. */
    aborted?: boolean;
    /** Optional only for narrow injected test doubles; false always fails receipt publication. */
    terminationConfirmed?: boolean;
}

export interface StructuralEvidenceProcessOptions {
    cwd: string;
    timeoutMs: number;
    maxBuffer: number;
    signal?: AbortSignal;
    terminationGraceMs?: number;
    terminationDeadlineMs?: number;
}

export interface StructuralEvidenceProcessDependencies {
    /** Test seam for deterministic deadline coverage; production uses an OS process-group probe. */
    processTreeExists?(processGroupId: number): boolean;
}

const DEFAULT_TERMINATION_GRACE_MS = 250;
const DEFAULT_TERMINATION_DEADLINE_MS = 2_000;
const TERMINATION_POLL_MS = 25;

/**
 * Runs the experimental evidence backend with producer-owned, bounded process-tree supervision.
 * A result with terminationConfirmed=false must never be used to publish a receipt.
 */
export async function runStructuralEvidenceProcess(
    command: string,
    args: string[],
    options: StructuralEvidenceProcessOptions,
    dependencies: StructuralEvidenceProcessDependencies = {}
): Promise<StructuralEvidenceProcessResult> {
    if (process.platform === 'win32') {
        throw new CoreError('Internal', 'structural evidence process-group supervision is unavailable on Windows');
    }
    return await new Promise((resolve) => {
        const detached = true;
        const proc = spawn(command, args, { cwd: options.cwd, detached, stdio: ['ignore', 'pipe', 'pipe'] });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let outputBytes = 0;
        let settled = false;
        let terminating = false;
        let timedOut = false;
        let outputExceeded = false;
        let aborted = false;
        let closeStatus: number | null = null;
        const terminationGraceMs = Math.max(1, options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
        const terminationDeadlineMs = Math.max(
            terminationGraceMs + 1,
            options.terminationDeadlineMs ?? DEFAULT_TERMINATION_DEADLINE_MS
        );
        let executionTimer: ReturnType<typeof setTimeout>;
        let escalationTimer: ReturnType<typeof setTimeout> | undefined;
        let terminationTimer: ReturnType<typeof setTimeout> | undefined;
        let groupPollTimer: ReturnType<typeof setTimeout> | undefined;

        const appendText = (chunks: Buffer[], text: string) => {
            const chunk = Buffer.from(text, 'utf8');
            chunks.push(chunk);
            outputBytes += chunk.length;
        };
        const killProcessTree = (signal: NodeJS.Signals) => {
            try {
                if (detached && proc.pid) process.kill(-proc.pid, signal);
                else proc.kill(signal);
            } catch {}
        };
        const processTreeExists = (): boolean => {
            if (!proc.pid) return false;
            if (dependencies.processTreeExists) return dependencies.processTreeExists(proc.pid);
            try {
                process.kill(-proc.pid, 0);
                return true;
            } catch {
                return false;
            }
        };
        const abort = () => {
            aborted = true;
            appendText(stderrChunks, '\nprocess aborted');
            terminate();
        };
        const finish = (terminationConfirmed: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(executionTimer);
            if (escalationTimer) clearTimeout(escalationTimer);
            if (terminationTimer) clearTimeout(terminationTimer);
            if (groupPollTimer) clearTimeout(groupPollTimer);
            options.signal?.removeEventListener('abort', abort);
            resolve({
                status: closeStatus,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                timedOut,
                outputExceeded,
                aborted,
                terminationConfirmed,
            });
        };
        const confirmTermination = () => {
            if (!processTreeExists()) {
                finish(true);
                return;
            }
            groupPollTimer = setTimeout(confirmTermination, TERMINATION_POLL_MS);
        };
        const escalate = () => {
            killProcessTree('SIGKILL');
            confirmTermination();
        };
        function terminate() {
            if (terminating || settled) return;
            terminating = true;
            killProcessTree('SIGTERM');
            escalationTimer = setTimeout(escalate, terminationGraceMs);
            terminationTimer = setTimeout(() => {
                killProcessTree('SIGKILL');
                appendText(stderrChunks, `\nprocess termination was not confirmed within ${terminationDeadlineMs}ms`);
                finish(false);
            }, terminationDeadlineMs);
        }
        const append = (chunks: Buffer[], chunk: unknown) => {
            if (terminating || settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            if (outputBytes + buffer.length > options.maxBuffer) {
                outputExceeded = true;
                appendText(stderrChunks, `\nprocess output exceeded ${options.maxBuffer} bytes`);
                terminate();
                return;
            }
            chunks.push(buffer);
            outputBytes += buffer.length;
        };

        executionTimer = setTimeout(() => {
            timedOut = true;
            appendText(stderrChunks, `\nprocess timed out after ${options.timeoutMs}ms`);
            terminate();
        }, options.timeoutMs);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        proc.stdout?.on('data', (chunk) => append(stdoutChunks, chunk));
        proc.stderr?.on('data', (chunk) => append(stderrChunks, chunk));
        proc.on('error', (error) => {
            appendText(stderrChunks, error instanceof Error ? error.message : String(error));
            closeStatus = null;
            if (terminating && processTreeExists()) return;
            finish(true);
        });
        proc.on('close', (code) => {
            closeStatus = code;
            if (!terminating) {
                finish(true);
                return;
            }
            if (!processTreeExists()) finish(true);
        });
    });
}
