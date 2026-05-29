---
summary: "Claude Desktop MCP Configuration for the Semantic Code Intelligence repo."
read_when:
  - "You need CLAUDE DESKTOP SETUP information for Semantic Code Intelligence."
  - "You are changing CLAUDE_DESKTOP_SETUP.md or related behavior."
type: "reference"
---

# Claude Desktop MCP Configuration

## Quick Setup

1. **Install Bun** (if not already installed):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. **Start the servers** using the session scripts:
```bash
# Start all servers
./.claude/hooks/session-start.sh

# Or start manually from the repo root:
HTTP_API_PORT=7000 bun run src/servers/http.ts &        # HTTP API server
MCP_HTTP_PORT=7001 bun run src/servers/mcp-http.ts &    # MCP Streamable HTTP server
```

3. **Add to Claude Desktop configuration**:

Copy the following to your Claude Desktop config file:
- **macOS/Linux**: `~/.config/claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "semantic-code-intelligence": {
      "command": "bun",
      "args": ["run", "/path/to/semantic-code-intelligence/dist/mcp/mcp.js"],
      "type": "stdio",
      "description": "Semantic Code Intelligence MCP stdio server"
    },
    "semantic-code-intelligence-http": {
      "type": "streamable-http",
      "url": "http://localhost:7001/mcp",
      "description": "Semantic Code Intelligence MCP Streamable HTTP server (requires the MCP HTTP server to be running)"
    }
  }
}
```

**Important**: Replace `/path/to/semantic-code-intelligence` with your actual path.

Note: The MCP server now uses Streamable HTTP (replaces the former SSE-only transport). Initialize sessions with a POST to `/mcp` to receive an `Mcp-Session-Id` response header. Use that header for subsequent POSTs and for the GET `/mcp` notification stream.

4. **Restart Claude Desktop** to load the new configuration.

## Verify Setup

Once configured, you can verify the setup by asking Claude:
- "What tools do you have available?"
- "Can you analyze this codebase using the ontology tools?"
- "Find the definition of [ClassName]"

## Available MCP Tools

The default MCP surface exposes the Alpha MVP tools documented in `docs/project/alpha-mvp-contract.md`.

### Navigation and bounded reads
- `get_snapshot`
- `read_file`
- `text_search`
- `symbol_search`
- `ast_query`
- `find_definition`
- `find_references`
- `graph_expand`

### Patch planning and validation
- `recommend_checks`
- `propose_patch`
- `run_checks`
- `patch_checks_in_snapshot`
- `extract_snapshot_artifacts`
- `structural_search`
- `structural_patch_checks`
- `safe_write`
- `rename_safely`

## Troubleshooting

### Servers not starting
```bash
# Check if ports are in use
lsof -i :7000 -i :7001

# Kill existing processes
kill $(lsof -ti:7000)
kill $(lsof -ti:7001)

# Start servers again
./.claude/hooks/session-start.sh
```

### Connection issues
```bash
# Test LSP API server
curl http://localhost:7000/health

# Test MCP server
curl http://localhost:7001/health
```

### View logs
```bash
# MCP server logs
tail -f /tmp/semantic-code-mcp-server-7001.log

# API server logs
tail -f /tmp/ontology-api-server-7000.log
```

## Architecture

```
Claude Desktop
    ↓
MCP Server (Streamable HTTP on :7001)
    ↓
HTTP Client (with circuit breaker & caching)
    ↓
LSP API Server (REST API on :7000)
    ↓
5-Layer Intelligence:
1. Claude Tools (fast file operations)
2. Tree-sitter (AST analysis)
3. Ontology Engine (concept graph)
4. Pattern Learner (ML patterns)
5. Knowledge Spreader (propagation)
```

## Performance

- **Response time**: <100ms for most operations
- **Caching**: Automatic caching of GET requests
- **Circuit breaker**: Protects against server failures
- **Retry logic**: Exponential backoff for resilience
