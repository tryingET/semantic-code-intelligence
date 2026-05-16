/**
 * Test Helper Utilities
 *
 * Provides utilities for proper path handling and configuration in tests
 * Works consistently across different environments and working directories
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Get the absolute path to the project root directory
 * This works regardless of where tests are run from
 */
export function getProjectRoot(): string {
    let currentDir = __dirname;

    // Walk up the directory tree until we find package.json
    while (currentDir !== path.dirname(currentDir)) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            return currentDir;
        }
        currentDir = path.dirname(currentDir);
    }

    // Fallback to current working directory if not found
    return process.cwd();
}

/**
 * Get paths relative to project root
 */
export function getProjectPath(...segments: string[]): string {
    return path.join(getProjectRoot(), ...segments);
}

/**
 * Get paths for common test directories
 */
export const testPaths = {
    // Main directories
    root: () => getProjectRoot(),
    src: () => getProjectPath('src'),
    tests: () => getProjectPath('tests'),
    dist: () => getProjectPath('dist'),

    // Test-specific paths
    fixtures: () => getProjectPath('tests', 'fixtures'),
    testWorkspace: () => getProjectPath('.test-workspace'),

    // Server executables (built via build:lsp)
    serverJs: () => getProjectPath('dist', 'lsp', 'lsp.js'),
    serverNew: () => getProjectPath('src', 'server-new.ts'),

    // Config files
    packageJson: () => getProjectPath('package.json'),
    tsConfig: () => getProjectPath('tsconfig.json'),

    // Test databases (in-memory or temp)
    testDb: (name?: string) => (name ? getProjectPath('.test-data', `${name}.db`) : ':memory:'),
};

/**
 * Ensure test directories exist
 */
export function ensureTestDirectories(): void {
    const dirs = [
        testPaths.fixtures(),
        testPaths.testWorkspace(),
        path.dirname(testPaths.testDb('dummy')), // Creates .test-data directory
    ];

    for (const dir of dirs) {
        if (dir !== ':memory:' && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

/**
 * Clean up test directories
 */
export function cleanupTestDirectories(): void {
    const dirs = [
        testPaths.testWorkspace(),
        path.dirname(testPaths.testDb('dummy')), // .test-data directory
    ];

    for (const dir of dirs) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
}

/**
 * Create test configuration with proper paths
 */
export function createTestConfig(overrides: any = {}) {
    return {
        workspaceRoot: testPaths.testWorkspace(),
        layers: {
            layer1: { enabled: true, timeout: 50 },
            layer2: { enabled: true, timeout: 100 },
            layer3: { enabled: true, timeout: 50 },
            layer4: { enabled: true, timeout: 50 },
            layer5: { enabled: true, timeout: 100 },
        },
        cache: {
            enabled: true,
            strategy: 'memory' as const,
            memory: {
                maxSize: 1024 * 1024, // 1MB
                ttl: 300,
            },
        },
        database: {
            path: testPaths.testDb(),
            maxConnections: 10,
        },
        performance: {
            targetResponseTime: 100,
            maxConcurrentRequests: 50,
            healthCheckInterval: 30000,
        },
        monitoring: {
            enabled: false,
            metricsInterval: 60000,
            logLevel: 'error' as const,
            tracing: {
                enabled: false,
                sampleRate: 0,
            },
        },
        ...overrides,
    };
}

/**
 * File URI utilities for tests
 */
export function toFileUri(filePath: string): string {
    const absolutePath = path.isAbsolute(filePath) ? filePath : getProjectPath(filePath);
    return `file://${absolutePath.replace(/\\/g, '/')}`;
}

export function fromFileUri(uri: string): string {
    if (!uri.startsWith('file://')) {
        return uri;
    }
    return uri.substring(7).replace(/\//g, path.sep);
}

/**
 * Wait for a condition to be true (useful for async tests)
 */
export function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 5000,
    intervalMs: number = 100
): Promise<void> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = async () => {
            try {
                const result = await condition();
                if (result) {
                    resolve();
                    return;
                }
            } catch (error) {
                // Continue checking unless timeout reached
            }

            if (Date.now() - startTime > timeoutMs) {
                reject(new Error(`Condition not met within ${timeoutMs}ms`));
                return;
            }

            setTimeout(check, intervalMs);
        };

        check();
    });
}

/**
 * Create a simple test file for testing
 */
