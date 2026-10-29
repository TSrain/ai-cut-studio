#!/usr/bin/env python3
"""Public post-application sound stage; emits validated operations for the host."""
import argparse
import copy
import fcntl
import json
from pathlib import Path
import sys
import threading
import time
if __package__ in (None,''):
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools import package_branches as pb
from tools.package_sound_branch import prepare_sound_input, run_sound_branch
from tools.package_branch_validation import validate_branch_proposal


def run_sound_stage(request_path,events_path,snapshot_path,*,runner=None,cancel_event=None,slot_root=None):
    request_path=Path(request_path).resolve();request=pb.load(request_path)
    pb.orchestration_version(request)
    root=Path(request['outputRoot']).resolve();root.mkdir(parents=True,exist_ok=True)
    state_path=root/'package-branches.json'
    with (root/'.package-branches.lock').open('a+') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('package coordinator or sound stage already running')
        state=pb.load(state_path)
        if state.get('version')!=2 or any(state.get(k)!=request.get(k) for k in ('projectId','runId')):raise ValueError('sound run identity mismatch')
        shared_path=Path(state['sharedInputPath']).resolve()
        if not shared_path.is_relative_to(root) or pb.digest(shared_path)!=state['sharedInputSha256']:raise ValueError('immutable shared input changed')
        shared=pb.load(shared_path);semantic_path=Path(shared['semanticPath']).resolve()
        identity=pb.input_identity(request,semantic_path)
        if identity!=shared['identity'] or pb.json_digest(identity)!=state['inputFingerprint']:raise ValueError('original input fingerprint changed')
        if request.get('scope',{}).get('sound') is False:
            state.setdefault('postStages',{})['sound']={'status':'skipped','reason':'sound scope disabled','application':{'status':'not_required'}}
            state['updatedAt']=time.time();pb.atomic_json(state_path,state);return state
        events_path=Path(events_path).resolve();snapshot_path=Path(snapshot_path).resolve()
        bindings=[pb.file_record(events_path),pb.file_record(snapshot_path)]
        def verify():
            if pb.load(request_path)!=request or pb.input_identity(request,semantic_path)!=identity or pb.digest(shared_path)!=state['sharedInputSha256']:raise ValueError('original inputs changed during sound stage')
            for item in bindings:
                if not Path(item['path']).is_file() or pb.digest(item['path'])!=item['sha256']:raise ValueError('applied events/current snapshot changed during sound stage')
        stop=cancel_event if cancel_event is not None else threading.Event()
        if (root/'cancel.request').exists():stop.set()
        if stop.is_set():raise pb.Cancelled('sound cancelled before preparation')
        document=pb.load(snapshot_path);document=document.get('document',document)
        events=pb.load(events_path)
        prepared=prepare_sound_input({**request,'semanticPath':str(semantic_path)},events,document)
        row={'status':prepared['status'],'application':{'status':'waiting_dependencies'},'sourceEvidence':bindings}
        state.setdefault('postStages',{})['sound']=row
        def publish():
            verify();state['updatedAt']=time.time();pb.atomic_json(state_path,state)
        if prepared['status']=='skipped':
            row['application']={'status':'not_required'};row['reason']=prepared.get('reason');publish();return state
        if prepared['status']=='blocked':
            row['issues']=prepared.get('issues',[]);state['status']='partial';publish();return state
        out=Path(prepared['outputRoot']).resolve()
        if not out.is_relative_to(root):raise ValueError('sound outputRoot outside current run')
        prepared['dependencies'].extend(bindings)
        prepared['semantic']=pb.load(semantic_path)
        prepared['request']=request
        out.mkdir(parents=True,exist_ok=True)
        req_path=out/'request.json';pb.atomic_json(req_path,prepared)
        row.update(status='running',attemptId=prepared['attemptId'],requestPath=str(req_path))
        publish()
        execution_path=out/'execution.json'
        execution={**{k:prepared[k] for k in pb.IDENTITY},'runnerKind':'injected' if runner else 'codex-cli-ephemeral','status':'started','startedAt':time.time()}
        pb.atomic_json(execution_path,execution)
        try:
            result=run_sound_branch(req_path,stop,slot_root=slot_root,runner=runner)
            verify()
            if result.get('status')!='complete':
                row.update(status='blocked',gaps=result.get('gaps',[]));state['status']='partial';publish();return state
            proposal=pb.load(result['manifestPath'])
            if 'reviewedSections' not in proposal and proposal.get('reviewedSectionIds'):
                # Canonical normalization updates actual files/SHA, never in-memory-only evidence.
                proposal['reviewedSections']=proposal['reviewedSectionIds'];pb.atomic_json(result['manifestPath'],proposal)
                result['files']=[pb.file_record(r['path']) for r in result['files']]
                pb.atomic_json(out/'result.json',result)
            gate=validate_branch_proposal(prepared,result,document)
            if request.get('editReconciliationVersion')==1:
                base_path=out/'reconciliation-base.json';pb.atomic_json(base_path,{'document':document})
                gate.update(reconciliationBasePath=str(base_path),reconciliationBaseSha256=pb.digest(base_path))
                for op in gate['operations']:op['files']=[*op['files'],pb.file_record(base_path)]
            # The worker may already bind validation.json as proposal evidence.
            # Keep the host gate in its own namespace; never overwrite that proof.
            gate_dir=out/'host-validation';gate_dir.mkdir(exist_ok=True)
            gate_path=gate_dir/'receipt.json'
            if gate_path.exists():raise ValueError('host sound validation receipt already exists')
            pb.atomic_json(gate_path,gate)
            operations=[]
            for op in gate['operations']:
                op=copy.deepcopy(op);op['validationReceiptPath']=str(gate_path);op['validationReceiptSha256']=pb.digest(gate_path);op['dependencyBranches']=[]
                destination=root/'operations'/(op['operationId']+'.json');pb.atomic_json(destination,op);operations.append(pb.file_record(destination))
            execution.update(status='returned',finishedAt=time.time(),resultSha256=pb.digest(out/'result.json'));pb.atomic_json(execution_path,execution)
            row.update(status='complete',requestSha256=pb.digest(req_path),resultPath=str(out/'result.json'),resultSha256=pb.digest(out/'result.json'),executionPath=str(execution_path),executionSha256=pb.digest(execution_path),operations=operations,validation={'status':'passed','receiptPath':str(gate_path),'receiptSha256':pb.digest(gate_path)},application={'status':'queued' if operations else 'not_required'},**{k:result[k] for k in ('files','manifestPath','reportPath','proposedChanges','acceptance','gaps')})
            # Complete means proposal/validation only. Host application and full-package gates remain pending.
            publish();return state
        except (ValueError,OSError,RuntimeError,KeyError) as exc:
            execution.update(status='cancelled' if stop.is_set() else 'failed',error=str(exc),finishedAt=time.time());pb.atomic_json(execution_path,execution)
            row.update(status=execution['status'],error=str(exc),gaps=[str(exc)],executionPath=str(execution_path),executionSha256=pb.digest(execution_path))
            state['status']='partial';publish();return state


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for flag in ('request','events','snapshot'):parser.add_argument('--'+flag,required=True)
    args=parser.parse_args();state=run_sound_stage(args.request,args.events,args.snapshot)
    print(json.dumps({'status':state['status'],'sound':state['postStages']['sound']},ensure_ascii=False))
    return 0 if state['postStages']['sound']['status'] in {'complete','skipped'} else 2

if __name__=='__main__':raise SystemExit(main())
