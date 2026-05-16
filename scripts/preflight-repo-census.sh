#!/usr/bin/env bash
set -euo pipefail

# Deterministic repo census fallback for environments without ~/.pi/agent/scripts/preflight-repo-census.sh
# Usage: ./scripts/preflight-repo-census.sh [scope]

SCOPE="${1:-.}"

if [ ! -d "$SCOPE" ]; then
	echo "error: scope not found: $SCOPE" >&2
	exit 1
fi

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
repo_surface_lib="$repo_root/scripts/lib/repo-surface.sh"
if [ ! -f "$repo_surface_lib" ]; then
	echo "error: missing dependency: $repo_surface_lib" >&2
	exit 2
fi
# shellcheck source=/dev/null
. "$repo_surface_lib"

mapfile -t REPOS < <(repo_surface_find_repo_roots "$SCOPE")
repo_count="$(printf '%s\n' "${REPOS[@]-}" | sed '/^$/d' | wc -l | tr -d ' ')"

echo "scope: $SCOPE"
echo "repos: ${repo_count:-0}"
echo
printf '%-45s %-28s %-8s\n' "REPO" "BRANCH" "DIRTY"
printf '%-45s %-28s %-8s\n' "----" "------" "-----"

for repo in "${REPOS[@]}"; do
	if ! repo_surface_is_git_repo "$repo"; then
		printf '%-45s %-28s %-8s\n' "$repo" "(not-git)" "n/a"
		continue
	fi

	branch="$(git -C "$repo" branch --show-current 2>/dev/null || true)"
	if [ -z "$branch" ]; then
		branch="(detached)"
	fi

	dirty_count="$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
	dirty="clean"
	if [ "${dirty_count:-0}" -gt 0 ]; then
		dirty="dirty:$dirty_count"
	fi

	printf '%-45s %-28s %-8s\n' "$repo" "$branch" "$dirty"
done
