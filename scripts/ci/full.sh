#!/bin/sh
set -eu

script_dir="$(cd "$(dirname "$0")" && pwd)"

"$script_dir/portable.sh"

repo_root="$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null)" || { echo "error: not a git repo" >&2; exit 1; }
AK_CMD="${AK_CMD:-ak}"
cd "$repo_root"

AGENT_SCRIPTS_ROOT="${AGENT_SCRIPTS_ROOT:-$HOME/ai-society/core/agent-scripts}"
node "$AGENT_SCRIPTS_ROOT/scripts/docs-list.mjs" --docs . --strict


if [ -x "./scripts/check-task-scope-snapshots.sh" ]; then
  ./scripts/check-task-scope-snapshots.sh
fi

if [ -x "./scripts/rocs.sh" ] && [ -f "./ontology/manifest.yaml" ]; then
  ./scripts/rocs.sh version
  ./scripts/rocs.sh build --repo . --resolve-refs --clean
  ./scripts/rocs.sh validate --repo . --resolve-refs
fi
