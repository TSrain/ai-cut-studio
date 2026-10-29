"""Read-only native business gates for isolated package proposals."""
from __future__ import annotations
import copy
from decimal import Decimal
import hashlib
import json
import math
import subprocess
import shutil
from pathlib import Path

VALIDATOR_VERSION = 1
BRANCH_KINDS = {'templates':'template','footage':'footage','camera':'camera','captions':'captions','cover':'cover','aiVideo':'aiVideo','sound':'sound','bgm':'bgm'}

def canonical_json(value):
    """Match JSON.stringify of recursively sorted objects in the native host.

    JavaScript enumerates array-index keys numerically even after lexical sorting.
    Numbers use ECMAScript's fixed/exponent thresholds and IEEE-754 identity.
    """
    def string(text):
        encoded=json.dumps(text,ensure_ascii=False,separators=(',',':'))
        return ''.join('\\u%04x'%ord(char) if 0xD800<=ord(char)<=0xDFFF else char for char in encoded)
    def number(number):
        if isinstance(number,int) and abs(number)<=2**53:return str(number)
        number=float(number)
        if not math.isfinite(number):raise ValueError('non-finite canonical number')
        if number==0:return '0'
        raw=repr(number).lower();absolute=abs(number)
        if 1e-6<=absolute<1e21:
            text=format(Decimal(raw),'f')
            return text.rstrip('0').rstrip('.') if '.' in text else text
        coefficient,_,exponent=raw.partition('e')
        coefficient=coefficient.removesuffix('.0')
        if not exponent:return coefficient
        exponent=int(exponent)
        return coefficient+'e'+('+' if exponent>=0 else '-')+str(abs(exponent))
    def encode(item):
        if item is None:return 'null'
        if item is True:return 'true'
        if item is False:return 'false'
        if isinstance(item,(int,float)):return number(item)
        if isinstance(item,str):return string(item)
        if isinstance(item,list):return '['+','.join(encode(v) for v in item)+']'
        if isinstance(item,dict):
            if any(not isinstance(k,str) for k in item):raise TypeError('canonical object keys must be strings')
            keys=sorted(item,key=lambda k:k.encode('utf-16-be',errors='surrogatepass'))
            indices=[k for k in keys if k.isascii() and k.isdigit() and str(int(k))==k and int(k)<2**32-1]
            ordered=sorted(indices,key=int)+[k for k in keys if k not in indices]
            return '{'+','.join(string(k)+':'+encode(item[k]) for k in ordered)+'}'
        raise TypeError('unsupported canonical value')
    return encode(value)


def canonical_hash(value):
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()

