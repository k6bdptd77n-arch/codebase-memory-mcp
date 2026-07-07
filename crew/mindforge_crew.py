#!/usr/bin/env python3
"""MindForge × crewAI — the orchestration brain over the fablize engines.

Division of labor (deliberate):
  - crewAI agents THINK: the Planner decomposes a feature into disjoint-file stories;
    the Reviewer reads a story's diff + agent log and issues a verdict. Small prompts,
    cheap model (default Haiku via LiteLLM naming; override MINDFORGE_CREW_MODEL,
    e.g. "ollama/llama3.1" for a free local planner).
  - Headless Claude Code agents in git worktrees DO: real coding on the subscription,
    inside the permission harness (orchestrate.py seeds the allowlist).
  - Plain Python DECIDES the deterministic parts: running stories, checkpoints, merges —
    an LLM adds nothing there, so no tokens are spent on it.

Usage:
  python3 crew/mindforge_crew.py --check                # wiring smoke test (no API calls)
  python3 crew/mindforge_crew.py plan  "feature ..."    # Planner → goals.py plan
  python3 crew/mindforge_crew.py cycle                  # run+review+merge every pending story
  python3 crew/mindforge_crew.py cycle --dry-run        # walk the loop without agents/merges

Requires: pip install -r crew/requirements.txt, plus ANTHROPIC_API_KEY (or an Ollama model).
The fablize side needs nothing new — mindforge_tools.py is stdlib.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mindforge_tools as mt  # noqa: E402  (stdlib boundary — safe to import always)

MODEL = os.environ.get("MINDFORGE_CREW_MODEL", "anthropic/claude-haiku-4-5-20251001")
DEFAULT_VERIFY = "python3 -m pytest fablize/tests/ -q"


def _crewai():
    """Import crewAI on demand. The import is LAZY so this module (cycle, verify_cmd, tests)
    loads cleanly without crewai installed — only the LLM-touching paths need it."""
    try:
        from crewai import Agent, Crew, Task
        from crewai.tools import tool
        return Agent, Crew, Task, tool
    except ImportError:
        sys.exit("crewai is not installed. Set it up once:\n"
                 "  python3 -m venv crew/.venv && crew/.venv/bin/pip install -r crew/requirements.txt\n"
                 "then run this script with crew/.venv/bin/python3.")


# --- tools exposed to the LLM agents (thin: they only see fablize engines) -----

def _planner_tools(tool):
    """Build the crewAI tool wrappers (needs the @tool decorator, hence built lazily)."""

    @tool("brain_recall")
    def t_brain_recall(query: str) -> str:
        """Recall prior facts, lessons, episodes and failure warnings about a topic
        from the project's persistent memory. Call before planning."""
        return mt.brain_recall(query)

    @tool("goals_create")
    def t_goals_create(brief: str, stories_json: str) -> str:
        """Create the story plan. stories_json is a JSON array of 'title::objective'
        strings. Each objective MUST name the exact files the story may touch, and the
        file sets of different stories MUST be disjoint (that is what makes parallel
        worktree agents merge cleanly)."""
        try:
            stories = json.loads(stories_json)
            assert isinstance(stories, list) and all(isinstance(s, str) for s in stories)
        except (ValueError, AssertionError):
            return "stories_json must be a JSON array of 'title::objective' strings."
        return mt.goals_create(brief, stories, force=True)

    @tool("goals_status")
    def t_goals_status() -> str:
        """Show the current plan and each story's status."""
        return mt.goals_status()

    return [t_brain_recall, t_goals_create, t_goals_status]


def planner_agent():
    Agent, _, _, tool = _crewai()
    return Agent(
        role="Build planner",
        goal="Decompose a feature into the smallest set of sequential-safe stories with "
             "strictly disjoint file scopes, informed by the project's memory.",
        backstory="You plan work for parallel headless coding agents that each own one "
                  "git worktree. Overlapping file scopes cause merge conflicts; vague "
                  "objectives cause scope creep. You write objectives that name exact "
                  "files and end with the verification command.",
        tools=_planner_tools(tool),
        llm=MODEL, verbose=True,
    )


def reviewer_agent():
    Agent, _, _, _ = _crewai()
    return Agent(
        role="Story reviewer",
        goal="Decide from evidence whether a story is complete or failed.",
        backstory="You review a coding agent's branch diff and log. You trust commands "
                  "and diffs, not claims. Scope violations or missing tests mean FAILED.",
        tools=[], llm=MODEL, verbose=True,
    )


