#!/usr/bin/env bash
set -euo pipefail

# Sync .env HTTP_API_PORT and MCP_HTTP_PORT using external port-registry if available,
# otherwise choose free ports locally. Keeps ports stable when free; adjusts only on conflict.

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ENV_FILE="$ROOT_DIR/.env"
DEFAULT_HTTP=7000
DEFAULT_MCP=7001
PREF_HTTP=${HTTP_PREFERRED_PORT:-$DEFAULT_HTTP}
PREF_MCP=${MCP_PREFERRED_PORT:-$DEFAULT_MCP}

CLI_TS="$HOME/programming/port-registry/src/cli.ts"
CLI_RUN=(bun run "$CLI_TS")

log() { echo "[sync-ports] $*" 1>&2; }

has_cli() { [ -f "$CLI_TS" ] || return 1; command -v bun >/dev/null 2>&1 || return 1; }

is_valid_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ]
}

sanitize_port() {
  local port="$1" fallback="$2"
  if is_valid_port "$port"; then
    echo "$port"
  else
    echo "$fallback"
  fi
}

is_listening() {
  local port="$1"
  is_valid_port "$port" || return 1
  ss -tulnp 2>/dev/null | grep -q ":$port "
}

find_free_port() {
  local start="$1"
  is_valid_port "$start" || return 1
  local end=$((start+100))
  if [ "$end" -gt 65535 ]; then end=65535; fi
  for ((p=start; p<=end; p++)); do
    if ! is_listening "$p"; then
      echo "$p"; return 0
    fi
  done
  return 1
}

reserve_with_cli() {
  local component="$1"; local preferred="$2"
  local out port
  if out=$("${CLI_RUN[@]}" reserve --component "$component" --preferred "$preferred" 2>/dev/null); then
    port=$(echo "$out" | grep -Eo '^[0-9]+$' | tail -n1)
    if is_valid_port "$port"; then
      echo "$port"
      return 0
    fi
  fi
  return 1
}

choose_port() {
  local component="$1"; local preferred="$2"
  local port fallback="$DEFAULT_MCP"
  if [ "$component" = "http-api" ]; then fallback="$DEFAULT_HTTP"; fi
  preferred=$(sanitize_port "$preferred" "$fallback")
  if has_cli; then
    if port=$(reserve_with_cli "$component" "$preferred"); then
      echo "$port"; return 0
    fi
  fi
  # Fallback: choose free port locally (no reservation)
  find_free_port "$preferred"
}

ensure_distinct() {
  local a="$1" b="$2" next
  if [ "$a" = "$b" ]; then
    # Re-enter the chooser so registry-backed runs reserve the collision replacement.
    next=$((b + 1))
    if [ "$next" -gt 65535 ]; then next="$PREF_MCP"; fi
    choose_port mcp-http "$next"
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

PREF_HTTP=$(sanitize_port "$PREF_HTTP" "$DEFAULT_HTTP")
PREF_MCP=$(sanitize_port "$PREF_MCP" "$DEFAULT_MCP")

# Load existing ports if present to keep stability
CUR_HTTP=""; CUR_MCP=""
if [ -f "$ENV_FILE" ]; then
  CUR_HTTP=$(grep -E '^HTTP_API_PORT=' "$ENV_FILE" | cut -d= -f2- || true)
  CUR_MCP=$(grep -E '^MCP_HTTP_PORT=' "$ENV_FILE" | cut -d= -f2- || true)
fi
if ! is_valid_port "$CUR_HTTP"; then CUR_HTTP=""; fi
if ! is_valid_port "$CUR_MCP"; then CUR_MCP=""; fi

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

