"""Versioned narrow-input coordinator. Single host writer consumes proven operations."""
from __future__ import annotations
import concurrent.futures
import copy
import fcntl
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
import time
import uuid
try:
    from . import package_branches as pb
    from .package_branch_inputs import build_branch_input, validate_dependency_set
    from .package_branch_schedule import order_ready_branches
    from .package_branch_metrics import record_event, summarize_metrics
    from .package_early_handoff import publish_early_handoff
    from .package_branch_validation import validate_branch_proposal
    from .package_branch_reuse import find_reusable_artifact,materialize_reuse
except ImportError:
    import package_branches as pb
    from package_branch_inputs import build_branch_input,validate_dependency_set
    from package_branch_schedule import order_ready_branches
    from package_branch_metrics import record_event,summarize_metrics
    from package_early_handoff import publish_early_handoff
    from package_branch_validation import validate_branch_proposal
    from package_branch_reuse import find_reusable_artifact,materialize_reuse


def document_for(request):
    if request.get('projectSnapshotPath'):
        value=pb.load(request['projectSnapshotPath']);return value.get('document',value)
    return request.get('document',request.get('projectSnapshot',{}))


def evidence_records(state):
    records=[{'path':state['sharedInputPath'],'sha256':state['sharedInputSha256']}]
    shared=pb.load(state['sharedInputPath']);records.extend(shared['identity']['files'])
    if state.get('earlyHandoff',{}).get('receiptPath'):
        p=state['earlyHandoff']['receiptPath'];records.append(pb.file_record(p))
    for row in list(state['branches'].values())+list(state.get('postStages',{}).values()):
        if row.get('status')!='complete':continue
        for key in ('request','result','execution','branchInput'):
            if row.get(key+'Path'):records.append({'path':row[key+'Path'],'sha256':row[key+'Sha256']})
        records.extend(row['files'])
        for key in ('validation','reuse'):
            value=row.get(key,{})
            if value.get('receiptPath'):records.append({'path':value['receiptPath'],'sha256':value['receiptSha256']})
        for op in row.get('operations',[]):records.append({'path':op['path'],'sha256':op['sha256']})
    try:from .package_branch_publication import publication_evidence
    except ImportError:from package_branch_publication import publication_evidence
    records.extend(publication_evidence(Path(state['sharedInputPath']).parents[2]))
    summary=Path(state['sharedInputPath']).parents[2]/'controller-summary.json'
    if summary.is_file():records.append(pb.file_record(summary))
    if state.get('applicationJournalPath'):records.append({'path':state['applicationJournalPath'],'sha256':state['applicationJournalSha256']})
    for row in list(state['branches'].values())+list(state.get('postStages',{}).values()):
        if row.get('validation',{}).get('receiptPath'):records.extend(pb.load(row['validation']['receiptPath']).get('files',[]))
        app=row.get('application',{})
        for rec in app.get('receipts',[]):
            for k in ('receipt','readback'):
                if rec.get(k+'Path'):records.append({'path':rec[k+'Path'],'sha256':rec[k+'Sha256']})
    return list({r['path']:r for r in records}.values())


