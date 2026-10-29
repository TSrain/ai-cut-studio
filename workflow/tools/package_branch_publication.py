"""Publish one proven native operation at a time, against a fresh project readback."""
from __future__ import annotations
import copy
import fcntl
import json
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlencode
try:
 from . import package_branches as pb
 from .package_branch_validation import canonical_hash,pointer_value,validate_branch_proposal
except ImportError:
 import package_branches as pb
 from package_branch_validation import canonical_hash,pointer_value,validate_branch_proposal

ID_KEYS=('schemaVersion','packageOrchestrationVersion','projectId','runId','branchId','attemptId','kind','dependencyFingerprint','payloadSha256','readSet','writeSet','dependsOn')

def application_state(request):
 p=Path(request['outputRoot'])/'application-queue/journal.json'
 if not p.exists():return {'projectId':request['projectId'],'runId':request['runId'],'operations':[]}
 value=pb.load(p)
 if any(value.get(k)!=request[k] for k in ('projectId','runId')):raise ValueError('application journal identity mismatch')
 return value

def _write_operation(root,operation,receipt,baseline=None):
 if baseline is not None:
  operation=copy.deepcopy(operation)
  base_path=root/'publications'/(operation['operationId']+'-reconciliation-base.json')
  base_path.parent.mkdir(parents=True,exist_ok=True)
  value={'document':baseline}
  if base_path.exists() and pb.load(base_path)!=value:raise ValueError('immutable reconciliation base changed')
  pb.atomic_json(base_path,value)
  operation['files']=[*operation['files'],pb.file_record(base_path)]
  receipt={**receipt,'reconciliationBasePath':str(base_path),'reconciliationBaseSha256':pb.digest(base_path)}
 p=root/'publications'/operation['operationId']/'validation.json';p.parent.mkdir(parents=True,exist_ok=True)
 value={**receipt,'operations':[operation]};pb.atomic_json(p,value)
 op=copy.deepcopy(operation);op['validationReceiptPath']=str(p);op['validationReceiptSha256']=pb.digest(p)
 dest=root/'operations'/(op['operationId']+'.json');pb.atomic_json(dest,op)
 return op

def publish_initial_plan(request,semantic,document):
 try:from .animation_package import build_plan
 except ImportError:from animation_package import build_plan
 root=Path(request['outputRoot']).resolve()
 plan,_,issues=build_plan(semantic,request,document)
 native={'id':'semantic-'+canonical_hash(plan)[:24],'kind':'plan','projectId':request['projectId'],'jobId':request.get('jobId',request['runId']),'plan':plan,'reason':'冻结全文语义，其他专项仍在制作'}
 native['plan'].setdefault('upstream',{}).pop('completePackage',None)
 payload={'nativeResult':native}
 read=[{'path':p,'beforeHash':canonical_hash(pointer_value(document,p))} for p in [['canvas'],['source'],['productionPlan']]]
 write=[{'path':['productionPlan'],'beforeHash':canonical_hash(pointer_value(document,['productionPlan']))}]
 op={'schemaVersion':1,'packageOrchestrationVersion':2,'projectId':request['projectId'],'runId':request['runId'],'branchId':'semantic','attemptId':'baseline','kind':'semanticPlan','dependencyFingerprint':canonical_hash(semantic),'readSet':read,'writeSet':write,'payload':payload,'payloadSha256':canonical_hash(payload),'dependsOn':[],'files':[]}
 op['operationId']=canonical_hash({k:op[k] for k in ID_KEYS})
 receipt={'schemaVersion':1,'status':'passed',**{k:op[k] for k in ('projectId','runId','branchId','attemptId','dependencyFingerprint')},'reason':'确定性build_plan建立稳定段ID，不表示全期完成','issues':issues,'files':[]}
 return _write_operation(root,op,receipt,document if request.get("editReconciliationVersion")==1 else None)

