"""Resume provenance, raw-alignment caching, and bounded semantic correction."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import roughcut_audio as audio
import roughcut_semantics as sem
import roughcut_analyze as worker


UNITS=[{'id':'c1.w1','text':'今天，','startSeconds':0,'endSeconds':.5,'timing':'word','groupId':'c1'},
       {'id':'c1.w2','text':'今天发布。','startSeconds':.7,'endSeconds':1.5,'timing':'word','groupId':'c1'}]
VALID={'decisions':[{'id':'d1','unitIds':['c1.w1'],'keepUnitIds':['c1.w2'],'action':'delete','kind':'false_start','reason':'重复起句','confidence':.99}]}


class PartialAlignmentTests(unittest.TestCase):
    def units(self,text,words,start=0,end=5):
        cue={'start':start,'end':end,'text':text}
        silences=[{'startSeconds':0,'endSeconds':5}]
        return audio.make_units([cue],{'c1':words},silences,end)[0]

    def test_single_zero_keeps_other_reliable_word_units(self):
        words=[{'text':x,'start':a,'end':b} for x,a,b in [('甲',0,.3),('乙',.3,.6),('丙',.6,.6),('丁',.6,.9),('戊',.9,1.2)]]
        units=self.units('甲乙丙丁戊。',words,end=1.2)
        self.assertEqual([u['text'] for u in units],['甲','乙丙丁','戊。'])
        self.assertEqual([u['timing'] for u in units],['word','segment','word'])
        middle=units[1];self.assertTrue(middle['coalesced'])
        self.assertEqual((middle['startSeconds'],middle['endSeconds']),(.3,.9))
        self.assertIn('zero_duration_alignment',middle['protectionReasons'])

    def test_consecutive_zeros_share_one_protected_group(self):
        words=[{'text':x,'start':a,'end':b} for x,a,b in [('甲',0,.2),('乙',.2,.4),('丙',.4,.4),('丁',.4,.4),('戊',.4,.6),('己',.6,.8)]]
        units=self.units('甲乙丙丁戊己',words,end=.8)
        self.assertEqual([u['text'] for u in units],['甲','乙丙丁戊','己'])
        self.assertEqual(units[1]['alignmentEvidence']['zeroTokenCount'],2)

    def test_initial_and_terminal_zeros_protect_only_edge_groups(self):
        words=[{'text':x,'start':a,'end':b} for x,a,b in [('甲',.1,.1),('乙',.1,.3),('丙',.3,.5),('丁',.5,.7),('戊',.7,.7)]]
        units=self.units('甲乙丙丁戊',words,end=.8)
        self.assertEqual([u['text'] for u in units],['甲乙','丙','丁戊'])
        self.assertEqual(units[1]['timing'],'word')
        self.assertEqual((units[0]['startSeconds'],units[-1]['endSeconds']),(0,.8))
        self.assertTrue(all(u['safeBoundaries'] is False for u in (units[0],units[-1])))

    def test_zero_group_across_large_gap_is_explicitly_protected(self):
        words=[{'text':'甲','start':0,'end':.2},{'text':'乙','start':.2,'end':.2},{'text':'丙','start':2,'end':2.2},{'text':'丁','start':2.2,'end':2.5}]
        units=self.units('甲乙丙丁',words,end=2.5)
        self.assertTrue(units[0]['alignmentEvidence']['wideGap'])
        self.assertEqual(units[1]['timing'],'word')


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.cli=patch.object(sem,'codex_binary',return_value='/fixture/codex')
        self.cli.start();self.addCleanup(self.cli.stop)
        # Derived caches stay per-test: never read or write the repo workspace caches.
        self.env=patch.dict(os.environ,{'ROUGHCUT_MODEL_CACHE_DIR':str(self.root/'model-cache'),'ROUGHCUT_AUDIO_CACHE':str(self.root/'audio-cache')});self.env.start()
    def tearDown(self):self.env.stop();self.temp.cleanup()

    def assert_consumable_by_editor(self,decisions,units=UNITS):
        targets=[x for item in decisions for x in item['unitIds']]
        self.assertEqual(len(targets),len(set(targets)))
        module=Path(__file__).resolve().parents[2]/'studio/tools/editor/roughcut-model.mjs'
        if not module.is_file() or not shutil.which('node'):return None
        script="""import fs from 'node:fs';
