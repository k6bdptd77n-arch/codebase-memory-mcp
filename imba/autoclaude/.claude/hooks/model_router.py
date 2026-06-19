#!/usr/bin/env python3
"""autoclaude model-router — a UserPromptSubmit hook for Claude Code.

Goal: token economy. Classify each *substantive* prompt as simple / medium /
complex and inject a compact recommendation (additionalContext) telling the
controller model which model + effort to spend on it.

HONEST LIMITATION (Design A): a hook CANNOT switch the main session's model or
set the reasoning effort. It can only *recommend*. The controller (this session)
acts on the recommendation by spawning `Agent(model=…, subagent_type=…)` for the
heavy part, or by raising effort itself (`ultrathink` / `/effort high`). Native
`ultrathink` detection works on the user's own text.

Mapping (full):
  simple  → handle inline on the current model, no subagent, no extra thinking.
  medium  → handle inline; delegate to a `sonnet` subagent only if heavy.
  complex → delegate heavy reasoning/exploration to an `opus` subagent and raise
            effort; keep the main thread lean.

Classifier is ported from `imba/hermes-economizer/router.py::classify_complexity`
(single source of truth there; the live hook in ~/.claude/hooks must be
self-contained and independent of the repo path). Keep the two in sync.

Cost: ~1 line of added context, only on substantive prompts. Zero on trivial.
Disable per-project with `.claude/autoclaude.yaml`: `model_router: false`.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# --- ported from hermes-economizer/router.py (keep in sync) ------------------
_COMPLEX_RE = re.compile(
    r"```|\b(architect|migration|benchmark|optimiz|refactor|debug|deploy|"
    r"pipeline|sql|python|typescript|design|implement|feature|build)\b",
    re.IGNORECASE,
)
_COMPLEX_RU_RE = re.compile(
    r"(архитект|миграц|оптимиз|рефактор|дебаг|деплой|пайплайн|тест|"
    r"документац|поэтапн|подробно|код|реализ|построй|спроектир)",
    re.IGNORECASE,
)


def classify_complexity(task: str) -> str:
    """simple | medium | complex."""
    task = task or ""
    n = len(task)
    multiline = task.count("\n") > 5
    technical = bool(_COMPLEX_RE.search(task) or _COMPLEX_RU_RE.search(task))
    if technical or n > 1200 or multiline:
        return "complex"
    if n <= 200 and not multiline:
        return "simple"
    return "medium"


# --- recommendation per complexity (kept to ~1 line each) --------------------
RECS = {
    "simple": (
        "[autoclaude router] complexity=simple → handle inline on the current "
        "model, no subagent, no extra thinking."
    ),
    "medium": (
        "[autoclaude router] complexity=medium → handle inline; if it needs heavy "
        "reads or multi-file work, delegate that to a `sonnet` subagent "
        "(Agent model=sonnet) to keep the main thread lean."
    ),
    "complex": (
        "[autoclaude router] complexity=complex → delegate heavy reasoning/"
        "exploration to an `opus` subagent (Agent model=opus, subagent_type="
        "Plan/Explore/general-purpose) and raise effort (ultrathink / /effort "
        "high); keep the main thread lean."
    ),
}

# Trivial prompts: skip (mirrors prompt_upgrade.py so the two stay aligned).
TRIVIAL_EXACT = {
    "hi", "hey", "hello", "yo", "ok", "okay", "k", "yes", "no", "y", "n",
    "thanks", "thank you", "ty", "go", "stop", "wait", "continue", "next",
    "привет", "ок", "окей", "да", "нет", "ага", "спасибо", "стоп", "дальше",
    "продолжай", "продолжи", "погоди", "норм", "suprt", "ладно",
}


def is_trivial(prompt: str) -> bool:
    p = prompt.strip()
    if not p:
        return True
    if p.startswith(("/", "!")):
        return True
    low = p.lower().strip(" .!?,")
    if low in TRIVIAL_EXACT:
        return True
    words = re.findall(r"\w+", p)
    if len(words) <= 2 and len(p) < 18:
        return True
    return False


def router_enabled(cwd: str) -> bool:
    path = Path(cwd) / ".claude" / "autoclaude.yaml"
    if not path.exists():
        return True
    try:
        import yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return bool(data.get("model_router", True))
    except Exception:
        return True


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    prompt = payload.get("prompt", "")
    complexity = classify_complexity(prompt)
    # A technical keyword (complex) overrides the "short → trivial" guard, so a
    # terse command like "построй дашборд" / "debug auth" still gets routed.
    if complexity != "complex" and is_trivial(prompt):
        return 0  # cheap turns stay cheap — no router noise
    if not router_enabled(payload.get("cwd", ".")):
        return 0

    rec = RECS[complexity]
    out = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": rec,
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
