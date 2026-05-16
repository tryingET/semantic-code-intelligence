export interface TestRepository {
    name: string;
    url: string;
    branch?: string;
    sizeCategory: 'small' | 'medium' | 'large';
    language: string;
    expectedFiles: number;
    skipClone?: boolean; // For local testing
    localPath?: string; // Alternative local path for testing
    testCases: {
        findDefinition: Array<{
            file: string;
            position: { line: number; character: number };
            expectedSymbol: string;
            description: string;
        }>;
        findReferences: Array<{
            symbol: string;
            expectedMinCount: number;
            expectedMaxCount?: number;
            description: string;
        }>;
        renameSymbol: Array<{
            file: string;
            position: { line: number; character: number };
            newName: string;
            expectedMinChanges: number;
            description: string;
        }>;
        patternLearning: Array<{
            description: string;
            file: string;
            operations: Array<{
                type: 'definition' | 'references' | 'rename';
                position?: { line: number; character: number };
                symbol?: string;
                newName?: string;
            }>;
            expectedPatterns: number;
        }>;
    };
    performanceTargets: {
        avgResponseTime: number; // milliseconds
        p95ResponseTime: number;
        maxMemoryGrowth: number; // MB
        cacheHitRate: number; // percentage
    };
}

// Curated test repositories for different scenarios
export const TEST_REPOSITORIES: TestRepository[] = [
    // Small TypeScript Project
    {
        name: 'small-express-typescript',
        url: 'https://github.com/microsoft/TypeScript-Node-Starter.git',
        sizeCategory: 'small',
        language: 'typescript',
        expectedFiles: 150,
        testCases: {
            findDefinition: [
                {
                    file: 'src/app.ts',
                    position: { line: 1, character: 15 },
                    expectedSymbol: 'express',
                    description: 'Find express import definition',
                },
                {
                    file: 'src/controllers/home.ts',
                    position: { line: 5, character: 20 },
                    expectedSymbol: 'Request',
                    description: 'Find Express Request type definition',
                },
            ],
            findReferences: [
                {
                    symbol: 'app',
                    expectedMinCount: 3,
                    expectedMaxCount: 15,
                    description: 'Find all references to app variable',
                },
                {
                    symbol: 'express',
                    expectedMinCount: 1,
                    expectedMaxCount: 8,
                    description: 'Find all references to express import',
                },
            ],
            renameSymbol: [
                {
                    file: 'src/app.ts',
                    position: { line: 10, character: 10 },
                    newName: 'application',
                    expectedMinChanges: 2,
                    description: 'Rename app variable to application',
                },
            ],
            patternLearning: [
                {
                    description: 'Learn Express controller patterns',
                    file: 'src/controllers/home.ts',
                    operations: [
                        { type: 'definition', position: { line: 5, character: 20 } },
                        { type: 'references', symbol: 'Request' },
                        { type: 'definition', position: { line: 6, character: 20 } },
                    ],
                    expectedPatterns: 2,
                },
            ],
        },
        performanceTargets: {
            avgResponseTime: 50,
            p95ResponseTime: 100,
            maxMemoryGrowth: 50,
            cacheHitRate: 85,
        },
    },

    // Medium React Project
    {
        name: 'medium-react-project',
        url: 'https://github.com/facebook/create-react-app.git',
        sizeCategory: 'medium',
        language: 'javascript',
        expectedFiles: 1500,
        testCases: {
            findDefinition: [
                {
                    file: 'packages/react-scripts/config/webpack.config.js',
                    position: { line: 20, character: 15 },
                    expectedSymbol: 'webpack',
                    description: 'Find webpack import definition',
                },
                {
                    file: 'packages/react-scripts/scripts/build.js',
                    position: { line: 15, character: 10 },
                    expectedSymbol: 'config',
                    description: 'Find config variable definition',
                },
            ],
            findReferences: [
                {
                    symbol: 'webpack',
                    expectedMinCount: 10,
                    expectedMaxCount: 50,
                    description: 'Find all webpack references',
                },
                {
                    symbol: 'require',
                    expectedMinCount: 50,
                    expectedMaxCount: 200,
                    description: 'Find all require statements',
                },
            ],
            renameSymbol: [
                {
                    file: 'packages/react-scripts/scripts/build.js',
                    position: { line: 20, character: 15 },
                    newName: 'buildConfiguration',
                    expectedMinChanges: 3,
                    description: 'Rename config to buildConfiguration',
                },
            ],
            patternLearning: [
                {
                    description: 'Learn webpack configuration patterns',
                    file: 'packages/react-scripts/config/webpack.config.js',
                    operations: [
                        { type: 'definition', position: { line: 50, character: 20 } },
                        { type: 'references', symbol: 'module' },
                        { type: 'definition', position: { line: 100, character: 15 } },
                    ],
                    expectedPatterns: 3,
                },
            ],
        },
        performanceTargets: {
            avgResponseTime: 100,
            p95ResponseTime: 200,
            maxMemoryGrowth: 100,
            cacheHitRate: 80,
        },
    },

    // Large TypeScript Project
    {
        name: 'large-typescript-compiler',
        url: 'https://github.com/microsoft/TypeScript.git',
        sizeCategory: 'large',
        language: 'typescript',
        expectedFiles: 8000,
        testCases: {
            findDefinition: [
                {
                    file: 'src/compiler/checker.ts',
                    position: { line: 100, character: 25 },
                    expectedSymbol: 'Type',
                    description: 'Find Type interface definition',
                },
                {
                    file: 'src/compiler/parser.ts',
                    position: { line: 50, character: 15 },
                    expectedSymbol: 'Node',
                    description: 'Find AST Node definition',
                },
            ],
            findReferences: [
                {
                    symbol: 'SyntaxKind',
                    expectedMinCount: 100,
                    expectedMaxCount: 1000,
                    description: 'Find all SyntaxKind references',
                },
                {
                    symbol: 'Symbol',
                    expectedMinCount: 200,
                    expectedMaxCount: 2000,
                    description: 'Find all Symbol references',
                },
            ],
            renameSymbol: [
                {
                    file: 'src/compiler/types.ts',
                    position: { line: 1000, character: 20 },
                    newName: 'TypeScriptType',
                    expectedMinChanges: 10,
                    description: 'Rename Type to TypeScriptType',
                },
            ],
            patternLearning: [
                {
                    description: 'Learn compiler patterns',
                    file: 'src/compiler/checker.ts',
                    operations: [
                        { type: 'definition', position: { line: 500, character: 30 } },
                        { type: 'references', symbol: 'TypeChecker' },
                        { type: 'definition', position: { line: 1000, character: 25 } },
                        { type: 'references', symbol: 'getTypeOfSymbol' },
                    ],
                    expectedPatterns: 5,
                },
            ],
        },
        performanceTargets: {
            avgResponseTime: 200,
            p95ResponseTime: 500,
            maxMemoryGrowth: 200,
            cacheHitRate: 75,
        },
    },

    // Alternative repositories for different scenarios
    {
        name: 'small-vue-project',
        url: 'https://github.com/vuejs/create-vue.git',
        sizeCategory: 'small',
        language: 'typescript',
        expectedFiles: 300,
        testCases: {
            findDefinition: [
                {
                    file: 'template/base/src/main.ts',
                    position: { line: 1, character: 20 },
                    expectedSymbol: 'createApp',
                    description: 'Find Vue createApp definition',
                },
            ],
            findReferences: [
                {
                    symbol: 'app',
                    expectedMinCount: 2,
                    expectedMaxCount: 10,
                    description: 'Find app references in Vue project',
                },
            ],
            renameSymbol: [
                {
                    file: 'template/base/src/App.vue',
                    position: { line: 5, character: 15 },
                    newName: 'VueApplication',
                    expectedMinChanges: 1,
                    description: 'Rename in Vue SFC',
                },
            ],
            patternLearning: [
                {
                    description: 'Learn Vue composition patterns',
                    file: 'template/base/src/components/HelloWorld.vue',
                    operations: [
                        { type: 'definition', position: { line: 10, character: 15 } },
                        { type: 'references', symbol: 'defineProps' },
                    ],
                    expectedPatterns: 1,
                },
            ],
        },
        performanceTargets: {
            avgResponseTime: 40,
            p95ResponseTime: 80,
            maxMemoryGrowth: 40,
            cacheHitRate: 90,
        },
    },

    // Medium Node.js project
    {
        name: 'medium-nestjs-project',
        url: 'https://github.com/nestjs/nest.git',
        sizeCategory: 'medium',
        language: 'typescript',
        expectedFiles: 2500,
        testCases: {
            findDefinition: [
                {
                    file: 'packages/core/nest-application.ts',
                    position: { line: 50, character: 20 },
                    expectedSymbol: 'NestApplication',
                    description: 'Find NestApplication class definition',
                },
            ],
            findReferences: [
                {
                    symbol: 'Injectable',
                    expectedMinCount: 50,
                    expectedMaxCount: 300,
                    description: 'Find all @Injectable decorator usages',
                },
            ],
            renameSymbol: [
                {
                    file: 'packages/core/injector/injector.ts',
                    position: { line: 30, character: 15 },
                    newName: 'DependencyInjector',
                    expectedMinChanges: 5,
                    description: 'Rename Injector class',
                },
            ],
            patternLearning: [
                {
                    description: 'Learn NestJS decorator patterns',
                    file: 'packages/common/decorators/http/route-params.decorator.ts',
                    operations: [
                        { type: 'definition', position: { line: 20, character: 30 } },
                        { type: 'references', symbol: 'Param' },
                        { type: 'definition', position: { line: 40, character: 25 } },
                    ],
                    expectedPatterns: 3,
                },
            ],
        },
        performanceTargets: {
            avgResponseTime: 120,
            p95ResponseTime: 250,
            maxMemoryGrowth: 120,
            cacheHitRate: 78,
        },
    },
];