export function createTestFile(relativePath: string, content: string): string {
    const fullPath = getProjectPath(relativePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    return fullPath;
}

/**
 * Default test file content for various languages
 */
export const testFileContents = {
    typescript: `
export class TestClass {
  private value: number = 0;
  
  constructor(initialValue?: number) {
    this.value = initialValue ?? 0;
  }
  
  public getValue(): number {
    return this.value;
  }
  
  public setValue(newValue: number): void {
    this.value = newValue;
  }
  
  public static createDefault(): TestClass {
    return new TestClass(42);
  }
}

export function TestFunction(param: string): string {
  return \`Hello, \${param}!\`;
}

export interface TestInterface {
  id: string;
  name: string;
  active: boolean;
}
  `.trim(),

    javascript: `
class TestClass {
  constructor(initialValue = 0) {
    this.value = initialValue;
  }
  
  getValue() {
    return this.value;
  }
  
  setValue(newValue) {
    this.value = newValue;
  }
  
  static createDefault() {
    return new TestClass(42);
  }
}

function TestFunction(param) {
  return \`Hello, \${param}!\`;
}

module.exports = { TestClass, TestFunction };
  `.trim(),
};

/**
 * Tiny fixtures: Example and RenameContext factories for L5 tests
 */
export function makeRenameContext(overrides: Partial<import('../src/types/core').RenameContext> = {}) {
    const base: import('../src/types/core').RenameContext = {
        file: '/tmp/example.ts',
        surroundingSymbols: [],
        timestamp: new Date(),
    };
    return { ...base, ...overrides };
}

export function makeExample(
    oldName: string,
    newName: string,
    overrides: Partial<import('../src/types/core').Example> = {}
): import('../src/types/core').Example {
    const baseCtx = makeRenameContext();
    const ex: import('../src/types/core').Example = {
        oldName,
        newName,
        confidence: 0.8,
        context: baseCtx,
    };
    return { ...ex, ...overrides };
}

/**
 * Environment detection
 */
export function isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test';
}

export function isBunRuntime(): boolean {
    return typeof Bun !== 'undefined';
}

/**
 * Create real layer implementations for testing using the actual layer classes
 */
