// Minimal tool definitions to satisfy schema tests
export const MCP_TOOLS = [
  {
    name: 'find_definition',
    description: 'Find symbol definition',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, column: { type: 'number' } },
      required: ['symbol']
    }
  },
  {
    name: 'find_references',
    description: 'Find references to a symbol',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string' } },
      required: ['symbol']
    }
  },
  {
    name: 'find_implementations',
    description: 'Find implementations of an interface or method',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] }
  },
  {
    name: 'get_hover',
    description: 'Get hover information at a location',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, column: { type: 'number' } },
      required: ['symbol', 'file', 'line', 'column']
    }
  },
  {
    name: 'get_completions',
    description: 'Get code completions',
    inputSchema: {
      type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, column: { type: 'number' } }, required: ['file', 'line', 'column']
    }
  },
  {
    name: 'rename_symbol',
    description: 'Rename a symbol',
    inputSchema: {
      type: 'object', properties: { symbol: { type: 'string' }, newName: { type: 'string' } }, required: ['symbol', 'newName']
    }
  },
  {
    name: 'get_diagnostics',
    description: 'Get diagnostics for a file',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }
  },
  {
    name: 'learn_pattern',
    description: 'Learn a code pattern',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['create', 'update', 'delete'] }, code: { type: 'string' } },
      required: ['action', 'code']
    }
  },
  {
    name: 'provide_feedback',
    description: 'Provide feedback on a suggestion',
    inputSchema: { type: 'object', properties: { rating: { type: 'string' } }, required: ['rating'] }
  }
];

