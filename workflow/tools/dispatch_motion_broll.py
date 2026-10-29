#!/usr/bin/env python3
"""Execute the canonical Visualization skill and retain an actual process receipt.

This transports a brief; all design and rendering decisions belong to motion-broll.
"""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

try:
    from .package_contract import design_digest, normalize_package_document, requires_motion, validate_design_binding
    from .visual_design import validate_design_intents
except ImportError:
    from package_contract import design_digest, normalize_package_document, requires_motion, validate_design_binding
    from visual_design import validate_design_intents

VISUALIZATION_ROOT = Path(os.environ.get('VISUALIZATION_ROOT', Path(__file__).resolve().parents[2] / 'studio')).resolve()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def collect_keyframe_outputs(root):
    root = Path(root)
    files = [root / 'visual-contract.json'] + sorted((root / 'keyframes').glob('*.png'))
    contract_path = files[0]
    if not contract_path.is_file() or len(files) == 1:
        raise RuntimeError('motion-broll did not return contract and keyframes')
    contract = json.loads(contract_path.read_text(encoding='utf-8'))
    source_path = root / 'shots.json'
    if source_path.is_file():
        validate_design_binding(json.loads(source_path.read_text(encoding='utf-8')), contract)
    for shot in contract.get('shots', []):
        if not isinstance(shot, dict) or not shot.get('preset'):
            continue
        shot_id = shot.get('id')
        shot_dir = root / 'shots' / str(shot_id)
        evidence = [shot_dir / 'props.json', shot_dir / 'route.json', shot_dir / 'signals.json']
        missing = [str(path) for path in evidence if not path.is_file()]
        if missing:
            raise RuntimeError('preset shot {} missing expansion evidence: {}'.format(shot_id, ', '.join(missing)))
        files.extend(evidence)
    files.extend(sorted(p for p in (root / 'preview').rglob('*') if p.is_file()))
    return files


def collect_candidate_outputs(root):
    root = Path(root)
    files = sorted((root / 'styleframes').glob('*.png')) + sorted(p for p in (root / 'preview').rglob('*') if p.is_file())
    if not files:
        raise RuntimeError('motion-broll did not return candidate images')
    return files


