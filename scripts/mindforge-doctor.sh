#!/usr/bin/env bash
# Verify the complete persistent Codex + MindForge wiring without changing it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${MINDFORGE_BIN:-$ROOT/build/c/codebase-memory-mcp}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
TARGET="${1:-$PWD}"
FAILURES=0

pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }
has() { [ -f "$1" ] && grep -qF "$2" "$1" 2>/dev/null; }

echo "MindForge doctor"
echo "  project: $TARGET"

if [ -x "$BIN" ]; then pass "memory engine is executable"; else fail "memory engine missing: $BIN"; fi

CONFIG="$CODEX_HOME/config.toml"
AGENTS="$CODEX_HOME/AGENTS.md"
if has "$CONFIG" '[mcp_servers.codebase-memory-mcp]'; then pass "Codex MCP registration"; else fail "Codex MCP registration missing in $CONFIG"; fi
if has "$CONFIG" 'codebase-memory-mcp SessionStart'; then pass "Codex SessionStart reminder"; else fail "Codex SessionStart reminder missing"; fi
if has "$AGENTS" '<!-- codebase-memory-mcp:start -->'; then pass "global graph-first instructions"; else fail "global graph-first instructions missing in $AGENTS"; fi

GLOBAL_SKILL="$CODEX_HOME/skills/mindforge-workflow/SKILL.md"
if [ -f "$GLOBAL_SKILL" ]; then pass "global MindForge workflow skill"; else fail "global workflow skill missing: $GLOBAL_SKILL"; fi

if [ -x "$BIN" ]; then
  AUTO_INDEX="$("$BIN" config get auto_index 2>/dev/null | tr -d '[:space:]')"
  if [ "$AUTO_INDEX" = "true" ]; then pass "automatic repository indexing"; else fail "auto_index is not enabled"; fi
  AUTO_INDEX_LIMIT="$("$BIN" config get auto_index_limit 2>/dev/null | tr -d '[:space:]')"
  case "$AUTO_INDEX_LIMIT" in
    *[!0-9]*|'') fail "auto_index_limit is missing or invalid" ;;
    *) pass "automatic indexing safety limit: $AUTO_INDEX_LIMIT files" ;;
  esac
  if "$BIN" cli list_projects '{}' >/dev/null 2>&1; then pass "persistent graph store is readable"; else fail "graph store smoke test failed"; fi
fi

if [ -d "$TARGET" ]; then pass "target project exists"; else fail "target project missing: $TARGET"; fi
if has "$TARGET/AGENTS.md" 'fablize — operating disciplines'; then pass "project operating disciplines"; else fail "fablize block missing from project AGENTS.md"; fi
if [ -f "$TARGET/.agents/skills/mindforge-workflow/SKILL.md" ]; then pass "project-local Codex workflow skill"; else fail "project-local workflow skill missing"; fi
if [ -f "$TARGET/.fablize-disciplines/scripts/brain.py" ]; then pass "persistent Brain runtime"; else fail "Brain runtime missing"; fi
HOOKS="$TARGET/.codex/hooks.json"
if has "$HOOKS" 'UserPromptSubmit' && has "$HOOKS" 'Stop' && has "$HOOKS" 'codex_reflect.py'; then
  pass "Codex prompt/stop memory hooks"
else
  fail "Codex memory hooks missing or incomplete in $HOOKS"
fi
if has "$TARGET/.gitignore" '.fablize/'; then pass "private runtime state excluded from git"; else fail ".fablize/ is not ignored"; fi

if [ "$FAILURES" -eq 0 ]; then
  echo "Result: healthy — persistent closed loop is ready."
  exit 0
fi
echo "Result: unhealthy — $FAILURES required check(s) failed." >&2
echo "Repair: bash '$ROOT/install-combined.sh' '$TARGET'" >&2
exit 1
