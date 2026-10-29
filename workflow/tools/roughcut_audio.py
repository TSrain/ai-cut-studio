#!/usr/bin/env python3
"""Measured audio boundaries and optional, local Qwen forced alignment (never ASR)."""
from __future__ import annotations

import argparse
import fcntl
import json
import hashlib
import inspect
import shutil
import math
import os
import platform
import re
import signal
import subprocess
import sys
import threading
import time
import unicodedata
import uuid
import wave
from pathlib import Path


class RoughcutError(ValueError):
    pass


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def run_command(command, *, timeout=300, cwd=None, env=None, input_text=None):
    """Keep child process trees cancellable; no shell, no inherited stdout noise."""
    proc = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        stdout, stderr = proc.communicate(input_text, timeout=timeout)
    except BaseException:
        try: os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        try: proc.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            proc.communicate()
        raise
    if proc.returncode:
        error=RoughcutError(f'{Path(command[0]).name} 执行失败（{proc.returncode}）：{stderr.strip()[-1600:]}')
        error.stdout=stdout;error.stderr=stderr
        raise error
    return stdout, stderr


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise RoughcutError('时间或置信度不是有效数值')
    return float(value)


def probe_duration(path):
    stdout, _ = run_command(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                             'stream=index,duration,start_time:format=duration', '-of', 'json', str(path)], timeout=60)
    data = json.loads(stdout)
    if not data.get('streams'): raise RoughcutError('源文件没有音轨')
    duration = float(data.get('format', {}).get('duration') or data['streams'][0].get('duration', 0))
    if not math.isfinite(duration) or duration <= 0: raise RoughcutError('无法取得源片有效时长')
    return duration


def parse_silences(log, duration):
    intervals = []; start = None
    for kind, value in re.findall(r'silence_(start|end):\s*(-?\d+(?:\.\d+)?)', log):
        value = min(duration, max(0., float(value)))
        if kind == 'start':
            if start is None: start = value
        elif start is not None:
            if value > start: intervals.append({'startSeconds':start, 'endSeconds':value})
            start = None
    if start is not None and start < duration:
        intervals.append({'startSeconds':start, 'endSeconds':duration})
    return intervals


# mono=0 observes every channel together: opposite phases must not cancel by downmixing.
SILENCE_FILTER = 'silencedetect=noise=-42dB:d=0.10:mono=0'
PCM_RATE = 16000
PREPARED_AUDIO_SCHEMA = 1


def detect_silences(path, duration):
    _, stderr = run_command(['ffmpeg', '-nostdin', '-hide_banner', '-i', str(path), '-map', '0:a:0', '-vn',
                             '-af', SILENCE_FILTER, '-f', 'null', '-'],
                            timeout=max(120, duration * 3))
    return parse_silences(stderr, duration)


# ---------- decode once: compact PCM + silence evidence + transcript identity ----------

def audio_cache_root():
    root=Path(os.environ.get('ROUGHCUT_AUDIO_CACHE',Path(__file__).resolve().parents[1]/'workspace/roughcut-audio-cache/v1'))
    root.mkdir(parents=True,exist_ok=True);return root


def source_identity(path):
    """Exact filesystem identity; any rewrite (even with a restored mtime) changes ctime."""
    path=Path(path).resolve();stat=path.stat()
    return {'path':str(path),'dev':stat.st_dev,'ino':stat.st_ino,'size':stat.st_size,'mtimeNs':stat.st_mtime_ns,'ctimeNs':stat.st_ctime_ns}


