import { beforeAll, describe, expect, test } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function expectWithinBudgetWhenEnforced(elapsed: number, budgetMs: number, label: string) {
    const enforce = process.env.PERF === '1' || process.env.ENFORCE_PERF_BUDGETS === '1';
    if (enforce) {
        expect(elapsed).toBeLessThan(budgetMs);
    } else if (elapsed >= budgetMs) {
        console.warn(`${label} exceeded advisory budget: ${elapsed}ms >= ${budgetMs}ms`);
    }
}

describe('Layer Validation - L1→L5 Working Paths', () => {
    const CLI = './semantic-code-intelligence';

    // L1 Fast Search
    test('L1: text_search should return results within 2000ms', async () => {
        const start = Date.now();
        const { stdout } = await execAsync(`${CLI} text-search "function" -n 10 -j`);
        const elapsed = Date.now() - start;

        const result = JSON.parse(stdout);
        expect(result.count).toBeGreaterThan(0);
        expectWithinBudgetWhenEnforced(elapsed, 2000, 'L1 text_search');
        console.log(`L1 text_search took ${elapsed}ms`);
    }, 10000);

    // L2 AST Analysis
    test('L2: ast_query should parse and return results within 2000ms', async () => {
        const start = Date.now();
        const { stdout } = await execAsync(
            `${CLI} ast-query typescript "(function_declaration name: (identifier) @name)" --glob "src/**/*.ts" -l 10 -j`
        );
        const elapsed = Date.now() - start;

        const result = JSON.parse(stdout);
        expect(result.count).toBeGreaterThan(0);
        expectWithinBudgetWhenEnforced(elapsed, 2000, 'L2 ast_query');
        console.log(`L2 ast_query took ${elapsed}ms`);
    }, 10000);

    test('L2: symbol-search should find symbols', async () => {
        const { stdout } = await execAsync(`${CLI} symbol-search "HTTPServer" -n 5 -j`);
        const result = JSON.parse(stdout);
        expect(result.count).toBeGreaterThan(0);
        expect(result.symbols.some((symbol: { name?: string }) => symbol.name === 'HTTPServer')).toBe(true);
    }, 10000);

    // L3 Planner
    test('L3: plan-rename should generate a preview', async () => {
        const { stdout } = await execAsync(`${CLI} plan-rename "EventEmitter" "EventDispatcher" -j`);
        const result = JSON.parse(stdout);
        expect(result.preview).toBe(true);
        expect(result).toHaveProperty('totalEdits');
        expect(result.totalEdits).toBeGreaterThanOrEqual(0);
    }, 30000);

    // L4 Ontology
    test('L4: explore should find definitions and references', async () => {
        const { stdout } = await execAsync(`${CLI} explore "process" -n 5 -j`);
        const result = JSON.parse(stdout);
        expect(result).toHaveProperty('definitions');
        expect(result).toHaveProperty('references');
        // Check if we found any results
        const totalFound = (result.definitions?.length || 0) + (result.references?.length || 0);
        expect(totalFound).toBeGreaterThan(0);
    }, 10000);

    // L5 Learning
    test('L5: stats should report pattern statistics in JSON', async () => {
        const { stdout } = await execAsync(`${CLI} stats -j`);
        const result = JSON.parse(stdout);
        expect(result).toHaveProperty('status');
        expect(result.status).toBe('Initialized');
        expect(result).toHaveProperty('layers');
        expect(result).toHaveProperty('timestamp');
    }, 10000);
});
