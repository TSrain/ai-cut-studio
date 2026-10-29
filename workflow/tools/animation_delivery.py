"""Deterministic placement of user supplied animation delivery manifests."""
from __future__ import annotations

import json
import math
import subprocess
import os
from pathlib import Path

try:
    from . import editor_plan_runtime as runtime
except ImportError:
    import editor_plan_runtime as runtime


def load_manifest(path, document, expected_sha=None):
    path = Path(path).resolve(strict=True)
    if expected_sha and runtime.digest(path) != expected_sha:
        raise ValueError('delivery manifest SHA/hash mismatch')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('timeBase', 'project') != 'project':
        raise ValueError('交付清单需要 schemaVersion=1、timeBase=project（当前工程时间轴）')
    if value.get('projectId') and value['projectId'] != document['id']:
        raise ValueError('delivery manifest project mismatch')
    rows = value.get('files')
    if not isinstance(rows, list) or not rows:
        raise ValueError('交付清单 files 必须为非空数组')
    rate = runtime.fps(document)
    entries = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not isinstance(row.get('file'), str) or not row['file'].strip():
            raise ValueError(f'交付清单第 {index + 1} 项缺少 file')
        start, duration = row.get('startSeconds'), row.get('durationSeconds')
        if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in (start, duration)) or start < 0 or duration <= 0:
            raise ValueError('交付清单起始时间/时长必须为有限非负秒数，时长大于零')
        if type(row.get('transparent')) is not bool:
            raise ValueError('交付清单 transparent 必须为布尔值')
        # Match JavaScript Math.round in the editor at half-frame boundaries.
        target = {'startFrame': math.floor(start * rate + .5), 'durationFrames': math.floor(duration * rate + .5)}
        if target['durationFrames'] < 1 or target['startFrame'] + target['durationFrames'] > document['canvas']['durationFrames']:
            raise ValueError('交付清单时间超出当前工程画布，不能裁剪或猜位置')
        media = Path(row['file'])
        if not media.is_absolute():
            media = path.parent / media
        media = media.resolve(strict=True)
        if not media.is_file() or not media.stat().st_size:
            raise ValueError('交付清单文件不存在或为空: ' + str(media))
        entries.append({**row, 'file': str(media), 'entryIndex': index, 'target': target})
    return value, entries


def recognize_delivery(store):
    data = store.snapshot
    path = Path(data['deliveryManifestPath']).resolve(strict=True)
    manifest_sha = runtime.digest(path)
    _, entries = load_manifest(path, data['document'], data.get('deliveryManifestSha256'))
    failed = []
    for index, entry in enumerate(entries):
        store.update(stage='check_delivery_media', processed=index, total=len(entries))
        file = Path(entry['file'])
        try:
            probe = runtime.probe_and_sample(file, store.root / 'delivery-checks' / str(index))
            # Decode the actual visual stream. No model, filename guess or semantic approval.
            subprocess.run([os.environ.get('EDITOR_PLAN_FFMPEG_BIN', 'ffmpeg'), '-nostdin', '-v', 'error',
                            '-i', str(file), '-map', '0:v:0', '-an', '-f', 'null', '-'], check=True, capture_output=True)
            if runtime.digest(file) != probe['sha256']:
                raise ValueError('delivery media changed during decoding')
            # VP9 Alpha metadata is also recognized by Motion Studio's media probe.
            stream = next((s for s in probe.get('streams', []) if s.get('codec_type') == 'video'), {})
            alpha = probe.get('hasAlpha') is True or str(stream.get('tags', {}).get('alpha_mode')) == '1'
            issues = []
            if probe['kind'] == 'video' and abs(probe['durationSeconds'] - entry['durationSeconds']) > 1 / runtime.fps(data['document']) + .001:
                issues.append('清单时长与实际媒体时长不符')
            if entry['transparent'] and not alpha:
                issues.append('清单声明透明，但实际媒体未检测到 Alpha')
            result = {'kind': 'delivery', 'target': entry['target'],
                      'media': {'path': str(file), 'sourceInSeconds': 0, 'sourceOutSeconds': entry['durationSeconds']},
                      'delivery': {'manifestPath': str(path), 'manifestSha256': manifest_sha, 'entryIndex': entry['entryIndex'],
                                   'timeBase': 'project', 'startSeconds': entry['startSeconds'],
                                   'durationSeconds': entry['durationSeconds'], 'transparent': entry['transparent']},
                      'technical': {'passed': not issues, 'details': {**probe, 'hasAlpha': alpha, 'decoded': True}},
                      'reason': '；'.join(issues) if issues else '按交付清单直接追加独立轨道，原口播音频保留；未做整片视觉/听审'}
            store.publish(result)
            if issues:
                failed.append({'path': str(file), 'reason': '；'.join(issues)})
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            failed.append({'path': str(file), 'reason': str(exc)})
        store.update(stage='delivery_media_checked', processed=index + 1, total=len(entries))
    runtime.atomic_json(store.root / 'delivery-import-issues.json', failed)
    return store.finish('partial' if failed else 'complete', stage='delivery_ready', issues=failed,
                        outputs={'deliveryManifestPath': str(path), 'deliveryIssuesPath': str(store.root / 'delivery-import-issues.json')})