def prepared_audio_key(identity):
    return hashlib.sha256(json.dumps({'schema':PREPARED_AUDIO_SCHEMA,'source':identity,
        'pcm':{'rate':PCM_RATE,'channels':1,'format':'s16le'},'silenceFilter':SILENCE_FILTER},
        sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def _audio_start_offset(path):
    stdout,_=run_command(['ffprobe','-v','error','-select_streams','a:0','-show_entries','stream=start_time:format=start_time',
                          '-of','json',str(path)],timeout=60)
    data=json.loads(stdout);stream=(data.get('streams') or [{}])[0].get('start_time');container=data.get('format',{}).get('start_time')
    try:return float(stream or 0)-float(container or 0)
    except ValueError:return None


def _read_prepared(entry,identity,duration):
    try:
        meta=json.loads((entry/'meta.json').read_text(encoding='utf-8'))
        if meta.get('schemaVersion')!=PREPARED_AUDIO_SCHEMA or meta.get('source')!=identity or meta.get('silenceFilter')!=SILENCE_FILTER:return None
        if duration is not None and abs(float(meta['durationSeconds'])-float(duration))>1e-6:return None
        with wave.open(str(entry/'audio.wav'),'rb') as f:
            if (f.getnchannels(),f.getsampwidth(),f.getframerate(),f.getnframes())!=(1,2,PCM_RATE,meta['frames']):return None
        return meta
    except (OSError,ValueError,KeyError,TypeError,EOFError,wave.Error):
        return None


def _decode_once(path,identity,entry,duration):
    """One ffmpeg decode, two outputs: native-format silencedetect and 16 kHz mono s16le PCM.

    The PCM bytes are exactly what transcript_cache.media_key hashes, so the digest is the
    shared transcript key; the same bytes become the compact WAV used by local consumers.
    """
    temp=entry.with_name(entry.name+'.'+uuid.uuid4().hex+'.part');temp.mkdir(parents=True)
    command=['ffmpeg','-nostdin','-hide_banner','-nostats','-i',str(path),
             '-map','0:a:0','-vn','-af',SILENCE_FILTER,'-f','null','-',
             '-map','0:a:0','-vn','-ac','1','-ar',str(PCM_RATE),'-f','s16le','pipe:1']
    timeout=max(120,(duration or 0)*3)
    try:
        proc=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        errors=[];reader=threading.Thread(target=lambda:errors.append(proc.stderr.read()),daemon=True);reader.start()
        killed=threading.Event()
        def kill():
            killed.set()
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        timer=threading.Timer(timeout,kill);timer.start()
        digest=hashlib.sha256();size=0
        try:
            with wave.open(str(temp/'audio.wav'),'wb') as out:
                out.setnchannels(1);out.setsampwidth(2);out.setframerate(PCM_RATE)
                for chunk in iter(lambda:proc.stdout.read(1<<20),b''):
                    digest.update(chunk);out.writeframesraw(chunk);size+=len(chunk)
            code=proc.wait()
        except BaseException:
            kill();proc.wait();raise
        finally:
            timer.cancel();reader.join(5);proc.stdout.close();proc.stderr.close()
        stderr=b''.join(errors).decode('utf-8','replace')
        if killed.is_set():raise RoughcutError('解码原片音轨超时')
        if code or not size or size%2:raise RoughcutError(f'ffmpeg 解码原片音轨失败（{code}）：{stderr.strip()[-1600:]}')
        if source_identity(path)!=identity:raise RoughcutError('解码期间原片已变化，请重新分析')
        duration=duration if duration is not None else probe_duration(path)
        meta={'schemaVersion':PREPARED_AUDIO_SCHEMA,'source':identity,'pcmKey':digest.hexdigest(),'sampleRate':PCM_RATE,'channels':1,
              'frames':size//2,'durationSeconds':duration,'silenceFilter':SILENCE_FILTER,'silences':parse_silences(stderr,duration),
              'audioStartOffsetSeconds':_audio_start_offset(path)}
        atomic_json(temp/'meta.json',meta)
        shutil.rmtree(entry,ignore_errors=True);temp.rename(entry)
        return meta
    finally:
        shutil.rmtree(temp,ignore_errors=True)


def prune_audio_cache(root=None,keep=(),now=None):
    """Bound the derived-audio cache: drop entries idle > N days, then oldest until under the size cap.
    Entries used within the last hour (possibly by a running job) are never removed."""
    root=Path(root or audio_cache_root());now=now or time.time()
    max_bytes=float(os.environ.get('ROUGHCUT_AUDIO_CACHE_MAX_MB','1024'))*1024*1024
    max_age=float(os.environ.get('ROUGHCUT_AUDIO_CACHE_DAYS','30'))*86400
    entries=[];removed=[]
    for child in root.iterdir():
        if not child.is_dir() or child.name in ('locks',) or child.name in keep:continue
        try:
            marker=child/'meta.json' if (child/'meta.json').exists() else child
            used=marker.stat().st_mtime;size=sum(p.stat().st_size for p in child.rglob('*') if p.is_file())
        except OSError:continue
        if child.name.endswith('.part'):
            if now-used>86400:shutil.rmtree(child,ignore_errors=True);removed.append(child.name)
            continue
        entries.append((used,size,child))
    entries.sort();total=sum(size for _,size,_ in entries)
    for used,size,child in entries:
        if now-used<3600:continue
        if now-used>max_age or total>max_bytes:
            shutil.rmtree(child,ignore_errors=True);total-=size;removed.append(child.name)
    return removed


def prepare_source_audio(path,duration=None):
    """Return {'audio': compact wav, 'pcmKey', 'silences', ...} for one exact source identity.

    Cached under ROUGHCUT_AUDIO_CACHE (default workspace/roughcut-audio-cache/v1), keyed by
    realpath+dev+inode+size+mtime_ns+ctime_ns and the decode/silence parameters.
    """
    import transcript_cache
    path=Path(path).resolve();identity=source_identity(path);key=prepared_audio_key(identity)
    root=audio_cache_root();entry=root/key;locks=root/'locks';locks.mkdir(exist_ok=True)
    with (locks/(key+'.lock')).open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        try:
            meta=_read_prepared(entry,identity,duration);reused=meta is not None
            if reused:os.utime(entry/'meta.json')
            else:meta=_decode_once(path,identity,entry,duration)
        finally:
            fcntl.flock(lock,fcntl.LOCK_UN)
    transcript_cache.remember_media_key(path,meta['pcmKey'],(identity['size'],identity['mtimeNs'],identity['ctimeNs']))
    try:prune_audio_cache(root,keep=(key,))
    except OSError:pass
    return {**meta,'audio':str(entry/'audio.wav'),'cacheKey':key,'reused':reused}


def pcm_timeline_matches_source(prepared):
    """The compact WAV starts at the first decoded sample; only substitute it for the source
    when that sample sits at the container origin (otherwise source-relative seeks would shift)."""
    offset=prepared.get('audioStartOffsetSeconds')
    return offset is not None and abs(offset)<=.001


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold() if c.isalnum())


def aligned_units(cue, words, group_id):
    """Accept only a complete monotone alignment; recover punctuation from the exact source."""
    source = cue['text']; canonical = normalized(source)
    if not words or not canonical or ''.join(normalized(w['text']) for w in words) != canonical:
        raise RoughcutError('字词对齐与原始转写不一致，可能漏字或改写')
    # Mapping is textual only; all timestamps below come from the acoustic aligner.
    offsets = []
    for i, char in enumerate(source):
        offsets.extend([i] * len(normalized(char)))
    if len(offsets) != len(canonical): raise RoughcutError('对齐文本无法无损映射')
    units = []; consumed = 0; source_cursor = 0; previous_end = cue['start']
    for i, word in enumerate(words):
        token = normalized(word['text']); start = number(word['start']); end = number(word['end'])
        if not token or start < cue['start'] or end > cue['end'] or end <= start or start < previous_end:
            raise RoughcutError('字词时间存在零时长、乱序、重叠或越界')
        consumed += len(token)
        next_source = offsets[consumed] if consumed < len(offsets) else len(source)
        units.append({'id':f'{group_id}.w{i+1}', 'text':source[source_cursor:next_source],
                      'startSeconds':start, 'endSeconds':end, 'timing':'word', 'groupId':group_id})
        source_cursor = next_source; previous_end = end
    return units


def usable_alignment_units(cue,words,group_id):
    """Keep measured words; zero-time tokens live only in protected indivisible groups.

    No internal timestamps are assigned to missing-duration tokens. Adjacent positive
    tokens supply group boundaries; an unmatched edge uses the original cue boundary.
    """
    if not words or all(w.get('start')!=w.get('end') for w in words):
        return aligned_units(cue,words,group_id)
    source=cue['text'];canonical=normalized(source)
    if not canonical or ''.join(normalized(w['text']) for w in words)!=canonical:
        raise RoughcutError('字词对齐与原始转写不一致')
    offsets=[]
    for i,char in enumerate(source):offsets.extend([i]*len(normalized(char)))
    if len(offsets)!=len(canonical):raise RoughcutError('对齐文本无法无损映射')
    tokens=[];consumed=0;cursor=0;previous=cue['start']
    for i,word in enumerate(words):
        start=number(word['start']);end=number(word['end']);token=normalized(word['text'])
        if not token or start<cue['start'] or end>cue['end'] or end<start or start<previous:
            raise RoughcutError('字词时间乱序、重叠或越界')
        consumed+=len(token);stop=offsets[consumed] if consumed<len(offsets) else len(source)
        tokens.append({'id':f'{group_id}.w{i+1}','text':source[cursor:stop],
                       'startSeconds':start,'endSeconds':end,'timing':'word','groupId':group_id})
        previous=end;cursor=stop
    intervals=[];i=0
    while i<len(tokens):
        if tokens[i]['endSeconds']>tokens[i]['startSeconds']:i+=1;continue
        first=i
        while i+1<len(tokens) and tokens[i+1]['startSeconds']==tokens[i+1]['endSeconds']:i+=1
        a=max(0,first-1);b=min(len(tokens)-1,i+1)
        if intervals and a<=intervals[-1][1]:intervals[-1][1]=max(intervals[-1][1],b)
        else:intervals.append([a,b])
        i+=1
    by_start={a:b for a,b in intervals};result=[];i=0
    while i<len(tokens):
        if i not in by_start:result.append(tokens[i]);i+=1;continue
        end_index=by_start[i];chunk=tokens[i:end_index+1]
        start=chunk[0]['startSeconds'] if chunk[0]['endSeconds']>chunk[0]['startSeconds'] else cue['start']
        end=chunk[-1]['endSeconds'] if chunk[-1]['endSeconds']>chunk[-1]['startSeconds'] else cue['end']
        if end<=start:raise RoughcutError('零时长局部组没有可靠外边界')
        result.append({'id':f'{group_id}.g{i+1}-{end_index+1}','text':''.join(t['text'] for t in chunk),
            'startSeconds':start,'endSeconds':end,'timing':'segment','groupId':group_id,'coalesced':True,
            'completeSentence':False,'safeBoundaries':False,'protectionReasons':['zero_duration_alignment'],
            'alignmentEvidence':{'tokenIndices':list(range(i,end_index+1)),
                'zeroTokenCount':sum(t['startSeconds']==t['endSeconds'] for t in chunk),
                'boundarySource':'positive-token-edges' if chunk[0]['endSeconds']>chunk[0]['startSeconds'] and chunk[-1]['endSeconds']>chunk[-1]['startSeconds'] else 'original-cue-edge-and-positive-token',
                'wideGap':any(chunk[j+1]['startSeconds']-chunk[j]['endSeconds']>.5 for j in range(len(chunk)-1)),
                'internalTimingAssigned':False}})
        i=end_index+1
    return result


def _safe_boundary(t, silences, duration):
    if t <= .02 or t >= duration - .02: return True
    return any(s['startSeconds'] - .025 <= t <= s['endSeconds'] + .025 for s in silences)


def _audible_gaps(cues, silences, duration):
    """Unexplained energy is only a warning, never claimed to be recognized speech."""
    coverage = [(max(0, c['start']-.15), min(duration, c['end']+.15)) for c in cues]
    coverage += [(s['startSeconds'], s['endSeconds']) for s in silences]
    coverage.sort(); cursor=0.; gaps=[]
    for a,b in coverage:
        if a-cursor > .4: gaps.append((cursor,a))
        cursor=max(cursor,b)
    if duration-cursor > .4: gaps.append((cursor,duration))
    return gaps


def make_units(cues, alignment, silences, duration):
    if not isinstance(cues,list) or not cues: raise RoughcutError('共享转写没有片段')
    previous_start=-1.; warnings=[]; groups=[]
    for i,cue in enumerate(cues):
        start=number(cue['start']); end=number(cue['end'])
        if not isinstance(cue.get('text'),str) or not cue['text'].strip() or not (0<=start<end<=duration) or start<previous_start:
            raise RoughcutError('共享转写有乱序、空文字或越界片段')
        previous_start=start; gid=f'c{i+1}'
        try:
            group=usable_alignment_units(cue, alignment.get(gid, []), gid)
            if any(u.get('coalesced') for u in group):warnings.append(f'{gid} 存在零时长字，已局部并组保护；其余可靠字词保留，不生成组内时间。')
        except (ValueError, KeyError, TypeError) as exc:
            group=[{'id':gid+'.s1','text':cue['text'],'startSeconds':start,'endSeconds':end,'timing':'segment','groupId':gid,
                    'completeSentence':bool(re.search(r'[。！？!?][”’"\']?\s*$',cue['text'])),
                    'safeBoundaries':_safe_boundary(start,silences,duration) and _safe_boundary(end,silences,duration)}]
            warnings.append(f'{gid} 无可靠字词对齐，保持原始整段时间；句内删除禁用。')
        groups.append(group)
    gaps=_audible_gaps(cues,silences,duration)
    if gaps: warnings.append('转写覆盖外存在可听能量，疑似漏字或背景声；相邻片段保留待复核，未作语音识别。')
    for i, (cue, group) in enumerate(zip(cues,groups)):
        reasons=[]
        if any(j!=i and other['start']<cue['end'] and other['end']>cue['start'] for j,other in enumerate(cues)):
            reasons.append('overlapping_speech')
        if any(abs(cue['end']-a)<.21 or abs(cue['start']-b)<.21 for a,b in gaps):
            reasons.append('possible_missing_transcript')
        if any(u['timing']=='word' for u in group):
            # A forced aligner must align supplied text even when ASR omitted words. Audible
            # gaps inside its coverage are not proof of missing speech, but forbid auto cuts.
            word_cues=[{'start':u['startSeconds'],'end':u['endSeconds']} for u in group]
            internal=_audible_gaps(word_cues,silences,duration)
            if any(max(a,cue['start']) < min(b,cue['end']) and min(b,cue['end'])-max(a,cue['start'])>.4 for a,b in internal):
                reasons.append('possible_missing_transcript')
                warnings.append(f'c{i+1} 字词间存在未覆盖的可听能量，疑似漏字或背景声；本段保留待复核。')
        # Explicit uncertainty from a shared transcript provider is never erased.
        if cue.get('uncertain') or cue.get('missingWords') or cue.get('asrMissingWords'):
            reasons.append('possible_missing_transcript')
        for item in group: item['protectionReasons']=list(dict.fromkeys([*item.get('protectionReasons',[]),*reasons]))
    return [item for group in groups for item in group], list(dict.fromkeys(warnings))


def alignment_cache_root():
    root=Path(os.environ.get('ROUGHCUT_ALIGNMENT_CACHE',Path(__file__).resolve().parents[1]/'workspace/roughcut-alignment-cache/v1'))
    root.mkdir(parents=True,exist_ok=True);return root


def alignment_cache_key(binding):
    return hashlib.sha256(json.dumps(binding,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def file_sha256(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def model_identity(model):
    files=sorted(p for p in Path(model).rglob('*') if p.is_file() and '.cache' not in p.parts
                 and p.suffix in ('.json','.safetensors','.bin','.model','.txt'))
    if not files:raise RoughcutError('本地对齐模型没有可校验文件')
    stats=[{'name':str(p.relative_to(model)),'size':p.stat().st_size,'mtime':p.stat().st_mtime_ns,'ctime':p.stat().st_ctime_ns} for p in files]
    memo=alignment_cache_root()/'model-identities'/(alignment_cache_key({'path':str(Path(model).resolve()),'files':stats})+'.json')
    if memo.is_file():return json.loads(memo.read_text())
    result={'files':[{'name':x['name'],'size':x['size'],'sha256':file_sha256(p)} for x,p in zip(stats,files)],
            'latestChangeNs':max(max(x['mtime'],x['ctime']) for x in stats)}
    atomic_json(memo,result);return result


def runtime_identity(python):
    code="""import importlib.metadata as m, pathlib, hashlib, json, platform
names=['qwen-asr','torch','transformers'];versions={x:m.version(x) for x in names}
p=pathlib.Path(m.distribution('qwen-asr').locate_file('qwen_asr/inference/qwen3_forced_aligner.py'))
versions['alignerCodeSha256']=hashlib.sha256(p.read_bytes()).hexdigest();versions['python']=platform.python_version()
print(json.dumps({'versions':versions,'latestChangeNs':max(p.stat().st_mtime_ns,p.stat().st_ctime_ns)}))
"""
    stdout,_=run_command([python,'-c',code],timeout=30);return json.loads(stdout)


def clock_identity(audio_path):
    stdout,_=run_command(['ffprobe','-v','error','-select_streams','a:0','-show_entries',
                         'stream=index,time_base,start_pts,start_time,duration_ts,duration:format=start_time,duration','-of','json',str(audio_path)],timeout=60)
    return json.loads(stdout)


_IDENTITY_MEMO={};_IDENTITY_LOCK=threading.Lock()


def alignment_environment_identity():
    """model + runtime identity for the configured aligner; memoized per process so it can be
    prefetched concurrently with transcription. Re-probed if the configuration changes."""
    python=os.environ.get('ROUGHCUT_ALIGN_PYTHON',sys.executable);model=Path(os.environ['ROUGHCUT_ALIGN_MODEL']).resolve()
    with _IDENTITY_LOCK:
        key=(python,str(model))
        if key not in _IDENTITY_MEMO:_IDENTITY_MEMO[key]=(model_identity(model),runtime_identity(python))
        return _IDENTITY_MEMO[key]


def default_alignment_device():
    """(device, explicit). ROUGHCUT_ALIGN_DEVICE wins; otherwise MPS on Apple Silicon (measured
    ~2.5x faster than CPU with identical timestamps), CPU elsewhere. Auto MPS falls back to CPU."""
    explicit=os.environ.get('ROUGHCUT_ALIGN_DEVICE','').strip()
    if explicit:return explicit,True
    if sys.platform=='darwin' and platform.machine()=='arm64':return 'mps',False
    return 'cpu',False


def make_alignment_binding(audio_path,cues,device=None):
    import transcript_cache
    model_info,runtime=alignment_environment_identity()
    binding={'schemaVersion':1,'pcmKey':transcript_cache.media_key(audio_path),'clock':clock_identity(audio_path),
             'timeOrigin':'original-input-presentation-seconds','cues':cues,'model':{'files':model_info['files']},
             'provider':runtime['versions'],'device':device or os.environ.get('ROUGHCUT_ALIGN_DEVICE','cpu'),'dtype':'float32','batchSize':4,
             'wrapperSha256':hashlib.sha256(inspect.getsource(alignment_child).encode()).hexdigest()}
    return binding,max(model_info['latestChangeNs'],runtime['latestChangeNs'])


def read_alignment_cache(binding):
    path=alignment_cache_root()/(alignment_cache_key(binding)+'.json')
    if not path.is_file():return None
    data=json.loads(path.read_text())
    if data.get('binding')!=binding or data.get('resultSha256')!=alignment_cache_key(data.get('result')):
        raise RoughcutError('派生对齐缓存校验失败，文件可能损坏')
    return data['result']


def save_alignment_cache(binding,result):
    atomic_json(alignment_cache_root()/(alignment_cache_key(binding)+'.json'),
                {'binding':binding,'result':result,'resultSha256':alignment_cache_key(result)})


def _same_job_source(audio_path,work_dir,source_key):
    job=json.loads((Path(work_dir)/'job.json').read_text())
    if job.get('sourceKey')!=source_key:raise RoughcutError('恢复任务的源时间轴指纹不匹配')
    parts=job.get('identity','').split(':');stat=Path(audio_path).stat()
    if len(parts)!=5 or [int(x) for x in parts[:3]]!=[stat.st_dev,stat.st_ino,stat.st_size] or abs(float(parts[3])-stat.st_mtime_ns/1e6)>.01:
        raise RoughcutError('恢复任务的原媒体身份已变化')
    if abs(float(parts[4])-stat.st_ctime_ns/1e6)>.01:
        expected=os.environ.get('ROUGHCUT_RESUME_SOURCE_SHA256','')
        if not re.fullmatch('[a-f0-9]{64}',expected) or file_sha256(audio_path)!=expected:
            raise RoughcutError('原媒体ctime变化；须提供原任务已知的ROUGHCUT_RESUME_SOURCE_SHA256作整文件校验')
        job['revalidatedSourceSha256']=expected
    return job


def resume_alignment(audio_path,cues,work_dir,source_key):
    """Explicit same-job registration; never guess provenance from a filename alone."""
    work_dir=Path(work_dir);job=_same_job_source(audio_path,work_dir,source_key)
    request_path=work_dir/'alignment-input.json';output_path=work_dir/'alignment-output.json'
    request=json.loads(request_path.read_text());result=json.loads(output_path.read_text())
    if Path(request.get('sourceAudio',request['audio'])).resolve()!=Path(audio_path).resolve() or request['cues']!=cues:
        raise RoughcutError('旧对齐输入的原片或转写时间/内容不匹配')
    if result.get('provider')!='Qwen3ForcedAligner' or result.get('model')!=request['model'] or not isinstance(result.get('groups'),dict):
        raise RoughcutError('旧对齐输出缺少可核验provider/model')
    if Path(os.environ.get('ROUGHCUT_ALIGN_MODEL','')).resolve()!=Path(request['model']).resolve():
        raise RoughcutError('恢复使用的模型路径与原任务不同')
    receipt=work_dir/'alignment-cache-receipt.json'
    # Re-verify on the device the job actually used (recorded in its receipt), not today's default.
    recorded=json.loads(receipt.read_text()).get('binding',{}).get('device') if receipt.is_file() else None
    binding,latest_change=make_alignment_binding(audio_path,cues,recorded or os.environ.get('ROUGHCUT_ALIGN_DEVICE') or 'cpu')
    if receipt.is_file():
        proof=json.loads(receipt.read_text())
        if proof.get('binding')!=binding or proof.get('outputSha256')!=file_sha256(output_path):raise RoughcutError('恢复对齐证据绑定不匹配')
    else:
        # Legacy v1 did not record device. The caller must explicitly attest its original device.
        if not os.environ.get('ROUGHCUT_ALIGN_DEVICE'):raise RoughcutError('旧对齐没有设备记录；请明确设置原任务 ROUGHCUT_ALIGN_DEVICE 后恢复')
        if latest_change>request_path.stat().st_mtime_ns:raise RoughcutError('对齐运行后模型或provider文件有变化，不能追认旧结果')
        meta=json.loads((work_dir/'shared-transcript-minute.json').read_text())
        if meta.get('transcript_key')!=binding['pcmKey']:raise RoughcutError('旧转写与当前音轨PCM身份不同')
        atomic_json(receipt,{'binding':binding,'outputSha256':file_sha256(output_path),
            'registration':'explicit-same-job-resume','inputSha256':file_sha256(request_path),
            'jobSha256':file_sha256(work_dir/'job.json'),'deviceAttested':binding['device'],
            'revalidatedSourceSha256':job.get('revalidatedSourceSha256')})
    save_alignment_cache(binding,result)
    return result['groups'],result.get('warnings',[])


def _alignment_request(audio_path,pcm_audio,cues,model):
    # 'audio' is what the aligner child reads; 'sourceAudio' keeps provenance when that is the
    # compact PCM of the same source (identical samples and time origin; see pcm_timeline_matches_source).
    request={'audio':str(pcm_audio or audio_path),'cues':cues,'model':str(Path(model).resolve())}
    if pcm_audio:request['sourceAudio']=str(audio_path)
    return request


def optional_alignment(audio_path, cues, work_dir, pcm_audio=None):
    python=os.environ.get('ROUGHCUT_ALIGN_PYTHON', sys.executable)
    model=os.environ.get('ROUGHCUT_ALIGN_MODEL','')
    if not model or not Path(model).is_dir():
        return {}, ['未配置本地字词对齐模型（ROUGHCUT_ALIGN_MODEL）；本轮使用段级保护模式。']
    work_dir=Path(work_dir);request=work_dir/'alignment-input.json';output=work_dir/'alignment-output.json'
    device,explicit=default_alignment_device()
    devices=[device]+([] if explicit or device=='cpu' else ['cpu']);notes=[]
    for attempt,device in enumerate(devices):
        try:
            binding,_=make_alignment_binding(audio_path,cues,device);result=read_alignment_cache(binding)
            if result is None:
                if output.exists():
                    archive=work_dir/'alignment-history'/uuid.uuid4().hex;archive.mkdir(parents=True)
                    for p in (request,output,work_dir/'alignment.log'):
                        if p.is_file():shutil.copy2(p,archive/p.name)
                atomic_json(request,_alignment_request(audio_path,pcm_audio,cues,model))
                output.unlink(missing_ok=True)
                stdout, stderr=run_command([python,str(Path(__file__).resolve()),'--align-input',str(request),'--align-out',str(output)],
                                          timeout=float(os.environ.get('ROUGHCUT_ALIGN_TIMEOUT','1800')),
                                          env={**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','TOKENIZERS_PARALLELISM':'false',
                                               'ROUGHCUT_ALIGN_DEVICE':device})
                (work_dir/'alignment.log').write_text(stdout+'\n'+stderr, encoding='utf-8')
                result=json.loads(output.read_text(encoding='utf-8'))
                if not isinstance(result.get('groups'),dict):raise RoughcutError('对齐程序返回格式错误')
                save_alignment_cache(binding,result)
            else:
                atomic_json(request,_alignment_request(audio_path,pcm_audio,cues,model))
                atomic_json(output,result)
            atomic_json(work_dir/'alignment-cache-receipt.json',{'binding':binding,'outputSha256':file_sha256(output),'cacheKey':alignment_cache_key(binding)})
            return result['groups'],[*notes,*result.get('warnings',[])]
        except (OSError,ValueError,subprocess.TimeoutExpired) as exc:
            if attempt+1<len(devices):
                notes.append(f'{device} 字词对齐失败，已自动改用 CPU：{str(exc)[-300:]}');continue
            return {}, [*notes,f'字词对齐不可用，已降级段级保护：{str(exc)[-700:]}']


def alignment_child(input_path, output_path):
    # Import optional heavy dependencies only inside this process; one model load per source.
    import torch
    from qwen_asr import Qwen3ForcedAligner
    data=json.loads(Path(input_path).read_text(encoding='utf-8'))
    aligner=Qwen3ForcedAligner.from_pretrained(data['model'], dtype=torch.float32,
        device_map=os.environ.get('ROUGHCUT_ALIGN_DEVICE','cpu'), local_files_only=True)
    directory=Path(output_path).parent/'alignment-audio'; directory.mkdir(exist_ok=True)
    groups={}; warnings=[]; pending=[]
    def flush():
        if not pending: return
        results=aligner.align(audio=[str(x[2]) for x in pending],text=[x[1]['text'] for x in pending],language=['Chinese']*len(pending))
        if len(results)!=len(pending): raise RoughcutError('字词对齐 batch 数量不匹配')
        for (gid,cue,path), result in zip(pending,results):
            groups[gid]=[{'text':word.text, 'start':float(word.start_time)+cue['start'],
                          'end':float(word.end_time)+cue['start']} for word in result]
            path.unlink(missing_ok=True)
        pending.clear()
    for i,cue in enumerate(data['cues']):
        gid=f'c{i+1}'; length=cue['end']-cue['start']
        if length>55:
            warnings.append(f'{gid} 超过对齐模型安全块长，整段保留；未按字数拆时间。'); continue
        path=directory/(gid+'.wav')
        run_command(['ffmpeg','-nostdin','-v','error','-y','-ss',str(cue['start']),'-i',data['audio'],'-t',str(length),
                     '-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le',str(path)],timeout=120)
        pending.append((gid,cue,path))
        if len(pending)>=4: flush()
    flush(); atomic_json(output_path,{'groups':groups,'warnings':warnings,'provider':'Qwen3ForcedAligner','model':data['model']})


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--align-input',required=True); parser.add_argument('--align-out',required=True)
    args=parser.parse_args()
    def cancelled(_signum,_frame): raise KeyboardInterrupt('对齐已取消')
    signal.signal(signal.SIGTERM,cancelled)
    try: alignment_child(args.align_input,args.align_out)
    except Exception as exc:
        print(f'本地强制对齐失败：{exc}',file=sys.stderr); sys.exit(1)
