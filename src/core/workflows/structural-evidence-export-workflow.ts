import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { CoreError } from '../errors.js';
import { SCI_VERSION } from '../version.js';
import { openWorkspaceFileForRead } from '../workspace-path.js';
import {
    isSafeRepositoryRelativePath,
    normalizeStructuralEvidenceRequest,
    STRUCTURAL_EVIDENCE_SCHEMA,
    type StructuralEvidenceIdentity,
    type StructuralEvidenceReceipt,
    type StructuralEvidenceRequest,
    structuralEvidenceCandidateId,
    structuralEvidenceReceiptDigest,
    structuralEvidenceRequestDigest,
    structuralEvidenceRequestSchema,
    validateStructuralEvidenceReceipt,
} from './structural-evidence-contract.js';
import {
    materializeRawCommit,
    type RunGitBytes,
    runGitBytes,
    structuralEvidenceGitEnvironment,
} from './structural-evidence-git-snapshot.js';
import { runStructuralEvidenceProcess, type StructuralEvidenceProcessResult } from './structural-evidence-process.js';
import {
    type AstGrepBackend,
    findAstGrepBackend,
    normalizeStructuralPaths,
    structuralProcessErrorPayload,
} from './structural-workflow.js';

const EXPORT_WORKFLOW = 'structural-evidence-export-v1';
const MAX_PROCESS_BUFFER = 32 * 1024 * 1024;
const COMPLETE_SCAN_IGNORE_ARGS = [
    '--no-ignore',
    'hidden',
    '--no-ignore',
    'dot',
    '--no-ignore',
    'exclude',
    '--no-ignore',
    'global',
    '--no-ignore',
    'parent',
    '--no-ignore',
    'vcs',
] as const;

interface GitResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

export interface StructuralEvidenceExportDependencies {
    findBackend(): AstGrepBackend | null;
    runProcess(
        command: string,
        args: string[],
        options: {
            cwd: string;
            timeoutMs: number;
            maxBuffer: number;
            signal?: AbortSignal;
        }
    ): Promise<StructuralEvidenceProcessResult>;
    makeTemporaryRoot(): Promise<string>;
    removeTemporaryRoot(root: string): Promise<void>;
    runGit(cwd: string | null, args: string[]): GitResult;
    runGitBytes: RunGitBytes;
}

export interface StructuralEvidenceExportOptions {
    workspaceRoot: string;
    dependencies?: Partial<StructuralEvidenceExportDependencies>;
    signal?: AbortSignal;
}

interface SearchSeedValues {
    language: string;
    pattern: string;
    paths: string[];
}

const defaultDependencies: StructuralEvidenceExportDependencies = {
    findBackend: findAstGrepBackend,
    runProcess: runStructuralEvidenceProcess,
    makeTemporaryRoot: () => mkdtemp(path.join(tmpdir(), 'sci-structural-evidence-')),
    removeTemporaryRoot: (root) => rm(root, { recursive: true, force: true }),
    runGit: (cwd, args) => {
        const commandArgs = cwd ? ['-C', cwd, ...args] : args;
        const result = spawnSync('git', commandArgs, {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
            timeout: 30_000,
            env: structuralEvidenceGitEnvironment(),
        });
        return {
            status: result.status,
            stdout: String(result.stdout || ''),
            stderr: String(result.stderr || ''),
        };
    },
    runGitBytes,
};

function invalid(message: string, data?: Record<string, unknown>): CoreError {
    return new CoreError('InvalidParams', message, data);
}

function isContainedPath(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function gitOutput(result: GitResult, operation: string): string {
    if (result.status === 0) return result.stdout.trim();
    throw new CoreError('Internal', `${operation} failed`, {
        status: result.status,
        stderr: result.stderr.trim().slice(0, 2000),
    });
}

async function resolveCleanRepositoryRoot(
    requestedRoot: string,
    dependencies: StructuralEvidenceExportDependencies
): Promise<{ root: string; commit: string }> {
    const root = await realpath(path.resolve(requestedRoot));
    const topLevel = await realpath(gitOutput(dependencies.runGit(root, ['rev-parse', '--show-toplevel']), 'git root'));
    if (topLevel !== root) throw invalid('structural evidence export must run from the repository root');
    const commitBefore = gitOutput(dependencies.runGit(root, ['rev-parse', '--verify', 'HEAD']), 'git HEAD');
    if (!/^[a-f0-9]{40,64}$/.test(commitBefore)) throw new CoreError('Internal', 'git HEAD was not a full commit');
    const status = gitOutput(
        dependencies.runGit(root, ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '--untracked-files=all']),
        'git status'
    );
    const commitAfter = gitOutput(dependencies.runGit(root, ['rev-parse', '--verify', 'HEAD']), 'git HEAD recheck');
    if (status || commitBefore !== commitAfter) {
        throw invalid('structural evidence export requires a stable clean repository snapshot');
    }
    return { root, commit: commitAfter };
}