def _live(request):
 base=request.get('editorApiBase','http://127.0.0.1:4358').rstrip('/')
 with urlopen(base+'/api/editor/production-plan?'+urlencode({'projectId':request['projectId']}),timeout=10) as response:value=json.load(response)
 doc=value.get('document',value)
 if doc.get('id')!=request['projectId']:raise ValueError('live project readback mismatch')
 return doc

def pump_publications(request,current_document=None):
 pb.orchestration_version(request)
 if not request.get('packageExecution',{}).get('streamingApply'):return None
 root=Path(request['outputRoot']).resolve();state_path=root/'package-branches.json'
 if not state_path.exists() or (root/'cancel.request').exists():return None
 with (root/'.publication.lock').open('a+') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return None
  state=pb.load(state_path)
  if any(state.get(k)!=request[k] for k in ('projectId','runId')):raise ValueError('publication run mismatch')
  journal=application_state(request);rows=journal['operations']
  terminal={'applied','preserved_manual','stale','cancelled','blocked'}
  # One outstanding native save at a time, including across different branches.
  if any(r.get('status') not in terminal for r in rows):return {'status':'waiting_application'}
  published=list((root/'operations').glob('*.json'))
  published_ids={pb.load(p)['operationId'] for p in published}
  ack_ids={r['operation']['operationId'] for r in rows}
  if published_ids-ack_ids:return {'status':'waiting_application'}
  if any(r.get('status') in {'stale','cancelled','blocked'} for r in rows):return {'status':'blocked','reason':'实际应用存在保护或输入变化，停止后续依赖'}
  shared=pb.load(state['sharedInputPath']);semantic=pb.load(shared['semanticPath'])
  index_path=root/'publication-index.json';index=pb.load(index_path) if index_path.exists() else {'version':1,'projectId':request['projectId'],'runId':request['runId'],'items':[]}
  branch_fingerprint=canonical_hash({bid:{'attemptId':row.get('attemptId'),'status':row.get('status'),'validation':row.get('validation')} for bid,row in state['branches'].items()})
  if index.get('finished') and index.get('completedBranchFingerprint')==branch_fingerprint:return {'status':'ready'}
  index.pop('finished',None)
  by_id={r['operation']['operationId']:r for r in rows}
  for item in index['items']:
   if item['operationId'] in by_id:item['application']=by_id[item['operationId']]
  pb.atomic_json(index_path,index)
  doc=current_document if current_document is not None else _live(request)
  if doc.get('id')!=request['projectId']:raise ValueError('publication current project mismatch')
  for bid in ('captions','cover','aiVideo','bgm','templates','footage','camera'):
   if bid not in state['branches']:continue
   row=state['branches'][bid]
   if row.get('status')!='complete':continue
   if bid in {'templates','footage','camera'} and any(r.get('status') not in {'complete','skipped','failed','blocked','cancelled'} for r in state['branches'].values()):continue
   if bid in index.get('blockedBranches',{}):continue
   original=pb.load(row['validation']['receiptPath'])
   rebasing=request.get('editReconciliationVersion')==1
   if rebasing:
    # Never bless the user's current fields as the old proposal's baseline.
    # Validate against a deterministic frozen semantic document, then let the
    # host three-way merge its effect using the original source mapping.
    from_doc=reconciliation_document(request,semantic)
   else:
    try:assert_publish_dependencies(request,original,doc,journal)
    except ValueError as exc:
     index.setdefault('blockedBranches',{})[bid]=str(exc);pb.atomic_json(index_path,index);continue
    from_doc=doc
   req=pb.load(row['requestPath']);value=pb.load(row['resultPath'])
   # Full native revalidation observes newly saved captions/semantic plan, not
   # just changed revision. User changes still face beforeHash/CAS at save time.
   fresh=validate_branch_proposal({**req,'request':request,'semantic':semantic},value,from_doc)
   for operation in fresh['operations']:
    native=operation['payload'].get('nativeResult')
    identity_payload=operation['payloadSha256']
    if native and native['kind']=='template':identity_payload={k:native.get(k) for k in ('kind','shotId','slotId','requirementVersion','template','target')}
    if native and native['kind']=='footage':identity_payload={'kind':'footage','candidateId':native['footage']['candidateId'],'placementId':native['footage'].get('placementId')}
    key=canonical_hash({'branchId':bid,'kind':operation['kind'],'content':identity_payload})
    prior=next((item for item in index['items'] if item['publicationKey']==key),None)
    if prior:continue
    # The readback is immutable evidence for the new field expectations.
    readback=root/'publications'/(operation['operationId']+'-readback.json');readback.parent.mkdir(parents=True,exist_ok=True);pb.atomic_json(readback,{'document':doc})
    operation['files']=[*operation['files'],pb.file_record(readback)]
    op=_write_operation(root,operation,{**fresh,'currentReadbackPath':str(readback),'currentReadbackSha256':pb.digest(readback)},from_doc if rebasing else None)
    index['items'].append({'publicationKey':key,'branchId':bid,'operationId':op['operationId'],'operationPath':str(root/'operations'/(op['operationId']+'.json')),'operationSha256':pb.digest(root/'operations'/(op['operationId']+'.json'))})
    pb.atomic_json(index_path,index)
    return {'status':'published','operationId':op['operationId']}
  if all(r.get('status') in {'complete','skipped','failed','blocked','cancelled'} for r in state['branches'].values()):
   index['finished']=True;index['completedBranchFingerprint']=branch_fingerprint;pb.atomic_json(index_path,index)
  return {'status':'ready','reason':'所有有效专项操作已发布并取得终态回读'}


