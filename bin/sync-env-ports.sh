#!/usr/bin/env bash
set -euo pipefail

# Sync .env HTTP_API_PORT and MCP_HTTP_PORT using external port-registry if available,
# otherwise choose free ports locally. Keeps ports stable when free; adjusts only on conflict.

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ENV_FILE="$ROOT_DIR/.env"
PREF_HTTP=${HTTP_PREFERRED_PORT:-7000}
PREF_MCP=${MCP_PREFERRED_PORT:-7001}

CLI_TS="$HOME/programming/port-registry/src/cli.ts"
CLI_RUN=(bun run "$CLI_TS")

log() { echo "[sync-ports] $*" 1>&2; }

has_cli() { [ -f "$CLI_TS" ] || return 1; command -v bun >/dev/null 2>&1 || return 1; }

is_listening() {
  local port="$1"
  ss -tulnp 2>/dev/null | grep -q ":$port "
}

find_free_port() {
  local start="$1"
  local end=$((start+100))
  for ((p=start; p<=end; p++)); do
    if ! is_listening "$p"; then
      echo "$p"; return 0
    fi
  done
  return 1
}

reserve_with_cli() {
  local component="$1"; local preferred="$2"
  local out
  if out=$("${CLI_RUN[@]}" reserve --component "$component" --preferred "$preferred" 2>/dev/null); then
    echo "$out" | grep -Eo '^[0-9]+$' | tail -n1
    return 0
  fi
  return 1
}

choose_port() {
  local component="$1"; local preferred="$2"
  local port
  if has_cli; then
    if port=$(reserve_with_cli "$component" "$preferred"); then
      echo "$port"; return 0
    fi
  fi
  # Fallback: choose free port locally (no reservation)
  find_free_port "$preferred"
}

ensure_distinct() {
  local a="$1" b="$2"
  if [ "$a" = "$b" ]; then
    # bump MCP by 1 if collision
    echo $((b+1))
  else
    echo "$b"
  fi
}

set_kv() {
  local key="$1" val="$2" file="$3"
  if [ -f "$file" ] && grep -q "^$key=" "$file"; then
    sed -i "s/^$key=.*/$key=$val/" "$file"
  else
    echo "$key=$val" >> "$file"
  fi
}

# Load existing ports if present to keep stability
CUR_HTTP=""; CUR_MCP=""
if [ -f "$ENV_FILE" ]; then
  CUR_HTTP=$(grep -E '^HTTP_API_PORT=' "$ENV_FILE" | cut -d= -f2- || true)
  CUR_MCP=$(grep -E '^MCP_HTTP_PORT=' "$ENV_FILE" | cut -d= -f2- || true)
fi

TARGET_HTTP="${CUR_HTTP:-}"
TARGET_MCP="${CUR_MCP:-}"

if [ -z "$TARGET_HTTP" ] || is_listening "$TARGET_HTTP"; then
  TARGET_HTTP=$(choose_port http-api "$PREF_HTTP")
fi

if [ -z "$TARGET_MCP" ] || is_listening "$TARGET_MCP"; then
  TARGET_MCP=$(choose_port mcp-http "$PREF_MCP")
fi

TARGET_MCP=$(ensure_distinct "$TARGET_HTTP" "$TARGET_MCP")

mkdir -p "$ROOT_DIR"
touch "$ENV_FILE"
set_kv HTTP_API_PORT "$TARGET_HTTP" "$ENV_FILE"
set_kv MCP_HTTP_PORT "$TARGET_MCP" "$ENV_FILE"

log "HTTP_API_PORT=$TARGET_HTTP"
log "MCP_HTTP_PORT=$TARGET_MCP"

exit 0