// Configuration for local testing (when GitHub repos aren't available)
export const LOCAL_TEST_REPOSITORIES: TestRepository[] = [
    {
        name: 'local-test-workspace',
        url: '', // Not used for local
        sizeCategory: 'small',
        language: 'typescript',
        expectedFiles: 10,
        skipClone: true,
        localPath: './test-workspace',
        testCases: {
            findDefinition: [
                {
                    file: 'sample.ts',
                    position: { line: 5, character: 10 },
                    expectedSymbol: 'function',
                    description: 'Find function definition in test workspace',
                },
            ],
            findReferences: [
                {
                    symbol: 'test',
                    expectedMinCount: 1,
                    expectedMaxCount: 5,
                    description: 'Find test references',
                },
            ],
            renameSymbol: [
                {
                    file: 'sample.ts',
                    position: { line: 3, character: 5 },
                    newName: 'renamed',
                    expectedMinChanges: 1,
                    description: 'Rename variable in test file',
                },
            ],
            patternLearning: [
                {
                    description: 'Learn basic patterns from test files',
                    file: 'sample.ts',
                    operations: [
                        { type: 'definition', position: { line: 1, character: 10 } },
                        { type: 'references', symbol: 'export' },
                    ],
                    expectedPatterns: 1,
                },
            ],
        },
        performanceTargets: {
            avgResponseTime: 20,
            p95ResponseTime: 40,
            maxMemoryGrowth: 20,
            cacheHitRate: 95,
        },
    },
];

export function getRepositoriesForTest(useLocal = false): TestRepository[] {
    if (useLocal || process.env.USE_LOCAL_REPOS === 'true') {
        return LOCAL_TEST_REPOSITORIES;
    }

    // For CI or when explicitly testing remote repos
    if (process.env.E2E_FULL_TEST === 'true') {
        return TEST_REPOSITORIES;
    }

    // Default: use first repo from each category for faster testing
    return [
        TEST_REPOSITORIES.find((r) => r.sizeCategory === 'small')!,
        TEST_REPOSITORIES.find((r) => r.sizeCategory === 'medium')!,
        TEST_REPOSITORIES.find((r) => r.sizeCategory === 'large')!,
    ].filter(Boolean);
}

export function getRepositoryBySize(size: 'small' | 'medium' | 'large'): TestRepository | undefined {
    return TEST_REPOSITORIES.find((r) => r.sizeCategory === size);
}

export function getAllRepositorySizes(): Array<'small' | 'medium' | 'large'> {
    return ['small', 'medium', 'large'];
}
