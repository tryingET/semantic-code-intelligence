#!/usr/bin/env sh
set -eu

canonical_dir() {
  path="$1"

  CDPATH= cd -- "$path" 2>/dev/null && pwd -P
}

repo_root="$(canonical_dir "$(dirname -- "$0")/..")"
cd "$repo_root"

fail() {
  echo "error: $*" >&2
  exit 1
}

python_exec=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    python_exec="$candidate"
    break
  fi
done
[ -n "$python_exec" ] || fail "missing dependency: python3 or python"

AK_CMD="${AK_CMD:-ak}"
command -v "$AK_CMD" >/dev/null 2>&1 || fail "missing ak command: $AK_CMD"

helper="./scripts/lib/check-task-scope-snapshots.py"
[ -f "$helper" ] || fail "missing required helper: $helper"

exec "$python_exec" "$helper" \
  --repo-root "$repo_root" \
  --ak "$AK_CMD" \
  --snapshots-dir "./governance/task-scopes"
