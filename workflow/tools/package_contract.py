#!/usr/bin/env python3
"""Normalize and validate the canonical package shots contract."""

import argparse
import copy
import hashlib
import json
import os
import re
import tempfile
import unicodedata
from pathlib import Path

try:
    from .visual_design import validate_design_intents
    from .sound_design import validate_sound_design
except ImportError:
    from visual_design import validate_design_intents
    from sound_design import validate_sound_design


class PackageContractError(ValueError):
    """Raised when package shots cannot satisfy the canonical contract."""


FIELD_ALIASES = {
    "镜号": "id",
    "锚点口播": "anchor",
    "功能": "narrativeFunction",
    "形式": "form",
    "动作": "action",
    "理想画面": "ideal",
    "创意方案": "creative",
    "关键帧描述": "keyframeDescription",
    "切法": "transition",
    "估算时长意图": "durationIntent",
}


def normalize_package_document(document, source_srt_text=None):
    if not isinstance(document, dict):
        raise PackageContractError("shots.json 顶层必须是对象")
    shots = document.get("shots")
    if not isinstance(shots, list):
        raise PackageContractError("shots.json 缺少 shots 数组")

    normalized = copy.deepcopy(document)
    seen = set()
    source_transcript = _source_srt_transcript(source_srt_text) if source_srt_text is not None else None
    for index, shot in enumerate(normalized["shots"]):
        if not isinstance(shot, dict):
            raise PackageContractError("shots[{}] 必须是对象".format(index))
        for canonical, alias in FIELD_ALIASES.items():
            if _missing(shot.get(canonical)) and not _missing(shot.get(alias)):
                shot[canonical] = shot[alias]

        if _missing(shot.get("功能")) and not _missing(shot.get("叙事功能")):
            shot["功能"] = shot["叙事功能"]

        shot_number = shot.get("镜号")
        if not _valid_shot_number(shot_number):
            raise PackageContractError("shots[{}] 缺少有效镜号（支持 镜号 或 id）".format(index))
        identity = _shot_identity(shot_number)
        if identity in seen:
            raise PackageContractError("重复镜号 {}".format(shot_number))
        seen.add(identity)

        if not isinstance(shot.get("锚点口播"), str) or not shot["锚点口播"].strip():
            raise PackageContractError("镜号 {} 缺少有效锚点口播（支持 锚点口播 或 anchor）".format(shot_number))
        if source_transcript is not None and _normalize_speech(shot["锚点口播"]) not in source_transcript:
            raise PackageContractError(
                "镜号 {} 的锚点口播无法在 sourceSrtPath 中连续匹配；请改用实际字幕原文，不得改写口播".format(shot_number)
            )

    return normalized


# Canonical business checks from docs/broll-methodology.md §1/§1.5 and
# .devin/skills/content-package/SKILL.md §2. They live in this upstream only.
FUNCTIONS = {"解释", "证据", "具象", "隐喻", "情绪", "重置", "定场", "对位", "遮盖", "节奏"}
FORMS = {"✂️景别切", "✋录屏", "🤖动效", "🤖运镜", "🤖图库", "✋AI视频"}
ACTIONS = {"对比", "数字", "前后", "清单", "流程", "时间线", "增长", "偏离", "圈注", "定格", "实录", "意象"}
SOURCE_ROUTES = ["个人素材", "自己录屏/实拍", "官方页面/截图/公开影像", "自制动效/图表", "图库", "AI图/视频"]


