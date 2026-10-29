import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import editor_plan_runtime as runtime


def fixture(root):
    srt=root/'raw.srt';srt.write_text('1\n00:00:00,000 --> 00:00:03,000\n用AI做视频设计软件\n\n2\n00:00:03,000 --> 00:00:06,000\n客户反馈帮助优化\n')
    video=root/'source.mov';video.write_bytes(b'source')
    media=root/'candidate.mp4';media.write_bytes(b'candidate')
    frame=root/'frame.png';frame.write_bytes(b'frame')
    probe=root/'probe.json';probe.write_text('{}')
    doc={'id':'p','revision':1,'canvas':{'width':1080,'height':1920,'fps':{'num':30,'den':1},'durationFrames':180},
         'source':{'path':str(video),'clips':[{'id':'main','startFrame':0,'durationFrames':180,'sourceInFrame':0}]},'instances':[],
         'productionPlan':{'script':'用AI做视频设计软件\n客户反馈帮助优化','shots':[{'id':'s1','narration':'用AI做视频设计软件','animationBrief':{'animationNeed':'none'}},{'id':'s2','narration':'客户反馈帮助优化'}]}}
    out=root/'out';out.mkdir();snapshot=root/'snapshot.json';snapshot.write_text(json.dumps({'document':doc}))
    request={'projectId':'p','jobId':'j','phase':'footage','workflowMode':'real-footage-v1','projectSnapshotPath':str(snapshot),
             'outputRoot':str(out),'packageRoot':str(out/'footage'),'resultManifestPath':str(out/'result-manifest.json'),
             'videoPath':str(video),'sourceSrtPath':str(srt),'canvas':doc['canvas'],'sources':[]}
    review={'schemaVersion':1,'workflowMode':'real-footage-v1','projectId':'p','sourceSrtPath':str(srt),'sourceVideoPath':str(video),
            'sections':[{'id':'s1','title':'上手','narration':'用AI做视频设计软件','sourceCueIds':[1],'footageNeed':'required',
                         'reason':'需要看到实际工具操作','visualTargets':[{'description':'真实编辑时间轴','action':'拖动轨道','searchQueries':['video editing timeline'],'evidenceRole':'illustration'}],'evidenceRestrictions':['图库不证明AI使用']},
                        {'id':'s2','title':'反馈','narration':'客户反馈帮助优化','sourceCueIds':[2],'footageNeed':'required',
                         'reason':'展示反馈迭代','visualTargets':[{'description':'原型评审','action':'共同检查原型','searchQueries':['prototype review'],'evidenceRole':'illustration'}],'evidenceRestrictions':[]}],
            'candidates':[{'id':'c','path':str(media),'sha256':runtime.digest(media),'width':1920,'height':1080,'durationSeconds':8,
                           'pageUrl':'https://www.pexels.com/video/example-1/','licenseUrl':'https://www.pexels.com/license/','reuseStatus':'downloadable','sourceKind':'stock',
                           'visibleContent':'编辑界面','matchedSectionIds':['s1','s2'],'matchReason':'实际操作时间轴','technical':{'passed':True,'decoded':True,'probePath':str(probe)},
                           'review':{'sampled':True,'frames':[{'path':str(frame),'sha256':runtime.digest(frame)}]}}],
            'placements':[{'id':'place','candidateId':'c','sectionId':'s1','sourceCueIds':[1],'startFrame':0,'durationFrames':90,'sourceInSeconds':1,'sourceOutSeconds':4,'layout':'contain','reason':'保留完整工具界面'}]}
    return request, review, doc


class FootagePackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)

    def test_complete_footage_review_includes_none_animation_section(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root)
        self.assertEqual(len(fp.validate_review(data,req,doc)['sections']),2)

    def test_missing_section_and_wrong_narration_cannot_pass(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root)
        for change in ['missing','changed']:
            bad=copy.deepcopy(data)
            if change=='missing':bad['sections'].pop()
            else:bad['sections'][0]['narration']='修改过的口播'
            with self.assertRaises(ValueError):fp.validate_review(bad,req,doc)

    def test_stock_cannot_be_evidence_for_private_claim(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root)
        data['sections'][0]['visualTargets'][0]['evidenceRole']='proof'
        data['placements'][0]['evidenceRole']='proof'
        with self.assertRaisesRegex(ValueError,'证据|proof'):fp.validate_review(data,req,doc)

    def test_placement_uses_actual_cues_and_media_window(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root)
        for key,value in [('startFrame',5),('sourceOutSeconds',10),('layout','stretch')]:
            bad=copy.deepcopy(data);bad['placements'][0][key]=value
            with self.assertRaises(ValueError):fp.validate_review(bad,req,doc)

    def test_few_candidates_is_reported_not_fake_complete(self):
        from tools import footage_package as fp
        req,data,_=fixture(self.root)
        report=fp.render_summary(data,req)
        self.assertIn('1 个',report)
        self.assertIn('候选不足',report)
        self.assertIn('上手',report)

    def test_undownloaded_links_are_shown_under_their_narration_not_as_usable_media(self):
        from tools import footage_package as fp
        req,data,_=fixture(self.root)
        data['searchLog']=[{'source':'网页检索','links':[
            {'id':'pending','title':'待下载编辑器','pageUrl':'https://example.com/editor',
             'status':'searched_not_downloaded','matchedSectionIds':['s1'],
             'matchReason':'为制作软件这句补画面，未验收'},
            {'id':'license','title':'官方原型演示','pageUrl':'https://example.com/prototype',
             'status':'license_pending','matchedSectionIds':['s2'],
             'matchReason':'解释客户反馈'}]}]
        report=fp.render_summary(data,req)
        first=report.split('## 01 上手',1)[1].split('## 02 反馈',1)[0]
        second=report.split('## 02 反馈',1)[1].split('## 搜索与未解决项',1)[0]
        self.assertIn('待下载编辑器',first)
        self.assertNotIn('官方原型演示',first)
        self.assertIn('官方原型演示',second)
        self.assertIn('对应口播：用AI做视频设计软件',first)
        self.assertIn('对应口播：客户反馈帮助优化',second)
        self.assertIn('未下载',first)
        self.assertIn('授权待核实',second)
        self.assertIn('可用候选：1 个',first)

    def test_search_lead_cannot_claim_an_unknown_sentence_or_unsafe_page(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root)
        lead={'id':'lead','title':'编辑器','pageUrl':'https://example.com/editor',
              'status':'searched_not_downloaded','matchedSectionIds':['s1'],
              'sourceCueIds':[1],'matchReason':'制作场景搜索目标，尚未验收'}
        data['searchLog']=[{'links':[lead]}]
        fp.validate_review(data,req,doc)
        for field,value in [('matchedSectionIds',['unknown']),('sourceCueIds',[2]),('pageUrl','javascript:alert(1)')]:
            bad=copy.deepcopy(data);bad['searchLog'][0]['links'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):
                fp.validate_review(bad,req,doc)

    def test_untrusted_ids_cannot_escape_evidence_directory(self):
        from tools import footage_package as fp
        req,data,_=fixture(self.root);data['candidates'][0]['id']='../../escape'
        path=Path(req['outputRoot'])/'review-input.json';path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError,'candidateId|ID'):
            fp.finalize(req,path)

    def test_finalize_publishes_library_candidates_and_independent_placement(self):
        from tools import footage_package as fp
        req,data,_=fixture(self.root);path=Path(req['outputRoot'])/'review-input.json';path.write_text(json.dumps(data))
        with patch.object(fp,'verify_media',return_value=None):result=fp.finalize(req,path)
        self.assertEqual(result['workflowMode'],'real-footage-v1')
        media=[r for r in result['results'] if r['kind']=='footage']
        self.assertEqual(len(media),2)
        self.assertIsNone(media[0]['footage']['placementId'])
        self.assertEqual(media[1]['footage']['placementId'],'place')
        self.assertTrue(Path(media[0]['media']['path']).is_relative_to(Path(req['outputRoot']).resolve()))
        self.assertTrue(all(Path(f['path']).is_file() for f in result['files']))

    def test_result_cannot_reference_a_different_review(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root);raw=Path(req['outputRoot'])/'raw.json';raw.write_text(json.dumps(data))
        with patch.object(fp,'verify_media',return_value=None):manifest=fp.finalize(req,raw)
        manifest['results'][0]['footage']['reviewSha256']='0'*64
        class Store:
            root=Path(req['outputRoot'])
            snapshot={'document':doc,'jobId':'j'}
            def publish(self,result):raise AssertionError('must validate before publishing')
        (Store.root/'external-job.json').write_text(json.dumps(req))
        with self.assertRaisesRegex(ValueError,'review|审稿'):
            runtime.ingest_workflow_manifest(manifest,Store())

    def test_static_image_has_zero_source_window(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root)
        data['candidates'][0].update(kind='image',durationSeconds=0)
        data['placements'][0].update(sourceInSeconds=0,sourceOutSeconds=0)
        fp.validate_review(data,req,doc)

    def test_finalized_review_cannot_be_overwritten(self):
        from tools import footage_package as fp
        req,data,_=fixture(self.root);raw=Path(req['outputRoot'])/'raw.json';raw.write_text(json.dumps(data))
        with patch.object(fp,'verify_media',return_value=None):manifest=fp.finalize(req,raw)
        before=Path(manifest['outputs']['footageReviewPath']).read_bytes()
        with self.assertRaisesRegex(ValueError,'不可覆盖'):fp.finalize(req,raw)
        self.assertEqual(before,Path(manifest['outputs']['footageReviewPath']).read_bytes())

    def test_real_720p_png_is_finalized_as_static_candidate_and_placement(self):
        from tools import footage_package as fp
        req,data,_=fixture(self.root)
        image=self.root/'actual.png'
        subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1',str(image)],check=True)
        c=data['candidates'][0];c.update(path=str(image),sha256=runtime.digest(image),kind='image',durationSeconds=0)
        data['placements'][0].update(sourceInSeconds=0,sourceOutSeconds=0)
        raw=Path(req['outputRoot'])/'raw.json';raw.write_text(json.dumps(data))
        result=fp.finalize(req,raw)
        actual=json.loads(Path(result['outputs']['footageReviewPath']).read_text())['candidates'][0]
        self.assertEqual((actual['kind'],actual['durationSeconds']),('image',0))
        self.assertEqual(len(result['results']),2)

    def test_sparse_cues_and_unknown_source_kind_are_rejected(self):
        from tools import footage_package as fp
        req,data,doc=fixture(self.root)
        data['candidates'][0]['sourceKind']='licensed-stock'
        with self.assertRaisesRegex(ValueError,'sourceKind|来源'):fp.validate_review(data,req,doc)
        cues=[{'start':0,'end':1},{'start':1,'end':2},{'start':2,'end':3}]
        with self.assertRaisesRegex(ValueError,'连续'):fp.cue_ranges(doc,cues,[1,3],'s')

    def test_footage_job_routes_without_animation_contract_or_claude_prompt(self):
        req,_,doc=fixture(self.root)
        data={'jobId':'j','projectId':'p','kind':'footage','document':doc,'videoPath':req['videoPath'],'sourceSrtPath':req['sourceSrtPath'],
              'scope':{'camera':False,'sound':False,'footage':True}}
        runtime.validate_snapshot(data)
        request=runtime.prepare_external_job(data,self.root/'worker')
        self.assertEqual(request['workflowMode'],'real-footage-v1')
        self.assertEqual(request['preferences']['networkMode'],'download-free')
        self.assertNotIn('animationPackage',request)


