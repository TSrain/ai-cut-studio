import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


class CaptionQualityTests(unittest.TestCase):
    def test_short_merged_sentence_requires_semantic_review_even_under_five_seconds(self):
        helper = self.helper()
        import inspect
        self.assertIn('require_segmentation_review', inspect.signature(helper.audit).parameters,
                      '所有字幕均需语义断句复审，不能只筛查超过5秒的cue')
        document = self.document()
        document['captions']['cues'][0].update(startFrame=34, endFrame=144,
            text='你就可以解锁和 AI 的悄悄话模式给你看一下')
        result = helper.audit(document, require_segmentation_review=True)
        self.assertFalse(result['passed'])
        self.assertIn('missing_segmentation_review', [x['code'] for x in result['findings']])

    def test_segmentation_review_covers_exact_current_cues_and_cannot_reuse_old_text(self):
        helper = self.helper()
        self.assertTrue(callable(getattr(helper, 'cue_digest', None)), '断句复审必须绑定当前cue内容')
        document = self.document()
        cue = document['captions']['cues'][0]
        cue.update(endFrame=700, text='给你看一下')
        review = {'version': 1, 'cues': [{'cueId': cue['id'],
            'cueSha256': helper.cue_digest(cue), 'decision': 'keep',
            'reason': '独立演示引导句，未与前一句合并'}]}
        self.assertTrue(helper.audit(document, require_segmentation_review=True,
                                     segmentation_review=review)['passed'])
        cue['text'] = '悄悄话模式给你看一下'
        with self.assertRaisesRegex(ValueError, '过期|不一致'):
            helper.audit(document, require_segmentation_review=True, segmentation_review=review)

    def test_segmentation_review_cannot_omit_short_cues_or_accept_unresolved_merge(self):
        helper = self.helper()
        import inspect
        self.assertIn('require_segmentation_review', inspect.signature(helper.audit).parameters,
                      '短字幕也必须完整覆盖断句复审')
        document = self.document()
        cue = document['captions']['cues'][0]
        cue.update(endFrame=700, text='悄悄话模式给你看一下')
        with self.assertRaisesRegex(ValueError, '覆盖|遗漏'):
            helper.audit(document, require_segmentation_review=True,
                         segmentation_review={'version': 1, 'cues': []})
        review = {'version': 1, 'cues': [{'cueId': cue['id'],
            'cueSha256': helper.cue_digest(cue), 'decision': 'split_required',
            'reason': '给你看一下是独立演示引导，需按原声拆开'}]}
        result = helper.audit(document, require_segmentation_review=True, segmentation_review=review)
        self.assertFalse(result['passed'])
        self.assertIn('merged_semantic_units', [x['code'] for x in result['findings']])

    def helper(self):
        self.assertIsNotNone(importlib.util.find_spec('tools.caption_quality'),
                             '字幕需有粗时间码和局部样式质量门')
        from tools import caption_quality
        return caption_quality

    def document(self):
        return {'canvas': {'fps': {'num': 30, 'den': 1}, 'durationFrames': 3429},
                'captions': {'enabled': True, 'style': {'color': '#ffffff', 'fontSize': 44},
                             'cues': [{'id': 'caption-12-1-1', 'startFrame': 656,
                                       'endFrame': 923, 'text': '像这样就像这样念经一样的说话'}]}}

    def test_demo_cue_cannot_pass_only_because_it_matches_source_srt(self):
        helper = self.helper()
        source = [{'start': 21.866, 'end': 30.766, 'text': '像这样就像这样念经一样的说话'}]
        report = helper.audit(self.document(), source)
        self.assertFalse(report['passed'])
        self.assertIn('coarse_source_timing', [x['code'] for x in report['findings']])
        self.assertIn('long_display_cue', [x['code'] for x in report['findings']])
        self.assertEqual(report['listening'], 'not_performed')

    def test_evenly_split_long_source_still_requires_timing_evidence(self):
        helper = self.helper()
        document = self.document()
        document['captions']['cues'] = [{'id': 'a', 'startFrame': 656, 'endFrame': 790, 'text': '像这样'},
                                         {'id': 'b', 'startFrame': 790, 'endFrame': 923, 'text': '就像这样念经一样的说话'}]
        report = helper.audit(document, [{'start': 21.866, 'end': 30.766, 'text': '像这样就像这样念经一样的说话'}])
        self.assertFalse(report['passed'])
        self.assertEqual([x['code'] for x in report['findings']], ['coarse_source_timing'])

    def test_yellow_and_local_font_size_are_flagged_without_changing_project(self):
        helper = self.helper()
        document = self.document()
        cue = document['captions']['cues'][0]
        cue.update(startFrame=1803, endFrame=1840, text='52分贝', style={'color': '#ffe58a', 'fontSize': 48})
        before = copy.deepcopy(document)
        report = helper.audit(document)
        self.assertEqual(document, before)
        self.assertEqual([x['code'] for x in report['findings']], ['local_typography_override'])
        self.assertFalse(report['passed'])

    def test_same_color_case_and_unrelated_position_override_are_allowed(self):
        helper = self.helper()
        document = self.document()
        document['captions']['cues'][0].update(endFrame=700, style={'color': '#FFFFFF', 'bottomPercent': 9})
        self.assertTrue(helper.audit(document)['passed'])

    def test_review_must_have_file_hash_and_real_review_method(self):
        helper = self.helper()
        document = self.document()
        finding = helper.audit(document)['findings'][0]
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'listening.json'
            evidence.write_text(json.dumps({'cue': 'caption-12-1-1', 'review': '连续听审该段'}))
            review = {'findingId': finding['id'], 'method': 'source_srt_comparison',
                      'reason': '共享SRT相同', 'evidencePath': str(evidence),
                      'evidenceSha256': helper.digest(evidence), 'findingSha256': helper.finding_digest(finding)}
            with self.assertRaisesRegex(ValueError, '听审|词级|时间'):
                helper.audit(document, reviews=[review])
            review.update(method='listening', reason='已对原声和上屏边界听审，现场演示保留')
            self.assertTrue(helper.audit(document, reviews=[review])['passed'])
            evidence.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'SHA'):
                helper.audit(document, reviews=[review])

    def test_timing_review_cannot_silently_apply_after_text_or_boundary_changes(self):
        helper = self.helper()
        document = self.document()
        finding = helper.audit(document)['findings'][0]
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'review.json'; evidence.write_text('{}')
            review = {'findingId': finding['id'], 'method': 'listening', 'reason': '已核对原声',
                      'evidencePath': str(evidence), 'evidenceSha256': helper.digest(evidence),
                      'findingSha256': helper.finding_digest(finding)}
            document['captions']['cues'][0]['endFrame'] += 1
            with self.assertRaisesRegex(ValueError, '过期|不一致'):
                helper.audit(document, reviews=[review])

    def test_full_package_executed_captions_cannot_bypass_quality_gate(self):
        from tests.test_package_production import FullPackageTests
        from tools import package_production as production
        fixture = FullPackageTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        fixture.prepare()
        fixture.document['revision'] = 1
        fixture.document['captions'] = {'enabled': True, 'style': {'color': '#ffffff'},
                                        'cues': [{'id': 'bad', 'startFrame': 0, 'endFrame': 180,
                                                  'text': '像这样就像这样念经一样的说话'}]}
        snapshot = Path(fixture.request['projectSnapshotPath'])
        snapshot.write_text(json.dumps({'document': fixture.document}))
        path = Path(fixture.analysis['productionReceiptPaths']['captions'])
        receipt = json.loads(path.read_text())
        receipt.update(status='executed', engineering={'snapshotPath': str(snapshot), 'revision': 1,
                       'instanceIds': [], 'fields': [{'pointer': '/captions',
                                                     'sha256': production.json_digest(fixture.document['captions'])}]})
        receipt['files'].append({'path': str(snapshot), 'sha256': production.digest(snapshot)})
        path.write_text(json.dumps(receipt))
        fixture.analysis['productionDesign']['captions']['decision'] = 'executed'
        with self.assertRaisesRegex(ValueError, '字幕质量'):
            production.validate_full_package(fixture.analysis, fixture.request, fixture.document)

    def test_new_package_request_requires_full_segmentation_review(self):
        from tools import editor_plan_runtime as runtime
        from tests.test_editor_plan import snapshot
        data = snapshot()
        data.pop('workflowMode')
        with tempfile.TemporaryDirectory() as directory:
            request = runtime.prepare_external_job(data, directory)
            self.assertEqual(request.get('captionSegmentationVersion'), 1,
                             '新package必须要求全字幕语义断句复审')
            frozen = json.loads(Path(request['projectSnapshotPath']).read_text())
            self.assertEqual(frozen.get('captionSegmentationVersion'), 1)

    def test_full_package_short_captions_cannot_skip_segmentation_review(self):
        from tests.test_package_production import FullPackageTests
        from tools import package_production as production
        fixture = FullPackageTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        fixture.prepare()
        fixture.request['captionSegmentationVersion'] = 1
        fixture.document['revision'] = 1
        fixture.document['captions'] = {'enabled': True, 'style': {'color': '#ffffff'},
            'cues': [{'id': 'short-merged', 'startFrame': 0, 'endFrame': 60,
                      'text': '悄悄话模式给你看一下'}]}
        snapshot = Path(fixture.request['projectSnapshotPath'])
        snapshot.write_text(json.dumps({'document': fixture.document}))
        path = Path(fixture.analysis['productionReceiptPaths']['captions'])
        receipt = json.loads(path.read_text())
        receipt.update(status='executed', engineering={'snapshotPath': str(snapshot), 'revision': 1,
            'instanceIds': [], 'fields': [{'pointer': '/captions',
                'sha256': production.json_digest(fixture.document['captions'])}]})
        receipt['files'].append({'path': str(snapshot), 'sha256': production.digest(snapshot)})
        path.write_text(json.dumps(receipt))
        fixture.analysis['productionDesign']['captions']['decision'] = 'executed'
        with self.assertRaisesRegex(ValueError, '字幕质量|语义断句'):
            production.validate_full_package(fixture.analysis, fixture.request, fixture.document)
        from tools import caption_quality
        cue = fixture.document['captions']['cues'][0]
        review_path = fixture.root / 'segmentation.json'
        review_path.write_text(json.dumps({'version': 1, 'cues': [{
            'cueId': cue['id'], 'cueSha256': caption_quality.cue_digest(cue),
            'decision': 'split_required', 'reason': '演示引导句尚未拆开'}]}))
        receipt['captionSegmentationReviewPath'] = str(review_path)
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'files/SHA'):
            production.validate_full_package(fixture.analysis, fixture.request, fixture.document)


if __name__ == '__main__':
    unittest.main()
