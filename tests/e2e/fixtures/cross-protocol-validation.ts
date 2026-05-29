import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { CLIAdapter } from '../../../src/adapters/cli-adapter';
import type { HTTPAdapter } from '../../../src/adapters/http-adapter';
import type { LSPAdapter } from '../../../src/adapters/lsp-adapter';
import type { MCPAdapter } from '../../../src/adapters/mcp-adapter';
import type { CodeAnalyzer } from '../../../src/core/unified-analyzer';
import type { TestRepository } from './repository-configs';

export interface ProtocolTestCase {
    name: string;
    description: string;
    operation: 'findDefinition' | 'findReferences' | 'rename' | 'suggestRefactoring' | 'getCompletions';
    file: string;
    input: any;
    expectedResultType: 'array' | 'object' | 'string' | 'number';
    expectedMinResults?: number;
    expectedMaxResults?: number;
}

export interface ProtocolResult {
    protocol: string;
    success: boolean;
    result: any;
    duration: number;
    error?: string;
    metadata: {
        resultType: string;
        resultCount: number;
        resultSize: number;
    };
}

export interface ConsistencyValidationReport {
    repository: string;
    testCases: Array<{
        testCase: ProtocolTestCase;
        results: ProtocolResult[];
        consistency: {
            allSucceeded: boolean;
            similarResults: boolean;
            similarPerformance: boolean;
            similarity: number;
            performanceVariance: number;
        };
        analysis: string;
    }>;
    summary: {
        totalTestCases: number;
        consistentCases: number;
        inconsistentCases: number;
        averageSimilarity: number;
        averagePerformanceVariance: number;
        protocolReliability: Record<string, number>;
        commonFailures: string[];
        recommendations: string[];
    };
}

export class CrossProtocolValidator {
    private adapters: {
        lsp: LSPAdapter;
        mcp: MCPAdapter;
        http: HTTPAdapter;
        cli: CLIAdapter;
    };

    private readonly maxResults = 50;
    private readonly identifierStopwords = new Set([
        'abstract',
        'any',
        'as',
        'async',
        'await',
        'boolean',
        'break',
        'case',
        'catch',
        'class',
        'const',
        'constructor',
        'continue',
        'debugger',
        'declare',
        'default',
        'delete',
        'do',
        'else',
        'enum',
        'export',
        'extends',
        'false',
        'finally',
        'for',
        'from',
        'function',
        'get',
        'if',
        'implements',
        'import',
        'in',
        'instanceof',
        'interface',
        'let',
        'module',
        'new',
        'null',
        'number',
        'object',
        'private',
        'protected',
        'public',
        'readonly',
        'return',
        'set',
        'static',
        'string',
        'super',
        'switch',
        'this',
        'throw',
        'true',
        'try',
        'type',
        'typeof',
        'undefined',
        'var',
        'void',
        'while',
        'with',
        'yield',
    ]);

    constructor(
        adapters: {
            lsp: LSPAdapter;
            mcp: MCPAdapter;
            http: HTTPAdapter;
            cli: CLIAdapter;
        },
        private repository: TestRepository
    ) {
        this.adapters = adapters;
    }

