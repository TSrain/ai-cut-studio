import copy
import json
from pathlib import Path
import unittest
import tempfile
from tools import animation_package as ap


def fixture(tmp_path):
    srt=tmp_path/'raw.srt'; srt.write_text('1\n00:00:00,000 --> 00:00:03,000\n工具降低执行成本\n\n2\n00:00:03,000 --> 00:00:06,000\n经验仍然影响判断\n')
    script=tmp_path/'final.md';script.write_text('工具降低执行成本\n经验仍然影响判断')
    doc={'id':'p','canvas':{'width':1080,'height':1920,'fps':{'num':30,'den':1},'durationFrames':180},'source':{'path':'video.mov','clips':[{'id':'main','startFrame':0,'durationFrames':180,'sourceInFrame':0}]},'instances':[],'productionPlan':{'script':script.read_text(),'shots':[]}}
    request={'projectId':'p','jobId':'j','sourceSrtPath':str(srt),'finalScriptPath':str(script),'videoPath':None,'canvas':doc['canvas'],'projectPlanPath':str(tmp_path/'plan.json'),'projectSnapshotPath':str(tmp_path/'snapshot.json'),'outputRoot':str(tmp_path),'packageRoot':str(tmp_path/'package'),'resultManifestPath':str(tmp_path/'result-manifest.json')}
    Path(request['projectPlanPath']).write_text(json.dumps(doc['productionPlan']))
    Path(request['projectSnapshotPath']).write_text(json.dumps({'document':doc,'projectId':'p','jobId':'j','kind':'package'}))
    analysis={'schemaVersion':1,'workflowMode':'semantic-template-v1','projectId':'p','sourceSrtPath':str(srt),'sourceVideoPath':None,'sections':[{'id':'s','title':'成本与判断','narration':'工具降低执行成本经验仍然影响判断','sourceCueIds':[1,2],'animationNeed':'required','goal':'理解工具与经验分别影响不同成本','information':['执行成本下降','判断仍依赖经验'],'relations':['工具能力不能等同判断能力'],'boundaries':['不宣称经验不能学习'],'reason':'容易把执行和判断混为一谈','templateMatch':{'status':'direct','presetId':'contrast-pair','props':{'slots':{'leftLabel':'执行','leftText':'工具降低成本','rightLabel':'判断','rightText':'经验形成标准'},'variant':{'symbol':'≠'}},'reason':'原生对照可以覆盖这层区别','gaps':[]}}]}
    return request,analysis,doc



class AnimationPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.tmp_path=Path(self.temp.name)

    def test_disabled_templates_accepts_semantics_and_never_emits_template_results(self):
        from unittest.mock import patch
        req, analysis, doc = fixture(self.tmp_path)
        req['scope'] = {'templates': False}
        req['templateReviewVersion'] = 1  # obsolete flag must not revive matching
        analysis['sections'][0].pop('templateMatch')
        doc['instances'] = [{'id': 'manual-template', 'props': {'title': 'keep'}}]
        original = copy.deepcopy(doc)
        with patch.object(ap, 'catalog', side_effect=AssertionError('catalog must not load')):
            ap.validate_analysis(analysis, req)
            plan, templates, issues = ap.build_plan(analysis, req, doc)
            report = ap.summary(analysis, req, templates, issues)
            analysis_path = self.tmp_path / 'analysis.json'
            analysis_path.write_text(json.dumps(analysis))
            manifest = ap.finalize(req, analysis_path)
            self.assertNotIn('templateCapabilitiesPath', manifest['outputs'])
            self.assertFalse(any(r['kind'] == 'template' for r in manifest['results']))
            analysis['sections'][0]['templateMatch'] = {'status': 'direct', 'presetId': 'stale', 'props': {}, 'reason': 'old'}
            self.assertEqual(ap.build_plan(analysis, req, doc)[1], [])
        self.assertEqual(templates, [])
        self.assertEqual(issues, [])
        self.assertEqual(doc, original)
        self.assertIn('Claude', report)
        self.assertNotIn('全文分析与模板匹配', report)

    def test_equivalent_source_normalization_preserves_existing_range_ids(self):
        req,analysis,doc=fixture(self.tmp_path)
        plan,_,_=ap.build_plan(analysis,req,doc)
        doc['productionPlan']=plan
        doc['source']['clips'][0]['id']='source-main'
        updated,_,_=ap.build_plan(analysis,req,doc)
        self.assertEqual(updated['shots'][0]['timing'],plan['shots'][0]['timing'])

    def test_explicit_template_interval_stays_inside_narration_range(self):
        req,analysis,doc=fixture(self.tmp_path)
        match=analysis['sections'][0]['templateMatch']
        match.update(startSeconds=1,durationSeconds=4)
        _,templates,issues=ap.build_plan(analysis,req,doc)
        self.assertEqual(issues,[])
        self.assertEqual(templates[0]['target']['startFrame'],30)
        self.assertEqual(templates[0]['target']['durationFrames'],120)
        self.assertEqual(templates[0]['template']['props']['durationSeconds'],4)
        match.update(startSeconds=5,durationSeconds=2)
        _,templates,issues=ap.build_plan(analysis,req,doc)
        self.assertEqual(templates,[])
        self.assertTrue(issues)

    def test_prompt_has_srt_and_deletable_blocks_without_template_or_seconds(self):
        tmp_path=self.tmp_path
        req,a,_=fixture(tmp_path)
        prompt=ap.render_claude_prompt(a,req)
        assert str(tmp_path/'raw.srt') in prompt
        assert '段落 01｜成本与判断' in prompt and '段落 01 结束' in prompt
        assert '工具降低执行成本经验仍然影响判断' in prompt
        assert 'contrast-pair' not in prompt and 'leftText' not in prompt
        assert '0.000' not in prompt and '6.000' not in prompt
        assert '不重复' in prompt

    def test_prompt_requires_authoritative_independent_delivery_list(self):
        req, analysis, _ = fixture(self.tmp_path)
        prompt = ap.render_claude_prompt(analysis, req)
        self.assertIn('animation-delivery.json', prompt)
        for field in ('file', 'startSeconds', 'durationSeconds', 'transparent', 'timeBase'):
            self.assertIn(field, prompt)
        self.assertIn('跨段', prompt)
        self.assertIn('原口播音频', prompt)
        self.assertNotIn('定位辅助', prompt)


    def test_semantic_analysis_requires_complete_source_coverage_and_no_visual_fields(self):
        tmp_path=self.tmp_path
        req,a,_=fixture(tmp_path)
        ap.validate_analysis(a,req)
        b=copy.deepcopy(a);b['sections'][0]['states']={'start':'two cards'}
        with self.assertRaisesRegex(ValueError,'视觉'):ap.validate_analysis(b,req)
        b=copy.deepcopy(a);b['sections'][0]['sourceCueIds']=[1]
        with self.assertRaisesRegex(ValueError,'口播|覆盖'):ap.validate_analysis(b,req)


    def test_plan_preserves_instances_manual_timing_and_uses_real_srt(self):
        tmp_path=self.tmp_path
        req,a,doc=fixture(tmp_path)
        plan,templates,issues=ap.build_plan(a,req,doc)
        assert plan['shots'][0]['timing']['ranges'][0]['durationFrames']==180
        assert plan['shots'][0]['approval']!='approved'
        assert templates[0]['kind']=='template' and templates[0]['template']['id']=='contrast-pair'
        assert not issues
        existing=copy.deepcopy(plan['shots'][0]);existing['timing']={'status':'manual','manual':True,'ranges':[{'id':'hand','startFrame':10,'durationFrames':90}]};existing['bindings']=[{'instanceId':'old','slotId':'s-primary','status':'current'}]
        doc['productionPlan']['shots']=[existing];doc['instances']=[{'id':'old','props':{'slots':{'title':'手调'}}}]
        plan,templates,_=ap.build_plan(a,req,doc)
        assert plan['shots'][0]['timing']==existing['timing']
        assert plan['shots'][0]['bindings']==existing['bindings']
        assert doc['instances'][0]['props']['slots']['title']=='手调'
        assert templates[0]['target']['rangeId']=='hand'


    def test_none_match_does_not_trigger_custom_and_none_segments_stay_out_of_prompt(self):
        tmp_path=self.tmp_path
        req,a,doc=fixture(tmp_path)
        a['sections'][0]['templateMatch']={'status':'none','presetId':None,'reason':'没有关系演示模板','gaps':['因果过程无法直接覆盖']}
        plan,templates,_=ap.build_plan(a,req,doc)
        assert templates==[] and plan['shots'][0]['animationBrief']['goal']==a['sections'][0]['goal']
        a['sections'][0]['animationNeed']='none'
        assert '段落 01｜' not in ap.render_claude_prompt(a,req)


    def test_finalize_manifest_is_plan_then_template_without_receipt(self):
        tmp_path=self.tmp_path
        req,a,_=fixture(tmp_path)
        path=tmp_path/'analysis.json';path.write_text(json.dumps(a,ensure_ascii=False))
        result=ap.finalize(req,path)
        assert result['workflowMode']=='semantic-template-v1'
        assert result['state']=='complete'
        assert result['results'][0]['kind']=='plan'
        assert result['results'][1]['kind']=='template'
        assert Path(result['outputs']['planPath']).read_text().endswith(ap.render_claude_prompt(a,req))
        assert all(Path(f['path']).is_file() for f in result['files'])
        assert not (tmp_path/'motion-execution-receipt.json').exists()

    def test_new_manifest_ingests_plan_then_new_template_identity_without_motion_receipt(self):
        from tools import editor_plan_runtime as runtime
        req,a,doc=fixture(self.tmp_path)
        path=self.tmp_path/'analysis.json';path.write_text(json.dumps(a,ensure_ascii=False))
        manifest=ap.finalize(req,path)
        snapshot={'projectId':'p','jobId':'j','kind':'package','document':doc}
        Path(self.tmp_path/'external-job.json').write_text(json.dumps(req))
        store=runtime.ResultStore(self.tmp_path,snapshot)
        runtime.ingest_workflow_manifest(manifest,store)
        self.assertEqual([r['kind'] for r in store.results.values()],['plan','template'])

    def test_new_package_transport_has_no_storyboard_approval_record(self):
        from tools import editor_plan_runtime as runtime
        req,a,doc=fixture(self.tmp_path)
        doc['source']=None
        snapshot={'projectId':'p','jobId':'j','kind':'package','document':doc,'sourceSrtPath':req['sourceSrtPath']}
        output=self.tmp_path/'transport'
        request=runtime.prepare_external_job(snapshot,output)
        self.assertEqual(request['workflowMode'],ap.MODE)
        self.assertNotIn('storyboardApprovalPath',request)
        self.assertEqual(request['sourceSrtPath'],req['sourceSrtPath'])

    def test_recognition_uses_matched_cue_start_and_actual_media_duration(self):
        from tools import editor_plan_runtime as runtime
        req,a,doc=fixture(self.tmp_path)
        plan,_,_=ap.build_plan(a,req,doc);doc['productionPlan']=plan
        data={'projectId':'p','jobId':'j','kind':'recognize','document':doc,'sourceSrtPath':req['sourceSrtPath']}
        probe={'kind':'video','durationSeconds':3,'width':1080,'height':1920,'sha256':'a'*64,'probePath':'/probe.json','hasAlpha':False,'frames':[]}
        result=runtime.recognition_result(data,'/clip.mp4',probe,{'shotId':'s','slotId':'s-primary','sourceInSeconds':0,'sourceOutSeconds':3,'targetCueIds':[2],'passed':True,'evidence':'画面文字对应判断仍依赖经验','uncertainties':[]})
        self.assertEqual(result['target']['startFrame'],90)
        self.assertEqual(result['target']['durationFrames'],90)
        self.assertNotIn('instanceId',result['target'])

    def test_existing_requirements_advance_version_before_template_transport(self):
        req,a,doc=fixture(self.tmp_path)
        old={'id':'s','title':'旧说明','narration':a['sections'][0]['narration'],'visualRequirement':'旧目标','mediaDescription':'旧说明','requirementVersion':4,'approval':'approved','slots':[{'id':'s-primary','type':'animation','description':'旧说明','requirementVersion':4}],'bindings':[{'instanceId':'old','slotId':'s-primary','status':'current','requirementVersion':4}],'timing':{'manual':False,'status':'aligned','ranges':[]}}
        doc['productionPlan']['shots']=[old]
        plan,templates,_=ap.build_plan(a,req,doc)
        self.assertEqual(plan['shots'][0]['requirementVersion'],5)
        self.assertEqual(templates[0]['requirementVersion'],5)
        self.assertEqual(plan['shots'][0]['bindings'][0]['instanceId'],'old')

    def test_stale_summary_sources_are_rejected_before_finalization(self):
        req,a,_=fixture(self.tmp_path);req['sources']=[{'path':req['sourceSrtPath'],'sha256':'0'*64}]
        path=self.tmp_path/'analysis.json';path.write_text(json.dumps(a))
        with self.assertRaisesRegex(ValueError,'SHA'):
            ap.finalize(req,path)

    def test_prompt_uses_explicit_visualization_root(self):
        req,a,_=fixture(self.tmp_path);req['visualizationRoot']=str(self.tmp_path/'isolated-visualization')
        prompt=ap.render_claude_prompt(a,req)
        self.assertIn(str(self.tmp_path/'isolated-visualization/AGENTS.md'),prompt)
        self.assertNotIn('../studio/AGENTS.md',prompt)

    def test_partial_clip_without_location_cues_has_explicit_placement_gap(self):
        from tools import editor_plan_runtime as runtime
        req,a,doc=fixture(self.tmp_path);plan,_,_=ap.build_plan(a,req,doc);doc['productionPlan']=plan
        probe={'kind':'video','durationSeconds':2,'width':1080,'height':1920,'sha256':'a'*64,'probePath':'/probe.json','hasAlpha':False,'frames':[]}
        result=runtime.recognition_result({'projectId':'p','jobId':'j','kind':'recognize','document':doc,'sourceSrtPath':req['sourceSrtPath']},'/clip.mp4',probe,{'shotId':'s','slotId':'s-primary','sourceInSeconds':0,'sourceOutSeconds':2,'targetCueIds':[],'passed':True,'evidence':'内容相关','uncertainties':['起点无法确认']})
        self.assertFalse(result['placementReview']['passed'])
        self.assertEqual(result['state'],'pending')

    def test_image_matching_later_cue_uses_mapped_display_duration(self):
        from tools import editor_plan_runtime as runtime
        req,a,doc=fixture(self.tmp_path);plan,_,_=ap.build_plan(a,req,doc);doc['productionPlan']=plan
        probe={'kind':'image','durationSeconds':0,'width':1080,'height':1920,'sha256':'a'*64,'probePath':'/probe.json','hasAlpha':False,'frames':[]}
        result=runtime.recognition_result({'projectId':'p','jobId':'j','kind':'recognize','document':doc,'sourceSrtPath':req['sourceSrtPath']},'/clip.png',probe,{'shotId':'s','slotId':'s-primary','sourceInSeconds':0,'sourceOutSeconds':None,'targetCueIds':[2],'passed':True,'evidence':'第二句的判断标准','uncertainties':[]})
        self.assertEqual(result['target']['startFrame'],90)
        self.assertEqual(result['target']['durationFrames'],90)

    def test_native_overlay_uses_existing_transparent_background_parameter(self):
        req,a,doc=fixture(self.tmp_path)
        doc['productionPlan']['shots']=[{'id':'s','requirementVersion':1,'slots':[{'id':'s-primary','type':'animation','description':'对照','presentationMode':'overlay','requirementVersion':1}],'bindings':[],'timing':{'manual':False,'status':'unaligned','ranges':[]}}]
        _,templates,_=ap.build_plan(a,req,doc)
        self.assertEqual(templates[0]['template']['props']['editorBackground'],'transparent')

    def test_broll_transports_existing_templates_without_rebuilding_claude_prompt(self):
        from tools import editor_plan_runtime as runtime
        req,a,doc=fixture(self.tmp_path)
        plan,templates,_=ap.build_plan(a,req,doc);doc['productionPlan']=plan
        snapshot={'projectId':'p','jobId':'j','kind':'broll','document':doc}
        req['phase']='broll';Path(self.tmp_path/'external-job.json').write_text(json.dumps(req))
        store=runtime.ResultStore(self.tmp_path,snapshot)
        manifest={'version':1,'workflowMode':ap.MODE,'jobId':'j','state':'complete','files':[],'results':templates,'outputs':{}}
        runtime.ingest_workflow_manifest(manifest,store)
        self.assertEqual(len(store.results),1)
        self.assertEqual(next(iter(store.results.values()))['kind'],'template')
        self.assertFalse((self.tmp_path/'plan.md').exists())

    def test_recognition_worker_rejects_old_srt_after_source_replacement(self):
        from tools import editor_plan_runtime as runtime
        req,a,doc=fixture(self.tmp_path)
        video=self.tmp_path/'replacement.mov';video.write_bytes(b'replaced source')
        doc['source']['path']=str(video)
        doc['productionPlan']['transcriptBinding']={'sourceSha256':'0'*64,'transcriptSha256':ap.digest(req['sourceSrtPath'])}
        data={'projectId':'p','jobId':'j','kind':'recognize','document':doc,'videoPath':str(video),'sourceSrtPath':req['sourceSrtPath'],'mediaPaths':[]}
        path=self.tmp_path/'source-snapshot.json';path.write_text(json.dumps(data))
        result=runtime.worker(path,self.tmp_path/'rejected-worker')
        self.assertEqual(result['state'],'failed')
        self.assertIn('主口播已改变',result['error'])
