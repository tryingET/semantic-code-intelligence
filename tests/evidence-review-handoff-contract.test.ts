import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const schemaPath = 'schemas/evidence-review-v1.schema.json';
const currentOutputPath = 'tests/fixtures/evidence-review-claim-model-sample.json';
const validPath = 'tests/fixtures/evidence-review-handoff-valid.json';
const adversarialPath = 'tests/fixtures/evidence-review-handoff-adversarial.json';

const parse = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const schema = parse(schemaPath);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type Issue = { path: string; message: string; keyword?: string };

// The repository has no direct draft-07 validator dependency. This deliberately small
// evaluator covers every assertion keyword used by the canonical schema, avoiding a
// package/lockfile change while still exercising the checked-in machine contract.
function schemaIssues(rule: any, value: any, path = '$'): Issue[] {
    const issues: Issue[] = [];
    const fail = (keyword: string, message: string) => issues.push({ path, keyword, message });
    if (rule.anyOf) {
        if (!rule.anyOf.some((candidate: any) => schemaIssues(candidate, value, path).length === 0)) {
            fail('anyOf', 'did not match any allowed shape');
        }
        return issues;
    }
    if (Object.hasOwn(rule, 'const') && value !== rule.const) fail('const', 'constant mismatch');
    if (rule.enum && !rule.enum.includes(value)) fail('enum', 'value is outside the enum');
    const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const typeMatches =
        rule.type === 'integer' ? actualType === 'number' && Number.isInteger(value) : actualType === rule.type;
    if (rule.type && !typeMatches) {
        fail('type', `expected ${rule.type}, got ${actualType}`);
        return issues;
    }
    if (actualType === 'object') {
        for (const key of rule.required || []) if (!Object.hasOwn(value, key)) fail('required', `missing ${key}`);
        if (rule.additionalProperties === false) {
            for (const key of Object.keys(value)) {
                if (!Object.hasOwn(rule.properties || {}, key)) {
                    issues.push({ path: `${path}.${key}`, keyword: 'additionalProperties', message: 'unknown field' });
                }
            }
        }
        for (const [key, childRule] of Object.entries(rule.properties || {})) {
            if (Object.hasOwn(value, key)) issues.push(...schemaIssues(childRule, value[key], `${path}.${key}`));
        }
    }
    if (actualType === 'array') {
        if (rule.minItems !== undefined && value.length < rule.minItems) fail('minItems', 'too few items');
        if (rule.maxItems !== undefined && value.length > rule.maxItems) fail('maxItems', 'too many items');
        if (rule.uniqueItems && new Set(value.map((item: any) => JSON.stringify(item))).size !== value.length) {
            fail('uniqueItems', 'duplicate item');
        }
        value.forEach((item: any, index: number) => {
            issues.push(...schemaIssues(rule.items, item, `${path}[${index}]`));
        });
    }
    if (actualType === 'string') {
        const length = [...value].length;
        if (rule.minLength !== undefined && length < rule.minLength) fail('minLength', 'string too short');
        if (rule.maxLength !== undefined && length > rule.maxLength) fail('maxLength', 'string too long');
        if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) fail('pattern', 'unsafe or malformed string');
    }
    if (actualType === 'number') {
        if (rule.minimum !== undefined && value < rule.minimum) fail('minimum', 'number below minimum');
        if (rule.maximum !== undefined && value > rule.maximum) fail('maximum', 'number above maximum');
        if (rule.type === 'integer' && !Number.isInteger(value)) fail('type', 'number is not an integer');
    }
    return issues;
}

const validate = Object.assign(
    (value: unknown) => {
        validate.errors = schemaIssues(schema, value);
        return validate.errors.length === 0;
    },
    { errors: [] as Issue[] }
);

function referenceIssues(review: any): Issue[] {
    const issues: Issue[] = [];
    const ids = (items: any[]) => new Set(items.map((item) => item.id));
    const duplicateIds = (name: string, items: any[]) => {
        const seen = new Set<string>();
        for (const item of items) {
            if (seen.has(item.id)) issues.push({ path: name, message: `duplicate id: ${item.id}` });
            seen.add(item.id);
        }
    };
    const artifacts = ids(review.evidenceArtifacts);
    const limitations = ids(review.limitations);
    const claims = ids(review.claims);
    const boundaries = ids(review.authorityBoundaries);
    const decisions = ids(review.operatorDecisionPoints);
    const requireRefs = (path: string, refs: string[], targets: Set<string>) => {
        for (const ref of refs) if (!targets.has(ref)) issues.push({ path, message: `unresolved reference: ${ref}` });
    };

    duplicateIds('evidenceArtifacts', review.evidenceArtifacts);
    duplicateIds('limitations', review.limitations);
    duplicateIds('claims', review.claims);
    duplicateIds('authorityBoundaries', review.authorityBoundaries);
    duplicateIds('operatorDecisionPoints', review.operatorDecisionPoints);
    duplicateIds('handoffReadiness.gates', review.handoffReadiness.gates);
    for (const item of review.limitations) {
        requireRefs(`limitations.${item.id}.sourceArtifact`, [item.sourceArtifact], artifacts);
        requireRefs(`limitations.${item.id}.affectsClaims`, item.affectsClaims, claims);
        requireRefs(`limitations.${item.id}.affectsDecisionPoints`, item.affectsDecisionPoints, decisions);
    }
    for (const item of review.claims) {
        requireRefs(`claims.${item.id}.supportedBy`, item.supportedBy, artifacts);
        requireRefs(`claims.${item.id}.limitedBy`, item.limitedBy, limitations);
        requireRefs(`claims.${item.id}.authorityBoundaries`, item.authorityBoundaries, boundaries);
        requireRefs(`claims.${item.id}.operatorDecisionPoints`, item.operatorDecisionPoints, decisions);
    }
    for (const item of review.operatorDecisionPoints) {
        requireRefs(`operatorDecisionPoints.${item.id}.supportingClaims`, item.supportingClaims, claims);
        requireRefs(`operatorDecisionPoints.${item.id}.limitingClaims`, item.limitingClaims, claims);
    }
    return issues;
}

