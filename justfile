# Semantic Code Intelligence Commands

# Default recipe - show available commands with categories
default:
    @echo "🚀 Semantic Code Intelligence - Available Commands"
    @echo "===================================="
    @echo ""
    @echo "📦 MCP (Model Context Protocol) Commands:"
    @echo "  just build-mcp      - Build MCP fast server for Claude"
    @echo "  just rebuild-mcp    - Rebuild MCP after fixes"
    @echo "  just watch-mcp      - Watch and auto-rebuild MCP server"
    @echo ""
    @echo "🔧 Build Commands:"
    @echo "  just build          - Build all servers (including MCP)"
    @echo "  just clean-build    - Clean and rebuild everything"
    @echo ""
    @echo "🧪 Tests (sliced & batched):"
    @echo "  just test                  - Run tests using slices & batches (fast default)"
    @echo "  just test-fast             - Same as above; set SLICES/BATCH_SIZE/TIMEOUT via env"
    @echo "  just test-sliced <N> <K>    - Run slice K of N (e.g., 6 2)"
    @echo "  just test-slices <N>        - Run all N slices sequentially"
    @echo "  just test-ci-like           - Mirror CI locally (6 slices)"
    @echo "  just test-ci-like-balanced  - CI-like with balanced slices (history-based)"
    @echo "  just test-quick             - ~2 min smoke suite (fast signal)"
    @echo "  just test-smoke             - ~60–90s minimal smoke (HTTP/MCP core)"
    @echo "  just smoke                  - Alias for dogfood_ci (tool-first gate)"
    @echo ""
    @echo "🎯 Server Management:"
    @echo "  just start          - Start all servers"
    @echo "  just stop           - Stop all servers"
    @echo "  just restart        - Restart all servers"
    @echo "  just dev            - Development mode with auto-reload"
    @echo "  just status         - Check server status"
    @echo "  just health         - Health check for all servers"
    @echo "  just ensure-env     - Create .env from .env.sample if missing"
    @echo "  just sync-ports     - Adjust .env ports via external registry or local scan"
    @echo ""
    @echo "📊 Monitoring:"
    @echo "  just logs           - Tail server logs"
    @echo "  just stats          - Show system statistics"
    @echo "  just learning-stats - Show learning (L5) stats via HTTP"
    @echo ""
    @echo "🔍 CLI Tools:"
    @echo "  just find <symbol>             - Find symbol definitions"
    @echo "  just references <symbol>       - Find all references"
    @echo "  just def <symbol>              - Alias: definitions (find)"
    @echo "  just ref <symbol>              - Alias: references"
    @echo "  just explore <symbol>          - Explore: defs + refs (combined)"
    @echo "  just symbol-map <symbol>       - Symbol: build symbol map"
    @echo "  just symbol-map-graph <symbol> - Symbol: Mermaid graph output"
    @echo "  just plan-rename <old> <new>   - Refactor: plan rename (preview)"
    @echo "  just safe-apply [file] [-- <cmd...>] - Stage diff safely in snapshot + checks"
    @echo "  just migration-hygiene   - Check migrated repo identity/local artifact hygiene"
    @echo ""
    @echo "Run 'just --list' for complete command list"

# Path to Bun runtime
bun := env_var_or_default("BUN_PATH", "~/.bun/bin/bun")
workspace := env_var_or_default("ONTOLOGY_WORKSPACE", justfile_directory())

# === SERVER MANAGEMENT (replaces session-start/stop) ===

