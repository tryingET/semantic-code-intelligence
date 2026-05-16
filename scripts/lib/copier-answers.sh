#!/usr/bin/env sh

# Shared helpers for reading simple scalar values from .copier-answers.yml.
# Intended to be sourced by other shell scripts.
#
# Resolution strategy:
#  1) Prefer python + PyYAML when available for exact parsing.
#  2) Fall back to a narrow single-line shell parser.
#
# The fallback intentionally fails closed for multi-line/escaped scalars rather
# than silently corrupting values.

copier_answers__python() {
	if [ "${COPIER_ANSWERS_BASE_PYTHON:-__unset__}" = "__unset__" ]; then
		COPIER_ANSWERS_BASE_PYTHON=""

		for candidate in python3 python; do
			if command -v "$candidate" >/dev/null 2>&1; then
				COPIER_ANSWERS_BASE_PYTHON="$candidate"
				break
			fi
		done
	fi

	[ -n "${COPIER_ANSWERS_BASE_PYTHON:-}" ] || return 1
	printf '%s\n' "$COPIER_ANSWERS_BASE_PYTHON"
}

copier_answers__python_with_yaml() {
	if [ "${COPIER_ANSWERS_PYTHON:-__unset__}" = "__unset__" ]; then
		COPIER_ANSWERS_PYTHON=""

		python_bin="$(copier_answers__python 2>/dev/null || true)"
		if [ -n "$python_bin" ] && "$python_bin" - <<'PY' >/dev/null 2>&1; then
import yaml
PY
			COPIER_ANSWERS_PYTHON="$python_bin"
		fi
	fi

	[ -n "${COPIER_ANSWERS_PYTHON:-}" ] || return 1
	printf '%s\n' "$COPIER_ANSWERS_PYTHON"
}

copier_answers__scalar_with_python() {
	answers_file="$1"
	key="$2"
	python_bin="$(copier_answers__python_with_yaml)" || return 1

	"$python_bin" - "$answers_file" "$key" <<'PY'
import sys
import yaml

path, key = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as handle:
    data = yaml.safe_load(handle)

if not isinstance(data, dict) or key not in data:
    raise SystemExit(1)

value = data[key]
if value is None:
    raise SystemExit(1)

if isinstance(value, (dict, list, tuple, set)):
    raise SystemExit(2)

if isinstance(value, bool):
    sys.stdout.write("true" if value else "false")
else:
    sys.stdout.write(str(value))
PY
}