function parseSearchSeeds(request: StructuralEvidenceRequest): SearchSeedValues {
    if (request.operations.length !== 1 || request.operations[0] !== 'structural_search') {
        throw invalid('Phase B export supports exactly one structural_search operation');
    }
    const languageSeeds = request.seeds.filter((seed) => seed.id === 'seed:language' && seed.kind === 'text');
    const patternSeeds = request.seeds.filter((seed) => seed.id === 'seed:pattern' && seed.kind === 'text');
    const unsupported = request.seeds.filter(
        (seed) => seed.kind !== 'path' && seed.id !== 'seed:language' && seed.id !== 'seed:pattern'
    );
    if (languageSeeds.length !== 1 || patternSeeds.length !== 1 || unsupported.length > 0) {
        throw invalid(
            'request requires one seed:language text seed, one seed:pattern text seed, and optional path seeds'
        );
    }
    return {
        language: languageSeeds[0].value,
        pattern: patternSeeds[0].value,
        paths: request.seeds.filter((seed) => seed.kind === 'path').map((seed) => seed.value),
    };
}

function parseStrictAstGrepJsonLines(stdout: string): Record<string, unknown>[] {
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    return trimmed.split(/\r?\n/).map((line, index) => {
        try {
            const value = JSON.parse(line);
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
            return value;
        } catch {
            throw new CoreError('Internal', `ast-grep returned malformed JSON at record ${index + 1}`);
        }
    });
}

function sourcePosition(buffer: Buffer, byteOffset: number): { line: number; column: number } {
    const prefix = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, byteOffset));
    const lines = prefix.split('\n');
    const lastLine = lines[lines.length - 1] ?? '';
    return { line: lines.length - 1, column: [...lastLine].length };
}

async function assertRegularPathWithoutSymlinks(root: string, relativePath: string): Promise<void> {
    const parts = relativePath.split('/');
    let current = root;
    for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        const stat = await lstat(current).catch(() => null);
        const final = index === parts.length - 1;
        if (!stat || stat.isSymbolicLink() || (final ? !stat.isFile() : !stat.isDirectory())) {
            throw new CoreError('Internal', 'ast-grep evidence path is not a regular committed file');
        }
    }
}

async function portableMatch(
    raw: any,
    captureRoot: string,
    sourceCache: Map<string, Buffer>
): Promise<{ identity: StructuralEvidenceIdentity; snippet: string }> {
    const matchPath = String(raw?.file || '')
        .trim()
        .replace(/\\/g, '/');
    const start = raw?.range?.start;
    const end = raw?.range?.end;
    const byteStart = raw?.range?.byteOffset?.start;
    const byteEnd = raw?.range?.byteOffset?.end;
    const snippet = String(raw?.text || '');
    if (!isSafeRepositoryRelativePath(matchPath)) throw new CoreError('Internal', 'ast-grep returned an unsafe path');
    await assertRegularPathWithoutSymlinks(captureRoot, matchPath);
    if (
        !Number.isSafeInteger(start?.line) ||
        start.line < 0 ||
        !Number.isSafeInteger(start?.column) ||
        start.column < 0 ||
        !Number.isSafeInteger(end?.line) ||
        end.line < 0 ||
        !Number.isSafeInteger(end?.column) ||
        end.column < 0 ||
        !Number.isSafeInteger(byteStart) ||
        byteStart < 0 ||
        !Number.isSafeInteger(byteEnd) ||
        byteEnd < byteStart ||
        !/\S/.test(snippet)
    ) {
        throw new CoreError('Internal', 'ast-grep returned malformed match evidence');
    }
    let source = sourceCache.get(matchPath);
    if (!source) {
        const opened = await openWorkspaceFileForRead(matchPath, {
            workspaceRoot: captureRoot,
            inputLabel: 'structural evidence match file',
        });
        try {
            const stat = await opened.handle.stat();
            if (stat.size > 64 * 1024 * 1024)
                throw new CoreError('Internal', 'structural evidence file exceeds 64 MiB');
            source = await opened.handle.readFile();
        } finally {
            await opened.handle.close().catch(() => undefined);
        }
        sourceCache.set(matchPath, source);
    }
    if (byteEnd > source.length) throw new CoreError('Internal', 'ast-grep range exceeds source file');
    const sourceSnippet = new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(byteStart, byteEnd));
    if (sourceSnippet !== snippet) throw new CoreError('Internal', 'ast-grep snippet does not match source bytes');
    const verifiedStart = sourcePosition(source, byteStart);
    const verifiedEnd = sourcePosition(source, byteEnd);
    if (
        verifiedStart.line !== start.line ||
        verifiedStart.column !== start.column ||
        verifiedEnd.line !== end.line ||
        verifiedEnd.column !== end.column
    ) {
        throw new CoreError('Internal', 'ast-grep line and column range does not match source bytes');
    }
    return {
        identity: {
            path: matchPath,
            kind: 'match',
            range: { start: verifiedStart, end: verifiedEnd },
        },
        snippet,
    };
}

