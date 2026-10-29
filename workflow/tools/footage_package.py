#!/usr/bin/env python3
"""Validate an independent footage review and publish library/placement results.

Judgment and searching belong to content-footage. This deterministic transport
checks source, media and timing, and never edits an active Motion Studio project.
"""
from __future__ import annotations
import argparse
import copy
import json
import math
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

try:
    from . import editor_plan_runtime as runtime
    from .transcribe import load_cues
    from .broll_timeline import normalize
except ImportError:
    import editor_plan_runtime as runtime
    from transcribe import load_cues
    from broll_timeline import normalize

MODE='real-footage-v1'


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _http(value):
    return isinstance(value,str) and urlparse(value).scheme in {'http','https'} and bool(urlparse(value).netloc)


def cue_ranges(document, cues, ids, section_id, request=None):
    if ids!=list(range(ids[0],ids[-1]+1)):raise ValueError('推荐cue IDs必须连续')
    source=(document.get('source') or {}).get('path')
    if not source:return []
    selected=[cues[i-1] for i in ids]
    ranges=runtime.map_transcript_interval(document,source,selected[0]['start'],selected[-1]['end'],section_id,request)
    merged=[]
    for row in sorted(ranges,key=lambda r:r['startFrame']):
        if merged and merged[-1]['startFrame']+merged[-1]['durationFrames']==row['startFrame']:
            merged[-1]['durationFrames']+=row['durationFrames']
        else:merged.append(copy.deepcopy(row))
    return merged


