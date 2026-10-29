"""Transport persistent proposal-worker progress and enforce the frozen package gate."""
from pathlib import Path

try:
    from .package_branches import load, digest, validate_branch_run, orchestration_version
except ImportError:
    from package_branches import load, digest, validate_branch_run, orchestration_version


def branch_progress(snapshot, root):
    path = Path(root) / 'package-branches.json'
    if not path.is_file() or snapshot.get('packageOrchestrationVersion',2) == 1:
        return None
    value = load(path)
    if value.get('version') != orchestration_version(snapshot) or value.get('projectId') != snapshot['projectId'] or value.get('runId') != (snapshot.get('runId') or snapshot['jobId']):
        raise ValueError('package branch progress identity mismatch')
    return {'version': value['version'], 'runId': value['runId'], 'state': value['status'],
            'branches': [{'id': key, **{k: row[k] for k in ('status', 'startedAt', 'finishedAt', 'error', 'gaps','validation','application','reuse') if k in row}}
                         for key, row in {**value['branches'],**value.get('postStages',{})}.items()]}


def verify_branch_manifest(snapshot, request, manifest, root):
    declared = any('packageOrchestrationVersion' in value for value in (snapshot,request,manifest))
    full_package = snapshot.get('kind') == 'package' and (request.get('fullPackageVersion') == 1 or snapshot.get('fullPackageVersion') == 1)
    if not declared and not full_package:
        return None  # Non-full semantic packages and other job kinds have no coordinator.
    for value in (snapshot,request,manifest):
        orchestration_version(value)
    path=Path(root).resolve()/'package-branches.json'
    if request.get('projectId')!=snapshot['projectId'] or request.get('runId')!=(snapshot.get('runId') or snapshot['jobId']):raise ValueError('package orchestration run identity mismatch')
    if manifest.get('outputs',{}).get('packageBranchesPath')!=str(path):raise ValueError('package orchestration missing canonical branch manifest')
    state=validate_branch_run(request,path,allow_partial=manifest.get('state')!='complete')
    expected=[(str(path),digest(path))]
    try:from .package_branches_v2 import evidence_records
    except ImportError:from package_branches_v2 import evidence_records
    expected.extend((r['path'],r['sha256']) for r in evidence_records(state))
    bound={r['path']:r['sha256'] for r in manifest.get('files',[])}
    if any(bound.get(p)!=sha for p,sha in expected):raise ValueError('package orchestration manifest must bind all branch evidence SHA')
    return state


def verify_operation(snapshot,operation,root):
    orchestration_version(snapshot)
    orchestration_version(operation if isinstance(operation,dict) else {})
    if snapshot.get('kind')!='package' or not isinstance(operation,dict):raise ValueError('operation requires frozen v2 package')
    if operation.get('projectId')!=snapshot['projectId'] or operation.get('runId')!=(snapshot.get('runId') or snapshot['jobId']):raise ValueError('operation identity mismatch')
    proof=Path(operation.get('validationReceiptPath','')).resolve()
    if not proof.is_file() or not proof.is_relative_to(Path(root).resolve()) or digest(proof)!=operation.get('validationReceiptSha256'):raise ValueError('operation proof SHA/root mismatch')
    receipt=load(proof)
    if receipt.get('status')!='passed' or not any(r.get('operationId')==operation.get('operationId') and all(r.get(k)==operation.get(k) for k in ('kind','payload','readSet','writeSet','dependsOn')) for r in receipt.get('operations',[])):raise ValueError('operation not in business validation receipt')
    return operation
