#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
core_project_default="${ROCS_CORE_PROJECT:-$HOME/ai-society/core/rocs-cli}"

say() {
  printf '%s\n' "$*"
}

err() {
  printf '%s\n' "$*" >&2
}

die() {
  err "error: $*"
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

path_fallback_enabled() {
  case "${ROCS_ALLOW_PATH_FALLBACK:-0}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

python_cmd() {
  if has_cmd python3; then
    printf '%s\n' "python3"
    return 0
  fi

  if has_cmd python; then
    printf '%s\n' "python"
    return 0
  fi

  return 1
}

usage() {
  cat <<'EOF'
usage: scripts/rocs.sh [--doctor|--which|--help] [rocs args...]

Portable ROCS launcher with deterministic resolution order:
  1) ROCS_BIN override
  2) vendored ./tools/rocs-cli
  3) local rocs-cli project (this repo)
  4) workspace core ~/ai-society/core/rocs-cli (or ROCS_CORE_PROJECT)
  5) rocs on PATH only when ROCS_ALLOW_PATH_FALLBACK=1

Examples:
  ./scripts/rocs.sh version
  ./scripts/rocs.sh validate --repo .
  ./scripts/rocs.sh --doctor
  ./scripts/rocs.sh --which
EOF
}

toml_declares_rocs_cli() {
  toml_file="$1"
  [ -f "$toml_file" ] || return 1
  grep -Eq "^[[:space:]]*name[[:space:]]*=[[:space:]]*['\"]?rocs-cli['\"]?[[:space:]]*(#.*)?$" "$toml_file"
}

has_vendored_rocs_dir() {
  [ -d "$repo_root/tools/rocs-cli" ]
}

is_vendored_rocs_project() {
  has_vendored_rocs_dir || return 1

  if toml_declares_rocs_cli "$repo_root/tools/rocs-cli/pyproject.toml"; then
    return 0
  fi

  [ -f "$repo_root/tools/rocs-cli/setup.py" ]
}

is_local_rocs_project() {
  toml_declares_rocs_cli "$repo_root/pyproject.toml"
}

select_runner() {
  if [ -n "${ROCS_BIN:-}" ]; then
    if [ -x "$ROCS_BIN" ] || command -v "$ROCS_BIN" >/dev/null 2>&1; then
      printf '%s\n' "rocs-bin"
      return
    fi
    printf '%s\n' "rocs-bin-missing"
    return
  fi

  if is_vendored_rocs_project; then
    if has_cmd uvx; then
      printf '%s\n' "vendored-uvx"
      return
    fi
    if has_cmd uv; then
      printf '%s\n' "vendored-uv"
      return
    fi
    printf '%s\n' "vendored-missing-runtime"
    return
  fi

  if is_local_rocs_project; then
    if has_cmd uv; then
      printf '%s\n' "local-project-uv"
      return
    fi
    if python_bin="$(python_cmd 2>/dev/null)"; then
      printf 'local-project-%s\n' "$python_bin"
      return
    fi
  fi

  if [ -d "$core_project_default" ] && [ -f "$core_project_default/pyproject.toml" ] && has_cmd uv; then
    printf '%s\n' "workspace-core-uv"
    return
  fi

  if has_cmd rocs; then
    if path_fallback_enabled; then
      printf '%s\n' "path-rocs"
    else
      printf '%s\n' "path-rocs-blocked"
    fi
    return
  fi

  printf '%s\n' "missing"
}

