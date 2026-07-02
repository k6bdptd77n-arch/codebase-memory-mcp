# MindForge Control — flight deck for the MindForge stack

An Electron desktop app that turns the whole system — goals plan, worktree agents,
persistent brain, telemetry — into one mission-control surface. **It never writes
state itself**: every action spawns the same fablize engines you run from a shell
(`goals.py`, `orchestrate.py`, `brain.py`, `claude -p`), so the ledger and audit
trail stay complete whether you drive from the GUI or the terminal.

| Tab | What it shows / does |
|---|---|
| **Board** | Mission lanes from `.fablize/goals.json`: run an agent per story (`orchestrate.py`), watch its log live, review the branch diff, Approve (gate → checkpoint → merge → cleanup) or Fail. Escalation banner after 2 failed attempts. |
| **Plan** | Describe a feature → a subscription `claude -p` planner (fed by `brain.py recall`) proposes 1–4 disjoint-file stories, its thinking streaming live → Accept writes the plan through `goals.py`. |
| **Brain** | Facts and lessons from both stores, recall search, episode timeline, prune of expired facts (dry-run first, native confirm before delete). |
| **Metrics** | `metrics.py --project` telemetry cards, the locked spec, latest ledger events. |
| **Terminal** | A real PTY in the repo (type `claude` to start an interactive session). |

**Autopilot** (header toggle): in MANUAL a story merges only after your Approve click;
in AUTO, when an agent exits, a `claude -p` reviewer verdicts the diff+log, and a
COMPLETE verdict with a green test suite merges itself. Both paths run the same
verification gate — the test suite must pass in the main checkout before any merge.

Header lights are live: MEMORY (knowledge-graph size from the C engine), PROCEDURE
(plan progress), BRAIN (fact count). Any change under `.fablize/` refreshes the UI
via `fs.watch` — agents running in worktrees move the board by themselves.

## Run

```bash
cd mindforge-ui
npm install            # electron, node-pty, xterm (node-pty may need @electron/rebuild)
npm start
npm run shot           # headless screenshots of every tab → /tmp/mindforge_*.png
```

Requires: `claude` CLI on PATH (subscription — no API key), `python3`, git. Fonts
(Space Grotesk, IBM Plex Mono — both OFL) are vendored in `fonts/` for offline use.

Design: "Flight Deck" — deep-space blue field, instrument amber for live/attention,
telemetry teal for verified-good, signal red for gates. Destructive actions
(merge, stop, prune) always go through a native confirm dialog raised by the main
process, which page CSS cannot spoof.
