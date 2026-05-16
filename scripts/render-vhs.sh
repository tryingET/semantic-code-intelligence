#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root_dir"

if ! command -v vhs >/dev/null 2>&1; then
  echo "Error: 'vhs' is not installed. Install from https://github.com/charmbracelet/vhs#installation" >&2
  exit 1
fi

mkdir -p docs/videos

shopt -s nullglob
pattern="${1:-*.tape}"
shopt -s nullglob
for tape in vhs/$pattern; do
  echo "Rendering $tape..."
  if ! vhs "$tape"; then
    echo "Warning: failed to render $tape (continuing)" >&2
  fi
done
echo "All tapes rendered to docs/videos/"
