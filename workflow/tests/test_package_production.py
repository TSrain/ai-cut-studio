import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from tools import animation_package as ap
from tests.test_animation_package import fixture


class FullPackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.request, self.analysis, self.document = fixture(self.root)
        self.request.update(fullPackageVersion=1, runId='run-1')
        self.analysis.update(fullPackageVersion=1, runId='run-1')

    def prepare(self):
        from tools import package_production as pp
        self.analysis['productionDesign'] = {}
        self.analysis['productionReceiptPaths'] = {}
        for branch in pp.BRANCHES:
            report = self.root / (branch + '.md')
            report.write_text('本轮审阅：无需新增，当前表达已清晰。')
            receipt = dict(schemaVersion=1, branch=branch, runId='run-1', projectId='p',
                           sourceVideoSha256=None, canvas=self.request['canvas'], status='leave_blank',
                           rationale='本轮已审全文，新增会分散注意力', protected=['保留用户手调'],
                           files=[{'path': str(report), 'sha256': pp.digest(report)}],
                           acceptance={'technical': 'not_applicable', 'visual': 'not_performed', 'listening': 'not_performed'})
            path = self.root / (branch + '-receipt.json')
            path.write_text(json.dumps(receipt))
            self.analysis['productionDesign'][branch] = {'decision': 'leave_blank', 'reason': receipt['rationale']}
            self.analysis['productionReceiptPaths'][branch] = str(path)

    def finalize(self):
        path = self.root / 'analysis.json'
        path.write_text(json.dumps(self.analysis))
        from tools import package_branches as pb
        self.request['scope'] = {**{b:False for b in pb.BRANCHES},'sound':False,'animation':False}
        request_path=self.root/'request.json';pb.atomic_json(request_path,self.request)
        pb.run_branches(request_path,path,slot_root=self.root/'slots')
        return ap.finalize(self.request, path)

    def test_full_package_cannot_complete_with_only_templates_and_prompt(self):
        with self.assertRaisesRegex(ValueError, 'productionDesign|完整制作'):
            self.finalize()

    def test_full_package_missing_version_requires_branch_run(self):
        self.prepare()
        path=self.root/'analysis.json';path.write_text(json.dumps(self.analysis))
        with self.assertRaises((ValueError,OSError)):
            ap.finalize(self.request,path)

    def test_retired_package_finalize_fails_before_reading_inputs(self):
        self.request['packageOrchestrationVersion']=1
        with self.assertRaisesRegex(ValueError,'packageOrchestrationVersion=1 已下线'):
            ap.finalize(self.request,self.root/'missing.json')

    def test_reviewed_leave_blank_keeps_full_summary_and_unique_last_prompt(self):
        self.prepare()
        result = self.finalize()
        self.assertEqual(result['fullPackageVersion'], 1)
        self.assertEqual(result['state'], 'complete')
        persisted = json.loads(Path(result['outputs']['productionPlanPath']).read_text())
        self.assertEqual(persisted['upstream']['completePackage']['runId'], 'run-1')
        summary = Path(result['outputs']['planPath']).read_text()
        self.assertIn('本轮完整制作职责', summary)
        self.assertEqual(summary.count('## 给 Claude 的动画提示词'), 1)
        self.assertTrue(summary.endswith(ap.render_claude_prompt(self.analysis, self.request)))

    def test_receipts_cannot_be_old_results_or_missing_artifacts(self):
        self.prepare()
        path = Path(self.analysis['productionReceiptPaths']['camera'])
        receipt = json.loads(path.read_text()); receipt['runId'] = 'historical'
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'runId|本轮'):
            self.finalize()
        receipt['runId'] = 'run-1'; receipt['files'][0]['sha256'] = '0' * 64
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'SHA'):
            self.finalize()

    def test_executed_camera_requires_real_engineering_readback(self):
        self.prepare()
        path = Path(self.analysis['productionReceiptPaths']['camera'])
        receipt = json.loads(path.read_text()); receipt['status'] = 'executed'
        self.analysis['productionDesign']['camera']['decision'] = 'executed'
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, '工程回读'):
            self.finalize()

    def test_executed_cover_cannot_be_only_a_text_report(self):
        self.prepare()
        path = Path(self.analysis['productionReceiptPaths']['cover'])
        receipt = json.loads(path.read_text()); receipt['status'] = 'executed'
        path.write_text(json.dumps(receipt))
        self.analysis['productionDesign']['cover']['decision'] = 'executed'
        with self.assertRaisesRegex(ValueError, '真实封面'):
            self.finalize()

    def test_executed_cover_requires_complete_candidate_set_not_one_png(self):
        self.prepare()
        from tools import package_production as pp
        image = self.root / 'single.png'
        image.write_bytes(b'\x89PNG\r\n\x1a\n' + b'one candidate')
        path = Path(self.analysis['productionReceiptPaths']['cover'])
        receipt = json.loads(path.read_text()); receipt['status'] = 'executed'
        receipt['files'].append({'path': str(image), 'sha256': pp.digest(image)})
        path.write_text(json.dumps(receipt))
        self.analysis['productionDesign']['cover']['decision'] = 'executed'
        with self.assertRaisesRegex(ValueError, '成套封面'):
            self.finalize()

    def test_blocked_footage_makes_package_partial_without_approval(self):
        self.prepare()
        path = Path(self.analysis['productionReceiptPaths']['footage'])
        receipt = json.loads(path.read_text()); receipt['status'] = 'blocked'
        path.write_text(json.dumps(receipt))
        self.analysis['productionDesign']['footage']['decision'] = 'blocked'
        result = self.finalize()
        self.assertEqual(result['state'], 'partial')
        self.assertNotIn('waiting_approval', json.dumps(result))

    def test_runtime_new_package_requires_full_contract_but_old_history_remains_valid(self):
        from tools import editor_plan_runtime as runtime
        output = self.root / 'new'
        self.document['source'] = None
        req = runtime.prepare_external_job({'projectId': 'p', 'jobId': 'new-job', 'kind': 'package',
                                           'document': self.document, 'sourceSrtPath': self.request['sourceSrtPath']}, output)
        self.assertEqual(req['fullPackageVersion'], 1)
        for name in ('camera', 'captions', 'cover', 'sound', 'footage'):
            self.assertTrue(req['scope'][name])

    def test_ingest_rejects_manifest_downgrade_for_full_request(self):
        from tools import editor_plan_runtime as runtime
        old_request = copy.deepcopy(self.request); old_request.pop('fullPackageVersion'); old_request.pop('runId')
        old_analysis = copy.deepcopy(self.analysis); old_analysis.pop('fullPackageVersion'); old_analysis.pop('runId')
        path = self.root / 'analysis.json'; path.write_text(json.dumps(old_analysis))
        result = ap.finalize(old_request, path)
        (self.root / 'external-job.json').write_text(json.dumps(self.request))
        store = runtime.ResultStore(self.root, {'projectId': 'p', 'jobId': 'j', 'kind': 'package', 'document': self.document})
        with self.assertRaisesRegex(ValueError, '完整制作|fullPackageVersion'):
            runtime.ingest_workflow_manifest(result, store)

    def test_full_request_cannot_bypass_gate_through_another_workflow_mode(self):
        from tools import editor_plan_runtime as runtime
        (self.root / 'external-job.json').write_text(json.dumps(self.request))
        store = runtime.ResultStore(self.root, {'projectId': 'p', 'jobId': 'j', 'kind': 'package', 'document': self.document})
        for mode in ('real-footage-v1', 'legacy-visual-v1'):
            with self.assertRaisesRegex(ValueError, '完整制作|fullPackageVersion'):
                runtime.ingest_workflow_manifest({'workflowMode': mode, 'jobId': 'j', 'results': [], 'files': []}, store)

    def test_full_snapshot_cannot_be_downgraded_by_editing_external_request(self):
        from tools import editor_plan_runtime as runtime
        request = copy.deepcopy(self.request); request.pop('fullPackageVersion'); request.pop('runId')
        (self.root / 'external-job.json').write_text(json.dumps(request))
        store = runtime.ResultStore(self.root, {'projectId': 'p', 'jobId': 'j', 'kind': 'package', 'document': self.document,
                                               'fullPackageVersion': 1, 'runId': 'immutable-run'})
        for mode in ('real-footage-v1', 'legacy-visual-v1'):
            with self.assertRaisesRegex(ValueError, '完整制作|fullPackageVersion'):
                runtime.ingest_workflow_manifest({'workflowMode': mode, 'jobId': 'j', 'results': [], 'files': []}, store)
        with self.assertRaisesRegex(ValueError, '完整制作|runId'):
            runtime.ingest_workflow_manifest({'workflowMode': ap.MODE, 'fullPackageVersion': 1, 'runId': 'forged-run',
                                             'jobId': 'j', 'results': [], 'files': []}, store)

    def test_same_narration_and_media_meaning_preserves_format_and_template_identity(self):
        base, templates, _ = ap.build_plan(self.analysis, self.request, self.document)
        previous = base['shots'][0]
        previous['narration'] = '工具降低执行成本\n经验仍然影响判断'
        previous['mediaDescription'] = '执行成本下降；\n判断仍依赖经验'
        previous['requirementVersion'] = 6
        previous['slots'][0]['requirementVersion'] = 6
        previous['bindings'] = [{'instanceId': 'existing', 'slotId': previous['slots'][0]['id'], 'status': 'current', 'requirementVersion': 6}]
        self.document['productionPlan'] = base
        plan, results, _ = ap.build_plan(self.analysis, self.request, self.document)
        current = plan['shots'][0]
        self.assertEqual(current['narration'], previous['narration'])
        self.assertEqual(current['mediaDescription'], previous['mediaDescription'])
        self.assertEqual(current['requirementVersion'], 6)
        self.assertEqual(current['bindings'], previous['bindings'])
        self.assertEqual(results[0]['requirementVersion'], 6)
        self.assertEqual(results[0]['narration'], previous['narration'])
        changed = copy.deepcopy(self.analysis)
        changed['sections'][0]['information'][0] = '执行成本仍然很高'
        changed_plan, _, _ = ap.build_plan(changed, self.request, self.document)
        self.assertEqual(changed_plan['shots'][0]['requirementVersion'], 7)

    def test_real_numeric_sign_and_case_changes_cannot_be_swallowed_as_formatting(self):
        for previous, current in (('增长1.5倍', '增长15倍'), ('温度-5℃', '温度5℃'), ('AI模型', 'ai模型')):
            with self.subTest(previous=previous, current=current):
                before = copy.deepcopy(self.analysis)
                before['sections'][0]['information'] = [previous]
                old, _, _ = ap.build_plan(before, self.request, self.document)
                after = copy.deepcopy(before)
                after['sections'][0]['information'] = [current]
                updated, _, _ = ap.build_plan(after, self.request, {**self.document, 'productionPlan': old})
                self.assertEqual(updated['shots'][0]['mediaDescription'], current)
                self.assertEqual(updated['shots'][0]['requirementVersion'], old['shots'][0]['requirementVersion'] + 1)

    def test_camera_receipt_cannot_count_other_engineering_fields_as_camera_execution(self):
        from tools import package_production as pp
        self.prepare()
        current = copy.deepcopy(self.document); current['revision'] = 2
        path = self.root / 'latest.json'; path.write_text(json.dumps({'document': current}))
        self.analysis['productionReadbackPath'] = str(path)
        receipt_path = Path(self.analysis['productionReceiptPaths']['camera'])
        receipt = json.loads(receipt_path.read_text()); receipt['status'] = 'executed'
        receipt['engineering'] = {'snapshotPath': str(path), 'revision': 2, 'instanceIds': [],
                                  'fields': [{'pointer': '/productionPlan', 'sha256': pp.json_digest(current['productionPlan'])}]}
        receipt['files'].append({'path': str(path), 'sha256': pp.digest(path)})
        receipt_path.write_text(json.dumps(receipt))
        self.analysis['productionDesign']['camera']['decision'] = 'executed'
        with self.assertRaisesRegex(ValueError, 'cameraPlan|支线字段'):
            self.finalize()

    def test_current_section_sound_and_camera_replace_stale_inherited_designs(self):
        from tools import editor_plan_runtime as runtime
        row = self.analysis['sections'][0]
        base, _, _ = ap.build_plan(self.analysis, self.request, self.document)
        old = base['shots'][0]
        old['requirementVersion'] = 6
        old['cameraIntent'] = {'action': 'push', 'reason': '旧镜头'}
        old['soundDesign'] = {'decision': 'cues', 'reason': '旧声音', 'cues': [{'id': 'old'}]}
        old['upstream']['packageShot'] = {'soundDesign': copy.deepcopy(old['soundDesign']), 'cameraIntent': copy.deepcopy(old['cameraIntent']), '其他历史字段': '保留'}
        self.document['productionPlan'] = base
        row['soundDesign'] = {'decision': 'silence', 'reason': '本轮真人留白', 'cues': []}
        row['cameraIntent'] = {'action': 'hold', 'reason': '保留本段手调镜头'}
        ap.validate_analysis(self.analysis, self.request)
        plan, _, _ = ap.build_plan(self.analysis, self.request, self.document)
        shot = plan['shots'][0]
        self.assertEqual(shot['soundDesign'], row['soundDesign'])
        self.assertEqual(shot['upstream']['packageShot']['soundDesign'], row['soundDesign'])
        self.assertEqual(shot['cameraIntent'], row['cameraIntent'])
        self.assertEqual(shot['upstream']['packageShot']['其他历史字段'], '保留')
        self.assertEqual(plan['soundDesignVersion'], 1)
        self.assertEqual(shot['requirementVersion'], 6)
        canonical = runtime.canonical_package(plan)
        self.assertEqual(canonical['shots'][0]['soundDesign'], row['soundDesign'])
        self.assertNotIn('本轮真人留白', ap.render_claude_prompt(self.analysis, self.request))
        self.assertNotIn('保留本段手调镜头', ap.render_claude_prompt(self.analysis, self.request))

    def test_full_sound_contract_rejects_unknown_anchor_and_absolute_cue_timing(self):
        row = self.analysis['sections'][0]
        row['soundDesign'] = {'decision': 'cues', 'reason': '强调实际口播', 'cues': [{'id': 'new', 'role': 'emphasis', 'intent': '轻落点', 'anchor': '经验仍然影响判断', 'event': 'result-land', 'texture': '短轻', 'priority': 2}]}
        ap.validate_analysis(self.analysis, self.request)
        row['soundDesign']['cues'][0]['anchor'] = '不存在的原文'
        with self.assertRaisesRegex(ValueError, '锚点|anchor'):
            ap.validate_analysis(self.analysis, self.request)
        row['soundDesign']['cues'][0]['anchor'] = '经验仍然影响判断'
        row['soundDesign']['cues'][0]['startSeconds'] = 3
        with self.assertRaisesRegex(ValueError, '秒点'):
            ap.validate_analysis(self.analysis, self.request)

    def test_latest_readback_allows_applied_branch_and_preserves_it_in_plan(self):
        from tools import package_production as pp
        self.prepare()
        current = copy.deepcopy(self.document); current['revision'] = 2
        current['source']['cameraPlan'] = {'origin': 'full-package', 'zoom': 1.1}
        path = self.root / 'latest.json'; path.write_text(json.dumps({'document': current}))
        self.analysis['productionReadbackPath'] = str(path)
        receipt_path = Path(self.analysis['productionReceiptPaths']['camera'])
        receipt = json.loads(receipt_path.read_text()); receipt['status'] = 'executed'
        receipt['engineering'] = {'snapshotPath': str(path), 'revision': 2, 'instanceIds': [],
                                  'fields': [{'pointer': '/source/cameraPlan', 'sha256': pp.json_digest(current['source']['cameraPlan'])}]}
        receipt['files'].append({'path': str(path), 'sha256': pp.digest(path)})
        receipt_path.write_text(json.dumps(receipt))
        self.analysis['productionDesign']['camera']['decision'] = 'executed'
        result = self.finalize()
        self.assertIn(str(path), {row['path'] for row in result['files']})
        self.assertEqual(result['outputs']['productionReadbackPath'], str(path))
        current['source']['clips'][0]['durationFrames'] = 170
        path.write_text(json.dumps({'document': current}))
        with self.assertRaisesRegex(ValueError, 'clips|剪辑'):
            self.finalize()

    def test_explicit_single_clip_can_match_implicit_source_without_time_change(self):
        from tools import package_production as pp
        original=copy.deepcopy(self.document)
        original['source'].pop('clips')
        original['source'].update(startFrame=0,durationFrames=180)
        current=copy.deepcopy(original);current['revision']=2
        current['source']['clips']=[{'id':'source-main','name':'主视频','startFrame':0,'durationFrames':180,'sourceInFrame':0}]
        path=self.root/'latest.json';path.write_text(json.dumps({'document':current}))
        data={'productionReadbackPath':str(path)}
        self.assertEqual(pp.production_document(data,self.request,original)[0],current)
        current['source']['clips'][0]['sourceInFrame']=1
        path.write_text(json.dumps({'document':current}))
        with self.assertRaisesRegex(ValueError,'clips|剪辑'):
            pp.production_document(data,self.request,original)

    def test_engineering_snapshot_must_be_immutably_bound_by_receipt_files(self):
        from tools import package_production as pp
        self.prepare()
        current = copy.deepcopy(self.document); current['revision'] = 2
        current['source']['cameraPlan'] = {'origin': 'full-package', 'zoom': 1.1}
        path = self.root / 'latest.json'; path.write_text(json.dumps({'document': current}))
        self.analysis['productionReadbackPath'] = str(path)
        receipt_path = Path(self.analysis['productionReceiptPaths']['camera'])
        receipt = json.loads(receipt_path.read_text()); receipt['status'] = 'executed'
        receipt['engineering'] = {'snapshotPath': str(path), 'revision': 2, 'instanceIds': [],
                                  'fields': [{'pointer': '/source/cameraPlan', 'sha256': pp.json_digest(current['source']['cameraPlan'])}]}
        self.analysis['productionDesign']['camera']['decision'] = 'executed'
        receipt_path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, '快照|snapshot'):
            self.finalize()
        receipt['files'].append({'path': str(path), 'sha256': pp.digest(path)})
        receipt_path.write_text(json.dumps(receipt))
        self.finalize()
        current['revision'] = 3
        path.write_text(json.dumps({'document': current}))
        with self.assertRaisesRegex(ValueError, 'SHA'):
            self.finalize()
