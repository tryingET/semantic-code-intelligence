// Tree-sitter AST Analysis Layer

import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import Parser, { Query, type SyntaxNode, type Tree } from 'tree-sitter';
import type { OntologyEngine } from '../ontology/ontology-engine';
import {
    type ASTNode,
    type Concept,
    type EnhancedMatches,
    type Layer,
    NodeMetadata,
    type TreeSitterConfig,
} from '../types/core';

// Language imports - lazy loaded based on actual need
let TypeScript: any = null;
let JavaScript: any = null;
let Python: any = null;
const loadedLanguages = new Set<string>();

// File type detection - run ONCE at startup
function detectProjectLanguages(projectPath: string = '.'): Set<string> {
    try {
        // Use fast file type detection with fd or find
        // Exclude node_modules and other common directories
        const result = execSync(
            `find ${projectPath} -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" | head -100`,
            { encoding: 'utf8', timeout: 1000 }
        );

        const languages = new Set<string>();
        const lines = result.split('\n').filter(Boolean);

        for (const line of lines) {
            if (line.endsWith('.ts') || line.endsWith('.tsx')) languages.add('typescript');
            if (line.endsWith('.js') || line.endsWith('.jsx')) languages.add('javascript');
            if (line.endsWith('.py')) languages.add('python');
        }

        // If we're in a TypeScript project but only found JS, still include TypeScript
        if (languages.has('javascript') && !languages.has('typescript')) {
            // Check if there's a tsconfig.json
            try {
                require.resolve(path.join(projectPath, 'tsconfig.json'));
                languages.add('typescript');
            } catch {
                // No tsconfig, keep as is
            }
        }

        return languages;
    } catch (e) {
        // Default to TypeScript/JavaScript for safety
        return new Set(['typescript', 'javascript']);
    }
}

// Find the correct path for native modules
function findModulePath(moduleName: string): string {
    // Try multiple possible locations
    const possiblePaths = [
        // Direct require (works in development)
        moduleName,
        // Relative to project root
        path.join(process.cwd(), 'node_modules', moduleName),
        // Relative to dist directory
        path.join(process.cwd(), '..', 'node_modules', moduleName),
        path.join(process.cwd(), '..', '..', 'node_modules', moduleName),
        // Global node_modules
        path.join(require.resolve('tree-sitter'), '..', '..', moduleName),
    ];

    for (const tryPath of possiblePaths) {
        try {
            require.resolve(tryPath);
            return tryPath;
        } catch {
            // Continue to next path
        }
    }

    throw new Error(`Cannot find module ${moduleName} in any expected location`);
}

