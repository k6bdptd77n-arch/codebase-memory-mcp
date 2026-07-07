#!/usr/bin/env python3
"""fablize loop — a Closed-Looping runner with an accumulating guardrails memory.

The best pattern from the loop catalogs (the "Guardrails Learning Loop"), adapted to
MindForge — because MindForge is the only loop runner with a *memory*. A generic loop
retries until it passes or gives up; this one gets SMARTER each pass: a repeated failure
is written to a guardrails file (and optionally reflected into the brain), so the next
pass is explicitly told "don't repeat this." Data from earlier passes feeds later ones.

Closed loop, by construction (this is what keeps the cost bounded):
  • fixed kickoff task + a verification gate (--check) run EVERY pass,
  • a hard stop — checks pass, OR max iterations, OR the SAME failure repeats
    (no-progress escalation, so the loop never burns budget grinding on one wall).

Usage:
  loop.py run --name <slug> --check "<cmd>" [--check "<cmd2>" ...]
              [--kickoff "<task>"] [--max 12] [--agent "<cmd>"] [--dry-run] [--reflect]
  loop.py catalog                    # list the built-in closed-loop templates
  loop.py status --name <slug>       # accumulated guardrails + last run summary

--agent is the hands: a command that receives the fix prompt (kickoff + guardrails) as
its final argument, run in the project cwd (e.g. "claude -p"). Without --agent use
--dry-run to preview a single gated pass. State: .fablize/loops/<name>/.
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# reuse the orchestrator's worktree-aware state resolution so loops share project state
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from orchestrate import state_root
except Exception:  # pragma: no cover - orchestrate is a sibling; fall back to cwd
    def state_root(base="."):
        return Path(os.environ.get("FABLIZE_STATE", base))

ROOT = state_root()
DIR = ROOT / ".fablize"
LOOPS = DIR / "loops"
LEDGER = DIR / "ledger.jsonl"
GLOBAL_LOG = Path.home() / ".fablize" / "events.jsonl"
MAX_DEFAULT = 12
STUCK_AFTER = 3  # same failure this many times → stop, escalate (no-progress guard)

# The catalog, adapted from the public loop directories to MindForge's engines. Each is a
# closed loop: a kickoff, a gate run every pass, and a concrete stop condition.
CATALOG = [
    {"name": "guardrails-learning", "flagship": True,
     "what": "Accumulates failure patterns so the loop never repeats a mistake — uses the brain.",
     "kickoff": "Read the guardrails, run the checks, and if a failure repeats, record it before fixing.",
     "check": "npm test && npm run lint", "max": 12,
     "stop": "checks pass with no repeated failure pattern"},
    {"name": "verify-until-green", "flagship": False,
     "what": "Independent verifier: trust only command output, never the implementer's claims.",
     "kickoff": "Run build, lint and tests as a skeptic. A story is done only when the gate is green here.",
     "check": "make build && make test", "max": 8, "stop": "every gate command exits 0"},
    {"name": "ship-until-green", "flagship": False,
     "what": "Implement → test locally → push → open PR → fix CI until green.",
     "kickoff": "Implement the change, verify locally, push, open the PR, and fix CI until it passes.",
     "check": "npm test", "max": 10, "stop": "PR open with all CI checks passing"},
    {"name": "flaky-triage", "flagship": False,
     "what": "Separate flaky failures from real regressions by re-running the suite.",
     "kickoff": "Run the failing suite several times; classify each failure, fix the real ones.",
     "check": "pytest -q", "max": 5, "stop": "every failure classified, real regressions fixed"},
    {"name": "audit-fix", "flagship": False,
     "what": "Close security advisories one at a time, each behind a passing test.",
     "kickoff": "Take one high/critical advisory, apply the safest fix, run the tests, repeat.",
     "check": "npm audit --audit-level=high && npm test", "max": 10,
     "stop": "no high/critical advisories remain"},
    {"name": "docs-sync", "flagship": False,
     "what": "Find and update stale docs after a code change, then verify.",
     "kickoff": "Review the diff, find docs the change made stale, update and verify them.",
     "check": "make docs-check", "max": 3, "stop": "all affected docs updated and verified"},
]


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_write(path, text):
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


def log(event, **kw):
    rec = {"ts": now(), "event": event, **kw}
    for path, extra in ((LEDGER, {}), (GLOBAL_LOG, {"tool": "loop", "cwd": str(Path.cwd())})):
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps({**rec, **extra}, ensure_ascii=False) + "\n")
        except OSError:
            pass  # observability must never crash the loop


def signature(output):
    """A stable-ish key for a failure: the first error-ish line, with volatile bits
    (numbers, paths, hex, addresses) stripped, so 'the same failure' is recognisable
    across passes even when line numbers or temp paths differ."""
    lines = [l.strip() for l in (output or "").splitlines() if l.strip()]
    pick = next((l for l in lines if re.search(r"error|fail|assert|exception|✗|✘", l, re.I)),
                lines[-1] if lines else "")
    s = re.sub(r"0x[0-9a-f]+|/[^\s:]+|\d+", "", pick.lower())
    return re.sub(r"\s+", " ", s).strip()[:200] or "unknown-failure"


def run_check(cmd, cwd, log_path, n):
    p = subprocess.run(cmd, cwd=str(cwd), shell=True, capture_output=True, text=True)
    out = (p.stdout or "") + (p.stderr or "")
    try:
        atomic_write(log_path.parent / f"iter-{n}.log", f"$ {cmd}\n{out}")
    except OSError:
        pass
    return p.returncode, out


def loop_dir(name):
    return LOOPS / name


def load_state(name):
    f = loop_dir(name) / "state.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    return {"name": name, "iterations": [], "seen": {}, "status": "new"}


def append_guardrail(name, n, sig, cmd, repeat):
    gpath = loop_dir(name) / "guardrails.md"
    prior = gpath.read_text(encoding="utf-8") if gpath.exists() else \
        f"# Guardrails — {name}\n\nFailures seen in this loop. The agent reads this every pass.\n"
    note = ("**REPEATED** — the previous fix did not work; root-cause it, do not retry the same approach."
            if repeat else "first occurrence")
    entry = f"\n## Pass {n} · `{cmd}`\n- signature: `{sig}`\n- {note}\n"
    atomic_write(gpath, prior + entry)
    return gpath


def run(args):
    name = args.name
    checks = args.check or []
    if not checks:
        sys.exit("loop: need at least one --check (the gate run every pass).")
    if not args.agent and not args.dry_run:
        sys.exit("loop: give --agent \"<cmd>\" (the hands that fix), or --dry-run to preview one pass.")
    cwd = Path.cwd()
    st = load_state(name)
    st.update({"kickoff": args.kickoff or "", "checks": checks, "max": args.max})
    log("loop_started", name=name, checks=checks, max=args.max, dry_run=bool(args.dry_run))
    print(f"loop «{name}» — closed loop, max {args.max} passes, gate: {' && '.join(checks)}")

    status = "max"
    for n in range(1, args.max + 1):
        failed = None
        for cmd in checks:
            rc, out = run_check(cmd, cwd, loop_dir(name), n)
            if rc != 0:
                failed = (cmd, out)
                break
        if failed is None:
            status = "passed"
            st["iterations"].append({"n": n, "ok": True, "ts": now()})
            log("loop_passed", name=name, passes=n)
            print(f"  pass {n}: ✓ gate green — loop complete in {n} pass(es)")
            break

        cmd, out = failed
        sig = signature(out)
        st["seen"][sig] = st["seen"].get(sig, 0) + 1
        repeat = st["seen"][sig] > 1
        append_guardrail(name, n, sig, cmd, repeat)
        st["iterations"].append({"n": n, "ok": False, "cmd": cmd, "signature": sig,
                                 "repeat": repeat, "ts": now()})
        log("loop_guardrail", name=name, iteration=n, signature=sig, repeat=repeat)
        print(f"  pass {n}: ✗ `{cmd}` — {'REPEATED failure' if repeat else 'new failure'}: {sig}")

        if st["seen"][sig] >= STUCK_AFTER:
            status = "stuck"
            log("loop_stopped", name=name, reason="stuck", signature=sig, passes=n)
            print(f"  ⚠ stuck: «{sig}» failed {st['seen'][sig]}× — stopping (needs a stronger model or a human).")
            break

        if args.dry_run:
            status = "dry-run"
            print(f"  dry-run: would now invoke the agent with the kickoff + guardrails; stopping.")
            break

        # hands: fix prompt = kickoff + accumulated guardrails, passed as the final argv arg
        guard = (loop_dir(name) / "guardrails.md").read_text(encoding="utf-8")
        prompt = (f"{args.kickoff}\n\nThe gate `{cmd}` is failing. Fix it. "
                  f"Do not repeat past mistakes — the guardrails below list what already failed:\n\n{guard}")
        try:
            subprocess.run(shlex.split(args.agent) + [prompt], cwd=str(cwd), timeout=args.timeout)
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"  agent error: {e}")

    st["status"] = status
    atomic_write(loop_dir(name) / "state.json", json.dumps(st, ensure_ascii=False, indent=2))
    if status == "passed" and args.reflect:
        _reflect(name)
    if status in ("max", "stuck"):
        print(f"  gate still red after {status}; guardrails saved to {loop_dir(name) / 'guardrails.md'}")
        return 1
    return 0


def _reflect(name):
    """Push the accumulated guardrails into the brain as a lesson, if brain.py is present."""
    brain = Path(__file__).resolve().parent / "brain.py"
    gpath = loop_dir(name) / "guardrails.md"
    if not brain.exists() or not gpath.exists():
        return
    lesson = f"loop «{name}» passed after learning: " + \
        "; ".join(re.findall(r"signature: `([^`]+)`", gpath.read_text(encoding="utf-8")))[:400]
    try:
        subprocess.run([sys.executable, str(brain), "reflect", "--trace", f"loop:{name}",
                        "--lesson", lesson], timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        pass


def catalog(_):
    print("Closed-loop templates (kickoff + gate every pass + a hard stop):\n")
    for c in CATALOG:
        star = " ★ flagship" if c.get("flagship") else ""
        print(f"  {c['name']}{star}\n    {c['what']}\n    gate:  {c['check']}  (max {c['max']} passes)\n"
              f"    stop:  {c['stop']}\n")
    print("Run one:  loop.py run --name guardrails-learning --check \"npm test\" --agent \"claude -p\"")


def status(args):
    st = load_state(args.name)
    print(f"loop «{args.name}» — status: {st.get('status', 'new')}, {len(st.get('iterations', []))} pass(es)")
    g = loop_dir(args.name) / "guardrails.md"
    if g.exists():
        print("\n" + g.read_text(encoding="utf-8"))
    else:
        print("(no guardrails yet)")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="loop.py", description="fablize closed-loop runner")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run a closed loop until the gate is green or a hard stop")
    r.add_argument("--name", required=True)
    r.add_argument("--check", action="append", help="gate command (repeatable); all must pass")
    r.add_argument("--kickoff", default="")
    r.add_argument("--agent", help="the hands, e.g. \"claude -p\" — receives the fix prompt as last arg")
    r.add_argument("--max", type=int, default=MAX_DEFAULT)
    r.add_argument("--timeout", type=int, default=1800, help="per-agent-invocation seconds")
    r.add_argument("--dry-run", action="store_true", help="one gated pass, no agent")
    r.add_argument("--reflect", action="store_true", help="on success, save the lesson to the brain")
    r.set_defaults(fn=run)
    c = sub.add_parser("catalog", help="list built-in closed-loop templates")
    c.set_defaults(fn=catalog)
    s = sub.add_parser("status", help="show accumulated guardrails and last run")
    s.add_argument("--name", required=True)
    s.set_defaults(fn=status)
    args = ap.parse_args(argv)
    rc = args.fn(args)
    return rc or 0


if __name__ == "__main__":
    sys.exit(main())
