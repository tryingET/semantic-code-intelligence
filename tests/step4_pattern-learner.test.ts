import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PatternLearner } from '../src/patterns/pattern-learner';
import type { RenameContext } from '../src/types/core';
import { makeRenameContext } from './test-helpers';

describe('Step 4: PatternLearner', () => {
    let learner: PatternLearner;
    const context: RenameContext = makeRenameContext({ file: 'file.ts' });

    beforeAll(async () => {
        learner = new PatternLearner(':memory:', { learningThreshold: 2 });
        await new Promise((res) => setTimeout(res, 50));
    });

    afterAll(async () => {
        await (learner as any).storage?.close?.();
    });

    test('promotes candidate to pattern after threshold', async () => {
        await learner.learnFromRename('getUser', 'fetchUser', context);
        const result = await learner.learnFromRename('getData', 'fetchData', context);
        expect(result.pattern).toBeDefined();
        const patterns = (learner as any).patterns;
        expect(patterns.size).toBeGreaterThan(0);
    });

    test('strengthens existing pattern on further examples', async () => {
        const things = (learner as any).patterns;
        const existing = things.values().next().value;
        const prevOccurrences = existing.occurrences;
        await learner.learnFromRename('getItem', 'fetchItem', context);
        const updated = things.get(existing.id);
        expect(updated.occurrences).toBeGreaterThanOrEqual(prevOccurrences);
        expect(updated.confidence).toBeGreaterThanOrEqual(existing.confidence);
    });

    test('promotes candidate to pattern with missing context', async () => {
        const tmp = new PatternLearner(':memory:', { learningThreshold: 2 });
        // wait for internal initialize
        await new Promise((res) => setTimeout(res, 50));
        await tmp.learnFromRename('getUser', 'fetchUser', undefined as any);
        const result = await tmp.learnFromRename('getData', 'fetchData', undefined as any);
        expect(result.pattern).toBeDefined();
        // ensure it persisted without crashing (context/timestamp guarded)
        const patternsMap = (tmp as any).patterns as Map<string, any>;
        expect(patternsMap.size).toBeGreaterThan(0);
        await tmp.dispose();
    });

    test('exposes metrics: missingExampleContextTimestamp increments when timestamp missing', async () => {
        const tmp = new PatternLearner(':memory:', { learningThreshold: 2 });
        await new Promise((res) => setTimeout(res, 50));

        // Baseline
        const before = tmp.getMetrics().missingExampleContextTimestamp;

        // Provide context without timestamp to trigger counter increment
        const ctxNoTs = { ...makeRenameContext(), timestamp: undefined } as unknown as RenameContext;
        await tmp.learnFromRename('findItem', 'lookupItem', ctxNoTs);
        await tmp.learnFromRename('findData', 'lookupData', ctxNoTs);

        const after = tmp.getMetrics().missingExampleContextTimestamp;
        expect(after).toBeGreaterThan(before);

        // Providing proper timestamp should not increment further for this operation
        const ctxWithTs = makeRenameContext();
        await tmp.learnFromRename('getThing', 'fetchThing', ctxWithTs);
        const final = tmp.getMetrics().missingExampleContextTimestamp;
        expect(final).toBe(after); // unchanged

        await tmp.dispose();
    });
});