def validate_review(data, request, document):
    semantic_version=data.get('semanticReviewVersion')
    if semantic_version is not None and (type(semantic_version)!=int or semantic_version!=1):
        raise ValueError('逐句语义验收版本无效')
    if request.get('semanticReviewVersion')==1 and semantic_version!=1:
        raise ValueError('当前素材任务要求逐句语义验收 semanticReviewVersion=1')
    if data.get('schemaVersion')!=1 or data.get('workflowMode')!=MODE or data.get('projectId')!=request['projectId']:
        raise ValueError('真实素材审稿版本/工程身份不一致')
    if data.get('sourceSrtPath')!=request.get('sourceSrtPath') or data.get('sourceVideoPath')!=request.get('videoPath'):
        raise ValueError('真实素材审稿来源与当前输入不一致')
    if not data.get('sourceSrtPath') or not Path(data['sourceSrtPath']).is_file():
        raise ValueError('独立素材审稿需要现有共享SRT，不重复转写')
    cues=load_cues(Path(data['sourceSrtPath']))
    required=[]
    for i,cue in enumerate(cues,1):
        if cue_ranges(document,cues,[i],'coverage',request):required.append(i)
    if not required:required=list(range(1,len(cues)+1))
    scoped=(request.get('projectTarget') or {}).get('shotId')
    scope_target=request.get('targetRange') if scoped else None
    target=scope_target
    if scoped:
        shot=next((s for s in document.get('productionPlan',{}).get('shots',[]) if s.get('id')==scoped),None)
        if not shot or not isinstance(target,dict) or type(target.get('startFrame'))!=int or type(target.get('durationFrames'))!=int or target['startFrame']<0 or target['durationFrames']<=0 or target['startFrame']+target['durationFrames']>document['canvas']['durationFrames']:
            raise ValueError('片段素材任务缺冻结真实目标范围')
        ranges=shot.get('timing',{}).get('ranges',[])
        range_id=(request.get('projectTarget') or {}).get('rangeId')
        if ranges and not any((not range_id or r.get('id')==range_id) and r['startFrame']<=target['startFrame'] and target['startFrame']+target['durationFrames']<=r['startFrame']+r['durationFrames'] for r in ranges):
            raise ValueError('片段素材目标超出所选shot真实范围')
        archived=shot.get('upstream',{}).get('packageShot',shot.get('details',{}).get('packageShot',{}))
        ids=shot.get('sourceCueIds') or archived.get('sourceCueIds') or shot.get('effectTiming',{}).get('evidence',{}).get('sourceCueIds')
        if not isinstance(ids,list) or not ids or any(type(i)!=int or i<1 for i in ids) or ids!=sorted(set(ids)):
            raise ValueError('片段素材任务缺冻结真实sourceCueIds')
        footprint=request.get('footagePackage') or {}
        if footprint.get('reviewPath') and footprint.get('reviewSha256'):
            review_path=Path(footprint['reviewPath'])
            if not review_path.is_file() or runtime.digest(review_path)!=footprint['reviewSha256']:
                raise ValueError('当前素材审稿冻结hash不一致')
            previous=read_json(review_path)
            if previous.get('sourceSrtPath')==request.get('sourceSrtPath'):
                row=next((r for r in previous.get('sections',[]) if r.get('id')==scoped),None)
                if row:ids=row.get('sourceCueIds',[])
        mapped=[i for i in range(1,len(cues)+1) if any(r['startFrame']<target['startFrame']+target['durationFrames'] and r['startFrame']+r['durationFrames']>target['startFrame'] for r in cue_ranges(document,cues,[i],'scope',request))]
        # Archived semantic cue ordinals may belong to a pre-polish transcript.
        # The frozen source/SRT and actual edited interval decide current identity.
        if set(ids)!=set(mapped):ids=mapped
        required=[i for i in ids if any(r['startFrame']<target['startFrame']+target['durationFrames'] and r['startFrame']+r['durationFrames']>target['startFrame'] for r in cue_ranges(document,cues,[i],'scope',request))]
        if not required:raise ValueError('片段语义cue与冻结范围不相交')
    sections=data.get('sections');covered=[];sections_by_id={}
    if not isinstance(sections,list) or not sections:raise ValueError('必须逐段审完整口播')
    if scoped and (len(sections)!=1 or sections[0].get('id')!=scoped):
        raise ValueError('单片段素材sections必须唯一且id等于所选shotId')
    for row in sections:
        sid=row.get('id');ids=row.get('sourceCueIds')
        if not isinstance(sid,str) or not sid or sid in sections_by_id:raise ValueError('素材审稿段落ID无效/重复')
        if not isinstance(ids,list) or not ids or any(type(i)!=int or i<1 or i>len(cues) for i in ids) or ids!=sorted(set(ids)):
            raise ValueError('素材审稿sourceCueIds无效')
        if normalize(row.get('narration',''))!=normalize(''.join(cues[i-1]['text'] for i in ids)):
            raise ValueError('素材审稿口播与真实SRT不一致')
        if row.get('footageNeed') not in {'required','optional','none'} or not row.get('reason') or not row.get('title'):
            raise ValueError('缺少逐段素材必要性和理由')
        targets=row.get('visualTargets',[])
        if row['footageNeed']!='none' and (not isinstance(targets,list) or not targets):raise ValueError('素材段缺少具体画面目标')
        for target in targets:
            if not target.get('description') or not target.get('action') or target.get('evidenceRole') not in {'proof','illustration'}:
                raise ValueError('画面目标需要具体动作及证据角色')
        if semantic_version==1:
            intent=row.get('semanticIntent',{})
            for key in ('affirmed','contrasted'):
                values=intent.get(key)
                if not isinstance(values,list) or any(not isinstance(v,str) or not v.strip() for v in values):
                    raise ValueError('语义需求须明确肯定对象和被否定/替代对象')
            relations=intent.get('relations')
            if not isinstance(relations,list) or any(not isinstance(r,dict) or not r.get('id') or not r.get('description') for r in relations):
                raise ValueError('语义关系须有稳定ID与可见关系描述')
            if len({r['id'] for r in relations})!=len(relations):raise ValueError('语义关系ID重复')
        covered.extend(ids);sections_by_id[sid]=row
    if covered!=required:raise ValueError('素材审稿必须按当前口播顺序完整覆盖，不漏段/重叠')
    for group in data.get('searchLog',[]):
        for lead in group.get('links',[]):
            if not isinstance(lead,dict) or not _http(lead.get('pageUrl')):
                raise ValueError('网站素材线索必须有HTTP(S)来源页')
            matched=lead.get('matchedSectionIds')
            if not isinstance(matched,list) or not matched or any(sid not in sections_by_id for sid in matched):
                raise ValueError('网站素材线索对应口播段落不明确')
            if not lead.get('matchReason') or not (lead.get('status') or lead.get('reuseStatus')):
                raise ValueError('网站素材线索缺配画面理由或下载状态')
            ids=lead.get('sourceCueIds')
            allowed={i for sid in matched for i in sections_by_id[sid]['sourceCueIds']}
            if ids is not None and (not isinstance(ids,list) or not ids or any(type(i)!=int or i not in allowed for i in ids)):
                raise ValueError('网站素材线索对应句子不在已关联口播中')
    candidates_by_id={}
    for candidate in data.get('candidates',[]):
        cid=candidate.get('id');path=Path(candidate.get('path',''))
        if not cid or cid in candidates_by_id or not path.is_absolute() or not path.is_file():raise ValueError('素材候选ID或实际文件无效')
        if candidate.get('sourceKind') not in {'stock','official-demo','user','public-reference'}:raise ValueError('sourceKind来源类型无效')
        if candidate.get('sha256')!=runtime.digest(path):raise ValueError('素材候选文件hash已改变')
        if min(candidate.get('width',0),candidate.get('height',0))<720:raise ValueError('实际素材短边低于720')
        if candidate.get('reuseStatus')!='downloadable' or not _http(candidate.get('pageUrl')) or not _http(candidate.get('licenseUrl')):
            raise ValueError('素材必须有可追溯出处及已核实复用状态')
        if not candidate.get('visibleContent') or not candidate.get('matchReason'):raise ValueError('候选缺实际画面观察/配图理由')
        matched=candidate.get('matchedSectionIds',[])
        if not matched or any(sid not in sections_by_id for sid in matched):raise ValueError('素材候选对应段落不明确')
        technical=candidate.get('technical',{})
        frames=candidate.get('review',{}).get('frames',[])
        if not technical.get('passed') or not technical.get('decoded') or not technical.get('probePath') or not candidate.get('review',{}).get('sampled') or not frames:
            raise ValueError('可用素材缺实际探测/解码/抽帧证据')
        for frame in frames:
            if not isinstance(frame,dict) or not Path(frame.get('path','')).is_file() or runtime.digest(frame['path'])!=frame.get('sha256'):
                raise ValueError('素材抽帧证据文件/hash无效')
        if not Path(technical['probePath']).is_file():raise ValueError('素材probe证据不存在')
        if semantic_version==1:
            matches=candidate.get('semanticMatches')
            if not isinstance(matches,list) or not matches:raise ValueError('候选缺逐句语义观察 semanticMatches')
            frame_paths={f['path']:f for f in frames}
            for match in matches:
                section=sections_by_id.get(match.get('sectionId'))
                ids=match.get('sourceCueIds')
                if not section or section['id'] not in matched or not isinstance(ids,list) or not ids or any(type(i)!=int or i not in section['sourceCueIds'] for i in ids):
                    raise ValueError('候选语义观察未绑定真实句子')
                if match.get('verdict') not in {'aligned','contradictory','uncertain'} or not match.get('observedAction'):
                    raise ValueError('候选语义观察缺实际动作或明确判断')
                a,b=match.get('sourceInSeconds'),match.get('sourceOutSeconds')
                if any(type(v) not in (int,float) or not math.isfinite(v) for v in (a,b)) or a<0 or b<a or b>candidate['durationSeconds']+.001:
                    raise ValueError('候选语义观察源窗口无效')
                inspected=match.get('framePaths')
                if not isinstance(inspected,list) or not inspected or any(p not in frame_paths for p in inspected):
                    raise ValueError('语义观察必须引用本候选已目检帧')
                if candidate.get('kind')!='image' and any(type(frame_paths[p].get('seconds')) not in (int,float) or not a<=frame_paths[p]['seconds']<=b for p in inspected):
                    raise ValueError('语义目检帧必须来自声明的源窗口')
                evidence=match.get('relationEvidence')
                relation_ids={r['id'] for r in section['semanticIntent']['relations']}
                if not isinstance(evidence,list) or any(not isinstance(r,dict) or r.get('relationId') not in relation_ids or type(r.get('visible'))!=bool or not r.get('observation') for r in evidence):
                    raise ValueError('候选缺可核查的语义关系观察')
                if len({r['relationId'] for r in evidence})!=len(evidence):raise ValueError('候选语义关系观察重复')
            if set(matched)!={m['sectionId'] for m in matches}:raise ValueError('候选未逐段记录语义适配判断')
        candidates_by_id[cid]=candidate
    used_ids=set();rate=runtime.fps(document)
    for placement in data.get('placements',[]):
        pid=placement.get('id');candidate=candidates_by_id.get(placement.get('candidateId'));section=sections_by_id.get(placement.get('sectionId'))
        if not pid or pid in used_ids or not candidate or not section or section['id'] not in candidate['matchedSectionIds']:
            raise ValueError('素材推荐区间ID/关联无效')
        used_ids.add(pid)
        if placement.get('layout') not in {'cover','contain'} or not placement.get('reason'):raise ValueError('素材呈现需明确cover/contain及理由')
        ids=placement.get('sourceCueIds',[])
        if not ids or ids!=sorted(set(ids)) or any(i not in section['sourceCueIds'] for i in ids):raise ValueError('推荐位置缺真实语义cue')
        ranges=cue_ranges(document,cues,ids,section['id'],request)
        if scoped:
            target=scope_target
            ranges=[{**r,'startFrame':max(r['startFrame'],target['startFrame']),
                     'durationFrames':min(r['startFrame']+r['durationFrames'],target['startFrame']+target['durationFrames'])-max(r['startFrame'],target['startFrame'])}
                    for r in ranges if r['startFrame']<target['startFrame']+target['durationFrames'] and r['startFrame']+r['durationFrames']>target['startFrame']]
        start=placement.get('startFrame');duration=placement.get('durationFrames')
        if type(start)!=int or type(duration)!=int or duration<1 or start<0 or start+duration>document['canvas']['durationFrames']:
            raise ValueError('推荐素材范围超出工程')
        if not any(start==r['startFrame'] and duration==r['durationFrames'] for r in ranges):
            raise ValueError('推荐素材位置不符合实际口播/剪辑映射')
        a=placement.get('sourceInSeconds');b=placement.get('sourceOutSeconds')
        if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in [a,b]) or a<0:
            raise ValueError('素材源窗口无效')
        if candidate.get('kind')=='image':
            if a!=0 or b!=0:raise ValueError('静图素材源窗口必须为0')
        elif b<=a or b>candidate['durationSeconds']+.001 or abs((b-a)-duration/rate)>1/rate+.001:
            raise ValueError('素材源时长不足；不得自动循环/定格/拉伸')
        if semantic_version==1:
            relations={r['id'] for r in section['semanticIntent']['relations']}
            approved=[m for m in candidate['semanticMatches'] if m['sectionId']==section['id'] and m['verdict']=='aligned'
                      and set(ids).issubset(m['sourceCueIds']) and m['sourceInSeconds']<=a and m['sourceOutSeconds']>=b
                      and relations.issubset({r['relationId'] for r in m['relationEvidence'] if r['visible']})]
            if not approved:raise ValueError('推荐源窗口缺一致语义及可见关系证据；矛盾/不确定素材不得入轨')
        if candidate.get('sourceKind')=='stock' and (placement.get('evidenceRole')=='proof' or all(t['evidenceRole']=='proof' for t in section['visualTargets'])):
            raise ValueError('图库不能充当私人案例或产品实证 proof')
    return data


