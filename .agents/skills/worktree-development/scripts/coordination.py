#!/usr/bin/env python3
"""Coordinate code3d agents, worktrees, dev servers, and merge queue."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import socket
import subprocess
import sys
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


VERSION = 1
STATE_RELATIVE_PATH = Path(".agents/worktree-state.json")
ACTIVE_QUEUE_STATES = {"waiting", "claimed", "merging", "testing"}


class CoordinationError(RuntimeError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def queue_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    return f"q-{timestamp}-{uuid.uuid4().hex[:8]}"


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise CoordinationError(f"git {' '.join(args)} failed: {message}")
    return result.stdout.strip()


def commit_is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", ancestor, descendant],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode == 0:
        return True
    if result.returncode == 1:
        return False
    raise CoordinationError(
        f"git merge-base --is-ancestor failed: {result.stderr.strip()}"
    )


class Repository:
    def __init__(self, cwd: Path) -> None:
        self.current_root = Path(run_git(cwd, "rev-parse", "--show-toplevel")).resolve()
        common = Path(
            run_git(
                cwd,
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
            )
        ).resolve()
        if common.name != ".git" or not common.is_dir():
            raise CoordinationError(
                f"unsupported repository layout: common Git directory is {common}"
            )
        self.common_git_dir = common
        self.primary_root = common.parent
        self.state_path = self.primary_root / STATE_RELATIVE_PATH
        self.lock_path = common / "worktree-state.lock"

    @property
    def is_primary(self) -> bool:
        return self.current_root == self.primary_root

    def branch(self) -> str:
        return run_git(self.current_root, "branch", "--show-current")

    def head(self) -> str:
        return run_git(self.current_root, "rev-parse", "HEAD")

    def is_clean(self) -> bool:
        return not run_git(
            self.current_root,
            "status",
            "--porcelain",
            "--untracked-files=normal",
        )


def empty_state() -> dict[str, Any]:
    timestamp = now()
    return {
        "version": VERSION,
        "created_at": timestamp,
        "updated_at": timestamp,
        "agents": {},
        "queue": [],
        "integration": None,
    }


def read_state_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return empty_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CoordinationError(f"cannot read {path}: {error}") from error
    if not isinstance(state, dict) or state.get("version") != VERSION:
        raise CoordinationError(f"unsupported coordination state in {path}")
    if not isinstance(state.get("agents"), dict) or not isinstance(
        state.get("queue"), list
    ):
        raise CoordinationError(f"invalid coordination state in {path}")
    return state


def write_state_file(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = now()
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(state, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


@contextmanager
def locked_state(repo: Repository, *, write: bool) -> Iterator[dict[str, Any]]:
    repo.lock_path.parent.mkdir(parents=True, exist_ok=True)
    with repo.lock_path.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX if write else fcntl.LOCK_SH)
        state = read_state_file(repo.state_path)
        yield state
        if write:
            write_state_file(repo.state_path, state)


def agent_id(args: argparse.Namespace) -> str:
    value = args.agent or os.environ.get("HERDR_PANE_ID")
    if not value:
        raise CoordinationError(
            "agent ID is required outside Herdr; pass --agent <stable-id>"
        )
    return value


def herdr_context() -> dict[str, str]:
    variables = {
        "workspace_id": "HERDR_WORKSPACE_ID",
        "tab_id": "HERDR_TAB_ID",
        "pane_id": "HERDR_PANE_ID",
    }
    return {
        field: os.environ[variable]
        for field, variable in variables.items()
        if os.environ.get(variable)
    }


def require_agent(state: dict[str, Any], identity: str) -> dict[str, Any]:
    try:
        return state["agents"][identity]
    except KeyError as error:
        raise CoordinationError(
            f"agent {identity!r} is not registered; run register first"
        ) from error


def require_role_location(repo: Repository, role: str) -> None:
    if role == "development" and repo.is_primary:
        raise CoordinationError("development agents must use a linked worktree")
    if role == "integration" and not repo.is_primary:
        raise CoordinationError("integration agents must use the primary worktree")


def update_agent_location(agent: dict[str, Any], repo: Repository) -> None:
    agent.update(
        {
            "worktree": str(repo.current_root),
            "branch": repo.branch(),
            "head": repo.head(),
            "active_at": now(),
        }
    )
    context = herdr_context()
    if context:
        agent["herdr"] = context


def queue_item(state: dict[str, Any], queue_id: str) -> dict[str, Any]:
    for item in state["queue"]:
        if item.get("id") == queue_id:
            return item
    raise CoordinationError(f"queue item {queue_id!r} does not exist")


def active_item_for_agent(
    state: dict[str, Any], identity: str
) -> dict[str, Any] | None:
    for item in state["queue"]:
        if item.get("agent") == identity and item.get("state") in ACTIVE_QUEUE_STATES:
            return item
    return None


def command_register(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    require_role_location(repo, args.role)
    branch = repo.branch()
    if not branch:
        raise CoordinationError("registered worktrees must be on a branch")
    with locked_state(repo, write=True) as state:
        for other_identity, other in state["agents"].items():
            if (
                other_identity != identity
                and other.get("worktree") == str(repo.current_root)
                and other.get("status") != "done"
            ):
                raise CoordinationError(
                    f"worktree is already assigned to agent {other_identity!r}"
                )
        existing = state["agents"].get(identity, {})
        if existing and existing.get("status") != "done" and (
            existing.get("role") != args.role
            or existing.get("worktree") != str(repo.current_root)
        ):
            raise CoordinationError(
                f"agent {identity!r} is already active as {existing.get('role')} "
                f"in {existing.get('worktree')}"
            )
        registered_at = existing.get("registered_at", now())
        agent = {
            **existing,
            "id": identity,
            "task": args.task,
            "role": args.role,
            "status": "working" if args.role == "development" else "available",
            "registered_at": registered_at,
        }
        update_agent_location(agent, repo)
        if args.note:
            agent["note"] = args.note
        state["agents"][identity] = agent
    print(identity)


def command_init(args: argparse.Namespace, repo: Repository) -> None:
    with locked_state(repo, write=True):
        pass
    print(repo.state_path)


def command_heartbeat(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        require_role_location(repo, agent["role"])
        update_agent_location(agent, repo)
        if args.status:
            agent["status"] = args.status
        if args.note is not None:
            agent["note"] = args.note
    print(identity)


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
        candidate.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            candidate.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def command_reserve_port(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        require_role_location(repo, "development")
        if agent.get("role") != "development":
            raise CoordinationError("only development agents reserve dev-server ports")
        reserved = {
            other["server"]["port"]
            for other in state["agents"].values()
            if isinstance(other.get("server"), dict)
            and isinstance(other["server"].get("port"), int)
        }
        port = next(
            (
                candidate
                for candidate in range(args.start, args.end + 1)
                if candidate not in reserved and port_is_free(candidate)
            ),
            None,
        )
        if port is None:
            raise CoordinationError(
                f"no free development port in {args.start}-{args.end}"
            )
        agent["server"] = {
            "state": "reserved",
            "port": port,
            "reserved_at": now(),
        }
        update_agent_location(agent, repo)
    print(port)


def command_server_started(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        require_role_location(repo, "development")
        server = agent.get("server")
        if not isinstance(server, dict) or server.get("port") != args.port:
            raise CoordinationError(
                f"port {args.port} is not reserved by agent {identity!r}"
            )
        server.update(
            {
                "state": "running",
                "command": args.command,
                "started_at": now(),
                "url": args.url or f"http://127.0.0.1:{args.port}",
            }
        )
        if args.pane_id:
            server["pane_id"] = args.pane_id
        if args.pid is not None:
            server["pid"] = args.pid
        update_agent_location(agent, repo)
    print(args.port)


def command_server_stopped(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        agent.pop("server", None)
        update_agent_location(agent, repo)
    print(identity)


def command_enqueue(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    require_role_location(repo, "development")
    branch = repo.branch()
    if not branch:
        raise CoordinationError("detached HEAD cannot enter the integration queue")
    if not repo.is_clean():
        raise CoordinationError("commit or remove all worktree changes before enqueue")
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        if agent.get("role") != "development":
            raise CoordinationError("only development agents can enqueue work")
        existing = active_item_for_agent(state, identity)
        if existing:
            raise CoordinationError(
                f"agent already has active queue item {existing['id']} "
                f"({existing['state']})"
            )
        timestamp = now()
        item = {
            "id": queue_id(),
            "agent": identity,
            "task": agent["task"],
            "summary": args.summary,
            "worktree": str(repo.current_root),
            "branch": branch,
            "commit": repo.head(),
            "state": "waiting",
            "enqueued_at": timestamp,
            "updated_at": timestamp,
        }
        state["queue"].append(item)
        agent["status"] = "queued"
        update_agent_location(agent, repo)
    print(item["id"])


def command_claim(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    require_role_location(repo, "integration")
    if not repo.is_clean():
        raise CoordinationError(
            "primary worktree must be clean before claiming the queue"
        )
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        if agent.get("role") != "integration":
            raise CoordinationError("only integration agents can claim the queue")
        if state.get("integration") is not None:
            owner = state["integration"]
            raise CoordinationError(
                f"integration queue is owned by {owner['agent']} "
                f"for {owner['queue_id']}"
            )
        item = next(
            (
                candidate
                for candidate in state["queue"]
                if candidate["state"] == "waiting"
            ),
            None,
        )
        if item is None:
            raise CoordinationError("integration queue is empty")
        branch_head = run_git(
            repo.primary_root, "rev-parse", f"refs/heads/{item['branch']}"
        )
        if branch_head != item["commit"]:
            raise CoordinationError(
                f"branch {item['branch']!r} moved from queued commit "
                f"{item['commit']} to {branch_head}; the developer must run retry"
            )
        timestamp = now()
        item.update(
            {
                "state": "claimed",
                "integrator": identity,
                "claimed_at": timestamp,
                "updated_at": timestamp,
            }
        )
        state["integration"] = {
            "queue_id": item["id"],
            "agent": identity,
            "phase": "claimed",
            "claimed_at": timestamp,
            "active_at": timestamp,
        }
        agent["status"] = "integrating"
        agent["note"] = f"claimed {item['id']}: {item['task']}"
        update_agent_location(agent, repo)
        rendered = json.dumps(item, indent=2, sort_keys=True)
    print(rendered)


def owned_integration(
    state: dict[str, Any], identity: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    integration = state.get("integration")
    if not isinstance(integration, dict) or integration.get("agent") != identity:
        raise CoordinationError(f"agent {identity!r} does not own integration")
    return integration, queue_item(state, integration["queue_id"])


def command_phase(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    require_role_location(repo, "integration")
    with locked_state(repo, write=True) as state:
        integration, item = owned_integration(state, identity)
        timestamp = now()
        integration.update({"phase": args.phase, "active_at": timestamp})
        item.update({"state": args.phase, "updated_at": timestamp})
        agent = require_agent(state, identity)
        update_agent_location(agent, repo)
        agent["note"] = args.note or f"{args.phase} {item['id']}"
    print(args.phase)


def command_complete(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    require_role_location(repo, "integration")
    if not repo.is_clean():
        raise CoordinationError(
            "primary worktree must be clean before completing integration"
        )
    with locked_state(repo, write=True) as state:
        _, item = owned_integration(state, identity)
        result_commit = repo.head()
        if not commit_is_ancestor(repo.current_root, item["commit"], result_commit):
            raise CoordinationError(
                f"queued commit {item['commit']} is not integrated into {result_commit}"
            )
        timestamp = now()
        item.update(
            {
                "state": "done",
                "completed_at": timestamp,
                "updated_at": timestamp,
                "result_commit": result_commit,
            }
        )
        developer = state["agents"].get(item["agent"])
        if developer:
            developer["status"] = "integrated"
            developer["active_at"] = timestamp
        integrator = require_agent(state, identity)
        integrator["status"] = "available"
        integrator["note"] = f"completed {item['id']}"
        update_agent_location(integrator, repo)
        state["integration"] = None
    print(item["id"])


def command_block(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    require_role_location(repo, "integration")
    if not repo.is_clean():
        raise CoordinationError(
            "restore the primary worktree to a clean state before releasing a "
            "blocked item"
        )
    with locked_state(repo, write=True) as state:
        _, item = owned_integration(state, identity)
        timestamp = now()
        item.update(
            {
                "state": "blocked",
                "reason": args.reason,
                "updated_at": timestamp,
            }
        )
        developer = state["agents"].get(item["agent"])
        if developer:
            developer["status"] = "blocked"
            developer["note"] = args.reason
            developer["active_at"] = timestamp
        integrator = require_agent(state, identity)
        integrator["status"] = "available"
        integrator["note"] = f"blocked {item['id']}: {args.reason}"
        update_agent_location(integrator, repo)
        state["integration"] = None
    print(item["id"])


def command_retry(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    require_role_location(repo, "development")
    if not repo.branch():
        raise CoordinationError("detached HEAD cannot enter the integration queue")
    if not repo.is_clean():
        raise CoordinationError("commit or remove all worktree changes before retry")
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        candidates = [
            item
            for item in state["queue"]
            if item.get("agent") == identity
            and item.get("state") in {"waiting", "blocked"}
        ]
        if not candidates:
            raise CoordinationError(
                "agent has no waiting or blocked queue item to retry"
            )
        previous = candidates[-1]
        timestamp = now()
        item = {
            "id": queue_id(),
            "agent": identity,
            "task": agent["task"],
            "summary": args.summary or previous["summary"],
            "worktree": str(repo.current_root),
            "branch": repo.branch(),
            "commit": repo.head(),
            "state": "waiting",
            "enqueued_at": timestamp,
            "updated_at": timestamp,
            "retry_of": previous["id"],
        }
        state["queue"].append(item)
        previous["previous_state"] = previous["state"]
        previous["state"] = "superseded"
        previous["retried_as"] = item["id"]
        previous["updated_at"] = timestamp
        agent["status"] = "queued"
        update_agent_location(agent, repo)
    print(item["id"])


def command_finish(args: argparse.Namespace, repo: Repository) -> None:
    identity = agent_id(args)
    with locked_state(repo, write=True) as state:
        agent = require_agent(state, identity)
        require_role_location(repo, agent["role"])
        active = active_item_for_agent(state, identity)
        if active:
            raise CoordinationError(
                f"cannot finish with active queue item {active['id']} "
                f"({active['state']})"
            )
        integration = state.get("integration")
        if isinstance(integration, dict) and integration.get("agent") == identity:
            raise CoordinationError(
                f"cannot finish while owning integration item {integration['queue_id']}"
            )
        update_agent_location(agent, repo)
        agent["status"] = "done"
        agent.pop("server", None)
        if args.note:
            agent["note"] = args.note
    print(identity)


def command_status(args: argparse.Namespace, repo: Repository) -> None:
    with locked_state(repo, write=False) as state:
        snapshot = json.loads(json.dumps(state))
    if args.json:
        print(json.dumps(snapshot, indent=2, sort_keys=True))
        return
    print(f"state: {repo.state_path}")
    integration = snapshot.get("integration")
    if integration:
        print(
            "integration: "
            f"{integration['queue_id']} by {integration['agent']} "
            f"({integration['phase']}, active {integration['active_at']})"
        )
    else:
        print("integration: available")
    print("agents:")
    if not snapshot["agents"]:
        print("  (none)")
    for identity, agent in snapshot["agents"].items():
        herdr = agent.get("herdr", {})
        ids = "/".join(
            value
            for value in (
                herdr.get("workspace_id"),
                herdr.get("tab_id"),
                herdr.get("pane_id"),
            )
            if value
        )
        server = agent.get("server")
        server_text = (
            f", server {server['state']}:{server['port']}" if server else ""
        )
        print(
            f"  {identity}: {agent['role']}/{agent['status']}, "
            f"{agent['branch']} @ {agent['head'][:12]}, active {agent['active_at']}"
            f"{server_text}"
        )
        print(f"    task: {agent['task']}")
        print(f"    worktree: {agent['worktree']}")
        if ids:
            print(f"    herdr: {ids}")
        if agent.get("note"):
            print(f"    note: {agent['note']}")
    print("queue:")
    queued = [
        item
        for item in snapshot["queue"]
        if item["state"] in ACTIVE_QUEUE_STATES or item["state"] == "blocked"
    ]
    if not queued:
        print("  (empty)")
    for item in queued:
        print(
            f"  {item['id']}: {item['state']} {item['branch']} "
            f"@ {item['commit'][:12]} by {item['agent']}"
        )
        print(f"    {item['summary']}")
        if item.get("reason"):
            print(f"    reason: {item['reason']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path.cwd(),
        help="current worktree (default: current directory)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    initialize = subparsers.add_parser(
        "init", help="create the shared coordination state if missing"
    )
    initialize.set_defaults(handler=command_init)

    register = subparsers.add_parser("register", help="register an agent")
    register.add_argument("--agent")
    register.add_argument("--task", required=True)
    register.add_argument(
        "--role", choices=("development", "integration"), required=True
    )
    register.add_argument("--note")
    register.set_defaults(handler=command_register)

    heartbeat = subparsers.add_parser("heartbeat", help="refresh agent activity")
    heartbeat.add_argument("--agent")
    heartbeat.add_argument(
        "--status", choices=("working", "waiting", "blocked", "queued")
    )
    heartbeat.add_argument("--note")
    heartbeat.set_defaults(handler=command_heartbeat)

    reserve_port = subparsers.add_parser(
        "reserve-port", help="reserve a free dev-server port"
    )
    reserve_port.add_argument("--agent")
    reserve_port.add_argument("--start", type=int, default=5173)
    reserve_port.add_argument("--end", type=int, default=5273)
    reserve_port.set_defaults(handler=command_reserve_port)

    server_started = subparsers.add_parser(
        "server-started", help="record a running dev server"
    )
    server_started.add_argument("--agent")
    server_started.add_argument("--port", type=int, required=True)
    server_started.add_argument("--command", required=True)
    server_started.add_argument("--url")
    server_started.add_argument("--pane-id")
    server_started.add_argument("--pid", type=int)
    server_started.set_defaults(handler=command_server_started)

    server_stopped = subparsers.add_parser(
        "server-stopped", help="clear an agent's dev-server record"
    )
    server_stopped.add_argument("--agent")
    server_stopped.set_defaults(handler=command_server_stopped)

    enqueue = subparsers.add_parser("enqueue", help="append committed work to FIFO")
    enqueue.add_argument("--agent")
    enqueue.add_argument("--summary", required=True)
    enqueue.set_defaults(handler=command_enqueue)

    claim = subparsers.add_parser("claim", help="claim the oldest waiting item")
    claim.add_argument("--agent")
    claim.set_defaults(handler=command_claim)

    phase = subparsers.add_parser("phase", help="update integration phase")
    phase.add_argument("--agent")
    phase.add_argument("--phase", choices=("merging", "testing"), required=True)
    phase.add_argument("--note")
    phase.set_defaults(handler=command_phase)

    complete = subparsers.add_parser(
        "complete", help="complete the owned integration item"
    )
    complete.add_argument("--agent")
    complete.set_defaults(handler=command_complete)

    block = subparsers.add_parser(
        "block", help="block the owned item and release a clean primary worktree"
    )
    block.add_argument("--agent")
    block.add_argument("--reason", required=True)
    block.set_defaults(handler=command_block)

    retry = subparsers.add_parser(
        "retry", help="replace a waiting or blocked item with the current commit"
    )
    retry.add_argument("--agent")
    retry.add_argument("--summary")
    retry.set_defaults(handler=command_retry)

    finish = subparsers.add_parser("finish", help="mark an agent done")
    finish.add_argument("--agent")
    finish.add_argument("--note")
    finish.set_defaults(handler=command_finish)

    status = subparsers.add_parser("status", help="show coordination state")
    status.add_argument("--json", action="store_true")
    status.set_defaults(handler=command_status)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        repo = Repository(args.repo.resolve())
        args.handler(args, repo)
    except CoordinationError as error:
        print(f"coordination: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
