import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
    chmodSync,
    closeSync,
    existsSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const RECEIPT_SCHEMA = 'semantic-code-intelligence.repository_closeout_receipt.v1' as const;

interface CommandCapture {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: Buffer;
    stderr: Buffer;
    spawnError: string | null;
}

interface GateResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError: string | null;
}

interface ArtifactRef {
    path: string;
    sha256: string;
    byteCount: number;
    format?: string;
}

interface InventoryRef {
    capturedAt: string;
    status: ArtifactRef;
    entryCount: number | null;
    contentFingerprint: string | null;
}

export interface CloseoutDependencies {
    captureCommand?: (command: string, args: string[], cwd: string) => Promise<CommandCapture>;
    runGate?: (cwd: string, stdoutPath: string, stderrPath: string) => Promise<GateResult>;
    now?: () => Date;
    runId?: () => string;
}

export interface CloseoutResult {
    receipt: Record<string, unknown>;
    receiptPath: string;
    exitCode: number;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sha256(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function repoRelative(repoRoot: string, path: string): string {
    const result = relative(repoRoot, path).split(sep).join('/');
    if (result.length === 0 || result === '..' || result.startsWith('../')) {
        throw new Error(`artifact path escapes repository: ${path}`);
    }
    return result;
}

function assertSafeExistingPath(path: string): void {
    if (!existsSync(path)) {
        return;
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
        throw new Error(`refusing symlinked evidence path: ${path}`);
    }
    if (!stat.isDirectory()) {
        throw new Error(`evidence path is not a directory: ${path}`);
    }
}

function createRunDirectory(repoRoot: string, requestedId: string): { runDirectory: string; runId: string } {
    const testResults = join(repoRoot, '.test-results');
    const evidenceRoot = join(testResults, 'repository-closeout');
    assertSafeExistingPath(testResults);
    mkdirSync(testResults, { recursive: true, mode: 0o700 });
    chmodSync(testResults, 0o700);
    assertSafeExistingPath(evidenceRoot);
    mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
    chmodSync(evidenceRoot, 0o700);

    const safeId = requestedId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 160);
    if (safeId.length === 0 || safeId === '.' || safeId === '..') {
        throw new Error('run id is empty after sanitization');
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const runId = attempt === 0 ? safeId : `${safeId}-${attempt}`;
        const runDirectory = join(evidenceRoot, runId);
        try {
            mkdirSync(runDirectory, { mode: 0o700 });
            return { runDirectory, runId };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }
        }
    }
    throw new Error(`could not allocate unique evidence directory for ${safeId}`);
}

export function defaultCaptureCommand(command: string, args: string[], cwd: string): Promise<CommandCapture> {
    return new Promise((resolvePromise) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let spawnError: string | null = null;
        let child;
        try {
            child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            resolvePromise({ exitCode: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), spawnError: errorMessage(error) });
            return;
        }
        child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
        child.once('error', (error) => {
            spawnError = errorMessage(error);
        });
        child.once('close', (exitCode, signal) => {
            resolvePromise({
                exitCode,
                signal,
                stdout: Buffer.concat(stdout),
                stderr: Buffer.concat(stderr),
                spawnError,
            });
        });
    });
}

export function defaultRunGate(cwd: string, stdoutPath: string, stderrPath: string): Promise<GateResult> {
    return new Promise((resolvePromise) => {
        const stdoutFd = openSync(stdoutPath, 'wx', 0o600);
        const stderrFd = openSync(stderrPath, 'wx', 0o600);
        let settled = false;
        const finish = (result: GateResult) => {
            if (settled) {
                return;
            }
            settled = true;
            closeSync(stdoutFd);
            closeSync(stderrFd);
            resolvePromise(result);
        };
        let child;
        try {
            child = spawn('just', ['loop-landing-check'], {
                cwd,
                env: process.env,
                stdio: ['ignore', stdoutFd, stderrFd],
            });
        } catch (error) {
            finish({ exitCode: null, signal: null, spawnError: errorMessage(error) });
            return;
        }
        let spawnError: string | null = null;
        child.once('error', (error) => {
            spawnError = errorMessage(error);
        });
        child.once('close', (exitCode, signal) => finish({ exitCode, signal, spawnError }));
    });
}

function artifactRef(repoRoot: string, path: string, format?: string): ArtifactRef {
    const bytes = readFileSync(path);
    return {
        path: repoRelative(repoRoot, path),
        sha256: sha256(bytes),
        byteCount: bytes.byteLength,
        ...(format === undefined ? {} : { format }),
    };
}