copier_answers__scalar_fallback() {
	answers_file="$1"
	key="$2"

	awk -v key="$key" '
    function trim(value) {
      sub(/^[ \t]+/, "", value)
      sub(/[ \t]+$/, "", value)
      return value
    }

    function parse_single_line_single_quoted(value,    body, out, i, c, nextc, rest) {
      body = substr(value, 2)
      out = ""

      for (i = 1; i <= length(body); i++) {
        c = substr(body, i, 1)

        if (c == "\047") {
          nextc = substr(body, i + 1, 1)
          if (nextc == "\047") {
            out = out "\047"
            i++
            continue
          }

          rest = trim(substr(body, i + 1))
          if (rest != "") {
            return "__unsupported__"
          }
          return out
        }

        out = out c
      }

      return "__unsupported__"
    }

    function parse_single_line_double_quoted(value,    body, out, i, c, rest, escaped) {
      body = substr(value, 2)
      out = ""
      escaped = 0

      for (i = 1; i <= length(body); i++) {
        c = substr(body, i, 1)

        if (escaped) {
          if (c == "\"" || c == "\\") {
            out = out c
          } else {
            return "__unsupported__"
          }
          escaped = 0
          continue
        }

        if (c == "\\") {
          escaped = 1
          continue
        }

        if (c == "\"") {
          rest = trim(substr(body, i + 1))
          if (rest != "") {
            return "__unsupported__"
          }
          return out
        }

        out = out c
      }

      return "__unsupported__"
    }

    BEGIN {
      status = 1
    }

    {
      if ($0 ~ /^[[:space:]]*#/) {
        next
      }

      if ($0 !~ "^[[:space:]]*" key "[[:space:]]*:") {
        next
      }

      value = $0
      sub("^[[:space:]]*" key "[[:space:]]*:[[:space:]]*", "", value)
      value = trim(value)

      if (value ~ /^"/) {
        value = parse_single_line_double_quoted(value)
        if (value == "__unsupported__") {
          status = 2
          exit
        }
        print value
        status = 0
        exit
      }

      if (value ~ /^\047/) {
        value = parse_single_line_single_quoted(value)
        if (value == "__unsupported__") {
          status = 2
          exit
        }
        print value
        status = 0
        exit
      }

      # Reject block-scalar markers, flow collections, and anchors/tags.
      # These are not simple scalars and the fallback cannot parse them correctly.
      if (value ~ /^[|>]$/ || value ~ /^[|>][[:space:]]/ || value ~ /^[\[\{]/ || value ~ /^&/ || value ~ /^\*/ || value ~ /^!/) {
        status = 2
        exit
      }

      sub(/[[:space:]]+#.*$/, "", value)
      value = trim(value)

      # Also reject unquoted values that look like block/folded markers after trim.
      if (value == "|" || value == ">" || value ~ /^[\[\{]/ || value ~ /^&/ || value ~ /^\*/ || value ~ /^!/) {
        status = 2
        exit
      }

      print value
      status = 0
      exit
    }

    END {
      exit status
    }
  ' "$answers_file"
}

copier_answers_scalar() {
	answers_file="$1"
	key="$2"

	[ -f "$answers_file" ] || return 1

	if copier_answers__python_with_yaml >/dev/null 2>&1; then
		copier_answers__scalar_with_python "$answers_file" "$key"
		return $?
	fi

	copier_answers__scalar_fallback "$answers_file" "$key"
}

copier_answers_try_scalar() {
	value=""
	status=0

	value="$(copier_answers_scalar "$1" "$2" 2>/dev/null)" || status=$?

	if [ "$status" -eq 0 ]; then
		printf '%s\n' "$value"
		return 0
	fi

	[ "$status" -eq 1 ] && return 0
	return "$status"
}

copier_answers_lower_scalar() {
	value=""
	status=0

	value="$(copier_answers_scalar "$1" "$2" 2>/dev/null)" || status=$?

	if [ "$status" -eq 0 ]; then
		[ -n "$value" ] || return 1
		printf '%s\n' "$value" | tr '[:upper:]' '[:lower:]'
		return 0
	fi

	[ "$status" -eq 1 ] || return "$status"
	return 1
}

copier_answers_try_lower_scalar() {
	value=""
	status=0

	value="$(copier_answers_try_scalar "$1" "$2" 2>/dev/null)" || status=$?

	if [ "$status" -eq 0 ]; then
		[ -n "$value" ] || return 0
		printf '%s\n' "$value" | tr '[:upper:]' '[:lower:]'
		return 0
	fi

	return "$status"
}

copier_answers_json_scalar() {
	json_file="$1"
	key="$2"

	[ -f "$json_file" ] || return 1

	python_bin="$(copier_answers__python 2>/dev/null || true)"
	[ -n "$python_bin" ] || return 2

	"$python_bin" - "$json_file" "$key" <<'PY'
import json
import sys

path, key = sys.argv[1], sys.argv[2]

try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except FileNotFoundError:
    raise SystemExit(1)
except Exception:
    raise SystemExit(2)

if not isinstance(data, dict) or key not in data:
    raise SystemExit(1)

value = data[key]
if value is None:
    raise SystemExit(1)

if isinstance(value, (dict, list, tuple)):
    raise SystemExit(2)

if isinstance(value, bool):
    sys.stdout.write("true" if value else "false")
else:
    sys.stdout.write(str(value))
PY
}

copier_answers_l1_preview_keys() {
	cat <<'EOF'
company_slug
company_name
maintainer_handle
l1_org_docs_profile
l2_org_docs_default
enable_vouch_gate
enable_community_pack
enable_release_pack
EOF
}
