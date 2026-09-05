"""Exercise task-owned integration in temporary Git worktrees, without GitHub."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "coordination.py"
FIRST_ISSUE = "https://github.com/vilicvane/code3d/issues/123"
SECOND_ISSUE = "https://github.com/vilicvane/code3d/issues/456"


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="code3d-coordination-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "main"
        self.root.mkdir()
        self.env = {
            **{
                key: value
                for key, value in os.environ.items()
                if not key.startswith("HERDR_") and key != "CODEX_THREAD_ID"
            },
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "CODEX_THREAD_ID": "test-task-session",
        }
        self.git(self.root, "init", "--initial-branch=main")
        self.git(self.root, "config", "user.name", "Coordination Test")
        self.git(self.root, "config", "user.email", "test@example.invalid")
        (self.root / ".gitignore").write_text(".agents/worktree-state.json\n")
        self.git(self.root, "add", ".gitignore")
        self.git(self.root, "commit", "-m", "test: initialize repository")
        self.dev = Path(self.temporary.name) / "development"
        self.git(self.root, "worktree", "add", "-b", "issue-123-test", str(self.dev))

    def run_command(self, cwd, *command, expected=0, env=None):
        result = subprocess.run(
            command,
            check=False,
            cwd=cwd,
            env=env or self.env,
            text=True,
            capture_output=True,
            timeout=15,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout

    def git(self, cwd, *args):
        return self.run_command(cwd, "git", *args).strip()

    def coordinate(self, cwd, *args, expected=0, env=None):
        return self.run_command(
            cwd, sys.executable, str(SCRIPT), *args, expected=expected, env=env
        )

    def register(self, *args, cwd=None, agent="developer", env=None):
        return self.coordinate(
            cwd or self.dev,
            "register",
            "--agent",
            agent,
            "--task",
            "test issue linkage",
            *args,
            env=env,
        )

    def state(self):
        return json.loads(self.coordinate(self.root, "status", "--json"))

    def ready(self, cwd=None, agent="developer", env=None):
        cwd = cwd or self.dev
        self.register(cwd=cwd, agent=agent, env=env)
        self.git(cwd, "commit", "--allow-empty", "-m", f"test: ready {agent}")
        return self.coordinate(
            cwd, "enqueue", "--agent", agent, "--summary", "ready", env=env
        ).strip()

    def claim(self, cwd=None, agent="developer", env=None):
        return json.loads(
            self.coordinate(cwd or self.dev, "claim", "--agent", agent, env=env)
        )

    def merge(self, item, agent="developer", env=None):
        self.coordinate(
            self.root, "phase", "--agent", agent, "--phase", "merging", env=env
        )
        self.git(self.root, "merge", "--no-ff", "--no-commit", item["commit"])
        self.coordinate(
            self.root, "phase", "--agent", agent, "--phase", "testing", env=env
        )
        self.git(self.root, "commit", "-m", "test: merge task")
        self.coordinate(self.root, "complete", "--agent", agent, env=env)

    def another_task(self):
        other = Path(self.temporary.name) / "other-task"
        self.git(self.root, "worktree", "add", "-b", "issue-456-test", str(other))
        return other

    def write_state(self, state):
        (self.root / ".agents" / "worktree-state.json").write_text(json.dumps(state))

    def legacy_state(self):
        self.ready()
        state = self.state()
        state["version"] = 1
        task = state["agents"]["developer"]
        task["role"] = "development"
        task.pop("session_id")
        task["server"] = {"state": "running", "port": 5174, "pane_id": "w1:p19"}
        state["agents"]["legacy-integrator"] = {
            "id": "legacy-integrator",
            "role": "integration",
            "status": "available",
            "worktree": str(self.root),
            "head": self.git(self.root, "rev-parse", "HEAD"),
            "branch": "main",
            "active_at": "2026-09-04T00:00:00Z",
            "task": "old integration",
        }
        self.write_state(state)
        return state

    def test_registration_preserves_active_links_but_not_finished_task_links(self):
        self.register("--issue", FIRST_ISSUE, "--issue", FIRST_ISSUE)
        self.assertEqual(
            self.state()["agents"]["developer"]["issue_urls"], [FIRST_ISSUE]
        )
        self.coordinate(
            self.dev, "heartbeat", "--agent", "developer", "--note", "working"
        )
        self.register()
        self.assertEqual(
            self.state()["agents"]["developer"]["issue_urls"], [FIRST_ISSUE]
        )
        self.register("--issue", SECOND_ISSUE)
        self.assertEqual(
            self.state()["agents"]["developer"]["issue_urls"], [SECOND_ISSUE]
        )
        self.coordinate(self.dev, "finish", "--agent", "developer")
        self.register()
        self.assertEqual(self.state()["agents"]["developer"]["issue_urls"], [])

    def test_retry_snapshots_current_links_and_integration_retains_them(self):
        self.register("--issue", FIRST_ISSUE)
        self.git(
            self.dev, "commit", "--allow-empty", "-m", "test: first implementation"
        )
        self.coordinate(
            self.dev, "enqueue", "--agent", "developer", "--summary", "first"
        )
        first = self.state()["queue"][0]
        self.register("--issue", FIRST_ISSUE, "--issue", SECOND_ISSUE)
        self.git(
            self.dev, "commit", "--allow-empty", "-m", "test: revised implementation"
        )
        self.assertEqual(self.state()["queue"][0]["issue_urls"], [FIRST_ISSUE])
        self.coordinate(self.dev, "retry", "--agent", "developer")
        old, new = self.state()["queue"]
        self.assertEqual(old["state"], "superseded")
        self.assertEqual(old["issue_urls"], [FIRST_ISSUE])
        self.assertEqual(new["issue_urls"], [FIRST_ISSUE, SECOND_ISSUE])
        self.assertEqual(new["retry_of"], first["id"])
        self.assertNotEqual(new["commit"], first["commit"])
        status = self.coordinate(self.root, "status")
        self.assertEqual(status.count(FIRST_ISSUE), 2)
        self.assertEqual(status.count(SECOND_ISSUE), 2)
        claimed = self.claim()
        self.assertEqual(claimed["issue_urls"], [FIRST_ISSUE, SECOND_ISSUE])
        self.merge(claimed)
        completed = self.state()["queue"][-1]
        self.assertEqual(completed["state"], "done")
        self.assertEqual(completed["issue_urls"], [FIRST_ISSUE, SECOND_ISSUE])
        self.assertEqual(
            completed["result_commit"], self.git(self.root, "rev-parse", "HEAD")
        )
        self.assertIsNone(self.state()["integration"])
        task = self.state()["agents"]["developer"]
        self.assertEqual(task["status"], "integrated")
        self.assertEqual(task["worktree"], str(self.dev))
        self.assertEqual(task["branch"], "issue-123-test")
        self.assertEqual(task["head"], new["commit"])
        self.assertEqual(list(self.state()["agents"]), ["developer"])

    def test_bootstrap_registration_and_queue_work_without_github(self):
        self.register()
        self.coordinate(
            self.dev, "enqueue", "--agent", "developer", "--summary", "bootstrap"
        )
        self.assertEqual(self.state()["queue"][0]["issue_urls"], [])

    def test_issue_links_do_not_bypass_dirty_worktree_checks(self):
        self.register("--issue", FIRST_ISSUE)
        (self.dev / "unfinished.txt").write_text("not committed\n")
        self.coordinate(
            self.dev,
            "enqueue",
            "--agent",
            "developer",
            "--summary",
            "unfinished",
            expected=2,
        )
        self.assertEqual(self.state()["queue"], [])

    def test_issue_linked_queue_still_requires_clean_main_and_exclusive_claim(self):
        self.register("--issue", FIRST_ISSUE)
        self.coordinate(
            self.dev, "enqueue", "--agent", "developer", "--summary", "ready"
        )
        marker = self.root / "unfinished.txt"
        marker.write_text("integration is not clean\n")
        self.coordinate(self.dev, "claim", "--agent", "developer", expected=2)
        self.assertIsNone(self.state()["integration"])
        marker.unlink()
        self.claim()
        claimed = self.state()["integration"]
        self.coordinate(self.dev, "claim", "--agent", "developer", expected=2)
        self.assertEqual(self.state()["integration"], claimed)

    def test_pre_migration_agent_can_resume_and_attach_an_issue(self):
        self.register()
        state = self.state()
        del state["agents"]["developer"]["issue_urls"]
        (self.root / ".agents" / "worktree-state.json").write_text(json.dumps(state))
        self.coordinate(self.dev, "heartbeat", "--agent", "developer")
        self.coordinate(self.root, "status")
        self.register("--issue", FIRST_ISSUE)
        self.coordinate(
            self.dev, "enqueue", "--agent", "developer", "--summary", "linked"
        )
        self.assertEqual(self.state()["queue"][0]["issue_urls"], [FIRST_ISSUE])

    def test_issue_argument_rejects_non_issue_urls(self):
        for value in [
            "123",
            "https://github.com/vilicvane/code3d/pull/123",
            FIRST_ISSUE + "?x=1",
        ]:
            with self.subTest(value=value):
                self.coordinate(
                    self.dev,
                    "register",
                    "--agent",
                    "developer",
                    "--task",
                    "invalid link",
                    "--issue",
                    value,
                    expected=2,
                )
        self.assertEqual(self.state()["agents"], {})

    def test_tasks_claim_their_own_items_in_fifo_order_without_primary_registration(
        self,
    ):
        other = self.another_task()
        first = self.ready()
        second = self.ready(other, "other")
        self.coordinate(other, "claim", "--agent", "other", expected=2)
        self.assertIsNone(self.state()["integration"])
        claimed = self.claim()
        self.assertEqual(claimed["id"], first)
        self.coordinate(other, "claim", "--agent", "other", expected=2)
        self.merge(claimed)
        self.assertIsNone(self.state()["integration"])
        claimed = self.claim(other, "other")
        self.assertEqual(claimed["id"], second)
        self.merge(claimed, "other")
        self.assertEqual(
            [item["state"] for item in self.state()["queue"]], ["done", "done"]
        )
        self.assertTrue(
            all(
                agent["worktree"] != str(self.root)
                for agent in self.state()["agents"].values()
            )
        )

    def test_primary_registration_and_role_switching_are_not_supported(self):
        self.coordinate(
            self.root,
            "register",
            "--agent",
            "integrator",
            "--task",
            "merge",
            expected=2,
        )
        self.coordinate(
            self.dev,
            "register",
            "--agent",
            "developer",
            "--task",
            "test",
            "--role",
            "development",
            expected=2,
        )
        self.assertEqual(self.state()["agents"], {})
        self.ready()
        self.coordinate(self.root, "claim", "--agent", "developer", expected=2)
        self.coordinate(self.root, "heartbeat", "--agent", "developer", expected=2)
        self.assertEqual(self.state()["agents"]["developer"]["worktree"], str(self.dev))

    def test_different_worktree_or_session_cannot_borrow_task_identity(self):
        other = self.another_task()
        self.ready()
        other_session = {**self.env, "CODEX_THREAD_ID": "unrelated-session"}
        before = self.state()
        for command in [
            ("claim",),
            ("heartbeat",),
            ("finish",),
            ("register", "--task", "steal"),
        ]:
            self.coordinate(
                self.dev,
                *command,
                "--agent",
                "developer",
                env=other_session,
                expected=2,
            )
            self.coordinate(other, *command, "--agent", "developer", expected=2)
        self.assertEqual(self.state(), before)
        self.claim()
        before = self.state()
        for command in [
            ("phase", "--phase", "merging"),
            ("complete",),
            ("block", "--reason", "steal"),
        ]:
            self.coordinate(
                self.root,
                *command,
                "--agent",
                "developer",
                env=other_session,
                expected=2,
            )
        self.assertEqual(self.state(), before)

    def test_simultaneous_claims_create_exactly_one_owner(self):
        self.ready()
        processes = [
            subprocess.Popen(
                [sys.executable, str(SCRIPT), "claim", "--agent", "developer"],
                cwd=self.dev,
                env=self.env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(2)
        ]
        try:
            for process in processes:
                process.communicate(timeout=15)
            self.assertEqual(
                sorted(process.returncode for process in processes), [0, 2]
            )
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=15)
        state = self.state()
        self.assertEqual(state["integration"]["agent"], "developer")
        self.assertEqual(state["queue"][0]["state"], "claimed")

    def test_moved_queued_commit_requires_retry_and_returns_to_fifo_tail(self):
        other = self.another_task()
        first = self.ready()
        second = self.ready(other, "other")
        self.git(
            self.dev, "commit", "--allow-empty", "-m", "test: revised after enqueue"
        )
        self.coordinate(self.dev, "claim", "--agent", "developer", expected=2)
        self.assertIsNone(self.state()["integration"])
        self.coordinate(self.dev, "retry", "--agent", "developer")
        self.assertEqual(self.state()["queue"][0]["state"], "superseded")
        self.assertEqual(self.state()["queue"][-1]["retry_of"], first)
        self.coordinate(self.dev, "claim", "--agent", "developer", expected=2)
        self.assertEqual(self.claim(other, "other")["id"], second)

    def test_claim_rejects_unfinished_empty_merge_even_with_clean_index(self):
        self.ready()
        self.git(
            self.root,
            "merge",
            "--no-ff",
            "--no-commit",
            self.git(self.dev, "rev-parse", "HEAD"),
        )
        self.assertEqual(self.git(self.root, "status", "--porcelain"), "")
        self.coordinate(self.dev, "claim", "--agent", "developer", expected=2)
        self.assertIsNone(self.state()["integration"])
        self.git(self.root, "merge", "--abort")
        self.claim()

    def test_claim_rejects_new_uncommitted_task_edits(self):
        self.ready()
        (self.dev / "unfinished.txt").write_text("do not integrate yet\n")
        before = self.state()
        self.coordinate(self.dev, "claim", "--agent", "developer", expected=2)
        self.assertEqual(self.state(), before)

    def test_block_requires_clean_restored_base_then_releases_for_next_task(self):
        other = self.another_task()
        self.ready()
        second = self.ready(other, "other")
        item = self.claim()
        self.coordinate(
            self.root, "phase", "--agent", "developer", "--phase", "merging"
        )
        self.git(self.root, "merge", "--no-ff", "--no-commit", item["commit"])
        self.coordinate(
            self.root,
            "block",
            "--agent",
            "developer",
            "--reason",
            "failed test",
            expected=2,
        )
        self.git(self.root, "merge", "--abort")
        marker = self.root / "unfinished.txt"
        marker.write_text("still dirty\n")
        self.coordinate(
            self.root,
            "block",
            "--agent",
            "developer",
            "--reason",
            "failed test",
            expected=2,
        )
        marker.unlink()
        self.coordinate(
            self.root, "block", "--agent", "developer", "--reason", "failed test"
        )
        self.assertIsNone(self.state()["integration"])
        self.assertEqual(self.state()["agents"]["developer"]["status"], "blocked")
        self.assertEqual(self.state()["agents"]["developer"]["worktree"], str(self.dev))
        self.coordinate(self.dev, "retry", "--agent", "developer")
        self.assertEqual(self.claim(other, "other")["id"], second)

    def test_completed_merge_cannot_be_released_as_a_failed_unmerged_task(self):
        self.ready()
        item = self.claim()
        self.git(self.root, "merge", "--no-ff", "--no-edit", item["commit"])
        self.coordinate(
            self.root,
            "block",
            "--agent",
            "developer",
            "--reason",
            "not merged",
            expected=2,
        )
        self.assertIsNotNone(self.state()["integration"])

    def test_complete_requires_testing_and_exact_merge_commit(self):
        self.ready()
        item = self.claim()
        self.coordinate(self.root, "complete", "--agent", "developer", expected=2)
        self.coordinate(
            self.root, "phase", "--agent", "developer", "--phase", "testing"
        )
        self.coordinate(self.root, "complete", "--agent", "developer", expected=2)
        self.assertIsNotNone(self.state()["integration"])
        self.merge(item)

    def test_fast_forward_does_not_satisfy_merge_commit_requirement(self):
        self.ready()
        item = self.claim()
        self.coordinate(
            self.root, "phase", "--agent", "developer", "--phase", "testing"
        )
        self.git(self.root, "merge", "--ff-only", item["commit"])
        self.coordinate(self.root, "complete", "--agent", "developer", expected=2)
        self.assertIsNotNone(self.state()["integration"])

    def test_herdr_session_binding_without_codex_thread(self):
        pane_env = {
            key: value for key, value in self.env.items() if key != "CODEX_THREAD_ID"
        }
        pane_env["HERDR_PANE_ID"] = "w1:task"
        self.ready(env=pane_env)
        before = self.state()
        self.coordinate(
            self.dev,
            "claim",
            "--agent",
            "developer",
            env={**pane_env, "HERDR_PANE_ID": "w1:other"},
            expected=2,
        )
        self.assertEqual(self.state(), before)
        self.merge(self.claim(env=pane_env), env=pane_env)

    def test_reserve_port_skips_primary_port_in_custom_ranges(self):
        self.register()
        port = int(
            self.coordinate(
                self.dev,
                "reserve-port",
                "--agent",
                "developer",
                "--start",
                "3133",
                "--end",
                "3143",
            ).strip()
        )
        self.assertGreater(port, 3133)
        self.assertLessEqual(port, 3143)
        self.assertEqual(self.state()["agents"]["developer"]["server"]["port"], port)
        before = self.state()
        self.coordinate(
            self.dev,
            "reserve-port",
            "--agent",
            "developer",
            "--start",
            "3133",
            "--end",
            "3133",
            expected=2,
        )
        self.assertEqual(self.state(), before)

    def test_server_started_rejects_primary_port_from_an_older_reservation(self):
        self.register()
        state = self.state()
        state["agents"]["developer"]["server"] = {"state": "reserved", "port": 3133}
        self.write_state(state)
        self.coordinate(
            self.dev,
            "server-started",
            "--agent",
            "developer",
            "--port",
            "3133",
            "--command",
            "vite --port 3133",
            expected=2,
        )
        self.assertEqual(self.state(), state)

    def test_integration_preserves_server_and_task_context_and_heartbeat_updates_lock(
        self,
    ):
        self.ready()
        port = self.coordinate(
            self.dev,
            "reserve-port",
            "--agent",
            "developer",
            "--start",
            "25000",
            "--end",
            "25100",
        ).strip()
        self.coordinate(
            self.dev,
            "server-started",
            "--agent",
            "developer",
            "--port",
            port,
            "--pane-id",
            "w1:server",
            "--command",
            "test-server",
        )
        before = self.state()["agents"]["developer"]
        claimed = self.claim()
        self.register()
        self.assertEqual(self.state()["agents"]["developer"]["status"], "integrating")
        state = self.state()
        state["integration"]["active_at"] = "2000-01-01T00:00:00Z"
        self.write_state(state)
        self.coordinate(
            self.dev, "heartbeat", "--agent", "developer", "--note", "final tests"
        )
        self.assertNotEqual(
            self.state()["integration"]["active_at"], "2000-01-01T00:00:00Z"
        )
        self.merge(claimed)
        after = self.state()["agents"]["developer"]
        for key in ["worktree", "branch", "head", "server", "session_id"]:
            self.assertEqual(after[key], before[key])
        self.coordinate(self.dev, "finish", "--agent", "developer", expected=2)
        self.coordinate(self.dev, "server-stopped", "--agent", "developer")
        self.coordinate(self.dev, "finish", "--agent", "developer")
        self.assertEqual(self.state()["agents"]["developer"]["status"], "done")

    def test_stale_owner_is_not_reclaimed(self):
        other = self.another_task()
        self.ready()
        self.ready(other, "other")
        self.claim()
        state = self.state()
        state["integration"]["active_at"] = "2000-01-01T00:00:00Z"
        self.write_state(state)
        self.coordinate(other, "claim", "--agent", "other", expected=2)
        self.assertEqual(self.state(), state)

    def test_explicit_migration_preserves_queue_and_servers_and_retires_primary_owner(
        self,
    ):
        before = self.legacy_state()
        self.coordinate(self.dev, "claim", "--agent", "developer", expected=2)
        self.coordinate(self.root, "migrate")
        after = self.state()
        self.assertEqual(after["version"], 2)
        self.assertEqual(after["queue"], before["queue"])
        self.assertEqual(
            after["agents"]["developer"]["server"],
            before["agents"]["developer"]["server"],
        )
        self.assertEqual(after["agents"]["legacy-integrator"]["status"], "done")
        self.assertTrue(all("role" not in agent for agent in after["agents"].values()))
        self.register()
        self.assertEqual(
            self.state()["agents"]["developer"]["session_id"],
            self.env["CODEX_THREAD_ID"],
        )
        self.claim()

    def test_migration_refuses_active_integration_or_dirty_primary_without_changes(
        self,
    ):
        before = self.legacy_state()
        before["integration"] = {"agent": "legacy-integrator", "phase": "testing"}
        self.write_state(before)
        self.coordinate(self.root, "migrate", expected=2)
        path = self.root / ".agents" / "worktree-state.json"
        self.assertEqual(json.loads(path.read_text()), before)
        before["integration"] = None
        self.write_state(before)
        (self.root / "unfinished.txt").write_text("do not touch\n")
        self.coordinate(self.root, "migrate", expected=2)
        self.assertEqual(json.loads(path.read_text()), before)

    def test_unsupported_state_version_cannot_be_overwritten(self):
        self.register()
        state = self.state()
        state["version"] = 999
        self.write_state(state)
        self.coordinate(self.dev, "heartbeat", "--agent", "developer", expected=2)
        self.assertEqual(
            json.loads((self.root / ".agents" / "worktree-state.json").read_text()),
            state,
        )


if __name__ == "__main__":
    unittest.main()