def publication_evidence(root):
 root=Path(root);records=[]
 index=root/'publication-index.json'
 if index.exists():records.append(pb.file_record(index))
 for path in sorted((root/'operations').glob('*.json')):
  records.append(pb.file_record(path));operation=pb.load(path)
  records.append({'path':operation['validationReceiptPath'],'sha256':operation['validationReceiptSha256']})
  records.extend(operation.get('files',[]))
 return list({r['path']:r for r in records}.values())


def refresh_application_state(request):
 """Freeze observed host acknowledgements after proposal coordinator exits."""
 root=Path(request['outputRoot']).resolve();path=root/'package-branches.json'
 if not path.exists():return None
 with (root/'.package-branches.lock').open('a+') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError('proposal coordinator still running')
  state=pb.load(path);journal=application_state(request)
  index_path=root/'publication-index.json';index=pb.load(index_path) if index_path.exists() else {'items':[]}
  allrows=list(state['branches'].items())+list(state.get('postStages',{}).items())
  for bid,row in allrows:
   if row.get('status')!='complete':continue
   actual=[r for r in journal['operations'] if r['operation']['branchId']==bid]
   publications=[];receipts=[]
   for actual_row in actual:
    op=actual_row['operation'];operation_path=root/'operations'/(op['operationId']+'.json')
    publications.append({'operationPath':str(operation_path),'operationSha256':pb.digest(operation_path),'validationReceiptPath':op['validationReceiptPath'],'validationReceiptSha256':op['validationReceiptSha256']})
    if actual_row.get('receiptPath'):
     receipt=pb.load(actual_row['receiptPath'])
     if pb.digest(actual_row['receiptPath'])!=actual_row['receiptSha256']:raise ValueError('application receipt changed')
     if any(receipt.get(k)!=request[k] for k in ('projectId','runId')) or receipt.get('operationId')!=op['operationId']:raise ValueError('application receipt identity mismatch')
     receipts.append({k:actual_row[k] for k in ('receiptPath','receiptSha256')})
     receipts[-1].update({k:receipt[k] for k in ('readbackPath','readbackSha256')})
   gate=pb.load(row['validation']['receiptPath'])
   if bid in index.get('blockedBranches',{}):
    row['publications']=publications;row['application']={'status':'blocked','reason':index['blockedBranches'][bid],'receipts':receipts};continue
   needs_review=[item for r in actual for item in r.get('reconciliation',{}).get('needsReview',[])]
   if needs_review:
    row['publications']=publications;row['application']={'status':'blocked','reason':'对应口播文字已改变，需要按最新内容局部校正','needsReview':needs_review,'receipts':receipts};continue
   if not gate['operations']:status='not_required'
   elif not actual:status='waiting_dependencies'
   elif all(r['status']=='applied' for r in actual) and len(actual)>=len(gate['operations']):status='applied'
   elif all(r['status'] in {'applied','preserved_manual'} for r in actual) and len(actual)>=len(gate['operations']):status='preserved_manual'
   elif any(r['status'] in {'stale','blocked','cancelled'} for r in actual):status='blocked'
   else:status='waiting_dependencies'
   row['publications']=publications;row['application']={'status':status,'receipts':receipts}
  state['applicationJournalPath']=str(root/'application-queue/journal.json') if (root/'application-queue/journal.json').exists() else None
  if state['applicationJournalPath']:state['applicationJournalSha256']=pb.digest(state['applicationJournalPath'])
  pb.atomic_json(path,state);return state


