#!/usr/bin/env python3
"""Validate a Jianying export and submit one resumable local package job."""
import argparse
import hashlib
import json
import re
import subprocess
import uuid
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


def validate_srt(text, duration):
    cues = []
    timestamp = r'(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})'
    def seconds(parts):
        h, m, s, ms = map(int, parts)
        return h * 3600 + m * 60 + s + ms / 1000
    for block in re.split(r'\n\s*\n', text.lstrip('\ufeff').replace('\r\n', '\n').strip()):
        lines = block.splitlines()
        if len(lines) < 3 or not lines[0].isdigit():
            raise ValueError('无效或缺失 SRT 字幕')
        match = re.fullmatch(timestamp + r'\s+-->\s+' + timestamp, lines[1])
        if not match:
            raise ValueError('无效 SRT 时间码')
        start, end = seconds(match.groups()[:4]), seconds(match.groups()[4:])
        if end <= start or (cues and start < cues[-1]['start']):
            raise ValueError('字幕时间倒序')
        if end > duration + 0.1:
            raise ValueError('字幕超出当前导出视频；请检查是否误用原片字幕')
        value = '\n'.join(lines[2:]).strip()
        if not value:
            raise ValueError('字幕正文为空')
        cues.append({'start': start, 'end': end, 'text': value})
    return cues


def check_identity(state, inputs):
    if state.get('inputs') != inputs:
        raise ValueError('输入已经变化，请创建新批次，不覆盖旧工程')


