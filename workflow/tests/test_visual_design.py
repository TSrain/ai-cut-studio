import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.package_contract import PackageContractError, design_digest, normalize_package_document, validate_package_design


def example():
    return {
        'coverage': 'hybrid', 'designIntentVersion': 1,
        'shots': [{
            '镜号': 1, '锚点口播': '先试跑，再修改，最后正式生成。',
            '功能': '解释', '形式': '🤖动效', '动作': '流程', '必要性': '说明修订反馈',
            '理想画面': '输入试跑后回流修改再输出', '创意方案': '同一对象经过反馈路径',
            '素材路由': {'route': '个人素材', 'source': '示意图', 'status': 'planned', 'higherPriority': {}},
            'presetCandidates': ['step-flow'], 'selectedPreset': None,
            'unmatchedReason': '线性流程无法表达反馈',
            'designIntent': {
                'goal': '理解为何先试跑', 'concept': '同一提示词沿反馈路径修订',
                'states': {'start': '输入出现', 'change': '试跑后回流', 'end': '修订后输出'},
                'beats': [{'id': 'trial', 'anchor': '先试跑', 'action': '进入试跑'},
                          {'id': 'revise', 'anchor': '再修改', 'action': '原对象重排'}],
                'focus': '同一提示词', 'presenterRelation': '右侧真人，底部字幕',
                'templateOptions': [{'presetId': 'step-flow', 'fit': '流程节点', 'gaps': ['缺少反馈']}],
                'customOption': {'approach': '复用卡片定制路径', 'benefit': '解释反馈', 'cost': '多对象联动'},
                'recommendation': {'route': 'component-custom', 'reason': '语义需要反馈'},
                'acceptance': ['反馈与口播同步'], 'risks': []
            }
        }]
    }


