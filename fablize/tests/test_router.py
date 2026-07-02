#!/usr/bin/env python3
"""Complexity-router tests — the classifier lives in two files that MUST stay in sync
(imba/hermes-economizer/router.py is the source of truth; the Claude Code hook is a
self-contained port). Covers the real-world misroute that motivated the fix: a short
multi-part RU prompt with a URL and research verbs was classified "simple".
"""
import importlib.util
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
HERMES = REPO / "imba" / "hermes-economizer" / "router.py"
HOOK = REPO / "imba" / "autoclaude" / ".claude" / "hooks" / "model_router.py"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


hermes = load(HERMES, "hermes_router")
hook = load(HOOK, "hook_router")

# the prompt that was misrouted as "simple" in a live session (2026-07-02)
REGRESSION_PROMPT = (
    "изучи проект посмотри что это и как можно улучшить сделать умнее более "
    "коректнее и тд - так же https://github.com/B1tMaster/Auto-Claude я хочу "
    "этот проект интегрировать тоже подумай об этом"
)

BATTERY = [
    REGRESSION_PROMPT,
    "привет",
    "поправь опечатку в README",
    "study the repo structure",
    "refactor the auth module",
    "изучи https://example.com и сравни с нашим подходом",
    "rename this variable",
    "x" * 1500,
    "line\n" * 10,
    "",
]


class ClassifierTests(unittest.TestCase):
    def test_regression_prompt_is_complex(self):
        self.assertEqual(hermes.classify_complexity(REGRESSION_PROMPT), "complex")

    def test_short_chat_stays_simple(self):
        self.assertEqual(hermes.classify_complexity("привет, как дела?"), "simple")
        self.assertEqual(hermes.classify_complexity("rename this variable"), "simple")

    def test_research_verb_is_at_least_medium(self):
        self.assertIn(hermes.classify_complexity("study the repo structure"), ("medium", "complex"))
        self.assertIn(hermes.classify_complexity("изучи этот файл"), ("medium", "complex"))

    def test_url_is_at_least_medium(self):
        self.assertIn(hermes.classify_complexity("глянь https://example.com"),
                      ("medium", "complex"))

    def test_build_verbs_are_complex(self):
        for p in ("refactor the auth module", "интегрировать платежи",
                  "improve and integrate the parser", "почини сборку и задеплой"):
            self.assertEqual(hermes.classify_complexity(p), "complex", p)

    def test_long_or_multiline_is_complex(self):
        self.assertEqual(hermes.classify_complexity("x" * 1500), "complex")
        self.assertEqual(hermes.classify_complexity("do it\n" * 10), "complex")

    def test_empty_is_simple(self):
        self.assertEqual(hermes.classify_complexity(""), "simple")
        self.assertEqual(hermes.classify_complexity(None), "simple")


class SyncTests(unittest.TestCase):
    def test_hook_port_agrees_with_source_of_truth(self):
        for p in BATTERY:
            self.assertEqual(hermes.classify_complexity(p), hook.classify_complexity(p), p)

    def test_regexes_identical(self):
        for attr in ("_COMPLEX_RE", "_COMPLEX_RU_RE", "_RESEARCH_RE", "_URL_RE", "_MULTIPART_RE"):
            self.assertEqual(getattr(hermes, attr).pattern, getattr(hook, attr).pattern, attr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
