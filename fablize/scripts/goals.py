#!/usr/bin/env python3
"""fablize goal engine — a self-contained, stdlib-only multi-story loop with a verification gate.

Design (behavior only):
  - Decompose a task into sequential stories, persisted to a ledger (.fablize/) — survives session death.
  - A story can be checkpointed only after `next` activates it.
  - A `complete` checkpoint requires non-empty evidence.
  - The final story cannot complete without a verify command + result (the verification gate).

Usage:
  goals.py create --brief "..." --goal "title::objective" [--goal ...]
  goals.py add --goal "title::objective" [--goal ...]   # append stories to an existing plan
  goals.py next                     # activate the next story + print a handoff
  goals.py checkpoint --id G001 --status complete|failed|blocked --evidence "..."
                      [--verify-cmd "<command run>" --verify-evidence "<result>"]   # required on the final story
  goals.py status
State directory: ./.fablize/ (run from the repo root)
"""
import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def state_root(base="."):
    """Where project state lives. A linked git worktree resolves to the MAIN checkout —
    spec/goals/brain are per-project, not per-checkout — so parallel worktree agents share
    one state. Set FABLIZE_STATE to a directory to isolate state explicitly."""
    env = os.environ.get("FABLIZE_STATE")
    if env:
        return Path(env)
    dotgit = Path(base) / ".git"
    if dotgit.is_file():  # linked worktree: .git is a pointer file, not a directory
        try:
            m = re.search(r"gitdir:\s*(.+)", dotgit.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            m = None
        if m:
            gitdir = Path(m.group(1).strip())
            if not gitdir.is_absolute():
                gitdir = Path(base) / gitdir
            parts = gitdir.parts
            if "worktrees" in parts:
                return Path(*parts[: parts.index("worktrees")]).parent  # …/.git/worktrees/X → repo root
    return Path(base)


DIR = state_root() / ".fablize"
GOALS = DIR / "goals.json"
LEDGER = DIR / "ledger.jsonl"
# Global, cross-project event stream for observability (metrics.py reads this).
GLOBAL_LOG = Path.home() / ".fablize" / "events.jsonl"
ESCALATE_AFTER = 2  # blocked attempts on one story before the engine forces escalation


def now():
    return datetime.now(timezone.utc).isoformat()


def log(event, **kw):
    rec = {"ts": now(), "event": event, **kw}
    try:
        DIR.mkdir(parents=True, exist_ok=True)
        with open(LEDGER, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass  # local ledger is best-effort too — never crash the engine on an unwritable dir
    try:
        GLOBAL_LOG.parent.mkdir(exist_ok=True)
        with open(GLOBAL_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({**rec, "tool": "goals", "cwd": str(Path.cwd())}, ensure_ascii=False) + "\n")
    except OSError:
        pass  # never let observability break the engine


def load():
    if not GOALS.exists():
        sys.exit("fablize: no plan — run `create` from the repo root first.")
    try:
        return json.loads(GOALS.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        sys.exit(f"fablize: {GOALS} is corrupt or unreadable — fix or delete it, then re-create the plan.")


def atomic_write(path, text):
    """Crash-safe durable write: stage into a temp file in the same dir, then os.replace
    (atomic rename) so a crash mid-write can never truncate/corrupt the real state file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def save(plan):
    atomic_write(GOALS, json.dumps(plan, ensure_ascii=False, indent=1))


def cmd_create(a):
    if GOALS.exists() and not a.force:
        sys.exit("fablize: a plan already exists. Check it with `status`, or replace it with --force.")
    goals = []
    for i, g in enumerate(a.goal, 1):
        if "::" not in g:
            sys.exit(f"fablize: --goal format is 'title::objective' — invalid: {g}")
        title, obj = g.split("::", 1)
        goals.append({"id": f"G{i:03d}", "title": title.strip(), "objective": obj.strip(),
                      "status": "pending", "evidence": None, "attempts": 0})
    if not goals:
        sys.exit("fablize: at least one --goal is required.")
    save({"brief": a.brief, "created": now(), "goals": goals})
    log("plan_created", brief=a.brief, count=len(goals))
    print(f"fablize: plan created — {len(goals)} stories")
    for g in goals:
        print(f"  {g['id']} {g['title']}: {g['objective']}")


def cmd_add(a):
    plan = load()  # exits if no plan — `add` extends, never creates
    if not a.goal:
        sys.exit("fablize: at least one --goal is required.")
    start = max((int(g["id"][1:]) for g in plan["goals"]), default=0) + 1
    added = []
    for i, g in enumerate(a.goal, start):
        if "::" not in g:
            sys.exit(f"fablize: --goal format is 'title::objective' — invalid: {g}")
        title, obj = g.split("::", 1)
        added.append({"id": f"G{i:03d}", "title": title.strip(), "objective": obj.strip(),
                      "status": "pending", "evidence": None, "attempts": 0})
    # Appending moves the verification gate: `next`/`checkpoint` treat plan["goals"][-1]
    # as the final story, so the new last story now carries the gate.
    plan["goals"].extend(added)
    save(plan)
    log("stories_added", count=len(added), total=len(plan["goals"]))
    print(f"fablize: {len(added)} stories added — {len(plan['goals'])} total")
    for g in added:
        print(f"  {g['id']} {g['title']}: {g['objective']}")


def cmd_next(a):
    plan = load()
    active = [g for g in plan["goals"] if g["status"] == "in_progress"]
    if active:
        g = active[0]
    else:
        pending = [g for g in plan["goals"] if g["status"] == "pending"]
        if not pending:
            stuck = [g for g in plan["goals"] if g["status"] in ("blocked", "failed")]
            if stuck:
                print(f"fablize: no pending stories, but {len(stuck)} failed/blocked — reopen one with "
                      f"`retry --id {stuck[0]['id']}` or report the blocker.")
            else:
                print("fablize: all stories complete ✓")
            return
        g = pending[0]
        g["status"] = "in_progress"
        save(plan); log("story_started", id=g["id"], title=g["title"])
    is_final = g["id"] == plan["goals"][-1]["id"]
    print(f"=== fablize handoff — {g['id']} {g['title']}")
    print(f"Objective: {g['objective']}")
    print("Rule: work this story only. Produce evidence as you go.")
    if is_final:
        print("★ Final story — the complete checkpoint requires --verify-cmd and --verify-evidence (verification gate).")
    print(f"On completion: goals.py checkpoint --id {g['id']} --status complete --evidence \"<evidence>\""
          + (" --verify-cmd \"<command>\" --verify-evidence \"<result>\"" if is_final else ""))


def cmd_retry(a):
    plan = load()
    g = next((x for x in plan["goals"] if x["id"] == a.id), None)
    if not g:
        sys.exit(f"fablize: {a.id} not found.")
    if g["status"] not in ("blocked", "failed"):
        sys.exit(f"fablize: {a.id} is {g['status']} — only a blocked/failed story can be retried.")
    g["status"] = "in_progress"
    save(plan)
    attempt = g.get("attempts", 0) + 1
    log("story_started", id=g["id"], title=g["title"], retry=True, attempt=attempt)
    print(f"↻ fablize retry — {g['id']} (attempt {attempt}); escalates at {ESCALATE_AFTER} failures.")
    print(f"Objective: {g['objective']}")


def cmd_checkpoint(a):
    plan = load()
    g = next((x for x in plan["goals"] if x["id"] == a.id), None)
    if not g:
        sys.exit(f"fablize: {a.id} not found.")
    if g["status"] != "in_progress":
        sys.exit(f"fablize: {a.id} is not active ({g['status']}) — activate it with `next` first.")
    if a.status == "complete":
        if not (a.evidence and a.evidence.strip()):
            sys.exit("fablize: a complete checkpoint requires non-empty --evidence.")
        if g["id"] == plan["goals"][-1]["id"]:
            if not (a.verify_cmd and a.verify_cmd.strip() and a.verify_evidence and a.verify_evidence.strip()):
                sys.exit("fablize: the final story cannot complete without --verify-cmd and --verify-evidence (verification gate).")
    # Self-correction counter: a blocked/failed checkpoint is an attempt. After ESCALATE_AFTER
    # of them on the same story, the engine stops the retry spiral and prints an escalation handoff
    # (best-practice: bounded self-correction, then escalate — never loop forever).
    if a.status in ("blocked", "failed"):
        g["attempts"] = g.get("attempts", 0) + 1
    g["status"] = a.status
    g["evidence"] = a.evidence
    save(plan)
    log("checkpoint", id=g["id"], status=a.status, evidence=a.evidence,
        attempts=g.get("attempts", 0), verify_cmd=a.verify_cmd, verify_evidence=a.verify_evidence)
    print(f"fablize: {g['id']} → {a.status}")
    if a.status in ("blocked", "failed") and g.get("attempts", 0) >= ESCALATE_AFTER:
        log("escalation_triggered", id=g["id"], attempts=g["attempts"])
        print(f"★ fablize escalation gate — {g['id']} has failed {g['attempts']}× (≥{ESCALATE_AFTER}).")
        print("  This is likely the model's capability ceiling, not a procedure gap. In order:")
        print("  1) recommend `/effort xhigh` to push the current model to its ceiling;")
        print("  2) hand off to a stronger model in a fresh session with an evidence package")
        print("     (symptoms, attempts, failure point, repro);")
        print("  3) otherwise report the limit honestly and name where a human must step in.")
        return
    # "all complete" must mean every story is COMPLETE — a failed/blocked story is NOT done, so
    # count anything non-complete as remaining (was: only pending/in_progress, which falsely
    # declared success while a story sat failed/blocked).
    incomplete = [x for x in plan["goals"] if x["status"] != "complete"]
    if not incomplete:
        print("fablize: all stories complete ✓")
    else:
        unresolved = [x for x in incomplete if x["status"] in ("failed", "blocked")]
        tail = f" ({len(unresolved)} failed/blocked — retry or report)" if unresolved else ""
        print(f"fablize: {len(incomplete)} stories left{tail} — continue with `next`.")


def cmd_status(a):
    plan = load()
    done = sum(1 for g in plan["goals"] if g["status"] == "complete")
    print(f"fablize: {done}/{len(plan['goals'])} complete — {plan['brief']}")
    mark = {"complete": "✓", "in_progress": "▶", "pending": "·", "failed": "✗", "blocked": "■"}
    for g in plan["goals"]:
        print(f"  {mark.get(g['status'],'?')} {g['id']} [{g['status']}] {g['title']}")


def main():
    p = argparse.ArgumentParser(prog="goals.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create"); c.add_argument("--brief", required=True)
    c.add_argument("--goal", action="append", default=[]); c.add_argument("--force", action="store_true")
    ad = sub.add_parser("add"); ad.add_argument("--goal", action="append", default=[])
    sub.add_parser("next")
    k = sub.add_parser("checkpoint"); k.add_argument("--id", required=True)
    k.add_argument("--status", required=True, choices=["complete", "failed", "blocked"])
    k.add_argument("--evidence", default=""); k.add_argument("--verify-cmd", dest="verify_cmd", default="")
    k.add_argument("--verify-evidence", dest="verify_evidence", default="")
    rt = sub.add_parser("retry"); rt.add_argument("--id", required=True)
    sub.add_parser("status")
    a = p.parse_args()
    {"create": cmd_create, "add": cmd_add, "next": cmd_next, "checkpoint": cmd_checkpoint,
     "retry": cmd_retry, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    main()
