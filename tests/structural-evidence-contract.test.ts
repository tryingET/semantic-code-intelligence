import { describe, expect, test } from 'bun:test';
import jsonSchema from '../schemas/structural-evidence-receipt.v1.schema.json';
import {
    canonicalJson,
    structuralEvidenceCandidateId,
    structuralEvidenceReceiptDigest,
    structuralEvidenceReceiptSchema,
    structuralEvidenceRequestDigest,
    validateStructuralEvidenceReceipt,
} from '../src/core/workflows/structural-evidence-contract.js';
import fixture from './fixtures/structural-evidence-receipt.v1.json';

function copyReceipt(): any {
    return structuredClone(fixture);
}

function resign(receipt: any, requestChanged = false): any {
    if (requestChanged) receipt.requestDigest = structuralEvidenceRequestDigest(receipt.request);
    receipt.receiptDigest = structuralEvidenceReceiptDigest(receipt);
    return receipt;
}

function expectRejected(receipt: any, text: string): void {
    const result = validateStructuralEvidenceReceipt(receipt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain(text);
}

describe('structural evidence export contract v1', () => {
    test('curated fixture validates and JSON Schema mirrors the TypeScript envelope', () => {
        expect(structuralEvidenceReceiptSchema.safeParse(fixture).success).toBe(true);
        expect(validateStructuralEvidenceReceipt(fixture)).toEqual({ ok: true, value: fixture });

        expect(jsonSchema.properties.schema.const).toBe(fixture.schema);
        expect(jsonSchema.required.sort()).toEqual(Object.keys(fixture).sort());
        expect(jsonSchema.$defs.operation.enum).toEqual([
            'structural_search',
            'find_definition',
            'find_references',
            'graph_expand',
            'ast_query',
        ]);
        expect(jsonSchema.$defs.request.required.sort()).toEqual(Object.keys(fixture.request).sort());
        expect(jsonSchema.$defs.evidenceCandidate.required.sort()).toEqual(Object.keys(fixture.evidence[0]).sort());
    });

    test('canonical digests are key-order independent and bind the exact normalized request', () => {
        expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
        expect(structuralEvidenceRequestDigest(fixture.request)).toBe(fixture.requestDigest);
        expect(structuralEvidenceReceiptDigest(fixture)).toBe(fixture.receiptDigest);

        const unicodeBoundary = copyReceipt();
        unicodeBoundary.request.question = '😀'.repeat(4000);
        resign(unicodeBoundary, true);
        expect(validateStructuralEvidenceReceipt(unicodeBoundary).ok).toBe(true);

        const nonNormalized = copyReceipt();
        nonNormalized.request.question = '  Where   is the structural workflow service defined?  ';
        resign(nonNormalized, true);
        expectRejected(nonNormalized, 'request must already be normalized');
    });

    test('rejects request and receipt digest mismatches', () => {
        const requestMismatch = copyReceipt();
        requestMismatch.request.question = 'A different question';
        resign(requestMismatch);
        expectRejected(requestMismatch, 'requestDigest mismatch');

        const receiptMismatch = copyReceipt();
        receiptMismatch.summary.complete = false;
        expectRejected(receiptMismatch, 'receiptDigest mismatch');
    });

    test('rejects unsafe, absolute, and non-normalized repository paths', () => {
        const traversal = copyReceipt();
        traversal.request.seeds[0].value = '../outside.ts';
        resign(traversal, true);
        expectRejected(traversal, 'unsafe or non-normalized seed path');

        const absolute = copyReceipt();
        absolute.evidence[0].identity.path = '/home/operator/private.ts';
        absolute.evidence[0].id = structuralEvidenceCandidateId(absolute.evidence[0].identity);
        resign(absolute);
        expectRejected(absolute, 'unsafe or non-normalized candidate path');

        const executablePath = copyReceipt();
        executablePath.backend.executable.name = '/usr/local/bin/ast-grep';
        resign(executablePath);
        expectRejected(executablePath, 'backend.executable.name');

        const exactSourceSnippet = copyReceipt();
        exactSourceSnippet.evidence[0].snippet = "const executable = '/usr/local/bin/ast-grep'";
        exactSourceSnippet.evidence[0].byteCount = Buffer.byteLength(exactSourceSnippet.evidence[0].snippet, 'utf8');
        exactSourceSnippet.summary.evidenceBytes = exactSourceSnippet.evidence[0].byteCount;
        resign(exactSourceSnippet);
        expect(validateStructuralEvidenceReceipt(exactSourceSnippet).ok).toBe(true);
    });

    test('rejects duplicate seed, operation, and candidate identities', () => {
        const duplicateSeed = copyReceipt();
        duplicateSeed.request.seeds.push({ ...duplicateSeed.request.seeds[0] });
        resign(duplicateSeed, true);
        expectRejected(duplicateSeed, 'duplicate seed id');

        const duplicateOperation = copyReceipt();
        duplicateOperation.request.operations.push('find_definition');
        resign(duplicateOperation, true);
        expectRejected(duplicateOperation, 'duplicate operation');

        const duplicateCandidate = copyReceipt();
        duplicateCandidate.evidence.push(structuredClone(duplicateCandidate.evidence[0]));
        duplicateCandidate.summary.returnedCount = 2;
        duplicateCandidate.summary.totalObservedCount = 2;
        duplicateCandidate.summary.evidenceBytes = 76;
        resign(duplicateCandidate);
        expectRejected(duplicateCandidate, 'duplicate candidate id');
    });

    test('rejects inconsistent counts, caps, and completeness claims', () => {
        const countMismatch = copyReceipt();
        countMismatch.summary.returnedCount = 2;
        resign(countMismatch);
        expectRejected(countMismatch, 'returnedCount does not equal evidence length');

        const capMismatch = copyReceipt();
        capMismatch.summary.totalObservedCount = 2;
        resign(capMismatch);
        expectRejected(capMismatch, 'summary.capped is inconsistent');

        const inconsistentLimits = copyReceipt();
        inconsistentLimits.request.limits.maxCandidatesPerFile = 21;
        resign(inconsistentLimits, true);
        expectRejected(inconsistentLimits, 'maxCandidatesPerFile cannot exceed maxCandidates');

        const incompleteLimitation = copyReceipt();
        incompleteLimitation.limitations.push({
            code: 'backend_fallback',
            message: 'Only syntactic evidence was available',
            affectsCompleteness: true,
        });
        resign(incompleteLimitation);
        expectRejected(incompleteLimitation, 'summary.complete is inconsistent');
    });

    test('rejects missing or inconsistent provenance', () => {
        const missing = copyReceipt();
        delete missing.evidence[0].provenance;
        resign(missing);
        expectRejected(missing, 'evidence.0.provenance');

        const mismatch = copyReceipt();
        mismatch.evidence[0].provenance.backend = 'tree-sitter';
        resign(mismatch);
        expectRejected(mismatch, 'candidate backend provenance mismatch');

        const impossibleOutcome = copyReceipt();
        impossibleOutcome.backend.outcome.status = 'failed';
        resign(impossibleOutcome);
        expectRejected(impossibleOutcome, 'failed backend outcome requires a non-zero exitCode');
    });

    test('rejects snapshot drift marked complete', () => {
        const drift = copyReceipt();
        drift.repository.stableAcrossExecution = false;
        drift.repository.observedFingerprint = 'git:aaaaaaaaaaaaaaaa';
        resign(drift);
        expectRejected(drift, 'snapshot drift cannot be marked complete');
    });

    test('rejects malformed evidence identity, range, and byte accounting', () => {
        const wrongIdentity = copyReceipt();
        wrongIdentity.evidence[0].identity.symbol = 'OtherSymbol';
        resign(wrongIdentity);
        expectRejected(wrongIdentity, 'candidate id mismatch');

        const reversedRange = copyReceipt();
        reversedRange.evidence[0].identity.range.end.line = 1;
        reversedRange.evidence[0].id = structuralEvidenceCandidateId(reversedRange.evidence[0].identity);
        resign(reversedRange);
        expectRejected(reversedRange, 'candidate range is reversed');

        const wrongBytes = copyReceipt();
        wrongBytes.evidence[0].byteCount = 1;
        wrongBytes.summary.evidenceBytes = 1;
        resign(wrongBytes);
        expectRejected(wrongBytes, 'candidate byteCount mismatch');

        const incompatibleKind = copyReceipt();
        incompatibleKind.request.operations = ['graph_expand'];
        incompatibleKind.evidence[0].operation = 'graph_expand';
        resign(incompatibleKind, true);
        expectRejected(incompatibleKind, 'candidate kind is incompatible with operation');
    });
});