def dispatch(brief, output_root, model=None, executable=None, phase='keyframes-only'):
    if executable is None:
        try:
            from .editor_plan_runtime import codex_binary
        except ImportError:
            from editor_plan_runtime import codex_binary
        executable = codex_binary()
    try:
        from .codex_cli import exec_command as codex_exec_command
    except ImportError:
        from codex_cli import exec_command as codex_exec_command
    brief = Path(brief).resolve(strict=True)
    root = Path(output_root).resolve(strict=True)
    if root not in brief.parents:
        raise ValueError('brief must be inside outputRoot')
    if phase not in ('keyframes-only', 'candidates'):
        raise ValueError('invalid phase')
    shots_path=root/'shots.json'
    source_shots_sha = digest(shots_path)
    source_design = normalize_package_document(json.loads(shots_path.read_text(encoding='utf-8')))
    preset_ids = None
    if 'designIntentVersion' in source_design or any('designIntent' in shot for shot in source_design['shots']):
        definitions = list((VISUALIZATION_ROOT / 'docs' / 'presets').glob('*/preset.json'))
        if not definitions:
            raise ValueError('无法读取当前模板目录，不能验证设计候选')
        preset_ids = {json.loads(path.read_text(encoding='utf-8'))['id'] for path in definitions}
    validate_design_intents(source_design, requires_motion, preset_ids=preset_ids)
    design_sha=design_digest(source_design)
    if phase == 'keyframes-only' and list((root/'keyframes').glob('*.png')):
        raise ValueError('existing keyframes require a new outputRoot; do not mint receipts for old drafts')
    receipt_path = root / ('motion-execution-receipt.json' if phase == 'keyframes-only' else 'motion-candidates-receipt.json')
    # model=None uses config/codex.json (CODEX_MODEL / WORKBENCH_CODEX_MODEL override).
    command = codex_exec_command('--skip-git-repo-check', '--ephemeral',
               '-C', str(VISUALIZATION_ROOT), '--add-dir', str(root), approval='auto', binary=executable, model=model)
    phase_instruction = '只出候选，不做决定、不冻结合同。' if phase == 'candidates' else '执行 keyframes-only 阶段。'
    request_path = root / 'external-job.json'
    request_reference = '原始调用请求及用户要求：{}。'.format(request_path) if request_path.is_file() else ''
    command += ['调用 $motion-broll，读取需求单：{}。本次所有新产物写入：{}。{}'.format(brief, root, phase_instruction) + request_reference +
                '同目录 shots.json 为只读，不得修改任何字段或追加关键帧引用；返回视觉合同与关键帧，派发完成后由上游添加输出引用。']
    standard_path = Path(__file__).resolve().parent.parent / 'docs' / 'animation-design-standard.md'
    command[-1] += (f'读取 {standard_path}，执行效果优先原则：最佳效果主方案与可行模板方案可同批呈现；'
                    'presetCandidates 是比较候选，不是路线选择。继承上游批准的实现路线，不因命中 verified 模板而覆盖定制；'
                    '只制作本次已选方案，候选阶段不自动替用户选定或渲两套视频。')
    if source_design.get('soundDesignVersion') == 1:
        command[-1] += ('保留 shots.json 的 soundDesignVersion 和每镜 soundDesign；关键帧阶段只设计声音意图，'
                        '不得烧入音效；实际动画事件时刻独立回传供 broll 对齐可编辑音轨。')
    if source_design.get('designIntentVersion') == 1:
        command[-1] += ('读取同目录 shots.json，保留 designIntentVersion、每镜 designIntent、presetCandidates 和 selectedPreset；'
                        '将这些字段原样写入返回视觉合同，真实时点另存，不改批准设计。')
    receipt = {'version':1, 'state':'running', 'phase':phase, 'designSha256':design_sha, 'cwd':str(VISUALIZATION_ROOT), 'command':command,
               'briefPath':str(brief), 'briefSha256':digest(brief), 'outputRoot':str(root),
               'sourceShotsPath':str(shots_path), 'sourceShotsSha256':source_shots_sha,
               'exitCode':None, 'stdout':'', 'stderr':'', 'files':[]}
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
    try:
        result = subprocess.run(command, cwd=str(VISUALIZATION_ROOT), capture_output=True, text=True)
        receipt.update(exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr)
        if result.returncode != 0:
            raise RuntimeError('motion-broll process failed: {}'.format(result.returncode))
        if digest(brief) != receipt['briefSha256']:
            raise RuntimeError('motion-broll changed the source brief')
        if digest(shots_path) != source_shots_sha:
            raise RuntimeError('motion-broll changed the source shots file')
        if design_digest(json.loads(shots_path.read_text(encoding='utf-8'))) != design_sha:
            raise RuntimeError('motion-broll changed the approved storyboard')
        if phase == 'candidates':
            files = collect_candidate_outputs(root)
        else:
            files = collect_keyframe_outputs(root)
        receipt['files'] = [{'path':str(p), 'sha256':digest(p)} for p in files]
        preview_manifest = root / 'preview' / 'preview-manifest.json'
        if phase == 'keyframes-only' and preview_manifest.is_file():
            receipt['presetPreviewManifest'] = str(preview_manifest)
        receipt['state'] = 'waiting_selection' if phase == 'candidates' else 'succeeded'
    except BaseException as error:
        receipt.update(state='failed', error=str(error))
        raise
    finally:
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
    return receipt_path


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--brief', required=True)
    parser.add_argument('--output-root', required=True)
    parser.add_argument('--model')
    parser.add_argument('--phase',choices=['keyframes-only','candidates'],default='keyframes-only')
    args=parser.parse_args()
    print(dispatch(args.brief, args.output_root, args.model, phase=args.phase))
