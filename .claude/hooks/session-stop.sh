#!/usr/bin/env bash

# Ontology LSP - Session Stop Hook
# Stops all servers using the justfile

set -euo pipefail

# Get project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Change to project directory
cd "$PROJECT_DIR"

# Check if just is installed
if ! command -v just &> /dev/null; then
    echo "⚠️  'just' command not found. Falling back to manual cleanup..."
    # Fallback: kill processes by port
    lsof -ti:7000 | xargs -r kill -9 2>/dev/null || true
    lsof -ti:7001 | xargs -r kill -9 2>/dev/null || true
    lsof -ti:7002 | xargs -r kill -9 2>/dev/null || true
    echo "✅ Servers stopped (fallback method)"
    exit 0
fi

# Stop all servers using justfile
echo "🛑 Stopping Ontology LSP System..."
just stop

echo ""
echo "✅ Session stopped successfully!"