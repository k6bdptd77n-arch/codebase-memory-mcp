#!/usr/bin/env python3
"""fablize orchestrator — parallel worktree agents over the goals.py plan (stdlib-only).

Design (behavior only):
  - The goal engine (goals.py) holds the plan; this script fans stories out to headless
    Claude Code agents (`claude -p`), each in its own linked git worktree on branch
    fablize/<id> — the main checkout is never touched (the Auto-Claude idea, without
    vendoring Auto-Claude: same isolation, ~200 lines, no AGPL).
  - Thanks to worktree-aware state resolution (state_root in spec/goals/brain), every
    agent reads the SHARED project brain/spec from the main checkout automatically.
  - Honest boundary: the orchestrator never checkpoints stories itself — completion
    needs evidence a human or the driving agent verifies. It runs, reports, and prints
    the exact goals.py / git commands that close the loop.

Usage:
  orchestrate.py plan  [--ids G001,G003]                     # what would run (always safe)
  orchestrate.py run   [--ids ...] [--parallel N] [--dry-run]
                       [--claude-cmd claude] [--permission-mode acceptEdits]
  orchestrate.py clean [--ids ...]                           # print worktree cleanup commands
State: worktrees under .fablize/worktrees/<id>, logs under .fablize/orchestrator/<id>.log.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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


ROOT = state_root()
DIR = ROOT / ".fablize"
GOALS = DIR / "goals.json"
LEDGER = DIR / "ledger.jsonl"
WORKTREES = DIR / "worktrees"
LOGS = DIR / "orchestrator"
# Global, cross-project event stream for observability (metrics.py reads this).
GLOBAL_LOG = Path.home() / ".fablize" / "events.jsonl"


def now():
    return datetime.now(timezone.utc).isoformat()


def log(event, **kw):
    rec = {"ts": now(), "event": event, **kw}
    try:
        DIR.mkdir(parents=True, exist_ok=True)
        with open(LEDGER, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass  # observability must never crash the engine
    try:
        GLOBAL_LOG.parent.mkdir(exist_ok=True)
        with open(GLOBAL_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({**rec, "tool": "orchestrate", "cwd": str(Path.cwd())}, ensure_ascii=False) + "\n")
    except OSError:
        pass  # never let observability break the engine


def load_plan():
    if not GOALS.exists():
        sys.exit("fablize: no plan — create one with goals.py first (the orchestrator only runs a plan).")
    try:
        return json.loads(GOALS.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        sys.exit(f"fablize: {GOALS} is corrupt or unreadable — fix it, then re-run.")


def select_stories(plan, ids):
    """Pending stories only; --ids narrows further. Running an in_progress/complete story
    would fight the goal engine's own lifecycle."""
    wanted = {i.strip() for i in ids.split(",") if i.strip()} if ids else None
    out = []
    for g in plan["goals"]:
        if g["status"] != "pending":
            continue
        if wanted is not None and g["id"] not in wanted:
            continue
        out.append(g)
    return out


def build_prompt(plan, story):
    """The handoff each headless agent receives. Scope-locked to ONE story; the goal
    ledger stays orchestrator-owned so parallel agents cannot race goals.json."""
    return (
        f"You are one agent in a parallel fablize build: {plan['brief']}\n"
        f"Your story — {story['id']} {story['title']}: {story['objective']}\n"
        "Rules:\n"
        "- Work ONLY this story, inside this worktree; stay in scope.\n"
        "- Do NOT run goals.py or edit .fablize state — the orchestrator owns the ledger.\n"
        "- Verify your work by actually running it (python3/pytest/npm test and local\n"
        "  git add/commit are pre-allowed in this worktree), then commit on this branch.\n"
        "- Finish with a short report: what changed, what command proves it works."
    )


def agent_cmd(claude_cmd, prompt, permission_mode, agent_args=(), style="claude"):
    """Build the headless agent command. agent_args are appended verbatim (e.g. --model /
    --mcp-config from a crew role config). `style` adapts the invocation to other coding
    CLIs — the worktree isolation and the review/merge loop stay identical:
      claude → claude -p <prompt> --permission-mode <mode>
      codex  → codex exec --full-auto <prompt>
      aider  → aider --yes-always --message <prompt>"""
    if style == "codex":
        return [claude_cmd, "exec", "--full-auto", prompt, *agent_args]
    if style == "aider":
        return [claude_cmd, "--yes-always", "--message", prompt, *agent_args]
    return [claude_cmd, "-p", prompt, "--permission-mode", permission_mode, *agent_args]


# The golden middle for headless agents: acceptEdits alone lets an agent edit files but not RUN
# anything — so it cannot verify its own work or commit it. Instead of bypassing permissions
# wholesale, each worktree gets a narrow allowlist: run tests/code, commit locally. No network
# tools, no push, no rm.
AGENT_ALLOW = [
    "Bash(python3:*)", "Bash(python:*)", "Bash(pytest:*)",
    "Bash(node:*)", "Bash(npm test:*)", "Bash(npm run:*)",
    "Bash(make:*)", "Bash(go test:*)", "Bash(cargo test:*)",
    "Bash(git add:*)", "Bash(git commit:*)", "Bash(git status)",
    "Bash(git diff:*)", "Bash(git log:*)",
]


