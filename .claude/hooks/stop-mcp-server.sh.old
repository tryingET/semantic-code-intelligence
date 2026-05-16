#!/usr/bin/env bash

# Stop hook to cleanly shut down the Ontology MCP server
# This runs when a Claude Code session ends

set -euo pipefail

# Configuration
MCP_PORT="${MCP_SSE_PORT:-7001}"
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

# Function to stop the server
stop_server() {
    if [ ! -f "$PID_FILE" ]; then
        echo -e "${YELLOW}No PID file found. Server may not be running.${NC}" >&2
        return 0
    fi
    
    local pid=$(cat "$PID_FILE")
    
    echo -e "${YELLOW}Stopping Ontology MCP Server (PID: $pid)...${NC}" >&2
    
    # Try graceful shutdown first (SIGTERM)
    if kill -TERM "$pid" 2>/dev/null; then
        # Wait up to 5 seconds for graceful shutdown
        local attempts=0
        while [ $attempts -lt 10 ]; do
            if ! kill -0 "$pid" 2>/dev/null; then
                echo -e "${GREEN}✅ Ontology MCP Server stopped gracefully${NC}" >&2
                rm -f "$PID_FILE"
                return 0
            fi
            sleep 0.5
            attempts=$((attempts + 1))
        done
        
        # Force kill if graceful shutdown failed
        echo -e "${YELLOW}Graceful shutdown timed out, forcing stop...${NC}" >&2
        kill -KILL "$pid" 2>/dev/null || true
    fi
    
    # Clean up PID file
    rm -f "$PID_FILE"
    echo -e "${GREEN}✅ Ontology MCP Server stopped${NC}" >&2
    return 0
}

# Main logic
main() {
    # Check if server is running
    if is_server_running; then
        stop_server
        
        # Output summary for Claude
        cat <<EOF
The Ontology MCP Server has been shut down cleanly.

Session summary:
• Server was running on port $MCP_PORT
• Logs available at: $LOG_FILE
• Process terminated successfully

Thank you for using the Ontology MCP Server!
EOF
    else
        echo -e "${YELLOW}Ontology MCP Server was not running${NC}" >&2
    fi
}

# Run main function
main