def verify_media(candidate, evidence_dir):
    """Refresh technical observations using real files; supplied flags are not proof."""
    probe=runtime.probe_and_sample(candidate['path'],evidence_dir)
    subprocess.run([os.environ.get('EDITOR_PLAN_FFMPEG_BIN','ffmpeg'),'-nostdin','-v','error','-xerror','-i',candidate['path'],
                    '-map','0:v:0','-an','-f','null','-'],check=True,capture_output=True)
    if runtime.digest(candidate['path'])!=probe['sha256']:raise ValueError('素材在验证过程中发生变化')
    candidate.update(sha256=probe['sha256'],width=probe['width'],height=probe['height'],durationSeconds=probe['durationSeconds'],kind=probe['kind'])
    candidate['technical']={'passed':True,'decoded':True,'probePath':probe['probePath']}
    # Keep human-inspected frames distinct from newly decoded frames.
    candidate['technical']['decoderFrames']=probe['frames']


def _usable_options(data, section):
    options=[c for c in data.get('candidates',[]) if section['id'] in c['matchedSectionIds']]
    if data.get('semanticReviewVersion')!=1:return options
    relations={r['id'] for r in section['semanticIntent']['relations']}
    return [c for c in options if any(m['sectionId']==section['id'] and m['verdict']=='aligned'
            and relations.issubset({r['relationId'] for r in m['relationEvidence'] if r['visible']}) for m in c['semanticMatches'])]


