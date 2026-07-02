# How the three layers compose (MindForge)

This project is one product made of three complementary layers:

| Layer | Folder | Answers | Form |
|-------|--------|---------|------|
| **Memory** | `src/`, `internal/`, … (the C core) | *What is the code?* — definitions, callers, data flow, architecture | MCP server, 14 tools, SQLite graph |
| **Procedure** | `fablize/` | *How do I work on it?* — clarify, complete, investigate, verify, escalate | stdlib Python + plain-text packs |
| **Brain** | `fablize/scripts/brain.py` + `.fablize/brain/`, `~/.fablize/brain/` | *What do I already know — across sessions?* — user, preferences, project goals, lessons | stdlib Python + Markdown facts |

The memory layer gives the agent a **map**; the procedure layer gives it a **method**; the brain
layer gives it a **history**. A map without a method wanders, a method without a map crawls file by
file, and both without a history re-derive the same context every session. See `fablize/MINDFORGE.md`
for the unified operating loop.

## Where the procedure calls the memory

The fablize disciplines invoke the MCP tools at the exact points they help most:

| Discipline (`fablize/packs/…`) | Calls these memory tools | Why |
|---|---|---|
| **orient-pack** | `index_repository`, `get_architecture`, `search_graph`, `get_code_snippet`, `trace_path` | Build the map before editing — know the seams and the blast radius. |
| **clarify-pack** (step 0) | `get_architecture`, `search_graph`, `search_code` | Answer unknowns from the code before asking the user — cheaper than a question. |
| **investigation-protocol** (steps 3–4) | `search_graph`, `trace_path` (data_flow), `get_code_snippet`, `query_graph`, `ingest_traces` | `trace_path` *is* the causal chain; `query_graph` exposes hot-path signals. |
| **verification-grounding** | `detect_changes`, `trace_path` (inbound) | Confirm the structural effect of a change and catch a forgotten caller. |
| **spec-lock decisions** (`spec.py`) | `manage_adr` (optional) | A locked architectural decision can be recorded as an ADR in the graph. |
| **brain-pack** (`brain.py relate`) | `manage_adr` | A durable structural relation between project entities is pushed INTO the graph, not a flat file — queryable later by `trace_path` / `query_graph`. |

The brain layer follows the same hybrid split: prose facts (preferences, goals, lessons) live as
portable Markdown the brain owns; structural project *relations* are emitted as the `manage_adr`
call the agent runs, so they land in the graph where the memory layer can query them.

All of this is **prompt-level wiring** — plain text and tool calls. No C was modified; the C
core stays byte-for-byte upstream, so `git pull upstream` merges cleanly. The procedure layer
also degrades gracefully: if the memory tools are absent, every discipline still applies by
reading files directly.

## Running under orchestrators (Auto-Claude, orchestrate.py)

Orchestrators like [Auto-Claude](https://github.com/AndyMik90/Auto-Claude) run many headless
Claude Code agents in parallel, each in a **linked git worktree**. MindForge composes with them
at the boundary — no code is vendored (Auto-Claude is AGPL-3.0; this repo stays MIT):

- **State is per-project, not per-checkout.** `spec.py` / `goals.py` / `brain.py` (and the
  `brain_reflect` hook) resolve a linked worktree to the **main checkout's** `.fablize/`, so
  every parallel agent reads the same locked spec, shares one brain, and its auto-reflected
  traces land in one place. Set `FABLIZE_STATE=<dir>` to isolate an agent's state explicitly.
- **Register the MCP server user-scope** (not project-scope) when working under an
  orchestrator, so each spawned worktree session sees the graph tools without per-worktree
  setup — and index once from the main checkout to avoid N duplicate graphs.
- **The disciplines travel automatically.** Anything installed into `~/.claude/CLAUDE.md` and
  `~/.claude/hooks/` (the `imba/autoclaude` layer) applies inside every agent an orchestrator
  spawns — that *is* the integration.

For the same isolation without an external product, `fablize/scripts/orchestrate.py` fans the
pending `goals.py` stories out to parallel headless agents (`claude -p`), one worktree and one
branch (`fablize/<id>`) per story:

```bash
python3 fablize/scripts/orchestrate.py plan              # what would run (always safe)
python3 fablize/scripts/orchestrate.py run --parallel 3  # add --dry-run to preview commands
python3 fablize/scripts/orchestrate.py clean             # cleanup commands after merging
```

Honest boundary: the orchestrator never checkpoints a story itself — it runs agents, collects
logs (`.fablize/orchestrator/<id>.log`), and prints the exact `goals.py checkpoint` / `git merge`
commands, so completion still requires verified evidence.

Permissions (the golden middle): headless `acceptEdits` lets an agent edit files but not run
anything, so it cannot verify its own work. The orchestrator therefore seeds each worktree with
`.claude/settings.local.json` containing a narrow allowlist — run tests (`python3`, `pytest`,
`npm test`, …) and commit locally (`git add/commit`) — but no network tools, no push, no
`bypassPermissions`. Existing settings in a worktree are never overwritten.

## Design boundary (deliberate)

fablize is **not** reimplemented as MCP tools inside the C server. Its engines stay as
dependency-free Python the agent drives from a shell — the same shell every agent that
codebase-memory-mcp configures already has. This keeps the procedure layer portable, testable
in isolation (`fablize/tests/`), and independent of the C build.

See `fablize/AGENTS.md` for the operating block and `fablize/README.md` for the layer's contents.