def plan(feature: str) -> str:
    _, Crew, Task, _ = _crewai()
    agent = planner_agent()  # ONE instance — Task and Crew must reference the same object
    crew = Crew(agents=[agent], tasks=[Task(
        description=(
            "Plan this feature for the MindForge repo. First call brain_recall on the "
            "feature topic. Then create 1-4 stories via goals_create (JSON array of "
            f"'title::objective' strings), disjoint file scopes. Feature: {feature}"),
        expected_output="The goals_create output confirming the plan, then one line per "
                        "story explaining its file scope.",
        agent=agent,
    )])
    return str(crew.kickoff())


def review(story_id: str, evidence: str | None = None) -> str:
    _, Crew, Task, _ = _crewai()
    # evidence may be pre-fetched by the caller (cycle() reuses it for the merge receipt)
    # so the diff/log aren't computed twice for the same story.
    if evidence is None:
        evidence = mt.review_story(story_id)
    agent = reviewer_agent()  # ONE instance — Task and Crew must reference the same object
    crew = Crew(agents=[agent], tasks=[Task(
        description=(
            f"Review story {story_id}. Evidence follows. Verdict rules: commits exist, "
            "diff stays within the story's file scope, log shows tests were RUN and "
            "passed → COMPLETE; anything else → FAILED with the reason.\n\n" + evidence),
        expected_output="One line: 'VERDICT: COMPLETE — <reason>' or 'VERDICT: FAILED — <reason>'.",
        agent=agent,
    )])
    return str(crew.kickoff())


def autodetect_verify() -> str:
    """Guess a sensible gate for an ARBITRARY project from its manifest — so the crew can
    drive a repo that has no fablize/tests. Empty string means "no gate detected"."""
    root = mt.REPO
    try:
        if (root / "package.json").exists():
            pkg = json.loads((root / "package.json").read_text(encoding="utf-8"))
            if "test" in (pkg.get("scripts") or {}):
                return "npm test --silent"
    except (OSError, ValueError):
        pass
    for probe, cmd in (("pyproject.toml", "python3 -m pytest -q"), ("pytest.ini", "python3 -m pytest -q"),
                       ("go.mod", "go test ./..."), ("Cargo.toml", "cargo test"), ("Makefile", "make test")):
        if (root / probe).exists():
            return cmd
    return ""


def verify_cmd() -> str:
    """Gate command resolution, best-first: MINDFORGE_VERIFY_CMD env → a verify_cmd recorded
    on a plan story (last wins — the final story owns the gate) → this repo's own suite if it
    exists → autodetect from the project manifest → "" (review-only, no runnable gate)."""
    env = os.environ.get("MINDFORGE_VERIFY_CMD")
    if env:
        return env
    try:
        plan_ = json.loads((mt.REPO / ".fablize" / "goals.json").read_text(encoding="utf-8"))
        for g in reversed(plan_.get("goals", [])):
            if isinstance(g, dict) and g.get("verify_cmd"):
                return g["verify_cmd"]
    except (OSError, ValueError):
        pass
    if (mt.REPO / "fablize" / "tests").is_dir():
        return DEFAULT_VERIFY
    return autodetect_verify()


def over_budget() -> bool:
    """Soft budget guard for unattended runs: stop before starting a new story if
    MINDFORGE_BUDGET_USD is set and the day's spend (via imba's hermes-economizer) exceeds it.
    A no-op when the cap is unset or the economizer isn't importable — never blocks by accident."""
    cap = os.environ.get("MINDFORGE_BUDGET_USD")
    if not cap:
        return False
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "imba" / "hermes-economizer"))
        import economizer as eco  # type: ignore
        cfg = eco.load_config() if hasattr(eco, "load_config") else {}
        if isinstance(cfg, dict):
            cfg["budget_usd"] = float(cap)
        return bool(eco.over_budget(cfg))
    except Exception:
        return False


