#!/usr/bin/env python3
"""fablize metrics — summarize the cross-project event stream (~/.fablize/events.jsonl).

This is the observability layer: it turns the raw event log written by goals.py / spec.py /
brain.py into real, queryable numbers (how many plans, completion rate, how often work hit the
escalation gate, how many specs were locked, how the brain layer is growing). It gives the
"verified-only" philosophy actual data to decide on, instead of self-assessment.

Usage:
  metrics.py              # human-readable summary
  metrics.py --json       # machine-readable
  metrics.py --since 2026-06-01   # only events on/after this ISO date
"""
import argparse
import json
from collections import Counter
from pathlib import Path

GLOBAL_LOG = Path.home() / ".fablize" / "events.jsonl"


def read_events(since=""):
    if not GLOBAL_LOG.exists():
        return []
    out = []
    # errors="replace": one torn/invalid byte (e.g. an interleaved concurrent append) must not
    # crash the whole summary — the per-line try/except below can only help if decoding got this far.
    for line in GLOBAL_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if since and rec.get("ts", "") < since:
            continue
        out.append(rec)
    return out


def summarize(events):
    ev = Counter(e.get("event") for e in events)
    checkpoints = [e for e in events if e.get("event") == "checkpoint"]
    statuses = Counter(c.get("status") for c in checkpoints)
    orch_stories = [e for e in events if e.get("event") == "orchestrator_story"]
    orch_ok = sum(1 for e in orch_stories if e.get("rc") == 0)
    completed = statuses.get("complete", 0)
    total_ck = len(checkpoints)
    projects = {e.get("cwd") for e in events if e.get("cwd")}
    return {
        "events_total": len(events),
        "plans_created": ev.get("plan_created", 0),
        "stories_started": ev.get("story_started", 0),
        "checkpoints": total_ck,
        "checkpoint_status": dict(statuses),
        "completion_rate": round(completed / total_ck, 3) if total_ck else None,
        "escalations": ev.get("escalation_triggered", 0),
        "specs_locked": ev.get("spec_locked", 0),
        "projects": len(projects),
        # Orchestrator layer: parallel worktree agents fanned out over the plan.
        "orchestrator": {
            "runs": ev.get("orchestrator_run", 0),
            "stories_ok": orch_ok,
            "stories_failed": len(orch_stories) - orch_ok,
        },
        # Brain layer (the third layer): is the persistent memory actually being used and growing?
        "brain": {
            "facts_saved": ev.get("fact_saved", 0),
            "facts_forgotten": ev.get("fact_forgotten", 0),
            "recalls": ev.get("recall", 0),
            "reflects": ev.get("reflect", 0),
            "relations_emitted": ev.get("relate_emitted", 0),
            # net facts in the store = saved minus forgotten (a rough growth signal, never below 0)
            "net_facts": max(ev.get("fact_saved", 0) - ev.get("fact_forgotten", 0), 0),
        },
    }


def main():
    p = argparse.ArgumentParser(prog="metrics.py")
    p.add_argument("--json", action="store_true")
    p.add_argument("--since", default="")
    a = p.parse_args()
    s = summarize(read_events(a.since))
    if a.json:
        print(json.dumps(s, ensure_ascii=False, indent=2))
        return
    if not s["events_total"]:
        print("fablize: no events yet (~/.fablize/events.jsonl is empty). Run a goals/spec flow first.")
        return
    print(f"fablize metrics{(' since ' + a.since) if a.since else ''} — {s['events_total']} events across {s['projects']} project(s)")
    print(f"  plans created     : {s['plans_created']}")
    print(f"  stories started   : {s['stories_started']}")
    print(f"  checkpoints       : {s['checkpoints']}  {s['checkpoint_status']}")
    rate = f"{s['completion_rate']*100:.1f}%" if s["completion_rate"] is not None else "n/a"
    print(f"  completion rate   : {rate}")
    print(f"  escalation gate   : {s['escalations']} hit(s)")
    print(f"  specs locked      : {s['specs_locked']}")
    o = s["orchestrator"]
    if any(o.values()):
        print(f"  orchestrator      : {o['runs']} run(s), "
              f"{o['stories_ok']} story(ies) ok / {o['stories_failed']} failed")
    b = s["brain"]
    if any(b.values()):
        print(f"  brain (3rd layer) : {b['net_facts']} fact(s) net "
              f"({b['facts_saved']} saved / {b['facts_forgotten']} forgotten), "
              f"{b['reflects']} reflect(s), {b['recalls']} recall(s), "
              f"{b['relations_emitted']} relation(s)→graph")


if __name__ == "__main__":
    main()
