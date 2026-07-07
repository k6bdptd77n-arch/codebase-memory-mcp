# Closed loops (`scripts/loop.py`)

A **closed loop** is the budget-safe way to run an agent unattended: you fix the path in
advance, so the cost is bounded no matter how the model behaves.

- **fixed kickoff** — one clear task,
- **a gate every pass** — `--check` commands run on *every* iteration; nothing is "done"
  until they exit 0 (the verify-gate thesis: trust command output, not the agent's claims),
- **a hard stop** — the loop ends when the gate is green, OR it hits `--max`, OR the *same*
  failure repeats (`STUCK_AFTER` passes) and it escalates instead of grinding.

Contrast with an **open loop** (an agent free to explore with only a goal): powerful, but it
burns tokens fast and, pointed at fuzzy criteria, drifts into noise. Closed looping keeps the
freedom *inside* a frame you designed — and gets cheaper and better each run.

## What makes MindForge's loop different: it remembers

MindForge is the only loop runner with a memory. `loop.py` implements the **Guardrails
Learning Loop**: when a failure repeats, it is written to `.fablize/loops/<name>/guardrails.md`
before the next fix attempt, and that file is fed back to the agent every pass — so the loop
is told *"don't repeat this."* With `--reflect`, the distilled lesson is pushed into the brain
(`brain.py reflect`), so the next *session* starts smarter, not just the next pass. Data from
earlier passes feeds later ones — which is the whole point of closed looping.

## Run one

```bash
# preview a single gated pass (no agent, no tokens):
loop.py run --name selftest --check "python3 -m pytest fablize/tests -q" --dry-run

# a real loop: the hands (any CLI agent) fix until the gate is green or it gives up:
loop.py run --name add-ratelimit \
  --kickoff "Add rate-limiting to the login endpoint" \
  --check "pytest tests/test_login.py -q" \
  --agent "claude -p" --max 8 --reflect

loop.py catalog                 # the built-in templates
loop.py status --name <name>    # accumulated guardrails + last run
```

`--agent` is any command that takes the fix prompt as its final argument (`claude -p`,
`codex exec`, …) — the same bring-your-own-CLI seam the orchestrator uses.

## The catalog

Adapted from the public loop directories to MindForge's engines. `guardrails-learning` is the
flagship because it uses the brain; the rest are bounded gates you can start from:

| Loop | Gate (every pass) | Stops when |
|------|-------------------|------------|
| **guardrails-learning** ★ | your test + lint | green with no repeated failure |
| verify-until-green | build + test | every gate command exits 0 |
| ship-until-green | test → push → PR | PR open, CI green |
| flaky-triage | suite, re-run | every failure classified |
| audit-fix | audit + test | no high/critical advisories |
| docs-sync | docs check | affected docs updated |

## Boundary

The loop **never** claims success it did not verify — "passed" always means the gate exited 0
in this run. On `max`/`stuck` it exits non-zero and leaves the guardrails file for a human or a
stronger model. Same honesty rule as the rest of fablize.
