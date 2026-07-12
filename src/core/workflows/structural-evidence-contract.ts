import { createHash } from 'node:crypto';
import { z } from 'zod';

export const STRUCTURAL_EVIDENCE_SCHEMA = 'semantic-code-intelligence.structural_evidence_receipt.v1' as const;

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const opaqueFingerprintSchema = z
    .string()
    .min(16)
    .max(256)
    .regex(/^[A-Za-z0-9._:-]+$/);

function hasOnlyPairedUnicodeSurrogates(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff) return false;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return false;
        }
    }
    return true;
}
function boundedString(maxCodePoints: number) {
    return z
        .string()
        .refine(hasOnlyPairedUnicodeSurrogates, 'must contain valid Unicode scalar values')
        .refine((value) => [...value].length <= maxCodePoints, `must contain at most ${maxCodePoints} code points`);
}

function boundedNonEmptyString(maxCodePoints: number) {
    return boundedString(maxCodePoints).refine((value) => /\S/.test(value), 'must contain non-whitespace text');
}

const relativePathSchema = boundedNonEmptyString(4096);
const provenanceTokenSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/);
const positionSchema = z
    .object({ line: z.number().int().nonnegative(), column: z.number().int().nonnegative() })
    .strict();

export const structuralEvidenceRequestSchema = z
    .object({
        question: boundedNonEmptyString(4000),
        seeds: z
            .array(
                z
                    .object({
                        id: z.string().regex(/^seed:[a-z0-9][a-z0-9._-]{0,127}$/),
                        kind: z.enum(['path', 'symbol', 'text']),
                        value: boundedNonEmptyString(4096),
                    })
                    .strict()
            )
            .min(1)
            .max(256),
        operations: z
            .array(z.enum(['structural_search', 'find_definition', 'find_references', 'graph_expand', 'ast_query']))
            .min(1)
            .max(16),
        limits: z
            .object({
                maxCandidates: z.number().int().positive().max(10000),
                maxCandidatesPerFile: z.number().int().positive().max(10000),
                maxEvidenceBytes: z
                    .number()
                    .int()
                    .positive()
                    .max(64 * 1024 * 1024),
                timeoutMs: z.number().int().positive().max(120000),
            })
            .strict(),
    })
    .strict();

const evidenceRangeSchema = z.object({ start: positionSchema, end: positionSchema }).strict();
const evidenceSymbolSchema = boundedNonEmptyString(1024);
const evidenceIdentitySchema = z.discriminatedUnion('kind', [
    z.object({ path: relativePathSchema, kind: z.literal('match'), range: evidenceRangeSchema }).strict(),
    z
        .object({
            path: relativePathSchema,
            kind: z.literal('definition'),
            range: evidenceRangeSchema,
            symbol: evidenceSymbolSchema,
        })
        .strict(),
    z
        .object({
            path: relativePathSchema,
            kind: z.literal('reference'),
            range: evidenceRangeSchema,
            symbol: evidenceSymbolSchema,
        })
        .strict(),
    z
        .object({
            path: relativePathSchema,
            kind: z.literal('graph_node'),
            symbol: evidenceSymbolSchema,
            range: evidenceRangeSchema.optional(),
        })
        .strict(),
    z
        .object({
            path: relativePathSchema,
            kind: z.literal('graph_edge'),
            symbol: evidenceSymbolSchema,
            relatedPath: relativePathSchema,
            relatedSymbol: evidenceSymbolSchema,
            edgeType: z.enum(['import', 'export', 'caller', 'callee', 'semantic']),
        })
        .strict(),
]);

const evidenceCandidateSchema = z
    .object({
        id: z.string().regex(/^candidate:sha256:[a-f0-9]{64}$/),
        identity: evidenceIdentitySchema,
        operation: z.enum(['structural_search', 'find_definition', 'find_references', 'graph_expand', 'ast_query']),
        snippet: boundedNonEmptyString(20000),
        byteCount: z.number().int().positive(),
        provenance: z
            .object({
                backend: provenanceTokenSchema,
                workflow: provenanceTokenSchema,
            })
            .strict(),
    })
    .strict();