def render_summary(data, request):
    lines=['# 真实素材审稿与候选','',f"工程：{request['projectId']}",
           '逐段审配画面理由，再搜索与获取；动画需求和真人保留不决定是否跳过素材。候选属于可选画面，不等于已最终采用。','']
    candidates=data.get('candidates',[]);placements=data.get('placements',[])
    leads=[lead for group in data.get('searchLog',[]) for lead in group.get('links',[])]
    cues=load_cues(Path(data['sourceSrtPath'])) if leads else []
    lines.append(f"实际可用原片：{len(candidates)} 个；推荐位置：{len(placements)} 处。素材源音频静音，口播原声保留。")
    if data.get('semanticReviewVersion')!=1:lines.append('历史兼容：未记录逐句语义验收，不代表画面与句意已核对。')
    for index,section in enumerate(data['sections'],1):
        options=[c for c in candidates if section['id'] in c['matchedSectionIds']]
        lines.extend(['',f"## {index:02d} {section['title']}",f"口播：{section['narration']}",f"素材必要性：{section['footageNeed']}；{section['reason']}"])
        lines.extend('- 画面目标：'+t['description']+'；可见动作：'+t['action'] for t in section.get('visualTargets',[]))
        if data.get('semanticReviewVersion')==1:
            intent=section['semanticIntent']
            lines.extend(['肯定对象：'+'；'.join(intent['affirmed']),'被否定/替代对象：'+'；'.join(intent['contrasted'])])
            lines.extend('必须可见的关系：'+r['description'] for r in intent['relations'])
        lines.append(f"可用候选：{len(options)} 个。")
        usable=_usable_options(data,section)
        if data.get('semanticReviewVersion')==1:lines.append(f"语义适配候选：{len(usable)} 个；未确认或矛盾候选不计适配数量。")
        if section['footageNeed']!='none' and len(usable)<3:lines.append('**候选不足：继续补充不同角度或真实证据，不用低清、重复或假证据凑数。**')
        for c in options:
            lines.extend([f"- **{c.get('title',c['id'])}**：{c['visibleContent']}",f"  配图理由：{c['matchReason']}",
                          f"  文件：[{c.get('title',c['id'])}]({c['path']})；来源：[原页面]({c['pageUrl']})；[许可]({c['licenseUrl']})。",
                          f"  实测：{c['width']}×{c['height']}，{c['durationSeconds']:.2f} 秒；已解码与抽帧检查。"])
            if data.get('semanticReviewVersion')==1:
                for match in c['semanticMatches']:
                    if match['sectionId']==section['id']:
                        lines.append(f"  逐句语义：{match['verdict']}；cue {match['sourceCueIds']}；源 {match['sourceInSeconds']}–{match['sourceOutSeconds']} 秒；{match['observedAction']}")
                        lines.extend(f"  关系可见：{r['visible']}；{r['observation']}" for r in match['relationEvidence'])
        pending=[lead for lead in leads if section['id'] in lead.get('matchedSectionIds',[])]
        if pending:
            lines.append('网站线索 / 未纳入可用池（不计已下载可用候选）：')
        labels={'searched_not_downloaded':'未下载，待筛选','download_failed':'下载失败',
                'license_pending':'授权待核实，未下载','license-pending-not-downloaded':'授权待核实，未下载',
                'downloaded_not_selected':'已下载，未纳入可用池'}
        for lead in pending:
            selected=[i for i in lead.get('sourceCueIds',section['sourceCueIds']) if i in section['sourceCueIds']]
            quote=' / '.join(cues[i-1]['text'] for i in selected)
            status=lead.get('status') or lead.get('reuseStatus')
            lines.extend([f"- [{lead.get('title',lead.get('id','网站线索'))}]({lead['pageUrl']})；状态：{labels.get(status,status)}。",
                          f"  对应口播：{quote}",f"  配画面理由 / 检索目标：{lead['matchReason']}"])
        for p in placements:
            if p['sectionId']==section['id']:
                lines.append(f"推荐入轨：{p['candidateId']}，工程 {p['startFrame']/runtime.fps({'canvas':request['canvas']}):.2f} 秒起，{p['durationFrames']/runtime.fps({'canvas':request['canvas']}):.2f} 秒；{p['layout']}。{p['reason']}")
        lines.extend('事实/证据边界：'+text for text in section.get('evidenceRestrictions',[]))
    lines.extend(['','## 搜索与未解决项'])
    for row in data.get('searchLog',[]):lines.append('- '+json.dumps(row,ensure_ascii=False))
    lines.extend(['','## 验收范围','文件探测、全帧解码和代表帧目检分别记录；连续观看、合成裁切和试听未通过时仍需明确。',
                  '婚礼本人作品、实际询价等私人证据缺失时保留缺口，通用图库只作概念示意；不自动填满整片。'])
    return '\n'.join(lines)+'\n'


