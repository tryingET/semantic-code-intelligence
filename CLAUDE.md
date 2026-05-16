# CLAUDE.md

This file provides guidance for MCP-compatible coding assistants working with this repository.

@.claude/docs/software-principles.md  
@.claude/docs/tech-stack-ts.md

## SESSION WORKFLOW (MANDATORY)

For every session, you MUST:

1. **Initialize** (Start of session):
   - Read VISION.md first
   - Read PROJECT_STATUS.md second  
   - Read NEXT_STEPS.md third
   - Create TodoWrite list from NEXT_STEPS.md items

2. **Execute** (For each task):
   - Mark task as "in_progress" 
   - Implement the task
   - Test the implementation
   - Update PROJECT_STATUS.md immediately
   - Update NEXT_STEPS.md immediately
   - Mark task as "completed" or document failure

3. **Report** (After each task):
   - Report specific success/failure
   - If failed, update TodoWrite with fix needed
   - If succeeded, continue to next task

4. **Finalize** (End of session):
   - Final update to PROJECT_STATUS.md
   - Final update to NEXT_STEPS.md  
   - Summary of accomplishments and blockers

## CRITICAL: Justfile-First Philosophy

**ALWAYS use justfile recipes instead of creating standalone scripts.**

This project follows a **justfile-first** approach for ALL automation:
- ✅ **DO**: Implement all commands as justfile recipes
- ✅ **DO**: Keep all logic inline in the justfile
- ✅ **DO**: Use `just <command>` for all operations
- ❌ **DON'T**: Create standalone bash/shell scripts
- ❌ **DON'T**: Create separate script files that justfile calls
- ❌ **DON'T**: Scatter commands across multiple files

**Why**: The justfile is our single source of truth for all project commands. This ensures consistency, discoverability, and maintainability.

**Example of CORRECT approach:**
```just
# Good - logic is in justfile
health-check:
    @echo "🩺 Running health check..."
    @curl -s http://localhost:7000/health || echo "API not responding"
```

**Example of INCORRECT approach:**
```just
# Bad - calling external script
health-check:
    @./scripts/health-check.sh  # DON'T DO THIS
```

## Project Overview

This is an Ontology-Enhanced LSP (Language Server Protocol) proxy that provides intelligent code navigation, refactoring, and pattern learning capabilities. It's designed to handle LLM-generated code with fuzzy matching and adaptive learning. The project uses Bun runtime (not Node.js) for better performance and native SQLite support.


### Command Management via Justfile

**IMPORTANT**: All project commands are in the justfile. To see available commands:
```bash
just --list        # Show all available commands
```

### Server Management
Use `just` commands to manage all servers (HTTP API, MCP HTTP, LSP):

```bash
# Start all servers
just start        # Starts HTTP API (7000) and MCP HTTP (7001)

# Stop all servers  
just stop         # Cleanly stops all running servers

# Other management commands
just restart      # Stop then start all servers
just status       # Show which servers are running
just health       # Check server health endpoints
just logs         # Tail server logs
just dev          # Development mode with auto-reload
```

### Diagnostic Commands (All inline in justfile)
```bash
just health-check        # Comprehensive system health check
just analyze-logs        # Analyze logs for errors and patterns
just diagnostics         # Full system diagnostic report
just save-diagnostics    # Save diagnostic report to file
just backup              # Create system backup
just list-backups        # List available backups
just restore-backup <name>  # Restore from specific backup
just verify-backup <name>   # Verify backup integrity
just clean-backups       # Remove old backups
just test-diagnostics    # Test diagnostic functionality
just emergency-reset     # Nuclear option - full reset
```

### CLI Tool
```bash
# CLI is available at dist/cli/index.js after build
ontology-lsp init      # Initialize configuration
ontology-lsp analyze   # Analyze codebase
ontology-lsp stats     # Show statistics
ontology-lsp find <identifier>  # Find with fuzzy matching
ontology-lsp suggest   # Get refactoring suggestions
```

## Architecture

### Port Configuration
The system uses centralized port configuration to avoid conflicts:

