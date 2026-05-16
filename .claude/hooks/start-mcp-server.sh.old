#!/usr/bin/env bash

# SessionStart hook to automatically start the Ontology MCP server
# This runs when a new Claude Code session starts in this project

set -euo pipefail

# Configuration
MCP_PORT="${MCP_SSE_PORT:-7001}"
MCP_HOST="${MCP_SSE_HOST:-localhost}"
MCP_SERVER_DIR="$CLAUDE_PROJECT_DIR/mcp-ontology-server"
BUN_PATH="${HOME}/.bun/bin/bun"
PID_FILE="/tmp/ontology-mcp-server-${MCP_PORT}.pid"
LOG_FILE="/tmp/ontology-mcp-server-${MCP_PORT}.log"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if server is running
is_server_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        else
            # PID file exists but process is dead
            rm -f "$PID_FILE"
        fi
    fi
    return 1
}

# Function to check if port is in use
is_port_in_use() {
    nc -z "$MCP_HOST" "$MCP_PORT" 2>/dev/null
}

# Function to start the server
start_server() {
    echo -e "${YELLOW}Starting Ontology MCP Server on ${MCP_HOST}:${MCP_PORT}...${NC}" >&2
    
    # Start the server in background
    cd "$MCP_SERVER_DIR"
    nohup "$BUN_PATH" run src/sse-server.ts > "$LOG_FILE" 2>&1 &
    local pid=$!
    
    # Save PID
    echo "$pid" > "$PID_FILE"
    
    # Wait for server to be ready (max 5 seconds)
    local attempts=0
    while [ $attempts -lt 10 ]; do
        if is_port_in_use; then
            echo -e "${GREEN}✅ Ontology MCP Server started successfully (PID: $pid)${NC}" >&2
            return 0
        fi
        sleep 0.5
        attempts=$((attempts + 1))
    done
    
    # Server didn't start properly
    echo -e "${RED}❌ Failed to start MCP server. Check logs at: $LOG_FILE${NC}" >&2
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    return 1
}

# Main logic
main() {
    # Check if Bun is installed
    if [ ! -f "$BUN_PATH" ]; then
        echo -e "${RED}❌ Bun not found at $BUN_PATH${NC}" >&2
        echo "Please install Bun: curl -fsSL https://bun.sh/install | bash" >&2
        exit 1
    fi
    
    # Check if MCP server directory exists
    if [ ! -d "$MCP_SERVER_DIR" ]; then
        echo -e "${YELLOW}⚠️  MCP server not found at $MCP_SERVER_DIR${NC}" >&2
        echo "The Ontology MCP server is not installed in this project." >&2
        exit 0  # Non-blocking, let session continue
    fi
    
    # Check if server is already running
    if is_server_running; then
        local pid=$(cat "$PID_FILE")
        echo -e "${GREEN}✅ Ontology MCP Server already running (PID: $pid)${NC}" >&2
        
        # Output context for Claude
        cat <<EOF
The Ontology MCP Server is already running on port $MCP_PORT.

Available capabilities:
• 16 intelligent tools for code analysis and refactoring
• 5-layer architecture (Claude Tools, Tree-sitter, Ontology, Patterns, Knowledge)
• Real-time SSE transport for instant updates
• Pattern learning from your refactoring actions

Quick commands to try:
- "Find the definition of [ClassName]"
- "Analyze this codebase"
- "Suggest refactoring for [file]"
- "What patterns exist in [module]?"

For more details, see: $CLAUDE_PROJECT_DIR/mcp-ontology-server/docs/FIRST_STEPS.md
EOF
        exit 0
    fi
    
    # Check if port is already in use by another process
    if is_port_in_use; then
        echo -e "${YELLOW}⚠️  Port $MCP_PORT is already in use by another process${NC}" >&2
        echo "Cannot start Ontology MCP Server. Please check what's using port $MCP_PORT" >&2
        exit 0  # Non-blocking
    fi
    
    # Start the server
    if start_server; then
        # Output context for Claude about the started server
        cat <<EOF
🚀 Ontology MCP Server has been started successfully!

Server Details:
• URL: http://$MCP_HOST:$MCP_PORT/mcp/sse
• PID: $(cat "$PID_FILE")
• Logs: $LOG_FILE

The server provides:
• 16 intelligent tools for code analysis and refactoring
• 5-layer architecture with <100ms response time
• Real-time updates via SSE transport
• Pattern learning from your actions

Quick commands to try:
- "Find the definition of [ClassName]"
- "Analyze this codebase"
- "Suggest refactoring for [file]"
- "What patterns exist in [module]?"

For a complete guide, see: $CLAUDE_PROJECT_DIR/mcp-ontology-server/docs/FIRST_STEPS.md
EOF
    else
        echo -e "${RED}Failed to start the Ontology MCP Server.${NC}" >&2
        echo "Please check the logs at: $LOG_FILE" >&2
        exit 0  # Non-blocking, let session continue
    fi
}

# Run main function
main