"""Native preparation of editable BGM operations. No active-project writes."""
from __future__ import annotations
import copy
import hashlib
import json
import math
from pathlib import Path
from urllib.parse import urlsplit


def _number(value, label, minimum=0, maximum=None):
    if type(value) not in (int,float) or not math.isfinite(value) or value < minimum or (maximum is not None and value > maximum):
        raise ValueError('BGM invalid '+label)
    return value


def build_execution(proposal, semantic, document, output_root, files, visualization_root=None):
    try:
        from .bgm_package import validate_proposal, _text, _url
        from .bgm_acquire import probe_audio, measure_audio_level
    except ImportError:
        from bgm_package import validate_proposal, _text, _url
        from bgm_acquire import probe_audio, measure_audio_level
    validate_proposal(proposal,semantic)
    execution=proposal.get('execution')
    if not isinstance(execution,dict) or execution.get('version')!=1:
        raise ValueError('BGM automatic execution version 1 required')
    for key in ('assets','edits','gaps','searchAudit'):
        if not isinstance(execution.get(key),list):raise ValueError('BGM execution '+key+' list required')
    for gap in execution['gaps']:_text(gap,'execution gap')
    rows={r['id']:r for r in proposal['sections']}
    musical={sid for sid,r in rows.items() if r['bgmDesign']['decision']=='music'}
    recs={r['id']:r for r in proposal['recommendations']}
    domains=set();categories=set();providers=set();regions=set()
    for audit in execution['searchAudit']:
        _url(audit.get('url'),'search source');_text(audit.get('category'),'search category');_text(audit.get('reason'),'search outcome')
        if not isinstance(audit.get('queries'),list) or not audit['queries']:raise ValueError('BGM search queries required')
        for query in audit['queries']:_text(query,'search query')
        if not isinstance(audit.get('candidateIds'),list) or any(rid not in recs for rid in audit['candidateIds']):raise ValueError('BGM search candidate IDs invalid')
        host=urlsplit(audit['url']).hostname.lower().removeprefix('www.')
        parts=host.split('.')
        # Group ordinary subdomains, including common multipart public suffixes.
        count=3 if '.'.join(parts[-2:]) in {'co.uk','org.uk','com.au','com.cn','net.cn','org.cn','co.jp','com.br','co.nz'} else 2
        domains.add('.'.join(parts[-count:]));categories.add(audit['category'])
        _text(audit.get('providerId'),'original provider identity')
        providers.add(audit['providerId'].strip().lower())
        if audit.get('region') not in ('domestic','overseas'):raise ValueError('BGM search region required')
        regions.add(audit['region'])
    if musical and (len(domains)<3 or len(providers)<3 or len(categories)<2 or len(regions)<2):raise ValueError('BGM broad search needs three independent providers, two categories, domestic and overseas attempts')
    root=Path(output_root).resolve();proofs={str(Path(f['path']).resolve()):f['sha256'] for f in files}
    assets={}
    for source in execution['assets']:
        rid=source.get('recommendationId');rec=recs.get(rid)
        if not rec or rid in assets:raise ValueError('BGM unknown/duplicate asset recommendation')
        if rec.get('licenseStatus')!='verified':raise ValueError('BGM applied asset license not verified')
        _url(rec.get('licenseUrl'),'license');_text(rec.get('licenseEvidence'),'license evidence')
        if type(rec.get('attributionRequired')) is not bool or not isinstance(rec.get('credit'),str):raise ValueError('BGM credit policy required')
        if rec['attributionRequired']:_text(rec['credit'],'credit')
        path=Path(source.get('path','')).resolve()
        if not path.is_file() or not path.is_relative_to(root) or proofs.get(str(path))!=source.get('sha256'):raise ValueError('BGM asset must be a bounded SHA-bound branch file')
        probe=probe_audio(path)
        if probe['sha256']!=source['sha256']:raise ValueError('BGM audio SHA changed')
        assets[rid]={'recommendationId':rid,'path':str(path),**probe,'credit':rec['credit'],'attributionRequired':rec['attributionRequired'],'licenseUrl':rec['licenseUrl'],'licenseEvidence':rec['licenseEvidence'],'sourceUrl':rec['url'],'title':rec['title'],'artist':rec['artist'],'audition':rec['audition']}
    attempts=execution.get('downloadAttempts',[])
    if not isinstance(attempts,list):raise ValueError('BGM downloadAttempts list required')
    failed=set()
    for a in attempts:
        if a.get('recommendationId') not in recs or a.get('status') not in ('failed','unavailable','downloaded'):raise ValueError('BGM download attempt invalid')
        _text(a.get('reason'),'download attempt reason')
        if a['status']!='downloaded':failed.add(a['recommendationId'])
    fps=document['canvas']['fps']['num']/document['canvas']['fps']['den'];total=document['canvas']['durationFrames']
    shots={s['id']:s for s in document.get('productionPlan',{}).get('shots',[])}
    clips=[];covered=set()
    for edit in execution['edits']:
        ids=edit.get('shotIds');rid=edit.get('assetId')
        if not isinstance(ids,list) or not ids or len(ids)!=len(set(ids)) or any(sid not in musical for sid in ids):raise ValueError('BGM edit must reference music sections only')
        if rid not in assets:raise ValueError('BGM edit asset missing')
        _text(edit.get('method'),'edit method')
        ranges=[]
        for sid in ids:
            shot=shots.get(sid)
            if not shot or shot.get('requirementVersion')!=rows[sid]['requirementVersion']:raise ValueError('BGM current semantic version changed')
            ranking=rows[sid]['bgmDesign'].get('recommendationIds',[])
            if rid not in ranking or any(r not in failed for r in ranking[:ranking.index(rid)]):raise ValueError('BGM lower rank needs explicit failed/unavailable attempts')
            timing=shot.get('timing',{})
            if timing.get('status') not in ('aligned','manual') or not timing.get('ranges'):raise ValueError('BGM aligned current timing required')
            ranges.extend(timing['ranges'])
        ranges=sorted(ranges,key=lambda r:r['startFrame'])
        start=ranges[0]['startFrame'];end=start+ranges[0]['durationFrames']
        for r in ranges[1:]:
            if r['startFrame']!=end:raise ValueError('BGM grouped ranges must be contiguous; cannot bridge silence')
            end+=r['durationFrames']
        start+=round(_number(edit.get('startOffsetSeconds',0),'start offset')*fps)
        end-=round(_number(edit.get('endOffsetSeconds',0),'end offset')*fps)
        duration=end-start
        if start<0 or end>total or duration<=0:raise ValueError('BGM edit outside project or music range')
        source_in=round(_number(edit.get('sourceInSeconds',0),'source in')*fps)
        if source_in+duration>math.floor(assets[rid]['sourceDurationSeconds']*fps):raise ValueError('BGM edit exceeds source duration; no invented looping')
        fades={}
        for side in ('In','Out'):
            n=round(_number(edit.get('fade'+side+'Seconds',0),'fade '+side)*fps)
            curve=edit.get('fade'+side+'Curve','smooth')
            if n>duration or curve not in ('linear','smooth','equalPower'):raise ValueError('BGM fade outside clip or invalid curve')
            fades['fade'+side+'Frames']=n;fades['fade'+side+'Curve']=curve
        volume=_number(edit.get('volume'),'volume',0.0001,0.5)
        music_level=measure_audio_level(assets[rid]['path'],source_in/fps,duration/fps)
        if music_level['constantSignal'] or music_level['peakVolumeDb'] < -70:raise ValueError('BGM selected excerpt is silent or inaudible')
        mix={'musicMeanDb':music_level['meanVolumeDb'],'musicPeakDb':music_level['peakVolumeDb'],'method':'measured music; narration unavailable'}
        source=document.get('source') or {}
        if source.get('path') and not source.get('muted') and source.get('volume',1)>0:
            voice=Path(source['path'])
            if not voice.is_absolute():voice=Path(visualization_root or Path(__file__).resolve().parents[2] / 'studio')/voice
            if not voice.is_file():raise ValueError('BGM narration source unavailable for gain measurement')
            source_clips=source.get('clips')
            if source_clips is None:source_clips=[{'startFrame':source.get('startFrame',0),'sourceInFrame':0,'durationFrames':source.get('durationFrames',total)}]
            energy=0;frames=0
            for sc in source_clips:
                left=max(start,sc['startFrame']);right=min(end,sc['startFrame']+sc['durationFrames'])
                if right<=left:continue
                level=measure_audio_level(voice,(sc['sourceInFrame']+left-sc['startFrame'])/fps,(right-left)/fps)
                energy+=(right-left)*10**(level['meanVolumeDb']/10);frames+=right-left
            if frames and energy>0:
                narration_db=10*math.log10(energy/frames)+20*math.log10(source.get('volume',1))
                attenuation=_number(edit.get('underVoiceDb',18),'underVoiceDb',12,30)
                gain_db=max(-60,min(-6,narration_db-attenuation-music_level['meanVolumeDb']))
                volume=10**(gain_db/20)
                mix.update(narrationMeanDb=narration_db,underVoiceDb=attenuation,gainDb=gain_db,method='measured selected music and mapped narration; pending listening')
        key=hashlib.sha256(json.dumps({'edit':edit,'start':start,'end':end,'sha':assets[rid]['sha256']},sort_keys=True).encode()).hexdigest()[:24]
        clips.append({'id':'bgm-'+key,'shotIds':ids,'requirementVersions':{sid:rows[sid]['requirementVersion'] for sid in ids},'assetId':rid,'startFrame':start,'durationFrames':duration,'sourceInFrame':source_in,'volume':volume,**fades,'method':edit['method'],'mixEvidence':mix})
        covered.update(ids)
    gaps=list(execution['gaps'])
    missing=musical-covered
    if missing:gaps.append('未入轨的配乐段落：'+', '.join(sorted(missing)))
    return {'version':1,'assets':list(assets.values()),'clips':clips,'gaps':gaps,'searchAudit':copy.deepcopy(execution['searchAudit']),'downloadAttempts':copy.deepcopy(attempts),'audition':'not_listened'}