class VisualDesignTest(unittest.TestCase):
    def test_complete_design_is_valid_and_normalization_preserves_it(self):
        doc = example()
        validate_package_design(doc)
        self.assertEqual(normalize_package_document(doc), doc)

    def test_rejects_missing_end_state_and_missing_design(self):
        for change in ('end', 'all'):
            doc = example()
            if change == 'end':
                del doc['shots'][0]['designIntent']['states']['end']
            else:
                del doc['shots'][0]['designIntent']
            with self.subTest(change=change), self.assertRaisesRegex(PackageContractError, 'designIntent'):
                validate_package_design(doc)

    def test_requires_explicit_supported_version(self):
        for version in (None, True, 2):
            doc = example()
            doc['designIntentVersion'] = version
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, 'designIntentVersion'):
                validate_package_design(doc)

    def test_rejects_invented_or_reordered_spoken_beats(self):
        for anchors in (['编造口播', '再修改'], ['再修改', '先试跑']):
            doc = example()
            for beat, anchor in zip(doc['shots'][0]['designIntent']['beats'], anchors):
                beat['anchor'] = anchor
            with self.subTest(anchors=anchors), self.assertRaisesRegex(ValueError, 'anchor'):
                validate_package_design(doc)

    def test_rejects_template_route_that_cannot_fit_the_design(self):
        doc = example()
        shot = doc['shots'][0]
        shot['designIntent']['recommendation']['route'] = 'preset'
        shot['selectedPreset'] = 'step-flow'
        with self.assertRaisesRegex(ValueError, 'gaps'):
            validate_package_design(doc)

    def test_rejects_template_candidates_not_present_in_comparison(self):
        doc = example()
        doc['shots'][0]['presetCandidates'].append('another-preset')
        with self.assertRaisesRegex(ValueError, 'presetCandidates'):
            validate_package_design(doc)

    def test_design_changes_and_removal_invalidate_approval_digest(self):
        original = example()
        for field in ('states', 'templateOptions', 'recommendation', 'remove'):
            doc = copy.deepcopy(original)
            intent = doc['shots'][0]['designIntent']
            if field == 'states':
                intent['states']['end'] = '改为全屏文字'
            elif field == 'templateOptions':
                intent['templateOptions'][0]['gaps'] = []
            elif field == 'recommendation':
                intent['recommendation']['route'] = 'custom'
            else:
                del doc['shots'][0]['designIntent']
                del doc['designIntentVersion']
            with self.subTest(field=field):
                self.assertNotEqual(design_digest(original), design_digest(doc))

    def test_legacy_and_pure_footage_do_not_require_design(self):
        doc = example()
        del doc['shots'][0]['designIntent']
        del doc['designIntentVersion']
        validate_package_design(doc)
        self.assertEqual(design_digest(doc), '0b54bd048f551ac9c4a579804038614abc1fe59e2782c813a14199aaf0e1a66b')
        doc['designIntentVersion'] = 1
        doc['shots'][0]['形式'] = '✋录屏'
        validate_package_design(doc)

    def test_selected_template_is_approval_significant_for_new_documents(self):
        doc = example()
        original = design_digest(doc)
        doc['shots'][0]['selectedPreset'] = 'step-flow'
        self.assertNotEqual(original, design_digest(doc))

    def test_returned_contract_cannot_drop_or_rewrite_design(self):
        from tools.dispatch_motion_broll import collect_keyframe_outputs
        for change in ('missing', 'rewrite', 'version', 'duplicate'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                doc = example()
                contract = {'designIntentVersion': 1, 'shots': [{
                    'id': 'shot-001', 'designIntent': copy.deepcopy(doc['shots'][0]['designIntent']),
                    'presetCandidates': ['step-flow'], 'selectedPreset': None
                }]}
                if change == 'missing':
                    del contract['shots'][0]['designIntent']
                elif change == 'rewrite':
                    contract['shots'][0]['designIntent']['states']['end'] = '只剩三个标签'
                elif change == 'version':
                    del contract['designIntentVersion']
                else:
                    contract['shots'] *= 2
                (root / 'shots.json').write_text(json.dumps(doc))
                (root / 'visual-contract.json').write_text(json.dumps(contract))
                (root / 'keyframes').mkdir()
                (root / 'keyframes' / 'shot-001.png').write_bytes(b'fixture-only')
                with self.assertRaisesRegex(ValueError, 'designIntent|重复'):
                    collect_keyframe_outputs(root)

    def test_complete_returned_design_accepts_normalized_shot_ids(self):
        from tools.package_contract import validate_design_binding
        doc = example()
        shot = doc['shots'][0]
        contract = {'designIntentVersion': 1, 'shots': [{
            'id': 'shot-001', **{key: copy.deepcopy(shot[key]) for key in
                                ('designIntent', 'presetCandidates', 'selectedPreset')}
        }]}
        validate_design_binding(doc, contract)
        contract['shots'][0]['resolvedBeatFrames'] = {'trial': 40, 'revise': 120}
        validate_design_binding(doc, contract)

    def test_dispatch_source_media_mutation_fails_with_receipt(self):
        from tools.dispatch_motion_broll import dispatch, digest
        from subprocess import CompletedProcess
        for field in ('sourceVideo', 'sourceSrtPath'):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                doc = example()
                doc[field] = '/approved/source'
                shots = root / 'shots.json'
                shots.write_text(json.dumps(doc))
                source_sha = digest(shots)
                brief = root / 'brief.md'
                brief.write_text('test')
                def child(command, **kwargs):
                    changed = copy.deepcopy(doc)
                    changed[field] = '/different/source'
                    shots.write_text(json.dumps(changed))
                    self._write_dispatch_outputs(root, doc)
                    return CompletedProcess(command, 0, '', '')
                with patch('tools.dispatch_motion_broll.subprocess.run', side_effect=child):
                    with self.assertRaisesRegex(RuntimeError, 'source shots'):
                        dispatch(brief, root)
                receipt = json.loads((root / 'motion-execution-receipt.json').read_text())
                self.assertEqual(receipt['state'], 'failed')
                self.assertEqual(receipt['sourceShotsSha256'], source_sha)
                self.assertEqual(receipt['sourceShotsPath'], str(shots.resolve()))

    @staticmethod
    def _write_dispatch_outputs(root, doc):
        shot = doc['shots'][0]
        contract = {'designIntentVersion': 1, 'shots': [{
            'id': 'shot-001', **{key: copy.deepcopy(shot[key]) for key in
                                ('designIntent', 'presetCandidates', 'selectedPreset')}
        }]}
        (root / 'visual-contract.json').write_text(json.dumps(contract))
        (root / 'keyframes').mkdir()
        (root / 'keyframes' / 'shot-001.png').write_bytes(b'fixture-only')

    def test_dispatch_unchanged_source_succeeds_and_records_snapshot(self):
        from tools.dispatch_motion_broll import dispatch, digest
        from subprocess import CompletedProcess
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = example()
            shots = root / 'shots.json'
            shots.write_text(json.dumps(doc))
            brief = root / 'brief.md'
            brief.write_text('test')
            def child(command, **kwargs):
                self.assertIn('shots.json 为只读', command[-1])
                self._write_dispatch_outputs(root, doc)
                return CompletedProcess(command, 0, '', '')
            with patch('tools.dispatch_motion_broll.subprocess.run', side_effect=child):
                receipt = json.loads(dispatch(brief, root).read_text())
            self.assertEqual(receipt['state'], 'succeeded')
            self.assertEqual(receipt['sourceShotsSha256'], digest(shots))
            self.assertEqual(receipt['sourceShotsPath'], str(shots.resolve()))

    def test_dispatch_rejects_unknown_template_before_starting_child_process(self):
        from tools.dispatch_motion_broll import dispatch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = example()
            doc['shots'][0]['presetCandidates'] = ['invented-template']
            doc['shots'][0]['designIntent']['templateOptions'][0]['presetId'] = 'invented-template'
            (root / 'shots.json').write_text(json.dumps(doc))
            brief = root / 'brief.md'
            brief.write_text('test')
            with patch('tools.dispatch_motion_broll.subprocess.run', side_effect=AssertionError('未知模板不应启动渲染')) as child:
                with self.assertRaisesRegex(ValueError, '当前模板目录'):
                    dispatch(brief, root)
                child.assert_not_called()


if __name__ == '__main__':
    unittest.main()
