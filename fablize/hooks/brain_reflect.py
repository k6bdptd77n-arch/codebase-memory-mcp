#!/usr/bin/env python3
"""fablize brain auto-reflect — a deterministic Stop hook (the "memory grows by itself" idea).

The brain layer's reflect step lives in the operating block as text, which a model can skip —
so the persistent memory only grows when the agent remembers to grow it. This hook makes growth
a *structural guarantee*, the way Njn's brain accumulates on its own: when a session ends, it
distills the transcript into a factual episodic trace and appends it to the brain, with zero
agent effort and zero nagging.

What it records (FACTS ONLY — it never invents a "lesson"; a hook cannot reason, and a fabricated
lesson is worse than none):
  - the session goal (the first user message, truncated),
  - which tools were used and how often,
  - which files were edited/written this session.
The reusable LESSON stays the model's job via `brain.py reflect --lesson ...`; this hook only
guarantees the raw history is never lost.

Protocol: reads the Stop payload on stdin (transcript_path, session_id, cwd, stop_hook_active),
appends one JSON line to <cwd>/.fablize/traces.jsonl, exits 0. It never blocks the stop and never
errors out loud — observability must not break the session.
"""
import json
import os
import re
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


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


EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}
MAX_GOAL = 200
MAX_RESULT = 1000


def now():
    return datetime.now(timezone.utc).isoformat()


def first_text(content):
    """Extract plain text from a message 'content' that may be a string or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                return block["text"]
    return ""


def scan_transcript(path):
    goal, tools, files = "", Counter(), []
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return goal, tools, files
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):  # a bare string/number/list/null line must not crash the scan
            continue
        msg = rec.get("message", rec)
        if not isinstance(msg, dict):
            continue
        role = msg.get("role") or rec.get("type")
        content = msg.get("content")
        if role == "user" and not goal:
            text = first_text(content).strip()
            if text and not text.startswith("<"):  # skip tool_result / system-reminder noise
                goal = text[:MAX_GOAL]
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    name = block.get("name", "?")
                    tools[name] += 1
                    if name in EDIT_TOOLS:
                        fp = (block.get("input") or {}).get("file_path")
                        if fp and fp not in files:
                            files.append(fp)
    return goal, tools, files


def record_payload(payload):
    """Record one agent-neutral Stop payload. Return True when a trace was stored."""
    if not isinstance(payload, dict):
        return False
    if payload.get("stop_hook_active"):  # re-entrant stop — never loop
        return False
    transcript = payload.get("transcript_path", "")
    cwd = payload.get("cwd") or str(Path.cwd())
    goal, tools, files = scan_transcript(transcript)
    if not goal:
        goal = str(payload.get("prompt") or "").strip()[:MAX_GOAL]
    if not (goal or tools or files):
        return False  # nothing worth recording (e.g. a trivial exchange)

    rec = {
        "ts": now(),
        "auto": True,  # written by the hook, not by `brain.py reflect`
        "session": payload.get("session_id", ""),
        "goal": goal,
        "tools": dict(tools),
        "files": files,
        "lesson": "",  # deliberately empty — the model distills this, not the hook
    }
    result = str(payload.get("last_assistant_message") or "").strip()
    if result:
        rec["result"] = result[:MAX_RESULT]
    try:
        d = state_root(cwd) / ".fablize"
        d.mkdir(parents=True, exist_ok=True)
        # UPSERT one cumulative auto-trace PER SESSION. A session stops many times; appending on each
        # stop wrote N overlapping superset records and inflated the brain-growth metric. Drop any
        # prior auto-record for this session, keep everything else verbatim, then write the latest.
        sess = rec["session"]
        tf = d / "traces.jsonl"
        kept, already = [], False
        if tf.exists():
            for line in tf.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.strip():
                    continue
                try:
                    prev = json.loads(line)
                except ValueError:
                    kept.append(line); continue
                if isinstance(prev, dict) and prev.get("auto") and sess and prev.get("session") == sess:
                    already = True  # this session already has a snapshot — replace it, don't pile up
                    continue
                kept.append(line)
        kept.append(json.dumps(rec, ensure_ascii=False))
        atomic_write(tf, "\n".join(kept) + "\n")  # full rewrite — must never tear the trace file
        # Emit the global reflect event only the FIRST time a session is recorded, so metrics counts
        # one reflect per session (not one per stop).
        if not already:
            glog = Path.home() / ".fablize" / "events.jsonl"
            glog.parent.mkdir(parents=True, exist_ok=True)
            with open(glog, "a", encoding="utf-8") as f:
                f.write(json.dumps({"ts": rec["ts"], "event": "reflect", "tool": "brain",
                                    "auto": True, "cwd": cwd}, ensure_ascii=False) + "\n")
    except OSError:
        pass  # never let a write failure surface as a session error
    return True


def main():
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        sys.exit(0)
    record_payload(payload)
    sys.exit(0)


if __name__ == "__main__":
    main()