async function buildEvidence(
    matches: any[],
    request: StructuralEvidenceRequest,
    backend: AstGrepBackend,
    captureRoot: string
): Promise<Pick<StructuralEvidenceReceipt, 'evidence' | 'summary' | 'limitations'>> {
    const evidence: StructuralEvidenceReceipt['evidence'] = [];
    const seen = new Set<string>();
    const perFile = new Map<string, number>();
    const limitations: StructuralEvidenceReceipt['limitations'] = [];
    let evidenceBytes = 0;
    let oversizedSnippet = false;
    const sourceCache = new Map<string, Buffer>();
    for (const raw of matches) {
        const converted = await portableMatch(raw, captureRoot, sourceCache);
        if ([...converted.snippet].length > 20_000) {
            oversizedSnippet = true;
            continue;
        }
        const id = structuralEvidenceCandidateId(converted.identity);
        if (seen.has(id)) continue;
        const byteCount = Buffer.byteLength(converted.snippet, 'utf8');
        const fileCount = perFile.get(converted.identity.path) ?? 0;
        if (
            evidence.length >= request.limits.maxCandidates ||
            fileCount >= request.limits.maxCandidatesPerFile ||
            evidenceBytes + byteCount > request.limits.maxEvidenceBytes
        ) {
            continue;
        }
        seen.add(id);
        perFile.set(converted.identity.path, fileCount + 1);
        evidenceBytes += byteCount;
        evidence.push({
            id,
            identity: converted.identity,
            operation: 'structural_search',
            snippet: converted.snippet,
            byteCount,
            provenance: { backend: backend.name, workflow: EXPORT_WORKFLOW },
        });
    }
    if (oversizedSnippet) {
        limitations.push({
            code: 'snippet_too_large',
            message: 'One or more matches exceeded the receipt snippet bound',
            affectsCompleteness: true,
        });
    }
    const capped = matches.length > evidence.length;
    return {
        evidence,
        summary: {
            returnedCount: evidence.length,
            totalObservedCount: matches.length,
            evidenceBytes,
            capped,
            complete: !capped && limitations.length === 0,
        },
        limitations,
    };
}

