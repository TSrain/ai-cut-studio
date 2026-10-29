import unittest
from tools.shot_revision_runtime import validate_response, revision_schema
class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.snapshot={'kind':'revise','jobId':'j','projectId':'p','shotId':'s','target':{'startFrame':30,'durationFrames':60},'revisionContext':{'editable':[{'entity':'audio','id':'a','field':'volume','before':1}]}}
        self.response={'reason':'降低音量','gaps':[],'patches':[{'entity':'audio','id':'a','field':'volume','before':1,'after':0.5}]}
    def test_bounded_result(self):
        result=validate_response(self.response,self.snapshot)
        self.assertEqual(result['kind'],'shot-revision')
        self.assertEqual(result['target'],self.snapshot['target'])
    def test_unknown_or_forged_patch(self):
        for key,value in [('id','other'),('before',0),('field','path'),('after',-1)]:
            response={**self.response,'patches':[{**self.response['patches'][0],key:value}]}
            with self.assertRaises(ValueError):validate_response(response,self.snapshot)
    def test_explicit_gap(self):
        with self.assertRaises(ValueError):validate_response({'reason':'完成','gaps':[],'patches':[]},self.snapshot)
        self.assertEqual(validate_response({'reason':'无法新增','gaps':['需要人工添加新的音效素材'],'patches':[]},self.snapshot)['gaps'][0],'需要人工添加新的音效素材')
    def test_schema_is_closed(self):
        self.assertFalse(revision_schema()['additionalProperties'])
if __name__=='__main__':unittest.main()

class WorkerRevisionTests(unittest.TestCase):
    def test_worker_dispatch_publishes_scoped_result_without_transcription(self):
        import tempfile,json
        from pathlib import Path
        from unittest.mock import patch
        from tools import editor_plan_runtime as runtime
        from tests.test_editor_plan import snapshot
        data=snapshot('revise');shot=data['document']['productionPlan']['shots'][0]
        shot['timing']={'status':'manual','manual':True,'ranges':[{'id':'r','startFrame':30,'durationFrames':60}]}
        data.update(shotId=shot['id'],rangeId='r',target={'rangeId':'r','startFrame':30,'durationFrames':60},instructions='更具体',scope={'camera':True,'sound':True},inputs=[],revisionContext={'document':data['document'],'editable':[{'entity':'shot','id':shot['id'],'field':'visualRequirement','before':shot['visualRequirement']}]})
        response={'reason':'修改现有表达目标','gaps':[],'patches':[{'entity':'shot','id':shot['id'],'field':'visualRequirement','beforeJson':json.dumps(shot['visualRequirement']),'afterJson':json.dumps('显示具体 UI')} ]}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'snapshot.json';path.write_text(json.dumps(data))
            with patch.object(runtime,'model_json',return_value=response) as model,patch.object(runtime,'verify_transcript_association') as transcript:
                result=runtime.worker(path,Path(folder)/'out')
            self.assertEqual(result['state'],'complete');self.assertEqual(result['results'][0]['kind'],'shot-revision')
            self.assertTrue(Path(result['outputs']['summaryPath']).is_file());transcript.assert_not_called()
            self.assertIn('当前选中片段',model.call_args.args[1])

class CameraCreationTests(unittest.TestCase):
    def test_only_bounded_known_camera_creation_can_be_published(self):
        from tools.shot_revision_runtime import validate_response
        snap={'kind':'revise','jobId':'j','projectId':'p','shotId':'s','target':{'startFrame':30,'durationFrames':60},'document':{'canvas':{'fps':{'num':30,'den':1}},'source':{'startFrame':0}},'revisionContext':{'editable':[{'entity':'camera-create','id':'cam','field':'clip','before':None}]}}
        clip={'id':'cam','start':1,'in':.4,'hold':1,'out':.4,'zoom':1.15,'enabled':True,'name':'强调','inEasing':'ramped','outEasing':'ramped'}
        value={'reason':'新增推近','gaps':[],'patches':[{'entity':'camera-create','id':'cam','field':'clip','before':None,'after':clip}]}
        self.assertEqual(validate_response(value,snap)['patches'][0]['after']['zoom'],1.15)
        clip['path']='/arbitrary';self.assertRaises(ValueError,validate_response,value,snap)

class MissingSemanticTests(unittest.TestCase):
    def test_missing_explicit_semantic_fields_are_editable_as_null(self):
        from tools.shot_revision_runtime import validate_response
        snap={'kind':'revise','jobId':'j','projectId':'p','shotId':'s','target':{'startFrame':1,'durationFrames':2},'revisionContext':{'editable':[{'entity':'shot','id':'s','field':'animationNeed','before':None}]}}
        response={'reason':'移除动画需求','gaps':[],'patches':[{'entity':'shot','id':'s','field':'animationNeed','before':None,'after':'none'}]}
        self.assertEqual(validate_response(response,snap)['patches'][0]['after'],'none')