def finalize(request, review_path):
    output=Path(request['outputRoot']).resolve();output.mkdir(parents=True,exist_ok=True)
    if (output/'footage-review.json').exists() and Path(request['resultManifestPath']).exists():
        raise ValueError('已交付真实素材审稿不可覆盖；复用既有manifest或创建新任务')
    raw=Path(review_path).resolve(strict=True)
    if not raw.is_relative_to(output):raise ValueError('审稿输入必须位于本任务outputRoot')
    for source in request.get('sources',[]):
        if runtime.digest(source['path'])!=source['sha256']:raise ValueError('素材任务输入来源SHA已改变')
    data=copy.deepcopy(read_json(raw));document=read_json(request['projectSnapshotPath'])['document']
    for row in data.get('sections',[]):runtime.safe_id(row.get('id'),'sectionId')
    for row in data.get('candidates',[]):runtime.safe_id(row.get('id'),'candidateId')
    for row in data.get('placements',[]):runtime.safe_id(row.get('id'),'placementId')
    # Media/evidence originals are copied once; immutable review binds staged data.
    media_dir=output/'footage-media';media_dir.mkdir(exist_ok=True)
    for candidate in data.get('candidates',[]):
        original=Path(candidate['path']).resolve(strict=True);sha=runtime.digest(original)
        if original.suffix.lower() not in {'.mp4','.mov','.m4v','.webm','.png','.jpg','.jpeg','.webp'}:
            raise ValueError('素材文件类型不支持')
        if candidate.get('sha256')!=sha:raise ValueError('原始素材hash与审稿不一致')
        destination=media_dir/(sha[:32]+original.suffix.lower())
        if not destination.exists():shutil.copyfile(original,destination)
        if runtime.digest(destination)!=sha:raise ValueError('素材归档hash不一致')
        candidate['originalPath']=str(original);candidate['path']=str(destination)
        frames=[];frame_relocations={}
        for frame in candidate.get('review',{}).get('frames',[]):
            source=Path(frame['path']).resolve(strict=True)
            if runtime.digest(source)!=frame['sha256']:raise ValueError('目检抽帧已改变')
            target=output/'footage-evidence'/(frame['sha256']+source.suffix)
            target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists():shutil.copyfile(source,target)
            frames.append({**frame,'path':str(target)})
            frame_relocations[frame['path']]=str(target)
        candidate['review']['frames']=frames
        for match in candidate.get('semanticMatches',[]):
            match['framePaths']=[frame_relocations.get(p,p) for p in match.get('framePaths',[])]
        verify_media(candidate,output/'footage-probes'/candidate['id'])
        # verify_media was mocked in structural tests; its probe still needs to be staged.
        probe=Path(candidate['technical']['probePath'])
        if not probe.resolve().is_relative_to(output):
            target=output/'footage-probes'/candidate['id']/'probe.json';target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(probe,target)
            candidate['technical']['probePath']=str(target)
    validate_review(data,request,document)
    review=output/'footage-review.json';runtime.atomic_json(review,data);sha=runtime.digest(review)
    summary=output/'真实素材审稿与候选.md';summary.write_text(render_summary(data,request),encoding='utf-8')
    candidate_manifest=output/'footage-candidates.json';runtime.atomic_json(candidate_manifest,data['candidates'])
    result=[]
    by_id={c['id']:c for c in data['candidates']}
    def media_result(c,p=None):
        payload={'kind':'footage','footage':{'reviewPath':str(review),'reviewSha256':sha,'candidateId':c['id'],'placementId':p['id'] if p else None},
                 'media':{'path':c['path']},'technical':{'passed':True,'details':{'sha256':c['sha256'],'probePath':c['technical']['probePath'],
                 'decoded':True,'width':c['width'],'height':c['height'],'durationSeconds':c['durationSeconds']}},
                 'reason':p['reason'] if p else c['matchReason']}
        if p:payload.update(target={k:p[k] for k in ['startFrame','durationFrames']});payload['media'].update(sourceInSeconds=p['sourceInSeconds'],sourceOutSeconds=p['sourceOutSeconds'])
        return payload
    result.extend(media_result(c) for c in data['candidates'])
    result.extend(media_result(by_id[p['candidateId']],p) for p in data['placements'])
    issues=[{'sectionId':s['id'],'reason':'候选不足，需继续搜集或补真实证据'} for s in data['sections'] if s['footageNeed']!='none' and len(_usable_options(data,s))<3]
    files=[]
    for path in [review,summary,candidate_manifest,*sorted(media_dir.glob('*')),*sorted((output/'footage-evidence').glob('*')),*sorted((output/'footage-probes').rglob('*.json'))]:
        files.append({'path':str(path),'sha256':runtime.digest(path),'role':'footage-review' if path==review else 'footage-output'})
    manifest={'version':1,'jobId':request['jobId'],'projectId':request['projectId'],'workflowMode':MODE,'phase':'footage',
              'state':'partial' if issues else 'complete','stage':'footage_ready','processed':len(data['sections']),'total':len(data['sections']),
              'results':result,'files':files,'issues':issues,'outputs':{'footageReviewPath':str(review),'footageSummaryPath':str(summary),'allCandidateManifestPath':str(candidate_manifest)}}
    runtime.atomic_json(request['resultManifestPath'],manifest)
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    command=sub.add_parser('finalize');command.add_argument('--request',required=True);command.add_argument('--review',required=True)
    args=parser.parse_args();result=finalize(read_json(args.request),args.review)
    print(json.dumps({'state':result['state'],'results':len(result['results']),'outputs':result['outputs']},ensure_ascii=False))


if __name__=='__main__':main()
