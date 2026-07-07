#!/usr/bin/env python3
"""MindForge tool functions for the crewAI orchestration layer — stdlib only.

Design (behavior only):
  - crewAI is the orchestration BRAIN (plan, review, retry); headless Claude Code agents
    in git worktrees stay the HANDS (they write the code, on the subscription, inside the
    permission harness). These functions are the thin boundary between the two: each one
    shells out to a fablize engine and returns plain text a planner/reviewer LLM can read.
  - No crewai import here — this module is pure stdlib, testable with the rest of
    fablize/tests, and usable from any framework (crewAI today, something else tomorrow).
    The crewAI-specific glue lives in mindforge_crew.py.

Every function returns a string (LLM tool output), never raises on engine failure —
the failure text IS the signal the reviewer needs.
"""
from __future__ import annotations

import json
import os
import shlex
import tempfile
from datetime import datetime, timezone
import subprocess
import sys
from pathlib import Path

# MINDFORGE_REPO overrides the TARGET repo — where state lives and commands run (tests
# point it at a sandbox; a crew could also drive a different checkout). The fablize
# engine scripts always come from the checkout this file lives in.
HERE = Path(__file__).resolve().parent.parent
REPO = Path(os.environ.get("MINDFORGE_REPO") or HERE)
SCRIPTS = HERE / "fablize" / "scripts"
LOGS = REPO / ".fablize" / "orchestrator"


