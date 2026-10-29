import tempfile
import unittest
from pathlib import Path
import hashlib
import json
import subprocess
import sys

from tools.package_contract import (
    PackageContractError,
    normalize_package_document,
    required_keyframe_shots,
    validate_motion_receipt,
    validate_package_design,
)


class PackageContractTests(unittest.TestCase):
    def test_planned_effect_and_camera_presence_are_approval_significant(self):
        from tools.package_contract import design_digest
        import copy
        old = {"coverage": "hybrid", "shots": [{"镜号": 1, "锚点口播": "原文"}]}
        for field in ("effectTiming", "cameraIntent", "presenterLayerIntent", "soundDesign"):
            changed = copy.deepcopy(old); changed["shots"][0][field] = None
            self.assertNotEqual(design_digest(old), design_digest(changed))
            changed["shots"][0][field] = {"purpose": "表达"}
            original = copy.deepcopy(changed); changed["shots"][0][field]["purpose"] = "新的表达"
            self.assertNotEqual(design_digest(original), design_digest(changed))

    @unittest.skip("Legacy writing precheck is outside the editing distribution")
    def test_legacy_precheck_has_no_imagery_count_or_gold_freeze_gate(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "script.md"
            path.write_text("## 口播正文\n\n原文。\n> 🎬【解释 · 🤖动效 · 意象】关系一\n> ⭐【金句】\n\n第二句。\n> 🎬【隐喻 · 🤖动效 · 意象】关系二\n")
            tool = Path(__file__).resolve().parents[1] / "tools" / "precheck.py"
            result = subprocess.run([sys.executable, str(tool), str(path), "--duration", "5"], capture_output=True, text=True)
            issues = json.loads(result.stdout)["issues"]
            self.assertFalse(any(i["type"] == "cue-imagery" for i in issues), issues)
            self.assertFalse(any("重音靠减法" in i["detail"] for i in issues), issues)

    def test_effect_first_design_has_no_count_gold_or_route_ranking_gate(self):
        def shot(i):
            return {"镜号": i, "锚点口播": "真实原文", "功能": "解释", "形式": "🤖动效",
                    "动作": "意象", "金句": True, "必要性": "解释关系", "理想画面": "抽象关系运动",
                    "创意方案": "关键词在人物后方移动", "素材路由": {"route": "自制动效/图表", "source": "设计图形", "status": "planned"}}
        for coverage in ("hybrid", "full"):
            result = validate_package_design({"coverage": coverage, "shots": [shot(i) for i in range(1, 6)]})
            self.assertEqual(len(result["shots"]), 5)
        invalid = shot(1); invalid["功能"] = "证据"
        with self.assertRaisesRegex(PackageContractError, "证据不得"):
            validate_package_design({"coverage": "hybrid", "shots": [invalid]})
        invalid = shot(1); invalid["素材路由"].pop("source")
        with self.assertRaisesRegex(PackageContractError, "source"):
            validate_package_design({"coverage": "hybrid", "shots": [invalid]})

    def test_normalizes_observed_english_shot_fields(self):
        source = {
            "脚本id": "external-run",
            "shots": [{
                "id": "shot-001",
                "anchor": "第一句。\n第二句。",
                "narrativeFunction": "解释",
                "form": "transparent overlay",
                "action": "清单",
                "ideal": "右侧逐项列出内容。",
                "creative": "保留人物主导。",
            }],
        }

        normalized = normalize_package_document(source)

        self.assertEqual(normalized["shots"][0]["镜号"], "shot-001")
        self.assertEqual(normalized["shots"][0]["锚点口播"], "第一句。\n第二句。")
        self.assertEqual(normalized["shots"][0]["功能"], "解释")
        self.assertEqual(normalized["shots"][0]["形式"], "transparent overlay")
        self.assertEqual(normalized["shots"][0]["动作"], "清单")
        self.assertEqual(normalized["shots"][0]["理想画面"], "右侧逐项列出内容。")
        self.assertEqual(normalized["shots"][0]["创意方案"], "保留人物主导。")
        self.assertEqual(source["shots"][0]["id"], "shot-001")
        self.assertNotIn("镜号", source["shots"][0])

    def test_preserves_canonical_fields_and_extra_metadata(self):
        source = {
            "coverage": "hybrid",
            "shots": [{
                "镜号": 3,
                "锚点口播": "原句。",
                "功能": "解释",
                "keyframe": "/tmp/shot-003.png",
            }],
        }

        normalized = normalize_package_document(source)

        self.assertEqual(normalized, source)
        self.assertIsNot(normalized, source)

    def test_rejects_duplicate_shot_ids(self):
        with self.assertRaisesRegex(PackageContractError, "重复镜号 shot-001"):
            normalize_package_document({
                "shots": [
                    {"id": "shot-001", "anchor": "第一句。"},
                    {"镜号": "shot-001", "锚点口播": "第二句。"},
                ],
            })

    def test_rejects_missing_shot_id_with_position(self):
        with self.assertRaisesRegex(PackageContractError, r"shots\[0\].*镜号"):
            normalize_package_document({"shots": [{"anchor": "第一句。"}]})

    def test_rejects_missing_anchor_with_shot_id(self):
        with self.assertRaisesRegex(PackageContractError, "shot-002.*锚点口播"):
            normalize_package_document({"shots": [{"id": "shot-002", "anchor": "  "}]})

    def test_accepts_anchor_copied_from_contiguous_source_srt_cues(self):
        source_srt = """1
00:00:00,000 --> 00:00:02,000
不是因为AI现在已经全能一键出片

2
00:00:02,000 --> 00:00:05,000
而是它可以把最浪费我们的时间的杂货给搞定
"""

        normalized = normalize_package_document({
            "shots": [{
                "镜号": "shot-001",
                "锚点口播": "不是因为 AI 现在已经全能一键出片，而是它可以把最浪费我们的时间的杂货给搞定",
            }],
        }, source_srt_text=source_srt)

        self.assertEqual(normalized["shots"][0]["镜号"], "shot-001")

    def test_rejects_paraphrased_anchor_that_cannot_map_to_source_srt(self):
        source_srt = """1
00:00:00,000 --> 00:00:02,000
不是因为AI现在已经全能一键出片

2
00:00:02,000 --> 00:00:05,000
而是它可以把最浪费我们的时间的杂货给搞定
"""

        with self.assertRaisesRegex(PackageContractError, "shot-001.*sourceSrtPath"):
            normalize_package_document({
                "shots": [{
                    "镜号": "shot-001",
                    "锚点口播": "不是因为 AI 已经可以做到全能一键出片，而是他可以把最耗费时间精力的杂活给做了。",
                }],
            }, source_srt_text=source_srt)

    def test_required_keyframe_shots_excludes_talking_head_context(self):
        document = {
            "shots": [
                {"镜号": "shot-001", "锚点口播": "真人段", "presentationMode": "talking-head"},
                {"镜号": "shot-002", "锚点口播": "叠层段", "presentationMode": "overlay"},
                {"镜号": "shot-003", "锚点口播": "插片段", "presentationMode": "immersive"},
            ],
        }

        self.assertEqual(
            [shot["镜号"] for shot in required_keyframe_shots(document)],
            ["shot-002", "shot-003"],
        )

    def test_overlay_keeping_person_requires_keyframe_without_broll_boolean(self):
        shots = [{"镜号": "talk", "锚点口播": "纯真人", "presentationMode": "talking-head", "保留真人": True}]
        for index, flag in enumerate((None, False, True)):
            shot = {"镜号": "overlay-%s" % index, "锚点口播": "透明标签", "presentationMode": "overlay", "形式": "🤖动效", "保留真人": True}
            if flag is not None:
                shot["需要Broll"] = flag
            shots.append(shot)
        self.assertEqual([s["镜号"] for s in required_keyframe_shots({"shots": shots})], ["overlay-0", "overlay-1", "overlay-2"])

    def test_explicit_nonmotion_person_shot_overrides_overlay_annotation(self):
        document = {"shots": [
            {"镜号": "person", "锚点口播": "真人收束", "形式": "✂️景别切", "presentationMode": "overlay", "是否B-roll": False, "保留真人": True},
            {"镜号": "label", "锚点口播": "透明标签", "形式": "🤖动效", "presentationMode": "overlay", "是否B-roll": True, "保留真人": True},
            {"镜号": "packaged-screen", "锚点口播": "录屏包装", "形式": "✋录屏", "requiresPackaging": True, "presentationMode": "overlay", "保留真人": True},
        ]}
        self.assertEqual([s["镜号"] for s in required_keyframe_shots(document)], ["label", "packaged-screen"])

    def test_motion_receipt_allows_talking_head_without_keyframe_but_requires_visual_shots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contract = root / "visual-contract.json"
            kf = root / "keyframes" / "shot-002.png"
            kf.parent.mkdir()
            contract.write_text("{}", encoding="utf-8")
            kf.write_bytes(b"png")
            brief = root / "keyframe-brief.md"
            brief.write_text("brief", encoding="utf-8")
            shots = root / "shots.json"
            shots.write_text("""{
  "coverage": "hybrid",
  "visual_contract": "%s",
  "shots": [
    {
      "镜号": "shot-001",
      "锚点口播": "真人段",
      "功能": "节奏",
      "形式": "✂️景别切",
      "动作": "定格",
      "必要性": "保留真人建立信任。",
      "理想画面": "人物正脸。",
      "创意方案": "不做 B-roll。",
      "素材路由": {},
      "切法": "无",
      "presentationMode": "talking-head",
      "keyframe": ""
    },
    {
      "镜号": "shot-002",
      "锚点口播": "叠层段",
      "功能": "解释",
      "形式": "🤖动效",
      "动作": "清单",
      "必要性": "需要把抽象点列出来。",
      "理想画面": "右侧清单。",
      "创意方案": "透明叠层。",
      "素材路由": {
        "route": "自制动效/图表",
        "source": "自制",
        "status": "planned",
        "higherPriority": {
          "个人素材": "无个人素材",
          "自己录屏/实拍": "不需要实拍",
          "官方页面/截图/公开影像": "不是证据镜"
        }
      },
      "切法": "匹配切",
      "presentationMode": "overlay",
      "keyframe": "%s"
    }
  ]
}
""" % (contract, kf), encoding="utf-8")
            receipt = root / "motion-execution-receipt.json"
            import hashlib

            def sha(path):
                return hashlib.sha256(Path(path).read_bytes()).hexdigest()

            receipt.write_text("""{
  "version": 1,
  "state": "succeeded",
  "phase": "keyframes-only",
  "designSha256": "%s",
  "cwd": "%s",
  "command": ["codex", "exec", "-C", "%s", "调用 $motion-broll，读取需求单：brief。"],
  "briefPath": "%s",
  "briefSha256": "%s",
  "outputRoot": "%s",
  "exitCode": 0,
  "files": [
    {"path": "%s", "sha256": "%s"},
    {"path": "%s", "sha256": "%s"}
  ]
}
""" % (
                __import__("tools.package_contract", fromlist=["design_digest"]).design_digest(
                    __import__("json").loads(shots.read_text(encoding="utf-8"))
                ),
                Path("../studio").resolve(),
                Path("../studio").resolve(),
                brief,
                sha(brief),
                root,
                contract,
                sha(contract),
                kf,
                sha(kf),
            ), encoding="utf-8")

            validate_motion_receipt(receipt, shots)

    def test_motion_receipt_rejects_preset_shot_without_expansion_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contract = root / "visual-contract.json"
            kf = root / "keyframes" / "shot-001.png"
            kf.parent.mkdir()
            contract.write_text('{"shots":[{"id":"shot-001","preset":{"id":"chapter-navigation","version":1}}]}', encoding="utf-8")
            kf.write_bytes(b"png")
            brief = root / "keyframe-brief.md"
            brief.write_text("brief", encoding="utf-8")
            shots = root / "shots.json"
            shots.write_text("""{
  "coverage": "hybrid",
  "visual_contract": "%s",
  "shots": [{
    "镜号": "shot-001",
    "锚点口播": "导航段",
    "功能": "解释",
    "形式": "🤖动效",
    "动作": "清单",
    "必要性": "需要导航。",
    "理想画面": "章节导航。",
    "创意方案": "模板导航。",
    "素材路由": {
      "route": "自制动效/图表",
      "source": "自制",
      "status": "planned",
      "higherPriority": {
        "个人素材": "无个人素材",
        "自己录屏/实拍": "不需要实拍",
        "官方页面/截图/公开影像": "不是证据镜"
      }
    },
    "切法": "硬切",
    "presentationMode": "overlay",
    "keyframe": "%s"
  }]
}
""" % (contract, kf), encoding="utf-8")
            import hashlib, json

            def sha(path):
                return hashlib.sha256(Path(path).read_bytes()).hexdigest()

            receipt = root / "motion-execution-receipt.json"
            receipt.write_text(json.dumps({
                "version": 1,
                "state": "succeeded",
                "phase": "keyframes-only",
                "designSha256": __import__("tools.package_contract", fromlist=["design_digest"]).design_digest(
                    json.loads(shots.read_text(encoding="utf-8"))
                ),
                "cwd": str(Path("../studio").resolve()),
                "command": ["codex", "exec", "-C", str(Path("../studio").resolve()), "调用 $motion-broll，读取需求单：brief。"],
                "briefPath": str(brief),
                "briefSha256": sha(brief),
                "outputRoot": str(root),
                "exitCode": 0,
                "files": [
                    {"path": str(contract), "sha256": sha(contract)},
                    {"path": str(kf), "sha256": sha(kf)}
                ]
            }), encoding="utf-8")

            with self.assertRaisesRegex(PackageContractError, "preset.*证据"):
                validate_motion_receipt(receipt, shots)

    def test_motion_receipt_rejects_preset_keyframe_without_preview_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contract = root / "visual-contract.json"
            kf = root / "keyframes" / "shot-001.png"
            shot_dir = root / "shots" / "shot-001"
            kf.parent.mkdir()
            shot_dir.mkdir(parents=True)
            contract.write_text('{"shots":[{"id":"shot-001","preset":{"id":"recede","version":2}}]}', encoding="utf-8")
            kf.write_bytes(b"hand drawn")
            (shot_dir / "props.json").write_text('{"presetId":"recede","presetVersion":2,"compositionId":"PresetRecede"}', encoding="utf-8")
            (shot_dir / "route.json").write_text('{"engine":"remotion"}', encoding="utf-8")
            (shot_dir / "signals.json").write_text('{"framePrecision":2}', encoding="utf-8")
            brief = root / "keyframe-brief.md"
            brief.write_text("brief", encoding="utf-8")
            shots = self._write_single_preset_shots(root, contract, kf)

            def sha(path):
                return hashlib.sha256(Path(path).read_bytes()).hexdigest()

            receipt = root / "motion-execution-receipt.json"
            receipt.write_text(json.dumps({
                "version": 1,
                "state": "succeeded",
                "phase": "keyframes-only",
                "designSha256": __import__("tools.package_contract", fromlist=["design_digest"]).design_digest(
                    json.loads(shots.read_text(encoding="utf-8"))
                ),
                "cwd": str(Path("../studio").resolve()),
                "command": ["codex", "exec", "-C", str(Path("../studio").resolve()), "调用 $motion-broll，读取需求单：brief。"],
                "briefPath": str(brief),
                "briefSha256": sha(brief),
                "outputRoot": str(root),
                "exitCode": 0,
                "files": [
                    {"path": str(contract), "sha256": sha(contract)},
                    {"path": str(kf), "sha256": sha(kf)},
                    {"path": str(shot_dir / "props.json"), "sha256": sha(shot_dir / "props.json")},
                    {"path": str(shot_dir / "route.json"), "sha256": sha(shot_dir / "route.json")},
                    {"path": str(shot_dir / "signals.json"), "sha256": sha(shot_dir / "signals.json")},
                ],
            }), encoding="utf-8")

            with self.assertRaisesRegex(PackageContractError, "preset preview.*绑定"):
                validate_motion_receipt(receipt, shots)

    def test_motion_receipt_accepts_preset_keyframe_bound_to_preview_still(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contract = root / "visual-contract.json"
            kf = root / "keyframes" / "shot-001.png"
            shot_dir = root / "shots" / "shot-001"
            preview_dir = root / "preview" / "stills"
            kf.parent.mkdir()
            shot_dir.mkdir(parents=True)
            preview_dir.mkdir(parents=True)
            contract.write_text('{"shots":[{"id":"shot-001","preset":{"id":"recede","version":2}}]}', encoding="utf-8")
            kf.write_bytes(b"remotion still")
            props = shot_dir / "props.json"
            route = shot_dir / "route.json"
            signals = shot_dir / "signals.json"
            still = preview_dir / "shot-001.png"
            props.write_text('{"presetId":"recede","presetVersion":2,"compositionId":"PresetRecede"}', encoding="utf-8")
            route.write_text('{"engine":"remotion"}', encoding="utf-8")
            signals.write_text('{"framePrecision":2}', encoding="utf-8")
            still.write_bytes(kf.read_bytes())
            manifest = root / "preview" / "preview-manifest.json"

            def sha(path):
                return hashlib.sha256(Path(path).read_bytes()).hexdigest()

            manifest.write_text(json.dumps({
                "version": 2,
                "tiles": [{
                    "shot": "shot-001",
                    "kind": "selected",
                    "preset": "recede",
                    "version": 2,
                    "compositionId": "PresetRecede",
                    "frame": 36,
                    "props": str(props),
                    "route": str(route),
                    "signals": str(signals),
                    "still": str(still),
                    "propsSha256": sha(props),
                    "routeSha256": sha(route),
                    "signalsSha256": sha(signals),
                    "stillSha256": sha(still),
                    "render": {
                        "status": "passed",
                        "exitCode": 0,
                        "command": ["npx", "remotion", "still", "PresetRecede", "--props={}".format(props), "--frame=36", "--scale=0.4", str(still)],
                        "expectedOutput": str(still),
                        "outputBytes": len(still.read_bytes()),
                    },
                }],
            }), encoding="utf-8")
            brief = root / "keyframe-brief.md"
            brief.write_text("brief", encoding="utf-8")
            shots = self._write_single_preset_shots(root, contract, kf)
            receipt = root / "motion-execution-receipt.json"
            files = [contract, kf, props, route, signals, manifest, still]
            receipt.write_text(json.dumps({
                "version": 1,
                "state": "succeeded",
                "phase": "keyframes-only",
                "designSha256": __import__("tools.package_contract", fromlist=["design_digest"]).design_digest(
                    json.loads(shots.read_text(encoding="utf-8"))
                ),
                "cwd": str(Path("../studio").resolve()),
                "command": ["codex", "exec", "-C", str(Path("../studio").resolve()), "调用 $motion-broll，读取需求单：brief。"],
                "briefPath": str(brief),
                "briefSha256": sha(brief),
                "outputRoot": str(root),
                "exitCode": 0,
                "presetPreviewManifest": str(manifest),
                "files": [{"path": str(path), "sha256": sha(path)} for path in files],
            }), encoding="utf-8")

            validate_motion_receipt(receipt, shots)

    def _write_single_preset_shots(self, root, contract, keyframe):
        shots = root / "shots.json"
        shots.write_text("""{
  "coverage": "hybrid",
  "visual_contract": "%s",
  "shots": [{
    "镜号": "shot-001",
    "锚点口播": "模板段",
    "功能": "解释",
    "形式": "🤖动效",
    "动作": "清单",
    "必要性": "需要模板画面。",
    "理想画面": "模板画面。",
    "创意方案": "使用 preset。",
    "素材路由": {
      "route": "自制动效/图表",
      "source": "自制",
      "status": "planned",
      "higherPriority": {
        "个人素材": "无个人素材",
        "自己录屏/实拍": "不需要实拍",
        "官方页面/截图/公开影像": "不是证据镜"
      }
    },
    "切法": "硬切",
    "presentationMode": "overlay",
    "keyframe": "%s"
  }]
}
""" % (contract, keyframe), encoding="utf-8")
        return shots


if __name__ == "__main__":
    unittest.main()
