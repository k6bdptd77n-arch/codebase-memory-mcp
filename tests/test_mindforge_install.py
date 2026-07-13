#!/usr/bin/env python3
"""Closed-loop tests for the persistent MindForge/Codex installer."""
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
INSTALL = ROOT / "install-combined.sh"


class PersistentInstallTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.home = Path(self.tempdir.name)
        self.codex_home = self.home / ".codex"
        self.target = self.home / "project"
        self.target.mkdir()
        self.binary = self.home / "codebase-memory-mcp"
        self.binary.write_text(textwrap.dedent("""\
            #!/usr/bin/env bash
            set -euo pipefail
            CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
            STATE="$HOME/.fake-cbm"
            mkdir -p "$STATE"
            case "${1:-}" in
              install)
                mkdir -p "$CODEX_HOME"
                printf '%s\n' '[mcp_servers.codebase-memory-mcp]' 'command = "fake"' \
                  '# >>> codebase-memory-mcp SessionStart >>>' > "$CODEX_HOME/config.toml"
                printf '%s\n' '<!-- codebase-memory-mcp:start -->' > "$CODEX_HOME/AGENTS.md"
                ;;
              config)
                if [ "${2:-}" = set ]; then printf '%s\n' "$4" > "$STATE/$3"; else cat "$STATE/$3"; fi
                ;;
              cli) printf '%s\n' '{"projects":[]}' ;;
              *) exit 0 ;;
            esac
        """), encoding="utf-8")
        self.binary.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), CODEX_HOME=str(self.codex_home),
                        MINDFORGE_BIN=str(self.binary))

    def tearDown(self):
        self.tempdir.cleanup()

    def run_install(self, *args):
        return subprocess.run(["bash", str(INSTALL), *args, str(self.target)],
                              env=self.env, text=True, capture_output=True)

    def test_install_is_complete_idempotent_and_checkable(self):
        first = self.run_install()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertIn("Result: healthy", first.stdout)
        self.assertEqual((self.home / ".fake-cbm" / "auto_index").read_text().strip(), "true")
        self.assertEqual((self.home / ".fake-cbm" / "auto_index_limit").read_text().strip(), "50000")
        self.assertTrue((self.codex_home / "skills/mindforge-workflow/SKILL.md").exists())
        self.assertTrue((self.target / ".fablize-disciplines/scripts/brain.py").exists())

        second = self.run_install()
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn("preserving existing graph databases", second.stdout)
        self.assertEqual((self.target / "AGENTS.md").read_text().count("fablize — operating disciplines"), 1)

        check = self.run_install("--check")
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
        self.assertIn("persistent closed loop is ready", check.stdout)

    def test_doctor_detects_broken_project_hook(self):
        self.assertEqual(self.run_install().returncode, 0)
        (self.target / ".codex/hooks.json").unlink()
        check = self.run_install("--check")
        self.assertNotEqual(check.returncode, 0)
        self.assertIn("memory hooks missing", check.stderr)

    def test_rejects_invalid_auto_index_limit(self):
        result = self.run_install("--auto-index-limit", "zero")
        self.assertEqual(result.returncode, 2)
        self.assertIn("positive integer", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
