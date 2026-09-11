"""Exercise read-only candidate filtering in disposable Git repositories."""

import json
import fcntl
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/inspect_worktrees.py"


class InspectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="code3d-cleanup-test-")
        self.addCleanup(temporary.cleanup)
        self.primary = Path(temporary.name) / "project"
        self.primary.mkdir()
        self.env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        self.git(self.primary, "init", "--initial-branch=main")
        self.git(self.primary, "config", "user.name", "Test")
        self.git(self.primary, "config", "user.email", "test@example.invalid")
        (self.primary / ".gitignore").write_text(".agents/worktree-state.json\nnode_modules/\ndist/\n.env*\n*.local\n.wrangler/\n")
        (self.primary / "source.txt").write_text("source\n")
        self.git(self.primary, "add", ".")
        self.git(self.primary, "commit", "-m", "initial")
        self.dev = self.primary.with_name("project-task")
        self.git(self.primary, "worktree", "add", "-b", "task", str(self.dev))
        self.state = {"version": 2, "agents": {}, "queue": [], "integration": None}
        self.save_state()
        (self.primary / ".git/worktree-state.lock").touch()
        self.age()

    def git(self, cwd, *args):
        return subprocess.run(["git", "--no-optional-locks", "-C", str(cwd), *args],
                              check=True, capture_output=True, text=True, env=self.env, timeout=15).stdout.strip()

    def save_state(self):
        directory = self.primary / ".agents"
        directory.mkdir(exist_ok=True)
        (directory / "worktree-state.json").write_text(json.dumps(self.state))

    def age(self):
        stamp = time.time() - 14 * 86400
        gitdir = Path(self.git(self.dev, "rev-parse", "--absolute-git-dir"))
        for root in (self.dev, gitdir):
            for path in [*root.rglob("*"), root]:
                os.utime(path, (stamp, stamp), follow_symlinks=False)

    def cleanup(self):
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--repo", str(self.primary)],
                                text=True, capture_output=True, env=self.env, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def kept(self, reason):
        events = self.cleanup()
        self.assertTrue(self.dev.exists())
        self.assertEqual(events[-1]["skipped"].get(reason), 1, events)

    def test_candidate_inspection_never_removes_worktree_or_branch(self):
        (self.dev / "node_modules").mkdir()
        (self.dev / "node_modules/generated.js").write_text("generated")
        self.age()
        events = self.cleanup()
        self.assertEqual(events[-1]["eligible"], 1)
        self.assertTrue(self.dev.exists())
        self.assertEqual(sum(e["action"] == "candidate" for e in events), 1)
        self.assertTrue(self.primary.exists())
        self.assertTrue(self.git(self.primary, "rev-parse", "refs/heads/task"))

    def test_removed_apply_flag_cannot_delete(self):
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--repo", str(self.primary), "--apply"],
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 2)
        self.assertTrue(self.dev.exists())

    def test_default_threshold_is_24_hours(self):
        stamp = time.time() - 25 * 3600
        (self.dev / "source.txt").touch()
        os.utime(self.dev / "source.txt", (stamp, stamp))
        self.assertEqual(self.cleanup()[-1]["eligible"], 1)
        stamp = time.time() - 23 * 3600
        os.utime(self.dev / "source.txt", (stamp, stamp))
        self.kept("recent-activity")

    def test_modified_tracked_file_is_retained(self):
        (self.dev / "source.txt").write_text("modified")
        self.kept("dirty")

    def test_untracked_file_is_retained(self):
        (self.dev / "draft.txt").write_text("draft")
        self.kept("dirty")

    def test_ignored_configuration_is_retained(self):
        (self.dev / ".env.local").write_text("TEST=local\n")
        self.kept("ignored-local-data")

    def test_local_worker_database_is_retained(self):
        (self.dev / ".wrangler").mkdir()
        (self.dev / ".wrangler/state.db").write_text("local data")
        self.kept("ignored-local-data")

    def test_unmerged_commit_is_retained(self):
        (self.dev / "source.txt").write_text("unmerged")
        self.git(self.dev, "commit", "-am", "unmerged")
        self.age()
        self.kept("unmerged-commit")

    def test_locked_worktree_is_retained(self):
        self.git(self.primary, "worktree", "lock", str(self.dev))
        self.kept("git-worktree-locked")

    def test_recent_file_touch_is_activity_even_when_clean(self):
        (self.dev / "source.txt").touch()
        self.kept("recent-activity")

    def test_recent_heartbeat_is_activity(self):
        self.state["agents"]["task"] = {"worktree": str(self.dev), "status": "done", "active_at": "2999-01-01T00:00:00Z"}
        self.save_state()
        self.kept("recent-activity")

    def test_unfinished_task_is_retained_even_with_old_heartbeat(self):
        self.state["agents"]["task"] = {"worktree": str(self.dev), "status": "waiting", "active_at": "2000-01-01T00:00:00Z"}
        self.save_state()
        self.kept("unfinished-task")

    def test_queued_worktree_is_retained(self):
        self.state["queue"].append({"worktree": str(self.dev), "state": "waiting"})
        self.save_state()
        self.kept("queued")

    def test_integration_blocks_the_run(self):
        self.state["integration"] = {"phase": "testing"}
        self.save_state()
        events = self.cleanup()
        self.assertEqual(events[-1]["action"], "skip-run")
        self.assertTrue(self.dev.exists())

    def test_coordinator_lock_prevents_deletion(self):
        with (self.primary / ".git/worktree-state.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            events = self.cleanup()
        self.assertEqual(events[-1]["reason"], "coordinator-busy")
        self.assertTrue(self.dev.exists())

    def test_in_progress_git_operation_is_retained(self):
        directory = Path(self.git(self.dev, "rev-parse", "--absolute-git-dir"))
        (directory / "CHERRY_PICK_HEAD").write_text(self.git(self.dev, "rev-parse", "HEAD"))
        self.kept("git-operation")

    def test_registered_server_is_retained(self):
        self.state["agents"]["task"] = {"worktree": str(self.dev), "status": "integrated", "server": {"state": "running"}}
        self.save_state()
        self.kept("registered-server")


if __name__ == "__main__":
    unittest.main()
