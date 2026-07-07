"""loop.py — the closed-loop runner. Mechanics proven with a stub agent (no tokens):
the gate runs every pass, guardrails accumulate, and a repeated failure STOPS the loop
(the budget guard) rather than grinding to max."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

LOOP = str(Path(__file__).resolve().parents[1] / "scripts" / "loop.py")


class LoopTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = {**os.environ, "FABLIZE_STATE": self.tmp, "HOME": self.tmp}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_loop(self, *args):
        return subprocess.run([sys.executable, LOOP, *args], cwd=self.tmp, env=self.env,
                              capture_output=True, text=True)

    def state(self, name):
        return json.loads((Path(self.tmp) / ".fablize" / "loops" / name / "state.json").read_text())

    def guardrails(self, name):
        return Path(self.tmp) / ".fablize" / "loops" / name / "guardrails.md"

    def test_green_immediately(self):
        r = self.run_loop("run", "--name", "g", "--check", "true", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        st = self.state("g")
        self.assertEqual(st["status"], "passed")
        self.assertEqual(len(st["iterations"]), 1)
        self.assertFalse(self.guardrails("g").exists())  # nothing failed → no guardrails

    def test_dry_run_records_one_guardrail(self):
        r = self.run_loop("run", "--name", "d", "--check", "false", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        st = self.state("d")
        self.assertEqual(st["status"], "dry-run")
        self.assertFalse(st["iterations"][0]["ok"])
        self.assertTrue(self.guardrails("d").exists())

    def test_agent_fixes_after_learning(self):
        # gate passes only once a 'fixed' file exists; the stub creates it on its 2nd call,
        # so the loop must fail, record a REPEAT, then pass.
        stub = Path(self.tmp) / "stub.py"
        stub.write_text(
            "import os\n"
            "c = os.path.join(os.environ['FABLIZE_STATE'], 'n')\n"
            "k = int(open(c).read()) if os.path.exists(c) else 0\n"
            "k += 1\n"
            "open(c, 'w').write(str(k))\n"
            "if k >= 2:\n"
            "    open(os.path.join(os.environ['FABLIZE_STATE'], 'fixed'), 'w').write('x')\n")
        chk = "test -f " + os.path.join(self.tmp, "fixed")
        r = self.run_loop("run", "--name", "a", "--check", chk,
                          "--agent", sys.executable + " " + str(stub), "--max", "6")
        st = self.state("a")
        self.assertEqual(st["status"], "passed", r.stdout + r.stderr)
        self.assertTrue(any(it.get("repeat") for it in st["iterations"]))
        self.assertTrue(st["iterations"][-1]["ok"])

    def test_repeated_failure_stops_before_max(self):
        # the agent never fixes anything → the same failure must trip the no-progress
        # guard at STUCK_AFTER (3), not run all the way to --max 10.
        r = self.run_loop("run", "--name", "s", "--check", "false", "--agent", "true", "--max", "10")
        self.assertEqual(r.returncode, 1)
        st = self.state("s")
        self.assertEqual(st["status"], "stuck")
        self.assertEqual(len(st["iterations"]), 3)

    def test_catalog_lists_flagship(self):
        r = self.run_loop("catalog")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("guardrails-learning", r.stdout)
        self.assertIn("flagship", r.stdout)


if __name__ == "__main__":
    unittest.main()
