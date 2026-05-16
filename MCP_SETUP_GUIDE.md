# MCP Adapter Setup & Testing Guide

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Build the MCP Adapter

```bash
bun run build:mcp
```

### 3. Test the MCP Server Standalone

```bash
# Simple test (manual JSON-RPC communication)
bun run test-mcp-server.ts --simple

# Full test with client SDK
bun run test-mcp-server.ts
```

### 4. Run Unit Tests

```bash
bun test tests/adapters/mcp.test.ts
```

## Testing with Claude Desktop

### Option 1: Use the Provided Config

1. Copy the configuration to Claude Desktop's config location:

```bash
# On macOS
cp claude-desktop-config.json ~/Library/Application\ Support/Claude/claude_desktop_config.json

# On Windows
cp claude-desktop-config.json %APPDATA%\Claude\claude_desktop_config.json

# On Linux
cp claude-desktop-config.json ~/.config/Claude/claude_desktop_config.json
```

2. Restart Claude Desktop

3. Test by asking Claude:
   - "Use the ontology-lsp tool to find the definition of CodeAnalyzer"
   - "Find all references to findDefinition"
   - "Get concepts related to 'Layer'"

### Option 2: Manual Testing

1. Start the MCP server manually:

```bash
bun run start:mcp
```

2. The server will output to stderr for debugging. You should see:
```
Starting MCP server...
MCP server started successfully
```

3. Send test requests via stdio (JSON-RPC format)


### Streamable HTTP (Recommended for remote)

The Streamable HTTP transport replaces the legacy SSE server. Use the HTTP server at port 7001:

```bash
# Start the MCP HTTP server (uses port $MCP_HTTP_PORT or 7001 by default)
bun run src/servers/mcp-http.ts

# 1) Initialize session (note the Mcp-Session-Id response header)
curl -i -X POST http://localhost:7001/mcp   -H 'Content-Type: application/json'   -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'

# 2) Use a returned session id (replace <SID>) to list tools
curl -s -X POST http://localhost:7001/mcp   -H 'Content-Type: application/json'   -H 'Mcp-Session-Id: <SID>'   -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq .

# 3) Call a tool (example: find_definition)
curl -s -X POST http://localhost:7001/mcp   -H 'Content-Type: application/json'   -H 'Mcp-Session-Id: <SID>'   -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_definition","arguments":{"symbol":"CodeAnalyzer"}}}' | jq .

# 4) Stream notifications (server->client events)
curl -N -H 'Mcp-Session-Id: <SID>' http://localhost:7001/mcp

# 5) Terminate session
curl -X DELETE -H 'Mcp-Session-Id: <SID>' http://localhost:7001/mcp -i
```

## Available MCP Tools

The adapter exposes these tools to Claude:

### Navigation
- `find_definition` - Find where a symbol is defined
- `find_references` - Find all references to a symbol
- `find_implementations` - Find implementations of an interface/abstract class
- `get_call_hierarchy` - Get call hierarchy for a function
- `get_type_hierarchy` - Get type hierarchy for a class/interface

### Code Understanding
- `get_hover` - Get detailed information about a symbol
- `get_completions` - Get code completion suggestions
- `get_diagnostics` - Get code diagnostics (errors, warnings)

### Refactoring
- `rename_symbol` - Rename a symbol across the codebase
- `suggest_refactoring` - Get refactoring suggestions
- `find_similar_code` - Find code similar to a pattern

### Learning & Knowledge
- `learn_pattern` - Learn a new code pattern
- `provide_feedback` - Provide feedback on operation quality
- `get_concepts` - Get concepts from knowledge graph
- `get_relationships` - Get relationships between concepts

### Advanced
- `analyze_impact` - Analyze impact of changing a symbol

## Troubleshooting

### Server Won't Start

1. Check if port 7001 is in use:
```bash
lsof -i :7001
```

2. Check Bun installation:
```bash
bun --version  # Should be 1.0.0 or higher
```

3. Check dependencies:
```bash
bun install
```

### No Response from Tools

1. Check server logs (output to stderr)
2. Verify the tool name matches exactly
3. Check required parameters are provided

### Claude Desktop Not Finding Server

1. Verify config file location is correct
2. Check the command path is absolute
3. Restart Claude Desktop after config changes
4. Check Claude Desktop logs for errors

## Development

### Running in Development Mode

```bash
NODE_ENV=development LOG_LEVEL=debug bun run adapters/mcp/index.ts
```

### Adding New Tools

1. Add tool definition in `adapters/mcp/tools.ts`
2. Add handler in `adapters/mcp/index.ts`
3. Add translation methods in `adapters/mcp/translator.ts`
4. Add tests in `tests/adapters/mcp.test.ts`

### Architecture Overview

```
Claude Desktop
     ↓ (MCP Protocol over stdio)
MCP Adapter (adapters/mcp/)
     ↓ (Translation Layer)
Core Analyzer (core/analyzer.ts)
     ↓ (Progressive Enhancement)
Layer Stack (core/layers/)
     ↓
Services (Cache, Database)
```

## Performance Metrics

Target response times:
- find_definition: <100ms
- find_references: <500ms
- get_completions: <50ms
- rename_symbol: <1000ms

## Next Steps

1. Monitor performance with real codebases
2. Tune cache settings for optimal performance
3. Add more sophisticated pattern learning
4. Implement knowledge graph visualization

## Support

For issues or questions:
- Check logs in stderr output
- Run tests to verify setup
- Review API_SPECIFICATION.md for detailed contracts
- Check TESTING_STRATEGY.md for test scenarios
