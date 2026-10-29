import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('broll_pool', Path(__file__).resolve().parents[1] / 'tools/broll.py')
broll = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broll)


def hit(url, size='1920x1080'):
    return {'url': url, 'size': size, 'type': '视频', 'preview': 'preview', 'dur': 6}


class CandidatePoolTest(unittest.TestCase):
    def test_default_keeps_eight_instead_of_two(self):
        self.assertEqual(len(broll.shortlist_candidates([hit(str(i)) for i in range(10)], 'landscape')), 8)

    def test_zero_limit_keeps_all_qualified_candidates(self):
        self.assertEqual(len(broll.shortlist_candidates([hit(str(i)) for i in range(12)], 'landscape', limit=0)), 12)

    def test_rejects_low_resolution_and_unknown_without_rejecting_portrait(self):
        chosen = broll.shortlist_candidates([hit('low', '1920x480'), hit('unknown', 'NonexNone'), hit('portrait', '720x1280'), hit('hd', '1280x720')], 'landscape')
        self.assertEqual({x['url'] for x in chosen}, {'portrait', 'hd'})

    def test_unknown_dimensions_remain_pending_instead_of_disappearing(self):
        prefs = {'per_beat': 8, 'orientation': 'landscape', 'candidate_limit': 0}
        with patch.object(broll, 'pexels_search', return_value=[hit('unknown', ''), hit('low', '640x360'), hit('hd')]):
            result = broll.resolve_beat({'关键词': ['office']}, 'pexels', 'fake', prefs, False, extra=False)
        self.assertEqual([x['url'] for x in result['待核验']], ['unknown'])
        self.assertEqual([x['url'] for x in result['直链']], ['hd'])
        self.assertEqual(result['低清剔除数'], 1)

    def test_resolve_respects_requested_candidate_limit(self):
        prefs = {'per_beat': 10, 'orientation': 'landscape', 'candidate_limit': 5}
        with patch.object(broll, 'pexels_search', return_value=[hit(str(i)) for i in range(10)]):
            result = broll.resolve_beat({'关键词': ['office']}, 'pexels', 'fake', prefs, False, extra=False)
        self.assertEqual(len(result['直链']), 5)

if __name__ == '__main__':
    unittest.main()
