import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import codex_cli  # noqa: E402


class CodexCliConfigTest(unittest.TestCase):
    def setUp(self):
        self.config = dict(codex_cli.DEFAULTS)

    def clean_env(self):
        names = codex_cli.BINARY_ENV + codex_cli.MODEL_ENV + codex_cli.EFFORT_ENV
        return patch.dict(os.environ, {name: "" for name in names})

    def test_config_pins_model_and_effort(self):
        self.assertIsNone(self.config["model"])
        self.assertIsNone(self.config["reasoningEffort"])

    def test_exec_command_always_passes_model_and_effort(self):
        with self.clean_env():
            argv = codex_cli.exec_command("--sandbox", "read-only", "-", binary="/x/codex")
        self.assertEqual(argv[:4], ["/x/codex", "--ask-for-approval", "never", "exec"])
        self.assertNotIn("--model", argv)
        self.assertFalse(any(value.startswith("model_reasoning_effort=") for value in argv))
        self.assertEqual(argv[-1], "-")

    def test_auto_approval_stays_inside_exec(self):
        with self.clean_env():
            argv = codex_cli.exec_command("-C", "/repo", approval="auto", binary="/x/codex")
        self.assertEqual(argv[:3], ["/x/codex", "exec", "--approve-for-me"])
        self.assertNotIn("--ask-for-approval", argv)
        self.assertNotIn("--model", argv)

    def test_env_overrides(self):
        with self.clean_env(), patch.dict(os.environ, {"CODEX_BIN": "/env/codex", "CODEX_MODEL": "m-test", "CODEX_REASONING_EFFORT": "low"}):
            argv = codex_cli.exec_command("-")
        self.assertEqual(argv[0], "/env/codex")
        self.assertEqual(argv[argv.index("--model") + 1], "m-test")
        self.assertIn('model_reasoning_effort="low"', argv)

    def test_resolves_configured_binary_first(self):
        with self.clean_env(), patch.object(Path, "is_file", lambda p: str(p) == self.config["binary"]):
            self.assertEqual(codex_cli.codex_binary(), self.config["binary"])

    def test_rejects_unknown_effort(self):
        with self.clean_env(), patch.dict(os.environ, {"CODEX_REASONING_EFFORT": "max"}):
            with self.assertRaises(ValueError):
                codex_cli.exec_command("-", binary="/x/codex")


class CallSitesPinModelTest(unittest.TestCase):
    """Every codex exec call site must go through codex_cli.exec_command."""

    def test_no_hand_built_exec_argv(self):
        offenders = []
        for path in (ROOT / "tools").glob("*.py"):
            if path.name == "codex_cli.py":
                continue
            text = path.read_text(encoding="utf-8")
            for marker in ("'exec','--", "'exec', '--", '"exec", "--', "'--ask-for-approval'", "CODEX_BIN ="):
                if marker in text:
                    offenders.append(f"{path.name}: {marker}")
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
