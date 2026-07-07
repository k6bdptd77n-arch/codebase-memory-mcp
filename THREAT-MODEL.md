# MindForge — threat model & trust boundary

MindForge runs coding agents that write and merge code. This page states plainly what it
does with your code and secrets, and what an agent is and isn't allowed to do — because a
tool that gates merges on trust has to be trustworthy itself.

## Where your code lives

- **100% local.** The C memory engine indexes your repository on your machine and writes a
  local graph; nothing about your code is sent anywhere by MindForge. The fork layers
  (fablize, crew, GUI) are stdlib Python + local Electron — no telemetry, no upload.
- The only outbound network calls are ones **you** configure: a coding-agent CLI you run
  (e.g. `claude`) talking to its own provider on your subscription, and — only if you enable
  a provider for the planner/reviewer roles — an OpenAI-compatible endpoint you pointed at.

## Secrets

- Provider API keys entered in Settings are **encrypted at rest** with the OS keychain
  (Electron `safeStorage`): on disk `.fablize/crew.json` stores `{ "enc": "<base64>" }`, not
  the key. They are decrypted into memory only to make the request you asked for.
- `.fablize/` is gitignored, so keys never enter the repository even before encryption.
- If no OS keychain is available (some Linux setups), the app falls back to storing the key
  in plaintext **and says so** rather than silently pretending it's protected.

## What a worktree agent may do

Each headless story agent runs in its **own git worktree** on branch `fablize/<id>` — the
main checkout is never touched until you (or the gate) approve a merge. Inside the worktree it
gets a **narrow allowlist** (`.claude/settings.local.json`), not blanket permission:

- **Allowed:** run the project's tests/build (pytest, npm/pnpm/yarn, go, cargo, make, …),
  `git add` / `git commit` locally.
- **Not allowed:** `git push`, arbitrary network tools, `rm`, or bypassing permissions. The
  allowlist is additive-only via a project's `crew.json → hand.allow`; there is no wildcard.

## What gets merged

Nothing merges on an agent's say-so. A story reaches `main` only when its **verify gate** (the
story's own `Verify:` command / the project's detected test command) exits 0 in the main
checkout. A red gate never merges (enforced and tested — `fablize/tests/test_e2e_loop.py`). On
a merge conflict the merge is **aborted** and the branch preserved, never force-resolved.

## Boundaries you should know

- The C engine and its release binary are upstream and unmodified (`fablize/check-upstream-sync.sh`
  guards this); audit them at the upstream project if you wish.
- Recalled brain facts and indexed docs are treated as **data, never instructions** — they
  can't redirect an agent.
- MindForge trusts the coding-agent CLI you configure with your subscription; vet that CLI as
  you would any tool you install.
