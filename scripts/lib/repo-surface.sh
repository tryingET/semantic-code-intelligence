#!/usr/bin/env sh

# Shared helpers for reasoning about git repos, worktrees, and lane-root
# control-plane surfaces. Intended to be sourced by other shell scripts.

repo_surface_is_git_repo() {
  repo_surface__repo_path="$1"
  repo_surface__repo_root="$(CDPATH= cd -- "$repo_surface__repo_path" 2>/dev/null && pwd -P)" || return 1
  repo_surface__git_root="$(git -C "$repo_surface__repo_path" rev-parse --show-toplevel 2>/dev/null)" || return 1
  repo_surface__git_root="$(CDPATH= cd -- "$repo_surface__git_root" 2>/dev/null && pwd -P)" || return 1
  [ "$repo_surface__repo_root" = "$repo_surface__git_root" ]
}

repo_surface_find_repo_roots() {
  repo_surface__scope="$1"
  [ -d "$repo_surface__scope" ] || return 1

  find -L "$repo_surface__scope" \( -type d -o -type f \) -name .git -print | while IFS= read -r repo_surface__git_marker; do
    [ -n "$repo_surface__git_marker" ] || continue
    repo_surface__repo_path="${repo_surface__git_marker%/.git}"
    repo_surface_is_git_repo "$repo_surface__repo_path" || continue
    printf '%s\n' "$repo_surface__repo_path"
  done | LC_ALL=C sort -u
}

repo_surface_find_nested_repo_roots() {
  repo_surface__scope="$1"
  [ -d "$repo_surface__scope" ] || return 1

  find -L "$repo_surface__scope" -mindepth 2 \( -type d -o -type f \) -name .git -print | while IFS= read -r repo_surface__git_marker; do
    [ -n "$repo_surface__git_marker" ] || continue
    repo_surface__repo_path="${repo_surface__git_marker%/.git}"
    repo_surface_is_git_repo "$repo_surface__repo_path" || continue
    printf '%s\n' "$repo_surface__repo_path"
  done | LC_ALL=C sort -u
}

repo_surface_lane_name_has_valid_syntax() {
  repo_surface__lane_name="$1"

  case "$repo_surface__lane_name" in
    */*|.|..)
      return 1
      ;;
  esac

  case "$repo_surface__lane_name" in
    [A-Za-z0-9]*)
      case "$repo_surface__lane_name" in
        *[!A-Za-z0-9._-]*)
          return 1
          ;;
      esac
      ;;
    *)
      return 1
      ;;
  esac

  return 0
}

repo_surface_is_builtin_lane_name() {
  case "$1" in
    owned|contrib|infra|agents)
      return 0
      ;;
  esac

  return 1
}

repo_surface_is_reserved_lane_name() {
  case "$1" in
    contracts|copier|diary|docs|examples|external|governance|metrics|ontology|policy|scripts|src|tests|tips)
      return 0
      ;;
  esac

  return 1
}

repo_surface_lane_name_is_bootstrap_allowed() {
  repo_surface__lane_name="$1"

  repo_surface_lane_name_has_valid_syntax "$repo_surface__lane_name" || return 1
  repo_surface_is_builtin_lane_name "$repo_surface__lane_name" && return 0
  repo_surface_is_reserved_lane_name "$repo_surface__lane_name" && return 1

  return 0
}

repo_surface_lane_name_is_listed() {
  repo_surface__lane_name="$1"
  shift

  for repo_surface__known_lane_name in "$@"; do
    [ "$repo_surface__lane_name" = "$repo_surface__known_lane_name" ] && return 0
  done

  return 1
}

repo_surface_lane_root_src_path() {
  printf '../copier/tpl-project-repo\n'
}

repo_surface_is_tpl_project_src_path() {
  case "$1" in
    ../copier/tpl-project-repo|./copier/tpl-project-repo|copier/tpl-project-repo|*/copier/tpl-project-repo|__VOLATILE_SRC_PATH__)
      return 0
      ;;
  esac

  return 1
}
