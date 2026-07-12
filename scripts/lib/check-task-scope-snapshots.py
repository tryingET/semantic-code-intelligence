#!/usr/bin/env python3
"""Validate frozen AK task-scope exports.

Default mode reconciles each snapshot with live Agent Kernel authority. Offline
mode validates only the checked-in snapshot contract and is safe for generic CI
runners that do not have an AK database.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def die(message: str, code: int = 1) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(code)


def load_json_file(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        die(f"{label} missing: {path}")
    except json.JSONDecodeError as exc:
        die(
            f"{label} is not valid JSON: {path} "
            f"({exc.msg} at line {exc.lineno}, column {exc.colno})"
        )


def normalize_snapshot(payload: Any, label: str) -> Any:
    if not isinstance(payload, dict):
        die(f"{label} must be a JSON object")
    normalized = dict(payload)
    normalized.pop("exported_at", None)
    normalized.pop("commit_sha", None)
    return normalized


def json_text(payload: Any) -> str:
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def resolve_ak_command(raw_value: str) -> list[str]:
    if "/" in raw_value:
        ak_path = Path(raw_value)
        if not ak_path.exists():
            die(f"missing executable: {ak_path}")
        return [str(ak_path)]
    resolved = shutil.which(raw_value)
    if resolved is None:
        die(f"missing ak command on PATH: {raw_value}")
    return [resolved]


def run_ak(repo_root: Path, ak_cmd: list[str], args: list[str], label: str) -> str:
    result = subprocess.run(
        [*ak_cmd, *args],
        cwd=str(repo_root),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        die(f"{label}: {detail}" if detail else label)
    return result.stdout


def run_ak_json(repo_root: Path, ak_cmd: list[str], args: list[str], label: str) -> Any:
    stdout = run_ak(repo_root, ak_cmd, args, label)
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        die(
            f"{label}: AK returned invalid JSON "
            f"({exc.msg} at line {exc.lineno}, column {exc.colno})"
        )


def canonical_dir(path_value: str, label: str) -> str:
    try:
        return str(Path(path_value).resolve(strict=True))
    except FileNotFoundError:
        die(f"{label} path does not exist: {path_value}")


def iter_snapshots(snapshots_dir: Path) -> list[Path]:
    return sorted(
        (path for path in snapshots_dir.rglob("AK-*.snapshot.json") if path.is_file()),
        key=lambda path: path.as_posix(),
    )


def task_id_from_filename(snapshot_path: Path) -> str:
    name = snapshot_path.name
    prefix, suffix = "AK-", ".snapshot.json"
    if not name.startswith(prefix) or not name.endswith(suffix):
        die(f"task-scope snapshot filename must use a numeric task id: {snapshot_path}")
    task_id = name[len(prefix) : -len(suffix)]
    if not task_id.isdigit():
        die(f"task-scope snapshot filename must use a numeric task id: {snapshot_path}")
    return task_id


def validate_path_value(value: Any, label: str, allow_glob: bool) -> str:
    if not isinstance(value, str) or not value:
        die(f"{label} must be a non-empty string")
    if "\\" in value or "\0" in value or value.startswith("/") or value.endswith("/"):
        die(f"{label} must be a normalized repo-relative path: {value!r}")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        die(f"{label} must be a normalized repo-relative path: {value!r}")
    if any(char in value for char in "[]"):
        die(f"{label} uses unsupported bracket glob syntax: {value!r}")
    if not allow_glob and any(char in value for char in "*?"):
        die(f"{label} must be an exact path, not a glob: {value!r}")
    return value


def scope_glob_matches(path_value: str, pattern: str) -> bool:
    pieces: list[str] = []
    index = 0
    while index < len(pattern):
        if pattern.startswith("**", index):
            pieces.append(".*")
            index += 2
        elif pattern[index] == "*":
            pieces.append("[^/]*")
            index += 1
        elif pattern[index] == "?":
            pieces.append("[^/]")
            index += 1
        else:
            pieces.append(re.escape(pattern[index]))
            index += 1
    return re.fullmatch("".join(pieces), path_value) is not None


def validate_path_list(value: Any, label: str, allow_glob: bool) -> list[str]:
    if not isinstance(value, list):
        die(f"{label} must be an array")
    paths = [validate_path_value(item, f"{label} entry", allow_glob) for item in value]
    if len(paths) != len(set(paths)):
        die(f"{label} contains duplicate entries")
    return paths


def validate_snapshot_contract(snapshot_path: Path) -> tuple[str, dict[str, Any]]:
    task_id = task_id_from_filename(snapshot_path)
    payload = load_json_file(snapshot_path, "task-scope snapshot")
    if not isinstance(payload, dict):
        die(f"task-scope snapshot must be a JSON object: {snapshot_path}")
    if payload.get("schema_version") != 1:
        die(f"unsupported schema_version in {snapshot_path}")
    if payload.get("task_id") != int(task_id):
        die(f"task_id does not match filename in {snapshot_path}")
    if payload.get("export_tool") != "ak task scope export":
        die(f"unexpected export_tool in {snapshot_path}")
    if payload.get("export_tool_version") != "snapshot-v1":
        die(f"unexpected export_tool_version in {snapshot_path}")
    if not isinstance(payload.get("entity_version"), int) or payload["entity_version"] < 1:
        die(f"invalid entity_version in {snapshot_path}")
    if not isinstance(payload.get("default_applies"), bool):
        die(f"default_applies must be boolean in {snapshot_path}")

    scope = payload.get("scope")
    if not isinstance(scope, dict):
        die(f"scope must be an object in {snapshot_path}")
    allowed = validate_path_list(scope.get("allowed_paths"), f"{snapshot_path} allowed_paths", True)
    required = validate_path_list(scope.get("required_paths"), f"{snapshot_path} required_paths", False)
    forbidden = validate_path_list(scope.get("forbidden_paths"), f"{snapshot_path} forbidden_paths", True)

    for required_path in required:
        if not any(scope_glob_matches(required_path, pattern) for pattern in allowed):
            die(f"required path {required_path!r} is not covered by allowed_paths in {snapshot_path}")
        if any(scope_glob_matches(required_path, pattern) for pattern in forbidden):
            die(f"required path {required_path!r} overlaps forbidden_paths in {snapshot_path}")
    return task_id, payload


def validate_snapshot_live(
    repo_root: Path,
    ak_cmd: list[str],
    snapshot_path: Path,
    task_id: str,
    actual_payload: dict[str, Any],
) -> None:
    task_payload = run_ak_json(
        repo_root,
        ak_cmd,
        ["task", "show", task_id, "-F", "json"],
        f"unable to load AK task {task_id} for snapshot {snapshot_path}",
    )
    task_repo = task_payload.get("repo")
    if not isinstance(task_repo, str) or not task_repo:
        die(f"unable to extract repo for AK task {task_id}")
    task_repo_canonical = canonical_dir(task_repo, f"AK task {task_id} repo")
    if task_repo_canonical != str(repo_root):
        die(
            f"snapshot {snapshot_path} belongs to repo {task_repo} "
            f"(canonical: {task_repo_canonical}), expected {repo_root}"
        )

    exported_payload = run_ak_json(
        repo_root,
        ak_cmd,
        ["task", "scope", "export", task_id],
        f"unable to export AK task scope for task {task_id}",
    )
    expected_normalized = normalize_snapshot(exported_payload, f"AK task scope export {task_id}")
    actual_normalized = normalize_snapshot(actual_payload, f"task-scope snapshot {snapshot_path}")
    if expected_normalized == actual_normalized:
        return

    print(f"error: task-scope snapshot drift detected: {snapshot_path}", file=sys.stderr)
    for line in difflib.unified_diff(
        json_text(expected_normalized).splitlines(keepends=True),
        json_text(actual_normalized).splitlines(keepends=True),
        fromfile=f"AK-{task_id}.expected.normalized.json",
        tofile=f"AK-{task_id}.actual.normalized.json",
    ):
        sys.stderr.write(line)
    print(
        f"hint: refresh with ak task scope export {task_id} > "
        f"governance/task-scopes/AK-{task_id}.snapshot.json",
        file=sys.stderr,
    )
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--ak", default="ak")
    parser.add_argument("--snapshots-dir", required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve(strict=True)
    snapshots_dir = Path(args.snapshots_dir)
    if not snapshots_dir.is_dir():
        print("ok: no task-scope snapshots")
        return
    snapshots = iter_snapshots(snapshots_dir)
    if not snapshots:
        print("ok: no task-scope snapshots")
        return

    ak_cmd = None if args.offline else resolve_ak_command(args.ak)
    for snapshot_path in snapshots:
        task_id, payload = validate_snapshot_contract(snapshot_path)
        if ak_cmd is not None:
            validate_snapshot_live(repo_root, ak_cmd, snapshot_path, task_id, payload)

    mode = "offline contract" if args.offline else "live AK reconciliation"
    print(f"ok: task-scope snapshots ({len(snapshots)} checked; {mode})")


if __name__ == "__main__":
    main()
