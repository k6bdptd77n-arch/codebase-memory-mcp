#!/usr/bin/env python3
"""fablize bundle — build a portable, tool-agnostic package of the disciplines.

Produces `dist/fablize-portable/` (and a `.zip`) containing everything needed to apply
fablize to ANY AI agent — Claude Code, Cursor, Copilot, Gemini, Aider, Codex — with no
plugin install and no dependencies. Send the zip to anyone; they unzip and run apply.sh
in their project.

What goes in the bundle:
  AGENTS.md          - the universal operating block (read by most agents)
  packs/             - the verified discipline packs (plain text)
  scripts/           - brain.py, goals.py, spec.py, metrics.py, orchestrate.py, bundle.py
                       (stdlib-only Python — build() ships every scripts/*.py)
  hooks/             - brain_reflect.py (auto-reflect Stop hook), destructive_guard.py
  apply.sh           - drops AGENTS.md + packs/ + scripts/ + hooks/ into a target project
  QUICKSTART.md      - per-tool wiring instructions

Usage:
  python3 scripts/bundle.py            # build dist/fablize-portable + .zip
  python3 scripts/bundle.py --out /tmp/x
"""
import argparse
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

APPLY_SH = """#!/usr/bin/env bash
# Apply fablize disciplines to a project (any AI agent). Usage: bash apply.sh [target-dir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$PWD}"
echo "fablize → $TARGET"
mkdir -p "$TARGET/packs" "$TARGET/scripts" "$TARGET/hooks"
cp "$HERE/packs/"*.txt "$TARGET/packs/"
cp "$HERE/scripts/"*.py "$TARGET/scripts/"
cp "$HERE/hooks/"*.py "$TARGET/hooks/" 2>/dev/null || true
# Append the operating block to the agent instruction file(s) present, else create AGENTS.md.
block="$HERE/AGENTS.md"
wrote=0
for f in AGENTS.md CLAUDE.md .cursorrules .github/copilot-instructions.md GEMINI.md; do
  path="$TARGET/$f"
  if [ -f "$path" ]; then
    if ! grep -q "fablize — operating disciplines" "$path" 2>/dev/null; then
      { printf '\\n\\n'; cat "$block"; } >> "$path"
      echo "  ✓ appended disciplines to $f"
    else
      echo "  = $f already has fablize disciplines"
    fi
    wrote=1
  fi
done
if [ "$wrote" -eq 0 ]; then
  cp "$block" "$TARGET/AGENTS.md"
  echo "  ✓ created AGENTS.md"
fi
echo "Done. Your agent now has the fablize disciplines. See QUICKSTART.md for per-tool notes."
"""

QUICKSTART = """# fablize portable — quickstart

These are the fablize operating disciplines packaged for **any** AI coding agent.
No plugin, no install, no dependencies (the scripts are pure-Python stdlib).

## Apply to a project

```bash
bash apply.sh /path/to/your/project    # or just `bash apply.sh` inside the project
```

This copies `packs/` + `scripts/` into the project and adds the operating block to
whichever instruction file your agent reads.

## How each tool picks it up

| Agent            | Reads                              |
|------------------|------------------------------------|
| Claude Code      | `CLAUDE.md` / `AGENTS.md`          |
| Cursor           | `.cursorrules` / `AGENTS.md`       |
| GitHub Copilot   | `.github/copilot-instructions.md`  |
| Gemini CLI       | `GEMINI.md` / `AGENTS.md`          |
| Aider / Codex /  | `AGENTS.md`                        |
| others           |                                    |

`apply.sh` appends to any of these that already exist, otherwise it creates `AGENTS.md`
(the emerging cross-tool standard).

## Use it

The agent now follows the disciplines automatically by task type. You can also drive the
engines yourself from a shell:

```bash
python3 scripts/spec.py lock --req "..." --decision "q::a"   # lock a clarified spec
python3 scripts/goals.py create --brief "..." --goal "a::x" --goal "verify::y"
python3 scripts/goals.py next
python3 scripts/orchestrate.py run                           # fan stories out to worktree agents
python3 scripts/metrics.py                                   # observability summary
```

MIT licensed. Source: https://github.com/fivetaku/fablize
"""


def build(out_dir):
    pkg = out_dir / "fablize-portable"
    if pkg.exists():
        shutil.rmtree(pkg)
    (pkg / "packs").mkdir(parents=True)
    (pkg / "scripts").mkdir(parents=True)
    (pkg / "hooks").mkdir(parents=True)

    # AGENTS.md / README.md may legitimately be absent in a slimmed checkout — guard rather than crash.
    for top in ("AGENTS.md", "README.md"):
        src = ROOT / top
        if src.exists():
            shutil.copy2(src, pkg / top)
    for f in (ROOT / "packs").glob("*.txt"):
        shutil.copy2(f, pkg / "packs" / f.name)
    # Ship the WHOLE procedure layer including the third (brain) layer — copy every engine present.
    for f in (ROOT / "scripts").glob("*.py"):
        shutil.copy2(f, pkg / "scripts" / f.name)
    # The hooks make growth/safety structural (auto-reflect Stop hook, destructive guard).
    for f in (ROOT / "hooks").glob("*.py"):
        shutil.copy2(f, pkg / "hooks" / f.name)
    (pkg / "apply.sh").write_text(APPLY_SH, encoding="utf-8")
    (pkg / "apply.sh").chmod(0o755)
    (pkg / "QUICKSTART.md").write_text(QUICKSTART, encoding="utf-8")

    zip_path = out_dir / "fablize-portable.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in pkg.rglob("*"):
            z.write(p, p.relative_to(out_dir))
    return pkg, zip_path


def main():
    ap = argparse.ArgumentParser(prog="bundle.py")
    ap.add_argument("--out", default=str(ROOT / "dist"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    pkg, zip_path = build(out)
    n_files = sum(1 for _ in pkg.rglob("*") if _.is_file())
    print(f"fablize: portable bundle built — {n_files} files")
    print(f"  dir: {pkg}")
    print(f"  zip: {zip_path}  (send this to anyone)")
    print("  apply:  unzip → bash apply.sh /path/to/project")


if __name__ == "__main__":
    main()
