#!/usr/bin/env python3
"""Crash-safety tests for the atomic state writes (temp file + os.replace).

Every durable state write in the engines must be all-or-nothing: a crash mid-write
(simulated here by making os.replace blow up) must leave the previous state file
intact and valid, and must not litter the state dir with *.tmp leftovers.
"""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
GOALS = ROOT / "scripts" / "goals.py"
SPEC = ROOT / "scripts" / "spec.py"


def load(path, name, state_dir):
    """Load an engine as a module with its .fablize state pinned to a sandbox dir."""
    os.environ["FABLIZE_STATE"] = str(state_dir)
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        os.environ.pop("FABLIZE_STATE", None)


class AtomicGoalsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.g = load(GOALS, "goals_atomic_test", self.tmp)
        self.plan_v1 = {"brief": "v1", "created": "t", "goals": [
            {"id": "G001", "title": "a", "objective": "x", "status": "pending",
             "evidence": None, "attempts": 0}]}

    def _tmp_leftovers(self):
        return list((self.tmp / ".fablize").glob("*.tmp"))

    def test_crash_mid_save_keeps_original_intact(self):
        # (a) first save lands; then os.replace "crashes" during the second save —
        # goals.json must still hold the FIRST plan as valid JSON.
        self.g.save(self.plan_v1)
        with mock.patch("os.replace", side_effect=OSError("simulated crash")):
            with self.assertRaises(OSError):
                self.g.save({**self.plan_v1, "brief": "v2-must-not-land"})
        on_disk = json.loads(self.g.GOALS.read_text(encoding="utf-8"))
        self.assertEqual(on_disk["brief"], "v1")
        self.assertEqual(self._tmp_leftovers(), [], "staged .tmp not cleaned after crash")

    def test_sequential_saves_are_valid_and_clean(self):
        # (b) two sequential saves → latest content, valid JSON, no stray *.tmp —
        # even after an interleaved simulated failure.
        self.g.save(self.plan_v1)
        with mock.patch("os.replace", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                self.g.save({**self.plan_v1, "brief": "lost"})
        self.g.save({**self.plan_v1, "brief": "v3"})
        on_disk = json.loads(self.g.GOALS.read_text(encoding="utf-8"))
        self.assertEqual(on_disk["brief"], "v3")
        self.assertEqual(self._tmp_leftovers(), [])


class AtomicSpecTests(unittest.TestCase):
    def test_spec_lock_write_is_atomic(self):
        # same helper, same contract in spec.py — a crash never corrupts spec.json
        tmp = Path(tempfile.mkdtemp())
        s = load(SPEC, "spec_atomic_test", tmp)
        s.atomic_write(s.SPEC, json.dumps({"brief": "v1"}))
        with mock.patch("os.replace", side_effect=OSError("simulated crash")):
            with self.assertRaises(OSError):
                s.atomic_write(s.SPEC, json.dumps({"brief": "v2"}))
        self.assertEqual(json.loads(s.SPEC.read_text(encoding="utf-8"))["brief"], "v1")
        self.assertEqual(list((tmp / ".fablize").glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
