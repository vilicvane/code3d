"""Exercise issue linkage through the real local integration queue, without GitHub."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


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
            **os.environ,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
        }
        self.git(self.root, "init", "--initial-branch=main")
        self.git(self.root, "config", "user.name", "Coordination Test")
        self.git(self.root, "config", "user.email", "test@example.invalid")
        (self.root / ".gitignore").write_text(".agents/worktree-state.json\n")
        self.git(self.root, "add", ".gitignore")
        self.git(self.root, "commit", "-m", "test: initialize repository")
        self.dev = Path(self.temporary.name) / "development"
        self.git(self.root, "worktree", "add", "-b", "issue-123-test", str(self.dev))

    def run_command(self, cwd, *command, expected=0):
        result = subprocess.run(
            command, cwd=cwd, env=self.env, text=True, capture_output=True, timeout=15
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout

    def git(self, cwd, *args):
        return self.run_command(cwd, "git", *args).strip()

    def coordinate(self, cwd, *args, expected=0):
        return self.run_command(cwd, sys.executable, str(SCRIPT), *args, expected=expected)

    def register(self, *args):
        return self.coordinate(
            self.dev,
            "register",
            "--agent",
            "developer",
            "--role",
            "development",
            "--task",
            "test issue linkage",
            *args,
        )

    def state(self):
        return json.loads(self.coordinate(self.root, "status", "--json"))

    def register_integrator(self):
        self.coordinate(
            self.root,
            "register",
            "--agent",
            "integrator",
            "--role",
            "integration",
            "--task",
            "test merge",
        )

    def test_registration_preserves_active_links_but_not_finished_task_links(self):
        self.register("--issue", FIRST_ISSUE, "--issue", FIRST_ISSUE)
        self.assertEqual(self.state()["agents"]["developer"]["issue_urls"], [FIRST_ISSUE])
        self.coordinate(self.dev, "heartbeat", "--agent", "developer", "--note", "working")
        self.register()
        self.assertEqual(self.state()["agents"]["developer"]["issue_urls"], [FIRST_ISSUE])
        self.register("--issue", SECOND_ISSUE)
        self.assertEqual(self.state()["agents"]["developer"]["issue_urls"], [SECOND_ISSUE])
        self.coordinate(self.dev, "finish", "--agent", "developer")
        self.register()
        self.assertEqual(self.state()["agents"]["developer"]["issue_urls"], [])

    def test_retry_snapshots_current_links_and_integration_retains_them(self):
        self.register("--issue", FIRST_ISSUE)
        self.git(self.dev, "commit", "--allow-empty", "-m", "test: first implementation")
        self.coordinate(self.dev, "enqueue", "--agent", "developer", "--summary", "first")
        first = self.state()["queue"][0]
        self.register("--issue", FIRST_ISSUE, "--issue", SECOND_ISSUE)
        self.git(self.dev, "commit", "--allow-empty", "-m", "test: revised implementation")
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
        self.register_integrator()
        claimed = json.loads(self.coordinate(self.root, "claim", "--agent", "integrator"))
        self.assertEqual(claimed["issue_urls"], [FIRST_ISSUE, SECOND_ISSUE])
        self.coordinate(self.root, "phase", "--agent", "integrator", "--phase", "merging")
        self.git(self.root, "merge", "--no-ff", "--no-edit", new["commit"])
        self.coordinate(self.root, "phase", "--agent", "integrator", "--phase", "testing")
        self.coordinate(self.root, "complete", "--agent", "integrator")
        completed = self.state()["queue"][-1]
        self.assertEqual(completed["state"], "done")
        self.assertEqual(completed["issue_urls"], [FIRST_ISSUE, SECOND_ISSUE])
        self.assertEqual(completed["result_commit"], self.git(self.root, "rev-parse", "HEAD"))
        self.assertIsNone(self.state()["integration"])

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
        self.coordinate(self.dev, "enqueue", "--agent", "developer", "--summary", "ready")
        self.register_integrator()
        marker = self.root / "unfinished.txt"
        marker.write_text("integration is not clean\n")
        self.coordinate(self.root, "claim", "--agent", "integrator", expected=2)
        self.assertIsNone(self.state()["integration"])
        marker.unlink()
        self.coordinate(self.root, "claim", "--agent", "integrator")
        claimed = self.state()["integration"]
        self.coordinate(self.root, "claim", "--agent", "integrator", expected=2)
        self.assertEqual(self.state()["integration"], claimed)

    def test_pre_migration_agent_can_resume_and_attach_an_issue(self):
        self.register()
        state = self.state()
        del state["agents"]["developer"]["issue_urls"]
        (self.root / ".agents" / "worktree-state.json").write_text(json.dumps(state))
        self.coordinate(self.dev, "heartbeat", "--agent", "developer")
        self.coordinate(self.root, "status")
        self.register("--issue", FIRST_ISSUE)
        self.coordinate(self.dev, "enqueue", "--agent", "developer", "--summary", "linked")
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
                    "--role",
                    "development",
                    "--task",
                    "invalid link",
                    "--issue",
                    value,
                    expected=2,
                )
        self.assertEqual(self.state()["agents"], {})


if __name__ == "__main__":
    unittest.main()
