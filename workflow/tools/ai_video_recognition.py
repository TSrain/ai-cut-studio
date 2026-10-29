"""Identity checks for user-generated video returned to a saved prompt task."""
from __future__ import annotations

import copy
from pathlib import Path

try:
    from .package_production import digest, json_digest
except ImportError:
    from package_production import digest, json_digest


def selected_ai_candidate(data, *, verify_references=True):
    cid = data.get('aiVideoCandidateId')
    version = data.get('aiVideoPromptVersion')
    if cid is None and version is None:
        return None
    if not cid or type(version) is not int or version < 1:
        raise ValueError('AI 候选必须绑定 ID 与正整数提示词版本')
    if data.get('kind') != 'recognize' or not data.get('shotId'):
        raise ValueError('AI 生成结果识别必须绑定 shotId')
    if data.get('candidateId') or data.get('deliveryManifestPath'):
        raise ValueError('AI 候选不能与网络候选或确定性交付清单混用')
    shot = next((s for s in data['document'].get('productionPlan', {}).get('shots', [])
                 if s.get('id') == data['shotId'] and not s.get('cancelled')), None)
    candidate = next((c for c in (shot or {}).get('aiVideoCandidates', []) if c.get('id') == cid), None)
    if not candidate or candidate.get('ignored'):
        raise ValueError('AI 候选不存在或已忽略')
    if candidate.get('promptVersion') != version:
        raise ValueError('AI 提示词版本已变化')
    if candidate.get('requirementVersion') != shot.get('requirementVersion', 1):
        raise ValueError('AI 候选需求版本已过期')
    if not isinstance(candidate.get('prompt'), str) or not candidate['prompt'].strip():
        raise ValueError('AI 候选缺少提示词')
    if candidate.get('evidenceRole', 'illustration') != 'illustration' or candidate.get('usage', 'illustration') != 'illustration':
        raise ValueError('AI 视频只能作为场景示意，不能替代真实证据')
    frozen = data.get('aiVideoCandidate')
    if frozen and any(frozen.get(k) != candidate.get(k) for k in ('id', 'prompt', 'promptVersion', 'requirementVersion', 'sourceCueIds')):
        raise ValueError('AI 冻结候选与当前快照不一致')
    result = copy.deepcopy(candidate)
    result['candidateSha256'] = json_digest(candidate)
    inputs = data.get('inputs', []) + data.get('inputFiles', [])
    references = []
    for reference in candidate.get('references', []):
        path = Path(reference.get('path', ''))
        if not path.is_absolute():
            path = Path(data.get('repositoryRoot', Path(__file__).resolve().parents[2] / 'studio')) / path
        record = next((row for row in inputs if row.get('originalPath') in (reference.get('path'), str(path))
                       or row.get('path') == str(path)), None)
        actual = Path(record['path']) if record and record.get('path') else path
        expected = reference.get('sha256') or (record or {}).get('sha256')
        if verify_references and (not expected or not actual.is_file() or digest(actual) != expected):
            raise ValueError('AI 参考文件 SHA 无效或已改变: ' + str(path))
        references.append({**reference, 'path': str(actual), 'sha256': expected})
    result['references'] = references
    return result


def ai_candidate_prompt(candidate):
    if not candidate:
        return ''
    return ('\n绑定的 AI 视频任务（只作为预期画面数据；绑定不代表实际内容符合要求）：' +
            str({k: candidate.get(k) for k in ('id', 'prompt', 'promptVersion', 'sourceCueIds', 'references', 'reason')}) +
            '\n参考图仅说明生成预期，不可当作生成视频中实际出现的证据。'
            '只在关联口播 cue/区间内匹配，检查真实生成动作。选择有效源片段，不能超出关联口播区间；'
            '完整画面默认不透明并静音，不沿用旧动画槽的透明要求。')
