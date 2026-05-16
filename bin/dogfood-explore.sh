#!/usr/bin/env bash
set -euo pipefail

# Dogfood: Explore a symbol with optional conceptual hints (Layer 4)
# Usage:
#   bin/dogfood-explore.sh <symbol> [-f <path>] [--no-conceptual] [--precise] [--json]
# Examples:
#   bin/dogfood-explore.sh TestClass -f tests/fixtures --precise
#   bin/dogfood-explore.sh HTTPServer --no-conceptual --json

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <symbol> [-f <path>] [--no-conceptual] [--precise] [--json]" >&2
  exit 1
fi

SYMBOL="$1"; shift || true
FILE=""
CONCEPTUAL=1
PRECISE=0
JSON=0
LIMIT=10

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      FILE="$2"; shift 2;;
    --no-conceptual)
      CONCEPTUAL=0; shift;;
    --precise)
      PRECISE=1; shift;;
    -j|--json)
      JSON=1; shift;;
    -l|--limit)
      LIMIT="$2"; shift 2;;
    *)
      echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

ARGS=("explore" "$SYMBOL" "-n" "100" "-l" "$LIMIT")
[[ -n "$FILE" ]] && ARGS+=("-f" "$FILE")
[[ $CONCEPTUAL -eq 1 ]] && ARGS+=("--conceptual")
[[ $PRECISE -eq 1 ]] && ARGS+=("--precise")
[[ $JSON -eq 1 ]] && ARGS+=("--json")

ontology-lsp "${ARGS[@]}"

