"""Verify the scheduler invokes Codex with bounded modes and isolated identity."""

import fcntl
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/run_scheduled_cleanup.py"


class ScheduledCleanupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="code3d-codex-job-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = self.root / "reports"
        self.task = self.root / "task.md"
        self.task.write_text("复核后逐个清理，有疑点保留。")
        self.inspector = self.root / "inspect.py"
        self.inspector.write_text("# read-only inspector")
        herdr = self.root / "herdr"
        herdr.write_text(f"#!{sys.executable}\n" + '''import json,os,sys
if os.environ.get('TEST_HERDR_FAILURE'): sys.exit(1)
print(json.dumps({'result':{'panes':[{'pane_id':'w1:p1','agent':'codex','agent_status':'idle',
                                    'cwd':'/project/task','tokens':{'summary':'omit this'}}]}}))
''')
        herdr.chmod(0o700)
        fake = self.root / "codex"
        fake.write_text(f"#!{sys.executable}\n" + '''import json,os,sys,time
from pathlib import Path
args=sys.argv[1:]
prompt=sys.stdin.read()
params=json.loads(prompt.split('本轮固定参数：\\n')[1])
snapshot=Path(params['herdr_state'])
for _ in range(50):
    if snapshot.exists(): break
    time.sleep(0.02)
Path(args[args.index('--output-last-message')+1]).write_text('验证完成。')
print(json.dumps({'args':args,'prompt':prompt,'herdr':json.loads(snapshot.read_text()),
                  'identity':[k for k in os.environ if k.startswith('HERDR_') or k in ['CODEX_THREAD_ID','CODEX_PARENT_THREAD_ID']]}))
''')
        fake.chmod(0o700)
        self.env = {**os.environ, "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
                    "HERDR_ENV": "1", "HERDR_PANE_ID": "test:p1", "CODEX_THREAD_ID": "caller"}

    def run_job(self, execute=False):
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--repo", str(self.root),
                                 "--task", str(self.task), "--inspector", str(self.inspector),
                                 "--state-dir", str(self.state), *(["--execute"] if execute else [])],
                                env=self.env, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_preview_uses_codex_read_only_and_retains_report(self):
        self.run_job()
        event = json.loads(next(self.state.glob("*.jsonl")).read_text())
        self.assertIn("read-only", event["args"])
        self.assertNotIn("--add-dir", event["args"])
        self.assertIn("仅做只读验收", event["prompt"])
        self.assertIn('"inactive_hours": 24', event["prompt"])
        self.assertEqual(event["identity"], [])
        self.assertNotIn("error", event["herdr"])
        self.assertEqual(event["herdr"]["panes"][0]["agent_status"], "idle")
        self.assertNotIn("tokens", event["herdr"]["panes"][0])
        self.assertEqual(next(self.state.glob("*.md")).read_text(), "验证完成。")

    def test_herdr_failure_is_explicit_not_an_empty_active_list(self):
        self.env["TEST_HERDR_FAILURE"] = "1"
        self.run_job()
        event = json.loads(next(self.state.glob("*.jsonl")).read_text())
        self.assertIn("error", event["herdr"])
        self.assertNotIn("panes", event["herdr"])

    def test_execution_runs_codex_not_a_deletion_script(self):
        self.run_job(execute=True)
        event = json.loads(next(self.state.glob("*.jsonl")).read_text())
        self.assertIn("exec", event["args"])
        self.assertIn("workspace-write", event["args"])
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", event["args"])
        self.assertIn("逐个删除", event["prompt"])
        self.assertNotIn("--apply", event["args"])
        self.assertTrue(self.inspector.exists())

    def test_running_review_prevents_duplicate_codex(self):
        self.state.mkdir()
        with (self.state / "run.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = self.run_job(execute=True)
        self.assertIn("already running", result.stdout)
        self.assertEqual(list(self.state.glob("*.jsonl")), [])


if __name__ == "__main__":
    unittest.main()
