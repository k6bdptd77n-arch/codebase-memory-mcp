#!/usr/bin/env python3
"""MindForge Evolution Lab: turn repeated evidenced failures into reviewable candidates."""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from brain import atomic_write, state_root


def read_records(root):
    path = Path(root) / ".fablize" / "traces.jsonl"
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def signature(text):
    value = str(text or "").lower()
    value = re.sub(r"(?:[a-z]:)?[/\\][^\s]+", " <path> ", value)
    value = re.sub(r"\b(?:0x)?[0-9a-f]{7,}\b|\b\d+\b", " <n> ", value)
    return " ".join(value.split())[:240]


def scan_failures(records, threshold=3):
    groups = {}
    for record in records:
        failed = str(record.get("failed") or "").strip()
        if not failed:
            continue  # never infer failure from prose; require explicit evidence
        key = signature(failed)
        if not key:
            continue
        item = groups.setdefault(key, {"signature": key, "count": 0, "examples": []})
        item["count"] += 1
        if len(item["examples"]) < 3:
            item["examples"].append({"goal": str(record.get("goal") or record.get("trace") or "")[:200],
                                     "failed": failed[:500]})
    return sorted((item for item in groups.values() if item["count"] >= threshold),
                  key=lambda item: (-item["count"], item["signature"]))


def candidate_id(sig):
    return "skill-" + hashlib.sha256(sig.encode("utf-8")).hexdigest()[:12]


def propose(root, observations):
    created = []
    base = Path(root) / ".fablize" / "evolution" / "candidates"
    for observation in observations:
        cid = candidate_id(observation["signature"])
        path = base / cid / "candidate.json"
        previous = {}
        if path.exists():
            try:
                previous = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                previous = {}
        candidate = {
            "id": cid,
            "kind": "skill-improvement",
            "status": previous.get("status", "observed"),
            "created_at": previous.get("created_at", datetime.now(timezone.utc).isoformat()),
            "signature": observation["signature"],
            "failure_count": observation["count"],
            "evidence": observation["examples"],
            "next_action": "Draft a skill change, run baseline/candidate evals, then request approval.",
        }
        atomic_write(path, json.dumps(candidate, ensure_ascii=False, indent=2) + "\n")
        created.append(candidate)
    return created


def main(argv=None):
    parser = argparse.ArgumentParser(prog="evolve.py")
    parser.add_argument("command", choices=("scan", "propose"))
    parser.add_argument("--threshold", type=int, default=3)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.threshold < 2:
        parser.error("--threshold must be at least 2")
    root = state_root()
    observations = scan_failures(read_records(root), args.threshold)
    result = propose(root, observations) if args.command == "propose" else observations
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif not result:
        print("mindforge evolve: no repeated evidenced failures")
    else:
        for item in result:
            print(f"{item.get('id', 'observation')}  ×{item.get('failure_count', item.get('count'))}  "
                  f"{item['signature']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