const structuralEvidenceReceiptBodySchema = z
    .object({
        schema: z.literal(STRUCTURAL_EVIDENCE_SCHEMA),
        request: structuralEvidenceRequestSchema,
        requestDigest: digestSchema,
        repository: z
            .object({
                snapshotId: opaqueFingerprintSchema,
                baseFingerprint: opaqueFingerprintSchema,
                observedFingerprint: opaqueFingerprintSchema,
                stableAcrossExecution: z.boolean(),
            })
            .strict(),
        producer: z
            .object({
                name: z.literal('semantic-code-intelligence'),
                version: provenanceTokenSchema,
                workflow: provenanceTokenSchema,
            })
            .strict(),
        backend: z
            .object({
                name: provenanceTokenSchema,
                version: provenanceTokenSchema,
                executable: z.object({ name: provenanceTokenSchema, version: provenanceTokenSchema }).strict(),
                outcome: z
                    .object({
                        status: z.enum(['succeeded', 'failed', 'timed_out', 'unavailable']),
                        exitCode: z.number().int().nullable(),
                        message: boundedString(2000),
                    })
                    .strict(),
            })
            .strict(),
        evidence: z.array(evidenceCandidateSchema).max(10000),
        summary: z
            .object({
                returnedCount: z.number().int().nonnegative(),
                totalObservedCount: z.number().int().nonnegative(),
                evidenceBytes: z.number().int().nonnegative(),
                capped: z.boolean(),
                complete: z.boolean(),
            })
            .strict(),
        limitations: z
            .array(
                z
                    .object({
                        code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
                        message: boundedNonEmptyString(2000),
                        affectsCompleteness: z.boolean(),
                    })
                    .strict()
            )
            .max(128),
    })
    .strict();

export const structuralEvidenceReceiptSchema = structuralEvidenceReceiptBodySchema
    .extend({ receiptDigest: digestSchema })
    .strict();

export type StructuralEvidenceRequest = z.infer<typeof structuralEvidenceRequestSchema>;
export type StructuralEvidenceIdentity = z.infer<typeof evidenceIdentitySchema>;
export type StructuralEvidenceReceipt = z.infer<typeof structuralEvidenceReceiptSchema>;

export type StructuralEvidenceValidationResult =
    | { ok: true; value: StructuralEvidenceReceipt }
    | { ok: false; errors: string[] };

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('canonical JSON does not support non-finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(',')}}`;
    }
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function sha256Digest(value: unknown): string {
    return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function normalizeRelativePath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isSafeRepositoryRelativePath(value: string): boolean {
    const normalized = normalizeRelativePath(value);
    if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized.endsWith('/')) return false;
    if (/^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) return false;
    const parts = normalized.split('/');
    return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function normalizeStructuralEvidenceRequest(input: StructuralEvidenceRequest): StructuralEvidenceRequest {
    return {
        question: normalizeText(input.question),
        seeds: input.seeds.map((seed) => ({
            id: seed.id.trim(),
            kind: seed.kind,
            value: seed.kind === 'path' ? normalizeRelativePath(seed.value) : normalizeText(seed.value),
        })),
        operations: [...input.operations],
        limits: { ...input.limits },
    };
}

export function structuralEvidenceRequestDigest(request: StructuralEvidenceRequest): string {
    return sha256Digest(normalizeStructuralEvidenceRequest(request));
}

export function structuralEvidenceCandidateId(identity: StructuralEvidenceIdentity): string {
    return `candidate:${sha256Digest(identity)}`;
}

export function structuralEvidenceReceiptDigest(
    receipt: Omit<StructuralEvidenceReceipt, 'receiptDigest'> | StructuralEvidenceReceipt
): string {
    const { receiptDigest: _ignored, ...body } = receipt as StructuralEvidenceReceipt;
    return sha256Digest(body);
}

function sameJson(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

function duplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicate = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) duplicate.add(value);
        seen.add(value);
    }
    return [...duplicate];
}