def validate_run(request,path,allow_partial=False):
    pb.orchestration_version(request)
    state=pb.load(path)
    pb.orchestration_version({'packageOrchestrationVersion':state.get('version')})
    if any(state.get(k)!=request.get(k) for k in ('projectId','runId')):raise ValueError('v2 run identity mismatch')
    if state['status']!='complete' and not allow_partial:raise ValueError('v2 run incomplete')
    shared=pb.load(state['sharedInputPath'])
    if pb.digest(state['sharedInputPath'])!=state['sharedInputSha256'] or shared['identity']['requestSha256']!=pb.json_digest(request):raise ValueError('v2 immutable input changed')
    pb.verify_files(shared['identity']['files'])
    if pb.json_digest(shared['identity'])!=state['inputFingerprint']:raise ValueError('v2 fingerprint changed')
    if set(state['branches'])!=set(pb.branches_for(request)):raise ValueError('v2 core branch set changed')
    for bid,row in state['branches'].items():
        if row['status']=='skipped':
            if request.get('scope',{}).get(bid) is not False:raise ValueError('unauthorized skipped branch')
            continue
        if row['status']!='complete':
            if allow_partial:continue
            raise ValueError('v2 incomplete branch '+bid)
        for key in ('request','result','execution','branchInput'):
            if pb.digest(row[key+'Path'])!=row[key+'Sha256']:raise ValueError('v2 branch evidence SHA changed '+key)
        req=pb.load(row['requestPath']);value=pb.load(row['resultPath']);execution=pb.load(row['executionPath'])
        if any(req.get(k)!=state.get(k) for k in ('projectId','runId')) or req['branchId']!=bid or req['attemptId']!=row['attemptId']:raise ValueError('v2 branch identity stale')
        bundle=pb.load(row['branchInputPath'])
        current=build_branch_input(request,pb.load(shared['semanticPath']),bid)
        if validate_dependency_set(bundle,current):raise ValueError('v2 branch dependency changed')
        if req['dependencies']!=bundle['dependencies'] or req['inputFingerprint']!=bundle['dependencyFingerprint']:raise ValueError('v2 dependencies mismatch')
        pb.validate_result(req,value)
        if execution.get('status')!='returned' or execution.get('resultSha256')!=pb.digest(row['resultPath']):raise ValueError('v2 execution not returned')
        if any(execution.get(k)!=req[k] for k in pb.IDENTITY):raise ValueError('v2 execution identity mismatch')
        if execution.get('runnerKind')=='reuse':
            if pb.digest(execution['originExecutionPath'])!=execution.get('originExecutionSha256'):raise ValueError('reuse original execution changed')
            reuse=pb.load(row['reuse']['receiptPath'])
            if reuse.get('originExecutionSha256')!=execution['originExecutionSha256']:raise ValueError('reuse origin binding changed')
        gate=row.get('validation',{})
        if gate.get('status')!='passed' or pb.digest(gate['receiptPath'])!=gate['receiptSha256']:raise ValueError('v2 validation receipt SHA changed')
        verified=pb.load(gate['receiptPath'])
        if verified.get('proposalSha256')!=pb.digest(value['manifestPath']) or verified.get('resultSha256')!=pb.json_digest(value):raise ValueError('v2 business gate not bound to result')
        if any(verified.get(k)!=req[k] for k in ('projectId','runId','branchId','attemptId')):raise ValueError('v2 business identity mismatch')
        if row['files']!=value['files']:raise ValueError('v2 result/files mismatch')
        if value['status']!='complete':raise ValueError('v2 result incomplete')
    if not allow_partial and state.get('earlyHandoff',{}).get('status')=='blocked' and any(s.get('animationNeed')!='none' for s in pb.load(shared['semanticPath'])['sections']):raise ValueError('early animation handoff blocked')
    pb.verify_files(evidence_records(state))
    return state


