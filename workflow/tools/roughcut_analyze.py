#!/usr/bin/env python3
"""Analyze original speech without modifying media or the shared original transcript."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from roughcut_audio import (RoughcutError, alignment_environment_identity, atomic_json, detect_silences, make_units,
                            optional_alignment, pcm_timeline_matches_source, prepare_source_audio, resume_alignment, probe_duration, run_command)
from roughcut_takes import model_edit_plan

ROOT=Path(__file__).resolve().parents[1]


def progress(stage,message):
    print(json.dumps({'stage':stage,'message':message},ensure_ascii=False),flush=True)


def file_identity(path):
    stat=Path(path).stat()
    return stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns


def shared_cues(audio, work_dir, source_srt=None, pcm_audio=None):
    # Subprocess permits timeout / cancellation of the shared cache / Feishu process tree.
    prefix=Path(work_dir)/'shared-transcript'
    command=[sys.executable,str(ROOT/'tools/transcribe.py'),'--audio',str(audio),'--out',str(prefix),'--format','srt']
    if source_srt: command+=['--source-srt',str(source_srt)]
    if pcm_audio: command+=['--pcm-audio',str(pcm_audio)]
    stdout,stderr=run_command(command,cwd=ROOT,timeout=float(os.environ.get('ROUGHCUT_TRANSCRIBE_TIMEOUT','1800')))
    (Path(work_dir)/'transcribe.log').write_text(stdout+'\n'+stderr,encoding='utf-8')
    from transcribe import load_cues
    path=prefix.with_suffix('.srt')
    if not path.is_file(): raise RoughcutError('共享转写没有产出 SRT')
    return load_cues(path),path


def transcript_needs_decode(audio, source_srt=None):
    """True unless the shared transcript can be served without touching audio: the PCM identity of
    this exact file is already memoized and either a timed transcript is cached or one is supplied."""
    import transcript_cache
    key=transcript_cache.known_media_key(audio)
    return not (key and (source_srt or transcript_cache.read(key)))


def _prefetch_alignment_identity():
    if not os.environ.get('ROUGHCUT_ALIGN_MODEL') or not Path(os.environ['ROUGHCUT_ALIGN_MODEL']).is_dir():return
    try:alignment_environment_identity()
    except (OSError,ValueError,subprocess.SubprocessError):pass  # optional_alignment re-raises and degrades


def transcribe_and_measure(audio, work_dir, source_srt, duration):
    """Decode the source once (compact PCM + silencedetect in the same ffmpeg pass) and get the
    shared transcript. The two are independent unless the transcript needs the audio (unknown PCM
    identity or a cache miss that must upload), in which case the single decode runs first and the
    transcriber reuses its PCM. Aligner identity probing always overlaps transcription."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        warm=pool.submit(_prefetch_alignment_identity)
        if transcript_needs_decode(audio,source_srt):
            prepared=prepare_source_audio(audio,duration)
            cues,transcript=shared_cues(audio,work_dir,source_srt,pcm_audio=prepared['audio'])
        else:
            decoding=pool.submit(prepare_source_audio,audio,duration)
            try:cues,transcript=shared_cues(audio,work_dir,source_srt)
            except BaseException:
                decoding.cancel();raise
            prepared=decoding.result()
        warm.result()
    return cues,transcript,prepared


