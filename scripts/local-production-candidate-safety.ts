import { randomUUID } from 'node:crypto';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

export type CandidateFailureStage =
    | 'setup'
    | 'artifact_build'
    | 'artifact_validation'
    | 'installation'
    | 'cli_validation'
    | 'mcp_stdio'
    | 'workspace_integrity'
    | 'cleanup'
    | 'evidence_write'
    | 'unexpected';

const FAILURE_SUMMARIES: Record<CandidateFailureStage, string> = {
    setup: 'Local candidate setup failed.',
    artifact_build: 'Local candidate artifact build failed.',
    artifact_validation: 'Local candidate artifact validation failed.',
    installation: 'Isolated local candidate installation failed.',
    cli_validation: 'Installed CLI validation failed.',
    mcp_stdio: 'Installed MCP stdio validation failed.',
    workspace_integrity: 'Target workspace integrity validation failed.',
    cleanup: 'Local candidate scratch cleanup failed.',
    evidence_write: 'Local candidate evidence write failed.',
    unexpected: 'Local candidate validation failed unexpectedly.',
};

export class CandidateStageError extends Error {
    readonly stage: CandidateFailureStage;
    readonly diagnostic: unknown;

    constructor(stage: CandidateFailureStage, diagnostic: unknown) {
        super(FAILURE_SUMMARIES[stage]);
        this.name = 'CandidateStageError';
        this.stage = stage;
        this.diagnostic = diagnostic;
    }
}

export function asCandidateStageError(stage: CandidateFailureStage, error: unknown): CandidateStageError {
    return error instanceof CandidateStageError ? error : new CandidateStageError(stage, error);
}

export function toCandidateFailureEvidence(error: unknown): {
    code: string;
    stage: CandidateFailureStage;
    message: string;
    diagnosticsPromoted: false;
} {
    const failure = error instanceof CandidateStageError ? error : new CandidateStageError('unexpected', error);
    return {
        code: `candidate_${failure.stage}_failed`,
        stage: failure.stage,
        message: FAILURE_SUMMARIES[failure.stage],
        diagnosticsPromoted: false,
    };
}

export function candidateLocalDiagnostic(error: unknown): string {
    const diagnostic = error instanceof CandidateStageError ? error.diagnostic : error;
    return (diagnostic instanceof Error ? diagnostic.message : String(diagnostic)).slice(-6000);
}

export function lstatIfExists(path: string): ReturnType<typeof lstatSync> | null {
    try {
        return lstatSync(path);
    } catch (error: any) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

export function isPhysicallyContained(parent: string, candidate: string, allowEqual = false): boolean {
    const rel = relative(parent, candidate);
    if (rel === '') return allowEqual;
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function ensurePhysicalResultsRoot(repoRoot: string): string {
    const resultsRoot = join(repoRoot, '.test-results');
    const existing = lstatIfExists(resultsRoot);
    if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) {
            throw new Error('Local production results root must be a real directory');
        }
    } else {
        mkdirSync(resultsRoot, { recursive: false, mode: 0o700 });
    }
    const physical = realpathSync(resultsRoot);
    if (physical !== resultsRoot || !isPhysicallyContained(repoRoot, physical)) {
        throw new Error('Local production results root escaped the physical repository');
    }
    return physical;
}

export function assertNoSymlinkedAncestors(
    root: string,
    candidate: string,
    label: string,
    allowEqual = false
): void {
    if (!isPhysicallyContained(root, candidate, allowEqual)) {
        throw new Error(`${label} must stay below the repository .test-results directory`);
    }

    let current = root;
    for (const segment of relative(root, candidate).split(sep)) {
        current = join(current, segment);
        const metadata = lstatIfExists(current);
        if (!metadata) break;
        if (metadata.isSymbolicLink()) throw new Error(`${label} must not traverse a symlinked ancestor`);
        const physical = realpathSync(current);
        if (!isPhysicallyContained(root, physical, true)) {
            throw new Error(`${label} escaped the physical repository results root`);
        }
    }
}

export function assertContainedRealDirectory(root: string, candidate: string, label: string): void {
    const metadata = lstatIfExists(candidate);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`${label} must be a real contained directory`);
    }
    assertNoSymlinkedAncestors(root, candidate, label);
    if (realpathSync(candidate) !== candidate) throw new Error(`${label} escaped its physical root`);
}

