"""Publish the manual animation handoff before scheduling any model branches."""
import fcntl
import hashlib
import json
from pathlib import Path
try:
    from .package_branches import orchestration_version
    from .animation_package import render_claude_prompt, VISUAL_FIELDS, load_cues, normalize
except ImportError:
    from package_branches import orchestration_version
    from animation_package import render_claude_prompt, VISUAL_FIELDS, load_cues, normalize


def _sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def publish_early_handoff(request, semantic_path):
    orchestration_version(request)
    package=Path(request.get('packageRoot') or Path(request['outputRoot'])/'package').resolve()
    output=Path(request['outputRoot']).resolve()
    if not package.is_relative_to(output):raise ValueError('packageRoot must be inside outputRoot')
    package.mkdir(parents=True,exist_ok=True)
    receipt=package/'early-handoff.json';plan=package/'plan.md'
    with (package/'early-handoff.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        old=json.loads(receipt.read_text()) if receipt.exists() else {}
        value={'version':1,'projectId':request['projectId'],'runId':request.get('runId'),'status':'blocked','planPath':str(plan),'semanticPath':str(Path(semantic_path).resolve()),'missingPaths':[],'issues':[]}
        for field in ('planSha256','planStatus','currentPlanSha256','inputHashes'):
            if field in old:value[field]=old[field]
        if request.get('scope',{}).get('animation') is False:
            value['status']='skipped';value['reason']='animation scope disabled'
        else:
            paths=[semantic_path,request.get('finalScriptPath'),request.get('sourceSrtPath'),request.get('videoPath')]
            for path in paths:
                if not path or not Path(path).is_absolute() or not Path(path).is_file():value['missingPaths'].append(str(path) if path else '(unspecified input path)')
            if not value['missingPaths']:
                data=json.loads(Path(semantic_path).read_text());sections=data.get('sections')
                if data.get('projectId',request['projectId'])!=request['projectId']:value['issues'].append('semantic project identity mismatch')
                if not isinstance(sections,list) or not sections:value['issues'].append('full semantic sections required')
                else:
                    ids=set()
                    for row in sections:
                        if not isinstance(row,dict):value['issues'].append('invalid section');continue
                        if not row.get('id') or row['id'] in ids:value['issues'].append('unique section ID required')
                        ids.add(row.get('id'))
                        if not isinstance(row.get('requirementVersion'),int) or row['requirementVersion']<1:value['issues'].append('frozen requirementVersion required')
                        if VISUAL_FIELDS.intersection(row):value['issues'].append('visual prescriptions forbidden')
                        if row.get('animationNeed') not in {'none','optional','required'}:value['issues'].append('animationNeed required')
                        for field in ('title','narration','goal','reason'):
                            if not isinstance(row.get(field),str) or not row[field].strip():value['issues'].append(field+' required')
                        for field in ('information','relations','boundaries'):
                            if not isinstance(row.get(field),list) or any(not isinstance(x,str) for x in row[field]):value['issues'].append(field+' text list required')
                for field,key in [('sourceSrtPath','sourceSrtPath'),('sourceVideoPath','videoPath')]:
                    if data.get(field)!=request.get(key):value['issues'].append(field+' input binding mismatch')
                cues=load_cues(Path(request['sourceSrtPath']))
                if not cues:value['issues'].append('source SRT contains no valid cues')
                covered=[]
                for row in sections or []:
                    if not isinstance(row,dict):continue
                    cue_ids=row.get('sourceCueIds',[])
                    if not isinstance(cue_ids,list) or not cue_ids or any(type(i) is not int or not 1<=i<=len(cues) for i in cue_ids):
                        value['issues'].append('section cue coverage invalid');continue
                    covered.extend(cue_ids)
                    if normalize(row.get('narration',''))!=normalize(''.join(cues[i-1]['text'] for i in cue_ids)):value['issues'].append('narration differs from source SRT')
                if covered!=list(range(1,len(cues)+1)):value['issues'].append('complete ordered SRT coverage required')
                for source in request.get('sources',[]):
                    path=source.get('path')
                    if not path or not Path(path).is_file():value['missingPaths'].append(str(path))
                    elif source.get('sha256')!=_sha(path):value['issues'].append('bound source SHA changed: '+path)
                    else:paths.append(path)
                hashes={str(Path(p).resolve()):_sha(p) for p in paths};value['inputHashes']=hashes
                if old:
                    if old.get('inputHashes') and old['inputHashes']!=hashes:
                        value['issues'].append('frozen handoff inputs changed');value['inputHashes']=old['inputHashes']
                if not request.get('canvas',{}).get('width') or not request.get('canvas',{}).get('height'):value['issues'].append('canvas required')
                if not value['issues'] and not value['missingPaths']:
                    if not any(row['animationNeed']!='none' for row in sections):value['status']='skipped';value['reason']='no animation requirements'
                    else:
                        text='# '+data.get('title','本期口播')+' package 总结\n\n动画需求已就绪，可手动交给 Claude。其他制作专项尚在准备；本记录不表示完整制作完成。\n\n'+render_claude_prompt(data,request)
                        # Existing final reports must never be downgraded by restart.
                        early_sha=old.get('planSha256') or hashlib.sha256(text.encode()).hexdigest()
                        if not plan.exists() or (_sha(plan)==early_sha and old.get('planStatus')!='preserved_existing'):
                            tmp=package/'plan.md.tmp';tmp.write_text(text);tmp.replace(plan)
                            value['planStatus']='early'
                        else:
                            value['planStatus']='preserved_existing'
                        value['status']='ready';value['planSha256']=early_sha
                        value['currentPlanSha256']=_sha(plan)
        tmp=package/'early-handoff.json.tmp';tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');tmp.replace(receipt)
        value['receiptPath']=str(receipt);value['receiptSha256']=_sha(receipt)
        return value


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',required=True);parser.add_argument('--semantic',required=True)
    args=parser.parse_args();request=json.loads(Path(args.request).read_text())
    print(json.dumps(publish_early_handoff(request,args.semantic),ensure_ascii=False))
