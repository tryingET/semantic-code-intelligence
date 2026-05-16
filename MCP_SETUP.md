# MCP Server Setup Guide

## Problem Solved
The MCP server was timing out during initialization when Claude tried to connect to it. This was due to:
1. Heavy database initialization
2. Loading all layers synchronously
3. Cache warming operations
4. Tree-sitter parser initialization

## Solution: Fast MCP Server

### Architecture
- **Lazy Initialization**: Server starts immediately, delays core initialization until first tool call
- **Fast Handshake**: Returns tool list without initializing the core analyzer
- **Optimized Wrapper**: Shell script sets all environment variables for fast startup

### Files Created
1. `/src/servers/mcp-fast.ts` - Optimized MCP server with lazy initialization
2. `/mcp-wrapper.sh` - Shell wrapper for fast startup
3. `/dist/mcp-fast/mcp-fast.js` - Compiled optimized server

### Performance Improvement
- **Before**: Timeout during initialization (>30s)
- **After**: ~1 second initialization, instant tool listing

## Usage

### For Claude Desktop
The `.mcp.json` file is configured to use the optimized wrapper:
```json
{
  "mcpServers": {
    "ontology-lsp": {
      "command": "./mcp-wrapper.sh",
      "args": [],
      "type": "stdio",
      "description": "Ontology-enhanced LSP with 5-layer architecture"
    }
  }
}
```

### Manual Testing
```bash
# Test initialization
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"0.1.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | ./mcp-wrapper.sh

# Test tool listing (no core initialization needed)
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | ./mcp-wrapper.sh

# Test tool call (triggers lazy initialization)
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"find_definition","arguments":{"symbol":"Test"}},"id":1}' | ./mcp-wrapper.sh
```

## Building
```bash
# Build the optimized MCP server
bun build ./src/servers/mcp-fast.ts --target=bun --outdir=dist/mcp-fast --format=esm --external tree-sitter-typescript --external tree-sitter-javascript --external tree-sitter-python

# Make wrapper executable
chmod +x mcp-wrapper.sh
```

## Key Optimizations
1. **No upfront database loading** - Database only accessed when needed
2. **No parser preloading** - Tree-sitter parsers loaded on demand
3. **No cache warming** - Cache populated as queries are made
4. **Immediate handshake** - Tool list returned without initialization
5. **Silent mode** - All console output suppressed to prevent stdio pollution

## Troubleshooting

### If MCP still times out:
1. Check if the wrapper script is executable: `chmod +x mcp-wrapper.sh`
2. Verify the path in `.mcp.json` is absolute
3. Test manually with the commands above
4. Check Claude's MCP logs for errors

### If tools don't work:
1. The first tool call may be slower (lazy initialization)
2. Check database exists: `.ontology/ontology.db`
3. Verify workspace path in wrapper script

## Future Improvements
- Pre-warm cache in background after initialization
- Use worker threads for parallel initialization
- Implement connection pooling for database
- Add health check endpoint for monitoring
