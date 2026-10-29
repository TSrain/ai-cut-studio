#!/usr/bin/env python3
"""Validate current full-package production designs and observable receipts.

This is a read-only contract gate. It does not edit a live project or fabricate
work, review, viewing or listening evidence. Legacy unmarked packages stay valid.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

BRANCHES = ('scriptReview', 'rhythm', 'camera', 'captions', 'cover', 'sound', 'footage')
LABELS = dict(zip(BRANCHES, ('脚本审阅', '节奏与留白', '镜头推拉', '字幕', '封面与标题', '声音', '真实素材审稿与候选')))
STATUSES = {'executed', 'leave_blank', 'preserved_manual', 'blocked', 'skipped'}
CANVAS_KEYS = ('width', 'height', 'fps', 'durationFrames')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def json_digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def required_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + ' 必须是非空文字')
    return value


def file_path(value, label):
    if not isinstance(value, str) or not Path(value).is_absolute() or not Path(value).is_file():
        raise ValueError(label + ' 必须是真实文件绝对路径')
    return Path(value)


def canvas_identity(canvas):
    return {key: canvas.get(key) for key in CANVAS_KEYS}


def production_document(data, request, original):
    """Use a SHA-bound current readback after branch CAS edits, keep frozen input."""
    value = data.get('productionReadbackPath')
    if not value:
        return original, None
    if request.get('fullPackageVersion') != 1:
        raise ValueError('本轮 productionReadbackPath 需要 fullPackageVersion=1')
    path = file_path(value, '本轮 productionReadbackPath')
    if not path.resolve().is_relative_to(Path(request['outputRoot']).resolve()):
        raise ValueError('本轮 productionReadbackPath 必须位于 outputRoot')
    raw = load(path); document = raw.get('document', raw)
    if document.get('id') != request['projectId'] or type(document.get('revision')) is not int:
        raise ValueError('本轮工程回读身份/revision 无效')
    if canvas_identity(document.get('canvas', {})) != canvas_identity(original.get('canvas', {})):
        raise ValueError('本轮工程回读 canvas 已改变')
    before = original.get('source') or {}; after = document.get('source') or {}
    def source_mapping(source):
        clips=source.get('clips')
        if clips is None:
            clips=[{'startFrame':0,'durationFrames':source.get('durationFrames',original['canvas']['durationFrames']),'sourceInFrame':source.get('startFrame',0)}]
        return [{key:clip.get(key,default) for key,default in [('startFrame',0),('durationFrames',0),('sourceInFrame',0),('playbackRate',clip.get('speed',1)),('disabled',False)]} for clip in clips]
    if source_mapping(before) != source_mapping(after):
        raise ValueError('本轮工程回读 source.clips 剪辑来源已改变')
    if request.get('videoPath'):
        source_path = after.get('path')
        source = Path(source_path or '')
        if not source.is_absolute():
            source = Path(request.get('visualizationRoot') or Path(__file__).resolve().parents[2] / 'studio') / source
        if not source.is_file() or digest(source) != digest(request['videoPath']):
            raise ValueError('本轮工程回读实际源视频 SHA 已改变')
    elif before.get('path') != after.get('path'):
        raise ValueError('本轮无视频依据不能更换工程源路径')
    return document, {'path': str(path), 'sha256': digest(path), 'role': 'production-readback'}


def pointer_value(document, pointer):
    if not isinstance(pointer, str) or not pointer.startswith('/'):
        raise ValueError('工程回读 pointer 必须是 JSON pointer')
    value = document
    try:
        for key in pointer[1:].split('/'):
            key = key.replace('~1', '/').replace('~0', '~')
            value = value[int(key)] if isinstance(value, list) else value[key]
        return value
    except (KeyError, ValueError, TypeError, IndexError) as error:
        raise ValueError('工程回读字段不存在: ' + pointer) from error


def validate_engineering(engineering, request, current, artifacts):
    if not isinstance(engineering, dict):
        raise ValueError('实际执行的工程支线必须有工程回读')
    path = file_path(engineering.get('snapshotPath'), '工程回读 snapshotPath')
    record = next((item for item in artifacts if Path(item['path']).resolve() == path.resolve()), None)
    if not record or record.get('sha256') != digest(path):
        raise ValueError('工程回读 snapshot 快照必须在原回执 files 中固定 SHA')
    snapshot = load(path); document = snapshot.get('document', snapshot)
    if document.get('id', snapshot.get('projectId')) != request['projectId']:
        raise ValueError('工程回读 projectId 不一致')
    if engineering.get('revision') != document.get('revision') or type(engineering.get('revision')) is not int:
        raise ValueError('工程回读 revision 不一致')
    if canvas_identity(document.get('canvas', {})) != canvas_identity(request['canvas']):
        raise ValueError('工程回读 canvas 不一致')
    ids = engineering.get('instanceIds', [])
    fields = engineering.get('fields', [])
    if not isinstance(ids, list) or not isinstance(fields, list) or not (ids or fields):
        raise ValueError('工程回读必须绑定实际实例或具体字段')
    for instance_id in ids:
        item = next((v for v in document.get('instances', []) if v.get('id') == instance_id), None)
        present = next((v for v in current.get('instances', []) if v.get('id') == instance_id), None)
        if item is None or present != item:
            raise ValueError('工程回读实例缺失或当前工程已变化: ' + str(instance_id))
    for field in fields:
        expected = field.get('sha256')
        pointer = field.get('pointer')
        if expected != json_digest(pointer_value(document, pointer)) or expected != json_digest(pointer_value(current, pointer)):
            raise ValueError('工程回读字段 SHA 与当前工程不一致: ' + str(pointer))
    return {'snapshotPath': str(path), 'snapshotSha256': digest(path), 'revision': engineering['revision'], 'instanceIds': ids, 'fields': fields}


def validate_full_package(data, request, document=None):
    """Return verified evidence or None for unmarked historical contracts."""
    if 'fullPackageVersion' not in request and 'fullPackageVersion' not in data:
        return None
    if request.get('fullPackageVersion') != 1 or data.get('fullPackageVersion') != 1:
        raise ValueError('完整制作 fullPackageVersion 必须为 1，不能降级为仅模板')
    run_id = required_text(request.get('runId'), '本轮 runId')
    if data.get('runId') != run_id:
        raise ValueError('完整制作 runId 必须绑定本轮')
    design = data.get('productionDesign'); paths = data.get('productionReceiptPaths')
    if not isinstance(design, dict) or any(name not in design for name in BRANCHES):
        raise ValueError('完整制作 productionDesign 必须覆盖七项职责')
    if not isinstance(paths, dict) or any(name not in paths for name in BRANCHES):
        raise ValueError('完整制作 productionReceiptPaths 必须覆盖七项职责')
    current, readback = production_document(data, request, document or load(request['projectSnapshotPath'])['document'])
    video_hash = digest(request['videoPath']) if request.get('videoPath') else None
    receipts = {}; files = []; issues = []
    for branch in BRANCHES:
        intent = design[branch]
        if not isinstance(intent, dict) or intent.get('decision') not in STATUSES:
            raise ValueError(branch + ' productionDesign.decision 无效')
        required_text(intent.get('reason'), branch + ' productionDesign.reason')
        path = file_path(paths[branch], branch + ' receipt')
        if not path.resolve().is_relative_to(Path(request['outputRoot']).resolve()):
            raise ValueError('本轮回执必须位于 outputRoot: ' + branch)
        receipt = load(path)
        if receipt.get('schemaVersion') != 1 or receipt.get('branch') != branch or receipt.get('projectId') != request['projectId'] or receipt.get('runId') != run_id:
            raise ValueError(branch + ' 回执版本/projectId/runId 与本轮不一致')
        if receipt.get('sourceVideoSha256') != video_hash or canvas_identity(receipt.get('canvas', {})) != canvas_identity(request['canvas']):
            raise ValueError(branch + ' 回执 sourceVideoSha256/canvas 与当前输入不一致')
        status = receipt.get('status')
        if status != intent['decision'] or status not in STATUSES:
            raise ValueError(branch + ' 回执状态与设计不一致')
        if status == 'skipped' and request.get('scope', {}).get(branch) is not False:
            raise ValueError(branch + ' 只有显式 scope=false 可以跳过')
        required_text(receipt.get('rationale'), branch + ' rationale')
        protected = receipt.get('protected')
        if not isinstance(protected, list) or any(not isinstance(v, str) or not v.strip() for v in protected):
            raise ValueError(branch + ' 必须记录 protected 手调保护')
        if status == 'preserved_manual' and not protected:
            raise ValueError(branch + ' 保留手调必须有具体保护记录')
        acceptance = receipt.get('acceptance', {})
        for key in ('technical', 'visual', 'listening'):
            required_text(acceptance.get(key), branch + ' acceptance.' + key)
        artifacts = receipt.get('files')
        if not isinstance(artifacts, list) or not artifacts:
            raise ValueError(branch + ' 回执必须有实际报告或产物 files')
        for artifact in artifacts:
            source = file_path(artifact.get('path'), branch + ' files.path')
            if digest(source) != artifact.get('sha256'):
                raise ValueError(branch + ' 回执文件 SHA 不一致')
        if status in {'executed', 'preserved_manual'} and branch == 'cover':
            images = [Path(item['path']) for item in artifacts if Path(item['path']).suffix.lower() in {'.png', '.jpg', '.jpeg'}]
            if not images or not any(image.read_bytes().startswith((b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff')) for image in images):
                raise ValueError('cover executed/preserved_manual 必须有真实封面 PNG/JPG，不能仅报告')
        if status == 'executed' and branch == 'cover':
            try:
                from . import cover as cover_helper
            except ImportError:
                import cover as cover_helper
            manifest_value = receipt.get('coverCandidateManifestPath')
            if not manifest_value:
                raise ValueError('cover executed 必须有成套封面 coverCandidateManifestPath；默认三组双画幅')
            manifest_path = file_path(manifest_value, '成套封面 manifest')
            artifact_map = {str(Path(item['path']).resolve()): item['sha256'] for item in artifacts}
            if str(manifest_path.resolve()) not in artifact_map:
                raise ValueError('成套封面 manifest 必须列入回执 files/SHA')
            manifest = load(manifest_path)
            expected_groups = request.get('coverGroups', 3)
            if expected_groups not in (3, 4, 5) or manifest.get('expected_groups') != expected_groups:
                raise ValueError('成套封面组数不符合本轮要求，默认三组')
            report = cover_helper.validate(manifest_path, write_report=False)
            if not report['candidate_ready']:
                raise ValueError('成套封面未通过文件、双画幅、视觉和语义验收: ' + '; '.join(report['errors']))
            dependencies = [manifest_path.parent / name for name in ('source.md', 'source.json', 'references.json')]
            dependencies += [Path(image['path']) for image in report['images']]
            if any(str(file.resolve()) not in artifact_map or digest(file) != artifact_map[str(file.resolve())] for file in dependencies):
                raise ValueError('成套封面六张图片与来源合同必须列入回执 files/SHA')
        if status == 'executed' and branch in {'camera', 'captions', 'sound', 'footage'}:
            receipt['engineering'] = validate_engineering(receipt.get('engineering'), request, current, artifacts)
        elif receipt.get('engineering'):
            receipt['engineering'] = validate_engineering(receipt['engineering'], request, current, artifacts)
        if status == 'executed' and branch in {'camera', 'captions', 'sound'}:
            expected_pointer = {'camera': '/source/cameraPlan', 'captions': '/captions', 'sound': '/audioClips'}[branch]
            pointers = [field.get('pointer', '') for field in receipt['engineering']['fields']]
            if not any(pointer == expected_pointer or pointer.startswith(expected_pointer + '/') for pointer in pointers):
                raise ValueError(branch + ' executed 工程回读必须核验实际支线字段 ' + expected_pointer)
        if status == 'executed' and branch == 'captions':
            try:
                from . import caption_quality
                from .handoff import validate_srt
            except ImportError:
                import caption_quality
                from handoff import validate_srt
            source_cues = validate_srt(Path(request['sourceSrtPath']).read_text(encoding='utf-8-sig'), float('inf'))
            reviews = receipt.get('captionQualityReviews', [])
            artifact_map = {str(Path(item['path']).resolve()): item['sha256'] for item in artifacts}
            for review in reviews:
                evidence = str(Path(review.get('evidencePath', '')).resolve())
                if artifact_map.get(evidence) != review.get('evidenceSha256'):
                    raise ValueError('字幕质量复审证据必须列入本轮回执 files/SHA')
            segmentation = None
            if receipt.get('captionSegmentationReviewPath'):
                segmentation_path = file_path(receipt['captionSegmentationReviewPath'], '字幕语义断句复审')
                if artifact_map.get(str(segmentation_path.resolve())) != digest(segmentation_path):
                    raise ValueError('字幕语义断句复审必须列入本轮回执 files/SHA')
                segmentation = load(segmentation_path)
            quality = caption_quality.audit(current, source_cues, reviews,
                require_segmentation_review=request.get('captionSegmentationVersion') == 1,
                segmentation_review=segmentation)
            if not quality['passed']:
                pending = ', '.join(finding['id'] for finding in quality['findings'] if not finding.get('resolved'))
                raise ValueError('字幕质量需真实时间复审或局部样式依据，不能仅对照SRT即报executed: ' + pending)
            receipt['captionQualityReport'] = quality
        if status == 'preserved_manual' and branch == 'cover':
            if not receipt.get('engineering') or not any(field.get('pointer') == '/cover' or field.get('pointer', '').startswith('/cover/') for field in receipt['engineering']['fields']):
                raise ValueError('cover preserved_manual 必须实际工程cover字段回读')
        if status == 'blocked':
            issues.append({'branch': branch, 'reason': receipt['rationale']})
        files.append({'path': str(path), 'sha256': digest(path), 'role': 'production-receipt-' + branch})
        receipts[branch] = receipt
    if readback:files.append(readback)
    return {'fullPackageVersion': 1, 'runId': run_id, 'projectId': request['projectId'],
            'productionDesign': design, 'productionReceiptPaths': paths, 'receipts': receipts,
            'productionReadbackPath': data.get('productionReadbackPath'),
            'files': files, 'issues': issues, 'state': 'partial' if issues else 'complete'}


def render_report(verified):
    if not verified:
        return ''
    lines = ['## 本轮完整制作职责', '', '本轮：' + verified['runId'], '']
    for branch in BRANCHES:
        receipt = verified['receipts'][branch]
        lines.extend(['### ' + LABELS[branch], '', '本轮设计：' + verified['productionDesign'][branch]['reason'],
                      '执行结果：' + receipt['status'] + '；' + receipt['rationale'],
                      '保护记录：' + ('；'.join(receipt['protected']) or '没有新增需保护项'),
                      '技术 / 观看 / 听审：' + ' / '.join(receipt['acceptance'][key] for key in ('technical', 'visual', 'listening')),
                      '回执：' + verified['productionReceiptPaths'][branch]])
        lines.extend('- ' + item['path'] for item in receipt['files'])
        lines.append('')
    return '\n'.join(lines)