function countPorcelainEntries(bytes: Buffer): number {
    const records = bytes.toString('utf8').split('\0');
    let count = 0;
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record.length === 0) {
            continue;
        }
        count += 1;
        const status = record.slice(0, 2);
        if (status.includes('R') || status.includes('C')) {
            index += 1;
        }
    }
    return count;
}

async function captureInventory(
    repoRoot: string,
    statusPath: string,
    captureCommand: NonNullable<CloseoutDependencies['captureCommand']>,
    capturedAt: string
): Promise<{ inventory: InventoryRef; errors: string[] }> {
    const errors: string[] = [];
    const status = await captureCommand(
        'git',
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'],
        repoRoot
    );
    writeFileSync(statusPath, status.stdout, { flag: 'wx', mode: 0o600 });
    chmodSync(statusPath, 0o600);
    if (status.spawnError !== null || status.exitCode !== 0) {
        errors.push(
            `git status observation failed: ${status.spawnError ?? `exit ${String(status.exitCode)}`}; ${status.stderr.toString('utf8').trim()}`
        );
    }

    const fingerprint = await captureCommand('scripts/git-tree-fingerprint.sh', [], repoRoot);
    const fingerprintText = fingerprint.stdout.toString('utf8').trim();
    const fingerprintSucceeded =
        fingerprint.spawnError === null &&
        fingerprint.exitCode === 0 &&
        fingerprint.stderr.byteLength === 0 &&
        /^[0-9a-f]{64}$/.test(fingerprintText);
    if (!fingerprintSucceeded) {
        errors.push(
            `workspace fingerprint observation failed: ${fingerprint.spawnError ?? `exit ${String(fingerprint.exitCode)}`}; ${fingerprint.stderr.toString('utf8').trim()}`
        );
    }

    return {
        inventory: {
            capturedAt,
            status: artifactRef(repoRoot, statusPath, 'git_status_porcelain_v1_z'),
            entryCount: status.spawnError === null && status.exitCode === 0 ? countPorcelainEntries(status.stdout) : null,
            contentFingerprint: fingerprintSucceeded ? fingerprintText : null,
        },
        errors,
    };
}