class ScopedFootageTests(unittest.TestCase):
    def test_selected_shot_only_and_cross_shot_rejected(self):
        from tools import footage_package as fp
        with tempfile.TemporaryDirectory() as folder:
            req,data,doc=fixture(Path(folder))
            doc['productionPlan']['shots'][0]['upstream']={'packageShot':{'sourceCueIds':[1]}}
            req.update(projectTarget={'shotId':'s1','rangeId':'r'},targetRange={'startFrame':0,'durationFrames':90})
            data['sections']=data['sections'][:1];data['candidates'][0]['matchedSectionIds']=['s1']
            self.assertEqual(fp.validate_review(data,req,doc),data)
            data['sections'][0].update(sourceCueIds=[2],narration='客户反馈帮助优化')
            with self.assertRaises(ValueError):fp.validate_review(data,req,doc)
    def test_scope_requires_frozen_real_cue_identity(self):
        from tools import footage_package as fp
        with tempfile.TemporaryDirectory() as folder:
            req,data,doc=fixture(Path(folder));req.update(projectTarget={'shotId':'s1'},targetRange={'startFrame':0,'durationFrames':90})
            with self.assertRaises(ValueError):fp.validate_review(data,req,doc)
    def test_partial_range_clips_placement_and_archived_cue_drift(self):
        from tools import footage_package as fp
        with tempfile.TemporaryDirectory() as folder:
            req,data,doc=fixture(Path(folder))
            doc['productionPlan']['shots'][0]['upstream']={'packageShot':{'sourceCueIds':[42]}}
            req.update(projectTarget={'shotId':'s1'},targetRange={'startFrame':30,'durationFrames':30})
            data['sections']=data['sections'][:1];data['candidates'][0]['matchedSectionIds']=['s1']
            data['placements'][0].update(startFrame=30,durationFrames=30,sourceOutSeconds=2)
            fp.validate_review(data,req,doc)
            data['placements'][0].update(startFrame=0,durationFrames=90,sourceOutSeconds=4)
            with self.assertRaises(ValueError):fp.validate_review(data,req,doc)
    def test_candidate_cannot_match_unselected_section(self):
        from tools import footage_package as fp
        with tempfile.TemporaryDirectory() as folder:
            req,data,doc=fixture(Path(folder));doc['productionPlan']['shots'][0]['sourceCueIds']=[1]
            req.update(projectTarget={'shotId':'s1'},targetRange={'startFrame':0,'durationFrames':90})
            data['sections']=data['sections'][:1]
            with self.assertRaises(ValueError):fp.validate_review(data,req,doc)
    def test_selected_cues_with_other_section_id_are_rejected(self):
        from tools import footage_package as fp
        with tempfile.TemporaryDirectory() as folder:
            req,data,doc=fixture(Path(folder));doc['productionPlan']['shots'][0]['sourceCueIds']=[1]
            req.update(projectTarget={'shotId':'s1'},targetRange={'startFrame':0,'durationFrames':90})
            data['sections']=data['sections'][:1];data['sections'][0]['id']='invented'
            data['candidates'][0]['matchedSectionIds']=['invented'];data['placements'][0]['sectionId']='invented'
            with self.assertRaisesRegex(ValueError,'shotId'):fp.validate_review(data,req,doc)
    def test_prepare_scoped_request_preserves_shared_srt_and_target(self):
        from tools import footage_package as fp
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);req,data,doc=fixture(root)
            doc['productionPlan']['shots'][0].update(sourceCueIds=[1],timing={'status':'manual','ranges':[{'id':'r','startFrame':0,'durationFrames':90}]},bindings=[])
            snap={'jobId':'j','projectId':'p','kind':'footage','workflowMode':'real-footage-v1','document':doc,'shotId':'s1','rangeId':'r',
                  'videoPath':req['videoPath'],'sourceSrtPath':req['sourceSrtPath'],'target':{'rangeId':'r','startFrame':0,'durationFrames':90},'instructions':'找一些使用和操作电脑的镜头','scope':{'footage':True}}
            output=runtime.prepare_external_job(snap,root/'prepared')
            self.assertEqual(output['sourceSrtPath'],req['sourceSrtPath']);self.assertEqual(output['targetRange'],snap['target'])
            self.assertEqual(output['projectTarget'],{'shotId':'s1','rangeId':'r'});self.assertTrue(output['scope']['footage'])
            self.assertEqual(output['preferences']['networkMode'],'download-free')
            data['sections']=data['sections'][:1];data['candidates'][0]['matchedSectionIds']=['s1']
            with self.assertRaisesRegex(ValueError,'语义'):
                fp.validate_review(data,output,doc)
            data['semanticReviewVersion']=1
            data['sections'][0]['semanticIntent']={'affirmed':['操作电脑'],'contrasted':[],'relations':[]}
            candidate=data['candidates'][0];candidate['review']['frames'][0]['seconds']=2
            candidate['semanticMatches']=[{'sectionId':'s1','sourceCueIds':[1], 'sourceInSeconds':1,'sourceOutSeconds':4,
                'verdict':'aligned','observedAction':'实际操作电脑','relationEvidence':[],
                'framePaths':[candidate['review']['frames'][0]['path']]}]
            fp.validate_review(data,output,doc)

class SemanticFootageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.req,self.data,self.doc=fixture(Path(self.tmp.name))
        self.data['semanticReviewVersion']=1
        self.data['candidates'][0]['review']['frames'][0]['seconds']=2
        for section in self.data['sections']:
            section['semanticIntent']={'affirmed':['实际工具操作'], 'contrasted':[], 'relations':[]}
        self.data['sections'][0]['semanticIntent']['relations']=[{'id':'mouth-distance','description':'嘴与麦克风在同一画面内可见且距离很近'}]
        self.data['candidates'][0]['semanticMatches']=[
            {'sectionId':'s1','sourceCueIds':[1], 'sourceInSeconds':1,'sourceOutSeconds':4,
             'verdict':'aligned','observedAction':'人物开口说话，嘴与麦克风相距很近',
             'relationEvidence':[{'relationId':'mouth-distance','visible':True,'observation':'嘴和拾音头同框，二者距离可直接辨认'}],
             'framePaths':[self.data['candidates'][0]['review']['frames'][0]['path']]},
            {'sectionId':'s2','sourceCueIds':[2], 'sourceInSeconds':0,'sourceOutSeconds':8,
             'verdict':'uncertain','observedAction':'无法确认反馈迭代','relationEvidence':[],
             'framePaths':[self.data['candidates'][0]['review']['frames'][0]['path']]}]

    def test_contradictory_or_uncertain_action_cannot_be_recommended(self):
        from tools import footage_package as fp
        for verdict in ['contradictory','uncertain']:
            with self.subTest(verdict=verdict):
                bad=copy.deepcopy(self.data);bad['candidates'][0]['semanticMatches'][0]['verdict']=verdict
                with self.assertRaisesRegex(ValueError,'语义|semantic'):
                    fp.validate_review(bad,self.req,self.doc)

    def test_relation_must_be_visibly_supported_in_recommended_window(self):
        from tools import footage_package as fp
        for change in ['invisible','missing','outside','other-cue','uninspected-frame','frame-outside-window']:
            bad=copy.deepcopy(self.data);match=bad['candidates'][0]['semanticMatches'][0]
            if change=='invisible':match['relationEvidence'][0]['visible']=False
            if change=='missing':match['relationEvidence']=[]
            if change=='outside':match['sourceInSeconds']=2
            if change=='other-cue':match['sourceCueIds']=[2]
            if change=='uninspected-frame':match['framePaths']=['/uninspected.png']
            if change=='frame-outside-window':bad['candidates'][0]['review']['frames'][0]['seconds']=7
            with self.subTest(change=change),self.assertRaisesRegex(ValueError,'语义|关系|目检|semantic'):
                fp.validate_review(bad,self.req,self.doc)

    def test_finalize_preserves_binding_to_archived_inspected_frames(self):
        from tools import footage_package as fp
        raw=Path(self.req['outputRoot'])/'raw.json';raw.write_text(json.dumps(self.data))
        with patch.object(fp,'verify_media',return_value=None):manifest=fp.finalize(self.req,raw)
        published=json.loads(Path(manifest['outputs']['footageReviewPath']).read_text())
        candidate=published['candidates'][0]
        self.assertEqual(candidate['semanticMatches'][0]['framePaths'],[candidate['review']['frames'][0]['path']])

    def test_semantic_contract_is_required_when_new_request_declares_it(self):
        from tools import footage_package as fp
        self.req['semanticReviewVersion']=1;self.data.pop('semanticReviewVersion')
        with self.assertRaisesRegex(ValueError,'语义|semantic'):
            fp.validate_review(self.data,self.req,self.doc)

    def test_aligned_review_passes_without_keyword_matching_and_legacy_is_explicit(self):
        from tools import footage_package as fp
        fp.validate_review(self.data,self.req,self.doc)
        old=copy.deepcopy(self.data);old.pop('semanticReviewVersion')
        fp.validate_review(old,self.req,self.doc)
        self.assertIn('未记录逐句语义验收',fp.render_summary(old,self.req))
        report=fp.render_summary(self.data,self.req)
        self.assertIn('嘴与麦克风',report)
        self.assertIn('语义适配候选：0 个',report)
        self.assertIn('uncertain',report)

