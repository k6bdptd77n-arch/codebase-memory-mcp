#!/usr/bin/env python3
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("evolve", ROOT / "scripts" / "evolve.py")
EVOLVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVOLVE)


class EvolutionTests(unittest.TestCase):
    def test_requires_repeated_explicit_failure_evidence(self):
        records = [
            {"goal": "first", "failed": "pytest failed at /tmp/a.py line 41"},
            {"goal": "second", "failed": "pytest failed at /tmp/b.py line 99"},
            {"goal": "third", "failed": "pytest failed at /tmp/c.py line 120"},
            {"goal": "not evidence", "result": "error-looking prose is not a failure label"},
        ]
        observations = EVOLVE.scan_failures(records, threshold=3)
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["count"], 3)

    def test_proposal_is_reviewable_and_idempotent(self):
        root = Path(tempfile.mkdtemp())
        observation = {"signature": "verification command omitted", "count": 3,
                       "examples": [{"goal": "x", "failed": "verification command omitted"}]}
        first = EVOLVE.propose(root, [observation])[0]
        second = EVOLVE.propose(root, [{**observation, "count": 4}])[0]
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["created_at"], second["created_at"])
        self.assertEqual(second["failure_count"], 4)
        self.assertEqual(second["status"], "observed")
        path = root / ".fablize" / "evolution" / "candidates" / first["id"] / "candidate.json"
        self.assertEqual(json.loads(path.read_text())["id"], first["id"])


if __name__ == "__main__":
    unittest.main()
