#!/usr/bin/env bash
# Combined installer: MindForge = codebase-memory-mcp (Memory) + fablize (Procedure + Brain).
# One command sets up the core stack. Optional layers (Economy / Orchestration / GUI) are opt-in.
#
# Usage: bash install-combined.sh [--with-economy] [--with-crew] [--with-ui] [--all] [target-project-dir]
#   default target : current directory
#   default install: core layers only (Memory + Procedure + Brain)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN="$ROOT/build/c/codebase-memory-mcp"

WITH_ECONOMY=0
WITH_CREW=0
WITH_UI=0
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
  -h, --help       show this help and exit

Args:
  target-project-dir   where to apply the fablize disciplines (default: current directory)

Each step is idempotent (safe to re-run). A summary of what was installed is printed at the end.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --with-economy) WITH_ECONOMY=1 ;;
    --with-crew)    WITH_CREW=1 ;;
    --with-ui)      WITH_UI=1 ;;
    --all)          WITH_ECONOMY=1; WITH_CREW=1; WITH_UI=1 ;;
    -h|--help)      usage; exit 0 ;;
    -*)             echo "! unknown flag: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
    *)              TARGET="$arg" ;;
  esac
done
TARGET="${TARGET:-$PWD}"

echo "=== MindForge — combined install ==="

# --- Core layers -------------------------------------------------------------

# 1. Memory layer: GUI installs need the embedded graph variant; rebuild it even
# when a standard binary already exists, otherwise the 3D-graph action can only 404.
if [ "$WITH_UI" = "1" ]; then
  echo "[core 1/3] Building the memory engine with embedded 3D UI..."
  "$ROOT/scripts/build.sh" --with-ui
elif [ ! -x "$BIN" ]; then
  echo "[core 1/3] Building the memory engine (codebase-memory-mcp)..."
  "$ROOT/scripts/build.sh"
else
  echo "[core 1/3] Memory engine already built: $BIN"
fi

# 2. Memory layer: register the MCP server + agent instruction files.
echo "[core 2/3] Registering the MCP server with your agents..."
"$BIN" install -y || {
  echo "  ! 'install' returned non-zero — configure the MCP server manually (see README)."; }

# 3. Procedure + Brain layer: apply the fablize disciplines to the target project.
echo "[core 3/3] Applying the fablize procedure + brain layer..."
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

echo
echo "=== Done. MindForge install summary ==="
echo "  Memory        : codebase-memory-mcp MCP tools (search_graph, trace_path, get_architecture, …)"
echo "  Procedure     : fablize disciplines in $TARGET (see INTEGRATION.md)"
echo "  Brain         : cross-session memory (fablize/scripts/brain.py)"
echo "  Economy       : $ECONOMY_STATUS"
echo "  Orchestration : $CREW_STATUS"
echo "  GUI           : $UI_STATUS"
echo "  Re-run 'bash fablize/install.sh <dir>' to add the disciplines to another project."
