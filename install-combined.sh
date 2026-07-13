#!/usr/bin/env bash
# Combined installer: MindForge = codebase-memory-mcp (Memory) + fablize (Procedure + Brain).
# One command sets up the core stack. Optional layers (Economy / Orchestration / GUI) are opt-in.
#
# Usage: bash install-combined.sh [flags] [target-project-dir]
#   default target : current directory
#   default install: core layers only (Memory + Procedure + Brain)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN="${MINDFORGE_BIN:-$ROOT/build/c/codebase-memory-mcp}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

WITH_ECONOMY=0
WITH_CREW=0
WITH_UI=0
AUTO_INDEX=1
AUTO_INDEX_LIMIT=50000
REFRESH_AGENTS=0
CHECK_ONLY=0
TARGET=""

usage() {
  cat <<'EOF'
MindForge combined installer

Usage: bash install-combined.sh [flags] [target-project-dir]

Core layers (always installed):
  Memory      build + register the codebase-memory-mcp C engine as an MCP server
  Procedure   apply the fablize disciplines to the target project
  Brain       cross-session memory (installed together with fablize)

Optional layers (opt-in):
  --with-economy   token-economy layer   -> imba/setup.sh (autoclaude hooks + Hermes economizer)
  --with-crew      CrewAI orchestration   -> crew/.venv + pip install -r crew/requirements.txt
  --with-ui        Electron desktop GUI   -> cd mindforge-ui && npm install
  --all            install all optional layers above
  --no-auto-index  do not enable automatic first-session indexing
  --auto-index-limit N
                   skip automatic indexing above N tracked files (default: 50000)
  --refresh-agents re-run agent discovery even when Codex is already configured
  --check           verify an existing installation without changing it
  -h, --help       show this help and exit

Args:
  target-project-dir   where to apply the fablize disciplines (default: current directory)

The default is persistent and idempotent: Codex starts the MCP server for every
session, the graph watcher follows indexed projects, and Brain state stays in the project.
EOF
}

while [ "$#" -gt 0 ]; do
  arg="$1"
  case "$arg" in
    --with-economy) WITH_ECONOMY=1 ;;
    --with-crew)    WITH_CREW=1 ;;
    --with-ui)      WITH_UI=1 ;;
    --all)          WITH_ECONOMY=1; WITH_CREW=1; WITH_UI=1 ;;
    --no-auto-index) AUTO_INDEX=0 ;;
    --auto-index-limit)
      shift
      [ "$#" -gt 0 ] || { echo "! --auto-index-limit requires a value" >&2; exit 2; }
      AUTO_INDEX_LIMIT="$1"
      case "$AUTO_INDEX_LIMIT" in *[!0-9]*|'') echo "! auto-index limit must be a positive integer" >&2; exit 2 ;; esac
      [ "$AUTO_INDEX_LIMIT" -gt 0 ] || { echo "! auto-index limit must be greater than zero" >&2; exit 2; }
      ;;
    --refresh-agents) REFRESH_AGENTS=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help)      usage; exit 0 ;;
    -*)             echo "! unknown flag: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
    *)              TARGET="$arg" ;;
  esac
  shift
done
TARGET="${TARGET:-$PWD}"

if [ "$CHECK_ONLY" = "1" ]; then
  exec env MINDFORGE_BIN="$BIN" CODEX_HOME="$CODEX_HOME" \
    bash "$ROOT/scripts/mindforge-doctor.sh" "$TARGET"
fi

[ -d "$TARGET" ] || { echo "! target project does not exist: $TARGET" >&2; exit 2; }

echo "=== MindForge — combined install ==="

# --- Core layers -------------------------------------------------------------

# 1. Memory layer: GUI installs need the embedded graph variant; rebuild it even
# when a standard binary already exists, otherwise the 3D-graph action can only 404.
if [ "$WITH_UI" = "1" ]; then
  echo "[core 1/4] Building the memory engine with embedded 3D UI..."
  "$ROOT/scripts/build.sh" --with-ui
elif [ ! -x "$BIN" ]; then
  echo "[core 1/4] Building the memory engine (codebase-memory-mcp)..."
  "$ROOT/scripts/build.sh"
else
  echo "[core 1/4] Memory engine already built: $BIN"
fi

