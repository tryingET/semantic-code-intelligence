export type HttpOpenApiResponse = { status: number; headers: Record<string, string>; body: string };

export function createOpenApiResponse(apiVersion?: string): HttpOpenApiResponse {
    const ver = apiVersion || 'v1';
    const api = (p: string) => `/api/${ver}${p}`;
    const spec: any = {
        openapi: '3.0.0',
        info: {
            title: 'Semantic Code Intelligence HTTP API',
            version: ver,
            description: 'REST API for ontology-enhanced language server functionality',
        },
        servers: [{ url: 'http://localhost:7000' }],
        components: {
            schemas: {
                PipelineStatus: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        trigger: { type: 'string' },
                        schedule: { type: 'string', nullable: true },
                        enabled: { type: 'boolean' },
                        lastRunAt: { type: 'integer', nullable: true },
                        nextRunAt: { type: 'integer', nullable: true },
                        scheduleNote: { type: 'string', nullable: true },
                        stats: {
                            type: 'object',
                            properties: {
                                runsCompleted: { type: 'integer' },
                                runsSuccessful: { type: 'integer' },
                                averageRuntimeMs: { type: 'number' },
                                lastError: { type: 'string' },
                            },
                        },
                    },
                },
                PipelineRun: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        pipeline_id: { type: 'string' },
                        started_at: { type: 'integer' },
                        finished_at: { type: 'integer', nullable: true },
                        status: { type: 'string' },
                        metrics: { type: 'object' },
                    },
                    required: ['id', 'pipeline_id', 'started_at', 'status'],
                },
                LocateConfirmDefinitionResult: {
                    type: 'object',
                    properties: {
                        ok: { type: 'boolean' },
                        symbol: { type: 'string' },
                        attempts: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: { mode: { type: 'string' }, count: { type: 'integer' } },
                                required: ['mode', 'count'],
                            },
                        },
                        definitions: { type: 'array', items: { $ref: '#/components/schemas/Definition' } },
                        decision: { type: 'string' },
                    },
                    required: ['ok', 'symbol', 'attempts', 'definitions'],
                },
                SafeRenameResult: {
                    type: 'object',
                    properties: {
                        ok: { type: 'boolean' },
                        snapshot: { type: 'string' },
                        filesAffected: { type: 'integer' },
                        totalEdits: { type: 'integer' },
                        elapsedMs: { type: 'integer' },
                        outputTail: { type: 'string' },
                        next_actions: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['ok', 'snapshot'],
                },
                PatchChecksInSnapshotResult: {
                    type: 'object',
                    properties: {
                        ok: { type: 'boolean' },
                        snapshot: { type: 'string' },
                        stage: { type: 'object' },
                        checks: {
                            type: 'object',
                            properties: {
                                ok: { type: 'boolean' },
                                elapsedMs: { type: 'integer' },
                                output: { type: 'string' },
                                outputTail: { type: 'string' },
                            },
                        },
                    },
                    required: ['ok', 'snapshot'],
                },
                ToolCallRequest: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Registered tool/workflow name' },
                        arguments: { type: 'object', additionalProperties: true },
                    },
                    required: ['name'],
                },
                ToolCallResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        result: {
                            description: 'Normalized tool result (parsed JSON for workflows)',
                            additionalProperties: true,
                        },
                        error: {
                            type: 'object',
                            properties: { message: { type: 'string' } },
                        },
                    },
                    required: ['success'],
                },
                AstQueryResult: {
                    type: 'object',
                    properties: {
                        count: { type: 'integer' },
                        results: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    file: { type: 'string' },
                                    capture: { type: 'string' },
                                    start: { $ref: '#/components/schemas/Position' },
                                    end: { $ref: '#/components/schemas/Position' },
                                    snippet: { type: 'string' },
                                },
                                required: ['file', 'capture', 'start', 'end'],
                            },
                        },
                    },
                    required: ['count', 'results'],
                },
                GraphNeighbors: {
                    type: 'object',
                    properties: {
                        imports: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    capture: { type: 'string' },
                                    text: { type: 'string' },
                                    start: { $ref: '#/components/schemas/Position' },
                                    end: { $ref: '#/components/schemas/Position' },
                                },
                            },
                        },
                        exports: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    capture: { type: 'string' },
                                    text: { type: 'string' },
                                    start: { $ref: '#/components/schemas/Position' },
                                    end: { $ref: '#/components/schemas/Position' },
                                },
                            },
                        },
                        callees: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    start: { $ref: '#/components/schemas/Position' },
                                },
                            },
                        },
                        callers: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    file: { type: 'string' },
                                    start: { $ref: '#/components/schemas/Position' },
                                },
                            },
                        },
                    },
                },
                GraphExpandResult: {
                    type: 'object',
                    properties: {
                        file: { type: 'string' },
                        symbol: { type: 'string' },
                        neighbors: { $ref: '#/components/schemas/GraphNeighbors' },
                        note: { type: 'string' },
                    },
                    anyOf: [{ required: ['file'] }, { required: ['symbol'] }],
                },
                Position: {
                    type: 'object',
                    properties: { line: { type: 'integer' }, character: { type: 'integer' } },
                    required: ['line', 'character'],
                },
                Range: {
                    type: 'object',
                    properties: {
                        start: { $ref: '#/components/schemas/Position' },
                        end: { $ref: '#/components/schemas/Position' },
                    },
                    required: ['start', 'end'],
                },
                Definition: {
                    type: 'object',
                    properties: {
                        uri: { type: 'string' },
                        range: { $ref: '#/components/schemas/Range' },
                        kind: { type: 'string' },
                        name: { type: 'string' },
                        confidence: { type: 'number' },
                        source: { type: 'string' },
                        layer: { type: 'string' },
                    },
                    required: ['uri', 'range', 'kind', 'confidence'],
                },
                Reference: {
                    type: 'object',
                    properties: {
                        uri: { type: 'string' },
                        range: { $ref: '#/components/schemas/Range' },
                        kind: { type: 'string' },
                        confidence: { type: 'number' },
                        source: { type: 'string' },
                        layer: { type: 'string' },
                    },
                    required: ['uri', 'range', 'kind', 'confidence'],
                },
                Completion: {
                    type: 'object',
                    properties: {
                        label: { type: 'string' },
                        kind: { type: 'number' },
                        detail: { type: 'string' },
                        documentation: { type: 'string' },
                        confidence: { type: 'number' },
                    },
                    required: ['label', 'kind', 'confidence'],
                },
                WorkspaceEdit: {
                    type: 'object',
                    properties: {
                        changes: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    file: { type: 'string' },
                                    edits: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                range: { $ref: '#/components/schemas/Range' },
                                                newText: { type: 'string' },
                                            },
                                            required: ['range', 'newText'],
                                        },
                                    },
                                },
                            },
                        },
                        summary: {
                            type: 'object',
                            properties: { filesAffected: { type: 'integer' }, totalEdits: { type: 'integer' } },
                        },
                    },
                },
                ExploreResult: {
                    type: 'object',
                    properties: {
                        symbol: { type: 'string' },
                        contextUri: { type: 'string' },
                        definitions: { type: 'array', items: { $ref: '#/components/schemas/Definition' } },
                        references: { type: 'array', items: { $ref: '#/components/schemas/Reference' } },
                        performance: { type: 'object' },
                        timestamp: { type: 'integer' },
                    },
                },
                ApiResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        data: {},
                        performance: { type: 'object' },
                        requestId: { type: 'string' },
                        timestamp: { type: 'integer' },
                        cacheHit: { type: 'boolean' },
                    },
                    required: ['success'],
                },
                ErrorResponse: {
                    type: 'object',
                    properties: { success: { type: 'boolean' }, error: { type: 'string' }, details: {} },
                    required: ['success', 'error'],
                },
            },
        },
        paths: {
            [api('/tools/call')]: {
                post: {
                    summary: 'Execute an Alpha MVP tool (MCP/CLI parity)',
                    description:
                        'Generic Alpha MVP tools endpoint. Body provides the contract-supported tool name and arguments; registered legacy, pipeline, diagnostic, or compatibility tools are intentionally not exposed here.',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/ToolCallRequest' } },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ToolCallResponse' },
                                    examples: {
                                        read_file: {
                                            summary: 'Read a bounded workspace file range',
                                            value: {
                                                success: true,
                                                result: {
                                                    path: 'docs/project/alpha-mvp-contract.md',
                                                    range: { startLine: 1, endLine: 8 },
                                                    content: '---\nsummary: "Alpha MVP contract..."',
                                                    truncated: false,
                                                },
                                            },
                                        },
                                        safe_write_preview: {
                                            summary: 'Preview/check a patch without mutating the working tree',
                                            value: {
                                                success: true,
                                                result: {
                                                    workflow: 'safe_write',
                                                    ok: true,
                                                    mode: 'preview_validate',
                                                    snapshot: '<snapshot-id>',
                                                    applied: false,
                                                },
                                            },
                                        },
                                        patch_checks_in_snapshot: {
                                            summary: 'Patch + checks in snapshot',
                                            value: {
                                                success: true,
                                                result: {
                                                    $schema: '#/components/schemas/PatchChecksInSnapshotResult',
                                                    ok: true,
                                                    snapshot: '<snapshot-id>',
                                                    stage: { accepted: true, diffCount: 1 },
                                                    checks: {
                                                        ok: true,
                                                        elapsedMs: 640,
                                                        outputTail: '...last lines of checks...',
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        '400': {
                            description: 'Bad Request',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/explore')]: {
                post: {
                    summary: 'Explore codebase: aggregate definitions and references',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['identifier'],
                                    properties: {
                                        identifier: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        includeDeclaration: { type: 'boolean' },
                                        maxResults: { type: 'integer' },
                                        precise: { type: 'boolean' },
                                        conceptual: {
                                            type: 'boolean',
                                            description: 'Include Layer 4 conceptual hints if available',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'object',
                                                        properties: {
                                                            symbol: { type: 'string' },
                                                            contextUri: { type: 'string' },
                                                            definitions: {
                                                                type: 'array',
                                                                items: { $ref: '#/components/schemas/Definition' },
                                                            },
                                                            references: {
                                                                type: 'array',
                                                                items: { $ref: '#/components/schemas/Reference' },
                                                            },
                                                            performance: { type: 'object' },
                                                            diagnostics: { type: 'object' },
                                                            timestamp: { type: 'number' },
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': {
                            description: 'Bad Request',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/definition')]: {
                post: {
                    summary: 'Find symbol definitions',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['identifier'],
                                    properties: {
                                        identifier: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        position: { $ref: '#/components/schemas/Position' },
                                        maxResults: { type: 'integer' },
                                        includeDeclaration: { type: 'boolean' },
                                        precise: {
                                            type: 'boolean',
                                            description: 'Run a quick AST validation pass',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'array',
                                                        items: { $ref: '#/components/schemas/Definition' },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': {
                            description: 'Bad Request',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/ast-query')]: {
                post: {
                    summary: 'Run a Tree-sitter s-expression query over selected files',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['language', 'query'],
                                    properties: {
                                        language: { type: 'string', enum: ['typescript', 'javascript', 'python'] },
                                        query: { type: 'string' },
                                        paths: { type: 'array', items: { type: 'string' } },
                                        glob: { type: 'string' },
                                        limit: { type: 'integer' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: { $ref: '#/components/schemas/AstQueryResult' },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
            [api('/graph-expand')]: {
                post: {
                    summary: 'Expand neighbors for a file or symbol (imports/exports; callers/callees best-effort)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    anyOf: [{ required: ['file'] }, { required: ['symbol'] }],
                                    properties: {
                                        file: { type: 'string' },
                                        symbol: { type: 'string' },
                                        edges: {
                                            type: 'array',
                                            items: {
                                                type: 'string',
                                                enum: ['imports', 'exports', 'callers', 'callees'],
                                            },
                                        },
                                        depth: {
                                            type: 'integer',
                                            description:
                                                'Reserved for future recursive expansion; current graph_expand returns one-hop evidence.',
                                        },
                                        limit: { type: 'integer' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: { $ref: '#/components/schemas/GraphExpandResult' },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
            [api('/pipelines/status')]: {
                get: {
                    summary: 'Get pipeline status',
                    parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string' } }],
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: { $ref: '#/components/schemas/PipelineStatus' },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': { description: 'Bad Request' },
                    },
                },
            },
            [api('/pipelines/runs')]: {
                get: {
                    summary: 'List recent pipeline runs',
                    parameters: [
                        { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                        {
                            name: 'limit',
                            in: 'query',
                            required: false,
                            schema: { type: 'integer', minimum: 1, maximum: 100 },
                        },
                    ],
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'object',
                                                        properties: {
                                                            runs: {
                                                                type: 'array',
                                                                items: { $ref: '#/components/schemas/PipelineRun' },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': { description: 'Bad Request' },
                    },
                },
            },
            [api('/pipelines/run-stream')]: {
                post: {
                    summary: 'Start a pipeline run and stream status events (NDJSON)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id'],
                                    properties: {
                                        id: { type: 'string' },
                                        timeoutSec: { type: 'integer', minimum: 1, maximum: 600 },
                                        pollMs: { type: 'integer', minimum: 100, maximum: 2000 },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'NDJSON events: started, status, finished or timeout',
                            content: {
                                'application/x-ndjson': {
                                    schema: { type: 'string' },
                                },
                            },
                        },
                        '400': { description: 'Bad Request' },
                    },
                },
            },
            [api('/pipelines/run')]: {
                get: {
                    summary: 'Get a specific pipeline run detail (poll-once)',
                    parameters: [
                        { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'runId', in: 'query', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'object',
                                                        properties: {
                                                            pipelineId: { type: 'string' },
                                                            runId: { type: 'string' },
                                                            run: {
                                                                oneOf: [
                                                                    { $ref: '#/components/schemas/PipelineRun' },
                                                                    { type: 'null' },
                                                                ],
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': { description: 'Bad Request' },
                    },
                },
                post: {
                    summary: 'Start a pipeline run (non-streaming)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id'],
                                    properties: { id: { type: 'string' } },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'object',
                                                        properties: {
                                                            ok: { type: 'boolean' },
                                                            runId: { type: 'string' },
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': { description: 'Bad Request' },
                    },
                },
            },
            [api('/pipelines')]: {
                get: {
                    summary: 'List pipelines',
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'object',
                                                        properties: {
                                                            pipelines: {
                                                                type: 'array',
                                                                items: {
                                                                    type: 'object',
                                                                    properties: {
                                                                        id: { type: 'string' },
                                                                        name: { type: 'string' },
                                                                        trigger: { type: 'string' },
                                                                        schedule: {
                                                                            type: 'string',
                                                                            nullable: true,
                                                                        },
                                                                        enabled: { type: 'boolean' },
                                                                    },
                                                                    required: ['id', 'name', 'trigger', 'enabled'],
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                post: {
                    summary: 'Register a learning pipeline (dev-only)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'name', 'components', 'trigger'],
                                    properties: {
                                        id: { type: 'string' },
                                        name: { type: 'string' },
                                        description: { type: 'string' },
                                        components: {
                                            type: 'array',
                                            items: {
                                                type: 'string',
                                                enum: [
                                                    'pattern_learning',
                                                    'feedback_loop',
                                                    'evolution_tracking',
                                                    'team_knowledge',
                                                ],
                                            },
                                        },
                                        trigger: {
                                            type: 'string',
                                            enum: ['manual', 'automatic', 'scheduled', 'event_driven'],
                                        },
                                        schedule: { type: 'string' },
                                        eventTriggers: { type: 'array', items: { type: 'string' } },
                                        enabled: { type: 'boolean' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'object',
                                                        properties: { id: { type: 'string' } },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': { description: 'Bad Request' },
                    },
                },
            },
            [api('/pipelines/{id}')]: {
                get: {
                    summary: 'Get pipeline by id (status/detail)',
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: { $ref: '#/components/schemas/PipelineStatus' },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': { description: 'Bad Request' },
                    },
                },
            },
            [api('/snapshots')]: {
                get: {
                    summary: 'List snapshots (id, createdAt, diffCount)',
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'object',
                                                            properties: {
                                                                id: { type: 'string' },
                                                                createdAt: { type: 'integer' },
                                                                diffCount: { type: 'integer' },
                                                            },
                                                            required: ['id', 'createdAt'],
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
            [api('/snapshots/clean')]: {
                post: {
                    summary: 'Cleanup materialized snapshots (.ontology/snapshots) with retention limits',
                    requestBody: {
                        required: false,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: { maxKeep: { type: 'integer' }, maxAgeDays: { type: 'integer' } },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'OK',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/references')]: {
                post: {
                    summary: 'Find symbol references',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['identifier'],
                                    properties: {
                                        identifier: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        position: { $ref: '#/components/schemas/Position' },
                                        maxResults: { type: 'integer' },
                                        includeDeclaration: { type: 'boolean' },
                                        precise: {
                                            type: 'boolean',
                                            description: 'Run a quick AST validation pass',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'array',
                                                        items: { $ref: '#/components/schemas/Reference' },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        '400': {
                            description: 'Bad Request',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/rename')]: {
                post: {
                    summary: 'Preview a symbol rename (legacy endpoint; dryRun=false is rejected)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['newName'],
                                    anyOf: [{ required: ['identifier'] }, { required: ['oldName'] }],
                                    properties: {
                                        identifier: { type: 'string' },
                                        oldName: { type: 'string', description: 'MCP-compatible alias for identifier' },
                                        newName: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        dryRun: {
                                            type: 'boolean',
                                            description: 'Legacy endpoint is preview-only; false is rejected',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/WorkspaceEdit' } },
                            },
                        },
                    },
                },
            },
            [api('/plan-rename')]: {
                post: {
                    summary: 'Preview a symbol rename without applying it',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['newName'],
                                    anyOf: [{ required: ['identifier'] }, { required: ['oldName'] }],
                                    properties: {
                                        identifier: { type: 'string' },
                                        oldName: { type: 'string', description: 'MCP-compatible alias for identifier' },
                                        newName: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Preview success',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/WorkspaceEdit' } },
                            },
                        },
                    },
                },
            },
            [api('/apply-rename')]: {
                post: {
                    summary: 'Disabled legacy mutation endpoint; use safe_write or apply_snapshot instead',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['newName'],
                                    anyOf: [{ required: ['identifier'] }, { required: ['oldName'] }],
                                    properties: {
                                        identifier: { type: 'string' },
                                        oldName: { type: 'string', description: 'MCP-compatible alias for identifier' },
                                        newName: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '400': { description: 'Disabled legacy mutation endpoint or Bad Request' },
                    },
                },
            },
            [api('/completions')]: {
                post: {
                    summary: 'Get completions at a position',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['file', 'position'],
                                    properties: {
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        position: { $ref: '#/components/schemas/Position' },
                                        triggerCharacter: { type: 'string' },
                                        maxResults: { type: 'integer' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': {
                                    schema: {
                                        allOf: [
                                            { $ref: '#/components/schemas/ApiResponse' },
                                            {
                                                type: 'object',
                                                properties: {
                                                    data: {
                                                        type: 'array',
                                                        items: { $ref: '#/components/schemas/Completion' },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
            [api('/symbol-map')]: {
                post: {
                    summary: 'Build a targeted symbol map',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    anyOf: [{ required: ['identifier'] }, { required: ['symbol'] }],
                                    properties: {
                                        identifier: { type: 'string' },
                                        symbol: { type: 'string', description: 'MCP-compatible alias for identifier' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        maxFiles: { type: 'integer' },
                                        astOnly: { type: 'boolean' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/explore')]: {
                post: {
                    summary: 'Explore codebase (definitions + references)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    anyOf: [{ required: ['identifier'] }, { required: ['symbol'] }],
                                    properties: {
                                        identifier: { type: 'string' },
                                        symbol: { type: 'string', description: 'MCP-compatible alias for identifier' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        includeDeclaration: { type: 'boolean' },
                                        precise: {
                                            type: 'boolean',
                                            description: 'Run a quick AST validation pass',
                                        },
                                        maxResults: { type: 'integer' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ExploreResult' } },
                            },
                        },
                    },
                },
            },
            [api('/stats')]: {
                get: {
                    summary: 'Get system diagnostics and status',
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/learning-stats')]: {
                get: {
                    summary: 'Get learning/pattern stats (Layer 5 summary)',
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/monitoring')]: {
                get: {
                    summary: 'Get monitoring metrics',
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } },
                            },
                        },
                    },
                },
            },
            [api('/stream/search')]: {
                post: {
                    summary: 'Streaming search results (SSE)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['pattern'],
                                    properties: {
                                        pattern: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        maxResults: { type: 'integer' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Event stream',
                            content: { 'text/event-stream': { schema: { type: 'string' } } },
                        },
                    },
                },
            },
            [api('/stream/definition')]: {
                post: {
                    summary: 'Streaming definition results (SSE)',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['identifier'],
                                    properties: {
                                        identifier: { type: 'string' },
                                        file: { type: 'string' },
                                        uri: { type: 'string' },
                                        position: { $ref: '#/components/schemas/Position' },
                                        maxResults: { type: 'integer' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Event stream',
                            content: { 'text/event-stream': { schema: { type: 'string' } } },
                        },
                    },
                },
            },
            '/health': {
                get: { summary: 'Service health', responses: { '200': { description: 'Healthy' } } },
            },
        },
    };

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec, null, 2),
    };
}
