#!/usr/bin/env python3
"""metrics.py tests — the --project filter must make per-project numbers possible
(cwd equals PATH or is under it) without changing the default all-projects behavior.
"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
METRICS = REPO / "fablize" / "scripts" / "metrics.py"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


metrics = load(METRICS, "fablize_metrics")

EVENTS = [
    {"ts": "2026-06-01T10:00:00", "event": "plan_created", "cwd": "/home/u/work/app"},
    {"ts": "2026-06-02T10:00:00", "event": "story_started", "cwd": "/home/u/work/app/sub"},
    {"ts": "2026-06-03T10:00:00", "event": "checkpoint", "status": "complete", "cwd": "/home/u/work/app-extra"},
    {"ts": "2026-06-04T10:00:00", "event": "spec_locked", "cwd": "/home/u/other"},
    {"ts": "2026-06-05T10:00:00", "event": "recall"},  # no cwd at all
]


class MetricsProjectFilter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False, encoding="utf-8")
        for e in EVENTS:
            self.tmp.write(json.dumps(e) + "\n")
        self.tmp.close()
        self._orig_log = metrics.GLOBAL_LOG
        metrics.GLOBAL_LOG = Path(self.tmp.name)

    def tearDown(self):
        metrics.GLOBAL_LOG = self._orig_log
        Path(self.tmp.name).unlink(missing_ok=True)

    def test_default_reads_everything(self):
        self.assertEqual(len(metrics.read_events()), len(EVENTS))

    def test_project_exact_and_subdirs(self):
        got = metrics.read_events(project="/home/u/work/app")
        self.assertEqual([e["event"] for e in got], ["plan_created", "story_started"])

    def test_prefix_sibling_not_matched(self):
        # /home/u/work/app-extra must NOT match project /home/u/work/app
        got = metrics.read_events(project="/home/u/work/app")
        self.assertNotIn("checkpoint", [e["event"] for e in got])

    def test_cost_block_aggregates_duration_and_cost(self):
        evs = [
            {"ts": "2026-06-01T10:00:00", "event": "orchestrator_story", "id": "G001", "rc": 0,
             "duration_s": 12.5, "cost_usd": 0.03},
            {"ts": "2026-06-01T10:05:00", "event": "orchestrator_story", "id": "G002", "rc": 0,
             "duration_s": 7.5},  # no cost reported
        ]
        s = metrics.summarize(evs)
        self.assertIn("cost", s)
        self.assertEqual(s["cost"]["story_seconds"], 20.0)
        self.assertEqual(s["cost"]["story_cost_usd"], 0.03)
        self.assertEqual(s["cost"]["stories_timed"], 2)

    def test_events_without_cwd_excluded_when_filtering(self):
        got = metrics.read_events(project="/home/u")
        self.assertNotIn("recall", [e["event"] for e in got])

    def test_trailing_slash_normalized(self):
        got = metrics.read_events(project="/home/u/work/app/")
        self.assertEqual(len(got), 2)

    def test_no_match_gives_empty(self):
        self.assertEqual(metrics.read_events(project="/nowhere"), [])

    def test_since_and_project_combine(self):
        got = metrics.read_events(since="2026-06-02", project="/home/u/work/app")
        self.assertEqual([e["event"] for e in got], ["story_started"])

    def test_in_project_helper(self):
        self.assertTrue(metrics.in_project("/a/b", "/a/b"))
        self.assertTrue(metrics.in_project("/a/b/c/d", "/a/b"))
        self.assertFalse(metrics.in_project("/a/bc", "/a/b"))
        self.assertFalse(metrics.in_project("", "/a/b"))

    def test_summarize_on_filtered_events(self):
        s = metrics.summarize(metrics.read_events(project="/home/u/work/app"))
        self.assertEqual(s["events_total"], 2)
        self.assertEqual(s["plans_created"], 1)
        self.assertEqual(s["stories_started"], 1)
        self.assertEqual(s["projects"], 2)  # app and app/sub are distinct cwds


if __name__ == "__main__":
    unittest.main()
