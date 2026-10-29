import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'tools/handoff.py'

class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.exists(), 'handoff bridge missing')
        spec = importlib.util.spec_from_file_location('handoff', MODULE)
        self.h = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.h)

    def test_rejects_original_timeline_subtitles(self):
        srt = '1\n00:06:00,000 --> 00:06:01,000\n原片字幕\n'
        with self.assertRaisesRegex(ValueError, '超出'):
            self.h.validate_srt(srt, 138)

    def test_rejects_missing_and_reversed_cues(self):
        for srt in ['', '1\n00:00:03,000 --> 00:00:02,000\n错序\n']:
            with self.assertRaises(ValueError):
                self.h.validate_srt(srt, 138)

    def test_multiline_raw_subtitles_preserved(self):
        text = '1\n00:00:00,100 --> 00:00:02,000\nAI 入行\n门槛\n\n2\n00:00:02,100 --> 00:00:03,000\n下一句\n'
        result = self.h.validate_srt(text, 3.2)
        self.assertEqual(result[0]['text'], 'AI 入行\n门槛')
        self.assertEqual(len(result), 2)

    def test_changed_export_cannot_resume(self):
        with self.assertRaisesRegex(ValueError, '新批次'):
            self.h.check_identity({'inputs': {'videoSha256':'a'}}, {'videoSha256':'b'})

if __name__ == '__main__':
    unittest.main()