def run(request_path,semantic_path,*,runner=None,max_workers=3,retry_failed=False,cancel_event=None,slot_root=None):
    request_path=Path(request_path).resolve();semantic_path=Path(semantic_path).resolve()
    request=pb.load(request_path)
    pb.orchestration_version(request)
    semantic=pb.load(semantic_path)
    if not request.get('projectId') or not request.get('runId'):raise ValueError('v2 project/run/version required')
    if not semantic.get('sections'):raise ValueError('full semantic sections required')
    root=Path(request['outputRoot']).resolve();root.mkdir(parents=True,exist_ok=True)
    owner=(root/'.package-branches.lock').open('a+')
    try:fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:owner.close();raise RuntimeError('package branch coordinator already running')
    try:
        path=root/'package-branches.json';old=pb.load(path) if path.exists() else {}
        if old:pb.orchestration_version({'packageOrchestrationVersion':old.get('version')})
    except (ValueError,OSError):
        owner.close();raise
    stop=cancel_event if cancel_event is not None else threading.Event();cancel=root/'cancel.request'
    def cancelled():
        if cancel.exists():stop.set()
        return stop.is_set()
    identity=pb.input_identity(request,semantic_path);fingerprint=pb.json_digest(identity)
    shared=root/'branch-inputs'/fingerprint/'shared-input.json';shared.parent.mkdir(parents=True,exist_ok=True)
    shared_data={'version':2,'identity':identity,'semanticPath':str(semantic_path),'semantic':semantic,'readOnly':True}
    if not shared.exists():pb.atomic_json(shared,shared_data);shared.chmod(0o444)
    elif pb.load(shared)!=shared_data:owner.close();raise ValueError('frozen shared input changed')
    same=old.get('inputFingerprint')==fingerprint and old.get('runId')==request['runId']
    state={'version':2,'projectId':request['projectId'],'runId':request['runId'],'inputFingerprint':fingerprint,'sharedInputPath':str(shared),'sharedInputSha256':pb.digest(shared),'status':'running','branches':{},'postStages':{},'startedAt':old.get('startedAt',time.time()) if same else time.time()}
    mutex=threading.RLock();slot_root=slot_root or Path(tempfile.gettempdir())/f'codex-package-branch-slots-{os.getuid()}'
    def save():
        state['updatedAt']=time.time();pb.atomic_json(path,state)
        summary={'version':2,'projectId':state['projectId'],'runId':state['runId'],'status':state['status'],'earlyHandoff':state.get('earlyHandoff'),'branches':[]}
        for bid,row in state['branches'].items():
            reason=row.get('error','')
            if row.get('validation',{}).get('receiptPath'):
                reason=pb.load(row['validation']['receiptPath']).get('reason',reason)
            summary['branches'].append({'id':bid,'status':row['status'],'summary':str(reason)[:400],**{k:row[k] for k in ('manifestPath','reportPath','validation','application','reuse') if k in row}})
        pb.atomic_json(root/'controller-summary.json',summary)

    def event(bid,attempt,stage,**kw):record_event(root,{'eventId':f'{request["runId"]}:{bid}:{attempt}:{stage}', 'runId':request['runId'],'branchId':bid,'attemptId':attempt,'stage':stage,**kw})
    # User can start manual animation work as soon as semantic needs are frozen.
    state['earlyHandoff']=publish_early_handoff(request,semantic_path)
    document=document_for(request)
    if request.get('packageExecution',{}).get('streamingApply'):
        try:
            from .package_branch_publication import publish_initial_plan
        except ImportError:
            from package_branch_publication import publish_initial_plan
        initial=publish_initial_plan(request,semantic,document)
        state['initialPlan']={'operationId':initial['operationId']}
    cache_path=Path(request.get('packageReuseIndexPath') or root/'proposal-cache.json');cache=pb.load(cache_path) if cache_path.exists() else {'artifacts':[]}
    source_index=request.get('packageReuseSourceIndexPath')
    if source_index and request.get('packageExecution',{}).get('reusePolicy')=='validated-project-artifacts':
        cache['artifacts']=[*pb.load(source_index).get('artifacts',[]),*cache['artifacts']]
    try:
        for bid in pb.branches_for(request):
            if request.get('scope',{}).get(bid) is False:
                state['branches'][bid]={'id':bid,'status':'skipped','reason':'explicit scope=false'};continue
            previous=old.get('branches',{}).get(bid,{}) if same else {}
            prior=old.get('branches',{}).get(bid,{})
            process_path=Path(prior.get('outputRoot',root))/'process.json'
            if prior.get('status') in {'running','failed','cancelled','blocked'} and process_path.is_file():
                try:
                    os.killpg(int(pb.load(process_path)['processGroup']),0)
                    state['branches'][bid]={**prior,'status':'blocked','error':'previous process group still alive; retry deferred'};continue
                except ProcessLookupError:pass
                except (PermissionError,KeyError,ValueError):
                    state['branches'][bid]={**prior,'status':'blocked','error':'cannot verify previous process stopped'};continue
            if previous.get('status')=='complete':
                try:
                    candidate=copy.deepcopy(old);candidate['branches']={k:(previous if k==bid else {'status':'failed'}) for k in pb.branches_for(request)}
                    temp=root/f'.verify-{bid}.json';pb.atomic_json(temp,candidate)
                    validate_run(request,temp,allow_partial=True);temp.unlink()
                    state['branches'][bid]=previous;continue
                except (ValueError,OSError,KeyError,TypeError):pass
            if previous.get('status') in {'failed','blocked','cancelled','running'} and not retry_failed:
                previous=copy.deepcopy(previous)
                if previous['status']=='running':previous.update(status='failed',error='interrupted attempt; explicit retry required')
                state['branches'][bid]=previous;continue
            if retry_failed and previous.get('status')=='failed':
                # A returned model proposal need not be regenerated when only
                # its native gate failed. Keep its original execution and bytes.
                try:
                    req=pb.load(previous['requestPath']);out=Path(req['outputRoot'])
                    if req.get('branchId')!=bid or req.get('attemptId')!=previous.get('attemptId'):raise ValueError('returned branch identity changed')
                    bundle=pb.load(req['branchInputPath']);value=pb.load(out/'result.json');execution=pb.load(out/'execution.json')
                    if pb.digest(previous['requestPath'])!=previous['requestSha256'] or pb.digest(req['branchInputPath'])!=previous['branchInputSha256']:raise ValueError('returned input changed')
                    if execution.get('status')!='returned' or execution.get('resultSha256')!=pb.digest(out/'result.json'):raise ValueError('unproven model return')
                    if any(execution.get(k)!=req.get(k) for k in pb.IDENTITY) or any(req.get(k)!=request[k] for k in ('projectId','runId')):raise ValueError('returned identity changed')
                    if validate_dependency_set(bundle,build_branch_input(request,semantic,bid)):raise ValueError('returned dependencies changed')
                    if req['dependencies']!=bundle['dependencies'] or req['inputFingerprint']!=bundle['dependencyFingerprint']:raise ValueError('returned dependency binding changed')
                    gate=validate_branch_proposal({**req,'request':request,'semantic':semantic},value,document)
                    gate_path=out/('branch-revalidation-'+pb.json_digest(gate)[:16]+'.json');pb.atomic_json(gate_path,gate)
                    restored=copy.deepcopy(previous)
                    restored['revalidation']={'previousError':restored.pop('error',''),'revalidatedAt':time.time()}
                    restored.update(status='complete',resultSha256=pb.digest(out/'result.json'),executionPath=str(out/'execution.json'),executionSha256=pb.digest(out/'execution.json'),**{k:value[k] for k in ('files','manifestPath','reportPath','proposedChanges','acceptance','gaps')})
                    restored['validation']={'status':'passed','receiptPath':str(gate_path),'receiptSha256':pb.digest(gate_path)}
                    restored['application']={'status':'waiting_dependencies' if gate['operations'] else 'not_required'}
                    state['branches'][bid]=restored;continue
                except (ValueError,OSError,KeyError,TypeError):pass
            attempt=uuid.uuid4().hex;out=root/'branches'/bid/attempt;out.mkdir(parents=True)
            row={'id':bid,'attemptId':attempt,'status':'queued','outputRoot':str(out),'queuedAt':time.time(),'validation':{'status':'pending'},'application':{'status':'waiting_dependencies'}}
            state['branches'][bid]=row
            try:
                bundle=build_branch_input(request,semantic,bid);bundle['reusePolicy']=request.get('packageExecution',{}).get('reusePolicy','same-run')
                bundle_path=out/'branch-input.json';pb.atomic_json(bundle_path,bundle);bundle_path.chmod(0o444)
                req={'version':2,'projectId':request['projectId'],'runId':request['runId'],'branchId':bid,'attemptId':attempt,'inputFingerprint':bundle['dependencyFingerprint'],'dependencyFingerprint':bundle['dependencyFingerprint'],'dependencies':bundle['dependencies'],'outputRoot':str(out),'branchInputPath':str(bundle_path),'requestPath':str(out/'request.json')}
                pb.atomic_json(req['requestPath'],req)
                row.update(requestPath=req['requestPath'],requestSha256=pb.digest(req['requestPath']),branchInputPath=str(bundle_path),branchInputSha256=pb.digest(bundle_path),dependencyFingerprint=bundle['dependencyFingerprint'],resultPath=str(out/'result.json'))
                event(bid,attempt,'queued',bundleBytes=bundle_path.stat().st_size)
            except (ValueError,OSError,KeyError) as exc:row.update(status='blocked',error=str(exc),gaps=[str(exc)])
        save()
        def release_operations():
            # A separate publication pump revalidates against the current API
            # projection and waits for actual host acknowledgements per save.
            for row in state['branches'].values():
                if row.get('status')=='complete':
                    gate=pb.load(row['validation']['receiptPath'])
                    row['application']={'status':'waiting_dependencies' if gate['operations'] else 'not_required'}
        def execute(bid):
            row=state['branches'][bid];req=pb.load(row['requestPath']);attempt=req['attemptId'];out=Path(req['outputRoot'])
            try:
                if cancelled():raise pb.Cancelled('parent cancelled')
                bundle=pb.load(req['branchInputPath'])
                origin=find_reusable_artifact(bundle,cache) if bundle.get('reusePolicy')!='none' else None
                execution={k:req[k] for k in pb.IDENTITY}
                execution_path=out/'execution.json'
                def started():
                    with mutex:row.update(status='running',startedAt=time.time());save()
                    event(bid,attempt,'start',promptBytes=len(pb.worker_prompt(req).encode()) if not origin else 0)
                if origin:
                    started()
                    value=materialize_reuse(origin,{**req,'branchInput':bundle})
                    value.update({k:req[k] for k in pb.IDENTITY})
                    pb.atomic_json(out/'result.json',value)
                    execution.update(runnerKind='reuse',originExecutionPath=origin['executionPath'],originExecutionSha256=origin['executionSha256'])
                    row['reuse']={'status':'materialized','originRunId':origin['runId'],'originAttemptId':origin['attemptId'],'receiptPath':value['reuseReceiptPath'],'receiptSha256':pb.digest(value['reuseReceiptPath'])}
                else:
                    with pb.global_slot(slot_root,stop) as slot:
                        started()
                        req['_slotFd']=slot
                        execution.update(runnerKind='injected' if runner else 'codex',startedAt=row['startedAt'],status='running')
                        pb.atomic_json(execution_path,execution)
                        value=(runner or pb.default_runner)(req,stop)
                if cancelled():raise pb.Cancelled('cancelled; late publication rejected')
                if value is None:value=pb.load(out/'result.json')
                pb.validate_result(req,value)
                if pb.load(out/'result.json')!=value:raise ValueError('unpublished result mismatch')
                if pb.input_identity(request,semantic_path)!=identity or pb.load(request_path)!=request:raise ValueError('frozen input changed during execution')
                execution.update(status='returned',finishedAt=time.time(),resultSha256=pb.digest(out/'result.json'));pb.atomic_json(execution_path,execution)
                usage=None
                log=out/'worker.log'
                if log.is_file():
                    for line in log.read_text(errors='replace').splitlines():
                        try:
                            entry=json.loads(line)
                            if entry.get('type')=='turn.completed' and isinstance(entry.get('usage'),dict):usage={k:v for k,v in entry['usage'].items() if k in ('input_tokens','output_tokens','cached_input_tokens') and type(v) is int and v>=0}
                        except (ValueError,TypeError):pass
                event(bid,attempt,'model-return',runnerKind=execution['runnerKind'],usage=usage)
                # Heavy native validation is outside the model slot.
                event(bid,attempt,'validation')
                gate=validate_branch_proposal({**req,'request':request,'semantic':semantic},value,document)
                gate_path=out/'branch-validation.json';pb.atomic_json(gate_path,gate)
                with mutex:
                    if cancelled():raise pb.Cancelled('cancelled before result release')
                    row.update(status='complete',resultSha256=pb.digest(out/'result.json'),executionPath=str(execution_path),executionSha256=pb.digest(execution_path),**{k:value[k] for k in ('files','manifestPath','reportPath','proposedChanges','acceptance','gaps')})
                    row['validation']={'status':'passed','receiptPath':str(gate_path),'receiptSha256':pb.digest(gate_path)}
                    release_operations();save()
                    if execution['runnerKind']!='reuse':
                        cache['artifacts'].append({**value,'branchInput':bundle,'dependencyFingerprint':bundle['dependencyFingerprint'],'projectId':req['projectId'],'runId':req['runId'],'branchId':bid,'attemptId':attempt,'outputRoot':str(out),'resultPath':str(out/'result.json'),'resultSha256':pb.digest(out/'result.json'),'executionPath':str(execution_path),'executionSha256':pb.digest(execution_path),'validation':row['validation']})
                        pb.atomic_json(cache_path,cache)
                event(bid,attempt,'complete',status='complete',runnerKind=execution['runnerKind'])
            except pb.Cancelled as exc:
                with mutex:row.update(status='cancelled',error=str(exc));save()
                event(bid,attempt,'cancelled')
            except Exception as exc:
                with mutex:row.update(status='failed',error=str(exc),gaps=[str(exc)]);save()
                event(bid,attempt,'failed')
            finally:
                with mutex:row['finishedAt']=time.time();release_operations();save()
        monitor_done=threading.Event()
        def monitor():
            while not monitor_done.wait(.05):
                if cancelled():return
        watcher=threading.Thread(target=monitor,daemon=True);watcher.start();handlers={}
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGTERM,signal.SIGINT):handlers[sig]=signal.getsignal(sig);signal.signal(sig,lambda *_:stop.set())
        try:
            ready=[{**row,'animationDeliveryRelevant':bid=='templates' and any(s.get('animationNeed')!='none' for s in semantic['sections'])} for bid,row in state['branches'].items() if row['status']=='queued']
            order=order_ready_branches(ready,request.get('branchDurationEstimates',{}))
            state['scheduleOrder']=order;save()
            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(3,int(max_workers)))) as pool:
                futures=[pool.submit(execute,bid) for bid in order]
                for future in concurrent.futures.as_completed(futures):future.result()
        finally:
            monitor_done.set();watcher.join()
            for sig,handler in handlers.items():signal.signal(sig,handler)
        state['status']='cancelled' if cancelled() else ('complete' if all(r['status'] in {'complete','skipped'} for r in state['branches'].values()) else 'partial')
        if cancelled():
            for row in state['branches'].values():
                if row['status']=='queued':row.update(status='cancelled',error='cancelled before start')
        state['finishedAt']=time.time();save();event('controller','summary','finalize',controllerBytes=(root/'controller-summary.json').stat().st_size);summarize_metrics(root)
        return copy.deepcopy(state)
    finally:owner.close()
