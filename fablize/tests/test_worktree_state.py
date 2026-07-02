#!/usr/bin/env python3
"""Worktree-aware state resolution — the property that makes fablize usable under
orchestrators (Auto-Claude, orchestrate.py) that run agents in linked git worktrees:
spec/goals/brain state is per-PROJECT, so a worktree agent reads and writes the MAIN
checkout's .fablize/, unless FABLIZE_STATE explicitly isolates it.

No git binary needed: a linked worktree is just a `.git` pointer file whose gitdir
contains `/.git/worktrees/<name>` — the layout is fabricated directly.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAIN = str(ROOT / "scripts" / "brain.py")
SPEC = str(ROOT / "scripts" / "spec.py")
GOALS = str(ROOT / "scripts" / "goals.py")
REFLECT_HOOK = str(ROOT / "hooks" / "brain_reflect.py")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.main = self.tmp / "main"
        (self.main / ".git" / "worktrees" / "wt").mkdir(parents=True)
        self.wt = self.tmp / "wt"
        self.wt.mkdir()
        (self.wt / ".git").write_text(f"gitdir: {self.main}/.git/worktrees/wt\n", encoding="utf-8")
        self.env = dict(os.environ, HOME=str(self.tmp))
        self.env.pop("FABLIZE_STATE", None)

    def run_tool(self, tool, *args, cwd=None, env=None):
        return subprocess.run([sys.executable, tool, *args], cwd=str(cwd or self.wt),
                              env=env or self.env, capture_output=True, text=True)


class WorktreeStateTests(Base):
    def test_spec_lock_from_worktree_lands_in_main(self):
        r = self.run_tool(SPEC, "lock", "--req", "do the thing")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.main / ".fablize" / "spec.json").exists())
        self.assertFalse((self.wt / ".fablize").exists())
        # and show from the worktree reads it back
        s = self.run_tool(SPEC, "show")
        self.assertIn("do the thing", s.stdout)

    def test_goals_from_worktree_share_main_plan(self):
        self.run_tool(GOALS, "create", "--brief", "b", "--goal", "t::o", cwd=self.main)
        r = self.run_tool(GOALS, "status")  # from the worktree
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("G001", r.stdout)
        self.assertFalse((self.wt / ".fablize").exists())

    def test_brain_fact_from_worktree_lands_in_main(self):
        self.run_tool(BRAIN, "remember", "--name", "wt-fact", "--desc", "d", "--body", "b")
        self.assertTrue((self.main / ".fablize" / "brain" / "wt-fact.md").exists())
        self.assertFalse((self.wt / ".fablize").exists())
        # recall from the MAIN checkout sees what the worktree agent learned
        r = self.run_tool(BRAIN, "recall", "--query", "wt-fact d b", cwd=self.main)
        self.assertIn("wt-fact", r.stdout)

    def test_fablize_state_env_isolates(self):
        iso = self.tmp / "iso"
        env = dict(self.env, FABLIZE_STATE=str(iso))
        r = self.run_tool(SPEC, "lock", "--req", "isolated", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((iso / ".fablize" / "spec.json").exists())
        self.assertFalse((self.main / ".fablize" / "spec.json").exists())

    def test_plain_repo_unchanged(self):
        plain = self.tmp / "plain"
        plain.mkdir()
        r = self.run_tool(SPEC, "lock", "--req", "local", cwd=plain)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((plain / ".fablize" / "spec.json").exists())

    def test_reflect_hook_writes_to_main_from_worktree_cwd(self):
        t = self.wt / "t.jsonl"
        t.write_text(json.dumps({"type": "user", "message": {"role": "user", "content": "wt task"}})
                     + "\n" + json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
                         {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}}) + "\n",
                     encoding="utf-8")
        payload = {"session_id": "s1", "transcript_path": str(t),
                   "cwd": str(self.wt), "stop_hook_active": False}
        r = subprocess.run([sys.executable, REFLECT_HOOK], cwd=str(self.wt), env=self.env,
                           input=json.dumps(payload), capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        traces = self.main / ".fablize" / "traces.jsonl"
        self.assertTrue(traces.exists())
        self.assertIn("wt task", traces.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
