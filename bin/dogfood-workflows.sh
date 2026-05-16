#!/usr/bin/env bash
set -euo pipefail

# Dogfood MCP workflows via Streamable HTTP. Requires server running.
# Usage: bin/dogfood-workflows.sh [symbol] [file]

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT"

SYMBOL=${1:-TestClass}
FILE=${2:-tests/fixtures/example.ts}
HTTP_PORT=$(grep -E '^HTTP_API_PORT=' .env | cut -d= -f2- || echo 7000)
MCP_PORT=$(grep -E '^MCP_HTTP_PORT=' .env | cut -d= -f2- || echo 7001)

init() {
  curl -i -sS -X POST \
    -H 'accept: application/json, text/event-stream' \
    -H 'content-type: application/json' \
    "http://localhost:${MCP_PORT}/mcp" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"dogfood","version":"1.0"}}}'
}

SID=$(init | awk -F': ' '/^Mcp-Session-Id:/{print $2}' | tr -d '\r')
if [ -z "$SID" ]; then
  echo "Failed to initialize MCP session on port ${MCP_PORT}" 1>&2
  exit 1
fi

echo "MCP_SESSION_ID=$SID"

call() {
  local name="$1"; shift
  local args="$1"; shift || true
  curl -sS -X POST \
    -H 'accept: application/json, text/event-stream' \
    -H 'content-type: application/json' \
    -H "Mcp-Session-Id: $SID" \
    "http://localhost:${MCP_PORT}/mcp" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}"
}

echo "→ investigate-symbol (explore_codebase → build_symbol_map → graph_expand)"
call workflow_locate_confirm_definition "{\"symbol\":\"$SYMBOL\",\"file\":\"$FILE\"}" | jq -r '.result.content[0].text' | head -c 400; echo; echo

echo "→ plan-safe-rename (plan_rename → snapshot → checks)"
RESP=$(call workflow_safe_rename "{\"oldName\":\"HTTPServer\",\"newName\":\"HTTPServerX\",\"file\":\"src/servers/http.ts\",\"runChecks\":false}")
echo "$RESP" | jq -r '.result.content[0].text' | head -c 400; echo; echo

echo "→ quick-patch-checks (get_snapshot → propose_patch → run_checks)"
PATCH=$(cat << 'EOF'
*** Begin Patch
*** Update File: tests/fixtures/example.ts
@@
 export class TestClass {
-    private value: number = 0;
+    /* dogfood */ private value: number = 0;
*** End Patch
EOF
)
call workflow_quick_patch_checks "{\"patch\":$(jq -Rs . <<< "$PATCH"),\"timeoutSec\": 120}" | jq -r '.result.content[0].text' | head -c 400; echo

exit 0
