import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import package_branches as pb
from tests.test_package_branches import result
from tests.test_animation_package import fixture
from tools import animation_package as ap


def proposal(sections):
    return {'schemaVersion': 1, 'branchId': 'bgm', 'items': [], 'reason': '全文按理解负荷审阅',
            'sections': [{'id': s['id'], 'requirementVersion': s['requirementVersion'],
                          'bgmDesign': {'decision': 'music', 'reason': '轻解说维持连续感', 'purpose': 'continuity',
                                        'musicType': '轻节奏器乐', 'texture': '稀疏，无歌词',
                                        'transition': '同曲延续；难点前自然收尾让人声落地', 'recommendationIds': ['r1']}} for s in sections],
            'recommendations': [{'id': 'r1', 'title': 'Cylinder Five', 'artist': 'Chris Zabriskie',
                                 'url': 'https://chriszabriskie.com/cylinders/', 'reason': '轻铺底候选',
                                 'licenseStatus': 'verify_before_use', 'audition': 'not_listened'}]}


def bgm_runner(req, stop):
    value = result(req)
    if req['branchId'] == 'bgm':
        shared = pb.load(req['branchInputPath'])
        sections = shared.get('semantic', shared.get('common', {}))['sections']
        p = Path(value['manifestPath']); pb.atomic_json(p, proposal(sections))
        value['files'][0]['sha256'] = pb.digest(p)
        pb.atomic_json(Path(req['outputRoot'])/'result.json', value)
    return value


class BgmTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.sections = [{'id': 's', 'requirementVersion': 1}]

    def test_request_version_selects_branch_without_breaking_history(self):
        self.assertEqual(pb.branches_for({}), pb.BRANCHES)
        self.assertEqual(pb.branches_for({'bgmPlanVersion': 1}), (*pb.BRANCHES, 'bgm'))
        with self.assertRaises(ValueError): pb.branches_for({'bgmPlanVersion': 2})

    def test_rejects_missing_stale_invalid_and_unbound_recommendations(self):
        from tools.bgm_package import validate_proposal
        valid = proposal(self.sections)
        self.assertEqual(validate_proposal(valid, {'sections': self.sections}), valid)
        mutations = [lambda p: p['sections'].clear(),
                     lambda p: p['sections'][0].update(requirementVersion=2),
                     lambda p: p['recommendations'][0].update(url='javascript:alert(1)'),
                     lambda p: p['sections'][0]['bgmDesign'].update(recommendationIds=['missing']),
                     lambda p: p['recommendations'][0].update(licenseStatus='verified'),
                     lambda p: p['sections'][0]['bgmDesign'].update(startSeconds=1)]
        for mutate in mutations:
            bad = copy.deepcopy(valid); mutate(bad)
            with self.subTest(bad=bad), self.assertRaises(ValueError): validate_proposal(bad, {'sections': self.sections})
        valid['recommendations'] = []; valid['sections'][0]['bgmDesign']['recommendationIds'] = []
        with self.assertRaises(ValueError): validate_proposal(valid, {'sections': self.sections})
        valid['recommendationGaps'] = ['尚未找到可核实来源的曲目']
        validate_proposal(valid, {'sections': self.sections})

    def test_silence_must_be_reviewed_and_can_have_no_recommendations(self):
        from tools.bgm_package import validate_proposal
        p = proposal(self.sections); p['recommendations'] = []
        p['sections'][0]['bgmDesign'] = {'decision': 'silence', 'reason': '连续推理留白', 'recommendationIds': []}
        validate_proposal(p, {'sections': self.sections})
        p['sections'][0]['bgmDesign']['reason'] = ''
        with self.assertRaises(ValueError): validate_proposal(p, {'sections': self.sections})

    def test_transition_replaces_entry_exit_and_roundtrips_without_audio_changes(self):
        from tools.bgm_package import apply_to_plan, validate_proposal
        p = proposal(self.sections)
        b = p['sections'][0]['bgmDesign']
        b['transition'] = '沿用前段同曲，不重起拍；关键判断前自然停乐，让人声落地。'
        validate_proposal(p, {'sections': self.sections})
        plan = {'shots': [{'id': 's', 'requirementVersion': 1}], 'audioClips': [{'id': 'a'}]}
        apply_to_plan(plan, p, {'sections': self.sections})
        self.assertEqual(plan['shots'][0]['bgmDesign']['transition'], b['transition'])
        self.assertEqual(plan['audioClips'], [{'id': 'a'}])
        for invalid in ('', '  ', None, 42):
            b['transition'] = invalid
            b.update(entry='旧进入', exit='旧退出')
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_proposal(p, {'sections': self.sections})

    def test_legacy_entry_and_exit_remain_valid(self):
        from tools.bgm_package import validate_proposal
        p = proposal(self.sections)
        b = p['sections'][0]['bgmDesign']
        del b['transition']
        b.update(entry='旧进入', exit='旧退出')
        validate_proposal(p, {'sections': self.sections})
        del b['exit']
        with self.assertRaises(ValueError): validate_proposal(p, {'sections': self.sections})

    def test_apply_preserves_manual_and_does_not_touch_audio_or_timing(self):
        from tools.bgm_package import apply_to_plan
        p = proposal(self.sections)
        plan = {'shots': [{'id': 's', 'requirementVersion': 1, 'timing': {'ranges': [{'startFrame': 0, 'durationFrames': 90}]}}], 'audioClips': [{'id': 'a'}]}
        original = copy.deepcopy(plan)
        apply_to_plan(plan, p, {'sections': self.sections})
        self.assertEqual(plan['audioClips'], original['audioClips'])
        self.assertEqual(plan['shots'][0]['timing'], original['shots'][0]['timing'])
        self.assertEqual(plan['shots'][0]['bgmDesign']['requirementVersion'], 1)
        self.assertEqual(plan['shots'][0]['upstream']['packageShot']['bgmDesign'], plan['shots'][0]['bgmDesign'])
        plan['shots'][0]['bgmDesign']['reason'] = '我的手调'
        apply_to_plan(plan, p, {'sections': self.sections})
        self.assertEqual(plan['shots'][0]['bgmDesign']['reason'], '我的手调')
        plan['shots'][0]['requirementVersion'] = 2
        with self.assertRaises(ValueError): apply_to_plan(plan, p, {'sections': self.sections})

    def test_versioned_run_scope_and_finalize_load_verified_proposal(self):
        req, semantic, doc = fixture(self.root)
        req.update(runId='r', bgmPlanVersion=1, packageOrchestrationVersion=2,
                   scope={**{b: False for b in pb.BRANCHES},'animation':False,'sound':False})
        semantic['sections'][0]['requirementVersion'] = 1
        request_path = self.root/'request.json'; pb.atomic_json(request_path, req)
        semantic_path = self.root/'semantic.json'; pb.atomic_json(semantic_path, semantic)
        state = pb.run_branches(request_path, semantic_path, runner=bgm_runner, slot_root=self.root/'slots')
        self.assertIn('bgm', state['branches'])
        self.assertEqual(state['branches']['bgm']['status'], 'complete')
        finalized = ap.finalize(req, semantic_path)
        plan = finalized['results'][0]['plan']
        self.assertEqual(plan['bgmPlanVersion'], 1)
        self.assertEqual(plan['shots'][0]['bgmDesign']['purpose'], 'continuity')
        self.assertEqual(plan['bgmRecommendations'][0]['artist'], 'Chris Zabriskie')
        self.assertFalse(any(r['kind'] == 'sound' for r in finalized['results']))
        req['scope']['bgm'] = False; pb.atomic_json(request_path, req)
        state = pb.run_branches(request_path, semantic_path, runner=bgm_runner, slot_root=self.root/'slots')
        self.assertEqual(state['branches']['bgm']['status'], 'skipped')
        self.assertNotIn('bgmPlanVersion', ap.finalize(req, semantic_path)['results'][0]['plan'])

    def test_v2_bgm_is_validated_then_published_in_final_plan(self):
        req, semantic, doc = fixture(self.root)
        semantic['sections'][0]['animationNeed'] = 'none'
        req.update(runId='r', bgmPlanVersion=1, packageOrchestrationVersion=2,
                   scope={**{b: False for b in pb.BRANCHES},'animation':False,'sound':False})
        semantic['sections'][0]['requirementVersion'] = 1
        rp = self.root/'request.json'; sp = self.root/'semantic.json'
        pb.atomic_json(rp, req); pb.atomic_json(sp, semantic)
        state = pb.run_branches(rp, sp, runner=bgm_runner, slot_root=self.root/'slots')
        self.assertEqual(state['status'], 'complete', state)
        branch = state['branches']['bgm']
        gate = pb.load(branch['validation']['receiptPath'])
        self.assertEqual(gate['status'], 'passed')
        self.assertEqual(gate['operations'], [])
        self.assertEqual(gate['writeSet'], [])
        self.assertEqual(pb.validate_branch_run(req, self.root/'package-branches.json')['status'], 'complete')
        self.assertEqual(ap.finalize(req, sp)['results'][0]['plan']['bgmPlanVersion'], 1)

    def test_missing_review_fails_bgm_worker_and_legacy_branches_stay_skipped(self):
        req, semantic, _ = fixture(self.root)
        req.update(runId='r', bgmPlanVersion=1, packageOrchestrationVersion=2,
                   scope={**{b: False for b in pb.BRANCHES},'animation':False,'sound':False})
        semantic['sections'][0]['requirementVersion'] = 1
        rp = self.root/'request.json'; sp = self.root/'semantic.json'
        pb.atomic_json(rp, req); pb.atomic_json(sp, semantic)
        state = pb.run_branches(rp, sp, runner=lambda req, stop: result(req), slot_root=self.root/'slots')
        self.assertEqual(state['status'], 'partial')
        self.assertEqual(state['branches']['bgm']['status'], 'failed')
        with self.assertRaises(ValueError): pb.validate_branch_run(req, self.root/'package-branches.json')
        self.assertTrue(all(state['branches'][b]['status'] == 'skipped' for b in pb.BRANCHES))

    def test_finalize_rejects_plan_version_changed_after_frozen_review(self):
        req, semantic, doc = fixture(self.root)
        old, _, _ = ap.build_plan(semantic, req, doc)
        old['shots'][0]['narration'] = '上次已经不同的口播'
        doc['productionPlan'] = old
        pb.atomic_json(req['projectSnapshotPath'], {'document': doc})
        req.update(runId='r', bgmPlanVersion=1, packageOrchestrationVersion=2,
                   scope={**{b: False for b in pb.BRANCHES},'animation':False,'sound':False})
        semantic['sections'][0]['requirementVersion'] = 1
        rp = self.root/'request.json'; sp = self.root/'semantic.json'
        pb.atomic_json(rp, req); pb.atomic_json(sp, semantic)
        pb.run_branches(rp, sp, runner=bgm_runner, slot_root=self.root/'slots')
        with self.assertRaisesRegex(ValueError, 'final plan requirementVersion'):
            ap.finalize(req, sp)

    def test_bgm_projection_ignores_unrelated_visual_assets_and_keeps_manual_design(self):
        from tools.package_branch_inputs import build_branch_input
        req = {'projectId': 'p', 'script': '完整文本', 'document': {
            'source': {'path': '/nonexistent/video.mp4', 'clips': []},
            'productionPlan': {'shots': [{'id': 's', 'requirementVersion': 1,
                'bgmDesign': {'decision': 'silence', 'reason': '手调', 'manual': True},
                'upstream': {'other': {'path': '/nonexistent/irrelevant.json'}}}]}}}
        bundle = build_branch_input(req, {'sections': self.sections}, 'bgm')
        self.assertNotIn('path', bundle['input']['source'])
        self.assertTrue(bundle['input']['bgmPlan']['shots'][0]['bgmDesign']['manual'])
        self.assertNotIn('other', bundle['input']['bgmPlan']['shots'][0].get('upstream', {}))

    def test_protected_recommendation_id_collision_cannot_retarget_new_segments(self):
        from tools.bgm_package import apply_to_plan
        sections = [*self.sections, {'id': 's2', 'requirementVersion': 1}]
        p = proposal(sections)
        old = copy.deepcopy(p['recommendations'][0]); old.update(title='用户旧曲', artist='原作者')
        plan = {'shots': [{'id': 's', 'requirementVersion': 1, 'bgmDesign': {
                    'decision': 'music', 'manual': True, 'recommendationIds': ['r1']}},
                         {'id': 's2', 'requirementVersion': 1}], 'bgmRecommendations': [old]}
        apply_to_plan(plan, p, {'sections': sections})
        recommendations = {r['id']: r for r in plan['bgmRecommendations']}
        self.assertEqual(recommendations['r1']['title'], '用户旧曲')
        new_id = plan['shots'][1]['bgmDesign']['recommendationIds'][0]
        self.assertNotEqual(new_id, 'r1')
        self.assertEqual(recommendations[new_id]['title'], 'Cylinder Five')

    def test_v2_final_bgm_does_not_require_streaming_application_ack(self):
        req, semantic, _ = fixture(self.root)
        semantic['sections'][0]['animationNeed'] = 'none'
        semantic['sections'][0]['requirementVersion'] = 1
        semantic['sections'][0]['bgmDesign'] = {'decision': 'music', 'reason': '未经验证的主控建议'}
        req.update(runId='r', bgmPlanVersion=1, packageOrchestrationVersion=2,
                   scope={**{b: False for b in pb.BRANCHES}, 'animation': False, 'sound': False})
        rp = self.root/'request.json'; sp = self.root/'semantic.json'
        pb.atomic_json(rp, req); pb.atomic_json(sp, semantic)
        state = pb.run_branches(rp, sp, runner=bgm_runner, slot_root=self.root/'slots')
        state['branches']['bgm']['application'] = {'status': 'waiting_dependencies'}
        pb.atomic_json(self.root/'package-branches.json', state)
        with patch('tools.package_branch_publication.refresh_application_state', return_value=None):
            finalized = ap.finalize(req, sp)
        self.assertEqual(finalized['state'], 'complete', finalized['issues'])
        design = finalized['results'][0]['plan']['shots'][0]['bgmDesign']
        self.assertEqual(design['reason'], '轻解说维持连续感')
        self.assertFalse(any('尚未真实应用: bgm' in row['reason'] for row in finalized['issues']))
        self.assertEqual(pb.load(self.root/'package-branches.json')['branches']['bgm']['application']['status'], 'waiting_dependencies')

if __name__ == '__main__': unittest.main()
