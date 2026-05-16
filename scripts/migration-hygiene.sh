#!/usr/bin/env bash
set -euo pipefail

failures=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

info() {
  printf 'OK: %s\n' "$1"
}

# Run from repo root regardless of caller cwd.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

# 1. Broken symlinks are almost always migration residue.
if broken_links="$(find . -xtype l -not -path './.git/*' -print)" && [[ -n "$broken_links" ]]; then
  fail "broken symlinks found:\n$broken_links"
else
  info "no broken symlinks"
fi

# 2. Tracked local/generated artifacts that should not be canonical.
tracked_artifacts="$(git ls-files | grep -E '(^|/)(node_modules|dist|logs|temp|tmp|\.ontology|\.semantic-graph|\.test-results)(/|$)|(^|/).*\.(db|db-wal|db-shm|sqlite|sqlite3|pid|log|orig|bak)$|(^|/)package\.json\.orig$|(^|/)ontology-lsp\.orig$' || true)"
if [[ -n "$tracked_artifacts" ]]; then
  fail "tracked generated/local artifacts found:\n$tracked_artifacts"
else
  info "no tracked generated/local artifacts"
fi

# 3. Old owner/path placeholders. Keep ontology-lsp command/config compatibility, but reject stale owners and absolute migrated homes.
placeholder_hits="$(git grep -n -E '(/home/[^[:space:]"]+|yourusername|your-org|lightningRalf|github\.com/lightningRalf)' -- ':!.git/**' ':!scripts/migration-hygiene.sh' || true)"
if [[ -n "$placeholder_hits" ]]; then
  fail "stale owner/path placeholders found:\n$placeholder_hits"
else
  info "no stale owner/path placeholders"
fi

# 4. Applyable Kubernetes secrets with placeholder credentials are unsafe. Templates must not be .yaml under k8s/.
if git ls-files 'k8s/*.yaml' 'k8s/*.yml' | xargs -r grep -n -E 'CHANGE_ME|changeme|OPENAI_API_KEY|ANTHROPIC_API_KEY' >/tmp/migration-hygiene-k8s.$$ 2>/dev/null; then
  fail "applyable Kubernetes manifest contains placeholder secret material:\n$(cat /tmp/migration-hygiene-k8s.$$)"
else
  info "no applyable Kubernetes placeholder secrets"
fi
rm -f /tmp/migration-hygiene-k8s.$$

# 5. Package and lock identity should agree after rename.
if [[ -f package.json && -f bun.lock ]]; then
  package_name="$(python3 - <<'PY'
import json
print(json.load(open('package.json'))['name'])
PY
)"
  if ! grep -q '"name": "'"$package_name"'"' bun.lock; then
    fail "bun.lock workspace name does not match package.json name '$package_name'"
  else
    info "bun.lock package name matches package.json"
  fi
fi

if (( failures > 0 )); then
  printf '\nMigration hygiene failed with %d issue(s).\n' "$failures" >&2
  exit 1
fi

printf '\nMigration hygiene passed.\n'
