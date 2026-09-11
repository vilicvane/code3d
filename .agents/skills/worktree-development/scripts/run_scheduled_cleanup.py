#!/usr/bin/env python3
"""Start a fresh Codex cleanup review; never delete worktrees in the launcher."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

def refresh_herdr(path: Path, stopped: threading.Event) -> None:
    """Expose read-only Herdr state to the isolated Codex session."""
    while not stopped.is_set():
        checked_at = time.time()
        try:
            result = subprocess.run(["herdr", "pane", "list"], capture_output=True,
                                    text=True, check=True, timeout=10)
            panes = json.loads(result.stdout)["result"]["panes"]
            if not isinstance(panes, list):
                raise ValueError("invalid Herdr pane list")
            fields = {"pane_id", "tab_id", "workspace_id", "cwd", "foreground_cwd",
                      "agent", "agent_session", "agent_status"}
            snapshot = {"checked_at": checked_at,
                        "panes": [{k: v for k, v in pane.items() if k in fields} for pane in panes]}
        except (OSError, ValueError, KeyError, AttributeError, subprocess.SubprocessError) as error:
            snapshot = {"checked_at": checked_at, "error": str(error)}
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False))
        temporary.replace(path)
        stopped.wait(5)


def command(codex: str, repo: Path, report: Path, execute: bool) -> list[str]:
    args = [codex, "-a", "never", "exec", "--cd", str(repo), "--color", "never",
            "--json", "--output-last-message", str(report)]
    if execute:
        args.extend(["--sandbox", "workspace-write", "--add-dir", str(repo.parent),
                     "--add-dir", str(repo / ".git")])
    else:
        args.extend(["--sandbox", "read-only"])
    return [*args, "-"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--task", type=Path, required=True)
    parser.add_argument("--inspector", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    codex = shutil.which("codex")
    if not codex:
        parser.error("codex executable is not on PATH")
    os.umask(0o077)
    args.state_dir.mkdir(parents=True, exist_ok=True)
    with (args.state_dir / "run.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("A Codex cleanup review is already running; skipped.")
            return 0
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        report = args.state_dir / f"{stamp}.md"
        events = args.state_dir / f"{stamp}.jsonl"
        herdr_state = args.state_dir / f"{stamp}.herdr.json"
        mode = ("本轮是正式定时清理，允许由你复核后逐个删除符合条件的 worktree。"
                if args.execute else
                "本轮仅做只读验收。禁止删除任何 worktree 或修改 Git/协调状态。"
                "最多抽查 3 个候选来验证入口与判断流程，其余标为未复核，报告保留或建议清理的理由。")
        prompt = (mode + "\n\n" + args.task.read_text()
                  + "\n\n本轮固定参数：\n"
                  + json.dumps({"primary": str(args.repo.resolve()),
                                "inspector": str(args.inspector.resolve()),
                                "herdr_state": str(herdr_state.resolve()),
                                "inactive_hours": 24}, ensure_ascii=False))
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith("HERDR_")
                       and key not in {"CODEX_THREAD_ID", "CODEX_PARENT_THREAD_ID"}}
        print(f"Codex report: {report}", flush=True)
        print(f"Codex events: {events}", flush=True)
        stopped = threading.Event()
        observer = threading.Thread(target=refresh_herdr,
                                    args=(herdr_state, stopped), daemon=True)
        observer.start()
        with events.open("w") as output:
            try:
                result = subprocess.run(command(codex, args.repo.resolve(), report, args.execute),
                                        input=prompt, text=True, stdout=output,
                                        stderr=subprocess.STDOUT, env=environment,
                                        cwd=args.repo, timeout=1500)
            except subprocess.TimeoutExpired:
                print("Codex review timed out; inspect its event log before retrying.", flush=True)
                return 124
            finally:
                stopped.set()
                observer.join(timeout=5)
        print(f"Codex exited: {result.returncode}", flush=True)
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