def validate_package_design(document):
    document = normalize_package_document(document)
    try:
        validate_design_intents(document, requires_motion)
        validate_sound_design(document)
    except ValueError as error:
        raise PackageContractError(str(error)) from error
    if document.get("coverage") not in ("hybrid", "full"):
        raise PackageContractError("缺少有效 coverage")
    for shot in document["shots"]:
        identity = str(shot["镜号"])
        for field, values in (("功能", FUNCTIONS), ("形式", FORMS), ("动作", ACTIONS)):
            if shot.get(field) not in values:
                raise PackageContractError("镜号 {} 的{}不符合当前 package 判据".format(identity, field))
        for field in ("必要性", "理想画面", "创意方案"):
            if not isinstance(shot.get(field), str) or not shot[field].strip():
                raise PackageContractError("镜号 {} 缺少{}".format(identity, field))
        if document["coverage"] == "full" and (shot["形式"] == "✂️景别切" or shot.get("切法") in ("动作切", "景别切")):
            raise PackageContractError("full 不使用真人景别切或动作切")
        if "金句" in shot and type(shot["金句"]) is not bool:
            raise PackageContractError("金句必须是布尔值")
        if shot["形式"] == "✂️景别切":
            continue
        routing = shot.get("素材路由", {})
        route = routing.get("route") if isinstance(routing, dict) else None
        if route not in SOURCE_ROUTES:
            raise PackageContractError("镜号 {} 缺少有效素材路由".format(identity))
        if shot["功能"] == "证据" and (route not in SOURCE_ROUTES[:3] or shot["动作"] == "意象"):
            raise PackageContractError("镜号 {} 的证据不得使用虚构画面或图库".format(identity))
        for field in ("source", "status"):
            if not isinstance(routing.get(field), str) or not routing[field].strip():
                raise PackageContractError("镜号 {} 素材路由缺少 {}".format(identity, field))
        if routing["status"] not in ("available", "missing", "planned"):
            raise PackageContractError("镜号 {} 素材状态无效".format(identity))
        if routing["status"] == "missing" and not routing.get("acquisition", "").strip():
            raise PackageContractError("镜号 {} 缺失素材必须填写 acquisition".format(identity))
    return document


def requires_motion(shot):
    return shot.get("形式", shot.get("form")) in ("🤖动效", "🤖运镜") or shot.get("requiresPackaging") is True


def validate_handoff(document, stage="package"):
    """Readiness only; native receipt/output checks remain required for rendered work."""
    document = normalize_package_document(document)
    full = document.get("coverage") == "full"
    motion = [shot for shot in document["shots"] if requires_motion(shot)]
    skipped = document.get("skipKeyframes") is True
    if full and motion and skipped:
        raise PackageContractError("full 不能跳过关键帧")
    needs_contract = bool(motion)
    if needs_contract and stage == "package" and not full and (skipped or document.get("keyframeStatus") == "failed"):
        return {"renderReady": False, "requiresMotion": bool(motion), "reason": "文字方案完成；渲染前回 package 补合同与关键帧"}
    if needs_contract and not document.get("visual_contract"):
        raise PackageContractError("缺少视觉合同；回 package 补设计，不得声称渲染就绪")
    for shot in motion:
        if shot.get("形式") == "🤖运镜" and (not isinstance(shot.get("源图"), str) or not Path(shot["源图"]).is_absolute() or not Path(shot["源图"]).is_file()):
            raise PackageContractError("运镜缺少源图绝对路径，不能进入视觉生产")
    if needs_contract:
        visual_shots = motion
        contract_path = _handoff_artifact(document.get("visual_contract"), "视觉合同")
        try:
            contract = json.loads(contract_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ValueError) as error:
            raise PackageContractError("视觉合同无法解析: {}".format(error)) from error
        canvas = contract.get("canvas") if isinstance(contract, dict) else None
        contract_shots = contract.get("shots") if isinstance(contract, dict) else None
        if (not isinstance(contract, dict) or contract.get("version") != 1
                or not isinstance(canvas, dict)
                or any(type(canvas.get(k)) is not int or canvas[k] <= 0 or canvas[k] % 2 for k in ("width", "height"))
                or type(canvas.get("fps")) not in (int, float) or not 0 < canvas["fps"] < float("inf")
                or not isinstance(contract_shots, list) or not contract_shots
                or any(not isinstance(item, dict) or not _valid_shot_number(item.get("id")) for item in contract_shots)):
            raise PackageContractError("视觉合同基本结构无效；还须通过 visualization 原生完整校验")
        ids = [_shot_identity(item["id"]) for item in contract_shots]
        if len(set(ids)) != len(ids) or any(_shot_identity(shot["镜号"]) not in ids for shot in visual_shots):
            raise PackageContractError("视觉合同镜号重复或未覆盖需制作的镜头")
        validate_design_binding(document, contract)
        for shot in visual_shots:
            _handoff_artifact(shot.get("keyframe"), "关键帧")
    return {"renderReady": True, "requiresMotion": bool(motion)}