    private hashSeed(input: string): number {
        // FNV-1a 32-bit
        let h = 2166136261;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    private seededShuffle<T>(items: T[], seedInput: string): T[] {
        const arr = [...items];
        let x = this.hashSeed(seedInput) || 1;
        const rand = () => {
            // xorshift32
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return (x >>> 0) / 4294967296;
        };
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    private median(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    private toFsPath(p: string): string {
        return p.startsWith('file://') ? p.substring(7) : p;
    }

    private async readFileText(file: string): Promise<string> {
        return await fs.readFile(this.toFsPath(file), 'utf8');
    }

    private async findIdentifiers(
        file: string,
        limit = 2
    ): Promise<Array<{ symbol: string; position: { line: number; character: number } }>> {
        try {
            const text = await this.readFileText(file);
            const lines = text.split(/\r?\n/);
            const results: Array<{ symbol: string; position: { line: number; character: number } }> = [];
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex] || '';
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
                const re = /[A-Za-z_][A-Za-z0-9_]*/g;
                let match: RegExpExecArray | null = null;
                while ((match = re.exec(line))) {
                    const symbol = match[0];
                    if (this.identifierStopwords.has(symbol.toLowerCase())) continue;
                    results.push({
                        symbol,
                        position: { line: lineIndex, character: match.index },
                    });
                    if (results.length >= limit) {
                        return results;
                    }
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    private wordAtPosition(text: string, pos: { line: number; character: number }): string | null {
        const lines = text.split(/\r?\n/);
        if (pos.line < 0 || pos.line >= lines.length) return null;
        const line = lines[pos.line] || '';
        const idx = Math.min(Math.max(pos.character, 0), line.length);
        const re = /[A-Za-z0-9_]+/g;
        let m: RegExpExecArray | null = null;
        while ((m = re.exec(line))) {
            const start = m.index;
            const end = start + m[0].length;
            if (idx >= start && idx <= end) return m[0];
        }
        return null;
    }

    private async deriveSymbol(file: string, position: { line: number; character: number }): Promise<string> {
        try {
            const text = await this.readFileText(file);
            return this.wordAtPosition(text, position) || '';
        } catch {
            return '';
        }
    }

    private parseMcpTextPayload(mcpResult: any): any {
        try {
            const item = Array.isArray(mcpResult?.content)
                ? mcpResult.content.find((c: any) => typeof c?.text === 'string')
                : null;
            if (!item || typeof item.text !== 'string') return null;
            return JSON.parse(item.text);
        } catch {
            return null;
        }
    }

    async validateProtocolConsistency(
        repositoryPath: string,
        sampleFiles: string[]
    ): Promise<ConsistencyValidationReport> {
        console.log(`🔄 Running cross-protocol consistency validation for ${this.repository.name}`);

        // Generate test cases based on available files
        const testCases = await this.generateTestCases(sampleFiles);
        console.log(`📋 Generated ${testCases.length} test cases for validation`);

        const validationResults: ConsistencyValidationReport['testCases'] = [];

        // Run each test case across all protocols
        for (let i = 0; i < testCases.length; i++) {
            const testCase = testCases[i];
            console.log(`  🧪 [${i + 1}/${testCases.length}] Testing: ${testCase.name}`);

            // Execute test case on all protocols
            const results = await this.executeTestCaseAcrossProtocols(testCase);

            // Analyze consistency
            const consistency = this.analyzeConsistency(results);
            const analysis = this.generateAnalysis(testCase, results, consistency);

            validationResults.push({
                testCase,
                results,
                consistency,
                analysis,
            });

            // Log progress
            if (consistency.similarResults) {
                console.log(`    ✅ Consistent results across protocols`);
            } else {
                console.log(`    ⚠️ Inconsistent results (similarity: ${Math.round(consistency.similarity * 100)}%)`);
            }
        }

        const report = this.generateConsistencyReport(validationResults);
        this.logConsistencyReport(report);

        return report;
    }

    private async generateTestCases(sampleFiles: string[]): Promise<ProtocolTestCase[]> {
        const testCases: ProtocolTestCase[] = [];
        const filesToTest = sampleFiles.slice(0, 8); // Limit to 8 files for thorough testing
        let firstFileAnchor: { symbol: string; position: { line: number; character: number } } | null = null;

        for (const file of filesToTest) {
            const fileName = file.split('/').pop() || file;
            const identifiers = await this.findIdentifiers(file, 2);
            const primary = identifiers[0] || { symbol: 'symbol', position: { line: 0, character: 0 } };
            const secondary = identifiers[1] || primary;
            if (!firstFileAnchor) firstFileAnchor = primary;

            // Find definition test cases
            testCases.push({
                name: `find_definition_import_${fileName}`,
                description: `Find definition of "${primary.symbol}" in ${file}`,
                operation: 'findDefinition',
                file,
                input: {
                    line: primary.position.line,
                    character: primary.position.character,
                    symbol: primary.symbol,
                },
                expectedResultType: 'array',
                expectedMinResults: 0,
                expectedMaxResults: 5,
            });

            testCases.push({
                name: `find_definition_function_${fileName}`,
                description: `Find definition of "${secondary.symbol}" in ${file}`,
                operation: 'findDefinition',
                file,
                input: {
                    line: secondary.position.line,
                    character: secondary.position.character,
                    symbol: secondary.symbol,
                },
                expectedResultType: 'array',
                expectedMinResults: 0,
                expectedMaxResults: 3,
            });

            // Find references test cases
            testCases.push({
                name: `find_references_common_${fileName}`,
                description: `Find references to "${primary.symbol}" in ${file}`,
                operation: 'findReferences',
                file,
                input: { symbol: primary.symbol },
                expectedResultType: 'array',
                expectedMinResults: 0,
                expectedMaxResults: 50,
            });

            testCases.push({
                name: `find_references_variable_${fileName}`,
                description: `Find references to "${secondary.symbol}" in ${file}`,
                operation: 'findReferences',
                file,
                input: { symbol: secondary.symbol },
                expectedResultType: 'array',
                expectedMinResults: 0,
                expectedMaxResults: 30,
            });

            // Refactoring suggestions
            testCases.push({
                name: `suggest_refactoring_${fileName}`,
                description: `Get refactoring suggestions for ${file}`,
                operation: 'suggestRefactoring',
                file,
                input: {},
                expectedResultType: 'object',
                expectedMinResults: 0,
                expectedMaxResults: 10,
            });
        }

        // Add some rename test cases
        const firstFile = filesToTest[0];
        if (firstFile) {
            const anchor = firstFileAnchor || { symbol: 'symbol', position: { line: 0, character: 0 } };
            testCases.push({
                name: `rename_variable_${firstFile.split('/').pop()}`,
                description: `Rename symbol "${anchor.symbol}" in ${firstFile}`,
                operation: 'rename',
                file: firstFile,
                input: {
                    position: anchor.position,
                    newName: `renamed_${anchor.symbol}`,
                },
                expectedResultType: 'object',
                expectedMinResults: 0,
                expectedMaxResults: 20,
            });
        }

        return testCases;
    }

    private async executeTestCaseAcrossProtocols(testCase: ProtocolTestCase): Promise<ProtocolResult[]> {
        const protocols = this.seededShuffle(
            [
                { name: 'lsp', adapter: this.adapters.lsp },
                { name: 'mcp', adapter: this.adapters.mcp },
                { name: 'http', adapter: this.adapters.http },
                { name: 'cli', adapter: this.adapters.cli },
            ],
            `${this.repository.name}:${testCase.name}:${testCase.operation}`
        );

        const results: ProtocolResult[] = [];

        for (const protocol of protocols) {
            const startTime = performance.now();
            let result: any;
            let success = true;
            let error: string | undefined;

            try {
                result = await this.executeOperationOnProtocol(protocol.name, protocol.adapter, testCase);
            } catch (err) {
                success = false;
                error = err instanceof Error ? err.message : String(err);
                result = null;
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            const metadata = this.analyzeResult(result, testCase.expectedResultType);

            results.push({
                protocol: protocol.name,
                success,
                result,
                duration,
                error,
                metadata,
            });
        }

        return results;
    }

    private async executeOperationOnProtocol(
        protocolName: string,
        adapter: any,
        testCase: ProtocolTestCase
    ): Promise<any> {
        switch (testCase.operation) {
            case 'findDefinition': {
                const symbol =
                    (testCase.input && testCase.input.symbol) ||
                    (await this.deriveSymbol(testCase.file, testCase.input)) ||
                    'symbol';
                const input = { ...testCase.input, symbol };
                if (protocolName === 'lsp') {
                    return await adapter.findDefinition(testCase.file, input);
                } else if (protocolName === 'mcp') {
                    const result = await adapter.executeTool({
                        name: 'find_definition',
                        arguments: {
                            file: testCase.file,
                            position: testCase.input,
                            symbol,
                            precise: true,
                            maxResults: this.maxResults,
                        },
                    });
                    const parsed = this.parseMcpTextPayload(result);
                    return parsed?.definitions || [];
                } else if (protocolName === 'http') {
                    const response = await adapter.handleRequest({
                        method: 'POST',
                        url: '/api/v1/definition',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            identifier: symbol,
                            uri: testCase.file,
                            position: testCase.input,
                            precise: true,
                            maxResults: this.maxResults,
                        }),
                    });
                    const body = JSON.parse(response.body || '{}');
                    return body?.data || [];
                } else if (protocolName === 'cli') {
                    return await adapter.findDefinition(testCase.file, input);
                }
                break;
            }

            case 'findReferences': {
                const symbol = (testCase.input && testCase.input.symbol) || 'symbol';
                if (protocolName === 'lsp') {
                    return await adapter.findReferences(testCase.file, symbol);
                } else if (protocolName === 'mcp') {
                    const result = await adapter.executeTool({
                        name: 'find_references',
                        arguments: {
                            symbol,
                            includeDeclaration: false,
                            precise: true,
                            file: testCase.file,
                            maxResults: this.maxResults,
                        },
                    });
                    const parsed = this.parseMcpTextPayload(result);
                    return parsed?.references || [];
                } else if (protocolName === 'http') {
                    const response = await adapter.handleRequest({
                        method: 'POST',
                        url: '/api/v1/references',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            identifier: symbol,
                            uri: testCase.file,
                            precise: true,
                            maxResults: this.maxResults,
                        }),
                    });
                    const body = JSON.parse(response.body || '{}');
                    return body?.data || [];
                } else if (protocolName === 'cli') {
                    return await adapter.findReferences(testCase.file, symbol);
                }
                break;
            }

            case 'suggestRefactoring':
                if (protocolName === 'lsp') {
                    const result = await adapter.suggestRefactoring(testCase.file);
                    return { suggestions: this.normalizeSuggestions(result) };
                } else if (protocolName === 'mcp') {
                    const result = await adapter.executeTool({
                        name: 'suggest_refactoring',
                        arguments: { file: testCase.file },
                    });
                    const parsed = this.parseMcpTextPayload(result);
                    return { suggestions: this.normalizeSuggestions(parsed) };
                } else if (protocolName === 'http') {
                    const response = await adapter.handleRequest({
                        method: 'POST',
                        url: '/api/v1/refactor',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ uri: testCase.file }),
                    });
                    const body = JSON.parse(response.body || '{}');
                    return { suggestions: this.normalizeSuggestions(body?.data) };
                } else if (protocolName === 'cli') {
                    const result = await adapter.suggestRefactoring(testCase.file);
                    return { suggestions: this.normalizeSuggestions(result) };
                }
                break;

            case 'rename':
                if (protocolName === 'lsp') {
                    const result = await adapter.rename(testCase.file, testCase.input.position, testCase.input.newName);
                    return this.normalizeChanges(result);
                } else if (protocolName === 'mcp') {
                    const oldName = (await this.deriveSymbol(testCase.file, testCase.input.position)) || 'symbol';
                    const result = await adapter.executeTool({
                        name: 'rename_symbol',
                        arguments: { oldName, newName: testCase.input.newName, preview: true, file: testCase.file },
                    });
                    const parsed = this.parseMcpTextPayload(result);
                    return this.normalizeChanges(parsed || {});
                } else if (protocolName === 'http') {
                    const identifier = (await this.deriveSymbol(testCase.file, testCase.input.position)) || 'symbol';
                    const response = await adapter.handleRequest({
                        method: 'POST',
                        url: '/api/v1/rename',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            identifier,
                            newName: testCase.input.newName,
                            uri: testCase.file,
                            dryRun: true,
                        }),
                    });
                    const body = JSON.parse(response.body || '{}');
                    return this.normalizeChanges(body?.data || {});
                } else if (protocolName === 'cli') {
                    const result = await adapter.rename(testCase.file, testCase.input.position, testCase.input.newName);
                    return this.normalizeChanges(result);
                }
                break;