import {createRoughcut,roughcutSourceKey,roughcutRows} from MODULE;
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const d={schemaVersion:1,id:'python-consumer-test',name:'原片',revision:0,canvas:{width:1920,height:1080,fps:{num:30,den:1},durationFrames:120},source:{path:'voice.mp4',publicPath:'voice.mp4',startFrame:0,durationFrames:120,clips:[{id:'main',startFrame:0,durationFrames:120,sourceInFrame:0}]},instances:[],tracks:[]};
const a={version:1,sourceKey:roughcutSourceKey(d),sourceDurationSeconds:4,timing:'word',units:input.units,silences:[],decisions:input.decisions,warnings:[]};
console.log(JSON.stringify(roughcutRows(createRoughcut(d,a))));
""".replace('MODULE',json.dumps(module.as_uri()))
        result=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps({'decisions':decisions,'units':units}),capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)
        return json.loads(result.stdout)

    def test_invalid_reference_is_corrected_once_and_every_attempt_survives(self):
        bad=copy.deepcopy(VALID);bad['decisions'][0]['unitIds']=['invented'];calls=[]
        def run(command,**kwargs):
            p=Path(command[command.index('--output-last-message')+1]);calls.append(kwargs['input_text'])
            p.write_text(json.dumps(bad if len(calls)==1 else VALID));return ('event-log','stderr-log')
        with patch.object(sem,'run_command',side_effect=run):
            result=sem.model_decisions(UNITS,self.root)
        self.assertEqual(len(calls),2);self.assertEqual(result[0]['action'],'delete')
        evidence=list((self.root/'semantic'/'attempts').glob('*/response.json'))
        self.assertEqual(len(evidence),2)
        self.assertTrue(any('invented' in p.read_text() for p in evidence))
        self.assertIn('不存在',calls[1]);self.assertIn('数据',calls[1])

    def test_correction_cannot_delete_previously_known_review_or_keep(self):
        review=copy.deepcopy(VALID['decisions'][0]);review.update(action='review',keepUnitIds=['c1.w1'])
        invalid=copy.deepcopy(review);invalid.update(id='bad',unitIds=['unknown'],keepUnitIds=[])
        first={'decisions':[review,invalid]};calls=[]
        def run(command,**kwargs):
            calls.append(1);Path(command[command.index('--output-last-message')+1]).write_text(json.dumps(first if len(calls)==1 else VALID));return ('','')
        with patch.object(sem,'run_command',side_effect=run):
            result=sem.model_decisions(UNITS,self.root)
        self.assertEqual(len(calls),2)
        self.assertFalse(any(d['action']=='delete' and 'c1.w1' in d['unitIds'] for d in result))
        self.assertTrue(any('c1.w1' in d['keepUnitIds'] for d in result))
        self.assert_consumable_by_editor(result)

    def test_ordinary_review_is_unique_and_remains_manually_actionable(self):
        review=copy.deepcopy(VALID);review['decisions'][0].update(action='review',keepUnitIds=[])
        def run(command,**kwargs):
            Path(command[command.index('--output-last-message')+1]).write_text(json.dumps(review));return ('','')
        with patch.object(sem,'run_command',side_effect=run):result=sem.model_decisions(UNITS,self.root)
        self.assertEqual(len(result),1);self.assertEqual(result[0]['keepUnitIds'],[])
        rows=self.assert_consumable_by_editor(result)
        if rows is not None:self.assertTrue(rows[0]['safeToEnable'])

    def test_correction_keeps_ordinary_review_without_inventing_hard_keep(self):
        review=copy.deepcopy(VALID['decisions'][0]);review.update(action='review',keepUnitIds=[])
        invalid=copy.deepcopy(review);invalid.update(id='bad',unitIds=['unknown'])
        first={'decisions':[review,invalid]};calls=[]
        def run(command,**kwargs):
            calls.append(1);Path(command[command.index('--output-last-message')+1]).write_text(json.dumps(first if len(calls)==1 else VALID));return ('','')
        with patch.object(sem,'run_command',side_effect=run):result=sem.model_decisions(UNITS,self.root)
        self.assertEqual(result[0]['action'],'review')
        self.assertFalse(any('c1.w1' in item['keepUnitIds'] for item in result))
        rows=self.assert_consumable_by_editor(result)
        if rows is not None:self.assertTrue(rows[0]['safeToEnable'])

    def test_all_decision_targets_must_be_unique(self):
        for action in ('delete','review'):
            first=copy.deepcopy(VALID['decisions'][0]);first['action']=action
            second=copy.deepcopy(first);second.update(id='another',action='review')
            with self.assertRaisesRegex(ValueError,'重复'):
                sem.validate_decisions({'decisions':[first,second]},UNITS)

    def test_correction_cannot_raise_known_low_confidence_delete_to_auto_delete(self):
        first=copy.deepcopy(VALID);first['decisions'][0]['confidence']=.3
        invalid=copy.deepcopy(first['decisions'][0]);invalid.update(id='bad',unitIds=['unknown'],keepUnitIds=[])
        first['decisions'].append(invalid);calls=[]
        def run(command,**kwargs):
            calls.append(1);Path(command[command.index('--output-last-message')+1]).write_text(json.dumps(first if len(calls)==1 else VALID));return ('','')
        with patch.object(sem,'run_command',side_effect=run):result=sem.model_decisions(UNITS,self.root)
        self.assertEqual(result[0]['action'],'review')
        self.assertNotIn('c1.w1',result[0]['keepUnitIds'])
        self.assert_consumable_by_editor(result)

    def test_missing_prior_review_adds_one_soft_review_without_duplicate_targets(self):
        review=copy.deepcopy(VALID['decisions'][0]);review.update(action='review',keepUnitIds=[])
        invalid=copy.deepcopy(review);invalid.update(id='bad',unitIds=['unknown'])
        first={'decisions':[review,invalid]};calls=[]
        def run(command,**kwargs):
            calls.append(1);Path(command[command.index('--output-last-message')+1]).write_text(json.dumps(first if len(calls)==1 else {'decisions':[]}));return ('','')
        with patch.object(sem,'run_command',side_effect=run):result=sem.model_decisions(UNITS,self.root)
        self.assertEqual(len(result),1);self.assertEqual(result[0]['keepUnitIds'],[])
        self.assert_consumable_by_editor(result)

    def test_legacy_combined_protections_reconstruct_soft_review_from_raw_evidence(self):
        directory=self.root/'semantic';directory.mkdir()
        prior=copy.deepcopy(VALID);prior['decisions'][0].update(action='review',keepUnitIds=[])
        (directory/'prompt.txt').write_text(sem.build_prompt(UNITS));(directory/'response.json').write_text(json.dumps(prior))
        units_sha=hashlib.sha256(json.dumps(UNITS,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        (directory/'protections.json').write_text(json.dumps({'unitsSha256':units_sha,'unitIds':['c1.w1']}))
        def run(command,**kwargs):
            Path(command[command.index('--output-last-message')+1]).write_text(json.dumps(VALID));return ('','')
        with patch.object(sem,'run_command',side_effect=run):result=sem.model_decisions(UNITS,self.root)
        self.assertEqual(result[0]['action'],'review');self.assertNotIn('c1.w1',result[0]['keepUnitIds'])
        self.assert_consumable_by_editor(result)

    def test_noncontiguous_explicit_keeps_merge_without_duplicate_targets_or_extra_keeps(self):
        units=copy.deepcopy(UNITS)+[{'id':'c2.w1','text':'今天发布。','startSeconds':2,'endSeconds':2.5,'timing':'word','groupId':'c2'}]
        proposal=copy.deepcopy(VALID['decisions']);proposal[0]['keepUnitIds']=['c2.w1']
        result=sem._enforce_protections(proposal,units,{'c1.w1'},{'c1.w1','c2.w1'})
        self.assertEqual(len(result),1);self.assertEqual(result[0]['keepUnitIds'],['c1.w1','c2.w1'])
        self.assertNotIn('c1.w2',result[0]['keepUnitIds'])
        self.assert_consumable_by_editor(result,units)

    def test_three_total_attempts_then_nonzero_failure(self):
        calls=[]
        def run(command,**kwargs):
            calls.append(1);Path(command[command.index('--output-last-message')+1]).write_text('{broken');return ('','')
        with patch.object(sem,'run_command',side_effect=run),self.assertRaises(ValueError):
            sem.model_decisions(UNITS,self.root)
        self.assertEqual(len(calls),3)
        self.assertEqual(len(list((self.root/'semantic'/'attempts').glob('*/response.json'))),3)

    def test_resume_validates_existing_response_without_calling_model(self):
        d=self.root/'semantic';d.mkdir();(d/'prompt.txt').write_text(sem.build_prompt(UNITS));(d/'response.json').write_text(json.dumps(VALID))
        before=(d/'response.json').read_bytes()
        with patch.object(sem,'run_command',side_effect=AssertionError('must not run model')):
            result=sem.model_decisions(UNITS,self.root,resume=True)
        self.assertEqual(result[0]['action'],'delete');self.assertEqual((d/'response.json').read_bytes(),before)

    def test_resume_wrong_units_does_not_reuse_previous_response(self):
        d=self.root/'semantic';d.mkdir();(d/'prompt.txt').write_text(sem.build_prompt(UNITS));(d/'response.json').write_text(json.dumps(VALID))
        changed=copy.deepcopy(UNITS);changed[0]['text']='明天'
        with patch.object(sem,'run_command',side_effect=AssertionError('must fail before model')),self.assertRaisesRegex(ValueError,'不匹配|变化'):
            sem.model_decisions(changed,self.root,resume=True)

    def test_semantic_resume_requires_both_evidence_files_and_matching_prompt(self):
        d=self.root/'semantic';d.mkdir()
        self.assertFalse(sem.can_resume_semantics(UNITS,self.root))
        (d/'prompt.txt').write_text(sem.build_prompt(UNITS))
        self.assertFalse(sem.can_resume_semantics(UNITS,self.root))
        (d/'response.json').write_text(json.dumps(VALID))
        self.assertTrue(sem.can_resume_semantics(UNITS,self.root))
        changed=copy.deepcopy(UNITS);changed[0]['text']='明天'
        self.assertFalse(sem.can_resume_semantics(changed,self.root))
        (d/'prompt.txt').write_text('interrupted prompt')
        self.assertFalse(sem.can_resume_semantics(UNITS,self.root))
        (d/'prompt.txt').unlink()
        self.assertFalse(sem.can_resume_semantics(UNITS,self.root))

    def test_same_job_identity_refuses_changed_source(self):
        p=self.root/'source.wav';p.write_bytes(b'original');stat=p.stat()
        identity=f'{stat.st_dev}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns/1e6}:{stat.st_ctime_ns/1e6}'
        (self.root/'job.json').write_text(json.dumps({'sourceKey':'key','identity':identity}))
        self.assertEqual(audio._same_job_source(p,self.root,'key')['sourceKey'],'key')
        p.write_bytes(b'changed-source')
        with self.assertRaisesRegex(ValueError,'身份'):
            audio._same_job_source(p,self.root,'key')

    def test_ctime_only_change_requires_original_content_hash_attestation(self):
        p=self.root/'source.wav';p.write_bytes(b'original');stat=p.stat()
        identity=f'{stat.st_dev}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns/1e6}:{stat.st_ctime_ns/1e6-1000}'
        (self.root/'job.json').write_text(json.dumps({'sourceKey':'key','identity':identity}))
        with patch.dict(os.environ,{'ROUGHCUT_RESUME_SOURCE_SHA256':''}),self.assertRaises(ValueError):
            audio._same_job_source(p,self.root,'key')
        with patch.dict(os.environ,{'ROUGHCUT_RESUME_SOURCE_SHA256':hashlib.sha256(b'original').hexdigest()}):
            self.assertEqual(audio._same_job_source(p,self.root,'key')['revalidatedSourceSha256'],hashlib.sha256(b'original').hexdigest())
        with patch.dict(os.environ,{'ROUGHCUT_RESUME_SOURCE_SHA256':'wrong'}),self.assertRaises(ValueError):
            audio._same_job_source(p,self.root,'key')

    def test_resume_does_not_invoke_transcription_silence_or_acoustic_alignment(self):
        p=self.root/'source.wav';p.write_bytes(b'original')
        cues=[{'start':0.,'end':1.5,'text':'今天，今天发布。'}]
        (self.root/'shared-transcript.srt').write_text('1\n00:00:00,000 --> 00:00:01,500\n今天，今天发布。\n')
        groups={'c1':[{'text':'今天','start':0.,'end':.5},{'text':'今天发布','start':.7,'end':1.5}]}
        units,_=audio.make_units(cues,groups,[],1.5)
        previous={'units':units,'silences':[],'sourceKey':'key'}
        (self.root/'analysis-input.json').write_text(json.dumps(previous))
        (self.root/'analysis-receipt.json').write_text(json.dumps({'analysisSha256':hashlib.sha256(json.dumps(previous,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'transcriptSha256':hashlib.sha256((self.root/'shared-transcript.srt').read_bytes()).hexdigest()}))
        with patch.object(worker,'shared_cues',side_effect=AssertionError('ASR/cache child invoked')),\
             patch.object(worker,'detect_silences',side_effect=AssertionError('energy repeated')),\
             patch.object(worker,'optional_alignment',side_effect=AssertionError('alignment repeated')),\
             patch.object(worker,'resume_alignment',return_value=(groups,[])),\
             patch.object(worker,'probe_duration',return_value=1.5),\
             patch.object(worker,'model_edit_plan',return_value={'selections':[{'id':'s1'}]}) as model:
            result=worker.analyze(p,self.root/'result.json',self.root,'key',resume=True)
        self.assertEqual(result['units'],units);self.assertTrue(model.call_args.kwargs['resume']); self.assertEqual(result['decisions'],[]); self.assertIn('editPlan',result)

    def test_resume_rejects_modified_analysis_before_reusing_silence(self):
        p=self.root/'source.wav';p.write_bytes(b'original')
        transcript=self.root/'shared-transcript.srt';transcript.write_text('1\n00:00:00,000 --> 00:00:01,500\n今天。\n')
        previous={'units':[],'silences':[],'sourceKey':'key'}
        receipt={'analysisSha256':hashlib.sha256(json.dumps(previous,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'transcriptSha256':hashlib.sha256(transcript.read_bytes()).hexdigest()}
        (self.root/'analysis-receipt.json').write_text(json.dumps(receipt))
        previous['silences']=[{'startSeconds':0,'endSeconds':1}]
        (self.root/'analysis-input.json').write_text(json.dumps(previous))
        with patch.object(worker,'probe_duration',return_value=1.5),patch.object(worker,'resume_alignment',side_effect=AssertionError('do not reach alignment')),self.assertRaisesRegex(ValueError,'证据|校验'):
            worker.analyze(p,self.root/'result.json',self.root,'key',resume=True)
        self.assertEqual(json.loads((self.root/'analysis-receipt.json').read_text()),receipt)

    def test_legacy_resume_without_receipt_remeasures_silence(self):
        p=self.root/'source.wav';p.write_bytes(b'original')
        (self.root/'shared-transcript.srt').write_text('1\n00:00:00,000 --> 00:00:01,500\n今天。\n')
        (self.root/'analysis-input.json').write_text(json.dumps({'units':[],'silences':[{'startSeconds':0,'endSeconds':1.4}],'sourceKey':'key'}))
        with patch.object(worker,'probe_duration',return_value=1.5),patch.object(worker,'detect_silences',return_value=[]) as energy,patch.object(worker,'resume_alignment',return_value=({},[])),patch.object(worker,'model_edit_plan',return_value={'selections':[{'id':'s1'}]}):
            result=worker.analyze(p,self.root/'result.json',self.root,'key',resume=True)
        energy.assert_called_once();self.assertEqual(result['silences'],[])

    def test_alignment_cache_is_bound_to_all_provenance_and_result_hash(self):
        self.assertIsNotNone(getattr(audio,'alignment_cache_key',None))
        binding={'pcmKey':'a','clock':{'start':0},'cues':[{'start':0,'end':1,'text':'今天'}],
                 'provider':{'qwen-asr':'0.0.6'},'model':{'sha256':'weights'},'device':'cpu'}
        key=audio.alignment_cache_key(binding)
        for field,value in [('pcmKey','b'),('clock',{'start':1}),('cues',[{'start':0,'end':1,'text':'明天'}]),
                            ('provider',{'qwen-asr':'0.0.7'}),('model',{'sha256':'other'}),('device','mps')]:
            changed=copy.deepcopy(binding);changed[field]=value
            self.assertNotEqual(key,audio.alignment_cache_key(changed),field)
        raw={'groups':{},'warnings':[],'provider':'Qwen3ForcedAligner','model':'/model'}
        with patch.dict(os.environ,{'ROUGHCUT_ALIGNMENT_CACHE':str(self.root/'cache')}):
            audio.save_alignment_cache(binding,raw)
            self.assertEqual(audio.read_alignment_cache(binding),raw)
            p=self.root/'cache'/(key+'.json');d=json.loads(p.read_text());d['result']['groups']['forged']=[];p.write_text(json.dumps(d))
            with self.assertRaisesRegex(ValueError,'校验|hash|损坏'):
                audio.read_alignment_cache(binding)


if __name__=='__main__':unittest.main()
