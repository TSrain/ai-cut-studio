import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from tools import package_edit_transcript as edited
from tools import editor_plan_runtime as runtime
from tools.transcribe import load_cues


class LatestTranscriptTests(unittest.TestCase):
    def document(self):
        return {'id':'p','revision':4,'canvas':{'fps':{'num':30,'den':1},'durationFrames':90},
                'source':{'path':'/original.mp4','clips':[{'id':'cut','startFrame':0,'sourceInFrame':300,'durationFrames':60}]},
                'captions':{'cues':[{'id':'a','startFrame':0,'endFrame':30,'text':'手工纠正。','originalText':'错误'},
                                    {'id':'b','startFrame':75,'endFrame':90,'text':'删除段。'}]}}

    def test_current_project_cues_trim_deleted_source_without_mapping_twice(self):
        with tempfile.TemporaryDirectory() as tmp:
            got=edited.derive(self.document(),Path(tmp))
            cues=load_cues(Path(got['sourceSrtPath']))
            self.assertEqual(cues,[{'start':0.0,'end':1.0,'text':'手工纠正。'}])
            self.assertEqual(got['transcriptTimeBase'],'project')
            self.assertIn('手工纠正。',got['script'])
            self.assertNotIn('删除段',got['script'])
            self.assertTrue(Path(got['transcriptProvenancePath']).is_file())

    def test_missing_latest_cues_is_actionable_not_asr(self):
        doc=self.document();doc['captions']['cues']=[]
        with tempfile.TemporaryDirectory() as tmp,self.assertRaisesRegex(ValueError,'字幕'):
            edited.derive(doc,Path(tmp))

    def test_prepare_uses_latest_text_without_registering_original_source(self):
        doc=self.document();doc.update(instances=[],productionPlan={'script':'旧稿','shots':[]})
        with tempfile.TemporaryDirectory() as tmp:
            original=Path(tmp)/'original.mp4';original.write_bytes(b'original')
            old=Path(tmp)/'old.srt';old.write_text('1\n00:00:10,000 --> 00:00:11,000\n错误\n')
            doc['source']['path']=str(original)
            data={'jobId':'j','projectId':'p','kind':'package','packageOrchestrationVersion':2,'document':doc,'sourceSrtPath':str(old)}
            with patch('tools.transcribe.register_transcript',side_effect=AssertionError('cache contamination')),patch('tools.transcribe.transcribe',side_effect=AssertionError('ASR')):
                got=runtime.prepare_external_job(data,Path(tmp)/'out')
            self.assertEqual(got['transcriptTimeBase'],'project')
            self.assertIn('手工纠正。',Path(got['finalScriptPath']).read_text())
            self.assertNotEqual(got['sourceSrtPath'],str(old))
            self.assertIn('错误',old.read_text())

    def test_animation_timing_uses_project_ranges_once(self):
        from tools import animation_package
        doc=self.document();doc['productionPlan']={'shots':[]}
        with tempfile.TemporaryDirectory() as tmp:
            got=edited.derive(doc,Path(tmp))
            request=dict(got,projectId='p',visualizationRoot=tmp)
            analysis={'sourceSrtPath':got['sourceSrtPath'],'sections':[{'id':'s','title':'标题','narration':'手工纠正。','information':[], 'relations':[],'boundaries':[],'reason':'理由', 'goal':'目标','animationNeed':'none','templateMatch':{'status':'none'},'sourceCueIds':[1]}]}
            plan,_,_=animation_package.build_plan(analysis,request,doc)
            self.assertEqual(plan['shots'][0]['timing']['ranges'][0]['startFrame'],0)
            self.assertEqual(plan['shots'][0]['timing']['ranges'][0]['durationFrames'],30)
            self.assertEqual(plan['transcriptTimeBase'],'project')

    def test_timeline_does_not_register_derived_project_srt_as_raw_audio(self):
        from tools import broll_timeline
        import sys
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
        with tempfile.TemporaryDirectory() as tmp:
            doc=self.document();audio=Path(tmp)/'raw.mp4';audio.write_bytes(b'raw');doc['source']['path']=str(audio)
            got=edited.derive(doc,Path(tmp))
            with patch.object(broll_timeline,'probe_duration',return_value=40),patch('transcribe.register_transcript',side_effect=AssertionError('cache contamination')):
                result=broll_timeline.build(got['script'],[],Path(tmp)/'raw.mp4',False,Path(tmp)/'timeline',False,Path(got['sourceSrtPath']))
            self.assertEqual(result['transcript_time_base'],'project')
            self.assertEqual(result['audio_duration'],3)

    def test_branch_context_prioritizes_derived_srt_and_declares_project_time(self):
        from tools.package_branch_inputs import build_branch_input
        doc=self.document();doc['captions']['style']={'fontSize':50}
        with tempfile.TemporaryDirectory() as tmp:
            got=edited.derive(doc,Path(tmp))
            doc['source']['path']=str(Path(tmp)/'source.mp4');Path(doc['source']['path']).write_bytes(b'source')
            request=dict(got,projectId='p',projectSnapshot={'document':doc},branchInputs={'captions':{'cues':[{'text':'旧覆写'}]}})
            request['finalScriptPath']=str(Path(tmp)/'final.md');Path(request['finalScriptPath']).write_text(got['script'])
            bundle=build_branch_input(request,{'sections':[{'id':'s','narration':'手工纠正。'}]},'captions')
            self.assertEqual(bundle['common']['transcriptTimeBase'],'project')
            self.assertEqual(bundle['input']['cues'],[{'id':1,'start':0.0,'end':1.0,'text':'手工纠正。'}])
            self.assertEqual(bundle['input']['captions']['style'],{'fontSize':50})
            self.assertEqual(len(bundle['input']['captions']['cues']),2)

    def test_cue_spanning_source_gap_keeps_manual_narration_once(self):
        doc=self.document();doc['source']['clips']=[{'startFrame':0,'sourceInFrame':0,'durationFrames':15},{'startFrame':25,'sourceInFrame':50,'durationFrames':35}]
        with tempfile.TemporaryDirectory() as tmp:
            got=edited.derive(doc,Path(tmp))
            self.assertEqual(got['script'].count('手工纠正。'),1)

    def test_downstream_alignment_and_footage_keep_project_time(self):
        from tools.footage_package import cue_ranges
        doc=self.document();doc['productionPlan']={'transcriptTimeBase':'project','shots':[]}
        cues=[{'start':0,'end':1,'text':'手工纠正。'}]
        self.assertEqual(cue_ranges(doc,cues,[1],'s')[0]['durationFrames'],30)
        result=runtime.alignment_result(doc,{'id':'s'},dict(cues[0],confidence=1),'/original.mp4')
        self.assertEqual(result['alignment']['timing']['ranges'][0]['durationFrames'],30)

    def test_recognition_uses_plan_project_time(self):
        doc=self.document();shot={'id':'s','requirementVersion':1,'slots':[{'id':'slot'}],'timing':{'status':'aligned','ranges':[{'id':'r','startFrame':0,'durationFrames':60}]}}
        doc['productionPlan']={'transcriptTimeBase':'project','shots':[shot]}
        with tempfile.TemporaryDirectory() as tmp:
            got=edited.derive(doc,Path(tmp));data={'kind':'recognize','document':doc,'sourceSrtPath':got['sourceSrtPath'],'projectId':'p','shotId':'s','slotId':'slot'}
            probe={'kind':'image','width':1080,'height':1080,'durationSeconds':0,'probePath':'p','sha256':'a','frames':[]}
            with patch.object(runtime,'overlay_technical',return_value={'alphaPassed':True}):
                result=runtime.recognition_result(data,Path(tmp)/'image.png',probe,{'shotId':'s','slotId':'slot','targetCueIds':[1],'passed':True,'evidence':'fixture'})
            self.assertEqual(result['target']['startFrame'],0)
            self.assertEqual(result['target']['durationFrames'],30)

    def test_timeline_rejects_other_source_and_stale_clip_identity(self):
        from tools import broll_timeline
        with tempfile.TemporaryDirectory() as tmp:
            doc=self.document();audio=Path(tmp)/'raw.mp4';audio.write_bytes(b'raw');doc['source']['path']=str(audio)
            got=edited.derive(doc,Path(tmp))
            other=Path(tmp)/'other.mp4';other.write_bytes(b'other')
            with self.assertRaisesRegex(ValueError,'source'):
                broll_timeline.build(got['script'],[],other,False,Path(tmp)/'timeline',False,Path(got['sourceSrtPath']))
            doc['source']['clips'][0]['sourceInFrame']+=1
            with self.assertRaisesRegex(ValueError,'clips'):
                broll_timeline.build(got['script'],[],audio,False,Path(tmp)/'timeline',False,Path(got['sourceSrtPath']),project_document=doc)

    def test_added_alignment_shot_keeps_project_time(self):
        doc=self.document();doc['productionPlan']={'transcriptTimeBase':'project','shots':[]}
        cues=[{'id':'cue-00001','start':0,'end':1,'text':'手工纠正。'}]
        review={'addedSections':[{'cueIds':['cue-00001'],'narration':'手工纠正。','confidence':1,'reason':'new'}]}
        result=runtime.alignment_plan_delta({'document':doc},review,cues,'hash','review.json')
        self.assertEqual(result['plan']['shots'][0]['timing']['ranges'][0]['durationFrames'],30)

    def test_project_timeline_requires_bound_provenance(self):
        from tools import broll_timeline
        with tempfile.TemporaryDirectory() as tmp:
            srt=Path(tmp)/'unbound.srt';srt.write_text('1\n00:00:00,000 --> 00:00:01,000\n正文\n')
            with self.assertRaisesRegex(ValueError,'provenance'):
                broll_timeline.build('## 完整口播脚本\n\n正文',[],Path(tmp)/'raw.mp4',False,Path(tmp)/'timeline',False,srt,transcript_time_base='project',project_duration=3)

    def test_followup_broll_request_retains_bound_plan_timebase(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc=self.document();audio=Path(tmp)/'raw.mp4';audio.write_bytes(b'raw');doc['source']['path']=str(audio)
            got=edited.derive(doc,Path(tmp));doc.update(instances=[],productionPlan={'script':got['script'],'shots':[],**{k:v for k,v in got.items() if k!='script'}})
            data={'kind':'broll','projectId':'p','jobId':'follow','document':doc,'sourceSrtPath':got['sourceSrtPath']}
            request=runtime.prepare_external_job(data,Path(tmp)/'follow')
            self.assertEqual(request['transcriptTimeBase'],'project')
            self.assertEqual(request['transcriptProvenancePath'],got['transcriptProvenancePath'])

    def test_archived_transcript_pair_uses_explicit_provenance_and_source_hash(self):
        from tools import broll_timeline
        with tempfile.TemporaryDirectory() as tmp:
            doc=self.document();audio=Path(tmp)/'raw.mp4';audio.write_bytes(b'raw');doc['source']['path']=str(audio)
            got=edited.derive(doc,Path(tmp));archived=Path(tmp)/'archived.mp4';archived.write_bytes(audio.read_bytes())
            srt=Path(tmp)/'srt-sha.srt';srt.write_bytes(Path(got['sourceSrtPath']).read_bytes())
            metadata=Path(tmp)/'json-sha.json';metadata.write_bytes(Path(got['transcriptProvenancePath']).read_bytes())
            result=broll_timeline.build(got['script'],[],archived,False,Path(tmp)/'timeline',False,srt,transcript_time_base='project',project_duration=3,project_document=doc,transcript_provenance_path=metadata)
            self.assertEqual(result['transcript_time_base'],'project')
