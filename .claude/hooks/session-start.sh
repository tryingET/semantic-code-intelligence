#!/usr/bin/env bash

# Ontology LSP - Session Start Hook
# Starts all servers using the justfile

set -euo pipefail

# Get project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Change to project directory
cd "$PROJECT_DIR"

# Check if just is installed
if ! command -v just &> /dev/null; then
    echo "⚠️  'just' command not found. Please install it:"
    echo "   cargo install just"
    echo "   or see: https://github.com/casey/just#installation"
    exit 1
fi

# Start all servers using justfile
echo "🚀 Starting Ontology LSP System..."
just start

# Show status
echo ""
just status

echo ""
echo "✅ Session started successfully!"
echo "📌 To stop: just stop"
echo "📌 To view logs: just logs"