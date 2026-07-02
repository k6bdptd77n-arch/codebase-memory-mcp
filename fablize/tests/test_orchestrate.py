#!/usr/bin/env python3
"""Orchestrator tests — selection, prompt contract, dry-run safety, and (when git is
available) a real end-to-end run with a stub agent instead of `claude`."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCH = str(ROOT / "scripts" / "orchestrate.py")
GOALS = str(ROOT / "scripts" / "goals.py")
METRICS = str(ROOT / "scripts" / "metrics.py")
HAS_GIT = shutil.which("git") is not None


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.env = dict(os.environ, HOME=str(self.tmp))
        self.env.pop("FABLIZE_STATE", None)

    def tool(self, tool, *args, env=None):
        return subprocess.run([sys.executable, tool, *args], cwd=str(self.repo),
                              env=env or self.env, capture_output=True, text=True)

    def make_plan(self):
        self.tool(GOALS, "create", "--brief", "demo build",
                  "--goal", "alpha::build feature alpha",
                  "--goal", "beta::build feature beta")


class OrchestrateTests(Base):
    def test_requires_a_plan(self):
        r = self.tool(ORCH, "plan")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no plan", r.stderr + r.stdout)

    def test_plan_lists_pending_stories(self):
        self.make_plan()
        r = self.tool(ORCH, "plan")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("G001", r.stdout)
        self.assertIn("G002", r.stdout)
        self.assertIn("fablize/G001", r.stdout)

    def test_ids_filter(self):
        self.make_plan()
        r = self.tool(ORCH, "plan", "--ids", "G002")
        self.assertNotIn("G001 alpha", r.stdout)
        self.assertIn("G002", r.stdout)

    def test_non_pending_stories_excluded(self):
        self.make_plan()
        self.tool(GOALS, "next")  # activates G001 → in_progress
        r = self.tool(ORCH, "plan")
        self.assertNotIn("G001", r.stdout.replace("fablize/G001", ""))
        self.assertIn("G002", r.stdout)

    def test_dry_run_executes_nothing(self):
        self.make_plan()
        r = self.tool(ORCH, "run", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("dry-run", r.stdout)
        self.assertFalse((self.repo / ".fablize" / "worktrees").exists())
        self.assertFalse((self.repo / ".fablize" / "orchestrator").exists())

    def test_prompt_contract(self):
        # the handoff must scope-lock the agent and forbid touching the ledger
        sys.path.insert(0, str(ROOT / "scripts"))
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("orch", ORCH)
            orch = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(orch)
        finally:
            sys.path.pop(0)
        prompt = orch.build_prompt({"brief": "demo"}, {"id": "G009", "title": "t", "objective": "obj"})
        self.assertIn("G009", prompt)
        self.assertIn("obj", prompt)
        self.assertIn("ONLY this story", prompt)
        self.assertIn("Do NOT run goals.py", prompt)

    def test_log_dual_writes_to_global_event_stream(self):
        # orchestrator events must land in ~/.fablize/events.jsonl (tool="orchestrate"),
        # same pattern as goals.py — that's what metrics.py reads
        self.make_plan()
        r = self.tool(ORCH, "run", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        stream = self.tmp / ".fablize" / "events.jsonl"
        self.assertTrue(stream.exists())
        recs = [json.loads(x) for x in stream.read_text(encoding="utf-8").splitlines()]
        runs = [x for x in recs if x.get("event") == "orchestrator_run"]
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["tool"], "orchestrate")
        self.assertIn("cwd", runs[0])
        # the local ledger keeps its copy too (dual write, not a move)
        ledger = (self.repo / ".fablize" / "ledger.jsonl").read_text(encoding="utf-8")
        self.assertIn("orchestrator_run", ledger)

    def test_metrics_surfaces_orchestrator_activity(self):
        stream = self.tmp / ".fablize" / "events.jsonl"
        stream.parent.mkdir(parents=True, exist_ok=True)
        events = [
            {"ts": "2026-07-01T00:00:00+00:00", "event": "orchestrator_run",
             "count": 2, "tool": "orchestrate", "cwd": str(self.repo)},
            {"ts": "2026-07-01T00:01:00+00:00", "event": "orchestrator_story",
             "id": "G001", "rc": 0, "tool": "orchestrate", "cwd": str(self.repo)},
            {"ts": "2026-07-01T00:02:00+00:00", "event": "orchestrator_story",
             "id": "G002", "rc": 1, "tool": "orchestrate", "cwd": str(self.repo)},
        ]
        stream.write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
        r = self.tool(METRICS, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        s = json.loads(r.stdout)
        self.assertEqual(s["orchestrator"], {"runs": 1, "stories_ok": 1, "stories_failed": 1})
        r = self.tool(METRICS)
        self.assertIn("orchestrator", r.stdout)
        self.assertIn("1 run(s), 1 story(ies) ok / 1 failed", r.stdout)

    def test_agent_arg_pass_through(self):
        # crew role args (--model, --mcp-config, …) must reach the agent command verbatim
        import importlib.util
        spec = importlib.util.spec_from_file_location("orch2", ORCH)
        orch = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(orch)
        cmd = orch.agent_cmd("claude", "p", "acceptEdits",
                             ["--model", "haiku", "--strict-mcp-config"])
        self.assertEqual(cmd[-3:], ["--model", "haiku", "--strict-mcp-config"])
        self.assertEqual(cmd[:2], ["claude", "-p"])

    @unittest.skipUnless(HAS_GIT, "git not available")
    def test_end_to_end_with_stub_agent(self):
        subprocess.run(["git", "init", "-q"], cwd=str(self.repo), env=self.env, capture_output=True)
        genv = dict(self.env, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                    GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        (self.repo / "f.txt").write_text("x", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=str(self.repo), env=genv, capture_output=True)
        subprocess.run(["git", "commit", "-qm", "init"], cwd=str(self.repo), env=genv, capture_output=True)
        self.make_plan()
        # stub "claude": records its argv + cwd, exits 0
        stub = self.tmp / "stub-claude"
        marker = self.tmp / "calls.jsonl"
        stub.write_text("#!/bin/sh\necho \"{\\\"cwd\\\": \\\"$PWD\\\"}\" >> "
                        f"{marker}\necho agent-done\n", encoding="utf-8")
        stub.chmod(0o755)
        r = self.tool(ORCH, "run", "--claude-cmd", str(stub), "--parallel", "2", env=genv)
        self.assertEqual(r.returncode, 0, r.stderr)
        calls = [json.loads(x) for x in marker.read_text().splitlines()]
        self.assertEqual(len(calls), 2)  # both stories ran
        cwds = {c["cwd"] for c in calls}
        self.assertEqual(len(cwds), 2, "each agent runs in its own worktree")
        for g in ("G001", "G002"):
            logf = self.repo / ".fablize" / "orchestrator" / f"{g}.log"
            self.assertIn("agent-done", logf.read_text(encoding="utf-8"))
            # golden-middle permissions: each worktree gets a narrow self-verification allowlist
            settings = self.repo / ".fablize" / "worktrees" / g / ".claude" / "settings.local.json"
            allow = json.loads(settings.read_text(encoding="utf-8"))["permissions"]["allow"]
            self.assertIn("Bash(pytest:*)", allow)
            self.assertIn("Bash(git commit:*)", allow)
            self.assertNotIn("Bash(git push:*)", allow)
        # close-the-loop instructions are printed, checkpointing NOT done automatically
        self.assertIn("goals.py checkpoint", r.stdout)
        status = self.tool(GOALS, "status")
        self.assertIn("[pending]", status.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
