#!/usr/bin/env python3
"""crew/mindforge_tools.py tests — the stdlib boundary between crewAI (or any
orchestration framework) and the fablize engines. No crewai import anywhere:
these are plain functions returning LLM-readable text.

Each test loads a FRESH module instance with MINDFORGE_REPO pointed at a sandbox
git repo, so plan/state/worktrees never touch the real checkout.
"""
import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TOOLS = ROOT / "crew" / "mindforge_tools.py"
HAS_GIT = shutil.which("git") is not None


def load_tools(repo, home):
    os.environ["MINDFORGE_REPO"] = str(repo)
    os.environ["HOME"] = str(home)
    try:
        spec = importlib.util.spec_from_file_location("mindforge_tools_test", TOOLS)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        os.environ.pop("MINDFORGE_REPO", None)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self._home = os.environ.get("HOME")
        self.t = load_tools(self.repo, self.tmp)

    def tearDown(self):
        if self._home is not None:
            os.environ["HOME"] = self._home


class PlanToolTests(Base):
    def test_create_and_status(self):
        marker = "sandbox-isolation-marker-1f2e3d"
        out = self.t.goals_create(marker, ["a::do a", "b::do b"])
        self.assertIn("plan created", out)
        self.assertIn("G001", self.t.goals_status())
        self.assertTrue((self.repo / ".fablize" / "goals.json").exists())
        # and nothing leaked into the real checkout's state
        real = ROOT / ".fablize" / "goals.json"
        if real.exists():
            self.assertNotIn(marker, real.read_text(encoding="utf-8"))

    def test_add_appends(self):
        self.t.goals_create("demo", ["a::do a"])
        out = self.t.goals_add(["c::do c"])
        self.assertIn("G002", out + self.t.goals_status())

    def test_checkpoint_flow_and_gate(self):
        self.t.goals_create("demo", ["a::do a"])
        self.t.goals_next()
        # final story without verify args must FAIL — the gate text comes back as tool output
        out = self.t.goals_checkpoint("G001", "complete", "did it")
        self.assertIn("verification gate", out)
        out = self.t.goals_checkpoint("G001", "complete", "did it",
                                      verify_cmd="pytest", verify_evidence="ok")
        self.assertIn("complete", out)

    def test_engine_failure_returns_text_not_raise(self):
        out = self.t.goals_checkpoint("G999", "complete", "x")  # no plan at all
        self.assertIn("exit code", out)


class ReviewToolTests(Base):
    def test_review_missing_branch_is_readable(self):
        subprocess.run(["git", "init", "-q"], cwd=self.repo, capture_output=True)
        out = self.t.review_story("G007")
        self.assertIn("no branch fablize/G007", out)
        self.assertIn("no agent log found", out)

    @unittest.skipUnless(HAS_GIT, "git not available")
    def test_review_real_branch_shows_diff_and_log(self):
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t", HOME=str(self.tmp))
        subprocess.run(["git", "init", "-q"], cwd=self.repo, env=env, capture_output=True)
        (self.repo / "f.txt").write_text("x", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=self.repo, env=env, capture_output=True)
        subprocess.run(["git", "commit", "-qm", "init"], cwd=self.repo, env=env, capture_output=True)
        subprocess.run(["git", "branch", "fablize/G001"], cwd=self.repo, env=env, capture_output=True)
        subprocess.run(["git", "checkout", "-q", "fablize/G001"], cwd=self.repo, env=env, capture_output=True)
        (self.repo / "new.py").write_text("print('hi')\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=self.repo, env=env, capture_output=True)
        subprocess.run(["git", "commit", "-qm", "G001: add new.py"], cwd=self.repo, env=env, capture_output=True)
        subprocess.run(["git", "checkout", "-q", "-"], cwd=self.repo, env=env, capture_output=True)
        logd = self.repo / ".fablize" / "orchestrator"
        logd.mkdir(parents=True)
        (logd / "G001.log").write_text("agent says: created new.py, tests pass\n", encoding="utf-8")
        out = self.t.review_story("G001")
        self.assertIn("new.py", out)
        self.assertIn("G001: add new.py", out)
        self.assertIn("tests pass", out)

    def test_run_verification_returns_output(self):
        out = self.t.run_verification(cmd="python3 -c print(40+2)")
        self.assertIn("42", out)

    def test_run_verification_honors_quoted_cmd(self):
        # shlex parsing: a quoted argument with spaces must arrive as ONE argv element
        out = self.t.run_verification(cmd='python3 -c "print(40 + 2)"')
        self.assertIn("42", out)


class MergeToolTests(Base):
    def _git(self, *args, env=None):
        return subprocess.run(["git", *args], cwd=self.repo, env=env or self.genv,
                              capture_output=True, text=True)

    def setUp(self):
        super().setUp()
        self.genv = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                         GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t", HOME=str(self.tmp))

    @unittest.skipUnless(HAS_GIT, "git not available")
    def test_merge_conflict_aborts_and_keeps_branch(self):
        # two branches editing the same line: merge must ABORT, leave a clean tree,
        # and keep the story branch — the work is not destroyed over a conflict.
        self._git("init", "-q")
        (self.repo / "f.txt").write_text("base\n", encoding="utf-8")
        self._git("add", "."); self._git("commit", "-qm", "init")
        self._git("checkout", "-q", "-b", "fablize/G001")
        (self.repo / "f.txt").write_text("story version\n", encoding="utf-8")
        self._git("add", "."); self._git("commit", "-qm", "G001: story edit")
        self._git("checkout", "-q", "-")
        (self.repo / "f.txt").write_text("main version\n", encoding="utf-8")
        self._git("add", "."); self._git("commit", "-qm", "main edit")
        out = self.t.merge_story("G001")
        self.assertTrue(out.startswith("MERGE CONFLICT"), out)
        # tree is clean and NOT mid-merge (no MERGE_HEAD, no unmerged paths)
        st = self._git("status", "--porcelain").stdout.strip()
        self.assertEqual(st, "", f"tree not clean after abort: {st}")
        self.assertFalse((self.repo / ".git" / "MERGE_HEAD").exists(), "still MERGING")
        # the story branch survived for manual resolution
        branches = self._git("branch", "--list", "fablize/G001").stdout
        self.assertIn("fablize/G001", branches)

    @unittest.skipUnless(HAS_GIT, "git not available")
    def test_clean_merge_still_merges_and_deletes_branch(self):
        self._git("init", "-q")
        (self.repo / "f.txt").write_text("base\n", encoding="utf-8")
        self._git("add", "."); self._git("commit", "-qm", "init")
        self._git("checkout", "-q", "-b", "fablize/G001")
        (self.repo / "new.txt").write_text("story\n", encoding="utf-8")
        self._git("add", "."); self._git("commit", "-qm", "G001: add new.txt")
        self._git("checkout", "-q", "-")
        out = self.t.merge_story("G001")
        self.assertNotIn("MERGE CONFLICT", out)
        self.assertTrue((self.repo / "new.txt").exists(), "merge did not land")
        branches = self._git("branch", "--list", "fablize/G001").stdout
        self.assertNotIn("fablize/G001", branches)


class BrainToolTests(Base):
    def test_reflect_then_recall_roundtrip(self):
        self.t.brain_reflect("crew tools built", lesson="wrap engines, never reimplement them")
        out = self.t.brain_recall("wrap engines reimplement")
        self.assertIn("wrap engines", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
