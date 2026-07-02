#!/usr/bin/env python3
"""fablize brain test suite — stdlib unittest, no third-party deps (portable everywhere).

Runs brain.py as real subprocesses in an isolated temp HOME/CWD so the suite never touches the
developer's real ~/.fablize or repo state. Covers the invariants that ARE the brain layer:
cold-start recall, persistence + relevance ranking across sessions, the scope split
(project vs global), reflect distilling a lesson, the graph-relation emission, and prune.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAIN = str(ROOT / "scripts" / "brain.py")
METRICS = str(ROOT / "scripts" / "metrics.py")
REFLECT_HOOK = str(ROOT / "hooks" / "brain_reflect.py")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # Keep HOME (global scope) and the repo CWD (project scope) on different paths so the
        # scope split is actually exercised — they are NOT the same directory in real use.
        self.repo = Path(self.tmp) / "repo"
        self.repo.mkdir()
        self.env = dict(os.environ, HOME=self.tmp)

    def brain(self, *args):
        return subprocess.run(
            [sys.executable, BRAIN, *args],
            cwd=str(self.repo), env=self.env, capture_output=True, text=True,
        )

    def metrics(self, *args):
        return subprocess.run(
            [sys.executable, METRICS, *args],
            cwd=str(self.repo), env=self.env, capture_output=True, text=True,
        )


class BrainTests(Base):
    def test_cold_recall(self):
        r = self.brain("recall", "--query", "anything")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("cold start", r.stdout)

    def test_remember_then_recall_ranks(self):
        self.brain("remember", "--name", "oauth-choice", "--desc", "auth uses OAuth",
                   "--body", "The project standardised on OAuth for login.", "--type", "project")
        self.brain("remember", "--name", "color-pref", "--desc", "likes blue",
                   "--body", "User prefers blue accents.", "--type", "user")
        r = self.brain("recall", "--query", "oauth login auth")
        self.assertEqual(r.returncode, 0, r.stderr)
        # the relevant fact ranks above the unrelated one
        self.assertLess(r.stdout.index("oauth-choice"), r.stdout.index("color-pref")
                        if "color-pref" in r.stdout else len(r.stdout))
        self.assertIn("oauth-choice", r.stdout)

    def test_type_filter(self):
        self.brain("remember", "--name", "a-fact", "--desc", "x", "--body", "x", "--type", "project")
        self.brain("remember", "--name", "a-pref", "--desc", "x", "--body", "x", "--type", "user")
        r = self.brain("recall", "--type", "user")
        self.assertIn("a-pref", r.stdout)
        self.assertNotIn("a-fact", r.stdout)

    def test_scope_split(self):
        self.brain("remember", "--name", "g", "--desc", "global", "--body", "b",
                   "--type", "user", "--scope", "global")
        self.brain("remember", "--name", "p", "--desc", "proj", "--body", "b",
                   "--type", "project", "--scope", "project")
        # project fact lives in the repo; global fact lives under HOME — and not the reverse
        self.assertTrue((self.repo / ".fablize" / "brain" / "p.md").exists())
        self.assertTrue((Path(self.tmp) / ".fablize" / "brain" / "g.md").exists())
        self.assertFalse((self.repo / ".fablize" / "brain" / "g.md").exists())
        # recall reads BOTH stores from the repo CWD
        r = self.brain("recall", "--query", "global proj")
        self.assertIn("g", r.stdout)
        self.assertIn("p", r.stdout)

    def test_reflect_distills_lesson(self):
        r = self.brain("reflect", "--trace", "did the thing",
                       "--lesson", "always run it before claiming done", "--worked", "running it")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("lesson distilled", r.stdout)
        traces = self.repo / ".fablize" / "traces.jsonl"
        self.assertTrue(traces.exists())
        rec = json.loads(traces.read_text().splitlines()[0])
        self.assertEqual(rec["lesson"], "always run it before claiming done")
        # the lesson is now recallable
        rr = self.brain("recall", "--query", "claiming done")
        self.assertIn("lesson", rr.stdout)

    def test_relate_emits_graph_call(self):
        r = self.brain("relate", "--from", "A", "--to", "B", "--rel", "calls")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("manage_adr", r.stdout)
        self.assertIn("A calls B", r.stdout)

    def test_profile_set_and_show(self):
        self.brain("profile", "set", "--key", "prefers", "--value", "concise")
        r = self.brain("profile", "show")
        self.assertIn("prefers: concise", r.stdout)

    def test_cyrillic_names_do_not_collide(self):
        # regression: slug() used to strip all non-ASCII → every Cyrillic name became "fact" and
        # silently overwrote the previous fact. Distinct names must map to distinct files.
        self.brain("remember", "--name", "Привет", "--desc", "a", "--body", "первый", "--type", "project")
        self.brain("remember", "--name", "Пока", "--desc", "b", "--body", "второй", "--type", "project")
        files = sorted(p.name for p in (self.repo / ".fablize" / "brain").glob("*.md"))
        self.assertEqual(len(files), 2, files)
        r = self.brain("index")
        self.assertIn("привет", r.stdout)
        self.assertIn("пока", r.stdout)

    def test_bad_encoding_file_does_not_crash_recall(self):
        # regression: parse_fact read utf-8 with no error handling → one bad byte killed recall.
        self.brain("remember", "--name", "ok", "--desc", "fine", "--body", "fine fact", "--type", "project")
        bad = self.repo / ".fablize" / "brain" / "bad.md"
        bad.write_bytes(b"---\nname: bad\ndescription: \xff\xfe broken\ntype: project\n---\n\xff body")
        r = self.brain("recall", "--query", "fine")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("ok", r.stdout)

    def test_forget(self):
        self.brain("remember", "--name", "temp", "--desc", "x", "--body", "x")
        self.assertTrue((self.repo / ".fablize" / "brain" / "temp.md").exists())
        r = self.brain("forget", "--name", "temp")
        self.assertIn("forgotten", r.stdout)
        self.assertFalse((self.repo / ".fablize" / "brain" / "temp.md").exists())

    def test_global_event_log_written(self):
        self.brain("remember", "--name", "x", "--desc", "d", "--body", "b")
        log = Path(self.tmp) / ".fablize" / "events.jsonl"  # global event stream stays under HOME
        self.assertTrue(log.exists())
        lines = [json.loads(x) for x in log.read_text().splitlines() if x.strip()]
        self.assertTrue(any(e["event"] == "fact_saved" and e["tool"] == "brain" for e in lines))


class SemanticRecallTests(Base):
    def _seed(self):
        self.brain("remember", "--name", "auth", "--desc", "login uses OAuth2 authentication",
                   "--body", "Users authenticate via OAuth2 tokens.", "--type", "project")
        self.brain("remember", "--name", "db", "--desc", "Postgres database for storage",
                   "--body", "Data persisted in PostgreSQL.", "--type", "project")

    def test_tfidf_ranks_relevant_first(self):
        self._seed()
        r = self.brain("recall", "--query", "database storage")
        self.assertIn("db", r.stdout)
        # db must outrank auth (appear earlier) for a storage query
        if "auth" in r.stdout:
            self.assertLess(r.stdout.index("db"), r.stdout.index("auth"))

    def test_typo_matches_via_fuzzy(self):
        self._seed()
        r = self.brain("recall", "--query", "authentcation")  # missing 'i'
        self.assertIn("auth", r.stdout)

    def test_morphology_stemming(self):
        self.brain("remember", "--name", "ru", "--desc", "пользователь предпочитает краткость",
                   "--body", "Отвечать кратко.", "--type", "user", "--scope", "global")
        # 'краткие' shares no exact token with 'краткость'/'кратко' but stems to the same root
        r = self.brain("recall", "--query", "краткие ответы")
        self.assertIn("ru", r.stdout)

    def test_noise_floor_returns_nothing(self):
        self._seed()
        # 'signing in' has no shared stem with either fact (true synonymy needs a model we don't ship);
        # honest behaviour is to recall NOTHING rather than a misleading wrong hit.
        r = self.brain("recall", "--query", "signing in")
        self.assertIn("cold start", r.stdout)
        self.assertNotIn("Postgres", r.stdout)


class EpisodicRecallTests(Base):
    """The closed loop: episodes written by reflect / the episodic loggers are READ back at
    recall time, and ledger failures near the query surface as warnings."""

    def _episode(self, path, **rec):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def test_reflect_trace_surfaces_as_episode(self):
        self.brain("reflect", "--trace", "migrated the billing database to Postgres",
                   "--lesson", "dump before migrating")
        r = self.brain("recall", "--query", "billing database migration")
        self.assertIn("Episodes", r.stdout)
        self.assertIn("billing", r.stdout)

    def test_project_episode_log_is_read(self):
        self._episode(self.repo / "memory" / "episodes" / "2026-06.jsonl",
                      ts="2026-06-10T00:00:00+00:00",
                      goal="fix oauth token refresh bug", result="fixed by rotating refresh tokens")
        r = self.brain("recall", "--query", "oauth token refresh")
        self.assertIn("Episodes", r.stdout)
        self.assertIn("rotating refresh tokens", r.stdout)

    def test_claude_projects_episode_log_is_read(self):
        import re as _re
        # match the in-process view of cwd (macOS resolves /var → /private/var)
        slug = _re.sub(r"[^A-Za-z0-9]", "-", str(Path(self.repo).resolve()))
        self._episode(Path(self.tmp) / ".claude" / "projects" / slug / "memory" / "episodes" / "2026-06.jsonl",
                      ts="2026-06-11T00:00:00+00:00",
                      goal="deploy the metrics dashboard", result="deployed to staging")
        r = self.brain("recall", "--query", "deploy metrics dashboard")
        self.assertIn("deployed to staging", r.stdout)

    def test_unrelated_episodes_do_not_surface(self):
        self._episode(self.repo / "memory" / "episodes" / "2026-06.jsonl",
                      ts="2026-06-10T00:00:00+00:00", goal="fix oauth bug", result="done")
        r = self.brain("recall", "--query", "kubernetes ingress")
        self.assertNotIn("oauth", r.stdout)

    def test_episodes_flag_zero_disables(self):
        self._episode(self.repo / "memory" / "episodes" / "2026-06.jsonl",
                      ts="2026-06-10T00:00:00+00:00", goal="fix oauth bug", result="done")
        r = self.brain("recall", "--query", "oauth bug", "--episodes", "0")
        self.assertNotIn("Episodes", r.stdout)

    def test_ledger_failure_warns_on_related_query(self):
        led = self.repo / ".fablize" / "ledger.jsonl"
        led.parent.mkdir(parents=True, exist_ok=True)
        events = [
            {"ts": "2026-06-01T00:00:00+00:00", "event": "story_started", "id": "G007",
             "title": "webpack bundle optimization"},
            {"ts": "2026-06-02T00:00:00+00:00", "event": "checkpoint", "id": "G007",
             "status": "failed", "evidence": "tree-shaking broke lazy imports"},
            {"ts": "2026-06-02T01:00:00+00:00", "event": "checkpoint", "id": "G007",
             "status": "failed", "evidence": "still broken"},
            {"ts": "2026-06-02T02:00:00+00:00", "event": "escalation_triggered", "id": "G007"},
        ]
        led.write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
        r = self.brain("recall", "--query", "optimize webpack bundle size")
        self.assertIn("Warnings", r.stdout)
        self.assertIn("G007", r.stdout)
        self.assertIn("escalated", r.stdout)

    def test_no_warning_for_unrelated_query(self):
        led = self.repo / ".fablize" / "ledger.jsonl"
        led.parent.mkdir(parents=True, exist_ok=True)
        led.write_text(json.dumps({"ts": "2026-06-01T00:00:00+00:00", "event": "checkpoint",
                                   "id": "G001", "status": "failed", "evidence": "webpack broke"}) + "\n",
                       encoding="utf-8")
        r = self.brain("recall", "--query", "postgres schema")
        self.assertNotIn("Warnings", r.stdout)

    def test_torn_episode_lines_do_not_crash(self):
        p = self.repo / "memory" / "episodes" / "2026-06.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('{"goal": "good episode about caching", "result": "ok"}\n{torn json\n"bare"\n',
                     encoding="utf-8")
        r = self.brain("recall", "--query", "caching episode")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("caching", r.stdout)


class BrainMetricsTests(Base):
    def test_metrics_surface_brain_activity(self):
        self.brain("remember", "--name", "a", "--desc", "d", "--body", "b")
        self.brain("remember", "--name", "z", "--desc", "d", "--body", "b")
        self.brain("forget", "--name", "z")
        self.brain("recall", "--query", "d")
        self.brain("reflect", "--trace", "t", "--lesson", "L")
        self.brain("relate", "--from", "A", "--to", "B", "--rel", "calls")
        r = self.metrics("--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        b = json.loads(r.stdout)["brain"]
        # 'a' + 'z' + the distilled lesson = 3 saved; 'z' forgotten → net 2
        self.assertEqual(b["facts_saved"], 3)
        self.assertEqual(b["facts_forgotten"], 1)
        self.assertEqual(b["net_facts"], 2)
        self.assertEqual(b["recalls"], 1)
        self.assertEqual(b["reflects"], 1)
        self.assertEqual(b["relations_emitted"], 1)
        # human-readable summary names the brain layer
        h = self.metrics()
        self.assertIn("brain (3rd layer)", h.stdout)

    def test_metrics_no_brain_line_when_idle(self):
        # only a spec/goals-free, brain-free env → brain block stays zero, no brain line printed
        r = self.metrics()
        self.assertNotIn("brain (3rd layer)", r.stdout)


class AutoReflectHookTests(Base):
    def _transcript(self):
        t = self.repo / "t.jsonl"
        lines = [
            {"type": "user", "message": {"role": "user", "content": "build the auto-reflect hook"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "text", "text": "ok"},
                {"type": "tool_use", "name": "Write", "input": {"file_path": "/r/hook.py"}}]}},
            {"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "pytest"}}]}},
        ]
        t.write_text("\n".join(json.dumps(x) for x in lines), encoding="utf-8")
        return str(t)

    def hook(self, payload):
        return subprocess.run([sys.executable, REFLECT_HOOK], cwd=str(self.repo), env=self.env,
                              input=json.dumps(payload), capture_output=True, text=True)

    def test_records_factual_trace(self):
        r = self.hook({"session_id": "s1", "transcript_path": self._transcript(),
                       "cwd": str(self.repo), "stop_hook_active": False})
        self.assertEqual(r.returncode, 0, r.stderr)
        traces = self.repo / ".fablize" / "traces.jsonl"
        self.assertTrue(traces.exists())
        rec = json.loads(traces.read_text().splitlines()[-1])
        self.assertTrue(rec["auto"])
        self.assertEqual(rec["goal"], "build the auto-reflect hook")
        self.assertEqual(rec["tools"], {"Write": 1, "Bash": 1})
        self.assertIn("/r/hook.py", rec["files"])
        self.assertEqual(rec["lesson"], "")  # the hook never invents a lesson

    def test_reentrant_guard_does_not_loop(self):
        payload = {"transcript_path": self._transcript(), "cwd": str(self.repo), "stop_hook_active": True}
        self.hook(payload)
        self.assertFalse((self.repo / ".fablize" / "traces.jsonl").exists())

    def test_malformed_stdin_is_safe(self):
        r = subprocess.run([sys.executable, REFLECT_HOOK], cwd=str(self.repo), env=self.env,
                           input="not json", capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)

    def test_non_object_transcript_line_does_not_crash(self):
        # regression: a bare string/number/null JSON line in the transcript used to raise
        # AttributeError on rec.get(...), contradicting "never errors out loud".
        t = self.repo / "t.jsonl"
        t.write_text('"just a string"\n42\nnull\n'
                     + json.dumps({"type": "user", "message": {"role": "user", "content": "do X"}}) + "\n"
                     + json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
                         {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}}) + "\n",
                     encoding="utf-8")
        r = self.hook({"session_id": "s1", "transcript_path": str(t),
                       "cwd": str(self.repo), "stop_hook_active": False})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr.strip(), "")  # no traceback
        rec = json.loads((self.repo / ".fablize" / "traces.jsonl").read_text().splitlines()[-1])
        self.assertEqual(rec["goal"], "do X")

    def test_upsert_one_record_per_session(self):
        # regression: a session stops many times; the hook used to append a cumulative superset
        # record on every stop, bloating traces and inflating the reflect metric.
        tpath = self._transcript()
        for _ in range(3):
            self.hook({"session_id": "sess-A", "transcript_path": tpath,
                       "cwd": str(self.repo), "stop_hook_active": False})
        lines = [l for l in (self.repo / ".fablize" / "traces.jsonl").read_text().splitlines() if l.strip()]
        auto = [json.loads(l) for l in lines]
        self.assertEqual(sum(1 for r in auto if r.get("session") == "sess-A"), 1, "should upsert, not pile up")
        # and metrics counts exactly one reflect for the session, not three
        m = subprocess.run([sys.executable, METRICS, "--json"], cwd=str(self.repo),
                           env=self.env, capture_output=True, text=True)
        self.assertEqual(json.loads(m.stdout)["brain"]["reflects"], 1)

    def test_empty_session_records_nothing(self):
        r = self.hook({"transcript_path": "/does/not/exist", "cwd": str(self.repo)})
        self.assertEqual(r.returncode, 0)
        self.assertFalse((self.repo / ".fablize" / "traces.jsonl").exists())

    def test_counts_as_brain_reflect_in_metrics(self):
        self.hook({"session_id": "s1", "transcript_path": self._transcript(),
                   "cwd": str(self.repo), "stop_hook_active": False})
        r = subprocess.run([sys.executable, METRICS, "--json"], cwd=str(self.repo),
                           env=self.env, capture_output=True, text=True)
        self.assertEqual(json.loads(r.stdout)["brain"]["reflects"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
