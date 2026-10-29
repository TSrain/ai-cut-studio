import sys
import unittest
from pathlib import Path
from unittest.mock import patch


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))

import learn_io  # noqa: E402
import package_io  # noqa: E402


class CoverSectionCompatibilityTests(unittest.TestCase):
    def test_strip_doc_chrome_removes_cover_appendix_from_learning_source(self):
        document = """# 【脚本】测试

正文第一段。

正文第二段。

---

## 封面方案（2026-10-09 · 对照 v3 定稿）

### A
封面文案与配图说明。
"""

        self.assertEqual(
            learn_io.strip_doc_chrome(document),
            "正文第一段。\n\n正文第二段。\n",
        )
        self.assertEqual(
            package_io.strip_doc_chrome(document),
            "正文第一段。\n\n正文第二段。\n",
        )

    def test_strip_doc_chrome_preserves_ordinary_cover_mentions(self):
        document = """# 【脚本】测试

这期我们讨论封面方案为什么影响点击率。

最后再讲封面方案的取舍。
"""

        self.assertEqual(
            learn_io.strip_doc_chrome(document),
            "这期我们讨论封面方案为什么影响点击率。\n\n最后再讲封面方案的取舍。\n",
        )

    def test_cleanup_regex_recognizes_generated_cover_section_label(self):
        label = "封面方案（2026-10-09 · 对照 v3 定稿）"

        match = package_io.SECTION_RE.fullmatch(label)

        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), "封面方案")

    def test_commit_cli_accepts_cover_section_without_native_io(self):
        captured = {}

        def fake_commit(args):
            captured["section"] = args.section
            captured["package"] = args.package
            return 0

        argv = [
            "package_io.py", "commit", "--id", "SC-0001",
            "--section", "封面方案", "--package", "cover.md",
        ]
        with patch.object(sys, "argv", argv), patch.object(package_io, "cmd_commit", fake_commit):
            result = package_io.main()

        self.assertEqual(result, 0)
        self.assertEqual(captured, {"section": "封面方案", "package": "cover.md"})


if __name__ == "__main__":
    unittest.main()
