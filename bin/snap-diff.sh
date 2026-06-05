#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <SNAPSHOT_ID>" >&2
  echo "Shows .ontology/snapshots/<id>/overlay.diff using delta if available (fallback: cat)." >&2
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

SNAP_ID="$1"
if [[ ! "$SNAP_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "Invalid snapshot id: $SNAP_ID" >&2
  exit 2
fi
SNAP_ROOT=".ontology/snapshots"
SNAP_DIR="$SNAP_ROOT/$SNAP_ID"
DIFF_PATH="$SNAP_DIR/overlay.diff"

if [[ ! -f "$DIFF_PATH" ]]; then
  echo "No overlay.diff for snapshot $SNAP_ID at $DIFF_PATH" >&2
  exit 2
fi

if [[ -L "$SNAP_DIR" || -L "$DIFF_PATH" ]]; then
  echo "Refusing symlinked snapshot artifact for snapshot $SNAP_ID" >&2
  exit 2
fi

ROOT_REAL=$(realpath "$SNAP_ROOT")
DIFF_REAL=$(realpath "$DIFF_PATH")
case "$DIFF_REAL" in
  "$ROOT_REAL"/*) ;;
  *)
    echo "Refusing snapshot diff outside $SNAP_ROOT for snapshot $SNAP_ID" >&2
    exit 2
    ;;
esac

if command -v delta >/dev/null 2>&1; then
  # Render without paging; hide file headers to focus on hunks
  delta --paging=never --file-style=omit "$DIFF_PATH"
else
  cat "$DIFF_PATH"
fi