def _run_rc(args, timeout=None, cwd=None):
    """Run a command; return (rc, combined output). rc is None on timeout — callers that
    branch on failure (merge_story) need the real code, not a text marker to grep for."""
    try:
        r = subprocess.run(args, cwd=str(cwd or REPO), capture_output=True,
                           text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, f"[timeout after {timeout}s] {' '.join(map(str, args))}"
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        out += f"\n[exit code {r.returncode}]"
    return r.returncode, out.strip()


def _run(args, timeout=None, cwd=None):
    """Run a command; return combined output + a clear rc marker on failure."""
    return _run_rc(args, timeout=timeout, cwd=cwd)[1]


def _engine(script, *args, timeout=120):
    return _run([sys.executable, str(SCRIPTS / script), *args], timeout=timeout)


# --- plan (goals.py owns the ledger; crewAI never edits .fablize directly) ----

def goals_create(brief, stories, force=False):
    """stories: list of 'title::objective' strings. Objectives should name the exact
    files each story may touch — disjoint file scopes are what make parallel worktree
    agents merge cleanly (lesson recorded in the brain on 2026-07-02)."""
    args = ["create", "--brief", brief] + (["--force"] if force else [])
    for s in stories:
        args += ["--goal", s]
    return _engine("goals.py", *args)


def goals_add(stories):
    args = ["add"]
    for s in stories:
        args += ["--goal", s]
    return _engine("goals.py", *args)


def goals_status():
    return _engine("goals.py", "status")


def goals_next():
    return _engine("goals.py", "next")


def goals_checkpoint(story_id, status, evidence, verify_cmd="", verify_evidence=""):
    args = ["checkpoint", "--id", story_id, "--status", status, "--evidence", evidence]
    if verify_cmd:
        args += ["--verify-cmd", verify_cmd, "--verify-evidence", verify_evidence]
    return _engine("goals.py", *args)


# --- execute (orchestrate.py fans out to worktree Claude agents) --------------

def run_story(story_id, timeout=1800, claude_cmd="claude"):
    """Run ONE story's headless agent in its worktree. Blocks until the agent exits
    (a real coding session takes minutes — size the timeout generously)."""
    return _engine("orchestrate.py", "run", "--ids", story_id, "--parallel", "1",
                   "--claude-cmd", claude_cmd, timeout=timeout)


# --- review (evidence for the reviewer: what changed + what the agent said) ---

def review_story(story_id, log_lines=40):
    """Branch diff stat + commit subjects + agent log tail for fablize/<id> —
    everything a reviewer needs to decide complete vs failed."""
    branch = f"fablize/{story_id}"
    parts = [f"=== git diff --stat (this branch vs merge base) for {branch}:"]
    base = _run(["git", "merge-base", "HEAD", branch])
    if "[exit code" in base:
        parts.append(f"(no branch {branch}: {base})")
    else:
        parts.append(_run(["git", "diff", "--stat", base.strip(), branch]))
        parts.append(f"=== commits on {branch}:")
        parts.append(_run(["git", "log", "--oneline", f"{base.strip()}..{branch}"]))
    logf = LOGS / f"{story_id}.log"
    parts.append(f"=== agent log tail ({logf.name}):")
    try:
        parts.append("\n".join(
            logf.read_text(encoding="utf-8", errors="replace").splitlines()[-log_lines:]))
    except OSError:
        parts.append("(no agent log found)")
    return "\n".join(parts)


def merge_story(story_id):
    """Merge a REVIEWED story branch and clean up its worktree. Only call after the
    reviewer decided 'complete' — this is the one state-changing git action here.
    On a merge failure the merge is ABORTED and the branch/worktree left intact —
    destroying the only copy of the work over a conflict would be unrecoverable."""
    branch = f"fablize/{story_id}"
    rc, merge_out = _run_rc(["git", "merge", "--no-edit", branch])
    if rc != 0:  # conflict or any other failure (rc None = timeout counts too)
        _run(["git", "merge", "--abort"])
        return (f"MERGE CONFLICT: merging {branch} failed; the merge was aborted and the "
                f"branch + worktree were left intact. Resolve manually, then re-merge.\n{merge_out}")
    out = [merge_out]
    out.append(_run(["git", "worktree", "remove", "--force",
                     str(REPO / ".fablize" / "worktrees" / story_id)]))
    out.append(_run(["git", "branch", "-d", branch]))
    return "\n".join(out)


def run_verification(cmd="python3 -m pytest fablize/tests/ -q", timeout=600):
    """The gate command — run the project's test suite in the MAIN checkout.
    cmd is shell-quoted text (shlex), so quoted args survive: `python3 -c "print(1)"`."""
    return _run(shlex.split(cmd), timeout=timeout)


def _atomic_write(path, text):
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


def write_receipt(story_id, *, verdict, evidence, verify_cmd="", verify_evidence="", mode="manual"):
    """The artifact a human points to as proof a merge wasn't just an agent's claim: the
    diff/log evidence, the exact gate command and its result, and the reviewer's verdict.
    Written once per merged story to .fablize/receipts/<id>.{json,md}. Returns the .md path."""
    d = REPO / ".fablize" / "receipts"
    ts = datetime.now(timezone.utc).isoformat()
    rec = {"id": story_id, "merged_at": ts, "mode": mode, "verdict": verdict.strip(),
           "verify_cmd": verify_cmd, "verify_evidence": verify_evidence, "evidence": evidence}
    _atomic_write(d / f"{story_id}.json", json.dumps(rec, ensure_ascii=False, indent=1))
    md = (f"# Receipt — {story_id}\n\n- Merged: {ts}\n- Mode: {mode}\n\n"
          f"## Verdict\n{verdict.strip()}\n\n"
          f"## Verify gate\n`{verify_cmd or '(none — review-only)'}`\n{verify_evidence}\n\n"
          f"## Evidence\n```\n{evidence}\n```\n")
    out = d / f"{story_id}.md"
    _atomic_write(out, md)
    return str(out)


# --- memory (the brain compounds across crews too) -----------------------------

def brain_recall(query):
    return _engine("brain.py", "recall", "--query", query)


def brain_reflect(trace, lesson="", worked="", failed=""):
    args = ["reflect", "--trace", trace]
    if lesson:
        args += ["--lesson", lesson]
    if worked:
        args += ["--worked", worked]
    if failed:
        args += ["--failed", failed]
    return _engine("brain.py", *args)