class FootageSemanticRequestDefaultsTests(unittest.TestCase):
    def test_new_footage_requests_freeze_semantic_gate_for_direct_and_parent_jobs(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);req,_,doc=fixture(root)
            for label,parent in [('direct',{}),('child',{'parentJobId':'package-parent'})]:
                with self.subTest(label=label):
                    data={'jobId':'j','projectId':'p','kind':'footage','document':doc,
                          'videoPath':req['videoPath'],'sourceSrtPath':req['sourceSrtPath'],**parent}
                    request=runtime.prepare_external_job(data,root/label)
                    self.assertEqual(request.get('semanticReviewVersion'),1)
                    frozen=json.loads(Path(request['projectSnapshotPath']).read_text())
                    self.assertEqual(frozen.get('semanticReviewVersion'),1)
                    binding=next(s for s in request['sources'] if s['path']==request['projectSnapshotPath'])
                    self.assertEqual(binding['sha256'],runtime.digest(request['projectSnapshotPath']))
                    self.assertNotIn('semanticReviewVersion',data)
            legacy={**data,'workflowMode':'legacy-visual-v1'}
            request=runtime.prepare_external_job(legacy,root/'legacy')
            self.assertNotIn('semanticReviewVersion',request)
            self.assertNotIn('semanticReviewVersion',json.loads(Path(request['projectSnapshotPath']).read_text()))

    def test_worker_binds_semantic_default_before_immutable_snapshot_and_dispatch(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);req,_,doc=fixture(root)
            snapshot=root/'incoming.json';snapshot.write_text(json.dumps({'jobId':'j','projectId':'p','kind':'footage',
                'parentJobId':'package-parent','document':doc,'videoPath':req['videoPath'],'sourceSrtPath':req['sourceSrtPath']}))
            incoming_hash=runtime.digest(snapshot);seen=[]
            def stop_before_model(command,cwd,store,*args):
                frozen=json.loads((store.root/'input-snapshot.json').read_text())
                request=json.loads((store.root/'external-job.json').read_text())
                self.assertEqual(frozen.get('semanticReviewVersion'),1)
                self.assertEqual(store.snapshot.get('semanticReviewVersion'),1)
                self.assertEqual(request.get('semanticReviewVersion'),1)
                self.assertEqual(store.status['snapshotHash'],runtime.json_digest(frozen))
                seen.append(True)
                raise runtime.WorkerCancelled()
            with patch.object(runtime,'run_process',side_effect=stop_before_model):
                result=runtime.worker(snapshot,root/'worker')
            self.assertEqual(seen,[True]);self.assertEqual(result['state'],'cancelled')
            self.assertEqual(incoming_hash,runtime.digest(snapshot))