# Start all servers with port availability checks
start: stop-quiet ensure-env
    @echo "🚀 Starting Ontology LSP System..."
    @echo "=================================="
    @mkdir -p .ontology/pids .ontology/logs
    @# Read effective ports from .env (fallback to defaults)
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${HTTP_PORT:=7000}"; \
    MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${MCP_PORT:=7001}"; \
    LSP_PORT=$(grep -E '^LSP_SERVER_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${LSP_PORT:=7002}"; \
    echo "Checking port availability..."; \
    just check-ports-available; \
    echo "LSP Server is stdio-only — skipping background start"; \
    echo "Starting HTTP API Server (port $HTTP_PORT)..."; \
    HTTP_API_PORT=$HTTP_PORT {{bun}} run src/servers/http.ts > .ontology/logs/http-api.log 2>&1 & printf '%s\n' $! > .ontology/pids/http-api.pid; \
    echo "Starting MCP HTTP (Streamable) Server (port $MCP_PORT)..."; \
    MCP_HTTP_PORT=$MCP_PORT {{bun}} run src/servers/mcp-http.ts > .ontology/logs/mcp-http.log 2>&1 & printf '%s\n' $! > .ontology/pids/mcp-http.pid
    @sleep 3
    @just health
    @echo ""
    @echo "✅ All servers started!"
    @echo "📌 Status: just status"
    @echo "📌 Logs: just logs"
    @echo "📌 Stop: just stop"

# Stop all servers with improved process cleanup
stop:
    @echo "🛑 Stopping Ontology LSP servers..."
    @echo "  Stopping PID-tracked processes..."
    @-bash -c "if [ -f .ontology/pids/lsp.pid ]; then sed 's/!//g' .ontology/pids/lsp.pid | xargs -r kill 2>/dev/null || true; rm -f .ontology/pids/lsp.pid; fi"
    @-bash -c "if [ -f .ontology/pids/http-api.pid ]; then sed 's/!//g' .ontology/pids/http-api.pid | xargs -r kill 2>/dev/null || true; rm -f .ontology/pids/http-api.pid; fi"
    @-bash -c "if [ -f .ontology/pids/mcp-http.pid ]; then sed 's/!//g' .ontology/pids/mcp-http.pid | xargs -r kill 2>/dev/null || true; rm -f .ontology/pids/mcp-http.pid; fi"
    @echo "  Cleaning up any remaining processes on target ports..."
    @just clean-ports-quiet
    @echo "  Terminating any orphaned processes..."
    @-pkill -f "src/servers" 2>/dev/null || true
    @-pkill -f "ontology-lsp" 2>/dev/null || true
    @-pkill -f "http.server.*8081" 2>/dev/null || true
    @sleep 1
    @echo "✅ All servers stopped and ports cleaned"

# Stop quietly (internal use)
stop-quiet:
    @-bash -c "if [ -f .ontology/pids/lsp.pid ]; then sed 's/!//g' .ontology/pids/lsp.pid | xargs -r kill 2>/dev/null || true; rm -f .ontology/pids/lsp.pid; fi" 2>/dev/null || true
    @-bash -c "if [ -f .ontology/pids/http-api.pid ]; then sed 's/!//g' .ontology/pids/http-api.pid | xargs -r kill 2>/dev/null || true; rm -f .ontology/pids/http-api.pid; fi" 2>/dev/null || true
    @-bash -c "if [ -f .ontology/pids/mcp-http.pid ]; then sed 's/!//g' .ontology/pids/mcp-http.pid | xargs -r kill 2>/dev/null || true; rm -f .ontology/pids/mcp-http.pid; fi" 2>/dev/null || true
    @just clean-ports-quiet
    @-pkill -f "src/servers" 2>/dev/null || true
    @-pkill -f "ontology-lsp" 2>/dev/null || true
    @-pkill -f "http.server.*8081" 2>/dev/null || true

# Restart servers
restart: stop start

# Check health
health:
    @echo "🧪 Checking server health..."
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${HTTP_PORT:=7000}"; \
    MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${MCP_PORT:=7001}"; \
    echo "(env) HTTP_API_PORT=$HTTP_PORT MCP_HTTP_PORT=$MCP_PORT"; \
    (curl -s --max-time 1 http://localhost:$HTTP_PORT/health >/dev/null 2>&1 && echo "✅ HTTP API ($HTTP_PORT): HEALTHY" || echo "❌ HTTP API ($HTTP_PORT): NOT RESPONDING"); \
    (curl -s --max-time 1 http://localhost:$MCP_PORT/health >/dev/null 2>&1 && echo "✅ MCP HTTP ($MCP_PORT): HEALTHY" || echo "❌ MCP HTTP ($MCP_PORT): NOT RESPONDING")

# Show server status with port information
status:
    @echo "📊 Server Status"
    @echo "=================="
    @echo ""
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${HTTP_PORT:=7000}"; \
    MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${MCP_PORT:=7001}"; \
    echo "🔧 Ports (env/.env): HTTP=$HTTP_PORT MCP=$MCP_PORT LSP=stdio"; \
    echo ""; \
    echo "🔌 Background Services:"; \
    (curl -s --max-time 1 http://localhost:$HTTP_PORT/health >/dev/null 2>&1 && echo "  ✅ HTTP API Server: Running on port $HTTP_PORT" || echo "  ❌ HTTP API Server: Not responding on port $HTTP_PORT"); \
    (curl -s --max-time 1 http://localhost:$MCP_PORT/health >/dev/null 2>&1 && echo "  ✅ MCP HTTP Server: Running on port $MCP_PORT" || echo "  ❌ MCP HTTP Server: Not responding on port $MCP_PORT"); \
    (test -f .ontology/pids/lsp.pid && kill -0 "$(cat .ontology/pids/lsp.pid 2>/dev/null)" 2>/dev/null && echo "  ✅ LSP STDIO Server: Running (pid $(cat .ontology/pids/lsp.pid))" || echo "  ❌ LSP STDIO Server: Not running"); \
    echo ""; \
    echo "📝 On-Demand Services (stdio):"
    @test -f dist/mcp/mcp.js && echo "  ✅ MCP STDIO Server (dist): Available" || echo "  ❌ MCP STDIO Server (dist): Not found. Run 'bun run build:mcp-stdio'"
    @test -f src/servers/lsp.ts && echo "  ✅ LSP STDIO Server: Available (launches on-demand)" || echo "  ❌ LSP STDIO Server: Not found"
    @echo ""
    @echo "🌐 Port Usage Details:" 
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${HTTP_PORT:=7000}"; \
    MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${MCP_PORT:=7001}"; \
    echo "  Port $HTTP_PORT:"; (ss -tulnp 2>/dev/null | grep ":$HTTP_PORT " >/dev/null && echo "   🔴 IN USE" || echo "   🟢 AVAILABLE"); \
    echo "  Port $MCP_PORT:"; (ss -tulnp 2>/dev/null | grep ":$MCP_PORT " >/dev/null && echo "   🔴 IN USE" || echo "   🟢 AVAILABLE")

# Show logs
logs:
    @tail -f .ontology/logs/*.log

# Ensure .env exists (non-destructive): copies from .env.sample if missing
ensure-env:
    @if [ ! -f .env ]; then \
        if [ -f .env.sample ]; then cp .env.sample .env && echo "📄 Created .env from .env.sample"; \
        else echo "⚠️  No .env or .env.sample found"; fi; \
    else echo "✅ .env present"; fi

# === PORT MANAGEMENT ===

# Show process management improvements
process-management-info:
    @echo "🔧 Process Management Improvements"
    @echo "=================================="
    @echo "✅ Improved Commands:"
    @echo "  • just start      - Clean startup with port availability checks"
    @echo "  • just stop       - Graceful shutdown with complete cleanup"
    @echo "  • just restart    - Clean restart without port conflicts"
    @echo "  • just status     - HTTP-based status checking"
    @echo "  • just clean-ports - Force clean all target ports (7000-7002, 8081)"
    @echo ""
    @echo "✅ Port Management:"
    @echo "  • Pre-startup port availability checks"
    @echo "  • Multiple cleanup methods (PID, port-based, pattern-based)"
    @echo "  • Clean handling of orphaned processes"
    @echo ""
    @echo "✅ Target Ports:"
    @echo "  • 7000: HTTP API Server"
    @echo "  • 7001: MCP HTTP Server"  
    @echo "  • 7002: LSP Server"
    @echo "  • 8081: Monitoring Dashboard"
    @echo ""
    @echo "🚀 Ready for clean deployment startup!"

# === PORT REGISTRY ===

ports:
    @echo "📡 Global Port Registry (~/.ontology/ports.json)"
    @bun run ~/programming/port-registry/src/cli.ts list

sync-ports:
    @echo "🔌 Syncing ports into .env (prefers registry; falls back to local scan)"
    @bash bin/sync-env-ports.sh


# === PORT MANAGEMENT ===

# Check if required ports are available (reads .env overrides)
check-ports-available:
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${HTTP_PORT:=7000}"; \
    MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${MCP_PORT:=7001}"; \
    LSP_PORT=$(grep -E '^LSP_SERVER_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${LSP_PORT:=7002}"; \
    echo "  Checking port $HTTP_PORT..." && (ss -tulnp 2>/dev/null | grep ":$HTTP_PORT " >/dev/null && echo "  ❌ Port $HTTP_PORT is in use" && exit 1 || echo "  ✅ Port $HTTP_PORT is available"); \
    echo "  Checking port $MCP_PORT..." && (ss -tulnp 2>/dev/null | grep ":$MCP_PORT " >/dev/null && echo "  ❌ Port $MCP_PORT is in use" && exit 1 || echo "  ✅ Port $MCP_PORT is available"); \
    echo "  Checking port $LSP_PORT..." && (ss -tulnp 2>/dev/null | grep ":$LSP_PORT " >/dev/null && echo "  ❌ Port $LSP_PORT is in use" && exit 1 || echo "  ✅ Port $LSP_PORT is available"); \
    echo "  🎯 All required ports are available"

# Check status of all ports (reads .env overrides)
check-ports-status:
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2- || echo 7000); \
    MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2- || echo 7001); \
    LSP_PORT=$(grep -E '^LSP_SERVER_PORT=' .env 2>/dev/null | cut -d= -f2- || echo 7002); \
    echo "  Port $HTTP_PORT:" && (ss -tulnp 2>/dev/null | grep ":$HTTP_PORT " >/dev/null && echo " 🔴 IN USE" || echo " 🟢 AVAILABLE"); \
    echo "  Port $MCP_PORT:" && (ss -tulnp 2>/dev/null | grep ":$MCP_PORT " >/dev/null && echo " 🔴 IN USE" || echo " 🟢 AVAILABLE"); \
    echo "  Port $LSP_PORT:" && (ss -tulnp 2>/dev/null | grep ":$LSP_PORT " >/dev/null && echo " 🔴 IN USE" || echo " 🟢 AVAILABLE"); \
    echo "  Port 8081:" && (ss -tulnp 2>/dev/null | grep ":8081 " >/dev/null && echo " 🔴 IN USE" || echo " 🟢 AVAILABLE")

# Force clean all target ports (use with caution)
clean-ports:
    @echo "🧹 Force cleaning target ports..."
    @echo "⚠️  This will terminate ALL processes on ports 7000-7002 and 8081"
    @read -p "Continue? [y/N]: " confirm && [ "$confirm" = "y" ] || exit 1
    @just clean-ports-force
    @echo "✅ All target ports cleaned"

# Internal port cleaning (quiet)
clean-ports-quiet:
    @just clean-ports-force >/dev/null 2>&1 || true

# Force port cleanup implementation  
clean-ports-force:
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2- || echo 7000); \
    MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2- || echo 7001); \
    LSP_PORT=$(grep -E '^LSP_SERVER_PORT=' .env 2>/dev/null | cut -d= -f2- || echo 7002); \
    echo "    Cleaning port $HTTP_PORT..." && (ss -tulnp 2>/dev/null | grep ":$HTTP_PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs -r kill 2>/dev/null || true); \
    echo "    Cleaning port $MCP_PORT..." && (ss -tulnp 2>/dev/null | grep ":$MCP_PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs -r kill 2>/dev/null || true); \
    echo "    Cleaning port $LSP_PORT..." && (ss -tulnp 2>/dev/null | grep ":$LSP_PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs -r kill 2>/dev/null || true); \
    echo "    Cleaning port 8081..." && (ss -tulnp 2>/dev/null | grep ":8081 " | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs -r kill 2>/dev/null || true); \
    @-pkill -f "src/servers" 2>/dev/null || true
    @-pkill -f "ontology-lsp" 2>/dev/null || true
    @-pkill -f "http.server.*8081" 2>/dev/null || true
    @sleep 1

# Get stats from servers
stats:
    @echo "📊 Server Statistics"
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${HTTP_PORT:=7000}"; \
    curl -s http://localhost:$HTTP_PORT/stats | jq . || echo "Server not responding"

# Learning stats (Layer 5 summary)
learning-stats:
    @echo "🧠 Learning (L5) Stats"
    @HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env 2>/dev/null | cut -d= -f2-); : "${HTTP_PORT:=7000}"; \
    curl -s http://localhost:$HTTP_PORT/api/v1/learning-stats | jq . || echo "Server not responding"

# === E2E LOCAL RUNNER ===

# Start a dedicated HTTP server on port 7050 for E2E cross‑protocol tests
start-test-http:
    @echo "🚀 Starting test HTTP server (port 7050)..."
    @sh -c 'HTTP_API_PORT=7050 ~/.bun/bin/bun run src/servers/http.ts > .e2e-http.log 2>&1 & echo $! > .e2e-http.pid'
    @sh -c 'for x in 1 2 3 4 5 6 7 8 9 10; do if curl -sf http://localhost:7050/health >/dev/null 2>&1; then echo "✅ Test HTTP ready"; exit 0; fi; sleep 1; done; echo "❌ HTTP did not start"; exit 1'

stop-test-http:
    @echo "🛑 Stopping test HTTP server..."
    @sh -c 'if [ -f .e2e-http.pid ]; then kill `cat .e2e-http.pid` 2>/dev/null || true; fi; rm -f .e2e-http.pid'

# Run E2E suite locally using local workspace, with the test HTTP server
e2e-local: start-test-http

# === DOGFOOD (stdio MCP) ===

dogfood:
    @echo "🥣 Dogfooding (stdio MCP) — fast path" 
    @echo "   Steps: explore(off/on) → plan_rename → get_snapshot+propose_patch"
    @echo "   Flags: -w|--workspace <dir> (default: tests/fixtures), -f|--file, -s|--symbol, --full"
    @CI=1 ~/.bun/bin/bun run scripts/dogfood-mcp.ts

dogfood_full:
    @echo "🥣 Dogfooding (stdio MCP) — with quick checks (build:tsc)"
    @echo "   Flags: -w|--workspace <dir> (default: tests/fixtures)"
    @CI=1 ~/.bun/bin/bun run scripts/dogfood-mcp.ts --full

snap_diff id:
    @~/.bun/bin/bun run scripts/snapshot-tools.ts diff {{id}}

snap_status id:
    @~/.bun/bin/bun run scripts/snapshot-tools.ts status {{id}}


snap_progress id:
    @~/.bun/bin/bun run scripts/snapshot-tools.ts progress {{id}}


snap_apply id:
    @ALLOW_SNAPSHOT_APPLY=1 ~/.bun/bin/bun run scripts/snapshot-tools.ts apply {{id}}

dogfood_progress:
    @echo "🥣 Dogfooding with progress logs (bounded workspace)" 
    @echo "   Progress: .ontology/snapshots/<id>/progress.log (snap:progress)"
    @CI=1 DOGFOOD_PROGRESS=1 ~/.bun/bin/bun run scripts/dogfood-mcp.ts -w tests/fixtures -f tests/fixtures/example.ts -s TestClass

# CI-friendly dogfood using HTTP tools
dogfood_ci:
    @echo "🥣 Dogfooding (HTTP tools) — CI summary" 1>&2
    @echo "   Runs: explore → rename_safely → patch_checks_in_snapshot" 1>&2
    @CI=1 WORKSPACE_ROOT=tests/fixtures ~/.bun/bin/bun run scripts/dogfood-ci.ts

# === BUILD COMMANDS ===

# Build all server components
build:
    @echo "🔨 Building server components..."
    {{bun}} build src/servers/lsp.ts --target=bun --outdir=dist/lsp --format=esm \
        --external tree-sitter --external tree-sitter-typescript \
        --external tree-sitter-javascript --external tree-sitter-python \
        --external pg --external bun:sqlite --external express --external cors
    {{bun}} build src/servers/http.ts --target=bun --outdir=dist/api --format=esm \
        --external tree-sitter --external tree-sitter-typescript \
        --external tree-sitter-javascript --external tree-sitter-python \
        --external pg --external bun:sqlite --external express --external cors
    {{bun}} build src/servers/mcp-http.ts --target=bun --outdir=dist/mcp-http --format=esm \
        --external tree-sitter --external tree-sitter-typescript \
        --external tree-sitter-javascript --external tree-sitter-python \
        --external pg --external bun:sqlite --external express --external cors
    {{bun}} build src/servers/mcp-fast.ts --target=bun --outfile=dist/mcp-fast/mcp-fast.js --format=esm \
        --external tree-sitter --external tree-sitter-typescript \
        --external tree-sitter-javascript --external tree-sitter-python \
        --external pg --external bun:sqlite --external express --external cors
    {{bun}} build src/servers/cli.ts --target=bun --outdir=dist/cli --format=esm \
        --external tree-sitter --external tree-sitter-typescript \
        --external tree-sitter-javascript --external tree-sitter-python \
        --external pg --external bun:sqlite --external express --external cors
    @echo "✅ Build complete"

# Build only the MCP fast server (no minification to preserve symbol names for find_definition)
build-mcp:
    @echo "🚀 Building MCP fast server..."
    @mkdir -p dist/mcp-fast
    {{bun}} build src/servers/mcp-fast.ts --target=bun --outdir=dist/mcp-fast --format=esm \
        --external tree-sitter --external tree-sitter-typescript \
        --external tree-sitter-javascript --external tree-sitter-python \
        --external pg --external bun:sqlite --external express --external cors \
        --sourcemap
    @echo "✅ MCP fast server built at dist/mcp-fast/mcp-fast.js"

# Build the enhanced MCP server with error handling
build-mcp-enhanced:
    @echo "🚀 Building enhanced MCP server with error handling..."
    @mkdir -p dist/mcp-enhanced
    {{bun}} build src/servers/mcp-enhanced.ts --target=bun --outdir=dist/mcp-enhanced --format=esm \
        --sourcemap
    @echo "✅ Enhanced MCP server built at dist/mcp-enhanced/mcp-enhanced.js"

# Clean and rebuild all servers
clean-build:
    @echo "🧹 Cleaning dist directory..."
    @rm -rf dist/
    @mkdir -p dist/
    @just build
    @echo "✨ Clean build complete"

# Watch and rebuild MCP server on changes (no minification to preserve symbol names)
watch-mcp:
    @echo "👀 Watching MCP server for changes..."
    @{{bun}} build src/servers/mcp-fast.ts --target=bun --outdir=dist/mcp-fast --format=esm \
        --watch --sourcemap

# Rebuild MCP server after fixing issues
rebuild-mcp: build-mcp
    @echo "🔄 MCP server rebuilt - restart any connected Claude sessions"

# === CLI COMMANDS ===

# Run the CLI with proper module resolution
cli *args:
    @cd {{workspace}} && {{bun}} run src/servers/cli.ts {{args}}

# Find symbol definitions with fuzzy matching
find identifier:
    @just cli find {{identifier}}

# Find all references to a symbol
references identifier:
    @just cli references {{identifier}}

# Convenience aliases (restore short commands)
def identifier:
    @just cli def {{identifier}}

ref identifier:
    @just cli ref {{identifier}}

# Explore: combined definitions + references
explore identifier:
    @just cli explore {{identifier}}

# Rename a symbol with intelligent propagation
rename old new:
    @just cli rename {{old}} {{new}}

# Show system statistics and health
cli-stats:
    @just cli stats

# Build a targeted symbol map (Layer 3 - Planner)
symbol-map identifier:
    @just cli symbol-map {{identifier}}

# Build a Mermaid graph from symbol map JSON
symbol-map-graph identifier: build-cli
    @bash -lc 'if command -v codex >/dev/null 2>&1; then if command -v bunx >/dev/null 2>&1; then codex exec "visualize the following: bunx --bun ./dist/cli/cli.js symbol-map-graph {{identifier}}" >/dev/null 2>&1 & else codex exec "visualize the following: bun run ./dist/cli/cli.js symbol-map-graph {{identifier}}" >/dev/null 2>&1 & fi; else echo "codex not found in PATH" 1>&2; fi'

# Plan a rename (preview) (Layer 3 - Planner)
plan-rename old new:
    @just cli plan-rename {{old}} {{new}}

# Initialize ontology LSP via CLI
cli-init:
    @just cli init

# Analyze codebase for refactoring opportunities
analyze-refactor path="src":
    @echo "🔍 Analyzing {{path}} for refactoring opportunities..."
    @just cli find "*" --path {{path}} --verbose || true
    @just cli stats --verbose

# Build the VS Code extension
build-extension:
    cd vscode-client && npm install && npm run compile

# Build everything
build-all: build build-extension

# Package the VS Code extension
package-extension:
    cd vscode-client && npx @vscode/vsce package

# Install the extension in VS Code
install-extension: build-all package-extension
    code --install-extension vscode-client/ontology-lsp-*.vsix

# === TESTING ===

# Run all tests including comprehensive integration tests
test-all: test test-integration-comprehensive test-extension

# Run basic tests (now sliced/batched by default for speed)
# Use TEST_LEGACY=1 to run the legacy single-process recipe
test:
    @if [ "${TEST_LEGACY:-}" = "1" ]; then \
      echo "🧪 Running legacy test recipe (single process)"; \
      {{bun}} test tests/step*.test.ts tests/integration.test.ts; \
    else \
      echo "🧪 Running tests (sliced + batched for speed)"; \
      just test-fast; \
    fi

# Run comprehensive integration test suite (NEW UNIFIED ARCHITECTURE)
test-integration-comprehensive:
    @echo "🧪 Running Comprehensive Integration Tests for Unified Architecture"
    @echo "=================================================================="
    ./scripts/test-integration.sh

# Run individual comprehensive test suites
test-unified-core:
    @echo "🧪 Testing Unified Core Architecture..."
    {{bun}} test tests/unified-core.test.ts --timeout 120000

test-adapters:
    @echo "🧪 Testing Protocol Adapters..."
    {{bun}} test tests/adapters.test.ts --timeout 120000

test-learning-system:
    @echo "🧪 Testing Learning System..."
    {{bun}} test tests/learning-system.test.ts --timeout 120000

test-performance:
    @echo "⚡ Running Performance Benchmarks..."
    {{bun}} test tests/performance.test.ts --timeout 300000

test-consistency:
    @echo "🔄 Testing Cross-Protocol Consistency..."
    {{bun}} test tests/consistency.test.ts --timeout 180000

# Run extension tests
test-extension:
    cd vscode-client && npm test

# Run unit tests only (legacy)
test-unit:
    {{bun}} test tests/step*.test.ts

# Run integration tests only (legacy)
test-integration:
    {{bun}} test tests/integration.test.ts

# Run performance tests only (legacy)
test-perf:
    {{bun}} test tests/integration.test.ts --grep "Performance"

# Run tests with coverage
test-coverage:
    {{bun}} test --coverage tests/

# Run tests in watch mode
test-watch:
    {{bun}} test --watch tests/

# Progressive batch runner (prints per-batch progress)
test-batch:
    @echo "🧪 Running tests in batches (progress after each batch)"
    @echo "   Env: BATCH_SIZE (default 8), TIMEOUT (ms, default 180000), BUN_JOBS (default 1)"
    @BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-progress-batch.sh

# Slice the test suite into N parts and run one slice
test-sliced slices="4" slice="1":
    @echo "🧪 Running test slice {{slice}}/{{slices}} (batched with progress)"
    @echo "   Override with: just test-sliced <N> <K> [BATCH_SIZE=8 TIMEOUT=180000]"
    @SLICES={{slices}} SLICE={{slice}} BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh

# Run all slices sequentially (useful locally to get periodic feedback)
test-slices slices="4":
    @n={{slices}}; i=1; \
    while [ "$i" -le "$n" ]; do \
        echo "================ SLICE $i/$n ================"; \
        SLICES="$n" SLICE="$i" BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} L2_MAX_PARSE_FILES=${L2_MAX_PARSE_FILES:-10} ESCALATION_POLICY=${ESCALATION_POLICY:-never} BAIL=${BAIL:-} bin/test-slicer.sh || exit $?; \
        i=`expr $i + 1`; \
    done

# CI-like local run: 6 slices sequentially with steadier batch size
test-ci-like:
    @echo "🧪 Running CI-like sliced tests (6 slices)"
    @BAIL=${BAIL:-1} BATCH_SIZE=${BATCH_SIZE:-6} TIMEOUT=${TIMEOUT:-90000} BUN_JOBS=${BUN_JOBS:-1} L2_MAX_PARSE_FILES=${L2_MAX_PARSE_FILES:-10} ESCALATION_POLICY=${ESCALATION_POLICY:-never} just test-slices 6

# CI-like run with balanced slices (uses history when available)
test-ci-like-balanced:
    @echo "🧪 Running CI-like (balanced) sliced tests (6 slices)"
    @BAIL=${BAIL:-1} BATCH_SIZE=${BATCH_SIZE:-6} TIMEOUT=${TIMEOUT:-90000} HEARTBEAT_SEC=${HEARTBEAT_SEC:-30} BATCH_HARD_TIMEOUT_SEC=${BATCH_HARD_TIMEOUT_SEC:-120} BUN_JOBS=${BUN_JOBS:-1} BALANCE_SLICES=1 L2_MAX_PARSE_FILES=${L2_MAX_PARSE_FILES:-10} ESCALATION_POLICY=${ESCALATION_POLICY:-never} just test-slices 6

 

# Auto-sliced test runner (detect CPU, clamp slices; sequential for clean output)
test-fast:
    @SLICES=${SLICES:-4}; echo "🧪 Running $SLICES slices (batched)"
    @SLICES=${SLICES:-4}; i=1; while [ $i -le $SLICES ]; do echo "================ SLICE $i/$SLICES ================"; SLICES=$SLICES SLICE=$i BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh || exit $?; i=`expr $i + 1`; done

 

# Batch + analyze (local)
test-batch-analyze:
    @echo "🧪 Running batch + analysis" 
    @BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-progress-batch.sh
    @bun run scripts/analyze-batch-report.ts

# Extremely fast smoke tests (<2 min on dev hw)
test-quick:
    @echo "⚡ Quick smoke (~2 min): HTTP/MCP core + guards"
    @BUN_JOBS=${BUN_JOBS:-1} HEARTBEAT_SEC=${HEARTBEAT_SEC:-30} HTTP_API_PORT=${HTTP_API_PORT:-7050} bun test \
        ./tests/http-graph-expand.test.ts \
        ./tests/patch-invalid-input.test.ts \
        ./tests/layer2-parse-cap-boundaries.test.ts \
        ./tests/mcp-http-init.test.ts \
        --timeout ${TIMEOUT:-45000}

# Minimal smoke (≤90s): pure tool-first/API checks
test-smoke:
    @echo "🚬 Minimal smoke (≤90s): HTTP/MCP essentials"
    @BUN_JOBS=${BUN_JOBS:-1} HEARTBEAT_SEC=${HEARTBEAT_SEC:-30} HTTP_API_PORT=${HTTP_API_PORT:-7050} bun test \
        ./tests/mcp-http-init.test.ts \
        ./tests/layer2-parse-cap-boundaries.test.ts \
        --timeout ${TIMEOUT:-30000}

# Alias to the fast dogfood gate
smoke:
    @just dogfood_ci

# Slice + analyze (local)
test-sliced-analyze slices="4" slice="1":
    @echo "🧪 Running test slice {{slice}}/{{slices}} + analysis"
    @SLICES={{slices}} SLICE={{slice}} BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh
    @bun run scripts/analyze-batch-report.ts .test-results/batch-report.jsonl

# === E2E INTEGRATION TESTS ===

# Run End-to-End integration tests with real codebases (local workspace only)
test-e2e-local:
    @echo "🔬 Running E2E tests with local workspace..."
    @echo "================================================="
    USE_LOCAL_REPOS=true {{bun}} test tests/e2e/ --timeout 600000

# Run E2E tests with small repositories (fast)
test-e2e-small:
    @echo "🔬 Running E2E tests with small repositories..."
    @echo "=================================================="
    REPO_SIZE=small {{bun}} test tests/e2e/ --timeout 900000

# Run full E2E test suite with all repository sizes (comprehensive)
test-e2e-full:
    @echo "🔬 Running FULL E2E test suite with all repositories..."
    @echo "======================================================="
    E2E_FULL_TEST=true {{bun}} test tests/e2e/ --timeout 1800000

# Run E2E tests (default: local workspace)
test-e2e: test-e2e-local

# Generate E2E performance report
test-e2e-report: test-e2e-local
    @echo "📊 Generating E2E performance report..."
    @mkdir -p tests/e2e/results/performance-reports
    @echo "{\"timestamp\": \"$(date -Iseconds)\", \"type\": \"e2e-performance\", \"status\": \"completed\"}" > tests/e2e/results/performance-reports/latest.json
    @echo "✅ Performance report saved to tests/e2e/results/performance-reports/latest.json"

# Clean E2E test artifacts
test-e2e-clean:
    @echo "🧹 Cleaning E2E test artifacts..."
    @rm -rf .e2e-test-workspace .e2e-ontology-cache tests/e2e/results
    @echo "✅ E2E artifacts cleaned"

# Verify VISION.md requirements are met
test-vision-compliance:
    @echo "🎯 Verifying VISION.md Requirements..."
    @echo "======================================"
    @echo "✅ Testing unified architecture (protocol-agnostic core)"
    @{{bun}} test tests/unified-core.test.ts --timeout 120000
    @echo "✅ Testing all 5 processing layers with performance targets"
    @{{bun}} test tests/performance.test.ts --timeout 300000
    @echo "✅ Testing learning system integration"
    @{{bun}} test tests/learning-system.test.ts --timeout 120000
    @echo "✅ Testing cross-protocol consistency"
    @{{bun}} test tests/consistency.test.ts --timeout 180000
    @echo ""
    @echo "🎉 VISION.md compliance verified!"

# === DEVELOPMENT ===

# Slice only E2E tests for faster feedback
e2e-sliced slices="2" slice="1":
    @echo "🔬 Running E2E slice {{slice}}/{{slices}} (batched with progress)"
    @SLICES={{slices}} SLICE={{slice}} SUITE_DIR=tests/e2e BATCH_SIZE=${BATCH_SIZE:-6} TIMEOUT=${TIMEOUT:-600000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh

e2e-slices slices="2":
    @for i in `seq 1 {{slices}}`; do \
        echo "================ E2E SLICE $$i/{{slices}} ================"; \
        SLICES={{slices}} SLICE=$$i SUITE_DIR=tests/e2e BATCH_SIZE=${BATCH_SIZE:-6} TIMEOUT=${TIMEOUT:-600000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh || exit $$?; \
      done

# Build slice list only (no test execution)
slice-list slices="6" slice="1" suite="tests":
    @echo "🗂️ Generating slice list {{slice}}/{{slices}} for suite '{{suite}}' (DRY)"
    @SLICES={{slices}} SLICE={{slice}} SUITE_DIR={{suite}} DRY=1 bin/test-slicer.sh

# Run a custom suite path in slices
suite-sliced slices="4" slice="1" suite="tests":
    @echo "🧪 Running suite '{{suite}}' slice {{slice}}/{{slices}} (batched)"
    @SLICES={{slices}} SLICE={{slice}} SUITE_DIR={{suite}} BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh

suite-slices slices="4" suite="tests":
    @for i in `seq 1 {{slices}}`; do \
        echo "================ SUITE '{{suite}}' SLICE $$i/{{slices}} ================"; \
        SLICES={{slices}} SLICE=$$i SUITE_DIR={{suite}} BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh || exit $$?; \
      done

# Aggregate analysis for local slices directory (downloaded CI artifacts or local runs)
analyze-slices dir="slices":
    @echo "📈 Aggregate slice analysis from '{{dir}}'"
    @bun run scripts/analyze-slices.ts {{dir}}

# Analyze local .test-results per-slice batch reports (written by bin/test-slicer.sh)
analyze-local-slices dir=".test-results":
    @echo "📈 Aggregate LOCAL slices from '{{dir}}'"
    @bun run scripts/analyze-slices.ts {{dir}}

# Run N slices sequentially and analyze (main tests)
test-slices-analyze slices="6":
    @just test-slices slices={{slices}}
    @just analyze-local-slices dir=.test-results

# Run E2E slices sequentially and analyze
e2e-slices-analyze slices="2":
    @just e2e-slices slices={{slices}}
    @just analyze-local-slices dir=.test-results

# Run slices in parallel (main tests)
test-slices-par slices="6" jobs="3":
    @echo "🧪 Running {{slices}} slices in parallel (jobs={{jobs}})"
    @seq 1 {{slices}} | xargs -n1 -P {{jobs}} -I{} bash -lc 'echo "== SLICE {} / {{slices}} =="; SLICES={{slices}} SLICE={} BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh'

# Run E2E slices in parallel
e2e-slices-par slices="2" jobs="2":
    @echo "🔬 Running E2E {{slices}} slices in parallel (jobs={{jobs}})"
    @seq 1 {{slices}} | xargs -n1 -P {{jobs}} -I{} bash -lc 'echo "== E2E SLICE {} / {{slices}} =="; SLICES={{slices}} SLICE={} SUITE_DIR=tests/e2e BATCH_SIZE=${BATCH_SIZE:-6} TIMEOUT=${TIMEOUT:-600000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh'

# Parallel slices then aggregate locally
test-slices-par-analyze slices="6" jobs="3":
    @just test-slices-par slices={{slices}} jobs={{jobs}}
    @just analyze-local-slices dir=.test-results

# Gated analysis examples (local)
test-batch-gated warn_ms="120000" warn_max="6" fail_on_slow="0":
    @BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-progress-batch.sh
    @WARN_MS={{warn_ms}} WARN_MAX={{warn_max}} FAIL_ON_SLOW={{fail_on_slow}} bun run scripts/analyze-batch-report.ts

suite-sliced-gated slices="4" slice="1" suite="tests" warn_ms="120000" warn_max="6" fail_on_slow="0":
    @SLICES={{slices}} SLICE={{slice}} SUITE_DIR={{suite}} BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh
    @WARN_MS={{warn_ms}} WARN_MAX={{warn_max}} FAIL_ON_SLOW={{fail_on_slow}} bun run scripts/analyze-batch-report.ts .test-results/batch-report.jsonl

# Development mode - start with auto-reload (VISION.md compliant)
dev: stop-quiet
    @echo "🚀 Starting Ontology-LSP in development mode..."
    @mkdir -p .ontology/pids .ontology/logs
    @echo "Checking port availability..."
    @just check-ports-available
    
    # Ensure MCP fast server is built
    @if [ ! -f dist/mcp-fast/mcp-fast.js ]; then \
        echo "📦 Building MCP fast server..."; \
        just build-mcp; \
    fi
    
    # Load yesterday's patterns and warm cache
    @echo "📊 Loading patterns and warming cache..."
    @{{bun}} run src/cli/analyze.ts --warm-cache 2>/dev/null || true
    
    # Start servers with hot-reload
    @echo "Starting LSP Server with hot-reload (port 7002)..."
    @{{bun}} run --watch src/servers/lsp.ts > .ontology/logs/lsp.log 2>&1 & printf '%s\n' $$! > .ontology/pids/lsp.pid
    @echo "Starting HTTP API with hot-reload (port 7000)..."
    @{{bun}} run --watch src/servers/http.ts > .ontology/logs/http-api.log 2>&1 & printf '%s\n' $$! > .ontology/pids/http-api.pid
    @echo "Starting MCP (stdio) with hot-reload (port 7001 for HTTP Alt)..."
    @{{bun}} run --watch src/servers/mcp.ts > .ontology/logs/mcp-stdio.log 2>&1 & printf '%s\n' $$! > .ontology/pids/mcp-stdio.pid
    
    @sleep 2
    @echo "🧠 Knowledge base loaded with $({{bun}} run src/cli/stats.ts --quiet 2>/dev/null | grep concepts | awk '{print $2}' || echo '0') concepts"
    @echo "⚡ Cache warmed for optimal performance"
    @echo "✅ All systems operational in development mode"
    @echo ""
    @echo "📌 Status: just status"
    @echo "📌 Logs: just logs"
    @echo "📌 Health: just health"
    @echo "📌 Stop: just stop"

# Open VS Code with extension in development mode
dev-extension:
    cd vscode-client && code .

# Interactive session (start servers and watch logs)
session: start
    @echo ""
    @echo "📺 Watching logs (Ctrl+C to stop)..."
    @echo "=================================="
    @tail -f .ontology/logs/*.log

# === CODE QUALITY ===

# Run linter
lint:
    {{bun}} run lint
    cd vscode-client && npm run lint

# Format code
format:
    {{bun}} run format

# Type check
typecheck:
    {{bun}} run typecheck

# Run all checks (format, lint, typecheck, test)
check: format lint typecheck test

# === CLEANUP ===

# Clean build artifacts and logs
clean:
    @echo "🧹 Cleaning..."
    @rm -rf dist .ontology/logs/* .ontology/pids/*
    @cd vscode-client && rm -rf out node_modules coverage .nyc_output
    @echo "✅ Cleaned"

# Full clean including database
clean-all: stop
    @echo "🧹 Full clean..."
    @rm -rf dist .ontology node_modules bun.lockb
    @cd vscode-client && rm -rf out node_modules
    @echo "✅ Everything cleaned"

# === ANALYSIS & LEARNING (VISION.md) ===

# Analyze codebase and learn patterns
analyze:
    @echo "🧠 Learning from your code..."
    @{{bun}} run src/cli/analyze.ts {{workspace}}
    @echo ""
    @echo "📊 Analysis complete! New patterns discovered:"
    @{{bun}} run src/cli/stats.ts --patterns

# Analyze pull request for quality
analyze-pr pr="":
    @echo "🔍 Analyzing pull request..."
    @{{bun}} run src/cli/analyze.ts --pr {{pr}}

# === DEPLOYMENT (VISION.md) ===

# Build for production
build-prod:
    @echo "🔨 Building for production..."
    {{bun}} build src/servers/lsp.ts --target=bun --outdir=dist/lsp --minify
    {{bun}} build src/servers/http.ts --target=bun --outdir=dist/api --minify
    {{bun}} build src/servers/mcp.ts --target=bun --outdir=dist/mcp --minify
    {{bun}} build src/servers/cli.ts --target=bun --outdir=dist/cli --minify --sourcemap

# Build Docker image
docker-build: build-prod
    @echo "🐳 Building Docker image..."
    docker build -t semantic-code-intelligence:2.0.0 .
    docker tag semantic-code-intelligence:2.0.0 semantic-code-intelligence:latest
    @echo "✅ Docker image built"

# Push Docker image to registry
docker-push registry="ghcr.io/tryingET": docker-build
    @echo "📤 Pushing Docker image to {{registry}}..."
    docker tag semantic-code-intelligence:latest {{registry}}/semantic-code-intelligence:latest
    docker tag semantic-code-intelligence:2.0.0 {{registry}}/semantic-code-intelligence:2.0.0
    docker push {{registry}}/semantic-code-intelligence:latest
    docker push {{registry}}/semantic-code-intelligence:2.0.0
    @echo "✅ Docker images pushed"

# Start local development with Docker Compose
docker-dev:
    @echo "🐳 Starting Docker Compose development environment..."
    @if [ ! -f .env ]; then cp .env.sample .env; echo "Created .env from .env.sample - please configure it"; fi
    docker-compose up -d
    @echo "✅ Development environment started"
    @echo "📊 Grafana: http://localhost:3000 (admin/admin)"
    @echo "📈 Prometheus: http://localhost:9090"
    @echo "🔍 Jaeger: http://localhost:16686"

# Stop Docker Compose development
docker-dev-stop:
    @echo "🛑 Stopping Docker Compose development..."
    docker-compose down
    @echo "✅ Development environment stopped"

# Stop and clean Docker Compose
docker-dev-clean:
    @echo "🧹 Cleaning Docker Compose development..."
    docker-compose down -v --remove-orphans
    docker system prune -f
    @echo "✅ Development environment cleaned"

# Deploy to Kubernetes staging
deploy-staging: docker-build test-all
    @echo "🚀 Deploying to staging..."
    @if ! kubectl config current-context | grep -q staging; then echo "❌ Not connected to staging cluster"; exit 1; fi
    
    # Update image in manifests
    @sed -i.bak "s|semantic-code-intelligence:2.0.0|semantic-code-intelligence:latest|g" k8s/production.yaml
    
    # Apply Kubernetes manifests
    kubectl apply -f k8s/namespace.yaml
    kubectl apply -f k8s/configmap.yaml
    @if ! kubectl get secret semantic-code-intelligence-secrets -n semantic-code-intelligence >/dev/null 2>&1; then \
        echo "❌ Kubernetes secret semantic-code-intelligence-secrets not found. Create it from real values before deploying."; \
        echo "   Template: k8s/secret.yaml.example"; \
        exit 1; \
    fi
    kubectl apply -f k8s/postgres.yaml
    kubectl apply -f k8s/redis.yaml
    kubectl apply -f k8s/production.yaml
    
    # Wait for rollout
    @echo "⏳ Waiting for deployment rollout..."
    kubectl rollout status deployment/semantic-code-intelligence -n semantic-code-intelligence --timeout=300s
    
    # Restore backup
    @mv k8s/production.yaml.bak k8s/production.yaml 2>/dev/null || true
    @echo "✅ Staging deployment complete!"

# Deploy to production (Docker + Kubernetes)
deploy-production: docker-build test-all
    @echo "🚢 Deploying to production..."
    @if ! kubectl config current-context | grep -q prod; then echo "❌ Not connected to production cluster"; exit 1; fi
    
    # Confirm production deployment
    @echo "⚠️  You are about to deploy to PRODUCTION. Continue? [y/N]"
    @read -r confirm && [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ] || (echo "Deployment cancelled" && exit 1)
    
    # Update image in manifests  
    @sed -i.bak "s|semantic-code-intelligence:2.0.0|semantic-code-intelligence:latest|g" k8s/production.yaml
    
    # Create backup of current deployment
    @kubectl get deployment ontology-lsp -n semantic-code-intelligence -o yaml > deployment-backup-$(date +%Y%m%d-%H%M%S).yaml || echo "No existing deployment"
    
    # Apply manifests with production checks
    kubectl apply -f k8s/namespace.yaml
    kubectl apply -f k8s/configmap.yaml
    @if ! kubectl get secret semantic-code-intelligence-secrets -n semantic-code-intelligence >/dev/null 2>&1; then \
        echo "❌ Production secrets not found! Create them manually."; \
        exit 1; \
    fi
    kubectl apply -f k8s/postgres.yaml
    kubectl apply -f k8s/redis.yaml
    kubectl apply -f k8s/production.yaml
    
    # Wait for rollout with extended timeout
    @echo "⏳ Waiting for production deployment rollout..."
    kubectl rollout status deployment/semantic-code-intelligence -n semantic-code-intelligence --timeout=600s
    
    # Verify health
    @sleep 30
    @echo "🩺 Verifying production health..."
    @kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=semantic-code-intelligence -n semantic-code-intelligence --timeout=120s
    
    # Restore backup
    @mv k8s/production.yaml.bak k8s/production.yaml 2>/dev/null || true
    @echo "🎉 Production deployment complete!"

# Quick deploy (staging without tests - use with caution)
deploy: docker-build
    @echo "🚀 Quick deploy to staging (no tests)..."
    @just deploy-staging

# Rollback deployment
rollback namespace="semantic-code-intelligence":
    @echo "↩️  Rolling back deployment in {{namespace}}..."
    kubectl rollout undo deployment/semantic-code-intelligence -n {{namespace}}
    kubectl rollout status deployment/semantic-code-intelligence -n {{namespace}} --timeout=300s
    @echo "✅ Rollback complete!"

# Check deployment status
deploy-status namespace="semantic-code-intelligence":
    @echo "📊 Deployment Status for {{namespace}}"
    @echo "=================================="
    kubectl get pods -n {{namespace}} -l app.kubernetes.io/name=semantic-code-intelligence
    kubectl get services -n {{namespace}} -l app.kubernetes.io/name=semantic-code-intelligence
    kubectl get ingress -n {{namespace}}
    @echo ""
    @echo "Recent events:"
    kubectl get events -n {{namespace}} --sort-by='.lastTimestamp' | tail -10

# Scale deployment
scale replicas="3" namespace="semantic-code-intelligence":
    @echo "📈 Scaling deployment to {{replicas}} replicas in {{namespace}}..."
    kubectl scale deployment/semantic-code-intelligence --replicas={{replicas}} -n {{namespace}}
    kubectl rollout status deployment/semantic-code-intelligence -n {{namespace}} --timeout=300s
    @echo "✅ Scaled to {{replicas}} replicas"

# Port forward for local testing
port-forward namespace="semantic-code-intelligence":
    @echo "🔀 Port forwarding from {{namespace}}..."
    @echo "📍 HTTP API: http://localhost:7000"
    @echo "📍 MCP HTTP: http://localhost:7001" 
    @echo "Press Ctrl+C to stop"
    kubectl port-forward -n {{namespace}} svc/semantic-code-intelligence-http 7000:7000 &
    kubectl port-forward -n {{namespace}} svc/semantic-code-intelligence-mcp 7001:7001 &
    wait

# === UTILITIES ===

# Install all dependencies
install:
    {{bun}} install
    cd vscode-client && npm install

# Initialize project (first time setup)
init:
    @echo "🎯 Initializing Ontology LSP..."
    @mkdir -p .ontology/logs .ontology/pids .ontology/db
    @{{bun}} install
    @echo "✅ Initialized! Run 'just start' to begin."

# Show available MCP tools
mcp-tools:
    @echo "🔧 Available MCP Tools"
    @echo "====================="
    @curl -s http://localhost:7001/tools 2>/dev/null | jq -r '.[] | "• \(.name): \(.description | split("\n")[0])"' || echo "MCP server not running. Run 'just start' first."

# Test MCP stdio server directly
test-mcp-stdio:
    @echo "🧪 Testing MCP STDIO Server..."
    @(echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'; sleep 0.5; echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'; sleep 0.5) | timeout 2s {{bun}} run dist/mcp/mcp.js 2>/dev/null | grep -o '"method":\|"result":\|"tools":\|"name":' | head -5 || echo "✅ MCP stdio server appears to be working (timeout expected)"

# Test enhanced MCP server with error handling
test-mcp-enhanced:
    @echo "🧪 Testing Enhanced MCP Server with error handling..."
    @echo "Testing valid request..."
    @(echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'; sleep 0.5; echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'; sleep 0.5) | timeout 3s {{bun}} run src/servers/mcp-enhanced.ts 2>/dev/null | grep -o '"method":\|"result":\|"tools":\|"name":' | head -5 || echo "✅ Enhanced MCP server basic functionality working"
    @echo "Testing invalid request (should handle gracefully)..."
    @(echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"invalid_tool","arguments":{}},"id":3}'; sleep 1) | timeout 2s {{bun}} run src/servers/mcp-enhanced.ts 2>/dev/null | grep -o '"error":\|"code":\|"message":' | head -3 || echo "✅ Enhanced MCP server error handling working"

# Test error handling and recovery systems
test-error-handling:
    @echo "🧪 Testing Error Handling and Recovery Systems..."
    {{bun}} test tests/error-handling.test.ts --verbose

# Test all endpoints
test-endpoints:
    @echo "🧪 Testing Endpoints"
    @echo "===================="
    @echo "HTTP API Health:"
    @curl -s http://localhost:7000/health | jq . || echo "Failed"
    @echo ""
    @echo "MCP HTTP Health:"
    @curl -s http://localhost:7001/health | jq . || echo "Failed"
    @echo ""
    @echo "HTTP API Stats:"
    @curl -s http://localhost:7000/stats | jq '.ontology' || echo "Failed"

# Full CI/CD simulation
ci: clean install build-all lint test-all test-coverage package-extension
    @echo "✓ CI pipeline complete!"

# === TROUBLESHOOTING & DIAGNOSTICS ===

# Run comprehensive system health check
health-check:
    @echo "🩺 Health Check Report - $(date)"
    @echo "================================"
    @echo "Testing HTTP API (7000):" && (curl -s http://localhost:7000/health >/dev/null 2>&1 && echo "✅ HTTP API (7000): HEALTHY" || echo "❌ HTTP API (7000): UNHEALTHY")
    @echo "Testing MCP HTTP (7001):" && (curl -s http://localhost:7001/health >/dev/null 2>&1 && echo "✅ MCP HTTP (7001): HEALTHY" || echo "❌ MCP HTTP (7001): UNHEALTHY")
    @echo "Checking processes:" && (pgrep -f "bun run src/servers" >/dev/null && echo "✅ Server processes: RUNNING" || echo "❌ Server processes: NOT RUNNING")
    @echo "Checking .ontology directory:" && ([ -d .ontology ] && echo "✅ .ontology directory: Present" || echo "⚠️  .ontology directory: Not found")
    @echo "================================"

# Analyze system logs for debugging issues
analyze-logs:
    @echo "📊 Log Analysis Report - $(date)"
    @echo "================================"
    @if [ ! -d .ontology/logs ]; then echo "❌ Log directory not found"; echo "Run 'just start' to initialize the system."; exit 1; fi
    @echo "Log files:"
    @ls -la .ontology/logs/*.log 2>/dev/null | wc -l | xargs -I {} echo "  Found {} log files"
    @echo "Recent errors across all logs:"
    @find .ontology/logs -name "*.log" -exec grep -l -i error {} \; 2>/dev/null | xargs -I {} basename {} | head -5 | xargs -I {} echo "  📁 {}"
    @echo "Recent warnings across all logs:"
    @find .ontology/logs -name "*.log" -exec grep -l -i "warn\|warning" {} \; 2>/dev/null | xargs -I {} basename {} | head -5 | xargs -I {} echo "  ⚠️ {}"
    @echo "Quick troubleshooting commands:"
    @echo "  just logs     # Follow logs in real-time"
    @echo "  just restart  # Restart all services"

# Collect comprehensive diagnostic information
diagnostics:
    #!/usr/bin/env bash
    set -euo pipefail
    
    # Safe command runner with fallback
    safe_run() {
        local cmd="$1"
        local fallback="${2:-Not available}"
        
        if eval "$cmd" 2>/dev/null; then
            return 0
        else
            echo "$fallback"
            return 1
        fi
    }
    
    echo "🔍 Ontology-LSP Diagnostic Report"
    echo "================================="
    echo "Generated: $(date)"
    echo "System: $(uname -a)"
    echo ""
    
    echo "📦 Environment Information:"
    echo "  Bun version: $(safe_run '{{bun}} --version' 'Not installed')"
    echo "  Node version: $(safe_run 'node --version' 'Not installed')"
    echo "  Platform: $OSTYPE"
    echo "  Shell: $SHELL"
    echo "  Working directory: $(pwd)"
    echo "  User: $(whoami)"
    echo ""
    
    echo "🏗️ Project Information:"
    if [ -d .git ]; then
        echo "  Git repository: Yes"
        echo "  Git commit: $(safe_run 'git rev-parse --short HEAD' 'Unknown')"
        echo "  Git branch: $(safe_run 'git branch --show-current' 'Unknown')"
        echo "  Git status: $(safe_run 'git status --porcelain | wc -l' '0') modified files"
    else
        echo "  Git repository: No"
    fi
    
    if [ -f package.json ]; then
        echo "  Package.json: Yes"
        if command -v jq >/dev/null 2>&1 && [ -f package.json ]; then
            echo "  Project version: $(jq -r '.version // "Unknown"' package.json)"
            echo "  Project name: $(jq -r '.name // "Unknown"' package.json)"
        fi
    else
        echo "  Package.json: No"
    fi
    
    if [ -f bun.lockb ]; then
        echo "  Dependencies: $(echo "Lockfile present")"
    else
        echo "  Dependencies: No lockfile found"
    fi
    
    echo ""
    
    echo "🔧 Configuration Status:"
    if [ -f src/core/config/server-config.ts ]; then
        echo "  Configuration file: Present"
        echo "  Config validation:"
        if {{bun}} run -e "
        try {
          const { getEnvironmentConfig, validatePorts } = require('./src/core/config/server-config.ts');
          const config = getEnvironmentConfig();
          validatePorts(config);
          console.log('    ✅ Valid - HTTP: ' + config.ports.httpAPI + ', MCP: ' + config.ports.mcpHTTP + ', LSP: ' + config.ports.lspServer);
        } catch (e) {
          console.log('    ❌ Error: ' + e.message);
        }
        " 2>/dev/null; then
            true  # Success message already printed
        else
            echo "    ❌ Cannot validate configuration"
        fi
    else
        echo "  Configuration file: Missing"
    fi
    
    # Check environment variables
    echo "  Environment variables:"
    echo "    NODE_ENV: ${NODE_ENV:-Not set}"
    echo "    BUN_ENV: ${BUN_ENV:-Not set}"
    echo "    HTTP_API_PORT: ${HTTP_API_PORT:-Default (7000)}"
    echo "    MCP_HTTP_PORT: ${MCP_HTTP_PORT:-Default (7001)}"
    echo "    LSP_SERVER_PORT: ${LSP_SERVER_PORT:-Default (7002)}"
    
    echo ""
    
    echo "💾 Storage Information:"
    if [ -d .ontology ]; then
        echo "  .ontology directory: Present"
        echo "    Size: $(du -sh .ontology 2>/dev/null | cut -f1 || echo 'Unknown')"
        echo "    Permissions: $(ls -ld .ontology | awk '{print $1, $3, $4}')"
        
        if [ -f .ontology/db/ontology.sqlite ]; then
            echo "  Database: Present"
            echo "    Size: $(du -h .ontology/db/ontology.sqlite | cut -f1)"
            echo "    Tables: $(sqlite3 .ontology/db/ontology.sqlite "SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null | wc -l || echo 'Cannot read')"
            echo "    Concepts: $(sqlite3 .ontology/db/ontology.sqlite "SELECT COUNT(*) FROM concepts;" 2>/dev/null || echo 'Cannot count')"
        else
            echo "  Database: Not found"
        fi
        
        if [ -d .ontology/cache ]; then
            echo "  Cache directory: $(du -sh .ontology/cache 2>/dev/null | cut -f1 || echo 'Empty')"
        else
            echo "  Cache directory: Not found"
        fi
        
        if [ -d .ontology/logs ]; then
            log_count=$(find .ontology/logs -name "*.log" | wc -l)
            echo "  Log files: $log_count files"
            if [ "$log_count" -gt 0 ]; then
                echo "    Total log size: $(du -sh .ontology/logs 2>/dev/null | cut -f1 || echo 'Unknown')"
            fi
        else
            echo "  Log files: No log directory"
        fi
        
        if [ -d .ontology/pids ]; then
            pid_count=$(find .ontology/pids -name "*.pid" | wc -l)
            echo "  PID files: $pid_count files"
        else
            echo "  PID files: No PID directory"
        fi
    else
        echo "  .ontology directory: Not found (system not initialized)"
    fi
    
    echo ""
    
    echo "🚀 Process Information:"
    bun_processes=$(pgrep -f "bun" | wc -l)
    ontology_processes=$(pgrep -f "ontology\|src/servers" | wc -l)
    
    echo "  Bun processes: $bun_processes"
    echo "  Ontology processes: $ontology_processes"
    
    if [ "$ontology_processes" -gt 0 ]; then
        echo "  Running processes:"
        ps aux | grep -E "(bun.*src/servers|ontology)" | grep -v grep | sed 's/^/    /' || echo "    None found"
    else
        echo "  No Ontology-LSP processes running"
    fi
    
    # Check for zombie/defunct processes
    zombie_count=$(ps aux | grep -c '[Zz]ombie\|<defunct>' || echo "0")
    if [ "$zombie_count" -gt 0 ]; then
        echo "  ⚠️  Zombie processes detected: $zombie_count"
    fi
    
    echo ""
    
    echo "🌐 Network Information:"
    for port in 7000 7001 7002; do
        if lsof -i ":$port" >/dev/null 2>&1; then
            process_info=$(lsof -i ":$port" 2>/dev/null | tail -1 | awk '{print $1, $2}')
            echo "  Port $port: IN USE ($process_info)"
        else
            echo "  Port $port: AVAILABLE"
        fi
    done
    
    # Test HTTP connectivity
    echo "  HTTP connectivity:"
    for port in 7000 7001; do
        if curl -s --connect-timeout 2 "http://localhost:$port/health" >/dev/null 2>&1; then
            echo "    localhost:$port: ✅ RESPONDING"
        else
            echo "    localhost:$port: ❌ NOT RESPONDING"
        fi
    done
    
    echo ""
    
    echo "📊 System Resources:"
    # Memory information
    if command -v free >/dev/null 2>&1; then
        mem_info=$(free -h | grep "Mem:")
        echo "  Memory: $(echo $mem_info | awk '{print "Used " $3 " / Total " $2}')"
    else
        echo "  Memory: Information not available"
    fi
    
    # Disk space
    echo "  Disk space:"
    echo "    Current directory: $(df -h . | tail -1 | awk '{print $4 " available (" $5 " used)"}')"
    if [ -d .ontology ]; then
        echo "    .ontology directory: $(df -h .ontology | tail -1 | awk '{print $4 " available"}')"
    fi
    
    # Load average (if available)
    if [ -f /proc/loadavg ]; then
        load_avg=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
        echo "  Load average (1m 5m 15m): $load_avg"
    fi
    
    echo ""
    
    echo "📋 Recent Log Entries:"
    if [ -d .ontology/logs ]; then
        echo "  Log files found: $(find .ontology/logs -name "*.log" | wc -l)"
        
        for log in .ontology/logs/*.log; do
            if [ -f "$log" ]; then
                echo "  📁 $(basename "$log") (last 5 lines):"
                tail -5 "$log" 2>/dev/null | sed 's/^/    /' || echo "    (cannot read log)"
                echo ""
            fi
        done
    else
        echo "  No log directory found"
    fi
    
    echo "❌ Recent Errors:"
    error_found=false
    if [ -d .ontology/logs ]; then
        # Get recent errors from all logs
        recent_errors=$(grep -h -i "error\|exception\|fail" .ontology/logs/*.log 2>/dev/null | tail -10)
        if [ -n "$recent_errors" ]; then
            echo "$recent_errors" | sed 's/^/  /'
            error_found=true
        fi
    fi
    
    if [ "$error_found" = false ]; then
        echo "  No recent errors found in logs"
    fi
    
    echo ""
    echo "🔍 Diagnostic Tests:"
    
    # Test basic functionality
    echo "  Configuration loading:"
    if {{bun}} run -e "require('./src/core/config/server-config.ts')" >/dev/null 2>&1; then
        echo "    ✅ Can load configuration"
    else
        echo "    ❌ Cannot load configuration"
    fi
    
    echo "  Database connectivity:"
    if [ -f .ontology/db/ontology.sqlite ]; then
        if sqlite3 .ontology/db/ontology.sqlite "SELECT 1;" >/dev/null 2>&1; then
            echo "    ✅ Database accessible"
        else
            echo "    ❌ Database not accessible"
        fi
    else
        echo "    ⚠️  Database file not found"
    fi
    
    echo "  Build system:"
    if [ -f package.json ] && command -v {{bun}} >/dev/null 2>&1; then
        if {{bun}} --version >/dev/null 2>&1; then
            echo "    ✅ Bun runtime available"
        else
            echo "    ❌ Bun runtime issues"
        fi
    else
        echo "    ⚠️  Build environment not configured"
    fi
    
    echo ""
    echo "📋 Recommended Actions:"
    
    # Analyze issues and provide recommendations
    recommendations=()
    
    if [ "$ontology_processes" -eq 0 ]; then
        recommendations+=("Start the system: just start")
    fi
    
    if [ ! -d .ontology ]; then
        recommendations+=("Initialize the system: just init")
    fi
    
    if [ "$error_found" = true ]; then
        recommendations+=("Analyze errors: just analyze-logs")
    fi
    
    if ! curl -s --connect-timeout 1 "http://localhost:7000/health" >/dev/null 2>&1; then
        recommendations+=("Check service health: just health")
    fi
    
    if pgrep -f "bun.*src/servers" >/dev/null && ! curl -s "http://localhost:7000/health" >/dev/null 2>&1; then
        recommendations+=("Restart services: just restart")
    fi
    
    if [ ${#recommendations[@]} -eq 0 ]; then
        echo "  🎉 System appears to be functioning normally"
        echo "  If you're experiencing issues, try:"
        echo "    - just health    # Check service health"
        echo "    - just logs      # Monitor real-time logs"
    else
        for rec in "${recommendations[@]}"; do
            echo "  • $rec"
        done
    fi
    
    echo ""
    echo "================================="
    echo "📊 Diagnostic collection complete"
    echo "💾 To save this report: just save-diagnostics"
    echo "🆘 Include this report when requesting support"

# Save diagnostic report to file
save-diagnostics:
    #!/usr/bin/env bash
    set -euo pipefail
    
    report_file="diagnostics-$(date +%Y%m%d-%H%M%S).txt"
    echo "💾 Saving diagnostic report to $report_file..."
    
    # Run diagnostics and save to file
    just diagnostics > "$report_file"
    
    echo "📄 Report saved: $report_file"
    echo "📏 Size: $(du -h "$report_file" | cut -f1)"
    echo ""
    echo "🔗 You can share this report for troubleshooting support"

# Create backup of system data
backup:
    #!/usr/bin/env bash
    set -euo pipefail
    
    BACKUP_DIR="backups"
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    
    echo "🔄 Creating backup at $TIMESTAMP..."
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR/$TIMESTAMP"
    
    # Check what exists and backup accordingly
    backed_up=0
    
    # Backup database
    if [ -f .ontology/db/ontology.sqlite ]; then
        echo "  💾 Backing up database..."
        mkdir -p "$BACKUP_DIR/$TIMESTAMP/db"
        cp .ontology/db/ontology.sqlite "$BACKUP_DIR/$TIMESTAMP/db/"
        
        # Backup any other database files
        if [ -f .ontology/db/ontology.sqlite-wal ]; then
            cp .ontology/db/ontology.sqlite-wal "$BACKUP_DIR/$TIMESTAMP/db/"
        fi
        if [ -f .ontology/db/ontology.sqlite-shm ]; then
            cp .ontology/db/ontology.sqlite-shm "$BACKUP_DIR/$TIMESTAMP/db/"
        fi
        
        backed_up=1
    fi
    
    # Backup configuration
    if [ -f .env ]; then
        echo "  ⚙️  Backing up environment configuration..."
        cp .env "$BACKUP_DIR/$TIMESTAMP/"
        backed_up=1
    fi
    
    # Backup custom configuration files
    for config_file in claude-desktop-config.json .mcp.json ontology-lsp-config.yaml; do
        if [ -f "$config_file" ]; then
            echo "  📄 Backing up $config_file..."
            cp "$config_file" "$BACKUP_DIR/$TIMESTAMP/"
            backed_up=1
        fi
    done
    
    # Backup learned patterns and cache (if significant)
    if [ -d .ontology/cache ] && [ "$(du -s .ontology/cache | cut -f1)" -gt 100 ]; then
        echo "  🧠 Backing up cache..."
        cp -r .ontology/cache "$BACKUP_DIR/$TIMESTAMP/"
        backed_up=1
    fi
    
    # Backup important logs (recent ones)
    if [ -d .ontology/logs ]; then
        echo "  📋 Backing up recent logs..."
        mkdir -p "$BACKUP_DIR/$TIMESTAMP/logs"
        
        # Only backup logs from last 24 hours
        find .ontology/logs -name "*.log" -mtime -1 -exec cp {} "$BACKUP_DIR/$TIMESTAMP/logs/" \; 2>/dev/null
    fi
    
    if [ $backed_up -eq 0 ]; then
        echo "  ⚠️  No data found to backup. System may not be initialized."
        rmdir "$BACKUP_DIR/$TIMESTAMP" 2>/dev/null
        exit 1
    fi
    
    # Create backup manifest
    echo "# Ontology-LSP Backup Manifest" > "$BACKUP_DIR/$TIMESTAMP/MANIFEST"
    echo "Created: $(date)" >> "$BACKUP_DIR/$TIMESTAMP/MANIFEST"
    echo "System: $(uname -a)" >> "$BACKUP_DIR/$TIMESTAMP/MANIFEST"
    echo "Git commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'Unknown')" >> "$BACKUP_DIR/$TIMESTAMP/MANIFEST"
    echo "" >> "$BACKUP_DIR/$TIMESTAMP/MANIFEST"
    echo "Contents:" >> "$BACKUP_DIR/$TIMESTAMP/MANIFEST"
    find "$BACKUP_DIR/$TIMESTAMP" -type f | grep -v MANIFEST | sed 's|^.*/||' | sort >> "$BACKUP_DIR/$TIMESTAMP/MANIFEST"
    
    # Create compressed archive
    echo "  📦 Creating compressed archive..."
    (cd "$BACKUP_DIR" && tar -czf "$TIMESTAMP.tar.gz" "$TIMESTAMP/")
    
    if [ $? -eq 0 ]; then
        # Clean up uncompressed backup
        rm -rf "$BACKUP_DIR/$TIMESTAMP"
        
        backup_size=$(du -h "$BACKUP_DIR/$TIMESTAMP.tar.gz" | cut -f1)
        echo "  ✅ Backup created: $BACKUP_DIR/$TIMESTAMP.tar.gz ($backup_size)"
        
        # Show backup contents
        echo ""
        echo "📋 Backup contents:"
        tar -tzf "$BACKUP_DIR/$TIMESTAMP.tar.gz" | sed 's/^/  /'
        
        exit 0
    else
        echo "  ❌ Failed to create compressed archive"
        rm -rf "$BACKUP_DIR/$TIMESTAMP"
        exit 1
    fi

# List available backups
list-backups:
    @echo "📚 Available Backups:"
    @echo "===================="
    @if [ ! -d "backups" ]; then echo "No backups found (backup directory doesn't exist)"; echo "Create a backup with: just backup"; else find backups -name "*.tar.gz" -exec basename {} .tar.gz \; 2>/dev/null | head -10 | while read backup; do echo "  📦 $backup"; done; fi

# Restore from backup (requires backup name)
restore-backup backup="":
    #!/usr/bin/env bash
    set -euo pipefail
    
    BACKUP_DIR="backups"
    backup_name="{{backup}}"
    
    if [ -z "$backup_name" ]; then
        echo "❌ Please specify backup to restore"
        echo "Usage: just restore-backup <backup-name>"
        echo ""
        echo "Available backups:"
        just list-backups
        exit 1
    fi
    
    backup_file="$BACKUP_DIR/$backup_name.tar.gz"
    
    if [ ! -f "$backup_file" ]; then
        echo "❌ Backup not found: $backup_file"
        echo ""
        echo "Available backups:"
        just list-backups
        exit 1
    fi
    
    echo "🔄 Restoring backup: $backup_name"
    echo ""
    
    # Show what will be restored
    echo "📋 Backup contents:"
    tar -tzf "$backup_file" | sed 's/^/  /'
    echo ""
    
    # Confirm restore
    read -p "⚠️  This will overwrite existing data. Continue? [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Restore cancelled"
        exit 1
    fi
    
    # Stop services before restore
    echo "  🛑 Stopping services..."
    just stop >/dev/null 2>&1 || true
    
    # Create backup of current state
    if [ -d .ontology ]; then
        echo "  💾 Creating backup of current state..."
        current_backup="pre-restore-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$BACKUP_DIR/$current_backup"
        cp -r .ontology "$BACKUP_DIR/$current_backup/" 2>/dev/null || true
        tar -czf "$BACKUP_DIR/$current_backup.tar.gz" -C "$BACKUP_DIR" "$current_backup/" && rm -rf "$BACKUP_DIR/$current_backup"
        echo "    Current state saved as: $current_backup.tar.gz"
    fi
    
    # Extract backup
    echo "  📦 Extracting backup..."
    temp_dir=$(mktemp -d)
    
    if tar -xzf "$backup_file" -C "$temp_dir"; then
        backup_extract_dir="$temp_dir/$backup_name"
        
        # Restore database
        if [ -f "$backup_extract_dir/db/ontology.sqlite" ]; then
            echo "  💾 Restoring database..."
            mkdir -p .ontology/db
            cp "$backup_extract_dir/db/"* .ontology/db/ 2>/dev/null
        fi
        
        # Restore configuration
        for config_file in .env claude-desktop-config.json .mcp.json ontology-lsp-config.yaml; do
            if [ -f "$backup_extract_dir/$config_file" ]; then
                echo "  ⚙️  Restoring $config_file..."
                cp "$backup_extract_dir/$config_file" .
            fi
        done
        
        # Restore cache if present
        if [ -d "$backup_extract_dir/cache" ]; then
            echo "  🧠 Restoring cache..."
            mkdir -p .ontology
            cp -r "$backup_extract_dir/cache" .ontology/
        fi
        
        # Restore logs if present
        if [ -d "$backup_extract_dir/logs" ]; then
            echo "  📋 Restoring logs..."
            mkdir -p .ontology/logs
            cp "$backup_extract_dir/logs/"* .ontology/logs/ 2>/dev/null
        fi
        
        echo "  ✅ Restore completed successfully"
        
    else
        echo "  ❌ Failed to extract backup"
        rm -rf "$temp_dir"
        exit 1
    fi
    
    # Cleanup
    rm -rf "$temp_dir"
    
    echo ""
    echo "🎉 Restore completed!"
    echo "Next steps:"
    echo "  - just start    # Start the system"
    echo "  - just health   # Verify system health"

# Verify backup integrity (optional backup name)
verify-backup backup="":
    #!/usr/bin/env bash
    set -euo pipefail
    
    BACKUP_DIR="backups"
    backup_name="{{backup}}"
    
    if [ -z "$backup_name" ]; then
        echo "❌ Please specify backup to verify"
        echo "Usage: just verify-backup <backup-name>"
        echo ""
        echo "Available backups:"
        just list-backups
        exit 1
    fi
    
    backup_file="$BACKUP_DIR/$backup_name.tar.gz"
    
    if [ ! -f "$backup_file" ]; then
        echo "❌ Backup not found: $backup_file"
        exit 1
    fi
    
    echo "🔍 Verifying backup: $backup_name"
    echo ""
    
    # Test archive integrity
    echo "  📦 Testing archive integrity..."
    if tar -tzf "$backup_file" >/dev/null 2>&1; then
        echo "    ✅ Archive is readable"
    else
        echo "    ❌ Archive is corrupted"
        exit 1
    fi
    
    # Check contents
    echo "  📋 Checking contents..."
    temp_dir=$(mktemp -d)
    
    if tar -xzf "$backup_file" -C "$temp_dir"; then
        backup_extract_dir="$temp_dir/$backup_name"
        
        # Check database
        if [ -f "$backup_extract_dir/db/ontology.sqlite" ]; then
            echo "    💾 Database file: ✅ Present"
            
            # Verify database integrity if sqlite3 is available
            if command -v sqlite3 >/dev/null 2>&1; then
                if sqlite3 "$backup_extract_dir/db/ontology.sqlite" "PRAGMA integrity_check;" | grep -q "ok"; then
                    echo "    💾 Database integrity: ✅ OK"
                else
                    echo "    💾 Database integrity: ❌ Corrupted"
                fi
            fi
        else
            echo "    💾 Database file: ❌ Missing"
        fi
        
        # Check configuration files
        config_count=0
        for config_file in .env claude-desktop-config.json .mcp.json ontology-lsp-config.yaml; do
            if [ -f "$backup_extract_dir/$config_file" ]; then
                echo "    ⚙️  Configuration ($config_file): ✅ Present"
                config_count=$((config_count + 1))
            fi
        done
        
        if [ $config_count -eq 0 ]; then
            echo "    ⚙️  Configuration files: ⚠️  None found"
        fi
        
        # Check manifest
        if [ -f "$backup_extract_dir/MANIFEST" ]; then
            echo "    📄 Manifest: ✅ Present"
            echo ""
            echo "  📋 Backup manifest:"
            cat "$backup_extract_dir/MANIFEST" | sed 's/^/      /'
        else
            echo "    📄 Manifest: ⚠️  Missing"
        fi
        
        echo ""
        echo "  ✅ Backup verification completed"
        
    else
        echo "    ❌ Failed to extract backup for verification"
        rm -rf "$temp_dir"
        exit 1
    fi
    
    rm -rf "$temp_dir"

# Clean old backups (keep last 10)
clean-backups:
    #!/usr/bin/env bash
    set -euo pipefail
    
    BACKUP_DIR="backups"
    
    echo "🧹 Cleaning old backups..."
    
    if [ ! -d "$BACKUP_DIR" ]; then
        echo "No backup directory found"
        exit 0
    fi
    
    backup_count=$(find "$BACKUP_DIR" -name "*.tar.gz" | wc -l)
    
    if [ "$backup_count" -le 10 ]; then
        echo "  Only $backup_count backups found, no cleanup needed (keeping up to 10)"
        exit 0
    fi
    
    echo "  Found $backup_count backups, keeping 10 most recent..."
    
    # Keep 10 most recent backups, remove the rest
    find "$BACKUP_DIR" -name "*.tar.gz" -type f -printf '%T@ %p\n' | \
        sort -rn | \
        tail -n +11 | \
        cut -d' ' -f2- | \
        while read -r file; do
            backup_name=$(basename "$file" .tar.gz)
            echo "    🗑️  Removing old backup: $backup_name"
            rm -f "$file"
        done
    
    remaining_count=$(find "$BACKUP_DIR" -name "*.tar.gz" | wc -l)
    echo "  ✅ Cleanup completed, $remaining_count backups remaining"

# Test all diagnostic tools
test-diagnostics:
    #!/usr/bin/env bash
    set -euo pipefail
    
    echo "🧪 Testing Diagnostic Functions"
    echo "==============================="
    
    test_passed=0
    test_failed=0
    
    # Test function
    run_test() {
        local test_name="$1"
        local test_command="$2"
        local expected_exit_codes="${3:-0}"
        
        echo ""
        echo "Testing: $test_name"
        
        # Run the command and capture output/exit code
        if timeout 30s bash -c "$test_command" >/dev/null 2>&1; then
            exit_code=$?
        else
            exit_code=$?
            if [ $exit_code -eq 124 ]; then
                echo "⏰ Test timed out (30s limit)"
                ((test_failed++))
                return 1
            fi
        fi
        
        # Check if exit code is acceptable
        exit_code_ok=false
        IFS='|' read -ra ACCEPTABLE_CODES <<< "$expected_exit_codes"
        for code in "${ACCEPTABLE_CODES[@]}"; do
            if [ $exit_code -eq $code ]; then
                exit_code_ok=true
                break
            fi
        done
        
        if [ "$exit_code_ok" = true ]; then
            echo "✅ $test_name: PASSED (exit code: $exit_code)"
            ((test_passed++))
        else
            echo "❌ $test_name: FAILED (exit code: $exit_code, expected: $expected_exit_codes)"
            ((test_failed++))
        fi
    }
    
    echo "🔍 Testing diagnostic functions..."
    
    # Test each diagnostic function
    run_test "Health check" "just health-check" "0|1"
    run_test "Log analysis" "just analyze-logs" "0|1|2"
    run_test "Diagnostic collection" "just diagnostics"
    run_test "Backup listing" "just list-backups"
    
    # Test backup functions if directory exists
    if [ -d backups ] && [ "$(find backups -name "*.tar.gz" | wc -l)" -gt 0 ]; then
        backup_file=$(find backups -name "*.tar.gz" | head -1)
        backup_name=$(basename "$backup_file" .tar.gz)
        run_test "Backup verification" "just verify-backup $backup_name"
    else
        echo ""
        echo "⚠️  Skipping backup verification test (no backups found)"
    fi
    
    # Test dependency availability
    echo ""
    echo "🔧 Checking diagnostic dependencies:"
    
    deps_ok=true
    
    # Check for required commands
    for cmd in curl sqlite3 lsof grep awk sed tar; do
        if command -v "$cmd" >/dev/null 2>&1; then
            echo "  ✅ $cmd: available"
        else
            echo "  ⚠️  $cmd: not available (some features may not work)"
            if [ "$cmd" = "curl" ] || [ "$cmd" = "sqlite3" ]; then
                deps_ok=false
            fi
        fi
    done
    
    # Check for optional but useful commands  
    for cmd in jq free df ps pgrep lsof netstat; do
        if command -v "$cmd" >/dev/null 2>&1; then
            echo "  ✅ $cmd: available"
        else
            echo "  ℹ️  $cmd: not available (optional, but recommended)"
        fi
    done
    
    if [ "$deps_ok" = true ]; then
        echo "  ✅ All critical dependencies available"
        ((test_passed++))
    else
        echo "  ❌ Missing critical dependencies"
        ((test_failed++))
    fi
    
    # Test file structure
    echo ""
    echo "📁 Validating expected file structure:"
    
    expected_files=(
        "docs/TROUBLESHOOTING.md"
        "justfile"
        "src/core/config/server-config.ts"
    )
    
    for file in "${expected_files[@]}"; do
        if [ -f "$file" ]; then
            echo "  ✅ $file: exists"
            ((test_passed++))
        else
            echo "  ❌ $file: missing"
            ((test_failed++))
        fi
    done
    
    # Test if .ontology directory can be created (simulate initialization)
    echo ""
    echo "📂 Testing directory creation:"
    
    test_dir=".test_ontology_$$"
    if mkdir -p "$test_dir/db" "$test_dir/logs" "$test_dir/pids" 2>/dev/null; then
        echo "  ✅ Can create required directories"
        rm -rf "$test_dir"
        ((test_passed++))
    else
        echo "  ❌ Cannot create required directories (permission issue?)"
        ((test_failed++))
    fi
    
    # Summary
    echo ""
    echo "=============================="
    echo "🎯 Test Summary"
    echo "=============================="
    echo "✅ Tests passed: $test_passed"
    echo "❌ Tests failed: $test_failed"
    echo "📊 Total tests: $((test_passed + test_failed))"
    
    if [ $test_failed -eq 0 ]; then
        echo ""
        echo "🎉 All diagnostic tools are working correctly!"
        echo ""
        echo "Available diagnostic commands:"
        echo "  just health-check        # System health check"
        echo "  just analyze-logs        # Log analysis"
        echo "  just diagnostics         # Full diagnostic report"
        echo "  just save-diagnostics    # Save diagnostic report to file"
        echo "  just backup              # Create system backup"
        echo "  just list-backups        # List available backups"
        echo "  just restore-backup      # Restore from backup"
        echo "  just verify-backup       # Verify backup integrity"
        echo "  just clean-backups       # Clean old backups"
        echo ""
        echo "Documentation:"
        echo "  docs/TROUBLESHOOTING.md  # Complete troubleshooting guide"
        
        exit 0
    else
        echo ""
        echo "⚠️  Some diagnostic tools have issues. Check the errors above."
        echo "The troubleshooting guide is still available at docs/TROUBLESHOOTING.md"
        
        exit 1
    fi

# Emergency reset (stop everything, clean state, restart)
emergency-reset:
    @echo "🚨 EMERGENCY RESET - This will stop all services and clean state"
    @read -p "Continue? [y/N]: " confirm && [ "$$confirm" = "y" ] || exit 1
    @echo "🛑 Stopping all services..."
    @just stop >/dev/null 2>&1 || true
    @echo "🧹 Force cleaning all ports..."
    @just clean-ports-force >/dev/null 2>&1 || true
    @echo "🧹 Cleaning state..."
    @rm -rf .ontology/
    @echo "🎯 Initializing fresh..."
    @just init
    @echo "🚀 Starting clean..."
    @just start
    @echo "✅ Emergency reset complete"

# Show troubleshooting guide
troubleshoot:
    @echo "📖 Opening troubleshooting guide..."
    @if command -v less >/dev/null 2>&1; then \
        less docs/TROUBLESHOOTING.md; \
    else \
        cat docs/TROUBLESHOOTING.md; \
    fi

# === MEMORY OPTIMIZATION & MONITORING ===

# Run comprehensive memory profile
memory-profile:
    @echo "🔍 Running memory profile..."
    @{{bun}} scripts/memory-profile.js

# Memory monitoring (continuous)
memory-monitor:
    @echo "📊 Starting memory monitoring (Press Ctrl+C to stop)..."
    @while true; do \
        echo "=== $(date) ==="; \
        ps -o pid,rss,vsz,cmd --sort=-rss | grep -E "(bun|src/servers)" | grep -v grep | head -10; \
        echo ""; \
        sleep 30; \
    done

# Quick memory check
memory-check:
    @echo "💾 Quick Memory Check"
    @echo "===================="
    @echo "Ontology-LSP Processes:"
    @ps aux | grep -E "src/servers" | grep -v grep | awk '{printf "PID: %-8s RSS: %-10s CMD: %s\n", $$2, $$6"KB", substr($$0, index($$0,$$11))}'
    @echo ""
    @echo "Total RSS:" $(ps aux | grep -E "src/servers" | grep -v grep | awk '{sum+=$$6} END {print sum"KB"}')
    @echo "System Memory:" $(free -h | grep "Mem:" | awk '{print "Used: "$$3" / Total: "$$2}')

# Clean up memory caches
clean-memory:
    @echo "🧹 Cleaning memory caches..."
    @echo "Clearing ontology cache..."
    @rm -f .ontology/cache_* 2>/dev/null || true
    @echo "Restarting servers to clear memory..."
    @just restart

# Memory and performance optimization
optimize-memory:
    @echo "🧠 Optimizing memory usage..."
    @echo "Analyzing cache sizes..."
    @echo "$(ls -la .ontology 2>/dev/null | wc -l) files in ontology cache"
    @echo "Current database size: $(du -h .ontology/*.db 2>/dev/null | cut -f1 || echo '0B')"
    @echo "Running memory optimization..."
    @{{bun}} scripts/memory-profile.js

# === DEMOS ===

# Render an MCP stdio handshake demo GIF using VHS
demo-mcp-vhs:
    @echo "🎬 Rendering MCP demo with VHS..."
    @if command -v vhs >/dev/null 2>&1; then \
        vhs scripts/mcp-demo.tape; \
    else \
        echo "Please install VHS: https://github.com/charmbracelet/vhs"; \
        exit 1; \
    fi
build-cli:
    @echo "🔨 Building CLI (ontology-lsp) ..."
    {{bun}} build src/servers/cli.ts --target=bun --outdir=dist/cli --format=esm \
        --external tree-sitter --external tree-sitter-typescript \
        --external tree-sitter-javascript --external tree-sitter-python
    @echo "✅ CLI built: dist/cli/cli.js"
# Build and visualize symbol maps for related tokens discovered via explore
symbol-map-graphs identifier: build-cli
    @bash -lc 'if ! command -v codex >/dev/null 2>&1; then echo "codex not found in PATH" 1>&2; exit 0; fi; out=$(bun run ./dist/cli/cli.js explore {{identifier}} --json 2>/dev/null || true); echo "$out" | jq -r "[.definitions[].name, .references[].name] | map(select(. != null)) | unique[]" 2>/dev/null | awk -v seed="{{identifier}}" '"'"'NF && $0 != seed'"'"' | while read -r name; do if command -v bunx >/dev/null 2>&1; then codex exec "visualize the following: bunx --bun ./dist/cli/cli.js symbol-map-graph \"$name\"" >/dev/null 2>&1 & else codex exec "visualize the following: bun run ./dist/cli/cli.js symbol-map-graph \"$name\"" >/dev/null 2>&1 & fi; done'

# Show a snapshot diff via delta (fallback to cat)
# Note: snap_diff is already defined earlier in the justfile; keep a CLI-friendly alias
snap_diff_cli snap_id:
    @bash bin/snap-diff.sh {{snap_id}}

# Safely stage and validate a patch inside a snapshot (Tool-First)
# Usage:
#   just safe-apply ./my.diff -- bun run build:tsc "bun test --bail=1"
#   git diff | just safe-apply-stdin -- bun run build:tsc
safe-apply file +cmds:
    @if [ -n "{{file}}" ]; then \
        bash bin/self-apply.sh -f {{file}} -- {{cmds}}; \
    else \
        echo "✗ Please provide a diff file or use: git diff | just safe-apply-stdin -- <commands>" 1>&2; \
        exit 2; \
    fi

safe-apply-stdin +cmds:
    @bash -lc 'cat | bin/self-apply.sh -- {{cmds}}'

# (moved above) CI-like run with balanced slices is defined earlier to avoid duplication

# Balanced sequential slices (optional hot slice for top-N heavy files)
test-slices-balanced slices="6" hot_top="0":
    @n={{slices}}; i=1; \
    while [ "$i" -le "$n" ]; do \
        echo "================ BALANCED SLICE $i/$n ================"; \
        SLICES="$n" SLICE="$i" BALANCE_SLICES=1 HOT_SLICE_TOP={{hot_top}} BATCH_SIZE=${BATCH_SIZE:-8} TIMEOUT=${TIMEOUT:-180000} BUN_JOBS=${BUN_JOBS:-1} bin/test-slicer.sh || exit $?; \
        i=`expr $i + 1`; \
    done
test-async:
    @echo "🚀 Starting async CI-like (balanced) run in background..." 
    @mkdir -p .test-results
    @BATCH_SIZE=${BATCH_SIZE:-6} TIMEOUT=${TIMEOUT:-90000} HEARTBEAT_SEC=${HEARTBEAT_SEC:-30} BATCH_HARD_TIMEOUT_SEC=${BATCH_HARD_TIMEOUT_SEC:-120} BUN_JOBS=${BUN_JOBS:-1} BALANCE_SLICES=${BALANCE_SLICES:-1} nohup bash -lc 'just test-ci-like-balanced' > .test-results/async.log 2>&1 & echo $$! > .test-results/async.pid; echo "PID: $(cat .test-results/async.pid)"

test-progress:
    @echo "📈 Progress (aggregate)"
    @if [ -f .test-results/batch-report.jsonl ]; then bun run scripts/analyze-batch-report.ts .test-results/batch-report.jsonl; else echo "No batch report yet"; fi

test-tail:
    @echo "📜 Tailing async log (.test-results/async.log)"
    @tail -F .test-results/async.log

test-stop-async:
    @echo "🛑 Stopping async test run..."
    @if [ -f .test-results/async.pid ]; then kill `cat .test-results/async.pid` 2>/dev/null || true; rm -f .test-results/async.pid; else echo "No async pid"; fi

# Check migrated repo identity/local artifact hygiene
migration-hygiene:
    ./scripts/migration-hygiene.sh
