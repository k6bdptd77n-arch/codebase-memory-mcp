"""Task complexity classification (ported from our Hermes economizer).

Hermes plugin hooks can't switch the model per turn, so here complexity is used
for *advisory* routing only: if a clearly simple task is running on an expensive
model, the plugin nudges (in context) toward a cheaper one. The regexes are the
EN/RU set from the original economizer.
"""
from __future__ import annotations

import re

_COMPLEX_RE = re.compile(
    r"```|\b(architect|migration|benchmark|optimiz|refactor|debug|deploy|"
    r"pipeline|sql|python|typescript|design|implement|feature|build|"
    r"integrat\w*|orchestrat\w*|automat\w*)\b",
    re.IGNORECASE,
)
_COMPLEX_RU_RE = re.compile(
    r"(архитект|миграц|оптимиз|рефактор|дебаг|деплой|пайплайн|тест|"
    r"документац|поэтапн|подробно|код|реализ|построй|спроектир|"
    r"интегрир|улучш|внедр|исправ|почин|разработ|автоматизир|переработ)",
    re.IGNORECASE,
)
# research verbs — not build-grade on their own, but never "simple" either
_RESEARCH_RE = re.compile(
    r"\b(study|explore|review|analy[sz]e|investigate|compare|explain|audit)\b"
    r"|(изуч|исследу|посмотр|разбер|сравн|объясн|проанализ|провер)",
    re.IGNORECASE,
)
_URL_RE = re.compile(r"https?://\S+")
# connectors that chain several asks into one prompt (multi-part request)
_MULTIPART_RE = re.compile(
    r"\b(and also|also|then|plus)\b|так ?же|тоже|а ещё|затем|потом|;",
    re.IGNORECASE,
)


def classify_complexity(task: str) -> str:
    """simple | medium | complex."""
    task = task or ""
    n = len(task)
    multiline = task.count("\n") > 5
    # Additive signals instead of keywords+length alone: a 190-char prompt with a URL,
    # research verbs and chained asks used to score "simple" — it is not.
    score = 0
    if _COMPLEX_RE.search(task) or _COMPLEX_RU_RE.search(task):
        score += 2  # build/change-grade work
    if n > 1200 or multiline:
        score += 2
    if _URL_RE.search(task):
        score += 1  # an external target to research
    if _RESEARCH_RE.search(task):
        score += 1
    if _MULTIPART_RE.search(task):
        score += 1
    if score >= 2:
        return "complex"
    if score == 1 or n > 200:
        return "medium"
    return "simple"