export async function createRealLayers(config: any): Promise<any[]> {
    const { ClaudeToolsLayer } = await import('../src/layers/claude-tools.js');
    const { TreeSitterLayer } = await import('../src/layers/tree-sitter.js');
    const { PatternLearnerLayer } = await import('../src/layers/pattern-learner-layer.js');

    // Create Fast Search Layer (Layer 1) configuration
    const claudeToolsConfig = {
        grep: {
            defaultTimeout: config.layers.layer1.timeout || 50,
            maxResults: 100,
            caseSensitive: false,
            includeContext: true,
            contextLines: 2,
        },
        glob: {
            defaultTimeout: config.layers.layer1.timeout || 50,
            maxFiles: 50,
            ignorePatterns: ['node_modules/**', '.git/**', 'dist/**', '*.log'],
        },
        ls: {
            defaultTimeout: config.layers.layer1.timeout || 50,
            maxDepth: 3,
            followSymlinks: false,
            includeDotfiles: false,
        },
        optimization: {
            bloomFilter: true,
            frequencyCache: true,
            recentSearches: true,
            negativeLookup: true,
        },
        caching: {
            enabled: true,
            ttl: 300, // 5 minutes
            maxEntries: 1000,
        },
    };

    // Create Tree-sitter Layer (Layer 2) configuration
    const treeSitterConfig = {
        languages: ['typescript', 'javascript', 'python'],
        maxFileSize: '1MB',
        cacheSize: 100,
        timeout: config.layers.layer2.timeout || 100,
    };

    // Create Pattern Learner Layer (Layer 5) configuration
    const patternLearnerConfig = {
        dbPath: ':memory:', // Use in-memory database for tests
        learningThreshold: 2, // Lower threshold for testing
        confidenceThreshold: 0.5, // Lower threshold for testing
        timeout: config.layers.layer4.timeout || 50,
        enabled: config.layers.layer4.enabled,
    };

    const layers = [];

    // Layer 1: Fast Search Layer
    if (config.layers.layer1.enabled) {
        const layer1 = new ClaudeToolsLayer(claudeToolsConfig);
        layer1.name = 'layer1';

        // Add missing methods for layer manager compatibility
        if (!layer1.isHealthy) {
            layer1.isHealthy = () => true;
        }
        if (!layer1.dispose) {
            layer1.dispose = async () => {};
        }
        if (!layer1.getDiagnostics) {
            layer1.getDiagnostics = () => ({ name: 'layer1', active: true });
        }
        if (!layer1.initialize) {
            layer1.initialize = async () => {};
        }
        if (!layer1.getMetrics) {
            layer1.getMetrics = () => ({
                name: 'layer1',
                requestCount: 0,
                averageLatency: 0,
                p95Latency: 0,
                errorCount: 0,
                cacheHitRate: 0,
            });
        }
        if (!layer1.version) {
            layer1.version = '1.0.0';
        }
        // Set targetLatency for layer manager
        layer1.targetLatency = 50; // 50ms target for fast search - realistic for ripgrep operations

        layers.push(layer1);
    }

    // Layer 2: Tree-sitter Layer (AST analysis)
    if (config.layers.layer2.enabled) {
        const layer2 = new TreeSitterLayer(treeSitterConfig);
        layer2.name = 'layer2';

        // Add missing methods for layer manager compatibility
        if (!layer2.isHealthy) {
            layer2.isHealthy = () => true;
        }
        if (!layer2.dispose) {
            layer2.dispose = async () => {};
        }
        if (!layer2.getDiagnostics) {
            layer2.getDiagnostics = () => ({ name: 'layer2', active: true });
        }
        if (!layer2.initialize) {
            layer2.initialize = async () => {};
        }
        if (!layer2.getMetrics) {
            layer2.getMetrics = () => ({
                name: 'layer2',
                requestCount: 0,
                averageLatency: 0,
                p95Latency: 0,
                errorCount: 0,
                cacheHitRate: 0,
            });
        }
        if (!layer2.version) {
            layer2.version = '1.0.0';
        }
        // Set targetLatency for layer manager
        layer2.targetLatency = 50; // 50ms target for AST analysis

        layers.push(layer2);
    }

    // Layer 3: Placeholder for planner (stub until implemented)
    if (config.layers.layer3.enabled) {
        layers.push({
            name: 'layer3',
            version: '1.0.0',
            timeout: config.layers.layer3.timeout || 50,
            targetLatency: 10, // 10ms target for ontology concepts
            async initialize(): Promise<void> {},
            async process(query: any): Promise<any> {
                // Stub implementation - would use OntologyEngine
                return { data: [], searchTime: 1 };
            },
            async dispose(): Promise<void> {},
            getDiagnostics(): any {
                return { name: 'layer3', active: true };
            },
            getMetrics(): any {
                return {
                    name: 'layer3',
                    requestCount: 0,
                    averageLatency: 0,
                    p95Latency: 0,
                    errorCount: 0,
                    cacheHitRate: 0,
                };
            },
            isHealthy(): boolean {
                return true;
            },
        });
    }

    // Layer 5: Pattern Learner Layer (Real implementation!)
    if (config.layers.layer4.enabled) {
        const layer4 = new PatternLearnerLayer(patternLearnerConfig);
        await layer4.initialize(); // Initialize the layer
        layers.push(layer4);
    }

    // Layer 5: Placeholder for knowledge propagation (stub until implemented)
    if (config.layers.layer5.enabled) {
        layers.push({
            name: 'layer5',
            version: '1.0.0',
            timeout: config.layers.layer5.timeout || 100,
            targetLatency: 20, // 20ms target for knowledge propagation
            async initialize(): Promise<void> {},
            async process(query: any): Promise<any> {
                // Stub implementation - would use KnowledgeSpreader
                return { data: [], searchTime: 1 };
            },
            async dispose(): Promise<void> {},
            getDiagnostics(): any {
                return { name: 'layer5', active: true };
            },
            getMetrics(): any {
                return {
                    name: 'layer5',
                    requestCount: 0,
                    averageLatency: 0,
                    p95Latency: 0,
                    errorCount: 0,
                    cacheHitRate: 0,
                };
            },
            isHealthy(): boolean {
                return true;
            },
        });
    }

    return layers;
}

/**
 * Register real layers with a layer manager
 */
export async function registerRealLayers(layerManager: any, config: any): Promise<void> {
    const realLayers = await createRealLayers(config);
    realLayers.forEach((layer) => {
        try {
            layerManager.registerLayer(layer);
        } catch (error) {
            // Layer already registered - continue with existing layer
            if (error instanceof Error && error.message.includes('already registered')) {
                console.log(`Layer ${layer.name} already registered, skipping...`);
            } else {
                throw error;
            }
        }
    });
}
