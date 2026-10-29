import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VISUALIZATION = ROOT.parent / "studio"


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class CodexBrollHandoffTest(unittest.TestCase):
    SKILLS = ("content-package", "content-broll")

    def test_codex_root_routes_package_and_broll(self):
        text = read('AGENTS.md')
        self.assertIn('docs/complete-package-contract.md', text)
        self.assertTrue((ROOT / 'docs/complete-package-contract.md').is_file())
        for name in self.SKILLS:
            self.assertIn('$' + name, text)
            self.assertTrue((ROOT / '.devin/skills' / name / 'SKILL.md').is_file())

    def test_two_native_skills_exist_with_portable_frontmatter(self):
        for name in self.SKILLS:
            path = ROOT / ".devin" / "skills" / name / "SKILL.md"
            self.assertTrue(path.is_file(), name)
            text = path.read_text(encoding="utf-8")
            frontmatter = re.match(r"^---\n([\s\S]*?)\n---", text).group(1)
            keys = re.findall(r"^([A-Za-z][\w-]*):", frontmatter, re.MULTILINE)
            self.assertEqual(["name", "description"], keys, name)

    def test_active_codex_handoff_has_no_claude_runtime_dependency(self):
        paths = [
            "AGENTS.md",
            ".devin/skills/content-package/SKILL.md",
            ".devin/skills/content-broll/SKILL.md",
        ]
        for path in paths:
            text = read(path)
            self.assertNotIn("CLAUDE.md", text, path)
            self.assertNotIn(".claude/", text, path)
            self.assertNotIn("Claude Code", text, path)

    def test_package_entry_delegates_to_shared_contract(self):
        relative = '.devin/skills/content-package/SKILL.md'
        self.assertIn('docs/complete-package-contract.md', read(relative))
        self.assertTrue((ROOT / 'docs/complete-package-contract.md').is_file())

    def test_broll_entry_delegates_to_shared_contract(self):
        relative = '.devin/skills/content-broll/SKILL.md'
        self.assertIn('docs/complete-package-contract.md', read(relative))
        self.assertTrue((ROOT / 'docs/complete-package-contract.md').is_file())

    def test_visualization_codex_runtime_is_present(self):
        self.assertTrue((VISUALIZATION / "AGENTS.md").is_file())
        self.assertTrue(
            (VISUALIZATION / ".devin/skills/motion-broll/SKILL.md").is_file()
        )


if __name__ == "__main__":
    unittest.main()
