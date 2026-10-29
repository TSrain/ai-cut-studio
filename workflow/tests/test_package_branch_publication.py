import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools.package_branch_validation import canonical_hash

class PublicationTests(unittest.TestCase):
 def test_retry_reopens_finished_publication_index(self):
  from tools.package_branch_publication import pump_publications
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   def write(name,value):
    p=root/name;p.write_text(json.dumps(value));return str(p)
   sem=write('semantic.json',{'sections':[]})
   shared=write('shared.json',{'semanticPath':sem})
   gate=write('gate.json',{'operations':[],'readSet':[],'writeSet':[]})
   req=write('request.json',{})
   result=write('result.json',{})
   write('package-branches.json',{'projectId':'p','runId':'r','sharedInputPath':shared,'branches':{'aiVideo':{'status':'complete','attemptId':'retry','validation':{'receiptPath':gate},'requestPath':req,'resultPath':result}}})
   write('publication-index.json',{'version':1,'projectId':'p','runId':'r','items':[],'finished':True})
   request={'projectId':'p','runId':'r','outputRoot':d,'packageOrchestrationVersion':2,'packageExecution':{'streamingApply':True},'document':{'id':'p'}}
   with patch('tools.package_branch_publication.validate_branch_proposal',return_value={'operations':[]}) as validate:
    pump_publications(request,{'id':'p'})
    self.assertEqual(validate.call_count,1)
    pump_publications(request,{'id':'p'})
    self.assertEqual(validate.call_count,1)
 def test_semantic_plan_published_before_branch_models(self):
  from tools.package_branch_publication import publish_initial_plan
  from tests.test_editor_plan import document
  with tempfile.TemporaryDirectory() as d:
   doc=document();req={'projectId':doc['id'],'jobId':'j','runId':'r','outputRoot':d,'canvas':doc['canvas'],'packageExecution':{'streamingApply':True}}
   sem={'sections':[{'id':'stable-shot','title':'当前镜头','narration':'当前正文。','animationNeed':'none','goal':'当前画面要求','information':['当前素材说明'],'relations':[],'boundaries':[],'reason':'真人','sourceCueIds':[],'requirementVersion':4,'templateMatch':{'status':'none','reason':'待复审'}}]}
   op=publish_initial_plan(req,sem,doc)
   self.assertEqual(op['kind'],'semanticPlan')
   self.assertTrue(Path(op['validationReceiptPath']).is_file())
   self.assertTrue(list((Path(d)/'operations').glob('*.json')))
 def test_live_ack_must_match_project_and_operation(self):
  from tools.package_branch_publication import application_state
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'application-queue';p.mkdir();(p/'journal.json').write_text(json.dumps({'projectId':'other','runId':'r','operations':[]}))
   with self.assertRaises(ValueError):application_state({'outputRoot':d,'projectId':'p','runId':'r'})

class PublicationProtectionTests(unittest.TestCase):
 def test_user_edit_during_generation_is_not_rebased(self):
  from tools.package_branch_publication import assert_publish_dependencies
  original={'id':'p','source':{'path':'old.mp4','startFrame':0},'canvas':{},'captions':{'color':'white'},'productionPlan':{'changes':[]}}
  request={'projectId':'p','runId':'r','document':original,'outputRoot':'/tmp'}
  current=json.loads(json.dumps(original));current['captions']['color']='red'
  gate={'readSet':[{'path':['captions']}],'writeSet':[{'path':['captions']}]}
  with self.assertRaisesRegex(ValueError,'manual|source'):
   assert_publish_dependencies(request,gate,current,{'operations':[]})
 def test_source_swap_same_clips_is_rejected(self):
  from tools.package_branch_publication import assert_publish_dependencies
  original={'id':'p','source':{'path':'old.mp4','clips':[]},'canvas':{},'captions':{}}
  request={'projectId':'p','runId':'r','document':original,'outputRoot':'/tmp'}
  current=json.loads(json.dumps(original));current['source']['path']='new.mp4'
  with self.assertRaisesRegex(ValueError,'source'):
   assert_publish_dependencies(request,{'readSet':[],'writeSet':[]},current,{'operations':[]})
 def test_only_acknowledged_own_fields_can_rebase(self):
  from tools.package_branch_publication import assert_publish_dependencies
  import hashlib
  with tempfile.TemporaryDirectory() as d:
   original={'id':'p','source':{},'canvas':{},'captions':{'color':'white'},'instances':[],'productionPlan':{'changes':[]}}
   current=json.loads(json.dumps(original));current['captions']['color']='blue'
   root=Path(d);readback=root/'readback.json';readback.write_text(json.dumps({'document':current}))
   ack=root/'ack.json';ack.write_text(json.dumps({'projectId':'p','runId':'r','operationId':'op','readbackPath':str(readback),'readbackSha256':hashlib.sha256(readback.read_bytes()).hexdigest()}))
   row={'status':'applied','operation':{'operationId':'op','writeSet':[{'path':['captions']}]},'receiptPath':str(ack),'receiptSha256':hashlib.sha256(ack.read_bytes()).hexdigest()}
   req={'projectId':'p','runId':'r','document':original,'outputRoot':d}
   assert_publish_dependencies(req,{'readSet':[{'path':['captions']}],'writeSet':[]},current,{'operations':[row]})
   current['instances']=[{'id':'manual'}]
   with self.assertRaises(ValueError):assert_publish_dependencies(req,{'readSet':[{'path':['instances']}],'writeSet':[]},current,{'operations':[row]})

class EditReconciliationPublicationTests(unittest.TestCase):
 def test_initial_plan_binds_immutable_baseline_for_reconciliation(self):
  from tools.package_branch_publication import publish_initial_plan
  from tests.test_editor_plan import document
  with tempfile.TemporaryDirectory() as d:
   doc=document();req={'projectId':doc['id'],'jobId':'j','runId':'r','outputRoot':d,'canvas':doc['canvas'],'editReconciliationVersion':1,'packageExecution':{'streamingApply':True}}
   sem={'sections':[{'id':'s','title':'口播','narration':'当前正文。','animationNeed':'none','goal':'当前表达','information':[],'relations':[],'boundaries':[],'reason':'真人','sourceCueIds':[],'requirementVersion':1,'templateMatch':{'status':'none','reason':'真人'}}]}
   op=publish_initial_plan(req,sem,doc);gate=json.loads(Path(op['validationReceiptPath']).read_text())
   self.assertIn('reconciliationBasePath',gate)
   self.assertEqual(json.loads(Path(gate['reconciliationBasePath']).read_text())['document'],doc)
   self.assertIn(gate['reconciliationBasePath'],[f['path'] for f in op['files']])
