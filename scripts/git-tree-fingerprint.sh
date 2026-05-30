#!/usr/bin/env bash
set -euo pipefail

# Print a content-sensitive fingerprint of the current git working tree.
# Includes tracked status, unstaged/staged diffs, and untracked file contents.
# Tests use this to fail closed when a runner mutates the checkout.

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'not-a-git-worktree\n'
  exit 0
fi

{
  printf 'status\0'
  git status --porcelain=v1 -z --untracked-files=normal || true
  printf 'diff\0'
  git diff --binary || true
  printf 'cached-diff\0'
  git diff --cached --binary || true
  printf 'untracked\0'
  git ls-files --others --exclude-standard -z | python3 -c 'import hashlib, os, sys
paths = sorted(p for p in sys.stdin.buffer.read().split(b"\0") if p)
for raw in paths:
    path = os.fsdecode(raw)
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        print(f"{digest.hexdigest()}  {path}")
    except OSError as exc:
        print(f"ERROR {path}: {exc}")'
} | sha256sum | awk '{print $1}'