function resourceIssues(value: unknown): Issue[] {
    const caps = schema['x-sci-resourceCaps'];
    const issues: Issue[] = [];
    let items = 0;
    let stringCodePoints = 0;
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > caps.encodedBytes) issues.push({ path: '$', message: 'encoded byte cap exceeded' });
    const visit = (node: unknown, depth: number, path: string) => {
        if (depth > caps.maximumDepth) issues.push({ path, message: 'depth cap exceeded' });
        if (typeof node === 'string') {
            const length = [...node].length;
            stringCodePoints += length;
            if (length > caps.maximumStringCodePoints) issues.push({ path, message: 'string cap exceeded' });
            return;
        }
        if (Array.isArray(node)) {
            items += node.length;
            if (node.length > caps.maximumArrayItems) issues.push({ path, message: 'array cap exceeded' });
            node.forEach((item, index) => {
                visit(item, depth + 1, `${path}[${index}]`);
            });
            return;
        }
        if (node && typeof node === 'object') {
            const entries = Object.entries(node);
            items += entries.length;
            for (const [key, child] of entries) {
                stringCodePoints += [...key].length;
                visit(child, depth + 1, `${path}.${key}`);
            }
        }
    };
    visit(value, 1, '$');
    if (items > caps.maximumTotalItems) issues.push({ path: '$', message: 'total item cap exceeded' });
    if (stringCodePoints > caps.maximumTotalStringCodePoints) {
        issues.push({ path: '$', message: 'aggregate string cap exceeded' });
    }
    return issues;
}

function expectConforms(review: unknown) {
    expect(validate(review), JSON.stringify(validate.errors)).toBe(true);
    expect(referenceIssues(review)).toEqual([]);
    expect(resourceIssues(review)).toEqual([]);
}

describe('evidence review consumer handoff contract', () => {
    test('is a strict canonical draft-07 schema with explicit resource caps', () => {
        expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
        expect(schema.additionalProperties).toBe(false);
        expect(schema.properties.schema.const).toBe('semantic-code-intelligence.evidence_review.v1');
        expect(schema.required).toEqual(expect.arrayContaining(['claims', 'limitations', 'operatorDecisionPoints']));
        expect(schema['x-sci-resourceCaps']).toMatchObject({ encodedBytes: 1048576, maximumDepth: 32 });
    });

    test('accepts the valid golden and current committed normalized producer output', () => {
        expectConforms(parse(validPath));
        expectConforms(parse(currentOutputPath));
    });

    test('rejects adversarial unknown fields, hostile terminal text, and dangling references', () => {
        const review = parse(adversarialPath);
        expect(validate(review)).toBe(false);
        expect(validate.errors?.some((error) => error.keyword === 'additionalProperties')).toBe(true);
        expect(validate.errors?.some((error) => error.keyword === 'pattern')).toBe(true);
        expect(referenceIssues(review).some((issue) => issue.message.includes('missing-artifact'))).toBe(true);
    });

    test('rejects every unknown field and enforces explicit null posture', () => {
        const unknown = clone(parse(validPath));
        unknown.outcome.unreviewed = true;
        expect(validate(unknown)).toBe(false);
        const omitted = clone(parse(validPath));
        delete omitted.verification.applied;
        expect(validate(omitted)).toBe(false);
        const explicitNull = clone(parse(validPath));
        explicitNull.verification.applied = null;
        expect(validate(explicitNull), JSON.stringify(validate.errors)).toBe(true);
    });

    test('enforces enums, identifier uniqueness, and cross-array reference integrity', () => {
        const badEnum = clone(parse(validPath));
        badEnum.claims[0].status = 'approved';
        expect(validate(badEnum)).toBe(false);
        const duplicates = clone(parse(validPath));
        duplicates.claims[1].id = duplicates.claims[0].id;
        expect(referenceIssues(duplicates).some((issue) => issue.message.includes('duplicate id'))).toBe(true);
        const dangling = clone(parse(validPath));
        dangling.limitations[0].affectsDecisionPoints = ['not-displayed'];
        expect(referenceIssues(dangling).some((issue) => issue.message.includes('not-displayed'))).toBe(true);
    });

    test('enforces per-value and aggregate bytes, depth, item, and string caps', () => {
        const longString = clone(parse(validPath));
        longString.claims[0].claim = 'x'.repeat(8193);
        expect(validate(longString)).toBe(false);
        const deep: any = {};
        let cursor = deep;
        for (let index = 0; index < 33; index++) cursor = cursor.next = {};
        expect(resourceIssues(deep).some((issue) => issue.message === 'depth cap exceeded')).toBe(true);
        expect(resourceIssues('x'.repeat(1048577)).some((issue) => issue.message === 'encoded byte cap exceeded')).toBe(
            true
        );
        expect(resourceIssues(Array(300).fill(null)).some((issue) => issue.message === 'array cap exceeded')).toBe(
            true
        );
    });
});
