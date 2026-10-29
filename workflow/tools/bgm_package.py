"""BGM editorial proposals and versioned native audio preparation.

A URL/attribution record is not a listening or licensing receipt. Workers must
report those evidence limits explicitly. Timing stays owned by the current shot.
"""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('BGM '+label+' required')


def _url(value, label):
    _text(value, label)
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme in ('https', 'http') and parsed.hostname and not parsed.username and not parsed.password
        if any(c.isspace() for c in value): valid = False
        parsed.port
    except ValueError:
        valid = False
    if not valid: raise ValueError('BGM '+label+' requires an http(s) source URL')


def validate_proposal(proposal, semantic):
    if not isinstance(proposal, dict) or proposal.get('schemaVersion') != 1 or proposal.get('branchId') != 'bgm' or proposal.get('items') != []:
        raise ValueError('BGM proposal schema requires plan-only items=[]')
    _text(proposal.get('reason'), 'review reason')
    frozen = semantic.get('sections', [])
    if not isinstance(frozen, list) or not frozen or any(not isinstance(s, dict) or not s.get('id') for s in frozen):
        raise ValueError('BGM needs complete frozen sections')
    versions = {s['id']: s.get('requirementVersion') for s in frozen}
    if len(versions) != len(frozen) or any(type(v) is not int or v < 1 for v in versions.values()):
        raise ValueError('BGM frozen requirementVersion missing or duplicate sections')
    rows = proposal.get('sections')
    if not isinstance(rows, list) or len(rows) != len(versions) or any(not isinstance(r, dict) for r in rows) or {r.get('id') for r in rows} != set(versions):
        raise ValueError('BGM proposal must cover all frozen sections exactly once')
    recs = proposal.get('recommendations')
    if not isinstance(recs, list): raise ValueError('BGM recommendations list required')
    ids = set()
    for rec in recs:
        if not isinstance(rec, dict): raise ValueError('BGM recommendation must be an object')
        for key in ('id', 'title', 'artist', 'reason'): _text(rec.get(key), key)
        if rec['id'] in ids: raise ValueError('BGM duplicate recommendation ID')
        ids.add(rec['id'])
        _url(rec.get('url'), 'recommendation URL')
        if rec.get('licenseStatus') not in {'unknown', 'verify_before_use', 'verified'}: raise ValueError('BGM license status required')
        if rec.get('licenseUrl') is not None: _url(rec['licenseUrl'], 'license URL')
        if rec['licenseStatus'] == 'verified' and not rec.get('licenseUrl'): raise ValueError('BGM verified license requires source URL')
        if rec.get('audition') not in {'not_listened', 'listened'}: raise ValueError('BGM audition status required')
    gaps = proposal.get('recommendationGaps', [])
    if not isinstance(gaps, list) or any(not isinstance(g, str) or not g.strip() for g in gaps): raise ValueError('BGM recommendationGaps must be explicit text')
    for row in rows:
        if type(row.get('requirementVersion')) is not int or row['requirementVersion'] != versions[row['id']]:
            raise ValueError('BGM stale requirementVersion: '+row['id'])
        design = row.get('bgmDesign')
        if not isinstance(design, dict) or design.get('decision') not in {'music', 'silence'}: raise ValueError('BGM music/silence decision required')
        _text(design.get('reason'), 'section reason')
        if any(k in design or k in row for k in ('startSeconds', 'durationSeconds', 'startFrame', 'durationFrames', 'ranges', 'timing')):
            raise ValueError('BGM must use current shot timing, not invented timing')
        if 'requirementVersion' in design and design['requirementVersion'] != row['requirementVersion']:
            raise ValueError('BGM design requirementVersion stale')
        refs = design.get('recommendationIds', [])
        if not isinstance(refs, list) or any(not isinstance(r, str) or r not in ids for r in refs) or len(refs) != len(set(refs)):
            raise ValueError('BGM recommendationIds must reference current recommendations')
        if design['decision'] == 'music':
            if design.get('purpose') not in {'continuity', 'narrative', 'atmosphere'}: raise ValueError('BGM music purpose required')
            for key in ('musicType', 'texture'): _text(design.get(key), key)
            if 'transition' in design:
                _text(design['transition'], 'transition')
            else:  # Historical proposals retain their original evidence.
                for key in ('entry', 'exit'): _text(design.get(key), key)
            if not refs and not gaps: raise ValueError('BGM music requires a recommendation or explicit recommendationGaps')
        elif refs:
            raise ValueError('BGM silence cannot recommend a soundtrack for that section')
    return proposal


def semantic_for_request(req):
    if isinstance(req.get('semantic'), dict): return req['semantic']
    if req.get('branchInputPath'):
        return json.loads(Path(req['branchInputPath']).read_text(encoding='utf-8'))['common']
    raise ValueError('BGM frozen semantic input required')