class ExecutionTests(RevisionTests):
    def test_explicit_footage_handoff_is_executable_without_patch(self):
        self.snapshot['instructions']='找一些使用和操作电脑的镜头'
        response={'reason':'搜集电脑操作画面','gaps':[],'patches':[], 'execution':{'kind':'footage','instructions':'找一些使用和操作电脑的镜头'}}
        self.assertEqual(validate_response(response,self.snapshot)['execution'],response['execution'])
    def test_none_normalizes_and_unknown_kind_rejected(self):
        self.assertNotIn('execution',validate_response({**self.response,'execution':{'kind':'none','instructions':''}},self.snapshot))
        with self.assertRaises(ValueError):validate_response({**self.response,'execution':{'kind':'animation','instructions':'制作'}},self.snapshot)

class CanonicalRevisionTargetTests(unittest.TestCase):
    def test_revision_and_scoped_footage_use_full_plan_range_over_bindings(self):
        import tempfile
        from pathlib import Path
        from tools import editor_plan_runtime as runtime
        from tests.test_editor_plan import snapshot
        for kind in ['revise','footage']:
            data=snapshot(kind);data['workflowMode']='semantic-template-v1'
            shot=data['document']['productionPlan']['shots'][0]
            shot.update(timing={'status':'manual','ranges':[{'id':'canonical','startFrame':30,'durationFrames':120}]},bindings=[{'instanceId':'short'},{'instanceId':'other'}])
            data['document']['instances']=[{'id':'short','startFrame':45,'durationFrames':30},{'id':'other','startFrame':60,'durationFrames':20}]
            data.update(shotId=shot['id'],target={'rangeId':'canonical','startFrame':30,'durationFrames':120},instructions='找电脑操作画面',revisionContext={'editable':[]},scope={'footage':True})
            self.assertEqual(runtime.target_range(data)['durationFrames'],120)
            runtime.validate_snapshot(data)
            with tempfile.TemporaryDirectory() as folder:
                request=runtime.prepare_external_job(data,Path(folder))
                self.assertEqual(request['targetRange']['durationFrames'],120)
                self.assertEqual(request['projectTarget']['rangeId'],'canonical')
            explicit={**data,'instanceId':'short','target':{'instanceId':'short','startFrame':45,'durationFrames':30}}
            self.assertEqual(runtime.target_range(explicit)['durationFrames'],30)
    def test_multiple_plan_ranges_require_selector_despite_single_binding(self):
        from tools import editor_plan_runtime as runtime
        from tests.test_editor_plan import snapshot
        data=snapshot('footage');data.update(shotId='stable-shot',scope={'footage':True})
        shot=data['document']['productionPlan']['shots'][0]
        shot.update(timing={'status':'manual','ranges':[{'id':'a','startFrame':0,'durationFrames':30},{'id':'b','startFrame':40,'durationFrames':30}]},bindings=[{'instanceId':'short'}])
        data['document']['instances']=[{'id':'short','startFrame':0,'durationFrames':30}]
        with self.assertRaises(ValueError):runtime.target_range(data)

class ExecutionPublicationTests(unittest.TestCase):
    def test_execution_only_request_survives_the_complete_worker_publication_boundary(self):
        import tempfile,json
        from pathlib import Path
        from unittest.mock import patch
        from tools import editor_plan_runtime as runtime
        from tests.test_editor_plan import snapshot
        data=snapshot('revise');shot=data['document']['productionPlan']['shots'][0]
        shot['timing']={'status':'manual','manual':True,'ranges':[{'id':'r','startFrame':30,'durationFrames':60}]}
        data.update(shotId=shot['id'],rangeId='r',target={'rangeId':'r','startFrame':30,'durationFrames':60},instructions='找一些操作电脑的镜头',inputs=[],revisionContext={'editable':[]})
        response={'reason':'执行已明确的素材需求','patches':[],'gaps':[],'execution':{'kind':'footage','instructions':'下载核验电脑操作素材，仅在本段推荐入轨'}}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'snapshot.json';path.write_text(json.dumps(data))
            with patch.object(runtime,'model_json',return_value=response):result=runtime.worker(path,Path(folder)/'out')
            self.assertEqual(result['state'],'complete')
            self.assertEqual(result['results'][0]['execution'],response['execution'])
    def test_publisher_revalidates_execution_instead_of_ignoring_an_unknown_kind(self):
        import tempfile
        from tools import editor_plan_runtime as runtime
        from tests.test_editor_plan import snapshot
        data=snapshot('revise');data.update(shotId='stable-shot',target={'startFrame':30,'durationFrames':60},instructions='改这一段',revisionContext={'editable':[]})
        with tempfile.TemporaryDirectory() as folder:
            store=runtime.ResultStore(folder,data)
            with self.assertRaises(ValueError):store.publish({'kind':'shot-revision','shotId':'stable-shot','target':data['target'],'reason':'无改动','patches':[],'gaps':['缺条件'],'execution':{'kind':'arbitrary','instructions':'不能执行'}})
