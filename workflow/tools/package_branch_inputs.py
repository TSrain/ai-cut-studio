"""Trusted v2 projections. Missing required inputs raise ValueError (caller marks blocked).

Request accepts script/finalScriptPath; projectSnapshot (or projectSnapshotPath)
contains source, cues, canvas and protected native fields. Explicit root fields
win over snapshot fields. Optional branchInputs[branch] supplies only known
matrix fields. rulesVersions binds prompt/validator/business contracts; rulesFiles
maps branch IDs (or common) to concrete read-only contract paths.
"""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path

CONTEXT_POLICY_VERSION = 1
ROOT = Path(__file__).resolve().parents[1]
RULE_FILES = {
 'bgm': ('docs/bgm-plan-contract.md','docs/bgm-auto-execution.md','tools/bgm_package.py','tools/bgm_execution.py','tools/bgm_acquire.py'),
 'templates': ('docs/visual-design-contract.md','docs/template-expression-review.md'),
 'footage': ('docs/real-footage-contract.md',),
 'aiVideo': ('tools/ai_video_package.py',),
 'camera': ('docs/complete-package-contract.md',),
 'captions': ('docs/caption-quality-contract.md','tools/caption_quality.py','tools/roughcut_audio.py'),
 'cover': ('.devin/skills/content-cover/SKILL.md','tools/cover.py'),
}
MATRIX = {
 'bgm': ('cues','source','bgmPlan','protection','bgmExecutionVersion','canvas'),
 'templates': ('cues','source','canvas','subtitleSafeArea','captions','presenterObservation','sourceFrames','templateCatalog','protection'),
 'footage': ('cues','source','canvas','mediaIndex','evidenceBoundaries','protection'),
 'aiVideo': ('canvas','timingEvidence','aiVideoReferences','protection'),
 'camera': ('cues','source','canvas','sourceFrames','presenterObservation','cameraPlan','protection'),
 'captions': ('cues','alignmentEvidence','source','canvas','captions','captionStyle','protection'),
 'cover': ('titleIntent','coverContract','coverReferences','selectedCover','coverCandidates','protection'),
}

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def digest_file(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def _sha(value): return hashlib.sha256(canonical(value)).hexdigest()

def _file_dependencies(value, pointer, records, roots=()):
    if isinstance(value,dict):
        local_roots=tuple(Path(value[k]) for k in ('catalogRoot',) if value.get(k))+tuple(roots)
        for key,item in value.items():
            child=pointer+'/'+str(key).replace('~','~0').replace('/','~1')
            if isinstance(item,str) and (key in ('path','file') or key.endswith('Path')):
                p=Path(item)
                if not p.is_absolute():
                    candidates=[base/p for base in local_roots]
                    matches={candidate.resolve() for candidate in candidates if candidate.is_file()}
                    if len(matches)>1: raise ValueError('ambiguous dependency file: '+item)
                    if matches:p=matches.pop()
                if not p.is_file(): raise ValueError('missing dependency file: '+item)
                actual=digest_file(p)
                if key=='path' and value.get('sha256') and value['sha256'] != actual: raise ValueError('declared file SHA changed: '+item)
                records.append({'kind':'file','pointer':child,'path':str(p.resolve()),'sha256':actual})
                value[key]=str(p.resolve())
            else: _file_dependencies(item,child,records,local_roots)
    elif isinstance(value,list):
        for i,item in enumerate(value): _file_dependencies(item,pointer+'/'+str(i),records,roots)

def _content_value(value):
    # File locations are locators, not content identity. File SHA records bind them.
    if isinstance(value,dict):
        return {k: ('<file>' if isinstance(v,str) and (k in ('path','file') or k.endswith('Path')) else _content_value(v)) for k,v in value.items()}
    if isinstance(value,list): return [_content_value(v) for v in value]
    return value

def build_branch_input(request, semantic, branch_id):
    if branch_id not in MATRIX: raise ValueError('unknown branch: '+branch_id)
    if not request.get('projectId'): raise ValueError('projectId required')
    snapshot=copy.deepcopy(request.get('projectSnapshot',request.get('document',{})))
    if request.get('projectSnapshotPath'):
        snapshot=json.loads(Path(request['projectSnapshotPath']).read_text())
    envelope=snapshot
    snapshot=snapshot.get('document',snapshot)
    combined={**snapshot,**request}
    if 'cues' not in combined and isinstance(snapshot.get('captions'),dict) and 'cues' in snapshot['captions']:
        combined['cues']=snapshot['captions']['cues']
    if 'mediaIndex' not in combined and envelope.get('catalog') is not None: combined['mediaIndex']=envelope['catalog']
    if 'selectedCover' not in combined and snapshot.get('cover') is not None: combined['selectedCover']=snapshot['cover']
    if branch_id == 'templates' and request.get('templateCatalogPath'):
        combined['templateCatalog']=json.loads(Path(request['templateCatalogPath']).read_text(encoding='utf-8'))
    if 'protection' not in combined:
        protection={}
        for key in ('source','captions','cover'):
            value=snapshot.get(key)
            if isinstance(value,dict):
                flags={k:v for k,v in value.items() if k in ('locked','disabled','manual','selectedCandidateId','selectedId')}
                if flags: protection[key]=flags
        for key in ('tracks','audioTracks','instances'):
            rows=snapshot.get(key,[])
            protected=[{k:v for k,v in row.items() if k in ('id','trackId','locked','disabled','hidden','manual','ignored')} for row in rows if isinstance(row,dict) and any(row.get(flag) for flag in ('locked','disabled','hidden','manual','ignored'))]
            if protected: protection[key]=protected
        for container in (snapshot,snapshot.get('productionPlan',{})):
            for key,value in container.items():
                if any(word in key.lower() for word in ('tombstone','deleted','ignored','removed')): protection[key]=copy.deepcopy(value)
        combined['protection']=protection
    if 'bgmPlan' not in combined:
        plan=snapshot.get('productionPlan',{})
        combined['bgmPlan']={k:copy.deepcopy(plan[k]) for k in ('bgmPlanVersion','bgmRecommendations','bgmRecommendationGaps') if k in plan}
        combined['bgmPlan']['shots']=[{k:copy.deepcopy(s[k]) for k in ('id','requirementVersion','bgmDesign','timing','locked','manual') if k in s} for s in plan.get('shots',[])]
        for source_shot, bgm_shot in zip(plan.get('shots',[]),combined['bgmPlan']['shots']):
            previous=source_shot.get('upstream',{}).get('packageShot',{}).get('bgmDesign')
            if previous is not None: bgm_shot['upstream']={'packageShot':{'bgmDesign':copy.deepcopy(previous)}}
    combined.update(request.get('branchInputs',{}).get(branch_id,{}))
    if request.get('transcriptTimeBase') == 'project':
        try:
            from .transcribe import load_cues
        except ImportError:
            from transcribe import load_cues
        if not request.get('sourceSrtPath'):
            raise ValueError('project transcript requires derived sourceSrtPath')
        # This is the canonical narration, while snapshot captions remain
        # available separately as saved style/protection/edit evidence.
        combined['cues']=[dict(cue,id=i) for i,cue in enumerate(load_cues(Path(request['sourceSrtPath'])),1)]

    script=request.get('script',semantic.get('script'))
    if request.get('finalScriptPath'): script=Path(request['finalScriptPath']).read_text(encoding='utf-8')
    if not isinstance(script,str) or not script.strip(): raise ValueError('complete script required')
    if not isinstance(semantic.get('sections'),list) or not semantic['sections']: raise ValueError('full semantic sections required')
    source=copy.deepcopy(combined.get('source') or {})
    # Materialize the native single-source default before the projection drops
    # startFrame/durationFrames. This is the same mapping as map_source_interval,
    # not an identity assumption based on matching media lengths. An explicit
    # empty clips list represents no source ranges and must remain empty.
    if source.get('path') and source.get('clips') is None:
        duration=source.get('durationFrames',combined.get('canvas',{}).get('durationFrames'))
        if type(duration) is int and duration > 0:
            source['clips']=[{'id':'source','startFrame':0,'durationFrames':duration,
                              'sourceInFrame':source.get('startFrame',0)}]
    if (branch_id in ('templates','footage','camera') or (branch_id=='bgm' and request.get('bgmExecutionVersion')==1)) and request.get('videoPath'): source['videoPath']=request['videoPath']
    combined['source']=source
    if 'cameraPlan' not in combined and 'cameraPlan' in source: combined['cameraPlan']=source['cameraPlan']
    if 'cues' not in combined and request.get('sourceSrtPath'):
        combined['cues']={'rawSrt':Path(request['sourceSrtPath']).read_text(encoding='utf-8')}
    required=('canvas',) if branch_id=='aiVideo' else (() if branch_id in ('cover','bgm') else ('cues','source','canvas'))
    for key in required:
        if key not in combined or combined[key] is None: raise ValueError('missing required '+branch_id+' input: '+key)
    if branch_id == 'cover' and combined.get('coverContract', {}).get('requirePerson') and not combined.get('coverReferences'):
        raise ValueError('missing required cover portrait references: 本人肖像未绑定，禁止改为无人物封面')
    projection={k:copy.deepcopy(combined[k]) for k in MATRIX[branch_id] if k in combined}
    # Restrict source to consumed identity and mapping; no unrelated audio/history.
    if 'source' in projection:
        projection['source']={k:v for k,v in projection['source'].items() if k in ('path','clips','videoPath','videoIdentity','videoSha256','audioIdentity','audioSha256','fps','rotation','pixelAspectRatio','width','height')}
    if branch_id == 'bgm' and 'source' in projection and request.get('bgmExecutionVersion') != 1:
        projection['source']={k:v for k,v in projection['source'].items() if k in ('clips','fps')}
    protection=projection.get('protection')
    if 'protection' in request and isinstance(protection,dict) and protection and all(k in MATRIX for k in protection): projection['protection']=copy.deepcopy(protection.get(branch_id,{}))
    semantic_keys=('id','title','narration','animationNeed','goal','information','relations','boundaries','reason','sourceCueIds','requirementVersion','factBoundary','evidenceBoundary','evidenceRestrictions')
    semantic_sections=[{k:copy.deepcopy(row[k]) for k in semantic_keys if k in row} for row in semantic['sections']]
    if branch_id=='bgm':
        for original,projected in zip(semantic['sections'],semantic_sections):
            if 'bgmDesign' in original:projected['bgmDesign']=copy.deepcopy(original['bgmDesign'])
    common={'projectId':request['projectId'],'script':script,'sections':semantic_sections,'userDirection':copy.deepcopy(request.get('userDirection',request.get('preferences',{}).get('userDirection',request.get('instructions',[]))))}
    if request.get('transcriptTimeBase') == 'project':
        common['transcriptTimeBase']='project'
        common['transcriptOrigin']='saved-document-captions; cues are project seconds, do not remap through source clips'
    versions={'contextPolicy':CONTEXT_POLICY_VERSION,'builder':1,**copy.deepcopy(request.get('rulesVersions',{}))}
    bundle={'version':2,'branchId':branch_id,'contextPolicyVersion':CONTEXT_POLICY_VERSION,'common':common,'input':projection,'rulesVersions':versions,'runId':request.get('runId')}
    deps=[]
    visual_root=Path(request.get('visualizationRoot') or Path(__file__).resolve().parents[2] / 'studio').resolve()
    roots=(visual_root,visual_root/'templates/remotion-base/public')
    for key,value in (('common',common),('input',projection),('rulesVersions',versions)):
        _file_dependencies(value,'/'+key,deps,roots)
        deps.append({'kind':'json','pointer':'/'+key,'sha256':_sha(_content_value(value))})
    if branch_id != 'cover':
        source_keys=['sourceSrtPath']
        if request.get('transcriptTimeBase') == 'project': source_keys.append('transcriptProvenancePath')
        if branch_id=='templates': source_keys.append('templateCatalogPath')
        if branch_id in ('templates','footage','camera') or (branch_id=='bgm' and request.get('bgmExecutionVersion')==1): source_keys.append('videoPath')
        if branch_id == 'captions': source_keys.append('audioPath')
        for key in source_keys:
            if request.get(key): deps.append({'kind':'file','pointer':'/sourceIdentity/'+key,'path':str(Path(request[key]).resolve()),'sha256':digest_file(request[key])})
    rules=request.get('rulesFiles',{})
    paths=[str(ROOT/path) for path in RULE_FILES[branch_id]]
    paths += (rules.get('common',[])+rules.get(branch_id,[])) if isinstance(rules,dict) else rules
    for i,path in enumerate(paths):
        deps.append({'kind':'file','pointer':'/rulesFiles/'+str(i),'path':str(Path(path).resolve()),'sha256':digest_file(path)})
    bundle['dependencies']=deps
    bundle['dependencyFingerprint']=dependency_fingerprint(bundle)
    return bundle

def dependency_fingerprint(bundle):
    deps=[{k:v for k,v in d.items() if k!='path'} for d in bundle['dependencies']]
    return _sha({'version':bundle['version'],'contextPolicyVersion':bundle['contextPolicyVersion'],'branchId':bundle['branchId'],'dependencies':deps})

def validate_dependency_set(bundle,current):
    changes=[]
    before={(d['kind'],d['pointer']):d for d in bundle.get('dependencies',[])}
    after={(d['kind'],d['pointer']):d for d in current.get('dependencies',[])}
    for key in sorted(before.keys()|after.keys()):
        old,new=before.get(key),after.get(key)
        if old is None or new is None or old.get('sha256')!=new.get('sha256'):
            changes.append({'pointer':key[1],'reason':'dependency_changed'}); continue
        if old['kind']=='file':
            try: valid=digest_file(new['path'])==old['sha256']
            except (OSError,KeyError): valid=False
            if not valid: changes.append({'pointer':key[1],'reason':'file_missing_or_changed'})
    return changes
