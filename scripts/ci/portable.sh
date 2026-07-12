#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not a git repo" >&2
  exit 2
}
cd "$repo_root"

"$script_dir/smoke.sh"
./scripts/check-task-scope-snapshots.sh --offline
./scripts/migration-hygiene.sh

echo "ok: portable repository integrity"
