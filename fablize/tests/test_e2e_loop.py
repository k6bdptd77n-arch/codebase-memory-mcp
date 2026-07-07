#!/usr/bin/env python3
"""End-to-end honesty gate for the whole loop: run → review → verify → checkpoint → merge,
driven by a STUB agent (no tokens, no real claude). The load-bearing assertion is the
NEGATIVE one — a story whose verify gate is RED must NOT merge. That is the exact class of
failure that once let a story be "approved" though its check could never pass (G002); this
test fails loudly if that regresses.

Isolated: MINDFORGE_REPO points mindforge_tools at a sandbox git repo per test.
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
        spec = importlib.util.spec_from_file_location("mindforge_tools_e2e", TOOLS)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        os.environ.pop("MINDFORGE_REPO", None)


@unittest.skipUnless(HAS_GIT, "git not available")
class LoopHonestyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self._home = os.environ.get("HOME")
        self.env = dict(os.environ, HOME=str(self.tmp),
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                        GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        self._git("init", "-q")
        (self.repo / "README").write_text("base\n", encoding="utf-8")
        self._git("add", "."); self._git("commit", "-qm", "init")
        self.t = load_tools(self.repo, self.tmp)

    def tearDown(self):
        if self._home is not None:
            os.environ["HOME"] = self._home
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _git(self, *a):
        return subprocess.run(["git", *a], cwd=str(self.repo), env=self.env,
                              capture_output=True, text=True)

    def _stub(self, name, content):
        # a headless "agent": in its worktree cwd, write a file and commit it on the branch
        s = self.tmp / name
        s.write_text("#!/bin/sh\n"
                     f"printf '%s\\n' '{content}' > feature.txt\n"
                     "git add feature.txt\n"
                     "git -c user.name=agent -c user.email=a@a commit -qm 'feat: feature.txt'\n"
                     "echo agent-done\n", encoding="utf-8")
        s.chmod(0o755)
        return str(s)

    def _run_story(self, sid, stub):
        # mindforge_tools.run_story → orchestrate.py run in a worktree with our stub as the agent
        prev = os.environ.get("HOME")
        os.environ.update({k: self.env[k] for k in
                           ("HOME", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
                            "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL")})
        try:
            return self.t.run_story(sid, claude_cmd=stub, timeout=120)
        finally:
            if prev is not None:
                os.environ["HOME"] = prev

    def _merged_into_main(self):
        return "feature.txt" in self._git("ls-tree", "--name-only", "HEAD").stdout

    def test_green_story_merges(self):
        self.t.goals_create("demo", ["alpha::write feature.txt"])
        self._run_story("G001", self._stub("stub-ok", "alpha"))
        # gate GREEN → checkpoint complete → merge
        self.assertEqual(self.t.run_verification("true"), "")  # exits 0, no output
        self.t.goals_next()
        self.t.goals_checkpoint("G001", "complete", "reviewed", verify_cmd="true",
                                verify_evidence="ok")
        out = self.t.merge_story("G001")
        self.assertNotIn("MERGE CONFLICT", out)
        self.assertTrue(self._merged_into_main(), "green story must land in main")

    def test_red_gate_never_merges(self):
        # THE G002 CLASS: the agent produced work, but its verify command FAILS →
        # the story must be marked failed and its branch must NOT be merged.
        self.t.goals_create("demo", ["alpha::write feature.txt"])
        self._run_story("G001", self._stub("stub-bad", "alpha"))
        gate = self.t.run_verification("false")           # exits non-zero
        self.assertIn("exit code", gate)
        self.assertFalse(self._merged_into_main(), "nothing merged yet")
        # a truthful driver checkpoints failed and never calls merge_story
        self.t.goals_next()
        self.t.goals_checkpoint("G001", "failed", "gate red")
        self.assertFalse(self._merged_into_main(), "a red gate must NOT merge")
        self.assertEqual(self._git("rev-parse", "--verify", "fablize/G001").returncode, 0,
                         "the branch is preserved for inspection")

    def test_merge_conflict_aborts_clean(self):
        # two stories touch the same file; after the first merges, the second conflicts →
        # merge_story must abort and leave a clean (non-MERGING) tree.
        self.t.goals_create("demo", ["alpha::feature.txt", "beta::feature.txt"])
        self._run_story("G001", self._stub("stub-a", "from-alpha"))
        self._run_story("G002", self._stub("stub-b", "from-beta"))
        self.assertNotIn("MERGE CONFLICT", self.t.merge_story("G001"))
        out = self.t.merge_story("G002")
        self.assertIn("MERGE CONFLICT", out)
        self.assertNotIn("MERGE_HEAD", self._git("status", "--porcelain").stdout)
        self.assertFalse((self.repo / ".git" / "MERGE_HEAD").exists(), "merge was aborted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