export async function exportStructuralEvidenceReceipt(
    input: unknown,
    options: StructuralEvidenceExportOptions
): Promise<StructuralEvidenceReceipt> {
    const parsed = structuralEvidenceRequestSchema.safeParse(input);
    if (!parsed.success) {
        throw invalid('invalid structural evidence request', {
            issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
    }
    const request = normalizeStructuralEvidenceRequest(parsed.data);
    const seeds = parseSearchSeeds(request);
    const dependencies = { ...defaultDependencies, ...options.dependencies };
    const repository = await resolveCleanRepositoryRoot(options.workspaceRoot, dependencies);
    const temporaryBase = await realpath(tmpdir());
    if (isContainedPath(repository.root, temporaryBase)) {
        throw new CoreError('Internal', 'temporary directory must be outside the target repository');
    }
    const backend = dependencies.findBackend();
    if (!backend) throw new CoreError('Internal', 'ast-grep with a parseable version is required');

    const temporaryRoots: string[] = [];
    const realTemporaryRoots = new Set<string>();
    let evidence: Pick<StructuralEvidenceReceipt, 'evidence' | 'summary' | 'limitations'> | undefined;
    let operationError: unknown;
    try {
        for (let index = 0; index < 2; index++) {
            const temporaryRoot = await dependencies.makeTemporaryRoot();
            temporaryRoots.push(temporaryRoot);
            const realTemporaryRoot = await realpath(temporaryRoot);
            if (realTemporaryRoots.has(realTemporaryRoot)) {
                throw new CoreError('Internal', 'temporary capture roots must be distinct');
            }
            realTemporaryRoots.add(realTemporaryRoot);
            if (isContainedPath(repository.root, realTemporaryRoot)) {
                throw new CoreError('Internal', 'temporary capture root must be outside the target repository');
            }
        }
        const queryRoot = await materializeRawCommit(
            repository.root,
            repository.commit,
            temporaryRoots[0],
            'query',
            dependencies.runGitBytes
        );
        const verificationRoot = await materializeRawCommit(
            repository.root,
            repository.commit,
            temporaryRoots[1],
            'verification',
            dependencies.runGitBytes
        );
        const paths = await normalizeStructuralPaths(seeds.paths, queryRoot);
        const processResult = await dependencies.runProcess(
            backend.command,
            [
                'run',
                '--pattern',
                seeds.pattern,
                '--lang',
                seeds.language,
                '--json=stream',
                ...COMPLETE_SCAN_IGNORE_ARGS,
                '--',
                ...paths,
            ],
            {
                cwd: queryRoot,
                timeoutMs: request.limits.timeoutMs,
                maxBuffer: Math.min(MAX_PROCESS_BUFFER, Math.max(1024 * 1024, request.limits.maxEvidenceBytes * 4)),
                signal: options.signal,
            }
        );
        if (
            processResult.status !== 0 ||
            processResult.timedOut ||
            processResult.outputExceeded ||
            processResult.aborted === true ||
            processResult.terminationConfirmed === false
        ) {
            const failure = structuralProcessErrorPayload(processResult, 'ast-grep run');
            throw new CoreError('Internal', failure.message || failure.code, failure);
        }
        const matches = parseStrictAstGrepJsonLines(processResult.stdout);
        evidence = await buildEvidence(matches, request, backend, verificationRoot);
    } catch (error) {
        operationError = error;
    }
    const cleanup = await Promise.allSettled(
        temporaryRoots.map((temporaryRoot) => dependencies.removeTemporaryRoot(temporaryRoot))
    );
    const cleanupFailure = cleanup.find((result) => result.status === 'rejected');
    if (cleanupFailure?.status === 'rejected') throw cleanupFailure.reason;
    if (operationError) throw operationError;
    if (!evidence) throw new CoreError('Internal', 'structural evidence export did not collect evidence');
    if (options.signal?.aborted) throw new CoreError('Internal', 'structural evidence export aborted');
    const observed = await resolveCleanRepositoryRoot(repository.root, dependencies);
    if (observed.commit !== repository.commit) throw new CoreError('Internal', 'repository changed during export');
    const body: Omit<StructuralEvidenceReceipt, 'receiptDigest'> = {
        schema: STRUCTURAL_EVIDENCE_SCHEMA,
        request,
        requestDigest: structuralEvidenceRequestDigest(request),
        repository: {
            snapshotId: `git:${repository.commit}`,
            baseFingerprint: `git:${repository.commit}`,
            observedFingerprint: `git:${observed.commit}`,
            stableAcrossExecution: true,
        },
        producer: {
            name: 'semantic-code-intelligence',
            version: SCI_VERSION,
            workflow: EXPORT_WORKFLOW,
        },
        backend: {
            name: backend.name,
            version: backend.version,
            executable: { name: backend.name, version: backend.version },
            outcome: { status: 'succeeded', exitCode: 0, message: 'structural search completed' },
        },
        ...evidence,
    };
    const receipt = { ...body, receiptDigest: structuralEvidenceReceiptDigest(body) };
    const validation = validateStructuralEvidenceReceipt(receipt);
    if (!validation.ok) {
        throw new CoreError('Internal', 'generated structural evidence receipt failed validation', {
            errors: validation.errors,
        });
    }
    const finalObserved = await resolveCleanRepositoryRoot(repository.root, dependencies);
    if (finalObserved.commit !== repository.commit)
        throw new CoreError('Internal', 'repository changed before receipt publication');
    if (options.signal?.aborted)
        throw new CoreError('Internal', 'structural evidence export aborted before publication');
    return receipt;
}