def crew_mode() -> str:
    """The trust dial: 'manual' | 'review-required' | 'auto-on-green' (default — preserves
    the crew's original always-merge-on-COMPLETE behavior). Only 'auto-on-green' lets cycle()
    merge automatically; the other two always leave a reviewed story for a human to merge —
    same distinction the GUI's mode-seg makes, read from the project's own crew.json."""
    env = os.environ.get("MINDFORGE_MODE")
    if env in ("manual", "review-required", "auto-on-green"):
        return env
    try:
        cfg = json.loads((mt.REPO / ".fablize" / "crew.json").read_text(encoding="utf-8"))
        m = cfg.get("mode")
        if m in ("manual", "review-required", "auto-on-green"):
            return m
    except (OSError, ValueError):
        pass
    return "auto-on-green"


def cycle(dry_run: bool = False) -> None:
    """run → review → checkpoint/merge for every pending story; reflect at the end."""
    status = mt.goals_status()
    print(status)
    pending = re.findall(r"(G\d+) \[pending\]", status)
    if not pending:
        print("cycle: nothing pending.")
        return
    results = []
    for sid in pending:
        if not dry_run and over_budget():
            print(f"cycle: budget cap (MINDFORGE_BUDGET_USD) reached — stopping before {sid}.")
            break
        print(f"\n--- {sid}: running worktree agent…")
        if dry_run:
            print(f"[dry-run] would run_story({sid}), review, checkpoint, merge")
            continue
        print(mt.run_story(sid))
        evidence = mt.review_story(sid)          # fetched once, reused for review() and the receipt
        verdict = review(sid, evidence=evidence)
        print(verdict)
        # Guard: goals_next activates the FIRST pending/in_progress story, which is only sid
        # if the plan hasn't drifted (another driver, a stuck story). Checkpointing a story
        # the engine did not activate would corrupt the ledger — verify before acting.
        nxt = mt.goals_next()
        m = re.search(r"handoff — (G\d+)", nxt)
        active = m.group(1) if m else None
        if active != sid:
            print(f"cycle: goals_next activated {active or 'no story'}, not {sid} — "
                  f"skipping checkpoint/merge for {sid} (plan drifted; inspect with goals.py status).")
            results.append((sid, "skipped"))
            continue
        if "VERDICT: COMPLETE" in verdict:
            mode = crew_mode()
            if mode != "auto-on-green":
                # Trust dial says merge is a human's call — the story stays reviewed-but-
                # pending (branch + worktree intact) instead of merging on the crew's say-so.
                print(f"cycle: mode={mode} — {sid} passed review but merge is manual "
                      f"(open it in MindForge Control, or goals.py checkpoint + git merge by hand).")
                results.append((sid, "awaiting-manual-merge"))
                continue
            vcmd = verify_cmd()
            if vcmd:
                gate = mt.run_verification(vcmd)
                tail = gate.splitlines()[-1] if gate else ""
            else:  # no runnable gate detected → honest review-only, recorded as such
                tail = "review-only (no verify gate detected)"
            mt.goals_checkpoint(sid, "complete", verdict[:200],
                                verify_cmd=vcmd or "(review-only)", verify_evidence=tail)
            print(mt.merge_story(sid))
            mt.write_receipt(sid, verdict=verdict, evidence=evidence,
                             verify_cmd=vcmd or "(review-only)", verify_evidence=tail, mode=mode)
            results.append((sid, "merged"))
        else:
            print(mt.goals_checkpoint(sid, "failed", verdict[:200]))
            results.append((sid, "failed"))
    if not dry_run and results:
        mt.brain_reflect(
            trace="crewAI cycle: " + ", ".join(f"{s}={r}" for s, r in results),
            lesson="", worked="crew-reviewed stories merged only on evidence")


def check() -> None:
    """Wiring smoke test: construct agents + tools, no LLM calls."""
    p, r = planner_agent(), reviewer_agent()
    assert p.tools and len(p.tools) == 3, "planner tools missing"
    assert callable(mt.run_story) and callable(mt.merge_story)
    probe = mt.goals_status()
    print(f"crew wiring OK — model={MODEL}, planner tools={len(p.tools)}, "
          f"reviewer={r.role!r}, goals engine reachable={'fablize' in probe}")


def main():
    ap = argparse.ArgumentParser(prog="mindforge_crew.py")
    ap.add_argument("--check", action="store_true")
    sub = ap.add_subparsers(dest="cmd")
    pl = sub.add_parser("plan"); pl.add_argument("feature")
    cy = sub.add_parser("cycle"); cy.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.check:
        check()
    elif a.cmd == "plan":
        print(plan(a.feature))
    elif a.cmd == "cycle":
        cycle(dry_run=a.dry_run)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