export function invalidateContainedFile(root: string, target: string, label: string): void {
    assertNoSymlinkedAncestors(root, dirname(target), label, true);
    const metadata = lstatIfExists(target);
    if (!metadata) return;
    if (!isPhysicallyContained(root, target)) throw new Error(`${label} escaped the physical results root`);
    if (metadata.isSymbolicLink()) {
        rmSync(target, { force: true });
        return;
    }
    if (!metadata.isFile() || !isPhysicallyContained(root, realpathSync(target))) {
        throw new Error(`${label} must be a regular contained file`);
    }
    rmSync(target, { force: true });
}

export function cleanupContainedDirectory(root: string, candidate: string, label: string): void {
    const existing = lstatIfExists(candidate);
    if (!existing) return;
    assertContainedRealDirectory(root, candidate, label);
    rmSync(candidate, { recursive: true, force: true });
}

export function resolveContainedRegularFile(root: string, candidate: string, label: string): string {
    const metadata = lstatIfExists(candidate);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`${label} must be a regular file`);
    }
    const physical = realpathSync(candidate);
    if (!isPhysicallyContained(root, physical)) throw new Error(`${label} escaped the physical results root`);
    return physical;
}

export function writeJsonAtomically(root: string, target: string, packet: unknown): void {
    assertNoSymlinkedAncestors(root, target, 'Candidate evidence path');
    const temporary = join(root, `.${basename(target)}-${process.pid}-${randomUUID()}.tmp`);
    let renamed = false;
    try {
        writeFileSync(temporary, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        renameSync(temporary, target);
        renamed = true;
    } finally {
        if (!renamed) rmSync(temporary, { force: true });
    }
}

interface ShutdownOptions {
    termAfterMs?: number;
    killAfterMs?: number;
    finalAfterMs?: number;
}

function processClosed(proc: ChildProcessWithoutNullStreams): boolean {
    const exited = proc.exitCode !== null || proc.signalCode !== null;
    const stdoutEnded = proc.stdout.readableEnded || proc.stdout.destroyed;
    const stderrEnded = proc.stderr.readableEnded || proc.stderr.destroyed;
    return exited && stdoutEnded && stderrEnded;
}

export async function shutdownMcpProcess(
    proc: ChildProcessWithoutNullStreams,
    options: ShutdownOptions = {}
): Promise<void> {
    const termAfterMs = options.termAfterMs ?? 5000;
    const killAfterMs = options.killAfterMs ?? 6000;
    const finalAfterMs = options.finalAfterMs ?? 8000;
    if (!(termAfterMs >= 0 && killAfterMs >= termAfterMs && finalAfterMs > killAfterMs)) {
        throw new Error('Invalid MCP shutdown deadlines');
    }

    if (!proc.stdin.destroyed) proc.stdin.end();
    if (processClosed(proc)) return;

    await new Promise<void>((resolveClose, rejectClose) => {
        let settled = false;
        let termTimer: ReturnType<typeof setTimeout> | undefined;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        let finalTimer: ReturnType<typeof setTimeout> | undefined;

        function cleanup(): void {
            if (termTimer) clearTimeout(termTimer);
            if (killTimer) clearTimeout(killTimer);
            if (finalTimer) clearTimeout(finalTimer);
            proc.off('close', finish);
            proc.off('error', failShutdown);
        }
        function finish(): void {
            if (settled) return;
            settled = true;
            cleanup();
            resolveClose();
        }
        function failShutdown(error: Error): void {
            if (settled) return;
            settled = true;
            cleanup();
            rejectClose(error);
        }

        proc.once('close', finish);
        proc.once('error', failShutdown);
        if (processClosed(proc)) {
            finish();
            return;
        }

        termTimer = setTimeout(() => {
            if (processClosed(proc)) finish();
            else proc.kill('SIGTERM');
        }, termAfterMs);
        killTimer = setTimeout(() => {
            if (processClosed(proc)) finish();
            else proc.kill('SIGKILL');
        }, killAfterMs);
        finalTimer = setTimeout(() => {
            if (processClosed(proc)) finish();
            else failShutdown(new Error('MCP stdio shutdown exceeded its final deadline'));
        }, finalAfterMs);
    });
}
