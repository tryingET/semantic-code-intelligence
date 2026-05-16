#!/usr/bin/env bash

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  Ontology MCP Server - Delayed Status Display                            ║
# ║  Shows startup status after a brief delay without blocking               ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

# Wait a bit for servers to start
sleep 3

# Configuration
MCP_PORT="${MCP_SSE_PORT:-7001}"
MCP_HOST="${MCP_SSE_HOST:-localhost}"
HTTP_API_PORT="${ONTOLOGY_API_PORT:-7000}"
MCP_PID_FILE="/tmp/ontology-mcp-server-${MCP_PORT}.pid"
API_PID_FILE="/tmp/ontology-api-server-${HTTP_API_PORT}.pid"
LSP_PID_FILE="/tmp/ontology-lsp-server.pid"

# ANSI color codes
BOLD='\033[1m'
DIM='\033[2m'
BRIGHT_GREEN='\033[0;92m'
BRIGHT_CYAN='\033[0;96m'
BRIGHT_YELLOW='\033[0;93m'
BRIGHT_RED='\033[0;91m'
NC='\033[0m' # No Color

# Unicode symbols
CHECK_MARK="✓"
CROSS_MARK="✗"
ROCKET="🚀"
LIGHTNING="⚡"
INFO="ℹ"

# Function to check if server is running
is_server_running() {
    local pid_file="$1"
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Function to check if port is in use
is_port_in_use() {
    local host="$1"
    local port="$2"
    nc -z "$host" "$port" 2>/dev/null
}

# Count running servers
servers_running=0
servers_total=3

if is_server_running "$MCP_PID_FILE" || is_port_in_use "$MCP_HOST" "$MCP_PORT"; then
    servers_running=$((servers_running + 1))
fi

if is_server_running "$API_PID_FILE" || is_port_in_use "localhost" "$HTTP_API_PORT"; then
    servers_running=$((servers_running + 1))
fi

if is_server_running "$LSP_PID_FILE"; then
    servers_running=$((servers_running + 1))
fi

# Display status
echo
if [ $servers_running -eq $servers_total ]; then
    echo -e "${BRIGHT_GREEN}${CHECK_MARK}${NC} ${BOLD}${BRIGHT_GREEN}Ontology LSP Suite Ready!${NC} ${ROCKET}"
    echo -e "   ${DIM}All $servers_total servers running successfully${NC}"
elif [ $servers_running -gt 0 ]; then
    echo -e "${BRIGHT_YELLOW}${INFO}${NC} ${BOLD}${BRIGHT_YELLOW}Ontology LSP Suite Partial${NC}"
    echo -e "   ${DIM}$servers_running of $servers_total servers running${NC}"
else
    echo -e "${BRIGHT_RED}${CROSS_MARK}${NC} ${BOLD}${BRIGHT_RED}Ontology LSP Suite Not Started${NC}"
    echo -e "   ${DIM}Check /tmp/ontology-*.log for details${NC}"
fi

# Show available endpoints if any servers are running
if [ $servers_running -gt 0 ]; then
    echo
    echo -e "${BRIGHT_CYAN}${LIGHTNING} Available Services:${NC}"
    
    if is_server_running "$MCP_PID_FILE" || is_port_in_use "$MCP_HOST" "$MCP_PORT"; then
        echo -e "   • MCP Server: ${DIM}http://$MCP_HOST:$MCP_PORT/mcp/sse${NC}"
    fi
    
    if is_server_running "$API_PID_FILE" || is_port_in_use "localhost" "$HTTP_API_PORT"; then
        echo -e "   • HTTP API:   ${DIM}http://localhost:$HTTP_API_PORT${NC}"
    fi
    
    if is_server_running "$LSP_PID_FILE"; then
        echo -e "   • LSP Server: ${DIM}stdio (VS Code ready)${NC}"
    fi
fi

echo