def sha(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def api(base, path, payload=None):
    if urlparse(base).hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise ValueError('handoff 仅连接本机控制台')
    request = Request(base.rstrip('/') + path,
                      data=None if payload is None else json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=120) as response:
        return json.load(response)


def run(args):
    state_path = Path(args.state).resolve()
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    if args.command == 'status':
        if not state:
            raise ValueError('没有交接状态文件')
        result = api(args.api_base, '/api/editor/production-plan/jobs?projectId=' + state['projectId'])
        keys = ('id', 'kind', 'status', 'stage', 'processed', 'total', 'outputDir', 'error', 'message')
        return {'consoleUrl': state['consoleUrl'], 'projectId': state['projectId'],
                'jobs': [{**{key: job[key] for key in keys if key in job},
                          'resultCount': len(job.get('results', []))} for job in result['jobs']]}
    video, srt = Path(args.video).resolve(strict=True), Path(args.srt).resolve(strict=True)
    inputs = {'videoSha256': sha(video), 'srtSha256': sha(srt)}
    if state:
        check_identity(state, inputs)
    else:
        meta = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video)]))
        streams = meta['streams']
        if not any(s['codec_type'] == 'video' for s in streams) or not any(s['codec_type'] == 'audio' for s in streams):
            raise ValueError('导出文件必须包含视频和声音')
        duration = float(meta['format']['duration'])
        if abs(duration - args.expected_duration) > 0.15:
            raise ValueError('视频时长与剪映当前时间线不一致')
        cues = validate_srt(srt.read_text(encoding='utf-8-sig'), duration)
        pid = 'handoff-' + uuid.uuid4().hex[:16]
        state = {'version': 1, 'inputs': inputs, 'video': str(video), 'srt': str(srt),
                 'projectId': pid, 'projectRoot': str(Path(args.project_root).resolve()),
                 'name': args.name, 'duration': duration, 'cueCount': len(cues),
                 'consoleUrl': args.api_base.replace('127.0.0.1', 'localhost') + '/editor?document=' + pid}
        save(state_path, state)
    pid = state['projectId']
    if 'media' not in state:
        if state.get('importPending'):
            raise RuntimeError('上次导入结果未知；先查当前工程素材，禁止重复上传')
        state['importPending'] = True
        save(state_path, state)
        # Use the existing local streaming import API, never write its media index directly.
        if urlparse(args.api_base).hostname not in {'localhost', '127.0.0.1', '::1'}:
            raise ValueError('handoff 仅连接本机控制台')
        with video.open('rb') as stream:
            request = Request(args.api_base + '/api/editor/import?kind=video&projectId=' + pid,
                              data=stream, method='POST', headers={'x-editor-import': '1',
                              'x-filename': quote(video.name), 'Content-Length': str(video.stat().st_size),
                              'Content-Type': 'application/octet-stream'})
            with urlopen(request, timeout=300) as response:
                state['media'] = json.load(response)
        state.pop('importPending')
        save(state_path, state)
    if not state.get('documentSaved'):
        rows = api(args.api_base, '/api/editor/documents')
        if any(row['id'] == pid for row in rows):
            existing = api(args.api_base, '/api/editor/load?id=' + pid)
            if (existing.get('source') or {}).get('path') != state['media']['path']:
                raise RuntimeError('工程来源冲突，停止覆盖')
        else:
            media = state['media']
            canvas = media['canvas']
            document = {'schemaVersion': 1, 'id': pid, 'name': state['name'], 'revision': 0,
                        'canvas': canvas, 'source': {'path': media['path'], 'publicPath': media['publicPath'],
                        'startFrame': 0, 'durationFrames': canvas['durationFrames'],
                        'displaySize': {'width': canvas['width'], 'height': canvas['height']}},
                        'styleReference': {'contractPath': None, 'styleframePath': None, 'allowedOverrides': {}},
                        'instances': [], 'projectBinding': {'version': 1, 'projectId': pid, 'projectRoot': state['projectRoot']}}
            api(args.api_base, '/api/editor/save', {'document': document})
        state['documentSaved'] = True
        save(state_path, state)
    if not state.get('jobId'):
        if state.get('jobPending'):
            jobs = api(args.api_base, '/api/editor/production-plan/jobs?projectId=' + pid)['jobs']
            if len(jobs) != 1:
                raise RuntimeError('提交结果未知；须人工核对 jobs，禁止自动重复提交')
            state['jobId'] = jobs[0]['id']
        else:
            current = api(args.api_base, '/api/editor/production-plan?projectId=' + pid)['document']
            state['jobPending'] = True
            save(state_path, state)
            result = api(args.api_base, '/api/editor/production-plan/jobs', {
                'projectId': pid, 'revision': current['revision'], 'kind': 'package',
                'sourceSrtPath': state['srt'], 'mediaPaths': [], 'mediaIds': [],
                'scope': {name: True for name in ('scriptReview', 'rhythm', 'camera', 'captions', 'cover', 'sound', 'footage')},
                'instructions': 'handoff：输入为剪映当前已粗剪时间线的完整导出视频和同时间原点 SRT。复用 sourceSrtPath，禁止重新 ASR。原始字幕保留不改；疑似识别错误集中报告。执行完整 content-package：fullPackageVersion=1，重新审阅并执行脚本审阅、节奏留白、镜头推拉、字幕、封面标题、声音、独立真实素材及原生模板，有理由留白/保护手调逐项回执；模板+提示词不算完整package。仅定制动画交Claude手动制作；Codex自由设计非动画支线，通过原生工具和CAS保存回读。总结末尾唯一逐段可删Claude提示词及配套SRT绝对路径。无动画审批；不自动调用Claude，不另启broll，完整职责回执、模板实例和总结回读后交付。'})
            state['jobId'] = result['job']['id']
        state.pop('jobPending', None)
        save(state_path, state)
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-base', default='http://127.0.0.1:4358')
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ['run', 'status']:
        sub = commands.add_parser(command)
        sub.add_argument('--state', required=True)
        if command == 'run':
            for field in ['video', 'srt', 'project-root', 'name']:
                sub.add_argument('--' + field, required=True)
            sub.add_argument('--expected-duration', required=True, type=float)
    print(json.dumps(run(parser.parse_args()), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