| Service | Default Port | Environment Variable | Description |
|---------|-------------|---------------------|-------------|
| HTTP API Server | 7000 | `HTTP_API_PORT` | Main REST API for LSP operations |
| MCP HTTP Server | 7001 | `MCP_HTTP_PORT` | Model Context Protocol server (Streamable HTTP) |
| LSP Server | 7002 | `LSP_SERVER_PORT` | Language Server Protocol (TCP/stdio) |
| Test API | 7010 | - | Test instance of HTTP API |
| Test MCP | 7011 | - | Test instance of MCP server |
| Test LSP | 7012 | - | Test instance of LSP server |

Configuration is managed in `mcp-ontology-server/src/config/server-config.ts`.

### Layered System (Performance-Optimized)
The system uses a 5-layer architecture, each progressively more sophisticated:

1. **Fast Search Layer (Layer 1)** (`src/layers/layer1-fast-search.ts`)
   - Fast initial search using Grep, Glob, LS tools
   - ~5ms response time
   - First line of defense for file/content searches

2. **Tree-sitter Layer** (`src/layers/tree-sitter.ts`)
   - AST-based code analysis
   - ~50ms response time
   - Structural understanding of code

3. **Ontology Engine** (`src/ontology/ontology-engine.ts`)
   - Concept management and knowledge graph
   - ~10ms response time
   - Tracks relationships between code elements

4. **Pattern Learner** (`src/patterns/pattern-learner.ts`)
   - Learns from developer refactoring actions
   - ~10ms response time
   - Builds confidence-scored pattern library

5. **Knowledge Spreader** (`src/propagation/knowledge-spreader.ts`)
   - Propagates changes across related concepts
   - ~20ms response time
   - Applies architectural rules

### Key Components

- **LSP Server** (`src/server.ts`): Main server implementing LSP protocol
- **CLI Interface** (`src/cli/index.ts`): Command-line tool
- **HTTP API** (`src/api/http-server.ts`): REST API on port 7000
- **VS Code Extension** (`vscode-client/src/extension.ts`): IDE integration
- **Storage** (`src/ontology/storage.ts`): Bun's native SQLite for persistence

### Database Schema
Uses Bun's built-in SQLite (no better-sqlite3):
- `concepts` table: Code concepts and metadata
- `relationships` table: Concept relationships
- `patterns` table: Learned refactoring patterns
- `history` table: Evolution tracking

## Technology Stack

- **Runtime**: Bun v1.2.20+ (NOT Node.js)
- **Database**: Bun's native SQLite (NOT better-sqlite3)
- **Linter**: Biome (NOT ESLint)
- **Testing**: Bun test (NOT Jest)
- **Language Parsing**: Tree-sitter for TS/JS/Python
- **LSP Libraries**: vscode-languageserver
- **Bundle Format**: ESM for server, CJS for some tools

## Important Notes

### MCP Configuration
- **CRITICAL**: The `.mcp.json` file in the project root directory is the main MCP (Model Context Protocol) configuration file
- This file defines how MCP servers are configured and connected
- Do NOT look elsewhere for MCP configuration - always check `.mcp.json` first

### Bun-Specific Requirements
- All build/test commands use Bun (check ~/.bun/bin/bun path)
- SQLite is built into Bun (no native module compilation)
- Tree-sitter packages are trusted dependencies
- Use `bun:test` imports in test files, not `jest`

### File Patterns
- `.ontology/` - Local database and cache
- `.ontologyignore` - Files to exclude from analysis
- `.ontology-lsp-config.yaml` - Project configuration
- `.mcp.json` - MCP server configuration (Model Context Protocol)

### Performance Targets
- Find Definition: <200ms for 10K+ files
- Find References: <500ms with fuzzy matching
- Rename: <1s for 50 instances with propagation
- Memory: ~500MB typical usage

### Common Issues & Solutions

1. **Server won't start**: Ensure Bun is installed and path is correct
2. **Native module errors**: Use Bun runtime, not Node.js
3. **Test failures**: Run with `bun test`, not `npm test`
4. **Extension not activating**: Check VS Code output panel for "Ontology Language Server"
5. **Performance issues**: Check cache settings in config, run `ontology-lsp optimize`

## Testing Strategy

The project has comprehensive test coverage across multiple layers:
- Unit tests for each component (step*.test.ts)
- Integration tests for LSP server
- Performance benchmarks
- VS Code extension tests

When adding new features:
1. Write unit tests for core logic
2. Add integration tests for LSP methods
3. Test performance with large codebases
4. Verify VS Code extension functionality
