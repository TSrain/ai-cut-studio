import copy
import math
import struct
import hashlib
from pathlib import Path
import tempfile
import unittest
import wave
from tools import bgm_package

class ExecutionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.audio=self.root/'music.wav'
  with wave.open(str(self.audio),'wb') as f:
   f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b''.join(struct.pack('<h',int(10000*math.sin(2*math.pi*440*i/8000))) for i in range(80000)))
  self.asset={'recommendationId':'r','path':str(self.audio),'sha256':hashlib.sha256(self.audio.read_bytes()).hexdigest()}
  self.rec={'id':'r','title':'Music','artist':'A','url':'https://a.example/music','reason':'稀疏配器维持连续感','licenseStatus':'verified','licenseUrl':'https://a.example/license','licenseEvidence':'CC BY 4.0 permits video use','credit':'Music by A, CC BY 4.0, edited','attributionRequired':True,'audition':'not_listened'}
  self.design={'decision':'music','reason':'连续感','purpose':'continuity','musicType':'轻节拍','texture':'稀疏','transition':'同曲延续','recommendationIds':['r']}
  self.sections=[{'id':'a','requirementVersion':1},{'id':'b','requirementVersion':1}]
  self.doc={'canvas':{'fps':{'num':30,'den':1},'durationFrames':300},'productionPlan':{'shots':[dict(s,timing={'status':'aligned','ranges':[{'startFrame':i*60+30,'durationFrames':60}]}) for i,s in enumerate(self.sections)]}}
  self.p={'schemaVersion':1,'branchId':'bgm','items':[],'reason':'全文审阅','sections':[dict(s,bgmDesign=copy.deepcopy(self.design)) for s in self.sections],'recommendations':[self.rec], 'execution':{'version':1,'assets':[self.asset],'edits':[{'shotIds':['a','b'],'assetId':'r','sourceInSeconds':1,'volume':0.03,'fadeInSeconds':0.2,'fadeOutSeconds':0.3,'fadeInCurve':'smooth','fadeOutCurve':'smooth','method':'同曲延续'}],'gaps':[], 'searchAudit':[{'url':'https://'+host+'/music','category':cat,'providerId':host,'region':'domestic' if i==0 else 'overseas','queries':['minimal sparse narration'], 'candidateIds':['r'] if i==0 else [],'reason':'已比较候选' if i==0 else '检索未找到更合适项'} for i,(host,cat) in enumerate([('a.example','artist'),('b.example','library'),('c.example','platform')])]}}
 def build(self):
  self.assertTrue(hasattr(bgm_package,'build_execution'),'automatic BGM builder missing')
  return bgm_package.build_execution(self.p,{'sections':self.sections},self.doc,self.root,[self.asset])
 def test_real_audio_merged_by_contiguous_music_ranges(self):
  value=self.build();self.assertEqual(len(value['clips']),1);c=value['clips'][0]
  self.assertEqual((c['startFrame'],c['durationFrames'],c['sourceInFrame']),(30,120,30));self.assertEqual(c['fadeOutFrames'],9)
  self.assertEqual(value['assets'][0]['sourceDurationSeconds'],10);self.assertEqual(value['assets'][0]['credit'],self.rec['credit'])
 def test_silence_not_bridged(self):
  self.doc['productionPlan']['shots'][1]['timing']['ranges'][0]['startFrame']=120
  with self.assertRaisesRegex(ValueError,'contiguous'):self.build()
 def test_rejects_unlicensed_hash_changed_outside_source_and_narrow_search(self):
  for mutate in (lambda p:p['recommendations'][0].update(licenseStatus='unknown'),lambda p:p['execution']['assets'][0].update(sha256='0'*64),lambda p:p['execution']['edits'][0].update(sourceInSeconds=9),lambda p:p['execution'].update(searchAudit=p['execution']['searchAudit'][:1])):
   before=copy.deepcopy(self.p);mutate(self.p)
   with self.subTest(),self.assertRaises(ValueError):self.build()
   self.p=before
 def test_missing_music_is_explicit_gap_not_fake_execution(self):
  self.p['execution']['edits']=[];self.p['execution']['assets']=[];self.p['execution']['gaps']=['下载受限，需补素材']
  value=self.build();self.assertEqual(value['clips'],[]);self.assertTrue(value['gaps'])
 def test_cannot_choose_lower_rank_without_failed_attempt(self):
  self.p['recommendations'].append(dict(self.rec,id='other',url='https://other.example/music'))
  for row in self.p['sections']:row['bgmDesign']['recommendationIds']=['other','r']
  with self.assertRaisesRegex(ValueError,'rank'):self.build()
  self.p['execution']['downloadAttempts']=[{'recommendationId':'other','status':'failed','reason':'官方直链404'}]
  self.assertEqual(len(self.build()['clips']),1)
 def test_shortened_edit_leaves_blank_and_overlap_can_be_expressed(self):
  self.p['execution']['edits'][0].update(startOffsetSeconds=0.5,endOffsetSeconds=0.5)
  c=self.build()['clips'][0];self.assertEqual((c['startFrame'],c['durationFrames']),(45,90))
 def test_all_silence_needs_no_search_or_audio(self):
  for row in self.p['sections']:row['bgmDesign']={'decision':'silence','reason':'密集推导'}
  self.p['execution']={'version':1,'assets':[],'edits':[],'searchAudit':[],'gaps':[]}
  self.assertEqual(self.build()['clips'],[])

 def test_business_gate_emits_audio_operation_and_keeps_old_plan_compatible(self):
  from tools.package_branch_validation import validate_branch_proposal
  from tests.test_package_branches import result
  import json
  req={'projectId':'p','runId':'run','branchId':'bgm','attemptId':'a','inputFingerprint':'f','dependencies':{},'outputRoot':str(self.root),'semantic':{'sections':self.sections},'bgmPlanVersion':1,'packageOrchestrationVersion':2,'bgmExecutionVersion':1}
  value=result(req);path=Path(value['manifestPath']);path.write_text(json.dumps(self.p));value['files'][0]['sha256']=hashlib.sha256(path.read_bytes()).hexdigest();value['files'].append(self.asset)
  receipt=validate_branch_proposal(req,value,self.doc)
  self.assertEqual(receipt['operations'][0]['kind'],'bgm')
  self.assertEqual(len(receipt['operations'][0]['payload']['value']['execution']['clips']),1)
  self.assertIn(['audioClips'],[w['path'] for w in receipt['writeSet']])
  del req['bgmExecutionVersion'];self.assertEqual(validate_branch_proposal(req,value,self.doc)['operations'],[])
 def test_zero_gain_is_not_applied_music(self):
  self.p['execution']['edits'][0]['volume']=0
  with self.assertRaisesRegex(ValueError,'volume'):self.build()
 def test_subdomains_and_reposted_provider_do_not_inflate_search(self):
  for i,a in enumerate(self.p['execution']['searchAudit']):a['url']=f'https://host{i}.same.example/music'
  with self.assertRaisesRegex(ValueError,'independent'):self.build()
 def test_completion_requires_current_saved_audio_not_just_plan(self):
  self.assertTrue(hasattr(bgm_package,'execution_applied'),'actual BGM completion check missing')
  clip={'id':'audio','volume':0.03};track={'id':'track'}
  self.doc['audioClips']=[copy.deepcopy(clip)];self.doc['audioTracks']=[track]
  self.doc['productionPlan']['bgmExecution']={'version':1,'runId':'run','status':'applied','clipIds':['audio']}
  self.doc['styleReference']={'allowedOverrides':{'bgmApplication':{'version':1,'runId':'run','status':'applied','baseline':{'clips':[clip],'tracks':[track]},'clips':[{'clipId':'audio','shotIds':['a','b'],'requirementVersions':{'a':1,'b':1},'shotTimings':{s['id']:copy.deepcopy(s['timing']) for s in self.doc['productionPlan']['shots']}}]}}}
  for s in self.doc['productionPlan']['shots']:s['bgmDesign']=self.design
  self.assertTrue(bgm_package.execution_applied(self.doc,'run'))
  prior=copy.deepcopy(self.doc['productionPlan']['shots'][0]['timing'])
  self.doc['productionPlan']['shots'][0]['timing']['ranges'][0]['startFrame']=200
  self.assertFalse(bgm_package.execution_applied(self.doc,'run'))
  self.doc['productionPlan']['shots'][0]['timing']=prior
  self.doc['audioClips'][0]['volume']=0
  self.assertFalse(bgm_package.execution_applied(self.doc,'run'))
 def test_gain_uses_actual_narration_and_selected_music(self):
  self.doc['source']={'path':str(self.audio),'startFrame':0,'durationFrames':300}
  value=self.build();clip=value['clips'][0]
  self.assertIn('mixEvidence',clip)
  self.assertAlmostEqual(clip['mixEvidence']['musicMeanDb']+20*math.log10(clip['volume']),clip['mixEvidence']['narrationMeanDb']-18,delta=0.2)
 def test_first_package_builds_timing_from_shared_srt_before_audio_validation(self):
  from tests.test_animation_package import fixture
  from tools.animation_package import build_plan
  from tools.package_branch_validation import validate_branch_proposal
  from tests.test_package_branches import result
  import json
  req,semantic,doc=fixture(self.root)
  plan,_,_=build_plan(semantic,req,doc)
  semantic['sections'][0].update(id=plan['shots'][0]['id'],requirementVersion=plan['shots'][0]['requirementVersion'])
  doc['source']['path']=str(self.audio)
  req.update(runId='run',branchId='bgm',attemptId='a',inputFingerprint='f',dependencies={},semantic=semantic,bgmPlanVersion=1,bgmExecutionVersion=1,packageOrchestrationVersion=2)
  self.p['sections']=[{'id':semantic['sections'][0]['id'],'requirementVersion':semantic['sections'][0]['requirementVersion'],'bgmDesign':self.design}]
  self.p['execution']['edits'][0]['shotIds']=[semantic['sections'][0]['id']]
  value=result(req);path=Path(value['manifestPath']);path.write_text(json.dumps(self.p));value['files'][0]['sha256']=hashlib.sha256(path.read_bytes()).hexdigest();value['files'].append(self.asset)
  gate=validate_branch_proposal(req,value,doc)
  self.assertEqual(gate['operations'][0]['payload']['value']['execution']['clips'][0]['durationFrames'],180)
