import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from tools import animation_package as ap

try:
    from tools import ai_video_package as ai
except ImportError:
    ai = None


class AIVideoPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.ref1 = self.root / 'first.png'
        self.ref2 = self.root / 'second.jpg'
        # Tiny actual PNG files are sufficient: this contract checks file identity,
        # while generation tools and media recognition handle image decoding.
        self.ref1.write_bytes(b'\x89PNG\r\n\x1a\nfirst')
        self.ref2.write_bytes(b'\xff\xd8\xffsecond')
        srt = self.root / 'raw.srt'
        srt.write_text('1\n00:00:00,000 --> 00:00:03,000\n工具降低执行成本\n\n2\n00:00:03,000 --> 00:00:06,000\n经验仍然影响判断\n')
        script = self.root / 'final.md'
        script.write_text('工具降低执行成本经验仍然影响判断')
        self.doc = {'id': 'p', 'canvas': {'width': 1080, 'height': 1920, 'fps': 30, 'durationFrames': 180},
                    'source': {'path': 'video.mov', 'clips': [{'id': 'main', 'startFrame': 0, 'durationFrames': 180, 'sourceInFrame': 0}]},
                    'instances': [], 'productionPlan': {'shots': []}}
        self.request = {'projectId': 'p', 'jobId': 'j', 'sourceSrtPath': str(srt), 'finalScriptPath': str(script),
                        'videoPath': None, 'canvas': self.doc['canvas'], 'projectSnapshotPath': str(self.root / 'snapshot.json'),
                        'outputRoot': str(self.root), 'packageRoot': str(self.root / 'package'),
                        'resultManifestPath': str(self.root / 'result-manifest.json')}
        self.section = {'id': 's', 'title': '成本与判断', 'narration': script.read_text(), 'sourceCueIds': [1, 2],
                        'animationNeed': 'none', 'goal': '区分执行与判断', 'information': ['执行成本下降'],
                        'relations': ['工具不能代替判断'], 'boundaries': ['生成画面仅为示意'], 'reason': '保留真人',
                        'templateMatch': {'status': 'none', 'reason': '不强套模板', 'gaps': []}}
        self.candidate = {'id': 'ai-s-1', 'title': '工具执行的示意', 'prompt': '图1是人物参考；图2是场景参考。人物在桌前操作工具。',
                          'promptVersion': 1, 'requirementVersion': 1, 'sourceCueIds': [1], 'reason': '辅助理解执行过程',
                          'aspectRatio': '9:16', 'durationSeconds': 5,
                          'references': [{'path': str(self.ref2), 'label': '场景', 'purpose': '空间关系'},
                                         {'path': str(self.ref1), 'label': '人物', 'purpose': '人物外观'}]}
        self.write_snapshot()

    def write_snapshot(self):
        Path(self.request['projectSnapshotPath']).write_text(json.dumps({'document': self.doc}))

    def analysis(self):
        return {'schemaVersion': 1, 'workflowMode': ap.MODE, 'projectId': 'p', 'sourceSrtPath': self.request['sourceSrtPath'],
                'sourceVideoPath': None, 'sections': [copy.deepcopy(self.section)]}

    def validate(self, candidates, section=None):
        self.assertIsNotNone(ai, 'AI 视频候选合同模块必须存在')
        return ai.validate_candidates(candidates, self.request, section or self.section)

    def test_valid_candidates_have_ordered_real_references_and_illustration_role(self):
        source = copy.deepcopy(self.candidate)
        result = self.validate([source])[0]
        self.assertEqual([r['path'] for r in result['references']], [str(self.ref2), str(self.ref1)])
        self.assertEqual(result['references'][0]['sha256'], hashlib.sha256(self.ref2.read_bytes()).hexdigest())
        self.assertEqual(result['evidenceRole'], 'illustration')
        self.assertNotIn('sha256', source['references'][0], 'validation must not mutate a frozen input')

    def test_absent_ai_need_accepts_empty_candidates(self):
        self.assertEqual(self.validate([]), [])

    def test_candidate_requires_all_business_fields(self):
        for key in ('id', 'title', 'prompt', 'promptVersion', 'requirementVersion', 'sourceCueIds', 'reason', 'aspectRatio', 'durationSeconds', 'references'):
            with self.subTest(key=key):
                candidate = copy.deepcopy(self.candidate)
                candidate.pop(key)
                with self.assertRaises(ValueError):
                    self.validate([candidate])

    def test_rejects_duplicate_ids_and_blank_prompt(self):
        with self.assertRaisesRegex(ValueError, 'ID|标识|重复'):
            self.validate([self.candidate, self.candidate])
        candidate = dict(self.candidate, prompt='  ')
        with self.assertRaisesRegex(ValueError, 'prompt|提示词'):
            self.validate([candidate])

    def test_rejects_illegal_cues_and_non_positive_versions(self):
        for update in ({'sourceCueIds': [3]}, {'sourceCueIds': [2, 1]}, {'sourceCueIds': [True]},
                       {'sourceCueIds': []}, {'promptVersion': 0}, {'promptVersion': True}, {'requirementVersion': '1'}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.validate([dict(self.candidate, **update)])

    def test_requires_real_srt_for_ai_cue_binding(self):
        self.request['sourceSrtPath'] = None
        with self.assertRaisesRegex(ValueError, 'SRT|cue'):
            self.validate([self.candidate])

    def test_rejects_missing_and_changed_reference_files(self):
        candidate = copy.deepcopy(self.candidate)
        candidate['references'][0]['path'] = str(self.root / 'missing.png')
        with self.assertRaisesRegex(ValueError, '参考|reference'):
            self.validate([candidate])
        candidate = copy.deepcopy(self.candidate)
        candidate['references'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'SHA|hash'):
            self.validate([candidate])

    def test_rejects_proof_role_and_network_candidate_identity(self):
        for update in ({'evidenceRole': 'proof'}, {'usage': 'evidence'}, {'candidateId': 'stock-1'}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.validate([dict(self.candidate, **update)])

    def test_rejects_invalid_ratio_duration_or_reference_metadata(self):
        for update in ({'aspectRatio': 'auto'}, {'aspectRatio': '0:16'}, {'durationSeconds': float('nan')},
                       {'durationSeconds': 0}, {'durationSeconds': True}, {'references': [{'path': str(self.ref1)}]}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.validate([dict(self.candidate, **update)])

    def test_candidate_binds_explicit_section_requirement(self):
        with self.assertRaisesRegex(ValueError, 'requirementVersion|需求版本'):
            self.validate([self.candidate], dict(self.section, requirementVersion=2))

    def test_prompt_edit_or_reference_reorder_requires_new_prompt_version(self):
        previous = self.validate([self.candidate])[0]
        self.doc['productionPlan']['shots'] = [{'id': 's', 'aiVideoCandidates': [previous]}]
        self.write_snapshot()
        for update in ({'prompt': '新的画面说明'}, {'references': list(reversed(self.candidate['references']))}, {'requirementVersion': 2}):
            with self.subTest(update=update), self.assertRaisesRegex(ValueError, 'promptVersion|提示词版本'):
                self.validate([dict(self.candidate, **update)])
        result = self.validate([dict(self.candidate, prompt='新的画面说明', promptVersion=2)])
        self.assertEqual(result[0]['promptVersion'], 2)

    def test_semantic_validation_and_plan_preserve_candidates_without_creating_media(self):
        data = self.analysis()
        data['sections'][0]['aiVideoCandidates'] = [self.candidate]
        validated = ap.validate_analysis(data, self.request)
        plan, templates, issues = ap.build_plan(validated, self.request, self.doc)
        self.assertEqual(plan['shots'][0]['aiVideoCandidates'][0]['prompt'], self.candidate['prompt'])
        self.assertEqual(plan['shots'][0]['sourceCueIds'], [1, 2])
        self.assertEqual(templates, [])
        self.assertEqual(issues, [])
        self.assertEqual(plan['shots'][0]['bindings'], [])
        self.assertEqual(plan['shots'][0]['slots'], [], 'AI prompt proposals do not create editable media slots')

    def test_ai_proposal_alone_does_not_advance_existing_semantic_version(self):
        data = self.analysis()
        previous, _, _ = ap.build_plan(data, self.request, self.doc)
        self.doc['productionPlan'] = previous
        self.write_snapshot()
        data['sections'][0]['aiVideoCandidates'] = [self.candidate]
        plan, _, _ = ap.build_plan(data, self.request, self.doc)
        self.assertEqual(plan['shots'][0]['requirementVersion'], 1)
        self.assertEqual(plan['shots'][0]['slots'], [])

    def test_plan_rejects_candidate_for_old_requirement_after_change(self):
        data = self.analysis()
        data['sections'][0]['aiVideoCandidates'] = [dict(self.candidate, requirementVersion=4)]
        self.doc['productionPlan']['shots'] = [{'id': 's', 'requirementVersion': 4, 'visualRequirement': '旧目标',
                                               'slots': [], 'bindings': [], 'narration': self.section['narration']}]
        with self.assertRaisesRegex(ValueError, 'requirementVersion|需求版本'):
            ap.build_plan(data, self.request, self.doc)
        data['sections'][0]['aiVideoCandidates'][0]['requirementVersion'] = 5
        plan, _, _ = ap.build_plan(data, self.request, self.doc)
        self.assertEqual(plan['shots'][0]['requirementVersion'], 5)
        self.assertEqual(plan['shots'][0]['aiVideoCandidates'][0]['requirementVersion'], 5)

    def test_finalize_hashes_references_and_places_ai_report_before_claude(self):
        data = self.analysis()
        data['sections'][0]['aiVideoCandidates'] = [self.candidate]
        path = self.root / 'analysis.json'
        path.write_text(json.dumps(data, ensure_ascii=False))
        manifest = ap.finalize(self.request, path)
        references = [f for f in manifest['files'] if f['role'] == 'ai-video-reference']
        self.assertEqual([f['path'] for f in references], [str(self.ref2), str(self.ref1)])
        self.assertTrue(all(f['sha256'] == ap.digest(f['path']) for f in references))
        report = Path(manifest['outputs']['planPath']).read_text()
        self.assertLess(report.index('## AI 视频候选与提示词'), report.index('## 给 Claude 的动画提示词'))
        self.assertTrue(report.endswith(ap.render_claude_prompt(data, self.request)))
        self.assertIn('图1', report)
        self.assertIn('尚未生成', report)
        self.assertEqual([r['kind'] for r in manifest['results']], ['plan'])

    def test_report_preserves_prompt_reference_upload_order_and_empty_need(self):
        self.assertIsNotNone(ai, 'AI 视频候选合同模块必须存在')
        sections = [dict(self.section, aiVideoCandidates=self.validate([self.candidate]))]
        report = ai.render_ai_video_report(sections)
        self.assertLess(report.index(str(self.ref2)), report.index(str(self.ref1)))
        self.assertIn(self.candidate['prompt'], report)
        self.assertIn('仅作示意', report)
        self.assertIn('无 AI 视频候选', ai.render_ai_video_report([self.section]))

    def run_branches(self, data, failed_branch=None):
        from tools import package_branches as branches
        self.request.update(packageOrchestrationVersion=2, runId='run-ai-test',scope={'templates':False,'footage':False,'captions':False,'cover':True,'camera':False,'sound':False,'animation':False})
        request_path = self.root / 'external-job.json'
        request_path.write_text(json.dumps(self.request))
        baseline = self.root / 'semantic-baseline.json'
        baseline.write_text(json.dumps(data))

        def runner(req, stop):
            if req['branchId'] == failed_branch:
                raise RuntimeError('proposal test failure')
            root = Path(req['outputRoot'])
            proposal = root / 'proposal.json'
            proposal.write_text(json.dumps({'schemaVersion': 1, 'branchId': req['branchId'], 'items': [], 'reason': '无需新增', 'decision':'leave_blank', 'reviewedSections':[s['id'] for s in data['sections']]} ))
            report = root / 'report.md'
            report.write_text('当前专项无需新增，保留手动素材。')
            result = {key: req[key] for key in ('projectId', 'runId', 'branchId', 'attemptId', 'inputFingerprint', 'dependencies')}
            result.update(status='complete', manifestPath=str(proposal), reportPath=str(report),
                          files=[{'path': str(p), 'sha256': ap.digest(p)} for p in (proposal, report)],
                          proposedChanges=[], acceptance={'applied': False, 'technical': 'not_run', 'viewed': False, 'listened': False}, gaps=[])
            (root / 'result.json').write_text(json.dumps(result))
            return result

        return branches.run_branches(request_path, baseline, runner=runner, slot_root=self.root / 'slots')

    def test_orchestrated_finalize_requires_verified_branch_run(self):
        data = self.analysis()
        self.request.update(packageOrchestrationVersion=2, runId='run-ai-test')
        path = self.root / 'analysis.json'
        path.write_text(json.dumps(data))
        with self.assertRaises((ValueError, OSError)):
            ap.finalize(self.request, path)

    def test_orchestrated_finalize_binds_branch_run_files_and_preserves_baseline(self):
        data = self.analysis()
        state = self.run_branches(data)
        path = self.root / 'final-analysis.json'
        path.write_text(json.dumps(data))
        manifest = ap.finalize(self.request, path)
        branch_path = self.root / 'package-branches.json'
        self.assertEqual(manifest['outputs']['packageBranchesPath'], str(branch_path))
        hashes = {row['path']: row['sha256'] for row in manifest['files']}
        for file in (str(branch_path), state['sharedInputPath'], state['branches']['aiVideo']['executionPath'],
                     state['branches']['aiVideo']['reportPath'], str(self.root / 'semantic-baseline.json')):
            self.assertEqual(hashes[file], ap.digest(file))
        self.assertEqual(manifest['state'], 'complete')

    def test_partial_branch_run_cannot_be_reported_complete(self):
        from tools import package_production as production
        data = self.analysis()
        self.request.update(fullPackageVersion=1, runId='run-ai-test')
        data.update(fullPackageVersion=1, runId='run-ai-test', productionDesign={}, productionReceiptPaths={})
        for name in production.BRANCHES:
            report = self.root / (name + '-review.md')
            report.write_text('本轮已审阅，保留真人和现有手调，无新增收益。')
            receipt = {'schemaVersion': 1, 'branch': name, 'runId': 'run-ai-test', 'projectId': 'p',
                       'sourceVideoSha256': None, 'canvas': self.request['canvas'], 'status': 'leave_blank',
                       'rationale': '本轮已审全文，无新增收益', 'protected': ['保留手调'],
                       'files': [{'path': str(report), 'sha256': ap.digest(report)}],
                       'acceptance': {'technical': 'not_applicable', 'visual': 'not_performed', 'listening': 'not_performed'}}
            receipt_path = self.root / (name + '-receipt.json')
            receipt_path.write_text(json.dumps(receipt))
            data['productionDesign'][name] = {'decision': 'leave_blank', 'reason': receipt['rationale']}
            data['productionReceiptPaths'][name] = str(receipt_path)
        checked = production.validate_full_package(data, self.request, self.doc)
        self.assertEqual(checked['state'], 'complete')
        self.assertEqual(checked['issues'], [])
        state = self.run_branches(data, failed_branch='aiVideo')
        path = self.root / 'final-analysis.json'
        path.write_text(json.dumps(data))
        manifest = ap.finalize(self.request, path)
        self.assertEqual(manifest['state'], 'partial')
        self.assertTrue(any('branch' in issue['reason'] or '专项' in issue['reason'] for issue in manifest['issues']))
        self.assertTrue(any(file['path'] == state['branches']['cover']['executionPath'] for file in manifest['files']))

    def test_branch_header_cannot_hide_failed_ai_proposal(self):
        data = self.analysis()
        state = self.run_branches(data, failed_branch='aiVideo')
        state['status'] = 'complete'
        (self.root / 'package-branches.json').write_text(json.dumps(state))
        path = self.root / 'final-analysis.json'
        path.write_text(json.dumps(data))
        manifest = ap.finalize(self.request, path)
        self.assertEqual(manifest['state'], 'partial')
        self.assertTrue(any('aiVideo' in issue['reason'] for issue in manifest['issues']))


if __name__ == '__main__':
    unittest.main()
