#!/usr/bin/env python3
"""fablize test suite — stdlib unittest, no third-party deps (portable everywhere).

Runs the engines as real subprocesses in an isolated temp HOME/CWD so the suite never
touches the developer's real ~/.fablize or repo state. Covers the invariants that ARE
the product: evidence-gated completion, the final verification gate, the bounded
self-correction → escalation counter, and the metrics summary.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOALS = str(ROOT / "scripts" / "goals.py")
SPEC = str(ROOT / "scripts" / "spec.py")
METRICS = str(ROOT / "scripts" / "metrics.py")
GUARD = str(ROOT / "hooks" / "destructive_guard.py")
BUNDLE = str(ROOT / "scripts" / "bundle.py")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, HOME=self.tmp)

    def run_script(self, script, *args, stdin=None):
        return subprocess.run(
            [sys.executable, script, *args],
            cwd=self.tmp, env=self.env, input=stdin,
            capture_output=True, text=True,
        )


class GoalsTests(Base):
    def _create(self):
        return self.run_script(GOALS, "create", "--brief", "demo",
                               "--goal", "build::do the thing",
                               "--goal", "verify::prove it works")

    def test_create_and_status(self):
        r = self._create()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("2 stories", r.stdout)
        s = self.run_script(GOALS, "status")
        self.assertIn("0/2 complete", s.stdout)

    def test_complete_requires_evidence(self):
        self._create()
        self.run_script(GOALS, "next")
        r = self.run_script(GOALS, "checkpoint", "--id", "G001", "--status", "complete", "--evidence", "")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("non-empty --evidence", r.stderr)

    def test_checkpoint_requires_active(self):
        self._create()
        # G001 never activated via `next`
        r = self.run_script(GOALS, "checkpoint", "--id", "G001", "--status", "complete", "--evidence", "x")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not active", r.stderr)

    def test_final_story_verification_gate(self):
        self._create()
        self.run_script(GOALS, "next")
        self.run_script(GOALS, "checkpoint", "--id", "G001", "--status", "complete", "--evidence", "built")
        self.run_script(GOALS, "next")  # activates final G002
        # final without verify args must fail
        r = self.run_script(GOALS, "checkpoint", "--id", "G002", "--status", "complete", "--evidence", "done")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("verification gate", r.stderr)
        # with verify args it succeeds
        ok = self.run_script(GOALS, "checkpoint", "--id", "G002", "--status", "complete",
                             "--evidence", "done", "--verify-cmd", "pytest", "--verify-evidence", "12 passed")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertIn("all stories complete", ok.stdout)

    def test_bounded_escalation(self):
        self._create()
        # attempt 1
        self.run_script(GOALS, "next")
        r1 = self.run_script(GOALS, "checkpoint", "--id", "G001", "--status", "blocked", "--evidence", "stuck")
        self.assertNotIn("escalation gate", r1.stdout)
        # retry → attempt 2 → escalation
        rt = self.run_script(GOALS, "retry", "--id", "G001")
        self.assertIn("attempt 2", rt.stdout)
        r2 = self.run_script(GOALS, "checkpoint", "--id", "G001", "--status", "blocked", "--evidence", "still stuck")
        self.assertIn("escalation gate", r2.stdout)
        self.assertIn("effort xhigh", r2.stdout)

    def test_failed_story_is_not_reported_complete(self):
        # regression: a failed/blocked story used to be excluded from "remaining", so the engine
        # falsely printed "all stories complete ✓" while a story sat failed.
        self._create()
        self.run_script(GOALS, "next")
        r = self.run_script(GOALS, "checkpoint", "--id", "G001", "--status", "failed", "--evidence", "broke")
        self.assertNotIn("all stories complete", r.stdout)
        self.assertIn("failed/blocked", r.stdout)
        # `next` must not declare success either while G001 is failed
        n = self.run_script(GOALS, "next")  # activates G002
        self.run_script(GOALS, "checkpoint", "--id", "G002", "--status", "complete",
                        "--evidence", "done", "--verify-cmd", "pytest", "--verify-evidence", "ok")
        nn = self.run_script(GOALS, "next")
        self.assertNotIn("all stories complete", nn.stdout)
        self.assertIn("failed/blocked", nn.stdout)

    def test_global_event_log_written(self):
        self._create()
        log = Path(self.tmp) / ".fablize" / "events.jsonl"
        self.assertTrue(log.exists())
        lines = [json.loads(x) for x in log.read_text().splitlines() if x.strip()]
        self.assertTrue(any(e["event"] == "plan_created" and e["tool"] == "goals" for e in lines))

    def test_add_requires_existing_plan(self):
        r = self.run_script(GOALS, "add", "--goal", "extra::late-breaking work")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no plan", r.stderr)

    def test_add_appends_sequential_ids(self):
        self._create()
        r = self.run_script(GOALS, "add", "--goal", "extra::more work", "--goal", "polish::final touches")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("G003", r.stdout)
        self.assertIn("G004", r.stdout)
        s = self.run_script(GOALS, "status")
        self.assertIn("0/4 complete", s.stdout)

    def test_add_moves_verification_gate_to_new_final_story(self):
        self._create()
        self.run_script(GOALS, "add", "--goal", "extra::the real final story")
        self.run_script(GOALS, "next")
        self.run_script(GOALS, "checkpoint", "--id", "G001", "--status", "complete", "--evidence", "built")
        self.run_script(GOALS, "next")
        # G002 was the final story before `add` — it must no longer require the gate
        r = self.run_script(GOALS, "checkpoint", "--id", "G002", "--status", "complete", "--evidence", "done")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.run_script(GOALS, "next")  # activates the new final G003
        bad = self.run_script(GOALS, "checkpoint", "--id", "G003", "--status", "complete", "--evidence", "done")
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("verification gate", bad.stderr)
        ok = self.run_script(GOALS, "checkpoint", "--id", "G003", "--status", "complete",
                             "--evidence", "done", "--verify-cmd", "pytest", "--verify-evidence", "all passed")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertIn("all stories complete", ok.stdout)


class SpecTests(Base):
    def test_lock_needs_something(self):
        r = self.run_script(SPEC, "lock", "--brief", "x")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("at least one", r.stderr)

    def test_lock_and_show(self):
        r = self.run_script(SPEC, "lock", "--brief", "auth", "--req", "use OAuth",
                            "--decision", "db::postgres")
        self.assertEqual(r.returncode, 0, r.stderr)
        s = self.run_script(SPEC, "show")
        self.assertIn("use OAuth", s.stdout)
        self.assertIn("postgres", s.stdout)

    def test_show_empty(self):
        s = self.run_script(SPEC, "show")
        self.assertIn("no locked spec", s.stdout)


class MetricsTests(Base):
    def test_summary_after_flow(self):
        self.run_script(GOALS, "create", "--brief", "m", "--goal", "a::x", "--goal", "v::y")
        self.run_script(SPEC, "lock", "--req", "r1")
        r = self.run_script(METRICS, "--json")
        data = json.loads(r.stdout)
        self.assertEqual(data["plans_created"], 1)
        self.assertEqual(data["specs_locked"], 1)

    def test_empty_metrics(self):
        r = self.run_script(METRICS)
        self.assertIn("no events yet", r.stdout)


class GuardTests(Base):
    def _check(self, command):
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
        return self.run_script(GUARD, stdin=payload)

    def test_blocks_rm_rf(self):
        r = self._check("rm -rf /tmp/stuff")
        self.assertIn("permissionDecision", r.stdout)
        self.assertIn("ask", r.stdout)

    def test_blocks_force_push(self):
        r = self._check("git push origin main --force")
        self.assertIn("ask", r.stdout)

    def test_allows_safe_command(self):
        r = self._check("ls -la && git status")
        self.assertEqual(r.stdout.strip(), "")

    def test_allows_plain_file_rm(self):
        # regression: the old pattern matched any rm whose target contained an 'f' (e.g. `rm draft`).
        for cmd in ("rm file.txt", "rm draft", "rm config", "rm -i note.md"):
            self.assertEqual(self._check(cmd).stdout.strip(), "", cmd)

    def test_blocks_rm_long_flags(self):
        # the long-flag form used to slip past the single-dash regex
        r = self._check("rm --recursive --force /tmp/x")
        self.assertIn("ask", r.stdout)

    def test_ignores_non_bash(self):
        payload = json.dumps({"tool_name": "Read", "tool_input": {"file_path": "/x"}})
        r = self.run_script(GUARD, stdin=payload)
        self.assertEqual(r.stdout.strip(), "")


class InstallTests(Base):
    INSTALL = str(ROOT / "install.sh")

    def _install(self, target):
        return subprocess.run(["bash", self.INSTALL, target], env=self.env,
                              capture_output=True, text=True)

    def test_install_layout_and_wiring(self):
        # S6/S3 regression: installer must copy under .fablize-disciplines/{packs,scripts,hooks},
        # rewrite documented command paths to that namespace, and wire hooks atomically/idempotently.
        Path(self.tmp, ".claude").mkdir(parents=True)
        Path(self.tmp, ".claude", "settings.json").write_text("{}", encoding="utf-8")
        tgt = Path(self.tmp) / "proj"
        tgt.mkdir()
        r = self._install(str(tgt))
        self.assertEqual(r.returncode, 0, r.stderr)
        disc = tgt / ".fablize-disciplines"
        self.assertTrue((disc / "hooks" / "brain_reflect.py").exists())
        self.assertTrue((disc / "scripts" / "brain.py").exists())
        agents = (tgt / "AGENTS.md").read_text()
        self.assertIn(".fablize-disciplines/scripts/brain.py", agents)
        self.assertNotIn("` scripts/brain.py", agents)  # no un-rewritten in-repo path
        settings = json.loads(Path(self.tmp, ".claude", "settings.json").read_text())
        self.assertIn("destructive_guard.py", json.dumps(settings["hooks"]["PreToolUse"]))
        self.assertIn("brain_reflect.py", json.dumps(settings["hooks"]["Stop"]))

    def test_install_idempotent_and_self_healing(self):
        cl = Path(self.tmp, ".claude"); cl.mkdir(parents=True)
        # seed a STALE path from a "previous checkout" — install must replace, not duplicate
        Path(cl, "settings.json").write_text(json.dumps(
            {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": 'python3 "/old/brain_reflect.py"'}]}]}}),
            encoding="utf-8")
        tgt = Path(self.tmp) / "proj"; tgt.mkdir()
        self._install(str(tgt))
        self._install(str(tgt))  # twice
        s = json.loads(Path(cl, "settings.json").read_text())
        self.assertEqual(len(s["hooks"]["Stop"]), 1)  # not piled up
        self.assertNotIn("/old/", json.dumps(s["hooks"]["Stop"]))  # stale path healed

    def test_install_warns_when_no_settings(self):
        # fresh machine: no ~/.claude/settings.json → must NOT claim success on wiring
        tgt = Path(self.tmp) / "proj"; tgt.mkdir()
        r = self._install(str(tgt))
        self.assertIn("NOT wired", r.stdout)


class BundleTests(Base):
    def test_bundle_ships_full_layer(self):
        # regression (S6): bundle.py must package the whole layer — brain.py + both hooks — not
        # just goals/spec/metrics; an empty hooks dir is silently swallowed by apply.sh's `|| true`.
        out = Path(self.tmp) / "dist"
        r = self.run_script(BUNDLE, "--out", str(out))
        self.assertEqual(r.returncode, 0, r.stderr)
        pkg = out / "fablize-portable"
        for rel in ("scripts/brain.py", "scripts/goals.py", "scripts/spec.py", "scripts/metrics.py",
                    "scripts/orchestrate.py",
                    "hooks/brain_reflect.py", "hooks/destructive_guard.py", "apply.sh", "QUICKSTART.md"):
            self.assertTrue((pkg / rel).exists(), f"missing {rel} in bundle tree")
        self.assertTrue(list((pkg / "packs").glob("*.txt")), "no packs in bundle")
        import zipfile
        names = zipfile.ZipFile(out / "fablize-portable.zip").namelist()
        self.assertTrue(any(n.endswith("hooks/brain_reflect.py") for n in names), "hook missing from zip")
        self.assertTrue(any(n.endswith("scripts/brain.py") for n in names), "brain missing from zip")
        self.assertTrue(any(n.endswith("scripts/orchestrate.py") for n in names),
                        "orchestrate missing from zip")


if __name__ == "__main__":
    unittest.main(verbosity=2)
