import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import editor_plan_runtime as runtime


class AnimationDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.media = self.root / '跨段整幅.mp4'
        self.media.write_bytes(b'video-fixture')
        self.manifest = self.root / 'animation-delivery.json'
        self.entry = {'file': str(self.media), 'startSeconds': 1.25, 'durationSeconds': 4, 'transparent': False}
        self.value = {'schemaVersion': 1, 'timeBase': 'project', 'projectId': 'p', 'files': [self.entry]}
        self.manifest.write_text(json.dumps(self.value))
        self.data = {'projectId': 'p', 'jobId': 'j', 'kind': 'recognize',
                     'deliveryManifestPath': str(self.manifest), 'deliveryManifestSha256': runtime.digest(self.manifest),
                     'document': {'id': 'p', 'canvas': {'width': 1280, 'height': 720, 'fps': {'num': 30, 'den': 1}, 'durationFrames': 300},
                                  'source': None, 'instances': [], 'productionPlan': {'shots': []}}}
        probe_path = self.root / 'probe.json'
        probe_path.write_text('{}')
        self.probe = {'sha256': runtime.digest(self.media), 'probePath': str(probe_path), 'durationSeconds': 4,
                      'width': 1280, 'height': 720, 'kind': 'video', 'hasAlpha': False, 'streams': [{'codec_type': 'video'}], 'frames': []}

    def run_delivery(self, data=None, probe=None):
        store = runtime.ResultStore(self.root / 'out', data or self.data)
        with patch.object(runtime, 'probe_and_sample', return_value=probe or self.probe), \
             patch.object(runtime, 'model_json', side_effect=AssertionError('must not guess manifest placement')), \
             patch.object(runtime.subprocess, 'run'):
            result = runtime.recognize(store)
        return result

    def test_manifest_places_fullframe_across_shots_without_model_or_plan(self):
        result = self.run_delivery()
        self.assertEqual(result['state'], 'complete')
        self.assertEqual(len(result['results']), 1)
        row = result['results'][0]
        self.assertEqual(row['kind'], 'delivery')
        self.assertNotIn('shotId', row)
        self.assertEqual(row['target'], {'startFrame': 38, 'durationFrames': 120})
        self.assertFalse(row['delivery']['transparent'])
        self.assertTrue(row['technical']['passed'])
        self.assertEqual(row['media']['sourceOutSeconds'], 4)

    def test_original_overlay_slot_does_not_reject_opaque_delivery(self):
        data = copy.deepcopy(self.data)
        data['document']['productionPlan']['shots'] = [{'id': 's', 'presentationMode': 'overlay', 'slots': [{'id': 'v'}]}]
        self.assertEqual(self.run_delivery(data)['results'][0]['kind'], 'delivery')

    def test_declared_transparency_uses_actual_file_not_original_plan(self):
        self.value['files'][0]['transparent'] = True
        self.manifest.write_text(json.dumps(self.value))
        self.data['deliveryManifestSha256'] = runtime.digest(self.manifest)
        result = self.run_delivery()
        self.assertEqual(result['state'], 'partial')
        self.assertFalse(result['results'][0]['technical']['passed'])
        self.assertIn('Alpha', result['results'][0]['reason'])

    def test_bad_manifest_hash_cannot_fall_back_to_guessing(self):
        self.data['deliveryManifestSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'hash|SHA'):
            self.run_delivery()

    def test_wrong_project_nonfinite_times_and_outside_canvas_rejected(self):
        from tools.animation_delivery import load_manifest
        for change in ({'projectId': 'other'}, {'files': [{**self.entry, 'startSeconds': float('nan')}]},
                       {'files': [{**self.entry, 'startSeconds': 9}]}, {'files': [{**self.entry, 'transparent': 'false'}]},
                       {'timeBase': 'source'}):
            value = {**self.value, **change}
            self.manifest.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                load_manifest(self.manifest, self.data['document'])

    def test_ready_delivery_result_needs_no_semantic_review(self):
        store = runtime.ResultStore(self.root / 'out', self.data)
        row = {'kind': 'delivery', 'state': 'ready', 'target': {'startFrame': 30, 'durationFrames': 120},
               'media': {'path': str(self.media), 'sourceInSeconds': 0, 'sourceOutSeconds': 4},
               'delivery': {'manifestPath': str(self.manifest), 'manifestSha256': runtime.digest(self.manifest),
                            'entryIndex': 0, 'startSeconds': 1.25, 'durationSeconds': 4, 'transparent': False, 'timeBase': 'project'},
               'technical': {'passed': True, 'details': self.probe}}
        self.assertEqual(store.publish(row)['kind'], 'delivery')

    def test_half_frame_times_match_motion_studio_rounding(self):
        from tools.animation_delivery import load_manifest
        self.value['files'][0].update(startSeconds=.15, durationSeconds=4.15)
        self.manifest.write_text(json.dumps(self.value))
        _, entries = load_manifest(self.manifest, self.data['document'])
        self.assertEqual(entries[0]['target'], {'startFrame': 5, 'durationFrames': 125})

    def test_cli_manifest_import_is_independent_and_does_not_enable_other_branches(self):
        from tools import editor_plan
        args = editor_plan.parser().parse_args(['jobs', '--project-id', 'p', '--kind', 'recognize',
                                               '--delivery-manifest', str(self.manifest)])
        document = {**self.data['document'], 'revision': 2}
        with patch.object(editor_plan, 'api', side_effect=[{'document': document}, {'ok': True}]) as api:
            self.assertEqual(editor_plan.execute(args), {'ok': True})
        payload = api.call_args.args[2]
        self.assertEqual(payload['deliveryManifestPath'], str(self.manifest.resolve()))
        self.assertEqual(payload['scope'], {'camera': False, 'sound': False})
        self.assertNotIn('shotId', payload)