def is_protected(shot):
    design = shot.get('bgmDesign')
    if not isinstance(design, dict): return False
    if any(shot.get(k) or design.get(k) for k in ('manual', 'locked')): return True
    previous = shot.get('upstream', {}).get('packageShot', {}).get('bgmDesign')
    # An unowned existing design is user content as well.
    return previous is None or design != previous


def apply_to_plan(plan, proposal, semantic):
    """Apply only to a detached plan. Host still merges with current user edits."""
    validate_proposal(proposal, semantic)
    shots = {s['id']: s for s in plan.get('shots', [])}
    for row in proposal['sections']:
        shot = shots.get(row['id'])
        if shot is None or shot.get('requirementVersion') != row['requirementVersion']:
            raise ValueError('BGM final plan requirementVersion differs from frozen semantic: '+row['id'])
    old_recs = {r['id']: r for r in plan.get('bgmRecommendations', [])}
    reviewed_ids = {r['id'] for r in proposal['sections']}
    protected_refs = {rid for sid, shot in shots.items() if sid not in reviewed_ids or is_protected(shot)
                      for rid in shot.get('bgmDesign', {}).get('recommendationIds', [])}
    recommendations = {}
    renamed = {}
    reserved = set(old_recs) | {r['id'] for r in proposal['recommendations']}
    for rec in proposal['recommendations']:
        rec = copy.deepcopy(rec)
        rid = rec['id']
        if rid in protected_refs and rid in old_recs and old_recs[rid] != rec:
            suffix = hashlib.sha256(json.dumps(rec, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
            new_id = rid+'-'+suffix
            while new_id in reserved: new_id += '-new'
            renamed[rid] = new_id; rec['id'] = new_id; reserved.add(new_id)
        recommendations[rec['id']] = rec
    for row in proposal['sections']:
        shot = shots[row['id']]
        if is_protected(shot): continue
        design = copy.deepcopy(row['bgmDesign'])
        design['requirementVersion'] = row['requirementVersion']
        design['recommendationIds'] = [renamed.get(rid, rid) for rid in design.get('recommendationIds', [])]
        shot['bgmDesign'] = design
        shot.setdefault('upstream', {}).setdefault('packageShot', {})['bgmDesign'] = copy.deepcopy(design)
    for rid in protected_refs:
        if rid in old_recs: recommendations[rid] = copy.deepcopy(old_recs[rid])
    plan.update(bgmPlanVersion=1, bgmRecommendations=list(recommendations.values()),
                bgmRecommendationGaps=copy.deepcopy(proposal.get('recommendationGaps', [])))
    plan.setdefault('upstream', {})['packageBgm'] = {
        'bgmPlanVersion': 1, 'bgmRecommendations': copy.deepcopy(plan['bgmRecommendations']),
        'bgmRecommendationGaps': copy.deepcopy(plan['bgmRecommendationGaps'])}
    return plan


def build_execution(proposal, semantic, document, output_root, files, visualization_root=None):
    try: from .bgm_execution import build_execution as build
    except ImportError: from bgm_execution import build_execution as build
    return build(proposal, semantic, document, output_root, files, visualization_root)


def execution_applied(document, run_id):
    """Require current saved audio, not merely successful proposal/queue markers."""
    plan=document.get('productionPlan',{})
    state=plan.get('bgmExecution',{})
    app=document.get('styleReference',{}).get('allowedOverrides',{}).get('bgmApplication',{})
    if any(v.get('version')!=1 or v.get('runId')!=run_id or v.get('status')!='applied' for v in (state,app)):
        return False
    baseline=app.get('baseline',{})
    if any(not isinstance(baseline.get(k),list) for k in ('clips','tracks')) or not isinstance(app.get('clips'),list):return False
    if state.get('clipIds')!=[c.get('id') for c in baseline['clips']] or len(app['clips'])!=len(baseline['clips']):return False
    for saved,current in (('clips','audioClips'),('tracks','audioTracks')):
        if any(c!=next((x for x in document.get(current,[]) if x.get('id')==c.get('id')),None) for c in baseline[saved]):return False
    shots={s['id']:s for s in plan.get('shots',[])};covered=set()
    for clip in app['clips']:
        if clip.get('clipId') not in state['clipIds'] or not clip.get('shotIds'):return False
        for sid in clip['shotIds']:
            shot=shots.get(sid,{})
            if shot.get('cancelled') or shot.get('requirementVersion')!=clip.get('requirementVersions',{}).get(sid) or shot.get('bgmDesign',{}).get('decision')!='music':return False
            if clip.get('shotTimings',{}).get(sid)!=shot.get('timing'):return False
            covered.add(sid)
    return all(s.get('cancelled') or s.get('bgmDesign',{}).get('decision')!='music' or s['id'] in covered for s in shots.values())
