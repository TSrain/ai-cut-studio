#!/usr/bin/env python3
"""Read-only caption timing/style review gate. Never estimates word boundaries.

Long cues are review candidates, not proven errors. A matching SRT or character-
weighted split is not timing evidence. This module never transcribes or uploads.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

LONG_CUE_SECONDS = 5.0
TYPOGRAPHY_KEYS = ('color', 'fontSize', 'fontFamily', 'fontWeight')
TIMING_METHODS = {'listening', 'word_timestamps', 'forced_alignment'}
STYLE_METHODS = {'user_authorized_style', 'preserved_manual_style'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def finding_digest(finding):
    value = {key: item for key, item in finding.items() if key not in {'resolved', 'review'}}
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def cue_digest(cue):
    """Bind segmentation decisions to wording and actual display interval."""
    value = {key: cue[key] for key in ('id', 'text', 'startFrame', 'endFrame')}
    return finding_digest(value)


def audit(document, source_cues=(), reviews=(), *, require_segmentation_review=False,
          segmentation_review=None):
    """Return outstanding review findings without altering document/source cues.

    Reviews bind both finding content and an immutable evidence file. They attest
    the stated human/word-timing review; their existence does not claim this tool
    listened to audio. Non-typographic local placement remains unrestricted.
    """
    findings = []
    for index, cue in enumerate(source_cues, 1):
        if cue['end'] - cue['start'] > LONG_CUE_SECONDS:
            findings.append({'id': f'source:{index}:coarse_source_timing',
                             'code': 'coarse_source_timing', 'sourceCueId': index,
                             'startSeconds': cue['start'], 'endSeconds': cue['end'],
                             'text': cue['text'], 'requires': 'timing_review'})
    track = document.get('captions') or {}
    fps_data = document.get('canvas', {}).get('fps', {})
    fps = fps_data.get('num', 0) / fps_data.get('den', 1)
    if track.get('cues') and fps <= 0:
        raise ValueError('字幕质量检查需要有效工程帧率')
    global_style = track.get('style') or {}
    if require_segmentation_review or segmentation_review is not None:
        if segmentation_review is None:
            findings.append({'id': 'captions:semantic_segmentation',
                             'code': 'missing_segmentation_review',
                             'requires': 'semantic_segmentation_review',
                             'reason': '每条字幕均需语义断句复审，不能只筛查长cue'})
        else:
            if segmentation_review.get('version') != 1:
                raise ValueError('字幕语义断句复审版本无效')
            rows = segmentation_review.get('cues')
            current = {cue['id']: cue for cue in track.get('cues', [])}
            if not isinstance(rows, list) or len(rows) != len(current) or {
                    row.get('cueId') for row in rows} != set(current):
                raise ValueError('字幕语义断句复审必须完整覆盖当前所有cue，不可遗漏或重复')
            for row in rows:
                cue = current[row['cueId']]
                if row.get('cueSha256') != cue_digest(cue):
                    raise ValueError('字幕语义断句复审与当前文字/边界不一致，旧记录已过期')
                if row.get('decision') not in {'keep', 'split_required'} or not str(row.get('reason') or '').strip():
                    raise ValueError('字幕语义断句复审缺具体判断与理由')
                if row['decision'] == 'split_required':
                    findings.append({'id': f"caption:{cue['id']}:merged_semantic_units",
                                     'code': 'merged_semantic_units', 'cueId': cue['id'],
                                     'text': cue['text'], 'requires': 'semantic_segmentation_review',
                                     'reason': row['reason']})
    for index, cue in enumerate(track.get('cues', []), 1):
        identity = cue.get('id', str(index))
        common = {'cueId': identity, 'startFrame': cue['startFrame'],
                  'endFrame': cue['endFrame'], 'text': cue['text']}
        if (cue['endFrame'] - cue['startFrame']) / fps > LONG_CUE_SECONDS:
            findings.append({**common, 'id': f'caption:{identity}:long_display_cue',
                             'code': 'long_display_cue', 'requires': 'timing_review'})
        overrides = {}
        for key in TYPOGRAPHY_KEYS:
            local = (cue.get('style') or {}).get(key)
            global_value = global_style.get(key)
            if key == 'color' and isinstance(local, str) and isinstance(global_value, str):
                differs = local.lower() != global_value.lower()
            else:
                differs = local != global_value
            if local is not None and differs:
                overrides[key] = {'global': global_value, 'local': local}
        if overrides:
            findings.append({**common, 'id': f'caption:{identity}:local_typography_override',
                             'code': 'local_typography_override', 'overrides': overrides,
                             'requires': 'style_authorization'})
    indexed = {finding['id']: finding for finding in findings}
    seen = set()
    for review in reviews:
        identity = review.get('findingId')
        if identity not in indexed or identity in seen:
            raise ValueError('字幕复审 findingId 过期或重复')
        seen.add(identity)
        finding = indexed[identity]
        if finding['requires'] == 'semantic_segmentation_review':
            raise ValueError('语义合句不能用时间复审绕过；须拆分后重新逐条审阅')
        if review.get('findingSha256') != finding_digest(finding):
            raise ValueError('字幕复审与当前文字/时间/样式不一致，旧回执已过期')
        allowed = TIMING_METHODS if finding['requires'] == 'timing_review' else STYLE_METHODS
        if review.get('method') not in allowed:
            raise ValueError('字幕时间需真实听审/词级时间/强制对齐；局部样式需明确用户授权或手调依据')
        if not isinstance(review.get('reason'), str) or not review['reason'].strip():
            raise ValueError('字幕复审需要具体理由')
        evidence = Path(review.get('evidencePath') or '')
        if not evidence.is_absolute() or not evidence.is_file():
            raise ValueError('字幕复审需要真实证据文件绝对路径')
        if digest(evidence) != review.get('evidenceSha256'):
            raise ValueError('字幕复审证据 SHA 不一致')
        finding.update(resolved=True, review=review)
    unresolved = [finding for finding in findings if not finding.get('resolved')]
    return {'schemaVersion': 1, 'kind': 'caption-quality-v1',
            'longCueReviewThresholdSeconds': LONG_CUE_SECONDS,
            'passed': not unresolved, 'findings': findings,
            'segmentationReviewVersion': 1 if segmentation_review is not None else None,
            'segmentationReviewedCueCount': len(segmentation_review['cues']) if segmentation_review is not None else 0,
            'unresolvedCount': len(unresolved), 'listening': 'not_performed',
            'note': '粗cue只标需复审，不判已错；不自动均分、不改原始SRT、不触发ASR。'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--source-srt')
    parser.add_argument('--reviews', help='JSON array of evidence-bound review entries')
    parser.add_argument('--segmentation-review', help='JSON full-cue semantic segmentation review')
    parser.add_argument('--require-segmentation-review', action='store_true')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    raw = json.loads(Path(args.snapshot).read_text(encoding='utf-8'))
    source_cues = []
    if args.source_srt:
        try:
            from tools.handoff import validate_srt
        except ModuleNotFoundError:
            from handoff import validate_srt
        source_cues = validate_srt(Path(args.source_srt).read_text(encoding='utf-8-sig'), float('inf'))
    reviews = json.loads(Path(args.reviews).read_text()) if args.reviews else []
    segmentation = json.loads(Path(args.segmentation_review).read_text()) if args.segmentation_review else None
    report = audit(raw.get('document', raw), source_cues, reviews,
                   require_segmentation_review=args.require_segmentation_review,
                   segmentation_review=segmentation)
    report['snapshotSha256'] = digest(args.snapshot)
    if args.source_srt:
        report['sourceSrtSha256'] = digest(args.source_srt)
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'unresolvedCount': report['unresolvedCount'],
                      'reportPath': str(out.resolve())}, ensure_ascii=False))
    return 0 if report['passed'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