def analyze(audio,out,work_dir,source_key,source_srt=None,*,resume=False):
    audio=Path(audio).resolve(strict=True); out=Path(out).resolve(); work_dir=Path(work_dir).resolve()
    if not audio.is_file() or not source_key.strip(): raise RoughcutError('缺少源文件或媒体身份 source-key')
    source_srt=Path(source_srt).resolve(strict=True) if source_srt else None
    protected={audio,source_srt}
    if out in protected or work_dir==audio: raise RoughcutError('输出不能覆盖原片或原始转写')
    work_dir.mkdir(parents=True,exist_ok=True)
    if any((work_dir/name).resolve() in protected for name in ('shared-transcript.srt','alignment-input.json','alignment-output.json','analysis-input.json','transcribe.log')):
        raise RoughcutError('工作目录与输入文件冲突')
    identity=file_identity(audio)
    duration=probe_duration(audio);old_analysis=None
    if resume:
        from transcribe import load_cues
        progress('transcribing','恢复同一任务的共享转写，不重新识别')
        transcript=work_dir/'shared-transcript.srt';cues=load_cues(transcript)
        if source_srt and load_cues(source_srt)!=cues:raise RoughcutError('恢复转写与提供的SRT不一致')
        old_analysis=json.loads((work_dir/'analysis-input.json').read_text())
        if old_analysis.get('sourceKey')!=source_key:raise RoughcutError('恢复分析源时间轴不匹配')
        receipt_path=work_dir/'analysis-receipt.json'
        if receipt_path.is_file():
            proof=json.loads(receipt_path.read_text())
            analysis_sha=hashlib.sha256(json.dumps(old_analysis,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            transcript_sha=hashlib.sha256(transcript.read_bytes()).hexdigest()
            if proof.get('analysisSha256')!=analysis_sha or proof.get('transcriptSha256')!=transcript_sha:
                raise RoughcutError('恢复分析或转写证据 SHA 校验失败，不能复用静音区间')
            silences=old_analysis['silences'];last=-1.
            for gap in silences:
                if not (last<=gap['startSeconds']<gap['endSeconds']<=duration):raise RoughcutError('旧静音证据范围无效')
                last=gap['endSeconds']
            progress('analyzing','SHA 校验通过，复用同一原片的实测静音证据')
        else:
            progress('analyzing','旧任务缺少静音证据回执，重新测量真实音频停顿')
            silences=detect_silences(audio,duration)
        progress('aligning','核验并注册已有声学对齐；按当前保护规则重建单位')
        alignment,warnings=resume_alignment(audio,cues,work_dir,source_key)
    else:
        progress('transcribing','读取共享时间码转写，同时单次解码原片音轨测量停顿；已有来源关联时复用缓存')
        cues,transcript,prepared=transcribe_and_measure(audio,work_dir,source_srt,duration)
        progress('analyzing','使用同一次解码实测的音频停顿，检查转写覆盖')
        silences=prepared['silences']
        progress('aligning','运行或复用本地强制字词对齐；不可用片段启用段级保护')
        pcm=prepared['audio'] if pcm_timeline_matches_source(prepared) else None
        alignment,warnings=optional_alignment(audio,cues,work_dir,pcm_audio=pcm)
    units,unit_warnings=make_units(cues,alignment,silences,duration); warnings+=unit_warnings
    analysis_input={'units':units,'silences':silences,'sourceKey':source_key}
    if old_analysis is not None and old_analysis!=analysis_input:
        atomic_json(work_dir/'analysis-history'/(uuid.uuid4().hex+'.json'),old_analysis)
    atomic_json(work_dir/'analysis-input.json',analysis_input)
    atomic_json(work_dir/'analysis-receipt.json',{'sourceKey':source_key,'sourcePath':str(audio),'sourceStat':list(identity),
                'analysisSha256':hashlib.sha256(json.dumps(analysis_input,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
                'transcriptSha256':hashlib.sha256(transcript.read_bytes()).hexdigest()})
    progress('reviewing','全文选择完整重录，并独立二次审核核心信息与重复表达')
    edit_plan=model_edit_plan(units,work_dir,resume=resume,
        on_reuse=lambda path:progress('reviewing','输入、提示词与模型均未变化，复用已独立审核的粗剪计划，未重新调用模型'))
    if file_identity(audio)!=identity: raise RoughcutError('分析期间源媒体已变化，请重新分析')
    result={'version':1,'sourceKey':source_key,'sourceDurationSeconds':duration,
            'timing':'word' if all(u['timing']=='word' for u in units) else 'segment',
            'units':units,'silences':silences,'decisions':[],'editPlan':edit_plan,'warnings':list(dict.fromkeys(warnings)),
            'evidence':{'sourcePath':str(audio),'sourceStat':list(identity),'transcriptPath':str(transcript),
                        'transcriptSha256':hashlib.sha256(transcript.read_bytes()).hexdigest(),
                        'silenceMethod':'ffmpeg silencedetect -42dB 0.10s all channels',
                        'listened':False,'viewed':False}}
    atomic_json(out,result); progress('complete',f'分析完成：{len(units)} 个单位，{len(edit_plan["selections"])} 段完整表达；未做人工听审')
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('audio','out','work-dir','source-key'): parser.add_argument('--'+name,required=True)
    parser.add_argument('--source-srt');parser.add_argument('--resume',action='store_true',help='核验同一任务的原片与派生证据，复用声学结果并按当前规则重建单位')
    parser.add_argument('--no-model-cache',action='store_true',help='不复用跨任务的模型粗剪计划，强制重新调用模型（等同 ROUGHCUT_MODEL_CACHE=0）'); args=parser.parse_args(argv)
    if args.no_model_cache: os.environ['ROUGHCUT_MODEL_CACHE']='0'
    def cancelled(_signum,_frame): raise KeyboardInterrupt('任务已取消')
    signal.signal(signal.SIGTERM,cancelled)
    try:
        for value in (args.audio,args.out,args.work_dir,args.source_srt):
            if value and not Path(value).is_absolute(): raise RoughcutError('输入、输出与工作目录必须使用绝对路径')
        analyze(args.audio,args.out,args.work_dir,args.source_key,args.source_srt,resume=args.resume)
    except KeyboardInterrupt:
        print('粗剪分析已取消，未发布分析结果。',file=sys.stderr,flush=True); return 130
    except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError) as exc:
        print(f'粗剪分析失败：{exc}',file=sys.stderr,flush=True); return 1
    return 0


if __name__=='__main__': sys.exit(main())
