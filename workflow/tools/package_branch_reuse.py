"""Explicit project-local successful proposal reuse; never applies to an editor.

project_cache is an index dict {artifacts:[...]}, list of registered origins, or a
path to that index. Origins bind branchInput, dependencyFingerprint, files,
executionPath/executionSha256, validation.status and project/run/attempt/branch.
Same-run resume is enabled; cross-run requires branch_input.reusePolicy set to
validated-project-artifacts. current_request supplies a fresh outputRoot and
identity. Materialization returns a result envelope plus reuse-receipt.json.
"""
from __future__ import annotations
import copy
import json
from pathlib import Path
try:
    from .package_branch_inputs import digest_file, dependency_fingerprint, validate_dependency_set
except ImportError:
    from package_branch_inputs import digest_file, dependency_fingerprint, validate_dependency_set


def _read(value):
    return json.loads(Path(value).read_text(encoding='utf-8')) if isinstance(value,(str,Path)) else value

def _verified(origin,bundle):
    if origin.get('projectId')!=bundle.get('common',{}).get('projectId') or origin.get('branchId')!=bundle.get('branchId'): return False
    if origin.get('status')!='complete' or origin.get('validation',{}).get('status')!='passed': return False
    original=origin.get('branchInput')
    if not isinstance(original,dict): return False
    if origin.get('dependencyFingerprint')!=dependency_fingerprint(original) or dependency_fingerprint(original)!=dependency_fingerprint(bundle): return False
    if validate_dependency_set(original,bundle): return False
    # Extra model reads cannot be silently omitted from the cache key.
    for record in origin.get('additionalDependencies',[]):
        if record.get('kind','file')!='file' or not record.get('path') or not record.get('sha256'): return False
        if digest_file(record['path'])!=record['sha256']: return False
    files=origin.get('files',[])
    if not files: return False
    root=Path(origin['outputRoot']).resolve()
    registered=set()
    for record in files:
        path=Path(record['path']).resolve()
        if not path.is_relative_to(root) or digest_file(path)!=record['sha256']: return False
        registered.add(str(path))
    for key in ('manifestPath','reportPath'):
        if origin.get(key) and str(Path(origin[key]).resolve()) not in registered: return False
    if origin.get('resultPath'):
        if digest_file(origin['resultPath'])!=origin.get('resultSha256'): return False
    execution=Path(origin['executionPath'])
    if digest_file(execution)!=origin['executionSha256']: return False
    evidence=_read(execution)
    if evidence.get('runnerKind') not in ('codex','injected'): return False
    return True

def find_reusable_artifact(branch_input,project_cache):
    if branch_input.get('forceRecreate') or branch_input.get('reusePolicy')=='disabled': return None
    cache=_read(project_cache)
    origins=cache.get('artifacts',[]) if isinstance(cache,dict) else cache
    if not isinstance(origins,list): return None
    for origin in reversed(origins):
        if not isinstance(origin,dict): continue
        if origin.get('runId')!=branch_input.get('runId') and branch_input.get('reusePolicy')!='validated-project-artifacts': continue
        try:
            if _verified(origin,branch_input): return copy.deepcopy(origin)
        except (OSError,ValueError,KeyError,TypeError): continue
    return None

def _rewrite(value,mapping):
    if isinstance(value,str):
        for old,new in mapping.items(): value=value.replace(old,new)
        return value
    if isinstance(value,list): return [_rewrite(v,mapping) for v in value]
    if isinstance(value,dict): return {k:_rewrite(v,mapping) for k,v in value.items()}
    return value

def materialize_reuse(origin,current_request):
    bundle=current_request.get('branchInput')
    if not bundle or not _verified(origin,bundle): raise ValueError('reuse origin dependencies/evidence invalid')
    for key in ('projectId','branchId'):
        if current_request.get(key)!=origin.get(key): raise ValueError('reuse identity mismatch: '+key)
    for key in ('runId','attemptId','outputRoot'):
        if not current_request.get(key): raise ValueError('fresh '+key+' required')
    old=Path(origin['outputRoot']).resolve(); new=Path(current_request['outputRoot']).resolve()
    if new==old or new.is_relative_to(old) or old.is_relative_to(new): raise ValueError('independent outputRoot required')
    if new.exists() and any(p.name not in ('request.json','branch-input.json') or not p.is_file() for p in new.iterdir()): raise ValueError('reuse destination must contain only coordinator inputs')
    new.mkdir(parents=True,exist_ok=True)
    mapping={}
    for rec in origin['files']:
        target=str(Path(current_request['outputRoot'])/Path(rec['path']).resolve().relative_to(old))
        mapping[str(Path(rec['path']).resolve())]=target
        mapping[rec['path']]=target
    files=[]
    for record in origin['files']:
        source=Path(record['path']).resolve(); target=Path(mapping[str(source)]); target.parent.mkdir(parents=True,exist_ok=True)
        if source.suffix.lower()=='.json':
            target.write_text(json.dumps(_rewrite(_read(source),mapping),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        elif source.suffix.lower() in ('.md','.txt'):
            text=source.read_text(encoding='utf-8')
            target.write_text(_rewrite(text,mapping),encoding='utf-8')
        else:
            with source.open('rb') as src,target.open('wb') as dst:
                for chunk in iter(lambda:src.read(1024*1024),b''): dst.write(chunk)
        files.append({'path':str(target),'sha256':digest_file(target)})
    receipt={'version':1,'projectId':current_request['projectId'],'runId':current_request['runId'],'branchId':current_request['branchId'],'attemptId':current_request['attemptId'],'originRunId':origin['runId'],'originAttemptId':origin['attemptId'],'originResultPath':origin.get('resultPath'),'originResultSha256':origin.get('resultSha256'),'originExecutionPath':origin['executionPath'],'originExecutionSha256':origin['executionSha256'],'dependencyFingerprint':dependency_fingerprint(bundle),'status':'materialized','requiresCurrentValidation':True,'requiresCurrentProtectionCheck':True,'requiresCurrentReadback':True}
    receipt_path=new/'reuse-receipt.json'; receipt_path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    result=_rewrite(copy.deepcopy(origin),mapping)
    result.update({key:current_request[key] for key in ('projectId','runId','branchId','attemptId','outputRoot')})
    result.update({'runnerKind':'reuse','files':files+[{'path':str(receipt_path),'sha256':digest_file(receipt_path)}],'reuse':receipt,'reuseReceiptPath':str(receipt_path),'branchInput':copy.deepcopy(bundle),'dependencyFingerprint':dependency_fingerprint(bundle),'validation':{'status':'pending'},'application':{'status':'waiting_dependencies'}})
    # Execution evidence belongs to the origin; no new model execution is invented.
    result['executionPath']=origin['executionPath']; result['executionSha256']=origin['executionSha256']
    for key in ('resultPath','resultSha256','productionReceiptPaths','productionReadbackPath'): result.pop(key,None)
    return result
