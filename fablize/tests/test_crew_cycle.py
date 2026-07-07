#!/usr/bin/env python3
"""crew/mindforge_crew.py control-flow tests — run WITHOUT crewai installed.

The crewai import is lazy, so the deterministic loop (cycle, verify_cmd) must import
and run cleanly in CI with no LLM stack. The engine boundary (mt.*) and the LLM
review are monkeypatched to recorded stubs; what's under test is the ORDER and the
GUARDS: checkpoint+merge only on COMPLETE, never on FAILED, and never for a story
goals_next did not actually activate.
"""
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent.parent
CREW = ROOT / "crew" / "mindforge_crew.py"


def load_crew():
    spec = importlib.util.spec_from_file_location("mindforge_crew_test", CREW)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class CycleTests(unittest.TestCase):
    def setUp(self):
        self.mc = load_crew()
        self.calls = []
        self._orig = {}
        # stub every engine function cycle() touches, recording the call order
        stubs = {
            "goals_status": lambda: "fablize: 0/1 complete — demo\n  · G001 [pending] alpha",
            "run_story": lambda sid, **kw: self._rec("run", sid) or f"ran {sid}",
            "review_story": lambda sid: self._rec("evidence", sid) or "diff+log for " + sid,
            "goals_next": lambda: self._rec("next") or "=== fablize handoff — G001 alpha",
            "goals_checkpoint": lambda sid, status, ev, **kw:
                self._rec("checkpoint", sid, status, kw.get("verify_cmd", "")) or "ok",
            "merge_story": lambda sid: self._rec("merge", sid) or "merged",
            "run_verification": lambda cmd="", **kw: self._rec("verify", cmd) or "1 passed",
            "write_receipt": lambda sid, **kw: self._rec("receipt", sid, kw.get("mode")) or "ok",
            "brain_reflect": lambda *a, **kw: self._rec("reflect") or "ok",
        }
        for name, fn in stubs.items():
            self._orig[name] = getattr(self.mc.mt, name)
            setattr(self.mc.mt, name, fn)

    def tearDown(self):
        # mindforge_tools is a shared sys.modules entry — restore what we stubbed
        for name, fn in self._orig.items():
            setattr(self.mc.mt, name, fn)

    def _rec(self, *call):
        self.calls.append(call)

    def _ops(self):
        return [c[0] for c in self.calls]

    def test_module_imports_without_crewai(self):
        try:
            import crewai  # noqa: F401
            self.skipTest("crewai is installed in this interpreter")
        except ImportError:
            pass
        # the module loaded in setUp already proves the lazy import; the LLM paths
        # must still fail with the friendly setup message when actually reached
        with self.assertRaises(SystemExit) as cm:
            self.mc.planner_agent()
        self.assertIn("crewai is not installed", str(cm.exception))

    def test_complete_verdict_checkpoints_then_merges(self):
        self.mc.review = lambda sid, evidence=None: "VERDICT: COMPLETE — evidence checks out"
        self.mc.cycle()
        self.assertEqual(self._ops(),
                         ["run", "evidence", "next", "verify", "checkpoint", "merge", "receipt", "reflect"])
        self.assertEqual(self.calls[4][1:3], ("G001", "complete"))

    def test_failed_verdict_never_merges(self):
        self.mc.review = lambda sid, evidence=None: "VERDICT: FAILED — no tests in the log"
        self.mc.cycle()
        self.assertEqual(self._ops(), ["run", "evidence", "next", "checkpoint", "reflect"])
        self.assertEqual(self.calls[3][1:3], ("G001", "failed"))
        self.assertNotIn("merge", self._ops())
        self.assertNotIn("receipt", self._ops())
        self.assertNotIn("verify", self._ops())  # the gate only runs on COMPLETE

    def test_skips_story_goals_next_did_not_activate(self):
        # plan drift: goals_next hands off a DIFFERENT story → no checkpoint, no merge
        self.mc.mt.goals_next = lambda: self._rec("next") or "=== fablize handoff — G002 beta"
        self.mc.review = lambda sid, evidence=None: "VERDICT: COMPLETE — looks fine"
        self.mc.cycle()
        self.assertEqual(self._ops(), ["run", "evidence", "next", "reflect"])

    def test_verify_cmd_env_override_threads_to_gate_and_checkpoint(self):
        self.mc.review = lambda sid, evidence=None: "VERDICT: COMPLETE — ok"
        with mock.patch.dict(os.environ, {"MINDFORGE_VERIFY_CMD": "make test-custom"}):
            self.mc.cycle()
        verify = next(c for c in self.calls if c[0] == "verify")
        checkpoint = next(c for c in self.calls if c[0] == "checkpoint")
        self.assertEqual(verify[1], "make test-custom")
        self.assertEqual(checkpoint[3], "make test-custom")

    def test_verify_cmd_falls_back_to_default(self):
        os.environ.pop("MINDFORGE_VERIFY_CMD", None)
        self.assertEqual(self.mc.verify_cmd(), self.mc.DEFAULT_VERIFY)

    def test_trust_dial_defaults_to_auto_on_green(self):
        os.environ.pop("MINDFORGE_MODE", None)
        self.assertEqual(self.mc.crew_mode(), "auto-on-green")

    def test_trust_dial_env_override(self):
        with mock.patch.dict(os.environ, {"MINDFORGE_MODE": "manual"}):
            self.assertEqual(self.mc.crew_mode(), "manual")

    def test_manual_mode_never_merges_even_on_complete(self):
        # the trust dial says a human must merge — COMPLETE stays reviewed-but-pending
        self.mc.review = lambda sid, evidence=None: "VERDICT: COMPLETE — evidence checks out"
        with mock.patch.dict(os.environ, {"MINDFORGE_MODE": "manual"}):
            self.mc.cycle()
        self.assertEqual(self._ops(), ["run", "evidence", "next", "reflect"])
        self.assertNotIn("checkpoint", self._ops())
        self.assertNotIn("merge", self._ops())
        self.assertNotIn("receipt", self._ops())

    def test_review_required_mode_never_merges(self):
        self.mc.review = lambda sid, evidence=None: "VERDICT: COMPLETE — evidence checks out"
        with mock.patch.dict(os.environ, {"MINDFORGE_MODE": "review-required"}):
            self.mc.cycle()
        self.assertNotIn("merge", self._ops())

    def test_receipt_written_with_mode_on_auto_merge(self):
        self.mc.review = lambda sid, evidence=None: "VERDICT: COMPLETE — evidence checks out"
        self.mc.cycle()
        receipt = next(c for c in self.calls if c[0] == "receipt")
        self.assertEqual(receipt[1], "G001")
        self.assertEqual(receipt[2], "auto-on-green")


if __name__ == "__main__":
    unittest.main(verbosity=2)