def _put(document,path,value):
 target=document
 for key in path[:-1]:
  if isinstance(target,list):target=target[int(key)]
  else:target=target.setdefault(key,{})
 key=path[-1]
 if value=={'__package_missing__':True}:
  if isinstance(target,dict):target.pop(key,None)
 elif isinstance(target,list):target[int(key)]=copy.deepcopy(value)
 else:target[key]=copy.deepcopy(value)


def assert_publish_dependencies(request,original_validation,current,journal):
 """Rebase only declared writes proven by this run's actual save receipts."""
 try:from .package_branches_v2 import document_for
 except ImportError:from package_branches_v2 import document_for
 expected=copy.deepcopy(document_for(request));root=Path(request['outputRoot']).resolve()
 for row in sorted(journal.get('operations',[]),key=lambda r:r.get('savedRevision',r.get('readbackRevision',0))):
  if row.get('status')!='applied':continue
  path=Path(row.get('receiptPath','')).resolve()
  if not path.is_file() or not path.is_relative_to(root) or pb.digest(path)!=row.get('receiptSha256'):raise ValueError('acknowledged application proof changed')
  receipt=pb.load(path);op=row['operation']
  if any(receipt.get(k)!=request[k] for k in ('projectId','runId')) or receipt.get('operationId')!=op['operationId']:raise ValueError('acknowledged application identity mismatch')
  back=Path(receipt['readbackPath']).resolve()
  if not back.is_relative_to(root) or pb.digest(back)!=receipt['readbackSha256']:raise ValueError('application readback SHA changed')
  document=pb.load(back);document=document.get('document',document)
  for entry in op['writeSet']:_put(expected,entry['path'],pointer_value(document,entry['path']))
  # Queue markers are trusted system additions, not arbitrary user plan edits.
  markers=[c for c in document.get('productionPlan',{}).get('changes',[]) if c.get('id')==op['operationId'] and c.get('type')=='package-branch-application']
  if markers:
   changes=expected.setdefault('productionPlan',{}).setdefault('changes',[])
   for marker in markers:
    if not any(c.get('id')==marker['id'] for c in changes):changes.append(marker)
 if canonical_hash(expected.get('source'))!=canonical_hash(current.get('source')) or canonical_hash(expected.get('canvas'))!=canonical_hash(current.get('canvas')):raise ValueError('source/canvas changed outside acknowledged operations')
 for item in original_validation.get('readSet',[])+original_validation.get('writeSet',[]):
  path=item['path']
  if canonical_hash(pointer_value(expected,path))!=canonical_hash(pointer_value(current,path)):raise ValueError('manual change during proposal generation: '+'.'.join(path))
 return expected


def reconciliation_document(request,semantic):
 """Frozen model coordinates, with only the deterministic semantic plan added."""
 try:
  from .package_branches_v2 import document_for
  from .animation_package import build_plan
 except ImportError:
  from package_branches_v2 import document_for
  from animation_package import build_plan
 doc=copy.deepcopy(document_for(request))
 plan,_,_=build_plan(semantic,request,doc)
 plan.setdefault('upstream',{}).pop('completePackage',None)
 doc['productionPlan']=plan
 return doc