def _handoff_artifact(value, label):
    if not isinstance(value, str) or not value.strip():
        raise PackageContractError("缺少{}；回 package 补设计".format(label))
    path = Path(value)
    try:
        valid = path.is_absolute() and path.is_file() and path.stat().st_size > 0
    except OSError:
        valid = False
    if not valid:
        raise PackageContractError("{}必须是实际存在的非空文件绝对路径".format(label))
    return path


def design_digest(document):
    normalized = normalize_package_document(document)
    # Preserve old receipts only for genuinely old documents. Presence (even
    # false/null) of every restored field is approval-significant.
    fields = ["镜号", "锚点口播", "功能", "形式", "动作", "理想画面", "创意方案", "必要性", "素材路由", "切法"]
    restored_fields = ["金句", "声音意图", "presentationMode", "presentationReason", "源图",
                       "requiresPackaging", "保留真人", "需要Broll", "屏幕文字", "关键数字", "deletedContent",
                       "关键帧描述", "焦点", "首尾锚点", "定帧时刻", "startAnchor", "endAnchor", "keyframeMoment",
                       "focus", "估算时长意图", "时长意图_估", "designIntent", "effectTiming", "cameraIntent", "presenterLayerIntent", "soundDesign", "deletedPlanningFields"]
    shots = []
    for shot in normalized["shots"]:
        content = {field: shot.get(field) for field in fields}
        content.update({field: shot[field] for field in restored_fields if field in shot})
        if 'designIntentVersion' in normalized or 'designIntent' in shot:
            content.update({field: shot[field] for field in
                            ('presetCandidates', 'selectedPreset', 'matchReason', 'unmatchedReason') if field in shot})
        routing = content.get("素材路由")
        if isinstance(routing, dict):
            content["素材路由"] = {key:value for key,value in routing.items() if key not in ("status", "acquisition", "acquiredPath", "acquiredSha256")}
        shots.append(content)
    business = {"coverage": normalized.get("coverage"), "shots":shots,
                **{key: normalized[key] for key in ("motionBudgetOverride", "skipKeyframes", "声音意图", "deletedContent", "designIntentVersion", "soundDesignVersion") if key in normalized}}
    return hashlib.sha256(json.dumps(business, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def validate_design_binding(document, contract):
    """A downstream renderer may resolve timing, but cannot replace approved design."""
    document = normalize_package_document(document)
    try:
        validate_design_intents(document, requires_motion)
        validate_sound_design(document)
    except ValueError as error:
        raise PackageContractError(str(error)) from error
    if 'designIntentVersion' not in document:
        return
    if not isinstance(contract, dict) or type(contract.get('designIntentVersion')) is not int or contract['designIntentVersion'] != 1:
        raise PackageContractError('返回合同缺少 designIntentVersion: 1')
    returned = contract.get('shots')
    if not isinstance(returned, list):
        raise PackageContractError('返回合同 designIntent 缺少镜头数组')
    indexed = {}
    for shot in returned:
        if not isinstance(shot, dict) or not _valid_shot_number(shot.get('id')):
            raise PackageContractError('返回合同 designIntent 镜号无效')
        identity = _shot_identity(shot['id'])
        if identity in indexed:
            raise PackageContractError('返回合同 designIntent 镜号重复')
        indexed[identity] = shot
    for shot in document['shots']:
        if 'designIntent' not in shot:
            continue
        identity = _shot_identity(shot['镜号'])
        target = indexed.get(identity)
        if target is None:
            raise PackageContractError(f'{identity} 返回合同缺少 designIntent 镜头')
        for field in ('designIntent', 'presetCandidates', 'selectedPreset'):
            if field not in target or target[field] != shot[field]:
                raise PackageContractError(f'{identity} 返回合同 {field} 与批准的 designIntent 不一致')
        # Bind the actual renderer route as well as the authored design prose.
        # A viable candidate is not permission to replace approved custom work.
        route = shot['designIntent']['recommendation']['route']
        implementation = target.get('preset')
        if route == 'preset':
            if not isinstance(implementation, dict) or implementation.get('id') != shot['selectedPreset']:
                raise PackageContractError(f'{identity} 返回合同实际 preset 与批准的 selectedPreset 不一致')
        elif implementation is not None:
            raise PackageContractError(f'{identity} 已批准定制路线，返回合同不能挂实际 preset')


def requires_keyframe(shot):
    mode = str(shot.get("presentationMode", "")).strip().lower()
    if mode in ("talking-head", "talking_head", "真人", "真人保留"):
        return False
    form = shot.get("形式", shot.get("form"))
    # A shared presentation annotation does not turn pure person footage into
    # an animation. Explicit non-motion form precedes the overlay annotation.
    if form in FORMS and not requires_motion(shot):
        return False
    # Retaining the person is the purpose of a visible animation overlay, not
    # evidence that no B-roll exists. The legacy boolean cannot negate it.
    if mode == "overlay":
        return True
    if shot.get("保留真人") is True and not shot.get("需要Broll"):
        return False
    return True


def required_keyframe_shots(document):
    normalized = normalize_package_document(document)
    return [shot for shot in normalized["shots"] if requires_keyframe(shot)]


def validate_motion_receipt(receipt_path, shots_path):
    root = Path(shots_path).resolve().parent
    receipt_path = Path(receipt_path).resolve()
    if receipt_path.parent != root:
        raise PackageContractError("motion receipt 必须位于 packageRoot")
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        command = receipt["command"]
        expected_cwd = str(Path(os.environ.get("VISUALIZATION_ROOT", Path(__file__).resolve().parents[2] / "studio")).resolve())
        if (receipt.get("state") != "succeeded" or receipt.get("exitCode") != 0
                or receipt.get("cwd") != expected_cwd or not isinstance(command, list)
                or len(command) < 3 or command[1] != "exec" or "-C" not in command
                or command[command.index("-C") + 1] != expected_cwd
                or not command[-1].startswith("调用 $motion-broll，")):
            raise ValueError("无成功的原生 motion-broll 调用")
        brief = Path(receipt["briefPath"]).resolve()
        if brief.parent != root or hashlib.sha256(brief.read_bytes()).hexdigest() != receipt["briefSha256"]:
            raise ValueError("需求单哈希不一致")
        files = receipt["files"]
        paths = set()
        file_sha = {}
        for item in files:
            p = Path(item["path"]).resolve()
            if root not in p.parents or hashlib.sha256(p.read_bytes()).hexdigest() != item["sha256"]:
                raise ValueError("派发产物路径或哈希不一致")
            paths.add(str(p))
            file_sha[str(p)] = item["sha256"]
        shots = json.loads(Path(shots_path).read_text(encoding="utf-8"))
        if receipt.get("phase") != "keyframes-only" or receipt.get("designSha256") != design_digest(shots):
            raise ValueError("派发阶段或分镜设计摘要不一致")
        if Path(shots.get("visual_contract", "")).resolve() != root / "visual-contract.json":
            raise ValueError("分镜引用了其他视觉合同")
        required = [str(root / "visual-contract.json")]
        for shot in required_keyframe_shots(shots):
            keyframe = shot.get("keyframe")
            if not isinstance(keyframe, str) or not keyframe.strip():
                raise ValueError("需制作 B-roll 的镜头缺少关键帧路径: {}".format(shot["镜号"]))
            required.append(str(Path(keyframe).resolve()))
        contract = json.loads((root / "visual-contract.json").read_text(encoding="utf-8"))
        validate_design_binding(shots, contract)
        preset_contract_shots = []
        for shot in contract.get("shots", []):
            if not isinstance(shot, dict) or not shot.get("preset"):
                continue
            preset_contract_shots.append(shot)
            shot_id = shot.get("id")
            for name in ("props.json", "route.json", "signals.json"):
                required.append(str(root / "shots" / str(shot_id) / name))
        if not set(required).issubset(paths):
            missing = sorted(set(required) - paths)
            if any("/shots/" in path for path in missing):
                raise ValueError("preset 展开证据没有原生派发记录: {}".format(", ".join(missing)))
            raise ValueError("关键帧/合同没有原生派发证据")
        if preset_contract_shots:
            manifest_path = Path(str(receipt.get("presetPreviewManifest", ""))).resolve()
            if manifest_path != root / "preview" / "preview-manifest.json":
                raise ValueError("preset preview 绑定缺少原生 manifest")
            if str(manifest_path) not in paths:
                raise ValueError("preset preview 绑定 manifest 没有原生派发记录")
            _validate_preset_preview_binding(
                root=root,
                manifest_path=manifest_path,
                contract_shots=preset_contract_shots,
                package_shots=shots,
                file_sha=file_sha,
            )
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        raise PackageContractError("motion-broll 派发证据无效: {}".format(error)) from error


def _validate_preset_preview_binding(root, manifest_path, contract_shots, package_shots, file_sha):
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("preset preview 绑定 manifest 无法读取: {}".format(error)) from error
    if manifest.get("version") != 2 or not isinstance(manifest.get("tiles"), list):
        raise ValueError("preset preview 绑定 manifest 必须是 version 2 且包含 tiles")
    if str(manifest_path) not in file_sha:
        raise ValueError("preset preview 绑定 manifest 没有原生派发记录")

    keyframes = {}
    for shot in required_keyframe_shots(package_shots):
        identity = _shot_identity(shot["镜号"])
        keyframe = Path(shot["keyframe"]).resolve() if isinstance(shot.get("keyframe"), str) else None
        if keyframe:
            keyframes[identity] = keyframe

    tiles = manifest["tiles"]
    for shot in contract_shots:
        shot_id = str(shot.get("id", "")).strip()
        identity = _shot_identity(shot_id)
        keyframe = keyframes.get(identity)
        if keyframe is None:
            raise ValueError("preset preview 绑定找不到关键帧: {}".format(shot_id))
        matches = [tile for tile in tiles if isinstance(tile, dict) and tile.get("shot") == shot_id and tile.get("kind") == "selected"]
        if len(matches) != 1:
            raise ValueError("preset preview 绑定必须为 {} 保留唯一 selected tile".format(shot_id))
        tile = matches[0]
        preset = shot.get("preset") if isinstance(shot.get("preset"), dict) else {}
        expected_props = root / "shots" / shot_id / "props.json"
        expected_route = root / "shots" / shot_id / "route.json"
        expected_signals = root / "shots" / shot_id / "signals.json"
        still = Path(str(tile.get("still", ""))).resolve()
        checks = {
            "props": (expected_props, tile.get("propsSha256")),
            "route": (expected_route, tile.get("routeSha256")),
            "signals": (expected_signals, tile.get("signalsSha256")),
            "still": (still, tile.get("stillSha256")),
            "keyframe": (keyframe, tile.get("stillSha256")),
        }
        if tile.get("preset") != preset.get("id") or tile.get("version") != preset.get("version"):
            raise ValueError("preset preview 绑定的 preset/version 与合同不一致: {}".format(shot_id))
        if Path(str(tile.get("props", ""))).resolve() != expected_props:
            raise ValueError("preset preview 绑定 props 路径不一致: {}".format(shot_id))
        if Path(str(tile.get("route", ""))).resolve() != expected_route:
            raise ValueError("preset preview 绑定 route 路径不一致: {}".format(shot_id))
        if Path(str(tile.get("signals", ""))).resolve() != expected_signals:
            raise ValueError("preset preview 绑定 signals 路径不一致: {}".format(shot_id))
        if str(still) not in file_sha:
            raise ValueError("preset preview 绑定 still 没有原生派发记录: {}".format(shot_id))
        if str(keyframe) not in file_sha:
            raise ValueError("preset preview 绑定 keyframe 没有原生派发记录: {}".format(shot_id))
        for label, (path, expected_sha) in checks.items():
            if not isinstance(expected_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_sha):
                raise ValueError("preset preview 绑定缺少 {} sha256: {}".format(label, shot_id))
            actual_sha = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual_sha != expected_sha:
                raise ValueError("preset preview 绑定 {} sha256 不一致: {}".format(label, shot_id))
        render = tile.get("render")
        command = render.get("command") if isinstance(render, dict) else None
        frame_arg = "--frame={}".format(tile.get("frame"))
        scale_arg = "--scale={}".format(tile.get("scale", 0.4))
        command_ok = (
            isinstance(command, list)
            and len(command) >= 7
            and command[:4] == ["npx", "remotion", "still", tile.get("compositionId")]
            and any(isinstance(arg, str) and arg.startswith("--props=") and Path(arg[len("--props="):]).resolve() == expected_props for arg in command)
            and frame_arg in command
            and scale_arg in command
            and Path(str(command[-1])).resolve() == still
        )
        if (not isinstance(render, dict) or render.get("status") != "passed" or render.get("exitCode") != 0
                or not command_ok
                or Path(str(render.get("expectedOutput", ""))).resolve() != still):
            raise ValueError("preset preview 绑定缺少成功 Remotion still 回执: {}".format(shot_id))


def normalize_file(shots_path, source_srt_path=None):
    path = Path(shots_path).resolve()
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PackageContractError("无法读取 shots.json {}: {}".format(path, error)) from error
    source_srt_text = None
    if source_srt_path:
        source_path = Path(source_srt_path).resolve()
        try:
            source_srt_text = source_path.read_text(encoding="utf-8-sig")
        except OSError as error:
            raise PackageContractError("无法读取 sourceSrtPath {}: {}".format(source_path, error)) from error
    normalized = normalize_package_document(document, source_srt_text=source_srt_text)
    body = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    temporary_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=str(path.parent),
            prefix=".{}-".format(path.name), suffix=".tmp", delete=False,
        ) as temporary:
            temporary.write(body)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_name = temporary.name
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return normalized


def _missing(value):
    return value is None or (isinstance(value, str) and not value.strip())


def _valid_shot_number(value):
    return (
        isinstance(value, str) and bool(value.strip())
    ) or (
        isinstance(value, (int, float)) and not isinstance(value, bool)
        and value == value and value not in (float("inf"), float("-inf"))
    )


def _shot_identity(value):
    if isinstance(value, (int, float)) and value == int(value):
        return "shot-{:03d}".format(int(value))
    text = str(value).strip().lower()
    if text.isdigit():
        return "shot-{:03d}".format(int(text))
    if text.startswith("shot-") and text[5:].isdigit():
        return "shot-{:03d}".format(int(text[5:]))
    return text


def _source_srt_transcript(source_srt_text):
    lines = []
    for raw_line in source_srt_text.splitlines():
        line = raw_line.strip()
        if not line or line.isdigit() or "-->" in line:
            continue
        lines.append(re.sub(r"<[^>]+>", "", line))
    transcript = _normalize_speech("".join(lines))
    if not transcript:
        raise PackageContractError("sourceSrtPath 没有可匹配的字幕正文")
    return transcript


def _normalize_speech(value):
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(
        character for character in normalized
        if not character.isspace() and not unicodedata.category(character).startswith("P")
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    normalize = subparsers.add_parser("normalize", help="normalize and validate a shots.json file")
    normalize.add_argument("--shots", required=True)
    normalize.add_argument("--source-srt")
    validate = subparsers.add_parser("validate", help="read-only package business contract validation")
    validate.add_argument("--shots", required=True)
    validate.add_argument("--source-srt")
    validate.add_argument("--motion-receipt")
    validate.add_argument("--approved-shots")
    validate.add_argument("--stage", choices=("design", "package", "broll"), default="design")
    args = parser.parse_args(argv)
    readiness = None
    try:
        if args.command == "validate":
            raw = json.loads(Path(args.shots).read_text(encoding="utf-8"))
            source = Path(args.source_srt).read_text(encoding="utf-8-sig") if args.source_srt else None
            document = validate_package_design(normalize_package_document(raw, source))
            if args.approved_shots:
                approved = json.loads(Path(args.approved_shots).read_text(encoding="utf-8"))
                if design_digest(approved) != design_digest(document):
                    raise PackageContractError("分镜内容与用户批准版本不一致，必须重新审批")
            readiness = validate_handoff(document, args.stage) if args.stage != "design" else None
            if args.motion_receipt and document["shots"]:
                validate_motion_receipt(args.motion_receipt, args.shots)
        else:
            document = normalize_file(args.shots, source_srt_path=args.source_srt)
    except PackageContractError as error:
        parser.exit(1, "package contract invalid: {}\n".format(error))
    result = {"shotsPath": str(Path(args.shots).resolve()), "shotCount": len(document["shots"])}
    if readiness is not None:
        result.update(readiness)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
