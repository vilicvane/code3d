#!/usr/bin/env python3
"""Read-only candidate discovery for Codex's periodic worktree review."""

from __future__ import annotations

import argparse
import fcntl
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

REGENERABLE_DIRECTORIES = {"node_modules", "dist", "bld", ".cache", ".astro"}
ACTIVE_QUEUE_STATES = {"waiting", "claimed", "merging", "testing"}
GIT_OPERATIONS = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "BISECT_START", "index.lock")


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "--no-optional-locks", "-C", str(repo), *args],
        check=check, capture_output=True, text=True, timeout=120,
    )


def emit(**event: object) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def worktrees(repo: Path) -> list[dict[str, str]]:
    result = []
    current: dict[str, str] = {}
    for field in git(repo, "worktree", "list", "--porcelain", "-z").stdout.split("\0"):
        if not field:
            if current:
                result.append(current)
                current = {}
        else:
            key, _, value = field.partition(" ")
            current[key] = value
    return result


def disposable(path: str) -> bool:
    parts = Path(path.rstrip("/")).parts
    return (
        any(part in REGENERABLE_DIRECTORIES for part in parts)
        or parts[-1] == ".DS_Store"
        or (len(parts) == 3 and parts[0] == "packages" and parts[2] == "LICENSE")
    )


def inspect(
    primary: Path, record: dict[str, str], state: dict, cutoff: float, base: str,
) -> tuple[str | None, str | None]:
    root = Path(record["worktree"])
    if root == primary:
        return "primary", None
    if root.is_symlink() or root.parent != primary.parent or not root.name.startswith(primary.name + "-"):
        return "outside-sibling-scope", None
    if not root.is_dir() or "prunable" in record:
        return "missing-directory", None
    if "locked" in record:
        return "git-worktree-locked", None
    owners = [a for a in state["agents"].values() if a.get("worktree") == str(root)]
    if any(a.get("status") not in {"done", "integrated"} for a in owners):
        return "unfinished-task", None
    if any(a.get("server", {}).get("state") in {"running", "reserved"} for a in owners):
        return "registered-server", None
    if any(q.get("worktree") == str(root) and q.get("state") in ACTIVE_QUEUE_STATES for q in state["queue"]):
        return "queued", None
    directory = Path(git(root, "rev-parse", "--absolute-git-dir").stdout.strip())
    if any((directory / name).exists() for name in GIT_OPERATIONS):
        return "git-operation", None
    if (root / ".gitmodules").exists():
        return "submodules", None
    head = git(root, "rev-parse", "HEAD").stdout.strip()
    if git(primary, "merge-base", "--is-ancestor", head, base, check=False).returncode:
        return "unmerged-commit", head
    if git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all").stdout:
        return "dirty", head
    ignored = git(root, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z").stdout
    if any(not disposable(path) for path in ignored.split("\0") if path):
        return "ignored-local-data", head
    paths = [root, root / ".git", directory / "HEAD", directory / "index", directory / "logs/HEAD"]
    paths.extend(root / path for path in git(root, "ls-files", "-z").stdout.split("\0") if path)
    # lstat does not follow tracked symlinks into other workspaces.
    latest = max(path.lstat().st_mtime for path in paths if path.exists() or path.is_symlink())
    for owner in owners:
        for name in ("registered_at", "active_at"):
            if owner.get(name):
                latest = max(latest, datetime.fromisoformat(owner[name].replace("Z", "+00:00")).timestamp())
    if latest > cutoff:
        return "recent-activity", head
    return None, head


def inspect_repository(primary: Path, days: float) -> int:
    common = Path(git(primary, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip())
    if common != primary / ".git":
        raise ValueError("--repo must identify the primary worktree")
    records = worktrees(primary)
    cutoff = time.time() - days * 86400
    eligible = errors = 0
    reasons: dict[str, int] = {}
    for record in records:
        root = Path(record["worktree"])
        # Share the coordinator lock without modifying owner identities or history.
        with (common / "worktree-state.lock").open("r") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                emit(action="skip-run", reason="coordinator-busy")
                return 0
            state = json.loads((primary / ".agents/worktree-state.json").read_text())
            if not isinstance(state.get("agents"), dict) or not isinstance(state.get("queue"), list):
                raise ValueError("invalid coordination state")
            if state.get("integration") or any((common / name).exists() for name in GIT_OPERATIONS):
                emit(action="skip-run", reason="integration-or-git-operation")
                return 0
            try:
                base = git(primary, "rev-parse", "refs/heads/main").stdout.strip()
                reason, head = inspect(primary, record, state, cutoff, base)
                if reason:
                    reasons[reason] = reasons.get(reason, 0) + 1
                    continue
                eligible += 1
                emit(action="candidate", path=str(root), head=head, branch=record.get("branch"))
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                errors += 1
                emit(action="error", path=str(root), error=str(error))
    emit(action="summary", mode="inspection", eligible=eligible, errors=errors, skipped=reasons)
    return 1 if errors else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--days", type=float, default=1)
    args = parser.parse_args()
    if not args.days > 0:
        parser.error("--days must be positive")
    try:
        return inspect_repository(args.repo.resolve(), args.days)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        emit(action="abort", error=str(error))
        return 1


if __name__ == "__main__":
    sys.exit(main())
