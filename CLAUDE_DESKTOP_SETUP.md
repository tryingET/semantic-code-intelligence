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

# Or start manually:
bun run src/api/http-server.ts &  # LSP API Server on port 7000
cd ontology-lsp && bun run dist/mcp-http/mcp-http.js &  # MCP Server (Streamable HTTP) on port 7001
```

3. **Add to Claude Desktop configuration**:

Copy the following to your Claude Desktop config file:
- **macOS/Linux**: `~/.config/claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ontology": {
      "command": "bun",
      "args": ["run", "/path/to/ontology-lsp/dist/mcp-http/mcp-http.js"],
      "env": {
        "MCP_HTTP_HOST": "localhost",
        "MCP_HTTP_PORT": "7001",
        "ONTOLOGY_LSP_HOST": "localhost",
        "ONTOLOGY_LSP_PORT": "7000",
        "ONTOLOGY_DB_PATH": "/path/to/ontology-lsp/.ontology/ontology.db",
        "ONTOLOGY_WORKSPACE": "/path/to/your/workspace"
      }
    }
  }
}
```

**Important**: Replace `/path/to/ontology-lsp` with your actual path.

Note: The MCP server now uses Streamable HTTP (replaces the former SSE-only transport). Initialize sessions with a POST to `/mcp` to receive an `Mcp-Session-Id` response header. Use that header for subsequent POSTs and for the GET `/mcp` notification stream.

4. **Restart Claude Desktop** to load the new configuration.

## Verify Setup

Once configured, you can verify the setup by asking Claude:
- "What tools do you have available?"
- "Can you analyze this codebase using the ontology tools?"
- "Find the definition of [ClassName]"

## Available MCP Tools

The Ontology MCP server provides 16 intelligent tools:

### Search & Navigation
- `find_definition` - Find symbol definitions with fuzzy matching
- `find_references` - Find all references to a symbol
- `search_semantic` - Semantic code search

### Code Understanding
- `get_concept` - Get detailed information about a code concept
- `get_hierarchy` - Get inheritance/dependency hierarchy
- `analyze_workspace` - Full codebase analysis

### Pattern Recognition
- `get_patterns` - Get learned code patterns
- `suggest_refactoring` - Get refactoring suggestions
- `detect_violations` - Find architectural violations

### Knowledge Management
- `export_ontology` - Export knowledge graph
- `import_ontology` - Import knowledge data
- `get_statistics` - Get codebase statistics

### Advanced Features
- `rename_symbol` - Intelligent rename with propagation
- `extract_component` - Extract code into new component
- `inline_variable` - Inline variable with safety checks
- `optimize_imports` - Optimize and organize imports

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
tail -f /tmp/ontology-mcp-server-7001.log

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