# 2. Memory layer: register the MCP server + agent instruction files. Avoid a
# redundant installer pass because development builds may legitimately migrate
# derived graph databases when their schema changes.
echo "[core 2/4] Registering the MCP server with your agents..."
CODEX_CONFIG="$CODEX_HOME/config.toml"
CODEX_AGENTS="$CODEX_HOME/AGENTS.md"
if [ "$REFRESH_AGENTS" = "0" ] && [ -f "$CODEX_CONFIG" ] && [ -f "$CODEX_AGENTS" ] \
   && grep -qF '[mcp_servers.codebase-memory-mcp]' "$CODEX_CONFIG" \
   && grep -qF 'codebase-memory-mcp SessionStart' "$CODEX_CONFIG" \
   && grep -qF '<!-- codebase-memory-mcp:start -->' "$CODEX_AGENTS"; then
  echo "  = Codex registration already healthy; preserving existing graph databases"
else
  "$BIN" install -y
fi

# Auto-index is what makes a newly opened repository useful without a manual
# setup step. Existing repositories are attached to the background watcher.
if [ "$AUTO_INDEX" = "1" ]; then
  "$BIN" config set auto_index true
  "$BIN" config set auto_index_limit "$AUTO_INDEX_LIMIT"
  echo "  ✓ auto-index enabled (tracked-file limit: $AUTO_INDEX_LIMIT)"
else
  echo "  = auto-index left unchanged"
fi

# Install the workflow globally as well as in the target repository. The global
# copy makes the behavior available immediately in arbitrary local/remote repos;
# the repository copy keeps Codex Cloud runs self-contained after checkout.
echo "[core 3/4] Installing the global Codex workflow..."
GLOBAL_SKILL="$CODEX_HOME/skills/mindforge-workflow"
mkdir -p "$GLOBAL_SKILL"
cp -R "$ROOT/fablize/skills/mindforge-workflow/." "$GLOBAL_SKILL/"
echo "  ✓ $GLOBAL_SKILL"

# 3. Procedure + Brain layer: apply the fablize disciplines to the target project.
echo "[core 4/4] Applying the fablize procedure + brain layer..."
bash "$ROOT/fablize/install.sh" "$TARGET"

# --- Optional layers ---------------------------------------------------------
ECONOMY_STATUS="skipped (enable with --with-economy)"
CREW_STATUS="skipped (enable with --with-crew)"
UI_STATUS="skipped (enable with --with-ui)"

if [ "$WITH_ECONOMY" = "1" ]; then
  echo "[opt] Economy: installing the imba token-economy layer..."
  bash "$ROOT/imba/setup.sh"
  ECONOMY_STATUS="installed (imba/setup.sh)"
fi

if [ "$WITH_CREW" = "1" ]; then
  echo "[opt] Orchestration: setting up the CrewAI virtualenv (crew/.venv)..."
  if command -v python3 >/dev/null 2>&1; then
    [ -d "$ROOT/crew/.venv" ] || python3 -m venv "$ROOT/crew/.venv"
    "$ROOT/crew/.venv/bin/pip" install -r "$ROOT/crew/requirements.txt"
    CREW_STATUS="installed (crew/.venv)"
  else
    echo "  ! python3 not found — cannot create crew/.venv. Install Python 3, then re-run with --with-crew." >&2
    CREW_STATUS="FAILED (python3 missing)"
  fi
fi

if [ "$WITH_UI" = "1" ]; then
  echo "[opt] GUI: installing mindforge-ui npm dependencies..."
  if command -v npm >/dev/null 2>&1; then
    ( cd "$ROOT/mindforge-ui" && npm install )
    UI_STATUS="installed (mindforge-ui/node_modules)"
  else
    echo "  ! npm not found — install Node.js (https://nodejs.org), then re-run with --with-ui." >&2
    UI_STATUS="FAILED (npm missing)"
  fi
fi

echo "[verify] Checking the persistent Codex installation..."
env MINDFORGE_BIN="$BIN" CODEX_HOME="$CODEX_HOME" \
  bash "$ROOT/scripts/mindforge-doctor.sh" "$TARGET"

echo
echo "=== Done. MindForge install summary ==="
echo "  Memory        : codebase-memory-mcp MCP tools (search_graph, trace_path, get_architecture, …)"
echo "  Procedure     : fablize disciplines in $TARGET (see INTEGRATION.md)"
echo "  Brain         : cross-session memory (fablize/scripts/brain.py)"
echo "  Economy       : $ECONOMY_STATUS"
echo "  Orchestration : $CREW_STATUS"
echo "  GUI           : $UI_STATUS"
echo "  Health check  : bash install-combined.sh --check '$TARGET'"
echo "  Another repo  : bash install-combined.sh /path/to/repository"
echo "  Restart Codex once after the first global installation."
