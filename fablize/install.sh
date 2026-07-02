#!/usr/bin/env bash
# fablize install — apply the procedure layer to a project (any agent).
# Companion to the codebase-memory-mcp (memory layer) install. Additive and idempotent:
# copies packs+scripts in, appends the operating block to whatever instruction file the
# agent reads, and registers the destructive-action guard for Claude Code if present.
# Usage: bash fablize/install.sh [target-project-dir]   (default: current directory)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$PWD}"
echo "fablize (procedure layer) → $TARGET"

mkdir -p "$TARGET/.fablize-disciplines/packs" "$TARGET/.fablize-disciplines/scripts" "$TARGET/.fablize-disciplines/hooks"
cp "$HERE/packs/"*.txt   "$TARGET/.fablize-disciplines/packs/"
cp "$HERE/scripts/"*.py  "$TARGET/.fablize-disciplines/scripts/"
cp "$HERE/hooks/"*.py    "$TARGET/.fablize-disciplines/hooks/" 2>/dev/null || true
echo "  ✓ packs + scripts + hooks → .fablize-disciplines/"

# Append the operating block to any instruction file the agent already uses, else AGENTS.md.
# Rewrite the in-repo-relative command paths (scripts/ packs/ hooks/) to the installed namespace so
# the documented commands actually resolve in the target project (the repo copy keeps scripts/).
block="$HERE/AGENTS.md"
rewrite() { sed -E 's#(`| )(scripts|packs|hooks)/#\1.fablize-disciplines/\2/#g' "$1"; }
wrote=0
for f in AGENTS.md CLAUDE.md .cursorrules .github/copilot-instructions.md GEMINI.md; do
  path="$TARGET/$f"
  if [ -f "$path" ]; then
    if ! grep -q "fablize — operating disciplines" "$path" 2>/dev/null; then
      mkdir -p "$(dirname "$path")"
      { printf '\n\n'; rewrite "$block"; } >> "$path"
      echo "  ✓ appended disciplines to $f"
    else
      echo "  = $f already has fablize disciplines"
    fi
    wrote=1
  fi
done
if [ "$wrote" -eq 0 ]; then
  rewrite "$block" > "$TARGET/AGENTS.md"
  echo "  ✓ created AGENTS.md"
fi

# Register the Claude Code hooks (PreToolUse guard + Stop auto-reflect): atomic write so a crash
# can't corrupt the user's global settings, and self-healing idempotency (drop any prior entry for
# this hook — e.g. a stale path from a moved checkout — then re-add the current one).
SETTINGS="$HOME/.claude/settings.json"
DISC="$TARGET/.fablize-disciplines"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$SETTINGS" "$DISC/hooks/destructive_guard.py" "$DISC/hooks/brain_reflect.py" <<'PY' || true
import json, os, sys, tempfile
settings, guard, reflect = sys.argv[1], sys.argv[2], sys.argv[3]
if not os.path.exists(settings):
    print("  ! ~/.claude/settings.json not found — hooks copied but NOT wired (no Claude Code here?).")
    raise SystemExit(0)
try:
    data = json.load(open(settings, encoding="utf-8"))
except (OSError, ValueError):
    print("  ! ~/.claude/settings.json unreadable — hooks copied but NOT wired.")
    raise SystemExit(0)

def register(event, basename, entry):
    arr = data.setdefault("hooks", {}).setdefault(event, [])
    data["hooks"][event] = [h for h in arr if basename not in json.dumps(h)] + [entry]

register("PreToolUse", "destructive_guard.py",
         {"matcher": "Bash", "hooks": [{"type": "command", "command": f'python3 "{guard}"', "timeout": 10}]})
register("Stop", "brain_reflect.py",
         {"hooks": [{"type": "command", "command": f'python3 "{reflect}"', "timeout": 10}]})

d = os.path.dirname(settings) or "."
fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, settings)  # atomic
except OSError:
    try: os.unlink(tmp)
    except OSError: pass
    print("  ! could not write ~/.claude/settings.json — hooks copied but NOT wired."); raise SystemExit(0)
print("  ✓ Claude Code hooks registered (PreToolUse guard + Stop auto-reflect)")
PY
fi

echo "Done. The agent now has the fablize disciplines wired to the memory tools (see INTEGRATION.md)."
