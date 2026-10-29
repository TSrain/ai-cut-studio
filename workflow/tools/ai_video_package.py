#!/usr/bin/env python3
"""Validate AI video prompts and report them without generating any media.

The section contract is also the file interface for the isolated AI prompt
worker. Its output can be merged into semantic sections before package finalize.
Reference order is upload order; hashes bind the actual local input bytes.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import re

try:
    from .transcribe import load_cues
except ImportError:
    from transcribe import load_cues


FIELDS = {'id', 'title', 'prompt', 'promptVersion', 'requirementVersion',
          'sourceCueIds', 'reason', 'aspectRatio', 'durationSeconds', 'references'}
OPTIONAL_FIELDS = {'evidenceRole', 'usage'}
PROMPT_IDENTITY = ('prompt', 'requirementVersion', 'sourceCueIds', 'aspectRatio',
                   'durationSeconds', 'references')


def reference_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _previous_shot(request, section):
    path = request.get('projectSnapshotPath')
    if not path:
        return {}
    snapshot = json.loads(Path(path).read_text(encoding='utf-8'))
    document = snapshot.get('document', {})
    return next((s for s in document.get('productionPlan', {}).get('shots', [])
                 if s.get('id') == section.get('id')), {})


def validate_candidates(candidates, request, section):
    """Return independent, hashed candidates bound to the supplied section.

    A supplied section.requirementVersion is authoritative. build_plan invokes
    this again after advancing the canonical shot version; callers must never
    silently rewrite a prompt's requirementVersion to make it fit a newer shot.
    Empty lists are valid and do not require SRT, files or fabricated candidates.
    """
    if not isinstance(candidates, list):
        raise ValueError('aiVideoCandidates 必须是列表')
    if not candidates:
        return []
    srt = request.get('sourceSrtPath')
    if not isinstance(srt, str) or not Path(srt).is_absolute() or not Path(srt).is_file():
        raise ValueError('AI 视频 cue 绑定需要真实 SRT 绝对路径')
    cues = load_cues(Path(srt))
    section_cues = section.get('sourceCueIds', [])
    if (not isinstance(section_cues, list) or not section_cues
            or any(type(i) is not int or not 1 <= i <= len(cues) for i in section_cues)
            or section_cues != sorted(set(section_cues))):
        raise ValueError('AI 视频所属段落 sourceCueIds 必须对应真实 SRT cue')
    previous_shot = _previous_shot(request, section)
    previous = {c.get('id'): c for c in previous_shot.get('aiVideoCandidates', [])}
    network_ids = {c.get('id') for c in previous_shot.get('candidates', [])}
    expected_version = section.get('requirementVersion')
    if expected_version is not None and (type(expected_version) is not int or expected_version < 1):
        raise ValueError('段落 requirementVersion 需求版本必须为正整数')
    seen, result = set(), []
    for raw in candidates:
        if not isinstance(raw, dict) or FIELDS - raw.keys():
            raise ValueError('AI 视频候选缺少必填字段')
        if raw.keys() - FIELDS - OPTIONAL_FIELDS:
            raise ValueError('AI 视频候选不能携带网络候选、证据或媒体完成状态字段')
        candidate = copy.deepcopy(raw)
        cid = candidate['id']
        if not isinstance(cid, str) or not cid.strip() or '/' in cid or '\\' in cid or cid in seen:
            raise ValueError('AI 视频候选 ID 无效或重复')
        if cid in network_ids:
            raise ValueError('AI 视频候选 ID 不能冒用网络候选标识')
        seen.add(cid)
        for key in ('title', 'prompt', 'reason'):
            if not isinstance(candidate[key], str) or not candidate[key].strip():
                raise ValueError('AI 视频候选 '+key+' 提示词或说明不能为空')
        for key in ('promptVersion', 'requirementVersion'):
            if type(candidate[key]) is not int or candidate[key] < 1:
                raise ValueError('AI 视频候选 '+key+' 必须为正整数')
        if expected_version is not None and candidate['requirementVersion'] != expected_version:
            raise ValueError('AI 视频候选 requirementVersion 与当前需求版本不一致')
        indices = candidate['sourceCueIds']
        if (not isinstance(indices, list) or not indices
                or any(type(i) is not int or i not in section_cues for i in indices)
                or indices != sorted(set(indices))):
            raise ValueError('AI 视频候选 sourceCueIds 必须按序引用本段实际 cue')
        ratio = candidate['aspectRatio']
        if not isinstance(ratio, str) or not re.fullmatch(r'[1-9]\d*:[1-9]\d*', ratio):
            raise ValueError('AI 视频候选 aspectRatio 必须是正整数比例')
        duration = candidate['durationSeconds']
        if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
            raise ValueError('AI 视频候选 durationSeconds 必须为有限正数')
        for key in ('evidenceRole', 'usage'):
            if key in candidate and candidate[key] != 'illustration':
                raise ValueError('AI 视频只能 illustration，仅作示意，不能冒充事实证据')
        candidate['evidenceRole'] = 'illustration'
        references = candidate['references']
        if not isinstance(references, list):
            raise ValueError('AI 视频 references 必须是有序参考图列表')
        for ref in references:
            if (not isinstance(ref, dict) or not {'path', 'label', 'purpose'} <= ref.keys()
                    or ref.keys() - {'path', 'label', 'purpose', 'sha256'}):
                raise ValueError('参考图必须包含 path、label、purpose')
            if any(not isinstance(ref[key], str) or not ref[key].strip() for key in ('path', 'label', 'purpose')):
                raise ValueError('参考图 path、label、purpose 不能为空')
            path = Path(ref['path'])
            if not path.is_absolute() or not path.is_file():
                raise ValueError('参考图必须是真实本地文件绝对路径')
            sha = reference_sha256(path)
            if 'sha256' in ref and ref['sha256'] != sha:
                raise ValueError('AI 视频参考图 SHA 已改变')
            ref['sha256'] = sha
        old = previous.get(cid)
        if old:
            old_version = old.get('promptVersion')
            if type(old_version) is not int or candidate['promptVersion'] < old_version:
                raise ValueError('AI 视频 promptVersion 不能回退')
            if (candidate['promptVersion'] == old_version
                    and any(old.get(k) != candidate.get(k) for k in PROMPT_IDENTITY)):
                raise ValueError('AI 视频提示词、需求或参考顺序改变必须增加 promptVersion 提示词版本')
        json.dumps(candidate, allow_nan=False)
        result.append(candidate)
    return result


def render_ai_video_report(sections):
    """Render prompt-ready state only; no generation, upload or adoption claims."""
    lines = ['## AI 视频候选与提示词', '',
             'AI 画面仅作示意，不作为真实事件、私人经历或产品能力的证据。提示词已就绪，尚未生成视频；上传、识别、入轨、观看与最终采用由实际任务和工程实例分别记录。', '']
    for section in sections:
        candidates = section.get('aiVideoCandidates', [])
        if not candidates:
            continue
        lines.extend([f"### {section['title']}（{section['id']}）", '',
                      f"对应口播：{section['narration']}", ''])
        for candidate in candidates:
            lines.extend([f"#### {candidate['title']}（{candidate['id']}）", '',
                          f"提示词版本：{candidate['promptVersion']}；需求版本：{candidate['requirementVersion']}。",
                          f"对应 cue：{', '.join(map(str, candidate['sourceCueIds']))}；配画面理由：{candidate['reason']}",
                          f"画幅：{candidate['aspectRatio']}；生成目标时长：{candidate['durationSeconds']} 秒（不是已生成媒体时长）。", '',
                          '参考图按以下顺序上传：' if candidate['references'] else '参考图：无。', ''])
            for index, ref in enumerate(candidate['references'], 1):
                lines.append(f"{index}. 图{index}｜{ref['label']}：{ref['path']}；用途：{ref['purpose']}" +
                             (f"；SHA256：{ref['sha256']}" if ref.get('sha256') else ''))
            fence = '`' * max(3, max((len(m.group()) + 1 for m in re.finditer(r'`+', candidate['prompt'])), default=0))
            lines.extend(['', '可复制提示词：', '', fence + 'text', candidate['prompt'], fence, ''])
    if not any(section.get('aiVideoCandidates') for section in sections):
        lines.extend(['本轮无 AI 视频候选；保留实际表达需求，不为填充列表生成假候选。', ''])
    return '\n'.join(lines).rstrip() + '\n'