def file_hash(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def pointer_value(document, path):
    value=document
    for key in path:
        if isinstance(value,list):value=value[int(key)]
        elif key in value:value=value[key]
        else:return {'__package_missing__':True}
    return value

def _bounded_file(path,req,files):
    p=Path(path or '').resolve();root=Path(req['outputRoot']).resolve()
    if not p.is_file() or not p.is_relative_to(root) or str(p) not in files:
        raise ValueError('business evidence must be a SHA-bound branch file')
    return p

def _camera(plan,document,request):
    if not isinstance(plan,dict) or plan.get('version')!=2:raise ValueError('cameraPlan requires version 2')
    root=Path(request.get('visualizationRoot') or Path(__file__).resolve().parents[2] / 'studio').resolve()
    module=root/'tools/lib/aroll-shot-plan.mjs'
    if not module.is_file():raise ValueError('native camera validator missing')
    code="import {validateShotPlan} from "+json.dumps(module.as_uri())+";let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);console.log(JSON.stringify(validateShotPlan(v.plan,{duration:v.duration})));"
    duration=document['canvas']['durationFrames']*document['canvas']['fps']['den']/document['canvas']['fps']['num']
    if document.get('source',{}).get('clips') is not None:duration=plan.get('duration',duration)
    proc=subprocess.run([shutil.which('node') or 'node','--input-type=module','-e',code],input=json.dumps({'plan':plan,'duration':duration}),text=True,capture_output=True,timeout=30)
    if proc.returncode:raise ValueError('native camera validator failed: '+proc.stderr[-500:])
    report=json.loads(proc.stdout)
    if report.get('errors') or 'errors' not in report:raise ValueError('native camera plan invalid: '+str(report.get('errors',[])))


def validate_branch_proposal(branch_request, result, current_projection):
    try:
        from .package_branches import validate_result
    except ImportError:
        from package_branches import validate_result
    req=branch_request;validate_result(req,result)
    if result['status']!='complete':raise ValueError('blocked proposal cannot pass business validation')
    proposal=json.loads(Path(result['manifestPath']).read_text());branch=req['branchId']
    if branch not in BRANCH_KINDS:raise ValueError('unknown proposal branch')
    files={str(Path(r['path']).resolve()) for r in result['files']}
    semantic=req.get('semantic',{});request=req.get('request',req)
    document=copy.deepcopy(current_projection)
    payloads=[];operation_files=copy.deepcopy(result['files']);read_paths=[['canvas'],['source']];write_paths=[];issues=[]
    decision=proposal.get('decision')
    # Leave-blank must be explicit, not inferred from an empty items array.
    no_op=decision in {'leave_blank','preserved_manual'}
    if no_op:
        sections=semantic.get('sections',[])
        if not sections or proposal.get('reviewedSections')!=[s['id'] for s in sections]:raise ValueError('leave_blank requires full current semantic review')
        if proposal.get('items') or result.get('proposedChanges'):raise ValueError('leave_blank cannot carry changes')
        if decision=='preserved_manual' and (not isinstance(proposal.get('protected'),list) or not proposal['protected'] or any(not isinstance(p,str) for p in proposal['protected'])):raise ValueError('manual preservation needs concrete protected records')
    if branch == 'bgm' and no_op:
        raise ValueError('BGM requires per-section music/silence review, not generic leave_blank')
    if no_op and branch not in {'templates','footage','captions'}:
        pass
    elif branch=='templates':
        try:from .animation_package import build_plan,validate_template_review
        except ImportError:from animation_package import build_plan,validate_template_review
        if not proposal['items'] and not no_op:raise ValueError('empty templates require explicit leave_blank review')
        analysis=copy.deepcopy(semantic);sections={row['id']:row for row in analysis.get('sections',[])}
        for row in sections.values():
            row['templateMatch']={'status':'none','reason':proposal['reason']}
        seen=set()
        for item in proposal['items']:
            section=sections.get(item.get('shotId'))
            if not section or item.get('shotId') in seen or item.get('requirementVersion')!=section.get('requirementVersion'):raise ValueError('template stale or duplicate requirement')
            seen.add(item['shotId'])
            preset=item.get('preset')
            section['templateMatch']={'status':item.get('matchStatus','direct'),'presetId':preset.get('id') if isinstance(preset,dict) else preset,
                'props':copy.deepcopy(item.get('props',{})),'reason':item.get('reason',proposal['reason'])}
            if isinstance(preset,dict):section['templateMatch']['presetVersion']=preset.get('version')
            for key in ('startSeconds','durationSeconds'):
                if key in item:section['templateMatch'][key]=item[key]
            if item.get('sourceCueIds') is not None:section['templateMatch']['sourceCueIds']=item['sourceCueIds']
        review=proposal.get('templateReview')
        if review is None:
            review_path=_bounded_file(proposal.get('templateReviewPath') or str(Path(req['outputRoot'])/'templateReview.json'),req,files)
            review=json.loads(review_path.read_text())
        if not isinstance(review,dict):raise ValueError('templates require full templateReview')
        validate_template_review({**analysis,'templateReview':review},request)
        if any(row.get('decision')=='blocked' for row in review['sections']):raise ValueError('blocked template review cannot pass')
        if not no_op:
            _,native_results,issues=build_plan(analysis,request,document)
            if issues or len(native_results)!=len(proposal['items']):raise ValueError('native template planning failed: '+str(issues))
            for native in native_results:
                if native['requirementVersion']!=sections[native['shotId']]['requirementVersion']:raise ValueError('native template requirement changed after baseline')
                payloads.append({'nativeResult':native})
        read_paths+=[['captions'],['productionPlan']];write_paths=[['instances'],['tracks'],['productionPlan']]
    elif branch=='aiVideo':
        try:from .ai_video_package import validate_candidates
        except ImportError:from ai_video_package import validate_candidates
        sections={s['id']:s for s in semantic.get('sections',[])};rows=proposal.get('sections')
        if not isinstance(rows,list) or len(rows)!=len(sections) or {r.get('id') for r in rows}!=set(sections):raise ValueError('AI proposal must cover all frozen sections')
        for row in rows:validate_candidates(row.get('aiVideoCandidates'),request,sections[row['id']])
        if any(row.get('aiVideoCandidates') for row in rows):payloads=[{'value':[{'shotId':r['id'],'requirementVersion':sections[r['id']]['requirementVersion'],'aiVideoCandidates':r['aiVideoCandidates']} for r in rows]}]
        read_paths=[['canvas'],['source'],['productionPlan']];write_paths=[['productionPlan']]
    elif branch=='bgm':
        try:from .bgm_package import validate_proposal
        except ImportError:from bgm_package import validate_proposal
        validate_proposal(proposal,semantic)
        payloads=[];read_paths=[['canvas'],['source'],['productionPlan']];write_paths=[]
        if request.get('bgmExecutionVersion') == 1:
            try:from .bgm_package import build_execution
            except ImportError:from bgm_package import build_execution
            # First-package snapshots can have no plan yet. Use the same frozen
            # semantic/SRT plan as semanticPlan publication, without rebasing
            # read/write protections onto an unacknowledged live document.
            existing={s['id']:s for s in document.get('productionPlan',{}).get('shots',[])}
            if any(existing.get(s['id'],{}).get('requirementVersion')!=s['requirementVersion'] for s in semantic['sections']):
                try:from .animation_package import build_plan
                except ImportError:from animation_package import build_plan
                document['productionPlan'],_,_=build_plan(semantic,request,document)
            execution=build_execution(proposal,semantic,document,req['outputRoot'],result['files'],request.get('visualizationRoot'))
            payloads=[{'value':{'bgmPlanVersion':1,'sections':proposal['sections'],'recommendations':proposal['recommendations'],
                'recommendationGaps':proposal.get('recommendationGaps',[]),'execution':execution}}]
            write_paths=[['productionPlan'],['audioClips'],['audioTracks'],['styleReference','allowedOverrides','bgmApplication']]
            read_paths += [['audioClips'],['audioTracks'],['styleReference','allowedOverrides','bgmApplication']]
            issues.extend({'reason':'BGM: '+gap} for gap in execution['gaps'])
    elif branch=='captions':
        try:from .caption_quality import audit
        except ImportError:from caption_quality import audit
        value=proposal.get('captions')
        if not isinstance(value,dict) or not isinstance(value.get('cues'),list):raise ValueError('captions must be native track')
        path=_bounded_file(proposal.get('segmentationReviewPath'),req,files)
        if no_op and value!=current_projection.get('captions'):raise ValueError('unchanged captions differ from current track')
        document['captions']=value
        source=[]
        if request.get('sourceSrtPath'):
            try:from .transcribe import load_cues
            except ImportError:from transcribe import load_cues
            source=load_cues(Path(request['sourceSrtPath']))
        reviews=proposal.get('qualityReviews')
        reviews_path=proposal.get('qualityReviewsPath') or str(Path(req['outputRoot'])/'caption-quality-reviews.json')
        if reviews is None and (proposal.get('qualityReviewsPath') or str(Path(reviews_path).resolve()) in files):
            reviews=json.loads(_bounded_file(reviews_path,req,files).read_text())
        audit_result=audit(document,source,reviews or [],require_segmentation_review=True,segmentation_review=json.loads(path.read_text()))
        if not audit_result['passed']:raise ValueError('caption native quality/segmentation gate failed')
        payloads=[{'value':value,'segmentationReviewPath':str(path),'segmentationReviewSha256':file_hash(path)}]
        read_paths+=[['captions']];write_paths=[['captions']]
    elif branch=='camera':
        value=proposal.get('cameraPlan');_camera(value,document,request)
        payloads=[{'value':value}];read_paths+=[['source','cameraPlan'],['instances']];write_paths=[['source','cameraPlan']]
    elif branch=='cover':
        try:from .cover import validate
        except ImportError:from cover import validate
        path=_bounded_file(proposal.get('coverCandidateManifestPath'),req,files)
        try:from .cover import validate_person_contract
        except ImportError:from cover import validate_person_contract
        validate_person_contract(json.loads(path.read_text()), request.get('coverContract', {}), request.get('coverReferences', []))
        verified=validate(str(path),write_report=False)
        if not verified.get('candidate_ready',False):raise ValueError('cover native manifest validation failed')
        payloads=[{'value':{'schemaVersion':1,'branch':'cover','projectId':req['projectId'],'runId':req['runId'],'status':'executed','coverCandidateManifestPath':str(path),'files':result['files'],'rationale':proposal['reason']}}]
        read_paths=[['canvas'],['source'],['cover']];write_paths=[['productionPlan','upstream','packageCovers']]
    elif branch=='footage':
        try:from .footage_package import validate_review
        except ImportError:from footage_package import validate_review
        path=_bounded_file(proposal.get('footageAnalysisPath'),req,files)
        review=json.loads(path.read_text())
        validate_review(review,request,document)
        if no_op and (review.get('candidates') or review.get('placements')):raise ValueError('leave_blank footage cannot discard usable candidates or placements')
        # Native finalize/publish is a host/main operation; no model writes project.
        if not no_op:
            try:from .footage_package import finalize
            except ImportError:from footage_package import finalize
            stage=Path(req['outputRoot'])/'native-footage'/canonical_hash({'analysisSha256':file_hash(path),'currentProjection':document})
            stage.mkdir(parents=True,exist_ok=True)
            snapshot=stage/'project-snapshot.json'
            analysis_path=stage/'analysis.json'
            manifest_path=stage/'result-manifest.json'
            if manifest_path.exists():
                manifest=json.loads(manifest_path.read_text())
                if any(manifest.get(k)!=expected for k,expected in [('projectId',req['projectId']),('jobId',request['jobId'])]):raise ValueError('staged footage identity changed')
                for record in manifest['files']:
                    artifact=Path(record['path']).resolve()
                    if not artifact.is_relative_to(stage.resolve()) or file_hash(artifact)!=record['sha256']:raise ValueError('staged footage files changed')
                if json.loads(snapshot.read_text())!={'document':document} or json.loads(analysis_path.read_text())!=review:raise ValueError('staged footage inputs changed')
                staged_review=Path(manifest['outputs']['footageReviewPath'])
                if str(staged_review) not in {r['path'] for r in manifest['files']}:raise ValueError('staged footage review unbound')
                validate_review(json.loads(staged_review.read_text()),request,document)
            else:
                snapshot.write_text(json.dumps({'document':document},ensure_ascii=False))
                analysis_path.write_text(json.dumps(review,ensure_ascii=False))
                native_request={**request,'outputRoot':str(stage),'projectSnapshotPath':str(snapshot),
                    'resultManifestPath':str(manifest_path),'jobId':request['jobId'],'projectId':req['projectId']}
                manifest=finalize(native_request,str(analysis_path))
            if manifest['state'] not in {'complete','partial'}:raise ValueError('native footage incomplete: '+str(manifest.get('issues',[])))
            # Missing alternatives must not discard independently verified media.
            # Preserve native shortage issues for the full-package completion gate.
            issues.extend(manifest.get('issues',[]))
            operation_files += manifest['files']+[{'path':str(p),'sha256':file_hash(p)} for p in (snapshot,analysis_path,manifest_path)]
            payloads=[{'nativeResult':row} for row in manifest['results']]
        read_paths+=[['productionPlan']];write_paths=[['productionPlan'],['instances'],['tracks'],['media']]
    else:
        path=_bounded_file(proposal.get('soundManifestPath'),req,files)
        value=json.loads(path.read_text())
        if value.get('version')!=1 or value.get('projectId')!=req['projectId'] or not isinstance(value.get('cues'),list):raise ValueError('invalid native sound manifest')
        payloads=[{'value':value}];read_paths+=[['audioClips'],['instances'],['source','cameraPlan']];write_paths=[['audioClips'],['audioTracks']]
    if no_op:
        payloads=[];write_paths=[]
    readset=[{'path':p,'beforeHash':canonical_hash(pointer_value(current_projection,p))} for p in read_paths]
    writeset=[{'path':p,'beforeHash':canonical_hash(pointer_value(current_projection,p))} for p in write_paths]
    operations=[]
    for payload in payloads:
        if 'nativeResult' in payload:
            native=payload['nativeResult']
            native.update(id='package-'+canonical_hash({'runId':req['runId'],'branchId':branch,'payload':native})[:40],
                jobId=request['jobId'],projectId=req['projectId'])
        op={'schemaVersion':1,'packageOrchestrationVersion':2,**{k:req[k] for k in ('projectId','runId','branchId','attemptId')},'kind':BRANCH_KINDS[branch],'dependencyFingerprint':req.get('dependencyFingerprint',req['inputFingerprint']),'readSet':readset,'writeSet':writeset,'payload':payload,'payloadSha256':canonical_hash(payload),'dependsOn':[],'files':operation_files}
        op['operationId']=canonical_hash({k:op[k] for k in ('schemaVersion','packageOrchestrationVersion','projectId','runId','branchId','attemptId','kind','dependencyFingerprint','payloadSha256','readSet','writeSet','dependsOn')})
        operations.append(op)
    return {'schemaVersion':1,'validatorVersion':VALIDATOR_VERSION,'status':'passed','applied':False,**{k:req[k] for k in ('projectId','runId','branchId','attemptId')},'dependencyFingerprint':req.get('dependencyFingerprint',req['inputFingerprint']),'proposalPath':result['manifestPath'],'proposalSha256':file_hash(result['manifestPath']),'resultSha256':hashlib.sha256(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest(),'files':operation_files,'readSet':readset,'writeSet':writeset,'operations':operations,'issues':issues,'reason':proposal['reason'],'decision':decision or 'execute'}