// Lazy load parsers only when needed
function loadLanguageParser(language: string): any {
    if (loadedLanguages.has(language)) {
        switch (language) {
            case 'typescript':
                return TypeScript;
            case 'javascript':
                return JavaScript;
            case 'python':
                return Python;
        }
    }

    try {
        switch (language) {
            case 'typescript':
                if (!TypeScript) {
                    const modulePath = findModulePath('tree-sitter-typescript');
                    const tsModule = require(modulePath);
                    TypeScript = tsModule.typescript;
                    loadedLanguages.add('typescript');
                    if (process.env.DEBUG && !process.env.SILENT_MODE) {
                        console.error(`✓ Loaded TypeScript parser from ${modulePath}`);
                    }
                }
                return TypeScript;
            case 'javascript':
                if (!JavaScript) {
                    const modulePath = findModulePath('tree-sitter-javascript');
                    const jsModule = require(modulePath);
                    JavaScript = jsModule; // node binding exports the language directly
                    loadedLanguages.add('javascript');
                    if (process.env.DEBUG && !process.env.SILENT_MODE) {
                        console.error(`✓ Loaded JavaScript parser from ${modulePath}`);
                    }
                }
                return JavaScript;
            case 'python':
                if (!Python) {
                    const modulePath = findModulePath('tree-sitter-python');
                    Python = require(modulePath);
                    loadedLanguages.add('python');
                    if (process.env.DEBUG && !process.env.SILENT_MODE) {
                        console.error(`✓ Loaded Python parser from ${modulePath}`);
                    }
                }
                return Python;
            default:
                return null;
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Failed to load ${language} parser:`, msg);
        return null;
    }
}

export interface TreeSitterResult {
    nodes: ASTNode[];
    relationships: Relationship[];
    patterns: DesignPattern[];
    parseTime: number;
    files: string[];
}

interface Relationship {
    from: string;
    to: string;
    type: 'calls' | 'extends' | 'implements' | 'imports' | 'references';
    confidence: number;
    location: string;
}

interface DesignPattern {
    name: string;
    type: 'factory' | 'singleton' | 'observer' | 'strategy' | 'decorator';
    confidence: number;
    nodes: string[];
    description: string;
}

export class TreeSitterLayer implements Layer<EnhancedMatches, TreeSitterResult> {
    name = 'TreeSitterLayer';
    timeout = 100; // 100ms timeout for production performance

    private parsers = new Map<string, Parser>();
    private queries = new Map<string, Map<string, Query>>();
    private cache = new Map<string, { tree: Tree; timestamp: number }>();
    private ontologyEngine?: OntologyEngine;
    private parseSamples: number[] = [];
    private readonly maxSamples: number = 512;
    private parseStats = { count: 0, lastMs: 0, p50: 0, p95: 0, p99: 0, errors: 0 };

    constructor(
        private config: TreeSitterConfig,
        ontologyEngine?: OntologyEngine
    ) {
        // Detect actual languages in the project
        const detectedLanguages = detectProjectLanguages(config.projectPath || '.');

        // Only configure languages that are actually present
        this.config.languages = this.config.languages.filter((lang) => detectedLanguages.has(lang));

        if (this.config.languages.length === 0) {
            // Default to TypeScript/JavaScript if no languages detected
            this.config.languages = ['typescript', 'javascript'];
        }

        if (process.env.DEBUG && !process.env.SILENT_MODE) {
            console.error(`TreeSitter: Detected languages: ${Array.from(detectedLanguages).join(', ')}`);
            console.error(`TreeSitter: Loading parsers for: ${this.config.languages.join(', ')}`);
        }

        this.setupParsers();
        this.setupQueries();
        this.ontologyEngine = ontologyEngine;
    }

    private setupParsers(): void {
        // Only load parsers for configured languages
        for (const langName of this.config.languages) {
            const language = loadLanguageParser(langName);

            if (language) {
                try {
                    const parser = new Parser();
                    parser.setLanguage(language);
                    this.parsers.set(langName, parser);
                    if (process.env.DEBUG && !process.env.SILENT_MODE) {
                        console.error(`✓ Initialized ${langName} parser`);
                    }
                } catch (e) {
                    if (!process.env.SILENT_MODE) {
                        console.warn(`✗ Failed to initialize ${langName} parser:`, e);
                    }
                }
            } else {
                if (!process.env.SILENT_MODE) {
                    console.warn(`✗ No parser available for ${langName}`);
                }
            }
        }

        if (this.parsers.size === 0) {
            console.warn('⚠ No parsers initialized! Tree-sitter layer will be disabled.');
        }
    }

    private setupQueries(): void {
        // TypeScript/JavaScript queries
        const tsQueries = {
            identifiers: `
                (identifier) @id
                (property_identifier) @prop
                (type_identifier) @type
            `,

            functions: `
                (function_declaration
                    name: (identifier) @func.name
                    parameters: (formal_parameters) @func.params
                    body: (statement_block) @func.body)
                
                (arrow_function
                    parameters: (formal_parameters) @arrow.params
                    body: (_) @arrow.body)
                
                (method_definition
                    name: (property_identifier) @method.name
                    parameters: (formal_parameters) @method.params
                    body: (statement_block) @method.body)
            `,

            classes: `
                (class_declaration
                    name: (type_identifier) @class.name
                    (class_heritage
                        (extends_clause
                            (identifier) @class.extends))?
                    (class_heritage
                        (implements_clause
                            (type_identifier) @class.implements)*)?
                    body: (class_body) @class.body)
            `,

            imports: `
                (import_statement
                    source: (string) @import.source
                    (import_clause
                        (named_imports
                            (import_specifier
                                name: (identifier) @import.name
                                alias: (identifier)? @import.alias)*)?
                        (namespace_import
                            (identifier) @import.namespace)?
                        (identifier)? @import.default)?)
            `,

            exports: `
                (export_statement
                    (function_declaration
                        name: (identifier) @export.func)?
                    (class_declaration
                        name: (type_identifier) @export.class)?
                    (variable_declaration
                        (variable_declarator
                            name: (identifier) @export.var))?
                    declaration: (_)? @export.decl)
            `,

            calls: `
                (call_expression
                    function: (identifier) @call.func
                    arguments: (arguments) @call.args)
                
                (call_expression
                    function: (member_expression
                        object: (identifier) @call.object
                        property: (property_identifier) @call.method)
                    arguments: (arguments) @call.args)
            `,

            references: `
                (member_expression
                    object: (identifier) @ref.object
                    property: (property_identifier) @ref.property)
                
                (assignment_expression
                    left: (identifier) @assign.target
                    right: (_) @assign.value)
            `,
        };

        // JavaScript queries (no type_identifier or implements_clause)
        const jsQueries = {
            identifiers: `
                (identifier) @id
                (property_identifier) @prop
            `,

            functions: `
                (function_declaration
                    name: (identifier) @func.name
                    parameters: (formal_parameters) @func.params
                    body: (statement_block) @func.body)
                
                (arrow_function
                    parameters: (formal_parameters) @arrow.params
                    body: (_) @arrow.body)
                
                (method_definition
                    name: (property_identifier) @method.name
                    parameters: (formal_parameters) @method.params
                    body: (statement_block) @method.body)
            `,

            // Keep JS class query minimal to avoid TS-only nodes like 'extends_clause'/'type_identifier'
            // Some JS grammar versions do not expose 'extends_clause' as a separate node
            classes: `
                (class_declaration
                    name: (identifier) @class.name
                    body: (class_body) @class.body)
            `,

            imports: `
                (import_statement
                    source: (string) @import.source
                    (import_clause
                        (named_imports
                            (import_specifier
                                name: (identifier) @import.name
                                alias: (identifier)? @import.alias)*)?
                        (namespace_import
                            (identifier) @import.namespace)?
                        (identifier)? @import.default)?)
            `,

            exports: `
                (export_statement
                    (function_declaration
                        name: (identifier) @export.func)?
                    (class_declaration
                        name: (identifier) @export.class)?
                    (variable_declaration
                        (variable_declarator
                            name: (identifier) @export.var))?
                    declaration: (_)? @export.decl)
            `,

            calls: `
                (call_expression
                    function: (identifier) @call.func
                    arguments: (arguments) @call.args)
                
                (call_expression
                    function: (member_expression
                        object: (identifier) @call.object
                        property: (property_identifier) @call.method)
                    arguments: (arguments) @call.args)
            `,

            references: `
                (member_expression
                    object: (identifier) @ref.object
                    property: (property_identifier) @ref.property)
                
                (assignment_expression
                    left: (identifier) @assign.target
                    right: (_) @assign.value)
            `,
        };

        // Setup queries per language to avoid language/query mismatches
        if (TypeScript) {
            const tsQueryMap = new Map<string, Query>();
            for (const [name, queryString] of Object.entries(tsQueries)) {
                try {
                    tsQueryMap.set(name, new Query(TypeScript, queryString));
                } catch (e: any) {
                    if (!process.env.SILENT_MODE) {
                        console.warn(`Tree-sitter: failed to compile TS query '${name}':`, e?.message || e);
                    }
                }
            }
            this.queries.set('typescript', tsQueryMap);
        }
        if (JavaScript) {
            const jsQueryMap = new Map<string, Query>();
            for (const [name, queryString] of Object.entries(jsQueries)) {
                try {
                    jsQueryMap.set(name, new Query(JavaScript, queryString));
                } catch (e: any) {
                    if (!process.env.SILENT_MODE) {
                        console.warn(`Tree-sitter: failed to compile JS query '${name}':`, e?.message || e);
                    }
                }
            }
            this.queries.set('javascript', jsQueryMap);
        }

        // Python queries
        const pythonQueries = {
            identifiers: `
                (identifier) @id
            `,

            functions: `
                (function_definition
                    name: (identifier) @func.name
                    parameters: (parameters) @func.params
                    body: (block) @func.body)
            `,

            classes: `
                (class_definition
                    name: (identifier) @class.name
                    superclasses: (argument_list
                        (identifier) @class.extends)*
                    body: (block) @class.body)
            `,

            imports: `
                (import_statement
                    name: (dotted_name) @import.module)
                
                (import_from_statement
                    module_name: (dotted_name) @import.from
                    name: (dotted_name) @import.name)
            `,
        };

        if (Python) {
            const pythonQueryMap = new Map<string, Query>();
            for (const [name, queryString] of Object.entries(pythonQueries)) {
                pythonQueryMap.set(name, new Query(Python, queryString));
            }
            this.queries.set('python', pythonQueryMap);
        }
    }

    async process(matches: EnhancedMatches): Promise<TreeSitterResult> {
        const startTime = Date.now();
        const result: TreeSitterResult = {
            nodes: [],
            relationships: [],
            patterns: [],
            parseTime: 0,
            files: [],
        };

        // Get unique files from matches
        const filesToParse = new Set<string>();

        // Safely handle spread operations by checking for null/undefined arrays
        const exactMatches = matches.exact || [];
        const fuzzyMatches = matches.fuzzy || [];
        const conceptualMatches = matches.conceptual || [];

        [...exactMatches, ...fuzzyMatches, ...conceptualMatches].forEach((match) => {
            if (match && match.file) {
                filesToParse.add(match.file);
            }
        });

        // Safely handle files array
        const files = matches.files || [];
        files.forEach((file) => {
            if (file) {
                filesToParse.add(file);
            }
        });

        // Limit files for performance (only parse most relevant)
        const sortedFiles = this.sortFilesByRelevance([...filesToParse], matches);
        // Allow env override for max parsed files to help stabilize perf during CI/perf runs
        const envMax = Number.parseInt(process.env.L2_MAX_PARSE_FILES || '', 10);
        // Clamp to [1, 100] when a numeric value is provided; fall back to default (20) when invalid
        const maxFiles = Number.isFinite(envMax) ? Math.min(Math.max(envMax, 1), 100) : 20;
        const filesToProcess = sortedFiles.slice(0, maxFiles);

        // Parse files in parallel
        const parsePromises = filesToProcess.map((file) => this.parseFile(file));
        const parseResults = await Promise.allSettled(parsePromises);

        // Process successful parses
        for (let i = 0; i < parseResults.length; i++) {
            const parseResult = parseResults[i];
            const file = filesToProcess[i];

            if (parseResult.status === 'fulfilled' && parseResult.value) {
                const { tree, language } = parseResult.value;
                result.files.push(file);

                // Extract information from AST
                await this.extractASTInformation(tree, language, file, result, matches);
            }
        }

        // Find design patterns
        result.patterns = this.findDesignPatterns(result.nodes);

        result.parseTime = Date.now() - startTime;
        if (process.env.PERF === '1' && !process.env.SILENT_MODE) {
            try {
                console.log(
                    `L2(TreeSitter) parse metrics: count=${this.parseStats.count} p95=${this.parseStats.p95}ms p50=${this.parseStats.p50}ms`
                );
            } catch {}
        }
        return result;
    }

    private async parseFile(filePath: string): Promise<{ tree: Tree; language: string } | null> {
        try {
            // Check cache
            const cached = this.cache.get(filePath);
            if (cached) {
                const stats = await fs.stat(filePath);
                if (stats.mtime.getTime() < cached.timestamp) {
                    return { tree: cached.tree, language: this.getLanguageFromFile(filePath) };
                }
            }

            // Check file size
            const stats = await fs.stat(filePath);
            const maxSize = this.parseSize(this.config.maxFileSize);
            if (stats.size > maxSize) {
                console.warn(`File too large, skipping: ${filePath} (${stats.size} bytes)`);
                return null;
            }

            // Determine language and parser
            const language = this.getLanguageFromFile(filePath);
            const parser = this.parsers.get(language);

            if (!parser) {
                return null;
            }

            // Parse file (set bufferSize explicitly to avoid native binding 'Invalid argument' on large inputs)
            const content = await fs.readFile(filePath, 'utf-8');
            const BUFFER_SIZE = Math.max(1 << 20, 262144); // at least 1MB
            const t0 = Date.now();
            const tree = (parser as any).parse(content, undefined, { bufferSize: BUFFER_SIZE });
            const dt = Date.now() - t0;
            this.recordParseDuration(dt);

            // Cache result
            this.cache.set(filePath, {
                tree,
                timestamp: Date.now(),
            });

            return { tree, language };
        } catch (error) {
            if (!process.env.SILENT_MODE) {
                console.warn(`Failed to parse file: ${filePath}`, error);
            }
            this.parseStats.errors++;
            return null;
        }
    }

    private async extractASTInformation(
        tree: Tree,
        language: string,
        filePath: string,
        result: TreeSitterResult,
        originalMatches: EnhancedMatches
    ): Promise<void> {
        const queries = this.queries.get(language);
        if (!queries) return;

        // Extract all relevant nodes
        const allCaptures = new Map<string, any[]>();

        for (const [queryName, query] of queries) {
            try {
                const captures = query.captures(tree.rootNode);
                allCaptures.set(queryName, captures);
            } catch (error) {
                console.warn(`Query failed: ${queryName}`, error);
            }
        }

        // Process identifiers (now async)
        await this.processIdentifiers(allCaptures.get('identifiers') || [], filePath, result, originalMatches);

        // Process functions (now async)
        await this.processFunctions(allCaptures.get('functions') || [], filePath, result);

        // Process classes (now async)
        await this.processClasses(allCaptures.get('classes') || [], filePath, result);

        // Process imports/exports
        this.processImportsExports(
            allCaptures.get('imports') || [],
            allCaptures.get('exports') || [],
            filePath,
            result
        );

        // Process relationships
        this.processRelationships(
            allCaptures.get('calls') || [],
            allCaptures.get('references') || [],
            filePath,
            result
        );
    }

    private recordParseDuration(ms: number): void {
        this.parseStats.count++;
        this.parseStats.lastMs = ms;
        if (this.parseSamples.length < this.maxSamples) this.parseSamples.push(ms);
        else {
            const idx = Math.floor(Math.random() * this.maxSamples);
            this.parseSamples[idx] = ms;
        }
        const sorted = [...this.parseSamples].sort((a, b) => a - b);
        const pick = (q: number) => (sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : 0);
        this.parseStats.p50 = pick(0.5);
        this.parseStats.p95 = pick(0.95);
        this.parseStats.p99 = pick(0.99);
    }

    getMetrics(): any {
        return { ...this.parseStats };
    }

    private async processIdentifiers(
        captures: any[],
        filePath: string,
        result: TreeSitterResult,
        originalMatches: EnhancedMatches
    ): Promise<void> {
        for (const capture of captures) {
            const node = capture.node;

            // Check if this identifier is relevant to our search
            // Use enhanced relevance check if ontology engine is available
            const isRelevant = this.ontologyEngine
                ? await this.isNodeRelevantWithOntology(node, originalMatches)
                : this.isNodeRelevant(node, originalMatches);

            if (isRelevant) {
                const astNode = this.createASTNode(node, filePath);

                // Enrich with concept information if available
                await this.enrichNodeWithConcept(astNode);

                result.nodes.push(astNode);
            }
        }
    }

    private async processFunctions(captures: any[], filePath: string, result: TreeSitterResult): Promise<void> {
        for (const capture of captures) {
            // Only use name captures to align ranges with identifier positions
            if (!capture?.name || !/(func\.name|method\.name|arrow\.name)$/.test(capture.name)) {
                continue;
            }
            const node = capture.node; // identifier node
            const astNode = this.createASTNode(node, filePath);

            // Function name is the captured identifier text
            const functionName = node.text;
            // Parameters/returnType not available from name node; skip heavy traversal here

            const existingMetadata = astNode.metadata || {};
            astNode.metadata = {
                ...existingMetadata,
                functionName,
            };

            await this.enrichNodeWithConcept(astNode);
            result.nodes.push(astNode);
        }
    }

    private async processClasses(captures: any[], filePath: string, result: TreeSitterResult): Promise<void> {
        for (const capture of captures) {
            // Only use class name captures to align ranges
            if (!capture?.name || !/class\.name$/.test(capture.name)) {
                continue;
            }
            const node = capture.node; // identifier or type_identifier node
            const astNode = this.createASTNode(node, filePath);

            const className = node.text;
            const existingMetadata = astNode.metadata || {};
            astNode.metadata = {
                ...existingMetadata,
                className,
            };

            await this.enrichNodeWithConcept(astNode);
            result.nodes.push(astNode);
        }
    }

    private processImportsExports(imports: any[], exports: any[], filePath: string, result: TreeSitterResult): void {
        // Process imports
        for (const capture of imports) {
            const node = capture.node;
            const importInfo = this.extractImportInfo(node);

            if (importInfo) {
                // Create relationship
                result.relationships.push({
                    from: filePath,
                    to: importInfo.source,
                    type: 'imports',
                    confidence: 1.0,
                    location: `${filePath}:${node.startPosition.row + 1}`,
                });
            }
        }

        // Process exports
        for (const capture of exports) {
            const node = capture.node;
            const exportInfo = this.extractExportInfo(node);

            if (exportInfo) {
                const astNode = this.createASTNode(node, filePath);
                astNode.metadata.exports = [exportInfo];
                result.nodes.push(astNode);
            }
        }
    }

    private processRelationships(calls: any[], references: any[], filePath: string, result: TreeSitterResult): void {
        // Process function calls (use capture names directly; also record identifier nodes for validation)
        for (const capture of calls) {
            const node = capture.node;
            const cap = capture.name || '';
            if (cap.endsWith('call.func') || cap.endsWith('call.method')) {
                const target = node.text;
                if (target) {
                    result.relationships.push({
                        from: filePath,
                        to: target,
                        type: 'calls',
                        confidence: 0.9,
                        location: `${filePath}:${node.startPosition.row + 1}`,
                    });
                    // Also push an AST node for the identifier itself to help reference validation
                    const astNode = this.createASTNode(node, filePath);
                    // Mark minimal metadata
                    astNode.metadata = { ...(astNode.metadata || {}), functionName: target } as any;
                    result.nodes.push(astNode);
                }
            }
        }

        // Process references (member expressions)
        for (const capture of references) {
            const node = capture.node;
            const refInfo = this.extractReferenceInfo(node);

            if (refInfo) {
                result.relationships.push({
                    from: filePath,
                    to: refInfo.target,
                    type: 'references',
                    confidence: 0.8,
                    location: `${filePath}:${node.startPosition.row + 1}`,
                });
                // Push identifier/property nodes as AST nodes for validation when applicable
                const cap = capture.name || '';
                if (cap.endsWith('ref.object') || cap.endsWith('ref.property')) {
                    const idNode = this.createASTNode(node, filePath);
                    idNode.metadata = { ...(idNode.metadata || {}) } as any;
                    result.nodes.push(idNode);
                }
            }
        }
    }

    private createASTNode(node: SyntaxNode, filePath: string): ASTNode {
        return {
            id: `${filePath}:${node.startPosition.row}:${node.startPosition.column}`,
            type: node.type,
            text: node.text,
            range: {
                start: {
                    line: node.startPosition.row,
                    character: node.startPosition.column,
                },
                end: {
                    line: node.endPosition.row,
                    character: node.endPosition.column,
                },
            },
            children: node.children.map(
                (child) => `${filePath}:${child.startPosition.row}:${child.startPosition.column}`
            ),
            parent: node.parent
                ? `${filePath}:${node.parent.startPosition.row}:${node.parent.startPosition.column}`
                : undefined,
            metadata: {},
        };
    }

    private isNodeRelevant(node: SyntaxNode, originalMatches: EnhancedMatches): boolean {
        const nodeText = node.text.toLowerCase();

        // Check if node text matches any of our search terms
        // Safely handle spread operations with null/undefined checks
        const exactMatches = originalMatches.exact || [];
        const fuzzyMatches = originalMatches.fuzzy || [];
        const conceptualMatches = originalMatches.conceptual || [];
        const allMatches = [...exactMatches, ...fuzzyMatches, ...conceptualMatches];

        return allMatches.some(
            (match) => nodeText.includes(match.text.toLowerCase()) || match.text.toLowerCase().includes(nodeText)
        );
    }

    private findDesignPatterns(nodes: ASTNode[]): DesignPattern[] {
        const patterns: DesignPattern[] = [];

        // Factory pattern detection
        const factoryPattern = this.detectFactoryPattern(nodes);
        if (factoryPattern) {
            patterns.push(factoryPattern);
        }

        // Singleton pattern detection
        const singletonPattern = this.detectSingletonPattern(nodes);
        if (singletonPattern) {
            patterns.push(singletonPattern);
        }

        // Observer pattern detection
        const observerPattern = this.detectObserverPattern(nodes);
        if (observerPattern) {
            patterns.push(observerPattern);
        }

        return patterns;
    }

    private detectFactoryPattern(nodes: ASTNode[]): DesignPattern | null {
        // Look for functions that create and return new objects
        const factoryNodes = nodes.filter((node) => {
            return (
                node.type === 'function_declaration' &&
                node.metadata.functionName &&
                (node.metadata.functionName.toLowerCase().includes('create') ||
                    node.metadata.functionName.toLowerCase().includes('make') ||
                    node.metadata.functionName.toLowerCase().includes('factory')) &&
                node.text.includes('new ') &&
                node.text.includes('return')
            );
        });

        if (factoryNodes.length > 0) {
            return {
                name: 'Factory',
                type: 'factory',
                confidence: 0.8,
                nodes: factoryNodes.map((n) => n.id),
                description: 'Factory pattern detected: functions that create and return objects',
            };
        }

        return null;
    }

    private detectSingletonPattern(nodes: ASTNode[]): DesignPattern | null {
        // Look for classes with getInstance method and private constructor
        const classes = nodes.filter((node) => node.type === 'class_declaration');

        for (const classNode of classes) {
            const hasGetInstance = nodes.some(
                (node) => node.parent === classNode.id && node.metadata.functionName === 'getInstance'
            );

            const hasPrivateConstructor = nodes.some(
                (node) =>
                    node.parent === classNode.id &&
                    node.type === 'method_definition' &&
                    node.text.includes('private') &&
                    node.text.includes('constructor')
            );

            if (hasGetInstance && hasPrivateConstructor) {
                return {
                    name: 'Singleton',
                    type: 'singleton',
                    confidence: 0.9,
                    nodes: [classNode.id],
                    description: 'Singleton pattern detected: class with getInstance method and private constructor',
                };
            }
        }

        return null;
    }

    private detectObserverPattern(nodes: ASTNode[]): DesignPattern | null {
        // Look for subscribe/unsubscribe methods and notify functionality
        const hasSubscribe = nodes.some(
            (node) =>
                node.metadata.functionName?.toLowerCase().includes('subscribe') ||
                node.metadata.functionName?.toLowerCase().includes('listen')
        );

        const hasUnsubscribe = nodes.some(
            (node) =>
                node.metadata.functionName?.toLowerCase().includes('unsubscribe') ||
                node.metadata.functionName?.toLowerCase().includes('remove')
        );

        const hasNotify = nodes.some(
            (node) =>
                node.metadata.functionName?.toLowerCase().includes('notify') ||
                node.metadata.functionName?.toLowerCase().includes('emit') ||
                node.metadata.functionName?.toLowerCase().includes('broadcast')
        );

        if (hasSubscribe && hasUnsubscribe && hasNotify) {
            const observerNodes = nodes.filter(
                (node) =>
                    node.metadata.functionName &&
                    (node.metadata.functionName.toLowerCase().includes('subscribe') ||
                        node.metadata.functionName.toLowerCase().includes('notify') ||
                        node.metadata.functionName.toLowerCase().includes('emit'))
            );

            return {
                name: 'Observer',
                type: 'observer',
                confidence: 0.8,
                nodes: observerNodes.map((n) => n.id),
                description: 'Observer pattern detected: subscribe/notify functionality',
            };
        }

        return null;
    }

    // Utility methods
    private sortFilesByRelevance(files: string[], matches: EnhancedMatches): string[] {
        const fileScores = new Map<string, number>();

        // Score files based on match quality and quantity
        // Safely handle arrays that might be null/undefined
        const exactMatches = matches.exact || [];
        const fuzzyMatches = matches.fuzzy || [];
        const conceptualMatches = matches.conceptual || [];

        for (const file of files) {
            let score = 0;

            // Exact matches get highest score
            score += exactMatches.filter((m) => m && m.file === file).length * 10;

            // Fuzzy matches get medium score
            score += fuzzyMatches.filter((m) => m && m.file === file).length * 5;

            // Conceptual matches get lower score
            score += conceptualMatches.filter((m) => m && m.file === file).length * 2;

            // Prefer certain file types
            if (file.endsWith('.ts') || file.endsWith('.tsx')) score += 2;
            if (file.endsWith('.js') || file.endsWith('.jsx')) score += 1;

            // Prefer non-test files
            if (!file.includes('test') && !file.includes('spec')) score += 1;

            fileScores.set(file, score);
        }

        return files.sort((a, b) => (fileScores.get(b) || 0) - (fileScores.get(a) || 0));
    }

    private getLanguageFromFile(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();

        switch (ext) {
            case '.ts':
            case '.tsx':
                return 'typescript';
            case '.js':
            case '.jsx':
                return 'javascript';
            case '.py':
                return 'python';
            default:
                return 'typescript'; // Default fallback
        }
    }

    private parseSize(sizeString: string): number {
        const match = sizeString.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
        if (!match) return 1024 * 1024; // Default 1MB

        const value = parseFloat(match[1]);
        const unit = (match[2] || 'B').toUpperCase();

        const multipliers: Record<string, number> = {
            B: 1,
            KB: 1024,
            MB: 1024 * 1024,
            GB: 1024 * 1024 * 1024,
        };

        return value * (multipliers[unit] || 1);
    }

    private findChildByType(node: SyntaxNode, type: string): SyntaxNode | null {
        for (const child of node.children) {
            if (child.type === type) {
                return child;
            }
        }
        return null;
    }

    private extractParameters(node: SyntaxNode): string[] {
        const params: string[] = [];
        const paramsNode = this.findChildByType(node, 'formal_parameters') || this.findChildByType(node, 'parameters');

        if (paramsNode) {
            for (const child of paramsNode.children) {
                if (child.type === 'required_parameter' || child.type === 'parameter') {
                    const paramName = this.findChildByType(child, 'identifier')?.text;
                    if (paramName) {
                        params.push(paramName);
                    }
                }
            }
        }

        return params;
    }

    private extractReturnType(node: SyntaxNode): string | undefined {
        const returnTypeNode = this.findChildByType(node, 'type_annotation');
        return returnTypeNode?.text.replace(/^:\s*/, '');
    }

    private extractExtendsClause(node: SyntaxNode): string | undefined {
        const heritageNode = this.findChildByType(node, 'class_heritage');
        if (heritageNode) {
            const extendsNode = this.findChildByType(heritageNode, 'extends_clause');
            if (extendsNode) {
                const identifierNode =
                    this.findChildByType(extendsNode, 'identifier') ||
                    this.findChildByType(extendsNode, 'type_identifier');
                return identifierNode?.text;
            }
        }
        return undefined;
    }

    private extractImplementsClause(node: SyntaxNode): string[] {
        const implementsList: string[] = [];
        const heritageNode = this.findChildByType(node, 'class_heritage');

        if (heritageNode) {
            const implementsNode = this.findChildByType(heritageNode, 'implements_clause');
            if (implementsNode) {
                for (const child of implementsNode.children) {
                    if (child.type === 'type_identifier') {
                        implementsList.push(child.text);
                    }
                }
            }
        }

        return implementsList;
    }

    private extractImportInfo(node: SyntaxNode): { source: string; specifiers: string[] } | null {
        const sourceNode = this.findChildByType(node, 'string');
        if (!sourceNode) return null;

        const source = sourceNode.text.replace(/['"]/g, '');
        const specifiers: string[] = [];

        // Extract import specifiers
        const importClause = this.findChildByType(node, 'import_clause');
        if (importClause) {
            for (const child of importClause.children) {
                if (child.type === 'identifier') {
                    specifiers.push(child.text);
                }
            }
        }

        return { source, specifiers };
    }

    private extractExportInfo(node: SyntaxNode): { name: string; type: 'default' | 'named' } | null {
        // This is a simplified implementation
        const nameNode = this.findChildByType(node, 'identifier') || this.findChildByType(node, 'type_identifier');

        if (!nameNode) return null;

        const isDefault = node.text.includes('export default');

        return {
            name: nameNode.text,
            type: isDefault ? 'default' : 'named',
        };
    }

    private extractCallInfo(node: SyntaxNode): { target: string } | null {
        const funcNode = this.findChildByType(node, 'identifier');
        if (funcNode) {
            return { target: funcNode.text };
        }

        // Handle member expressions (obj.method())
        const memberNode = this.findChildByType(node, 'member_expression');
        if (memberNode) {
            const objectNode = this.findChildByType(memberNode, 'identifier');
            const propertyNode = this.findChildByType(memberNode, 'property_identifier');

            if (objectNode && propertyNode) {
                return { target: `${objectNode.text}.${propertyNode.text}` };
            }
        }

        return null;
    }

    private extractReferenceInfo(node: SyntaxNode): { target: string } | null {
        const objectNode = this.findChildByType(node, 'identifier');
        const propertyNode = this.findChildByType(node, 'property_identifier');

        if (objectNode && propertyNode) {
            return { target: `${objectNode.text}.${propertyNode.text}` };
        } else if (objectNode) {
            return { target: objectNode.text };
        }

        return null;
    }

    /**
     * Get concept information from the ontology engine
     */
    async getConcept(identifier: string): Promise<Concept | null> {
        if (!this.ontologyEngine) {
            console.warn('Ontology engine not available for getConcept');
            return null;
        }

        try {
            return await this.ontologyEngine.findConcept(identifier);
        } catch (error) {
            console.warn(`Failed to get concept for ${identifier}:`, error);
            return null;
        }
    }

    /**
     * Enhanced node relevance check using ontology concepts
     */
    private async isNodeRelevantWithOntology(node: SyntaxNode, originalMatches: EnhancedMatches): Promise<boolean> {
        // First check basic relevance
        const basicRelevance = this.isNodeRelevant(node, originalMatches);
        if (basicRelevance) return true;

        // If ontology engine is available, check semantic relevance
        if (this.ontologyEngine && node.text) {
            const concept = await this.getConcept(node.text);
            if (concept) {
                // Check if any of the search terms are related to this concept
                const exactMatches = originalMatches.exact || [];
                const fuzzyMatches = originalMatches.fuzzy || [];
                const conceptualMatches = originalMatches.conceptual || [];
                const allMatches = [...exactMatches, ...fuzzyMatches, ...conceptualMatches];

                for (const match of allMatches) {
                    if (match?.text) {
                        const relatedConcept = await this.getConcept(match.text);
                        if (relatedConcept) {
                            // Check if concepts are related
                            const relatedConcepts = this.ontologyEngine.getRelatedConcepts(concept.id);
                            if (relatedConcepts.some((rc) => rc.concept.id === relatedConcept.id)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }

        return false;
    }

    /**
     * Add concept metadata to AST nodes when ontology engine is available
     */
    private async enrichNodeWithConcept(astNode: ASTNode): Promise<void> {
        if (!this.ontologyEngine || !astNode.text) return;

        try {
            const concept = await this.getConcept(astNode.text);
            if (concept) {
                const existingMetadata = astNode.metadata || {};
                astNode.metadata = {
                    ...existingMetadata,
                    conceptId: concept.id,
                    conceptName: concept.canonicalName,
                    conceptConfidence: concept.confidence,
                    semanticType: concept.type,
                };
            }
        } catch (error) {
            console.warn(`Failed to enrich node with concept for ${astNode.text}:`, error);
        }
    }
}
