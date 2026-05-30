import type { ToolSpec } from './registry.js';

export const LEGACY_TOOL_SPECS: ToolSpec[] = [
{
            name: 'list_files',
            description: 'List files under workspace with ignore rules',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    maxFiles: { type: 'number' },
                    depth: { type: 'number' },
                },
            },
        },
{
            name: 'get_completions',
            description: 'Get code completions (pattern/ontology-driven)',
            inputSchema: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    position: {
                        type: 'object',
                        properties: { line: { type: 'number', minimum: 0 }, character: { type: 'number', minimum: 0 } },
                        required: ['line', 'character'],
                    },
                    maxResults: { type: 'number' },
                },
                required: ['file', 'position'],
            },
        },
{
            name: 'list_symbols',
            description: 'List symbols in a file (bounded)',
            inputSchema: {
                type: 'object',
                properties: { file: { type: 'string' } },
                required: ['file'],
            },
        },
{
            name: 'list_pipelines',
            description: 'List learning pipelines (id, name, trigger, schedule, enabled)',
            inputSchema: { type: 'object', properties: {} },
        },
{
            name: 'run_pipeline',
            description: 'Run a learning pipeline by id and return a run id',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
            },
        },
{
            name: 'list_pipeline_runs',
            description: 'List recent runs for a learning pipeline',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' }, limit: { type: 'number', default: 10 } },
                required: ['id'],
            },
        },
{
            name: 'pipeline_status',
            description: 'Get status for a learning pipeline',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
            },
        },
{
            name: 'diagnostics',
            description: 'Get analyzer diagnostics and health information',
            inputSchema: { type: 'object', properties: {} },
        },
{
            name: 'pattern_stats',
            description: 'Pattern learning statistics snapshot',
            inputSchema: { type: 'object', properties: {} },
        },
{
            name: 'generate_tests',
            description: 'Generate tests (stub) based on code understanding and patterns',
            inputSchema: {
                type: 'object',
                properties: {
                    target: { type: 'string' },
                    framework: {
                        type: 'string',
                        enum: ['bun', 'jest', 'vitest', 'mocha', 'auto'],
                        default: 'auto',
                    },
                    coverage: {
                        type: 'string',
                        enum: ['basic', 'comprehensive', 'edge-cases'],
                        default: 'comprehensive',
                    },
                },
                required: ['target'],
            },
        },
{
            name: 'suggest_refactoring',
            description: 'Suggest refactoring opportunities (legacy compatibility stub)',
            inputSchema: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                },
            },
        },
{
            name: 'knowledge_insights',
            description: 'Knowledge propagation / learning insights snapshot',
            inputSchema: { type: 'object', properties: {} },
        },
{
            name: 'cache_controls',
            description: 'Warm or clear internal caches',
            inputSchema: {
                type: 'object',
                properties: { action: { type: 'string', enum: ['warm', 'clear'] } },
                required: ['action'],
            },
        }
];
