#!/bin/bash
# MCP Server Wrapper - Optimized startup for Claude integration
set -euo pipefail

# Resolve repo root (directory of this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

# Set environment for fast startup (allow overrides)
export NODE_ENV="${NODE_ENV:-production}"
export SILENT_MODE="${SILENT_MODE:-true}"
export STDIO_MODE="${STDIO_MODE:-true}"
export BUN_DISABLE_ANALYTICS="${BUN_DISABLE_ANALYTICS:-1}"
export BUN_DISABLE_TRANSPILER_CACHE="${BUN_DISABLE_TRANSPILER_CACHE:-1}"
export SEMANTIC_CODE_DB_PATH="${SEMANTIC_CODE_DB_PATH:-$REPO_ROOT/.ontology/ontology.db}"
export SEMANTIC_CODE_WORKSPACE="${SEMANTIC_CODE_WORKSPACE:-$REPO_ROOT}"

# Codex stdio defaults: publish workflows, include prompts/resources, allow apply in dev.
export FAST_STDIO_LIST_MODE="${FAST_STDIO_LIST_MODE:-workflows}"
export FAST_STDIO_PREFER_RENAMED="${FAST_STDIO_PREFER_RENAMED:-1}"
export FAST_STDIO_PROMPTS="${FAST_STDIO_PROMPTS:-1}"
export FAST_STDIO_RESOURCES="${FAST_STDIO_RESOURCES:-1}"
# Enable applying snapshot to working tree in dev (guarded path)
export ALLOW_SNAPSHOT_APPLY="${ALLOW_SNAPSHOT_APPLY:-1}"
# Prefer partial snapshot materialization for faster dev loops
export SNAPSHOT_PARTIAL="${SNAPSHOT_PARTIAL:-1}"
# Prefer quick checks on touched files when commands are omitted
export FAST_STDIO_CHECKS="${FAST_STDIO_CHECKS:-touched}"

# Prefer the optimized fast MCP server if built; fallback to standard build
FAST_SERVER_JS="$REPO_ROOT/dist/mcp-fast/mcp-fast.js"
STD_SERVER_JS="$REPO_ROOT/dist/mcp/mcp.js"

if [ -f "$FAST_SERVER_JS" ]; then
  exec bun "$FAST_SERVER_JS"
elif [ -f "$STD_SERVER_JS" ]; then
  exec bun "$STD_SERVER_JS"
else
  {
    echo "MCP server binary not found. Build one of:"
    echo "  just build-mcp-fast   # builds dist/mcp-fast/mcp-fast.js"
    echo "  just build-mcp        # builds dist/mcp/mcp.js"
  } 1>&2
  exit 1
fi