runner_desc() {
  case "$1" in
    rocs-bin)
      printf 'ROCS_BIN=%s\n' "${ROCS_BIN}"
      ;;
    rocs-bin-missing)
      printf 'ROCS_BIN is set but not executable/resolvable (%s)\n' "${ROCS_BIN}"
      ;;
    vendored-uvx)
      printf 'vendored via uvx: %s\n' "$repo_root/tools/rocs-cli"
      ;;
    vendored-uv)
      printf 'vendored via uv tool run: %s\n' "$repo_root/tools/rocs-cli"
      ;;
    vendored-missing-runtime)
      printf 'vendored found but missing uv/uvx: %s\n' "$repo_root/tools/rocs-cli"
      ;;
    local-project-uv)
      printf 'local rocs-cli project via uv --project %s\n' "$repo_root"
      ;;
    local-project-python|local-project-python3)
      python_bin="${1#local-project-}"
      printf 'local rocs-cli project via PYTHONPATH=%s/src %s -m rocs_cli (%s)\n' "$repo_root" "$python_bin" "$repo_root"
      ;;
    workspace-core-uv)
      printf 'workspace core via uv --project %s\n' "$core_project_default"
      ;;
    path-rocs)
      printf 'rocs on PATH (%s) with explicit ROCS_ALLOW_PATH_FALLBACK=1\n' "$(command -v rocs)"
      ;;
    path-rocs-blocked)
      printf 'rocs on PATH is available (%s) but blocked by default; set ROCS_ALLOW_PATH_FALLBACK=1 or ROCS_BIN=/absolute/path/to/rocs\n' "$(command -v rocs)"
      ;;
    missing)
      printf 'unresolved (no viable rocs runner)\n'
      ;;
    *)
      printf 'unknown runner token: %s\n' "$1"
      ;;
  esac
}

doctor() {
  runner="$(select_runner)"

  say "rocs launcher doctor"
  say "- repo_root: $repo_root"
  say "- core_project_default: $core_project_default"
  say "- has uv: $(has_cmd uv && printf yes || printf no)"
  say "- has uvx: $(has_cmd uvx && printf yes || printf no)"
  say "- has python3: $(has_cmd python3 && printf yes || printf no)"
  say "- has python: $(has_cmd python && printf yes || printf no)"
  say "- has rocs on PATH: $(has_cmd rocs && printf yes || printf no)"
  say "- path fallback enabled: $(path_fallback_enabled && printf yes || printf no)"
  say "- has vendored tools/rocs-cli dir: $(has_vendored_rocs_dir && printf yes || printf no)"
  say "- vendored tools/rocs-cli is valid project: $(is_vendored_rocs_project && printf yes || printf no)"
  say "- local project is rocs-cli: $(is_local_rocs_project && printf yes || printf no)"
  say "- selected runner: $(runner_desc "$runner")"

  case "$runner" in
    missing|vendored-missing-runtime|rocs-bin-missing|path-rocs-blocked)
      return 1
      ;;
  esac
  return 0
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--doctor" ]; then
  doctor
  exit $?
fi

runner="$(select_runner)"

if [ "${1:-}" = "--which" ]; then
  runner_desc "$runner"
  case "$runner" in
    missing|vendored-missing-runtime|rocs-bin-missing|path-rocs-blocked)
      exit 1
      ;;
  esac
  exit 0
fi

case "$runner" in
  rocs-bin)
    exec "$ROCS_BIN" "$@"
    ;;
  rocs-bin-missing)
    die "ROCS_BIN is set but not executable/resolvable: $ROCS_BIN"
    ;;
  vendored-uvx)
    exec uvx -n --from "$repo_root/tools/rocs-cli" rocs "$@"
    ;;
  vendored-uv)
    exec uv tool run --from "$repo_root/tools/rocs-cli" rocs "$@"
    ;;
  vendored-missing-runtime)
    die "vendored tools/rocs-cli detected but uv/uvx is missing"
    ;;
  local-project-uv)
    exec uv --project "$repo_root" run rocs "$@"
    ;;
  local-project-python|local-project-python3)
    python_bin="${runner#local-project-}"
    PYTHONPATH="$repo_root/src${PYTHONPATH:+:$PYTHONPATH}" exec "$python_bin" -m rocs_cli "$@"
    ;;
  workspace-core-uv)
    exec uv --project "$core_project_default" run rocs "$@"
    ;;
  path-rocs)
    exec rocs "$@"
    ;;
  path-rocs-blocked)
    die "rocs on PATH is available but blocked by default; set ROCS_ALLOW_PATH_FALLBACK=1 for an explicit ambient fallback, set ROCS_BIN=/absolute/path/to/rocs, or provide the vendored/workspace-core rocs-cli"
    ;;
  *)
    die "unable to locate rocs runner; set ROCS_BIN=/absolute/path/to/rocs, provide the vendored/workspace-core rocs-cli, or explicitly allow rocs on PATH with ROCS_ALLOW_PATH_FALLBACK=1"
    ;;
esac
