# crew/ — crewAI orchestration layer over MindForge

**Division of labor:** crewAI agents *think* (plan stories, review evidence), headless
Claude Code agents in git worktrees *do* (write code on the subscription, inside the
permission harness), plain Python *decides* the deterministic steps (run, checkpoint,
merge). The fablize engines stay stdlib-only — this directory is the only place with
third-party dependencies, and `mindforge_tools.py` (the boundary) is still pure stdlib.

```
Planner (crewAI, cheap LLM) ──goals_create──▶ .fablize/goals.json
                                                  │
                          orchestrate.py run ◀────┘   one worktree + branch per story,
                                                      claude -p with seeded allowlist
Reviewer (crewAI, cheap LLM) ◀──review_story── diff stat + commits + agent log
        │ VERDICT: COMPLETE/FAILED
        ▼
checkpoint (verification gate) → merge → brain reflect
```

## Setup (once)

```bash
python3 -m venv crew/.venv
crew/.venv/bin/pip install -r crew/requirements.txt
export ANTHROPIC_API_KEY=...          # for the Planner/Reviewer (small prompts, cheap)
# or a free local brain: export MINDFORGE_CREW_MODEL=ollama/llama3.1
```

The coding agents themselves need no key — they run through the `claude` CLI on your
subscription, exactly like `orchestrate.py` alone.

## Use

```bash
crew/.venv/bin/python3 crew/mindforge_crew.py --check          # wiring smoke, no API calls
crew/.venv/bin/python3 crew/mindforge_crew.py plan "add X"     # Planner → story plan
crew/.venv/bin/python3 crew/mindforge_crew.py cycle            # run+review+merge all pending
crew/.venv/bin/python3 crew/mindforge_crew.py cycle --dry-run  # walk the loop, touch nothing
```

`plan` writes through `goals.py` (the ledger stays the single source of truth), `cycle`
drives `orchestrate.py` story by story; a story merges **only** when the Reviewer's
verdict is COMPLETE **and** the full test suite passes in the main checkout (the same
verification gate as manual runs). Failures land as `failed` checkpoints — `goals.py
retry` / the escalation gate handle them exactly as in a human-driven session.

## Honest boundaries

- Planner/Reviewer tokens are API-billed. Their prompts are short (a plan, a diff review) —
  pointing `MINDFORGE_CREW_MODEL` at Haiku or a local Ollama model keeps this near zero.
- crewAI never edits `.fablize/` or git state directly: every state change goes through
  the fablize engines, so the audit trail (ledger, events, metrics) stays complete.
- If you are already driving the loop interactively with Claude Code, this layer adds
  little — its value is unattended runs (cron, CI, issue-triggered builds).
