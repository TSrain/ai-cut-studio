"""Real PNG and CLI regression tests for cover preparation and delivery checks."""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

SCRIPT = Path(__file__).resolve().parents[1] / 'tools/cover.py'


def png(path, width=1080, height=1440):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + b'\x88\x44\x22' * width) * height)) + chunk(b'IEND', b''))


class CoverTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.exists(), 'cover helper has not been implemented')
        spec = importlib.util.spec_from_file_location('cover', SCRIPT)
        self.cover = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.cover)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        temp_root = Path(self.temp.name)
        self.source = temp_root / 'article.md'
        self.source.write_text('本人走进电影场景，记录婚礼。', encoding='utf-8')
        portraits = temp_root / 'portraits'
        self.portrait = portraits / '本人.PNG'
        png(self.portrait)
        self.root = self.cover.prepare(self.source, 'test', 3, 'run', output_root=temp_root / 'runs', portrait_dir=portraits)
        self.manifest = self.root / 'manifest.json'
        self.data = {'schema_version': 2, 'expected_groups': 3, 'status': 'awaiting_selection', 'groups': []}
        self.data['content_brief'] = {'content_type': '婚礼创作分享', 'audience': '准备婚礼的人', 'use_case': '制作婚礼影片', 'viewer_outcome': '了解电影场景的呈现方法', 'primary_promise': '展示本人进入电影场景的婚礼创作', 'source_evidence': ['本人走进电影场景，记录婚礼。']}
        for name in 'ABC':
            png(self.root / name / 'portrait.png')
            png(self.root / name / 'landscape.png', 1440, 1080)
            self.data['groups'].append({'id': name, 'title': '我的婚礼拍成电影', 'subject_mode': 'concept', 'text_mode': 'none', 'cover_text': '', 'references': [], 'source_excerpt': '电影场景', 'hook': '拍成电影', 'images': {'3:4': f'{name}/portrait.png', '4:3': f'{name}/landscape.png'}, 'visual_review': {'passed': True, 'notes': 'Viewed both images.'}, 'semantic_review': {'passed': True, 'cover_readback': '本人进入电影场景', 'title_cover_readback': '制作电影场景婚礼影片', 'notes': '封面及标题对应婚礼创作分享。'}})

    def validate(self):
        self.manifest.write_text(json.dumps(self.data), encoding='utf-8')
        return self.cover.validate(self.manifest)

    def test_concept_empty_references_is_ready_but_not_user_approved(self):
        result = self.validate()
        self.assertTrue(result['candidate_ready'], result)
        self.assertFalse(result['user_approved'])
        self.assertTrue(result['agent_semantic_attestation_passed'])
        self.assertEqual(len(result['images']), 6)

    def test_missing_or_malformed_brief_blocks_machine_validation(self):
        brief = self.data.pop('content_brief')
        self.assertFalse(self.validate()['machine_passed'])
        self.data['content_brief'] = brief
        for field in ('content_type', 'audience', 'use_case', 'viewer_outcome', 'primary_promise'):
            with self.subTest(field=field):
                previous = brief[field]
                brief[field] = ' '
                self.assertFalse(self.validate()['machine_passed'])
                brief[field] = previous

    def test_brief_evidence_must_be_nonempty_source_substrings(self):
        for evidence in ([], ['捏造的正文'], [12], '电影场景'):
            with self.subTest(evidence=evidence):
                self.data['content_brief']['source_evidence'] = evidence
                self.assertFalse(self.validate()['machine_passed'])

    def test_semantic_false_or_missing_keeps_visual_passed_candidates_pending(self):
        for review in (None, {'passed': False, 'cover_readback': '婚礼', 'title_cover_readback': '婚礼分享', 'notes': '未传达方法承诺'}):
            with self.subTest(review=review):
                if review is None:
                    self.data['groups'][0].pop('semantic_review')
                else:
                    self.data['groups'][0]['semantic_review'] = review
                result = self.validate()
                self.assertTrue(result['machine_passed'], result)
                self.assertTrue(result['agent_visual_attestation_passed'])
                self.assertFalse(result['agent_semantic_attestation_passed'])
                self.assertFalse(result['candidate_ready'])

    def test_semantic_empty_explanations_cannot_attest(self):
        review = self.data['groups'][0]['semantic_review']
        for field in ('cover_readback', 'title_cover_readback', 'notes'):
            with self.subTest(field=field):
                previous = review[field]
                review[field] = ' '
                result = self.validate()
                self.assertTrue(result['machine_passed'])
                self.assertFalse(result['candidate_ready'])
                review[field] = previous

    def test_semantic_wrong_types_are_machine_errors(self):
        self.data['groups'][0]['semantic_review']['passed'] = 'true'
        self.assertFalse(self.validate()['machine_passed'])

    def test_legacy_manifest_cannot_be_ready(self):
        self.data['schema_version'] = 1
        result = self.validate()
        self.assertFalse(result['machine_passed'])
        self.assertFalse(result['candidate_ready'])
        self.assertIn('unsupported', ' '.join(result['errors']))

    def test_wrong_ratio(self):
        png(self.root / 'A/portrait.png', 1080, 1080)
        self.assertIn('ratio', ' '.join(self.validate()['errors']))

    def test_missing_pair(self):
        del self.data['groups'][0]['images']['4:3']
        self.assertFalse(self.validate()['machine_passed'])

    def test_hard_and_soft_title_limits(self):
        self.data['groups'][0]['title'] = '一' * 16
        self.assertFalse(self.validate()['machine_passed'])
        self.data['groups'][0]['title'] = '一' * 11
        result = self.validate()
        self.assertTrue(result['machine_passed'])
        self.assertTrue(result['warnings'])

    def test_none_text_cannot_contain_words(self):
        self.data['groups'][0]['cover_text'] = '标题'
        self.assertFalse(self.validate()['machine_passed'])

    def test_corrupt_file(self):
        (self.root / 'A/portrait.png').write_bytes(b'\x89PNG\r\n\x1a\nwrong')
        self.assertFalse(self.validate()['machine_passed'])

    def test_path_escape_and_symlink(self):
        self.data['groups'][0]['images']['3:4'] = '../outside.png'
        self.assertIn('outside', ' '.join(self.validate()['errors']))
        self.data['groups'][0]['images']['3:4'] = 'escape.png'
        (self.root / 'escape.png').symlink_to('/tmp/outside.png')
        self.assertIn('outside', ' '.join(self.validate()['errors']))

    def test_duplicate_group_and_reused_asset(self):
        self.data['groups'][1] = copy.deepcopy(self.data['groups'][0])
        self.assertFalse(self.validate()['machine_passed'])

    def test_unreviewed_is_machine_valid_but_not_ready(self):
        self.data['groups'][0]['visual_review']['passed'] = False
        result = self.validate()
        self.assertTrue(result['machine_passed'])
        self.assertFalse(result['candidate_ready'])

    def test_person_requires_existing_reference(self):
        self.data['groups'][0]['subject_mode'] = 'person'
        self.assertFalse(self.validate()['machine_passed'])

    def test_prepare_preserves_source_and_blocks_overwrite(self):
        source = self.root / '原文.md'
        source.write_bytes('原文\r\n保持原样'.encode())
        run = self.cover.prepare(source, '测试', 3, 'run-1', output_root=self.root / 'runs', portrait_dir=self.root / 'missing')
        self.assertEqual((run / 'source.md').read_bytes(), source.read_bytes())
        meta = json.loads((run / 'source.json').read_text())
        self.assertEqual(meta['original_path'], str(source.resolve()))
        self.assertTrue(json.loads((run / 'references.json').read_text())['warnings'])
        with self.assertRaises(FileExistsError):
            self.cover.prepare(source, '测试', 3, 'run-1', output_root=self.root / 'runs')

    def test_empty_asset_path_is_not_complete_pair(self):
        self.data['groups'][0]['images']['3:4'] = ''
        self.assertFalse(self.validate()['machine_passed'])

    def test_small_image_and_damaged_pixel_data_fail(self):
        png(self.root / 'A/portrait.png', 810, 1080)
        self.assertFalse(self.validate()['machine_passed'])
        path = self.root / 'A/portrait.png'
        png(path)
        raw = path.read_bytes()
        start = raw.index(b'IDAT') + 4
        path.write_bytes(raw[:start + 10] + b'broken pixel stream' + raw[-12:])
        self.assertFalse(self.validate()['machine_passed'])

    def test_reference_inventory_refreshes_and_records_hash(self):
        source = self.root / 'source.md'
        source.write_text('source')
        portraits = self.root / 'portrait'
        png(portraits / '我.PNG')
        one = self.cover.prepare(source, 'slug', 3, 'one', output_root=self.root / 'runs', portrait_dir=portraits)
        png(portraits / '第二张.JpG')
        two = self.cover.prepare(source, 'slug', 3, 'two', output_root=self.root / 'runs', portrait_dir=portraits)
        self.assertEqual(len(json.loads((one / 'references.json').read_text())['references']), 1)
        self.assertEqual(len(json.loads((two / 'references.json').read_text())['references']), 2)
        self.assertEqual(json.loads((one / 'source.json').read_text())['sha256'], self.cover.sha256(source))

    def test_source_snapshot_hash_and_presence_are_required(self):
        (self.root / 'source.md').write_text('篡改后的电影场景', encoding='utf-8')
        self.assertFalse(self.validate()['machine_passed'])
        (self.root / 'source.md').unlink()
        self.assertFalse(self.validate()['machine_passed'])

    def test_source_metadata_must_exist(self):
        (self.root / 'source.json').unlink()
        self.assertFalse(self.validate()['machine_passed'])

    def test_excerpt_must_appear_in_frozen_source(self):
        self.data['groups'][0]['source_excerpt'] = '并没有写过这一句话'
        self.assertFalse(self.validate()['machine_passed'])

    def test_group_count_must_match_prepared_contract(self):
        path = self.root / 'source.json'
        meta = json.loads(path.read_text())
        meta['expected_groups'] = 5
        path.write_text(json.dumps(meta))
        self.assertFalse(self.validate()['machine_passed'])
        meta['expected_groups'] = 3
        path.write_text(json.dumps(meta))
        del self.data['expected_groups']
        self.assertFalse(self.validate()['machine_passed'])

    def test_person_reference_must_be_from_inventory_and_unchanged(self):
        group = self.data['groups'][0]
        group['subject_mode'] = 'person'
        group['references'] = [str(self.portrait.resolve())]
        self.assertTrue(self.validate()['machine_passed'])
        self.portrait.write_bytes(b'changed after prepare')
        self.assertFalse(self.validate()['machine_passed'])
        group['references'] = [str((self.root / 'A/portrait.png').resolve())]
        self.assertFalse(self.validate()['machine_passed'])

    def test_prepare_rejects_traversal(self):
        with self.assertRaises(ValueError):
            self.cover.prepare(self.root / 'source.md', '../escape', 3, 'run', output_root=self.root)

if __name__ == '__main__':
    unittest.main()
