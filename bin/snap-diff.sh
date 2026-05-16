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
SNAP_DIR=".ontology/snapshots/$SNAP_ID"
DIFF_PATH="$SNAP_DIR/overlay.diff"

if [[ ! -f "$DIFF_PATH" ]]; then
  echo "No overlay.diff for snapshot $SNAP_ID at $DIFF_PATH" >&2
  exit 2
fi

if command -v delta >/dev/null 2>&1; then
  # Render without paging; hide file headers to focus on hunks
  delta --paging=never --file-style=omit "$DIFF_PATH"
else
  cat "$DIFF_PATH"
fi