def seed_agent_settings(wt):
    """Write .claude/settings.local.json into the worktree so the headless agent can
    self-verify (run tests) and commit — and nothing more. Local settings never land
    in the branch diff. Existing settings are left untouched."""
    path = wt / ".claude" / "settings.local.json"
    if path.exists():
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"permissions": {"allow": AGENT_ALLOW}}, indent=1) + "\n",
                        encoding="utf-8")
    except OSError:
        pass  # agent still runs, just without self-verification powers


def worktree_add_cmd(story):
    return ["git", "worktree", "add", "-B", f"fablize/{story['id']}",
            str(WORKTREES / story["id"]), "HEAD"]


# Serialize `git worktree add` across the pool: concurrent adds race on the shared repo's
# index.lock, turning a transient lock into a hard story failure. Only the add is locked —
# the agents themselves still run fully in parallel.
_WORKTREE_LOCK = threading.Lock()


def worktree_add(add):
    with _WORKTREE_LOCK:
        r = subprocess.run(add, cwd=str(ROOT), capture_output=True, text=True)
        if r.returncode != 0 and re.search(r"index\.lock|unable to lock|\.lock", r.stderr or ""):
            time.sleep(0.5)  # one retry after a short backoff — lock contention is transient
            r = subprocess.run(add, cwd=str(ROOT), capture_output=True, text=True)
    return r


def run_story(plan, story, a):
    wt = WORKTREES / story["id"]
    logf = LOGS / f"{story['id']}.log"
    add = worktree_add_cmd(story)
    cmd = agent_cmd(a.claude_cmd, build_prompt(plan, story), a.permission_mode, a.agent_arg, a.agent_style)
    if a.dry_run:  # a dry run must leave the tree untouched — no dirs, no worktrees
        print(f"[dry-run] {story['id']}: {' '.join(add)}")
        print(f"[dry-run] {story['id']}: (cwd={wt}) {cmd[0]} -p '<handoff prompt>' "
              f"--permission-mode {a.permission_mode}  # log → {logf}")
        return story["id"], None
    LOGS.mkdir(parents=True, exist_ok=True)
    wtadd = worktree_add(add)
    if wtadd.returncode != 0 and not wt.exists():
        print(f"✗ {story['id']}: worktree add failed — {wtadd.stderr.strip()[:200]}")
        log("orchestrator_story", id=story["id"], rc=wtadd.returncode, stage="worktree")
        return story["id"], wtadd.returncode
    seed_agent_settings(wt)
    with open(logf, "w", encoding="utf-8") as out:
        rc = subprocess.run(cmd, cwd=str(wt), stdout=out, stderr=subprocess.STDOUT).returncode
    print(f"{'✓' if rc == 0 else '✗'} {story['id']} agent exited rc={rc} — log: {logf}")
    log("orchestrator_story", id=story["id"], rc=rc, stage="agent")
    return story["id"], rc


def cmd_plan(a):
    plan = load_plan()
    stories = select_stories(plan, a.ids)
    if not stories:
        print("fablize orchestrator: nothing pending to run.")
        return
    print(f"fablize orchestrator — {len(stories)} story(ies) would run, "
          f"{min(a.parallel, len(stories))} at a time:")
    for g in stories:
        print(f"  {g['id']} {g['title']} → worktree {WORKTREES / g['id']} (branch fablize/{g['id']})")
    print("Run them with: orchestrate.py run" + (f" --ids {a.ids}" if a.ids else ""))


def cmd_run(a):
    plan = load_plan()
    stories = select_stories(plan, a.ids)
    if not stories:
        print("fablize orchestrator: nothing pending to run.")
        return
    if a.agent_style != "claude" and a.claude_cmd == "claude":
        a.claude_cmd = a.agent_style  # style implies its own binary unless overridden
    log("orchestrator_run", count=len(stories), parallel=a.parallel, dry_run=a.dry_run, style=a.agent_style)
    with ThreadPoolExecutor(max_workers=max(1, a.parallel)) as pool:
        results = list(pool.map(lambda s: run_story(plan, s, a), stories))
    if a.dry_run:
        print("fablize orchestrator: dry-run only — nothing was executed.")
        return
    print("\nClose the loop (verify each story's evidence yourself, then):")
    for sid, rc in results:
        tail = ('complete --evidence "<verified evidence>"' if rc == 0
                else 'failed --evidence "<what failed>"')
        print(f"  goals.py next && goals.py checkpoint --id {sid} --status {tail}")
        print(f"  git merge fablize/{sid}   # after review; then: git worktree remove {WORKTREES / sid}")


def cmd_clean(a):
    plan = load_plan()
    ids = [g["id"] for g in plan["goals"]] if not a.ids else a.ids.split(",")
    print("Cleanup commands (run after merging what you keep):")
    for sid in ids:
        wt = WORKTREES / sid.strip()
        if wt.exists():
            print(f"  git worktree remove {wt} && git branch -D fablize/{sid.strip()}")


def main():
    p = argparse.ArgumentParser(prog="orchestrate.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "run", "clean"):
        s = sub.add_parser(name)
        s.add_argument("--ids", default="")
        s.add_argument("--parallel", type=int, default=3)
        if name == "run":
            s.add_argument("--dry-run", action="store_true")
            s.add_argument("--claude-cmd", default="claude")
            s.add_argument("--permission-mode", default="acceptEdits")
            s.add_argument("--agent-arg", action="append", default=[])
            s.add_argument("--agent-style", default="claude", choices=["claude", "codex", "aider"])
    a = p.parse_args()
    {"plan": cmd_plan, "run": cmd_run, "clean": cmd_clean}[a.cmd](a)


if __name__ == "__main__":
    main()
