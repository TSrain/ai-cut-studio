import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
from unittest.mock import patch
from tests.test_package_branches import result


class ProposalValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.req={'projectId':'p','runId':'r','branchId':'templates','attemptId':'a','inputFingerprint':'f','dependencies':{},'outputRoot':str(self.root),'semantic':{'sections':[{'id':'s'}]}}
        self.doc={'id':'p','revision':1,'canvas':{'width':1920,'height':1080,'fps':{'num':30,'den':1},'durationFrames':300},'productionPlan':{'shots':[]},'source':{},'captions':{'cues':[]}}
    def validate(self,proposal,branch='templates'):
        from tools.package_branch_validation import validate_branch_proposal
        self.req['branchId']=branch
        value=result(self.req)
        proposal={'schemaVersion':1,'branchId':branch,'items':[],'reason':'本轮完整审阅',**proposal}
        Path(value['manifestPath']).write_text(json.dumps(proposal))
        value['files'][0]['sha256']=hashlib.sha256(Path(value['manifestPath']).read_bytes()).hexdigest()
        for path in getattr(self,'extra_files',[]):
            value['files'].append({'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        return validate_branch_proposal(self.req,value,self.doc)
    def test_explicit_leave_blank_produces_no_project_operations(self):
        receipt=self.validate({'decision':'leave_blank','reviewedSections':['s']},'camera')
        self.assertEqual(receipt['status'],'passed')
        self.assertEqual(receipt['operations'],[])
        self.assertEqual(receipt['applied'],False)
    def test_unreviewed_empty_proposal_cannot_bypass_business_contract(self):
        with self.assertRaises(ValueError):self.validate({})
    def test_unknown_native_template_fails_business_validation(self):
        with self.assertRaises(ValueError):
            self.validate({'items':[{'shotId':'s','requirementVersion':1,'preset':'missing','props':{},'startSeconds':0,'durationSeconds':1}]})
    def test_cover_requires_native_manifest(self):
        with self.assertRaises(ValueError):self.validate({},'cover')
    def test_captions_require_per_cue_segmentation_review(self):
        with self.assertRaises(ValueError):self.validate({'captions':{'cues':[]}},'captions')
    def test_captions_load_bound_separate_quality_reviews(self):
        reviews=[{'findingId':'source:2:coarse_source_timing'}]
        self.evidence('caption-quality-reviews.json',reviews)
        segmentation=self.evidence('segmentation.json',{'version':1,'cues':[]})
        with patch('tools.caption_quality.audit',return_value={'passed':True}) as audit:
            self.validate({'captions':{'cues':[]},'segmentationReviewPath':segmentation},'captions')
        self.assertEqual(audit.call_args.args[2],reviews)
    def test_invalid_camera_plan_rejected(self):
        with self.assertRaises(ValueError):self.validate({'cameraPlan':{'version':2,'shots':[{'startFrame':-1}]}},'camera')
    def test_ai_video_empty_candidates_cover_all_frozen_sections(self):
        self.req['semantic']={'sections':[{'id':'s','narration':'口播','requirementVersion':1,'sourceCueIds':[1]}]}
        receipt=self.validate({'sections':[{'id':'s','aiVideoCandidates':[]}]},'aiVideo')
        self.assertEqual(receipt['status'],'passed')
        with self.assertRaises(ValueError):self.validate({'sections':[]},'aiVideo')
    def test_branch_files_tamper_rejected(self):
        from tools.package_branch_validation import validate_branch_proposal
        value=result(self.req);Path(value['reportPath']).write_text('changed')
        with self.assertRaises(ValueError):validate_branch_proposal(self.req,value,self.doc)

    def evidence(self,name,value):
        path=self.root/name;path.write_text(json.dumps(value))
        self.extra_files=getattr(self,'extra_files',[])+[path]
        return str(path)

    def test_real_native_camera_plan_accepts_errors_array_report(self):
        plan={'version':2,'duration':10,'levels':{'A':1,'B':1.12,'C':1.18},
              'anchor':{'x':.5,'y':.5},'events':[{'at':0,'to':'A','transition':'cut',
              'purpose':'hook','cue':'开场','reason':'基础构图'}]}
        receipt=self.validate({'cameraPlan':plan},'camera')
        self.assertEqual(receipt['operations'][0]['payload']['value'],plan)

    def test_cover_uses_native_candidate_ready_result(self):
        path=self.evidence('cover.json',{})
        with patch('tools.cover.validate',return_value={'candidate_ready':True,'machine_passed':True}) as native:
            receipt=self.validate({'coverCandidateManifestPath':path},'cover')
        native.assert_called_once_with(str(Path(path).resolve()),write_report=False)
        self.assertEqual(len(receipt['operations']),1)
        with patch('tools.cover.validate',return_value={'candidate_ready':False,'machine_passed':True}):
            with self.assertRaises(ValueError):self.validate({'coverCandidateManifestPath':path},'cover')

    def test_templates_blank_requires_real_full_review(self):
        self.req['semantic']['sections'][0]['templateMatch']={'status':'none'}
        proposal={'decision':'leave_blank','reviewedSections':['s'],'templateReview':{'version':1,
                  'sections':[{'sectionId':'s','decision':'keep_presenter','reason':'真人表达完整',
                  'opportunities':[],'candidates':[]}]}}
        self.assertEqual(self.validate(proposal)['operations'],[])
        proposal['templateReview']['sections']=[]
        with self.assertRaises(ValueError):self.validate(proposal)

    def test_captions_blank_runs_native_segmentation_audit(self):
        from tools.caption_quality import cue_digest
        cue={'id':'c','startFrame':0,'endFrame':30,'text':'独立短句'}
        self.doc['captions']={'cues':[cue]}
        path=self.evidence('segmentation.json',{'version':1,'cues':[{'cueId':'c',
             'cueSha256':cue_digest(cue),'decision':'keep','reason':'独立表达'}]})
        proposal={'decision':'leave_blank','reviewedSections':['s'],
                  'captions':copy.deepcopy(self.doc['captions']),'segmentationReviewPath':path}
        self.assertEqual(self.validate(proposal,'captions')['operations'],[])
        proposal['captions']['cues'][0]['text']='变更'
        with self.assertRaises(ValueError):self.validate(proposal,'captions')
        proposal['captions']=copy.deepcopy(self.doc['captions'])
        self.extra_files=[]
        path=self.evidence('bad-segmentation.json',{'version':1,'cues':[]})
        proposal['segmentationReviewPath']=path
        with self.assertRaises(ValueError):self.validate(proposal,'captions')

    def test_footage_blank_runs_full_native_review(self):
        srt=self.root/'raw.srt';srt.write_text('1\n00:00:00,000 --> 00:00:01,000\n独立短句\n')
        self.req.update(sourceSrtPath=str(srt),videoPath=str(self.root/'source.mp4'))
        review={'schemaVersion':1,'workflowMode':'real-footage-v1','projectId':'p',
                'sourceSrtPath':str(srt),'sourceVideoPath':self.req['videoPath'],
                'sections':[{'id':'s','sourceCueIds':[1],'narration':'独立短句',
                'title':'真人','footageNeed':'none','reason':'个人表达无需外部画面'}],
                'candidates':[],'placements':[]}
        path=self.evidence('footage.json',review)
        proposal={'decision':'leave_blank','reviewedSections':['s'],'footageAnalysisPath':path}
        self.assertEqual(self.validate(proposal,'footage')['operations'],[])
        review['sections'][0]['narration']='不对应原稿'
        self.extra_files=[];proposal['footageAnalysisPath']=self.evidence('bad-footage.json',review)
        with self.assertRaises(ValueError):self.validate(proposal,'footage')

    def test_blank_without_current_semantic_coverage_is_rejected(self):
        for branch in ('templates','footage','captions','camera'):
            with self.subTest(branch=branch),self.assertRaises(ValueError):
                self.validate({'decision':'leave_blank','reviewedSections':[]},branch)

    def test_templates_use_native_plan_source_mapping_and_identity(self):
        from tests.test_animation_package import fixture
        request,semantic,document=fixture(self.root)
        self.req.update(request);self.req['semantic']=semantic;self.doc=document
        semantic['sections'][0]['requirementVersion']=1
        match=semantic['sections'][0]['templateMatch']
        proposal={'items':[{'shotId':'s','requirementVersion':1,'preset':match['presetId'],
                  'props':match['props'],'reason':match['reason'],'startSeconds':1,'durationSeconds':4}],
                  'templateReview':{'version':1,'sections':[{'sectionId':'s','decision':'apply',
                  'reason':'适配原生对照','opportunities':['概念对照'],'candidates':[{'presetId':match['presetId'],
                  'decision':'selected','reason':'解释区别','visualBenefit':'双栏便于比较'}]}]}}
        receipt=self.validate(proposal)
        native=receipt['operations'][0]['payload']['nativeResult']
        self.assertEqual(native['target']['startFrame'],30)
        self.assertEqual(native['target']['durationFrames'],120)
        self.assertEqual(native['slotId'],'s-primary')
        self.assertEqual(native['narration'],semantic['sections'][0]['narration'])
        self.assertTrue(native['technical']['passed'])
        self.assertEqual(native['jobId'],'j');self.assertEqual(native['projectId'],'p')
        self.assertTrue(native['id'].startswith('package-'))
        self.evidence('templateReview.json',proposal.pop('templateReview'))
        proposal['items'][0]['preset']={'id':match['presetId'],'version':native['technical']['details']['presetVersion']}
        self.assertEqual(self.validate(proposal)['operations'][0]['payload']['nativeResult']['target'],native['target'])
        self.extra_files=[]
        with self.assertRaisesRegex(ValueError,'SHA-bound'):self.validate(proposal)
        self.extra_files=[self.root/'templateReview.json']
        proposal['items'][0]['startSeconds']=999
        with self.assertRaisesRegex(ValueError,'超出'):self.validate(proposal)
        self.assertEqual(semantic['sections'][0]['templateMatch'],match)

    def test_footage_native_finalize_binds_results_and_staged_files(self):
        from tests.test_footage_package import fixture
        request,review,document=fixture(self.root)
        self.req.update(request);self.doc=document;self.root=Path(request['outputRoot'])
        review['candidates'] += [dict(copy.deepcopy(review['candidates'][0]),id=identity) for identity in ('c2','c3')]
        path=self.evidence('review-input.json',review)
        with patch('tools.footage_package.verify_media'):
            receipt=self.validate({'footageAnalysisPath':path},'footage')
        with patch('tools.footage_package.finalize',side_effect=AssertionError('must reuse verified staging')):
            again=self.validate({'footageAnalysisPath':path},'footage')
        self.assertEqual(receipt['operations'],again['operations'])
        self.doc['revision']=2
        with patch('tools.footage_package.verify_media'):
            updated=self.validate({'footageAnalysisPath':path},'footage')
        self.assertNotEqual(receipt['operations'][0]['payload']['nativeResult']['footage']['reviewPath'],
                            updated['operations'][0]['payload']['nativeResult']['footage']['reviewPath'])
        staged=Path(updated['operations'][0]['payload']['nativeResult']['footage']['reviewPath'])
        staged.write_text('{}')
        with self.assertRaisesRegex(ValueError,'staged footage files changed'):
            self.validate({'footageAnalysisPath':path},'footage')
        self.assertEqual(len(receipt['operations']),4)
        for operation in receipt['operations']:
            native=operation['payload']['nativeResult']
            self.assertEqual(native['kind'],'footage')
            self.assertEqual(native['jobId'],'j');self.assertEqual(native['projectId'],'p')
            self.assertTrue(native['technical']['passed'])
            self.assertTrue(Path(native['footage']['reviewPath']).is_relative_to(self.root.resolve()))
            bound={row['path']:row['sha256'] for row in operation['files']}
            self.assertEqual(bound[native['footage']['reviewPath']],native['footage']['reviewSha256'])
            self.assertEqual(bound[native['media']['path']],native['technical']['details']['sha256'])

    def test_footage_candidate_shortage_retains_valid_native_operations(self):
        from tests.test_footage_package import fixture
        request,review,document=fixture(self.root)
        self.req.update(request);self.doc=document;self.root=Path(request['outputRoot'])
        path=self.evidence('review-input.json',review)
        with patch('tools.footage_package.verify_media'):
            receipt=self.validate({'footageAnalysisPath':path},'footage')
        self.assertEqual(len(receipt['operations']),2)
        self.assertTrue(receipt['issues'])
        self.assertIn('候选不足',receipt['issues'][0]['reason'])

    def test_canonical_hash_matches_actual_node_host(self):
        from tools.package_branch_validation import canonical_hash
        module=Path(__file__).resolve().parents[1]/'workspace/package-parallel-optimization/visualization-stage/tools/lib/package-branch-application.mjs'
        if not module.is_file():
            module=Path(__file__).resolve().parents[2]/'studio/tools/lib/package-branch-application.mjs'
        self.assertTrue(module.is_file(),'native hash module required for cross-runtime regression')
        values=[10.0,.00001,1e-7,1e-6,1e20,1e21,-0.0,
                {'10':10.0,'2':.00001,'01':1e-7,'0':'零','4294967295':'非索引','4294967294':'索引'},
                {'😀':'中文','\ue000':'测试','nested':[{'durationSeconds':10.0,'tiny':1e-7}]}]
        code='import {branchValueHash} from '+json.dumps(module.as_uri())+';let text="";for await(const c of process.stdin)text+=c;console.log(JSON.stringify(JSON.parse(text).map(branchValueHash)));'
        actual=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(values),text=True,capture_output=True,check=True)
        self.assertEqual([canonical_hash(value) for value in values],json.loads(actual.stdout))
        for value in (float('nan'),float('inf'),float('-inf')):
            with self.assertRaises(ValueError):canonical_hash(value)

    def test_all_operations_bind_entire_source_identity_and_lock(self):
        self.doc['source']={'path':'original.mov','startFrame':12,'locked':False,'clips':[]}
        plan={'version':2,'duration':10,'events':[{'at':0,'to':'A','transition':'cut',
              'purpose':'hook','cue':'开场','reason':'基础构图'}]}
        receipt=self.validate({'cameraPlan':plan},'camera')
        readset=receipt['operations'][0]['readSet']
        bound=next(row['beforeHash'] for row in readset if row['path']==['source'])
        from tools.package_branch_validation import canonical_hash
        for key,value in [('path','replacement.mov'),('startFrame',13),('locked',True)]:
            source={**self.doc['source'],key:value}
            self.assertNotEqual(bound,canonical_hash(source))
