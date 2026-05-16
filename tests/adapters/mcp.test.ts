/**
 * MCP Adapter Integration Tests
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { MCPAdapter } from '../../adapters/mcp/index.js';
import { MCPTranslator } from '../../adapters/mcp/translator.js';
import { MCP_TOOLS } from '../../adapters/mcp/tools.js';

describe('MCP Adapter', () => {
    let adapter: MCPAdapter;
    let translator: MCPTranslator;

    beforeEach(() => {
        // Note: In real tests, we'd mock the core analyzer
        // For now, we're testing the adapter structure
        translator = new MCPTranslator();
    });

    describe('Tool Definitions', () => {
        test('should define all required tools', () => {
            const toolNames = MCP_TOOLS.map((t) => t.name);

            expect(toolNames).toContain('find_definition');
            expect(toolNames).toContain('find_references');
            expect(toolNames).toContain('find_implementations');
            expect(toolNames).toContain('get_hover');
            expect(toolNames).toContain('get_completions');
            expect(toolNames).toContain('rename_symbol');
            expect(toolNames).toContain('get_diagnostics');
            expect(toolNames).toContain('learn_pattern');
            expect(toolNames).toContain('provide_feedback');
        });

        test('each tool should have valid schema', () => {
            for (const tool of MCP_TOOLS) {
                expect(tool.name).toBeTruthy();
                expect(tool.description).toBeTruthy();
                expect(tool.inputSchema).toBeTruthy();
                expect(tool.inputSchema.type).toBe('object');
                expect(tool.inputSchema.properties).toBeTruthy();
            }
        });
    });

    describe('Translation Layer', () => {
        test('should translate find_definition request correctly', () => {
            const mcpRequest = {
                symbol: 'TestClass',
                file: '/path/to/file.ts',
                line: 10,
                column: 5,
            };

            const coreRequest = translator.translateFindDefinitionRequest(mcpRequest);

            expect(coreRequest.symbol).toBe('TestClass');
            expect(coreRequest.location?.uri).toBe('/path/to/file.ts');
            expect(coreRequest.location?.line).toBe(10);
            expect(coreRequest.location?.column).toBe(5);
        });

        test('should translate find_definition response correctly', () => {
            const coreResponse = {
                definitions: [
                    {
                        location: {
                            uri: '/path/to/def.ts',
                            line: 20,
                            column: 10,
                        },
                        kind: 5, // Class
                        name: 'TestClass',
                        detail: 'class TestClass',
                        documentation: 'Test class documentation',
                        confidence: 0.9,
                    },
                ],
                confidence: 0.9,
                source: ['search', 'ast'],
            };

            const mcpResponse = translator.translateFindDefinitionResponse(coreResponse);

            expect(mcpResponse.definitions).toHaveLength(1);
            expect(mcpResponse.definitions[0].file).toBe('/path/to/def.ts');
            expect(mcpResponse.definitions[0].line).toBe(20);
            expect(mcpResponse.definitions[0].name).toBe('TestClass');
            expect(mcpResponse.confidence).toBe(0.9);
            expect(mcpResponse.sources).toEqual(['search', 'ast']);
        });

        test('should handle empty results gracefully', () => {
            const emptyResult = {
                definitions: [],
                confidence: 0.3,
                source: ['search'],
            };

            const mcpResponse = translator.translateFindDefinitionResponse(emptyResult);

            expect(mcpResponse.message).toBe('No definitions found');
            expect(mcpResponse.confidence).toBe(0.3);
        });

        test('should translate find_references response with grouping', () => {
            const coreResponse = {
                references: [
                    {
                        location: { uri: '/file1.ts', line: 10, column: 5 },
                        kind: 'call' as const,
                        preview: '  result = TestClass.method()',
                        confidence: 0.8,
                    },
                    {
                        location: { uri: '/file1.ts', line: 20, column: 10 },
                        kind: 'import' as const,
                        preview: 'import { TestClass } from "./test"',
                        confidence: 0.9,
                    },
                    {
                        location: { uri: '/file2.ts', line: 5, column: 15 },
                        kind: 'type' as const,
                        preview: 'let instance: TestClass',
                        confidence: 0.85,
                    },
                ],
                total: 3,
                truncated: false,
            };

            const mcpResponse = translator.translateFindReferencesResponse(coreResponse);

            expect(mcpResponse.files).toHaveLength(2);
            expect(mcpResponse.files[0].file).toBe('/file1.ts');
            expect(mcpResponse.files[0].references).toHaveLength(2);
            expect(mcpResponse.files[1].file).toBe('/file2.ts');
            expect(mcpResponse.files[1].references).toHaveLength(1);
            expect(mcpResponse.totalReferences).toBe(3);
        });

        test('should translate rename response with preview', () => {
            const coreResponse = {
                edits: [
                    {
                        uri: '/file1.ts',
                        edits: [
                            {
                                range: {
                                    start: { uri: '', line: 10, column: 5 },
                                    end: { uri: '', line: 10, column: 15 },
                                },
                                newText: 'NewClassName',
                            },
                        ],
                    },
                    {
                        uri: '/file2.ts',
                        edits: [
                            {
                                range: {
                                    start: { uri: '', line: 5, column: 10 },
                                    end: { uri: '', line: 5, column: 20 },
                                },
                                newText: 'NewClassName',
                            },
                        ],
                    },
                ],
                affectedFiles: ['/file1.ts', '/file2.ts'],
                preview: 'Renaming 2 occurrences across 2 files',
            };

            const mcpResponse = translator.translateRenameResponse(coreResponse);

            expect(mcpResponse.files).toHaveLength(2);
            expect(mcpResponse.affectedFiles).toHaveLength(2);
            expect(mcpResponse.preview).toBe('Renaming 2 occurrences across 2 files');
            expect(mcpResponse.summary).toContain('2 files');
        });

        test('should translate diagnostics with severity grouping', () => {
            const coreResponse = {
                diagnostics: [
                    {
                        range: {
                            start: { uri: '', line: 10, column: 0 },
                            end: { uri: '', line: 10, column: 20 },
                        },
                        severity: 1, // Error
                        message: 'Undefined variable',
                        source: 'typescript',
                    },
                    {
                        range: {
                            start: { uri: '', line: 20, column: 0 },
                            end: { uri: '', line: 20, column: 10 },
                        },
                        severity: 2, // Warning
                        message: 'Unused variable',
                        source: 'typescript',
                    },
                ],
            };

            const mcpResponse = translator.translateDiagnosticResponse(coreResponse);

            expect(mcpResponse.diagnostics.errors).toHaveLength(1);
            expect(mcpResponse.diagnostics.warnings).toHaveLength(1);
            expect(mcpResponse.summary.total).toBe(2);
            expect(mcpResponse.summary.errors).toBe(1);
            expect(mcpResponse.summary.warnings).toBe(1);
        });
    });

    describe('Error Handling', () => {
        test('should format errors correctly', () => {
            const error = new Error('Test error message');
            const formatted = translator.formatError(error);

            expect(formatted.error).toBe(true);
            expect(formatted.message).toBe('Test error message');
        });
    });

    describe('Pattern Learning', () => {
        test('should translate pattern request correctly', () => {
            const mcpRequest = {
                code: 'function example() { return 42; }',
                action: 'create',
                context: 'Creating a new utility function',
            };

            const coreRequest = translator.translatePatternRequest(mcpRequest);

            expect(coreRequest.code).toBe(mcpRequest.code);
            expect(coreRequest.action).toBe('create');
        });

        test('should translate feedback request correctly', () => {
            const mcpRequest = {
                operationId: 'op_123',
                rating: 'positive',
                comment: 'Great suggestion!',
                suggestion: 'Maybe also include type hints',
            };

            const coreRequest = translator.translateFeedbackRequest(mcpRequest);

            expect(coreRequest.operationId).toBe('op_123');
            expect(coreRequest.rating).toBe('positive');
            expect(coreRequest.comment).toBe('Great suggestion!');
            expect(coreRequest.suggestion).toBe('Maybe also include type hints');
        });
    });

    describe('Knowledge Graph', () => {
        test('should translate concept request correctly', () => {
            const mcpRequest = {
                query: 'Controller',
                type: 'class',
                limit: 10,
            };

            const coreRequest = translator.translateConceptRequest(mcpRequest);

            expect(coreRequest.query).toBe('Controller');
            expect(coreRequest.type).toBe('class');
            expect(coreRequest.limit).toBe(10);
        });

        test('should translate concept response correctly', () => {
            const coreResponse = {
                concepts: [
                    {
                        id: 'concept_1',
                        name: 'UserController',
                        type: 'class' as const,
                        description: 'Handles user operations',
                        confidence: 0.85,
                    },
                ],
                total: 1,
                confidence: 0.85,
            };

            const mcpResponse = translator.translateConceptResponse(coreResponse);

            expect(mcpResponse.concepts).toHaveLength(1);
            expect(mcpResponse.concepts[0].name).toBe('UserController');
            expect(mcpResponse.averageConfidence).toBe(0.85);
        });

        test('should translate relationship response with grouping', () => {
            const coreResponse = {
                relationships: [
                    {
                        source: 'ClassA',
                        target: 'ClassB',
                        type: 'extends' as const,
                        confidence: 0.9,
                    },
                    {
                        source: 'ClassC',
                        target: 'InterfaceD',
                        type: 'implements' as const,
                        confidence: 0.85,
                    },
                    {
                        source: 'ClassE',
                        target: 'ClassF',
                        type: 'extends' as const,
                        confidence: 0.88,
                    },
                ],
                total: 3,
            };

            const mcpResponse = translator.translateRelationshipResponse(coreResponse);

            expect(mcpResponse.relationshipTypes).toHaveLength(2);
            expect(mcpResponse.total).toBe(3);

            const extendsType = mcpResponse.relationshipTypes.find((t) => t.type === 'extends');
            expect(extendsType?.count).toBe(2);

            const implementsType = mcpResponse.relationshipTypes.find((t) => t.type === 'implements');
            expect(implementsType?.count).toBe(1);
        });
    });

    describe('Workspace Context', () => {
        test('should extract workspace context from various formats', () => {
            const request1 = {
                symbol: 'test',
                workspace: '/path/to/workspace',
            };

            const context1 = translator.translateFindDefinitionRequest(request1).context;
            expect(context1?.rootUri).toBe('/path/to/workspace');

            const request2 = {
                symbol: 'test',
                rootUri: '/different/path',
            };

            const context2 = translator.translateFindDefinitionRequest(request2).context;
            expect(context2?.rootUri).toBe('/different/path');

            const request3 = {
                symbol: 'test',
            };

            const context3 = translator.translateFindDefinitionRequest(request3).context;
            expect(context3).toBeUndefined();
        });
    });
});

describe('MCP Tool Schemas', () => {
    test('find_definition schema should be valid', () => {
        const tool = MCP_TOOLS.find((t) => t.name === 'find_definition');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain('symbol');
        expect(tool?.inputSchema.properties.symbol.type).toBe('string');
    });

    test('rename_symbol schema should require symbol and newName', () => {
        const tool = MCP_TOOLS.find((t) => t.name === 'rename_symbol');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain('symbol');
        expect(tool?.inputSchema.required).toContain('newName');
    });

    test('get_hover schema should require all location fields', () => {
        const tool = MCP_TOOLS.find((t) => t.name === 'get_hover');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain('symbol');
        expect(tool?.inputSchema.required).toContain('file');
        expect(tool?.inputSchema.required).toContain('line');
        expect(tool?.inputSchema.required).toContain('column');
    });

    test('learn_pattern schema should have action enum', () => {
        const tool = MCP_TOOLS.find((t) => t.name === 'learn_pattern');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.properties.action.enum).toContain('create');
        expect(tool?.inputSchema.properties.action.enum).toContain('update');
        expect(tool?.inputSchema.properties.action.enum).toContain('delete');
    });
});
