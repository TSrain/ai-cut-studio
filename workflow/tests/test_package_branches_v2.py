import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from tests.test_package_branches import result
from tools import package_branches as pb


class V2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        script=self.root/'script.md';script.write_text('完整口播')
        self.doc={'id':'p','revision':1,'source':{'clips':[]},'canvas':{'width':1920,'height':1080,'fps':{'num':30,'den':1},'durationFrames':300},'captions':{'cues':[]},'productionPlan':{'shots':[]}}
        self.req={'version':1,'packageOrchestrationVersion':2,'projectId':'p','runId':'r','outputRoot':str(self.root/'out'),'packageRoot':str(self.root/'out/package'),'finalScriptPath':str(script),'document':self.doc,'canvas':self.doc['canvas'],'cues':[{'text':'完整口播'}],'scope':{b:b in ('camera','aiVideo') for b in pb.BRANCHES},'packageExecution':{'streamingApply':False}}
        self.semantic={'sections':[{'id':'s','title':'标题','narration':'完整口播','animationNeed':'none','goal':'表达','information':[],'relations':[],'boundaries':[],'reason':'真人','sourceCueIds':[1],'requirementVersion':1}]}
        self.request=self.root/'request.json';self.request.write_text(json.dumps(self.req));self.sem=self.root/'semantic.json';self.sem.write_text(json.dumps(self.semantic))
    def runner(self,req,stop):
        value=result(req);p=Path(value['manifestPath']);proposal=json.loads(p.read_text());proposal['decision']='leave_blank';proposal['reviewedSections']=['s'];p.write_text(json.dumps(proposal))
        value['files'][0]['sha256']=pb.digest(p);pb.atomic_json(Path(req['outputRoot'])/'result.json',value);return value
    def run_v2(self,runner=None,**kwargs):
        return pb.run_branches(self.request,self.sem,runner=runner or self.runner,slot_root=self.root/'slots',**kwargs)
    def test_v2_runs_narrow_inputs_and_native_validation(self):
        seen=[]
        def runner(req,stop):
            seen.append(req)
            bundle=json.loads(Path(req['branchInputPath']).read_text())
            self.assertNotIn('projectSnapshotPath',bundle)
            return self.runner(req,stop)
        state=self.run_v2(runner)
        self.assertEqual(state['version'],2)
        self.assertEqual(state['status'],'complete')
        self.assertEqual(len(seen),2)
        for row in state['branches'].values():
            if row['status']=='complete':self.assertEqual(row['validation']['status'],'passed')
        self.assertEqual(pb.validate_branch_run(self.req,self.root/'out/package-branches.json')['status'],'complete')
    def test_failed_business_validation_is_partial_and_sibling_continues(self):
        def runner(req,stop):
            return result(req) if req['branchId']=='camera' else self.runner(req,stop)
        state=self.run_v2(runner)
        self.assertEqual(state['status'],'partial')
        self.assertEqual(state['branches']['aiVideo']['status'],'complete')
        with self.assertRaises(ValueError):pb.validate_branch_run(self.req,self.root/'out/package-branches.json')
    def test_successful_sibling_recovered_without_model_call(self):
        calls=[]
        def runner(req,stop):calls.append(req['branchId']);return self.runner(req,stop)
        first=self.run_v2(runner);second=self.run_v2(runner)
        self.assertEqual(len(calls),2)
        self.assertEqual(first['branches']['aiVideo']['attemptId'],second['branches']['aiVideo']['attemptId'])
    def test_returned_immutable_result_can_retry_only_business_validation(self):
        calls=[]
        def runner(req,stop):calls.append(req['branchId']);return self.runner(req,stop)
        with patch('tools.package_branches_v2.validate_branch_proposal',side_effect=ValueError('native validator unavailable')):
            first=self.run_v2(runner)
        self.assertEqual(first['status'],'partial')
        second=self.run_v2(runner,retry_failed=True)
        self.assertEqual(second['status'],'complete')
        self.assertEqual(len(calls),2)
        self.assertEqual(first['branches']['camera']['attemptId'],second['branches']['camera']['attemptId'])
        self.assertEqual(pb.validate_branch_run(self.req,self.root/'out/package-branches.json')['status'],'complete')
    def test_changed_returned_result_requires_new_model_attempt(self):
        calls=[]
        def runner(req,stop):calls.append(req['branchId']);return self.runner(req,stop)
        with patch('tools.package_branches_v2.validate_branch_proposal',side_effect=ValueError('native validator unavailable')):
            first=self.run_v2(runner)
        path=Path(first['branches']['camera']['resultPath'])
        value=pb.load(path);value['gaps']=['changed after return'];pb.atomic_json(path,value)
        second=self.run_v2(runner,retry_failed=True)
        self.assertEqual(second['status'],'complete')
        self.assertEqual(calls.count('camera'),2)
        self.assertEqual(calls.count('aiVideo'),1)
        self.assertNotEqual(first['branches']['camera']['attemptId'],second['branches']['camera']['attemptId'])
    def test_missing_version_routes_to_v2_and_validates_without_rewriting_request(self):
        self.req.pop('packageOrchestrationVersion')
        pb.atomic_json(self.request,self.req)
        original=self.request.read_bytes()
        state=self.run_v2()
        self.assertEqual(state['version'],2)
        self.assertEqual(state['status'],'complete')
        self.assertEqual(pb.validate_branch_run(self.req,self.root/'out/package-branches.json')['status'],'complete')
        self.assertEqual(self.request.read_bytes(),original)

    def test_retired_version_rejected_on_run_and_validation(self):
        self.req['packageOrchestrationVersion']=1
        pb.atomic_json(self.request,self.req)
        message='packageOrchestrationVersion=1 已下线（见 git tag v1-final），请新建 v2 package 任务'
        for action in (self.run_v2,lambda:pb.validate_branch_run(self.req,self.root/'missing.json')):
            with self.subTest(action=action):
                with self.assertRaises(ValueError) as error:
                    action()
                self.assertEqual(str(error.exception),message)

    def test_v1_snapshot_progress_returns_none_even_with_old_state(self):
        from tools.package_branch_runtime import branch_progress
        pb.atomic_json(self.root/'out/package-branches.json',{'version':1})
        self.assertIsNone(branch_progress({'packageOrchestrationVersion':1},self.root/'out'))

    def test_unknown_version_rejected(self):
        for version in (3,0,None,True,2.0,'2'):
            with self.subTest(version=version):
                self.req['packageOrchestrationVersion']=version
                pb.atomic_json(self.request,self.req)
                with self.assertRaisesRegex(ValueError,'unknown package orchestration version'):
                    self.run_v2()

    def test_early_handoff_rejects_retired_request_before_writing(self):
        from tools.package_early_handoff import publish_early_handoff
        self.req['packageOrchestrationVersion']=1
        with self.assertRaisesRegex(ValueError,'packageOrchestrationVersion=1 已下线'):
            publish_early_handoff(self.req,self.sem)
        self.assertFalse((self.root/'out').exists())

    def test_v1_state_cannot_be_resumed_as_default_v2(self):
        self.req.pop('packageOrchestrationVersion')
        pb.atomic_json(self.request,self.req)
        path=self.root/'out/package-branches.json'
        pb.atomic_json(path,{'version':1,'projectId':'p','runId':'r'})
        original=path.read_bytes()
        with self.assertRaisesRegex(ValueError,'packageOrchestrationVersion=1 已下线'):
            self.run_v2()
        with self.assertRaisesRegex(ValueError,'packageOrchestrationVersion=1 已下线'):
            pb.validate_branch_run(self.req,path)
        self.assertEqual(path.read_bytes(),original)
        self.assertFalse((self.root/'out/branch-inputs').exists())

    def test_cancel_before_start_runs_no_workers(self):
        out=self.root/'out';out.mkdir();(out/'cancel.request').write_text('cancel')
        calls=[]
        state=self.run_v2(lambda *args:calls.append(args))
        self.assertEqual(state['status'],'cancelled');self.assertEqual(calls,[])
    def test_validation_receipt_hash_required_on_readback(self):
        state=self.run_v2();path=state['branches']['camera']['validation']['receiptPath'];Path(path).write_text('{}')
        with self.assertRaises(ValueError):pb.validate_branch_run(self.req,self.root/'out/package-branches.json')

    def test_business_receipt_does_not_overwrite_native_validation_artifact(self):
        def runner(req,stop):
            value=self.runner(req,stop)
            native=Path(req['outputRoot'])/'validation.json'
            pb.atomic_json(native,{'candidate_ready':True})
            value['files'].append(pb.file_record(native))
            pb.atomic_json(Path(req['outputRoot'])/'result.json',value)
            return value
        state=self.run_v2(runner)
        for row in state['branches'].values():
            if row['status']!='complete':continue
            native=Path(row['outputRoot'])/'validation.json'
            self.assertEqual(pb.load(native),{'candidate_ready':True})
            self.assertNotEqual(Path(row['validation']['receiptPath']),native)
        pb.validate_branch_run(self.req,self.root/'out/package-branches.json')

    def test_opt_in_new_run_reuses_project_artifacts_without_model_slot(self):
        calls=[]
        def runner(req,stop):calls.append(req['branchId']);return self.runner(req,stop)
        first=self.run_v2(runner);self.assertEqual(first['status'],'complete')
        self.req['runId']='r2';self.req['packageExecution']['reusePolicy']='validated-project-artifacts';self.request.write_text(json.dumps(self.req))
        second=self.run_v2(runner)
        self.assertEqual(second['status'],'complete')
        self.assertEqual(len(calls),2)
        for bid in ('camera','aiVideo'):
            self.assertEqual(second['branches'][bid]['reuse']['status'],'materialized')
            self.assertEqual(pb.load(second['branches'][bid]['executionPath'])['runnerKind'],'reuse')
        pb.validate_branch_run(self.req,self.root/'out/package-branches.json')
