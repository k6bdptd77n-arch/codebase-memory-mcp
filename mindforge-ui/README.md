# MindForge — quiet background assistant for the MindForge stack

An Electron desktop app that keeps project memory and indexing available in the
background, with a compact editor-style surface for goals, agents, review, brain and
telemetry. **It never writes
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

The interface follows familiar editor patterns without copying Cursor branding or
assets: a 48 px activity rail, a shallow project/context sidebar, one workbench, a
command centre (`Cmd/Ctrl+K`) and a compact status bar. Board presents one primary
next step; logs, completed work and planner thinking stay collapsed until requested.

**Trust mode** (header): MANUAL merges only after your Approve click; REVIEW always
runs the model reviewer but keeps merge manual; AUTO reviews and merges a COMPLETE
verdict automatically. Every path uses the same verification gate — tests must pass
in the main checkout before merge.

The sidebar and status bar are live: MEMORY (knowledge-graph size from the C engine),
PROCEDURE (plan progress), BRAIN (fact count). Any change under `.fablize/` refreshes the UI
via `fs.watch` — agents running in worktrees move the board by themselves.

Closing the window hides it; it does not stop the app. Use the tray/menu-bar item to
open, hide or explicitly quit MindForge. Memory/indexing continue while hidden.
System notifications are intentionally disabled: status is visible only in the app
and tray menu. Background work observes/indexes/prepares context; agents and code
changes still start only from an explicit user action.

## Run

```bash
cd mindforge-ui
npm ci                 # electron, node-pty, xterm + native rebuild
npm test               # project boundaries, provider HTTP, atomic files, graph lifecycle
npm run check          # syntax validation for every process/view module
npm run test:e2e       # real Electron: hide/restore + plan/approve/reject/merge receipt
npm start
npm run shot           # all tabs, palette and compact layouts → /tmp/mindforge_*.png
```

## Projects

The titlebar shows the current project with a dropdown: recent projects, "Открыть
папку…" (any folder becomes a project — its `.fablize/` is read live) and "Новый
проект…" (mkdir → `git init` → `bash fablize/install.sh <target>` applies the
disciplines, then the GUI switches to it). Recents/last-opened live in
`userData/mindforge.json` — a UI preference, never project state. The fablize
engines always run from THIS repo (`fablize/scripts/*.py`) with the current
project as cwd, so `./.fablize` resolves per project.

`MINDFORGE_PROJECT=/path/to/project npm start` (or `npm run shot`) presets the
project for a session — useful for testing and headless captures; it is not
persisted as the last-opened project.

Requires: `claude` CLI on PATH (subscription — no API key), `python3`, git. Fonts
(Space Grotesk, IBM Plex Mono — both OFL) are vendored in `fonts/` for offline use.
OpenAI-compatible planning/review providers are optional; requests have a 30-second
timeout and bounded responses. The 3D action reuses a healthy server or starts the
bundled `--with-ui` engine and owns its lifecycle.

Design: Cursor-style graphite is the default; optional "Flight Deck" uses deep-space
blue, instrument amber and telemetry teal. Destructive actions
(merge, stop, prune) always go through a native confirm dialog raised by the main
process, which page CSS cannot spoof.
