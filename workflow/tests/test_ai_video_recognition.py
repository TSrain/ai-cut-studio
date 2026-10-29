import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.test_editor_plan import snapshot
from tools import editor_plan, editor_plan_runtime as runtime


class AiVideoRecognitionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ref = self.root / 'reference.png'
        self.ref.write_bytes(b'reference-fixture')
        self.data = snapshot('recognize')
        self.data['workflowMode'] = 'semantic-template-v1'
        self.data.update(shotId='stable-shot', aiVideoCandidateId='ai-1', aiVideoPromptVersion=1)
        self.shot = self.data['document']['productionPlan']['shots'][0]
        self.shot['timing'] = {'status': 'aligned', 'ranges': [{'id': 'r-1', 'startFrame': 30, 'durationFrames': 120}]}
        self.shot['slots'][0]['presentationMode'] = 'overlay'
        self.shot['aiVideoCandidates'] = [{'id': 'ai-1', 'title': '单人工作室', 'prompt': '一人在工作室工作。',
            'promptVersion': 1, 'requirementVersion': 4, 'reason': '场景示意', 'sourceCueIds': [1],
            'aspectRatio': '16:9', 'durationSeconds': 4, 'evidenceRole': 'illustration',
            'references': [{'path': str(self.ref), 'label': '图1', 'purpose': '环境', 'sha256': runtime.digest(self.ref)}]}]

    def tearDown(self):
        self.tmp.cleanup()

    def test_snapshot_rejects_wrong_prompt_or_requirement_version(self):
        runtime.validate_snapshot(self.data)
        for field, value in [('aiVideoPromptVersion', 2), ('aiVideoCandidateId', 'missing')]:
            bad = copy.deepcopy(self.data); bad[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'AI|ai|候选|版本'):
                runtime.validate_snapshot(bad)
        self.shot['aiVideoCandidates'][0]['requirementVersion'] = 3
        with self.assertRaisesRegex(ValueError, 'requirement|需求|版本'):
            runtime.validate_snapshot(self.data)

    def test_ai_identity_requires_shot_and_cannot_be_network_candidate(self):
        for mutate in (lambda d: d.pop('shotId'), lambda d: d.update(candidateId='network-1')):
            bad = copy.deepcopy(self.data); mutate(bad)
            with self.assertRaises(ValueError):
                runtime.validate_snapshot(bad)

    def test_reference_sha_change_is_rejected(self):
        self.ref.write_bytes(b'changed reference')
        with self.assertRaisesRegex(ValueError, 'SHA|hash|参考'):
            runtime.validate_snapshot(self.data)

    def test_ai_changes_invalidate_review_dependency(self):
        item = {'shotId': 'stable-shot', 'slotId': 'stable-slot'}
        before = runtime.review_dependency(self.data, item)
        changed = copy.deepcopy(self.data)
        changed['document']['productionPlan']['shots'][0]['aiVideoCandidates'][0]['prompt'] = '不同的动作'
        self.assertNotEqual(before, runtime.review_dependency(changed, item))

    def test_ai_opaque_video_uses_illustration_and_enforces_quality(self):
        self.data['slotId'] = 'stable-slot'
        probe = {'kind': 'video', 'durationSeconds': 4, 'width': 1280, 'height': 720,
                 'hasAlpha': False, 'probePath': 'probe.json', 'sha256': 'a' * 64, 'frames': []}
        suggestion = {'shotId': 'stable-shot', 'slotId': 'stable-slot', 'sourceInSeconds': 0,
                      'sourceOutSeconds': 4, 'passed': True, 'evidence': '实际工作场景', 'targetLocated': True}
        result = runtime.recognition_result(self.data, self.root/'video.mp4', probe, suggestion)
        self.assertEqual(result['state'], 'ready')
        self.assertFalse(result['technical']['details']['overlay'])
        self.assertEqual(result['aiVideoCandidateId'], 'ai-1')
        self.assertEqual(result['aiVideoPromptVersion'], 1)
        self.assertEqual(result['media']['sourceKind'], 'ai-generated')
        probe['height'] = 360
        self.assertFalse(runtime.recognition_result(self.data, self.root/'video.mp4', probe, suggestion)['technical']['passed'])

    def test_ai_clip_cannot_overrun_bound_shot(self):
        self.data['slotId'] = 'stable-slot'
        probe = {'kind': 'video', 'durationSeconds': 8, 'width': 1280, 'height': 720,
                 'hasAlpha': False, 'probePath': 'probe.json', 'sha256': 'a' * 64, 'frames': []}
        suggestion = {'shotId': 'stable-shot', 'slotId': 'stable-slot', 'sourceInSeconds': 0,
                      'sourceOutSeconds': 8, 'passed': True, 'evidence': '实际场景', 'targetLocated': True}
        with self.assertRaisesRegex(ValueError, 'range|区间|目标'):
            runtime.recognition_result(self.data, self.root/'video.mp4', probe, suggestion)

    def test_cli_preserves_ai_selector_and_numeric_version(self):
        args = editor_plan.parser().parse_args(['jobs', '--project-id', 'project-a', '--kind', 'recognize',
            '--shot-id', 'stable-shot', '--ai-video-candidate-id', 'ai-1', '--ai-video-prompt-version', '1'])
        self.assertEqual(args.ai_video_candidate_id, 'ai-1')
        self.assertEqual(args.ai_video_prompt_version, 1)

    def test_archived_reference_survives_original_change(self):
        frozen = self.root / 'frozen.png'; frozen.write_bytes(self.ref.read_bytes())
        self.data['inputs'] = [{'path': str(frozen), 'originalPath': str(self.ref), 'sha256': runtime.digest(frozen)}]
        self.ref.write_bytes(b'edited after job began')
        candidate = runtime.selected_ai_candidate(self.data)
        self.assertEqual(candidate['references'][0]['path'], str(frozen))
        frozen.write_bytes(b'tampered archive')
        with self.assertRaisesRegex(ValueError, 'SHA'):
            runtime.selected_ai_candidate(self.data)

    def test_publish_rejects_unbound_ai_result(self):
        store = runtime.ResultStore(self.root / 'out', self.data)
        for identity in ({}, {'aiVideoCandidateId': 'ai-1', 'aiVideoPromptVersion': 2}):
            with self.assertRaisesRegex(ValueError, 'frozen candidate'):
                store.publish({'kind': 'match', 'shotId': 'stable-shot', **identity})

    def test_cues_locate_second_range_and_revalidation_preserves_short_use(self):
        self.data['slotId'] = 'stable-slot'
        self.data['document']['source'] = {'path': str(self.root / 'source.mp4'), 'durationFrames': 900}
        self.shot['timing']['ranges'].append({'id': 'r-2', 'startFrame': 300, 'durationFrames': 150})
        srt = self.root/'source.srt'; srt.write_text('1\n00:00:11,000 --> 00:00:13,000\n实际口播\n\n2\n00:00:20,000 --> 00:00:22,000\n其他口播\n')
        self.data['sourceSrtPath'] = str(srt)
        path = self.root/'video.mp4'; path.write_bytes(b'fake fixture, probe mocked')
        frame = self.root/'frame.png'; frame.write_bytes(b'frame')
        probe = {'kind': 'video', 'durationSeconds': 2, 'width': 1280, 'height': 720, 'hasAlpha': False,
                 'probePath': 'probe.json', 'sha256': runtime.digest(path), 'frames': [{'path': str(frame), 'sha256': runtime.digest(frame)}]}
        suggestion = {'shotId': 'stable-shot', 'slotId': 'stable-slot', 'sourceInSeconds': 0, 'sourceOutSeconds': 2,
                      'passed': True, 'evidence': 'actual frames', 'targetLocated': True, 'targetCueIds': [1]}
        item = runtime.recognition_result(self.data, path, probe, suggestion)
        self.assertEqual(item['target'], {'rangeId': 'r-2', 'startFrame': 330, 'durationFrames': 60})
        item['contentReview']['mediaSha256'] = probe['sha256']
        store = runtime.ResultStore(self.root/'out', self.data)
        with patch.object(runtime, 'probe_and_sample', return_value=probe):
            verified = runtime.verify_result(item, store)
        self.assertEqual(verified['target'], item['target'])
        self.assertEqual(verified['state'], 'ready')
        for ids in ([], [2]):
            with self.assertRaisesRegex(ValueError, 'cue|Cue'):
                runtime.recognition_result(self.data, path, probe, {**suggestion, 'targetCueIds': ids})
        with self.assertRaisesRegex(ValueError, 'cue 结束点'):
            runtime.recognition_result(self.data, path, {**probe, 'durationSeconds': 3}, {**suggestion, 'sourceOutSeconds': 3})
        with self.assertRaisesRegex(ValueError, '实际视频'):
            runtime.recognition_result(self.data, path, {**probe, 'kind': 'image'}, suggestion)


if __name__ == '__main__':
    unittest.main()