            default:
                throw new Error(`Unsupported operation: ${testCase.operation}`);
        }

        return null;
    }

    private normalizeSuggestions(value: any): any[] {
        if (Array.isArray(value)) return value;
        if (value && Array.isArray((value as any).suggestions)) return (value as any).suggestions;
        return [];
    }

    private normalizeChanges(value: any): Record<string, any> {
        if (value && typeof value === 'object') {
            const maybeChanges = (value as any).changes;
            if (maybeChanges && typeof maybeChanges === 'object') return maybeChanges;
            return value as Record<string, any>;
        }
        return {};
    }

    private analyzeResult(result: any, expectedType: string) {
        const resultType = Array.isArray(result) ? 'array' : typeof result;
        const resultCount = Array.isArray(result)
            ? result.length
            : result && typeof result === 'object'
              ? Object.keys(result).length
              : result
                ? 1
                : 0;
        const resultSize = JSON.stringify(result).length;

        return {
            resultType,
            resultCount,
            resultSize,
        };
    }

    private analyzeConsistency(results: ProtocolResult[]) {
        const successfulResults = results.filter((r) => r.success);
        const allSucceeded = successfulResults.length === results.length;

        // Calculate result similarity
        let similarity = 0;
        if (successfulResults.length >= 2) {
            // Compare result counts and structures
            const counts = successfulResults.map((r) => r.metadata.resultCount);
            const avgCount = counts.reduce((sum, c) => sum + c, 0) / counts.length;
            const countVariance = counts.reduce((sum, c) => sum + (c - avgCount) ** 2, 0) / counts.length;

            // Similarity based on count consistency (lower variance = higher similarity)
            const countSimilarity = avgCount > 0 ? Math.max(0, 1 - Math.sqrt(countVariance) / avgCount) : 1;

            // Consider result types consistency
            const resultTypes = successfulResults.map((r) => r.metadata.resultType);
            const typeConsistency = resultTypes.every((t) => t === resultTypes[0]) ? 1 : 0.5;

            similarity = countSimilarity * 0.7 + typeConsistency * 0.3;
        }

        // Calculate performance variance
        const durations = successfulResults.map((r) => r.duration);
        const medDuration = this.median(durations);
        const absDeviations = durations.map((d) => Math.abs(d - medDuration));
        const mad = this.median(absDeviations);
        // Robust coefficient of variation (approx): (1.4826 * MAD) / median
        const performanceVariance = medDuration > 0 ? (1.4826 * mad) / medDuration : 0;

        return {
            allSucceeded,
            similarResults: similarity > 0.7,
            similarPerformance: performanceVariance < 0.5,
            similarity,
            performanceVariance,
        };
    }

    private generateAnalysis(testCase: ProtocolTestCase, results: ProtocolResult[], consistency: any): string {
        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        let analysis = `Test case "${testCase.name}": `;

        if (consistency.allSucceeded) {
            if (consistency.similarResults) {
                analysis += '✅ All protocols succeeded with consistent results';
            } else {
                analysis += '⚠️ All protocols succeeded but with inconsistent results';
            }
        } else {
            analysis += `❌ ${failed.length}/${results.length} protocols failed`;
            if (failed.length > 0) {
                const errorSummary = failed
                    .map((f) => `${f.protocol}: ${f.error?.split('.')[0] || 'Unknown error'}`)
                    .join(', ');
                analysis += ` (${errorSummary})`;
            }
        }

        if (successful.length > 1) {
            const counts = successful.map((r) => r.metadata.resultCount);
            const durations = successful.map((r) => Math.round(r.duration));
            analysis += `. Result counts: [${counts.join(', ')}], Durations: [${durations.join(', ')}ms]`;
        }

        return analysis;
    }

    private generateConsistencyReport(
        validationResults: ConsistencyValidationReport['testCases']
    ): ConsistencyValidationReport {
        const consistentCases = validationResults.filter(
            (vr) => vr.consistency.similarResults && vr.consistency.allSucceeded
        );
        const inconsistentCases = validationResults.filter(
            (vr) => !vr.consistency.similarResults || !vr.consistency.allSucceeded
        );

        // Calculate average similarity
        const similarities = validationResults.map((vr) => vr.consistency.similarity);
        const averageSimilarity =
            similarities.length > 0 ? similarities.reduce((sum, s) => sum + s, 0) / similarities.length : 0;

        // Calculate average performance variance
        const variances = validationResults.map((vr) => vr.consistency.performanceVariance);
        const averagePerformanceVariance =
            variances.length > 0 ? variances.reduce((sum, v) => sum + v, 0) / variances.length : 0;

        // Calculate protocol reliability
        const protocolReliability: Record<string, number> = {};
        const protocols = ['lsp', 'mcp', 'http', 'cli'];

        for (const protocol of protocols) {
            const protocolResults = validationResults.flatMap((vr) =>
                vr.results.filter((r) => r.protocol === protocol)
            );
            const successful = protocolResults.filter((r) => r.success).length;
            protocolReliability[protocol] = protocolResults.length > 0 ? successful / protocolResults.length : 0;
        }

        // Identify common failures
        const commonFailures: string[] = [];
        const errorCounts: Record<string, number> = {};

        validationResults.forEach((vr) => {
            vr.results
                .filter((r) => !r.success)
                .forEach((r) => {
                    const errorType = r.error?.split(':')[0] || 'Unknown error';
                    errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
                });
        });

        Object.entries(errorCounts)
            .filter(([_, count]) => count > 1)
            .sort(([_, a], [__, b]) => b - a)
            .slice(0, 5)
            .forEach(([error, count]) => {
                commonFailures.push(`${error} (${count} occurrences)`);
            });

        // Generate recommendations
        const recommendations: string[] = [];

        if (averageSimilarity < 0.8) {
            recommendations.push('Improve result normalization across protocols to increase consistency');
        }
        if (averagePerformanceVariance > 0.3) {
            recommendations.push('Investigate performance differences between protocol adapters');
        }
        if (Math.min(...Object.values(protocolReliability)) < 0.8) {
            recommendations.push('Address reliability issues in underperforming protocols');
        }
        if (commonFailures.length > 0) {
            recommendations.push(`Focus on resolving common failure types: ${commonFailures[0].split(' (')[0]}`);
        }
        if (recommendations.length === 0) {
            recommendations.push('Cross-protocol consistency is excellent - maintain current quality');
        }

        return {
            repository: this.repository.name,
            testCases: validationResults,
            summary: {
                totalTestCases: validationResults.length,
                consistentCases: consistentCases.length,
                inconsistentCases: inconsistentCases.length,
                averageSimilarity,
                averagePerformanceVariance,
                protocolReliability,
                commonFailures,
                recommendations,
            },
        };
    }

    private logConsistencyReport(report: ConsistencyValidationReport) {
        console.log(`\n📊 Cross-Protocol Consistency Report for ${report.repository}`);
        console.log(`═════════════════════════════════════════════════════════════`);

        console.log(`🔄 Test Summary:`);
        console.log(`   Total Test Cases: ${report.summary.totalTestCases}`);
        console.log(
            `   Consistent Cases: ${report.summary.consistentCases} (${Math.round((report.summary.consistentCases / report.summary.totalTestCases) * 100)}%)`
        );
        console.log(
            `   Inconsistent Cases: ${report.summary.inconsistentCases} (${Math.round((report.summary.inconsistentCases / report.summary.totalTestCases) * 100)}%)`
        );
        console.log(`   Average Similarity: ${Math.round(report.summary.averageSimilarity * 100)}%`);
        console.log(`   Performance Variance: ${Math.round(report.summary.averagePerformanceVariance * 100)}%`);
        console.log(``);

        console.log(`🔌 Protocol Reliability:`);
        Object.entries(report.summary.protocolReliability).forEach(([protocol, reliability]) => {
            const status = reliability >= 0.9 ? '✅' : reliability >= 0.7 ? '⚠️' : '❌';
            console.log(`   ${protocol.toUpperCase()}: ${Math.round(reliability * 100)}% ${status}`);
        });
        console.log(``);

        if (report.summary.commonFailures.length > 0) {
            console.log(`⚠️ Common Failures:`);
            report.summary.commonFailures.forEach((failure) => {
                console.log(`   • ${failure}`);
            });
            console.log(``);
        }

        console.log(`💡 Recommendations:`);
        report.summary.recommendations.forEach((rec) => {
            console.log(`   • ${rec}`);
        });
    }

    async saveConsistencyReport(report: ConsistencyValidationReport, outputPath: string): Promise<string> {
        await fs.mkdir(outputPath, { recursive: true });

        const reportFile = join(outputPath, `consistency-${report.repository}-${Date.now()}.json`);
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

        // Also save a summary CSV
        const csvFile = join(outputPath, `consistency-summary-${report.repository}-${Date.now()}.csv`);
        const csvContent = [
            'TestCase,LSP_Success,MCP_Success,HTTP_Success,CLI_Success,Similarity,PerformanceVariance',
            ...report.testCases.map((tc) => {
                const results = tc.results.reduce((acc, r) => ({ ...acc, [r.protocol]: r.success }), {} as any);
                return `${tc.testCase.name},${results.lsp || false},${results.mcp || false},${results.http || false},${results.cli || false},${tc.consistency.similarity.toFixed(3)},${tc.consistency.performanceVariance.toFixed(3)}`;
            }),
        ].join('\n');
        await fs.writeFile(csvFile, csvContent);

        console.log(`💾 Consistency report saved to ${reportFile}`);
        return reportFile;
    }
}