function rangeIsOrdered(identity: StructuralEvidenceIdentity): boolean {
    if (!('range' in identity) || !identity.range) return true;
    const { start, end } = identity.range;
    return end.line > start.line || (end.line === start.line && end.column >= start.column);
}

function containsMachineLocalAbsolutePath(value: string): boolean {
    return (
        /(?:^|[\s'"(=])\/(?:home|Users|tmp|private\/tmp|var\/folders|usr|etc|opt|root|srv|mnt|media)\//.test(value) ||
        /(?:^|[\s'"(=])[A-Za-z]:[\\/]/.test(value) ||
        /file:\/\//i.test(value)
    );
}

export function validateStructuralEvidenceReceipt(input: unknown): StructuralEvidenceValidationResult {
    const parsed = structuralEvidenceReceiptSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
        };
    }

    const receipt = parsed.data;
    const errors: string[] = [];
    const portableTextFields: Array<[string, string]> = [
        ['request.question', receipt.request.question],
        ['backend.outcome.message', receipt.backend.outcome.message],
        ...receipt.request.seeds.map(
            (seed, index) => [`request.seeds[${index}].value`, seed.value] as [string, string]
        ),
        ...receipt.limitations.map(
            (limitation, index) => [`limitations[${index}].message`, limitation.message] as [string, string]
        ),
    ];
    for (const [location, value] of portableTextFields) {
        if (containsMachineLocalAbsolutePath(value)) errors.push(`machine-local absolute path at ${location}`);
    }
    const normalizedRequest = normalizeStructuralEvidenceRequest(receipt.request);
    if (!sameJson(receipt.request, normalizedRequest)) errors.push('request must already be normalized');
    if (receipt.requestDigest !== structuralEvidenceRequestDigest(receipt.request))
        errors.push('requestDigest mismatch');
    if (receipt.receiptDigest !== structuralEvidenceReceiptDigest(receipt)) errors.push('receiptDigest mismatch');

    for (const seed of receipt.request.seeds) {
        if (
            seed.kind === 'path' &&
            (!isSafeRepositoryRelativePath(seed.value) || seed.value !== normalizeRelativePath(seed.value))
        ) {
            errors.push(`unsafe or non-normalized seed path: ${seed.value}`);
        }
    }
    for (const id of duplicates(receipt.request.seeds.map((seed) => seed.id))) errors.push(`duplicate seed id: ${id}`);
    for (const operation of duplicates(receipt.request.operations)) errors.push(`duplicate operation: ${operation}`);

    const evidenceIds = receipt.evidence.map((candidate) => candidate.id);
    for (const id of duplicates(evidenceIds)) errors.push(`duplicate candidate id: ${id}`);
    for (const candidate of receipt.evidence) {
        if (
            !isSafeRepositoryRelativePath(candidate.identity.path) ||
            candidate.identity.path !== normalizeRelativePath(candidate.identity.path)
        ) {
            errors.push(`unsafe or non-normalized candidate path: ${candidate.identity.path}`);
        }
        if (candidate.id !== structuralEvidenceCandidateId(candidate.identity))
            errors.push(`candidate id mismatch: ${candidate.id}`);
        if (!receipt.request.operations.includes(candidate.operation))
            errors.push(`candidate operation was not requested: ${candidate.operation}`);
        if (candidate.provenance.backend !== receipt.backend.name)
            errors.push(`candidate backend provenance mismatch: ${candidate.id}`);
        if (candidate.provenance.workflow !== receipt.producer.workflow)
            errors.push(`candidate workflow provenance mismatch: ${candidate.id}`);
        if (candidate.byteCount !== Buffer.byteLength(candidate.snippet, 'utf8'))
            errors.push(`candidate byteCount mismatch: ${candidate.id}`);
        if (!rangeIsOrdered(candidate.identity)) errors.push(`candidate range is reversed: ${candidate.id}`);
        if (candidate.identity.kind === 'graph_edge') {
            if (
                !isSafeRepositoryRelativePath(candidate.identity.relatedPath) ||
                candidate.identity.relatedPath !== normalizeRelativePath(candidate.identity.relatedPath)
            ) {
                errors.push(`unsafe or non-normalized related candidate path: ${candidate.identity.relatedPath}`);
            }
        }
        const compatibleKinds: Record<(typeof candidate)['operation'], StructuralEvidenceIdentity['kind'][]> = {
            structural_search: ['match'],
            ast_query: ['match'],
            find_definition: ['definition'],
            find_references: ['reference'],
            graph_expand: ['graph_node', 'graph_edge'],
        };
        if (!compatibleKinds[candidate.operation].includes(candidate.identity.kind))
            errors.push(`candidate kind is incompatible with operation: ${candidate.id}`);
    }

    const { limits } = receipt.request;
    const evidenceBytes = receipt.evidence.reduce((total, candidate) => total + candidate.byteCount, 0);
    if (receipt.summary.returnedCount !== receipt.evidence.length)
        errors.push('summary.returnedCount does not equal evidence length');
    if (receipt.summary.totalObservedCount < receipt.summary.returnedCount)
        errors.push('summary.totalObservedCount is below returnedCount');
    if (receipt.summary.evidenceBytes !== evidenceBytes)
        errors.push('summary.evidenceBytes does not equal candidate bytes');
    if (receipt.summary.returnedCount > limits.maxCandidates) errors.push('returnedCount exceeds maxCandidates');
    if (receipt.summary.evidenceBytes > limits.maxEvidenceBytes) errors.push('evidenceBytes exceeds maxEvidenceBytes');
    if (limits.maxCandidatesPerFile > limits.maxCandidates)
        errors.push('maxCandidatesPerFile cannot exceed maxCandidates');

    const perFile = new Map<string, number>();
    for (const candidate of receipt.evidence) {
        const count = (perFile.get(candidate.identity.path) ?? 0) + 1;
        perFile.set(candidate.identity.path, count);
        if (count > limits.maxCandidatesPerFile)
            errors.push(`candidate count exceeds per-file cap: ${candidate.identity.path}`);
    }

    const shouldBeCapped = receipt.summary.totalObservedCount > receipt.summary.returnedCount;
    if (receipt.summary.capped !== shouldBeCapped) errors.push('summary.capped is inconsistent with counts or caps');

    const { outcome } = receipt.backend;
    if (outcome.status === 'succeeded' && outcome.exitCode !== 0)
        errors.push('succeeded backend outcome requires exitCode 0');
    if (outcome.status === 'failed' && (outcome.exitCode === null || outcome.exitCode === 0))
        errors.push('failed backend outcome requires a non-zero exitCode');
    if ((outcome.status === 'timed_out' || outcome.status === 'unavailable') && outcome.exitCode !== null)
        errors.push(`${outcome.status} backend outcome requires a null exitCode`);

    const hasCompletenessLimitation = receipt.limitations.some((limitation) => limitation.affectsCompleteness);
    const canBeComplete =
        receipt.repository.stableAcrossExecution &&
        receipt.repository.baseFingerprint === receipt.repository.observedFingerprint &&
        receipt.backend.outcome.status === 'succeeded' &&
        !receipt.summary.capped &&
        !hasCompletenessLimitation;
    if (receipt.summary.complete !== canBeComplete)
        errors.push('summary.complete is inconsistent with drift, outcome, caps, or limitations');
    if (!receipt.repository.stableAcrossExecution && receipt.summary.complete)
        errors.push('snapshot drift cannot be marked complete');
    if (
        receipt.repository.stableAcrossExecution &&
        receipt.repository.baseFingerprint !== receipt.repository.observedFingerprint
    ) {
        errors.push('stableAcrossExecution requires matching base and observed fingerprints');
    }

    return errors.length === 0 ? { ok: true, value: receipt } : { ok: false, errors };
}
