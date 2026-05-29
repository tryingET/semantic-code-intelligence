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

echo "→ investigate-symbol (find_definition → graph_expand)"
call find_definition "{\"symbol\":\"$SYMBOL\",\"file\":\"$FILE\",\"maxResults\":20,\"precise\":true}" | jq -r '.result.content[0].text' | head -c 400; echo; echo
call graph_expand "{\"symbol\":\"$SYMBOL\",\"file\":\"$FILE\",\"edges\":[\"imports\",\"exports\",\"callers\",\"callees\"],\"depth\":1,\"limit\":20}" | jq -r '.result.content[0].text' | head -c 400; echo; echo

echo "→ plan-safe-rename (rename_safely → snapshot → checks)"
RESP=$(call rename_safely "{\"oldName\":\"HTTPServer\",\"newName\":\"HTTPServerX\",\"file\":\"src/servers/http.ts\",\"runChecks\":false}")
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
call patch_checks_in_snapshot "{\"patch\":$(jq -Rs . <<< "$PATCH"),\"timeoutSec\": 120}" | jq -r '.result.content[0].text' | head -c 400; echo

exit 0
