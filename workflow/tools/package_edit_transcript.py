"""Freeze saved edited narration in project time; never touch the raw ASR cache."""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def file_sha256(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            result.update(chunk)
    return result.hexdigest()


def derive(document, directory):
    canvas=document['canvas'];rate=canvas['fps']
    fps=rate['num']/rate['den'] if isinstance(rate,dict) else rate
    if not math.isfinite(fps) or fps <= 0: raise ValueError('工程帧率无效')
    source=document.get('source') or {}
    clips=source.get('clips')
    if clips is None:
        clips=[{'startFrame':0,'durationFrames':source.get('durationFrames',canvas['durationFrames'])}]
    intervals=sorted((max(0,c['startFrame']),min(canvas['durationFrames'],c['startFrame']+c['durationFrames'])) for c in clips if not c.get('disabled'))
    # Merge adjacent source ranges so an unchanged cue crossing a cut is not duplicated.
    merged=[]
    for a,b in intervals:
        if b<=a: continue
        if merged and a<=merged[-1][1]:merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
        else:merged.append((a,b))
    cues=[]
    for cue in sorted((document.get('captions') or {}).get('cues',[]),key=lambda c:c['startFrame']):
        text=cue.get('text','')
        if not isinstance(text,str) or not text.strip():continue
        portions=[(max(a,cue['startFrame']),min(b,cue['endFrame'])) for a,b in merged
                  if min(b,cue['endFrame']) > max(a,cue['startFrame'])]
        if portions:
            # A saved cue is one utterance. A source gap cannot tell us which
            # words belong to each side, so retain its text once and its envelope.
            cues.append({'startFrame':portions[0][0],'endFrame':portions[-1][1],
                         'text':text,'captionId':cue.get('id')})
    if not cues:raise ValueError('最新工程没有可用字幕；请先保存粗剪字幕，不能用旧稿或重新 ASR 替代')
    def stamp(frame):
        ms=round(frame/fps*1000);seconds,ms=divmod(ms,1000);minutes,seconds=divmod(seconds,60);hours,minutes=divmod(minutes,60)
        return f'{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}'
    target=Path(directory);target.mkdir(parents=True,exist_ok=True)
    srt=target/'project-transcript.srt'
    srt.write_text('\n\n'.join(f"{i}\n{stamp(c['startFrame'])} --> {stamp(c['endFrame'])}\n{c['text']}" for i,c in enumerate(cues,1))+'\n',encoding='utf-8')
    metadata={'schemaVersion':1,'timeBase':'project','origin':'saved-document-captions','projectId':document.get('id'),'documentRevision':document.get('revision'),
              'sourcePath':source.get('path'),'sourceSha256':file_sha256(source['path']) if source.get('path') and Path(source['path']).is_file() else None,'sourceClipsSha256':fingerprint(source.get('clips')),'captionsSha256':fingerprint((document.get('captions') or {}).get('cues',[])),
              'projectDurationSeconds':canvas['durationFrames']/fps,'srtSha256':hashlib.sha256(srt.read_bytes()).hexdigest(),'cues':cues}
    path=target/'project-transcript.json';path.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {'sourceSrtPath':str(srt.resolve()),'transcriptTimeBase':'project','transcriptProvenancePath':str(path.resolve()),'script':'## 完整口播脚本\n\n'+'\n'.join(c['text'] for c in cues)}