function atomicWriteJson(path: string, value: unknown): void {
    const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`);
    try {
        writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        chmodSync(tempPath, 0o600);
        renameSync(tempPath, path);
        chmodSync(path, 0o600);
    } finally {
        if (existsSync(tempPath)) {
            rmSync(tempPath, { force: true });
        }
    }
}

function defaultRunId(now: Date): string {
    return `${now.toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomBytes(6).toString('hex')}`;
}

export async function runRepositoryCloseoutReceipt(
    repoRootInput: string,
    dependencies: CloseoutDependencies = {}
): Promise<CloseoutResult> {
    const repoRoot = resolve(repoRootInput);
    const captureCommand = dependencies.captureCommand ?? defaultCaptureCommand;
    const runGate = dependencies.runGate ?? defaultRunGate;
    const now = dependencies.now ?? (() => new Date());
    const started = now();
    const allocated = createRunDirectory(repoRoot, dependencies.runId?.() ?? defaultRunId(started));
    const beforePath = join(allocated.runDirectory, 'workspace-before.status.z');
    const afterPath = join(allocated.runDirectory, 'workspace-after.status.z');
    const stdoutPath = join(allocated.runDirectory, 'landing.stdout.log');
    const stderrPath = join(allocated.runDirectory, 'landing.stderr.log');
    const receiptPath = join(allocated.runDirectory, 'receipt.json');
    const observationErrors: string[] = [];

    const before = await captureInventory(repoRoot, beforePath, captureCommand, now().toISOString());
    observationErrors.push(...before.errors.map((error) => `before: ${error}`));

    let gate: GateResult = { exitCode: null, signal: null, spawnError: null };
    let invocationCount = 0;
    let gateStatus: 'passed' | 'failed' | 'spawn_failed' | 'not_run' = 'not_run';
    if (before.errors.length === 0) {
        invocationCount = 1;
        try {
            gate = await runGate(repoRoot, stdoutPath, stderrPath);
        } catch (error) {
            gate = { exitCode: null, signal: null, spawnError: errorMessage(error) };
            if (!existsSync(stdoutPath)) {
                writeFileSync(stdoutPath, '', { flag: 'wx', mode: 0o600 });
            }
            if (!existsSync(stderrPath)) {
                writeFileSync(stderrPath, '', { flag: 'wx', mode: 0o600 });
            }
        }
        gateStatus = gate.spawnError !== null ? 'spawn_failed' : gate.exitCode === 0 ? 'passed' : 'failed';
    } else {
        writeFileSync(stdoutPath, '', { flag: 'wx', mode: 0o600 });
        writeFileSync(stderrPath, '', { flag: 'wx', mode: 0o600 });
    }
    chmodSync(stdoutPath, 0o600);
    chmodSync(stderrPath, 0o600);

    const after = await captureInventory(repoRoot, afterPath, captureCommand, now().toISOString());
    observationErrors.push(...after.errors.map((error) => `after: ${error}`));

    const observationsSucceeded = observationErrors.length === 0;
    const workspaceUnchanged = observationsSucceeded
        ? before.inventory.status.sha256 === after.inventory.status.sha256 &&
          before.inventory.contentFingerprint === after.inventory.contentFingerprint
        : null;
    const outcomeStatus = !observationsSucceeded
        ? 'observation_failed'
        : gateStatus !== 'passed'
          ? 'gate_failed'
          : workspaceUnchanged
            ? 'passed_workspace_unchanged'
            : 'workspace_changed';
    const finished = now();

    const receipt = {
        schema: RECEIPT_SCHEMA,
        run: {
            id: allocated.runId,
            taskId: process.env.LOOP_TASK_ID ?? null,
            startedAt: started.toISOString(),
            finishedAt: finished.toISOString(),
            elapsedMs: Math.max(0, finished.getTime() - started.getTime()),
        },
        delegatedGate: {
            id: 'repo_declared_landing_check',
            command: 'just loop-landing-check',
            invocationCount,
            status: gateStatus,
            exitCode: gate.exitCode,
            signal: gate.signal,
            spawnError: gate.spawnError,
            stdoutLog: artifactRef(repoRoot, stdoutPath, 'utf8_log'),
            stderrLog: artifactRef(repoRoot, stderrPath, 'utf8_log'),
        },
        workspaceInventory: {
            observer: {
                statusCommand: 'git status --porcelain=v1 -z --untracked-files=all -- .',
                fingerprintCommand: 'scripts/git-tree-fingerprint.sh',
                scope: 'git_visible_worktree',
            },
            before: before.inventory,
            after: after.inventory,
            unchanged: workspaceUnchanged,
            errors: observationErrors,
        },
        outcome: {
            repoLocalGatePassed: gateStatus === 'passed',
            workspaceUnchanged,
            status: outcomeStatus,
        },
        authorityBoundary: {
            durability: 'materialized_local',
            observationOnly: true,
            doesNotAssert: [
                'git_commit_or_cleanliness_authority',
                'ak_task_closure',
                'ak_evidence_recording',
                'fcos_item_closure',
                'ci_release_or_governance_approval',
            ],
        },
        limitations: [
            'Workspace inventory covers Git-visible tracked and untracked state; ignored filesystem state is outside this observation.',
            'Empty status inventories mean no Git-visible entries were observed, not an independent assertion of repository cleanliness.',
            'Command logs are local artifacts and may contain sensitive text emitted by delegated checks.',
            'This receipt records one repository-local gate attempt and does not promote evidence or grant Git, AK, FCOS, CI, release, or governance authority.',
        ],
    };

    atomicWriteJson(receiptPath, receipt);
    return {
        receipt,
        receiptPath: repoRelative(repoRoot, receiptPath),
        exitCode: outcomeStatus === 'passed_workspace_unchanged' ? 0 : 1,
    };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
        throw new Error('usage: bun run scripts/repository-closeout-receipt.ts [--json]');
    }
    const root = await defaultCaptureCommand('git', ['rev-parse', '--show-toplevel'], process.cwd());
    if (root.spawnError !== null || root.exitCode !== 0) {
        throw new Error(`repository root discovery failed: ${root.spawnError ?? root.stderr.toString('utf8').trim()}`);
    }
    const result = await runRepositoryCloseoutReceipt(root.stdout.toString('utf8').trim());
    const output = { ...result.receipt, receiptPath: result.receiptPath };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exitCode = result.exitCode;
}

if (import.meta.main) {
    main().catch((error) => {
        process.stderr.write(`repository closeout receipt failed: ${errorMessage(error)}\n`);
        process.exitCode = 1;
    });
}
