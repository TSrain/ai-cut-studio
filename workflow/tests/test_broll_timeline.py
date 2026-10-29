"""tools/broll_timeline.py 的对齐逻辑与 tools/transcribe.py 的解析/传参约定。

不打网络：转写走「预先落一份 SRT，让 transcribe 的幂等分支复用」的路子；
唯一需要外部命令的是 ffprobe（读音频时长），用 monkeypatch 掉。
"""
import json
import os
import wave
from unittest.mock import patch
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import broll_timeline as bt  # noqa: E402
import transcribe as tr  # noqa: E402


FINAL_MD = """# 脚本：测试稿

## 元信息
时长：60s

## 完整口播脚本

【开头钩子】（提问）
**很多人以为 Skill 越多 AI 越强**，其实很多人的 AI 是被自己装笨的。

> 🎬【重置 · ✂️景别切】切近景，眼神直视镜头

同一个设计任务，你装了三四个设计 Skill，模型先花精力决定用哪个。

> 🎬【解释 · 🤖动效】一个透明漏斗，顶上倒进几千张卡片

平台的推荐算法只关心它自己的目标，而不是你的目标。

## 拍摄提示
这一节不是口播，不许进时间轴。
"""

# 模拟真实录音：有「呃/呢/啊」等临场加词和口误
CUES = [
    (0.0, 4.2, "呃，很多人以为 skill 越多 AI 越强"),
    (4.2, 8.0, "其实呢，很多人的 AI 是被自己装笨的"),
    (8.0, 14.5, "同一个设计任务啊，你装了三四个设计 skill，模型先花精力决定用哪个"),
    (14.5, 20.0, "平台的推荐算法只关心它自己的目标，而不是你的目标"),
]


def srt_text(cues=CUES):
    def tc(s):
        h, r = divmod(s, 3600)
        m, sec = divmod(r, 60)
        return f"{int(h):02d}:{int(m):02d}:{int(sec):02d},{int(round((sec % 1) * 1000)):03d}"
    return "\n".join(f"{i}\n{tc(a)} --> {tc(b)}\n{t}\n"
                     for i, (a, b, t) in enumerate(cues, 1))


SHOTS = [
    {"镜号": 1, "功能": "重置", "形式": "✂️景别切",
     "锚点口播": "其实很多人的 AI 是被自己装笨的。", "理想画面": "切近景", "切法": "景别切"},
    {"镜号": 2, "功能": "解释", "形式": "🤖动效",
     "锚点口播": "同一个设计任务，你装了三四个设计 Skill，模型先花精力决定用哪个。",
     "理想画面": "透明漏斗", "切法": "匹配切"},
]


class TimelineCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.audio = self.dir / "voice.m4a"
        with wave.open(str(self.audio), "wb") as f:
            f.setparams((1,2,16000,0,"NONE","not compressed")); f.writeframes(b"\x00\x00"*320000)
        self.cache_env=patch.dict(os.environ,{"TRANSCRIPT_CACHE_ROOT":str(self.dir/"cache")});self.cache_env.start()
        self.prefix = self.dir / "SCTEST"
        # transcribe 的幂等分支会直接复用这份已存在的 SRT，不发任何请求
        (self.dir / "SCTEST-transcript.srt").write_text(srt_text(), encoding="utf-8")
        tr.register_transcript(self.audio, self.dir / "SCTEST-transcript.srt")
        self._probe = bt.probe_duration
        bt.probe_duration = lambda _p: 20.0

    def tearDown(self):
        bt.probe_duration = self._probe
        self.cache_env.stop()
        self.tmp.cleanup()

    def build(self, shots=None, final=FINAL_MD):
        return bt.build(final, shots if shots is not None else SHOTS,
                        self.audio, True, self.prefix, False)


class ExtractSpoken(TimelineCase):
    def test_only_body_section_is_spoken(self):
        spoken = bt.extract_spoken(FINAL_MD)
        self.assertIn("很多人以为", spoken)
        self.assertNotIn("这一节不是口播", spoken)      # 别的小节不进
        self.assertNotIn("🎬", spoken)                  # 画面引用行不进
        self.assertNotIn("【开头钩子】", spoken)         # 段落标签行不进
        self.assertNotIn("**", spoken)                  # markdown 标记剥掉
        self.assertNotIn("元信息", spoken)

    def test_sentences_concatenate_to_the_normalized_stream(self):
        """句子拼起来必须严格等于归一化正文——build() 靠游标推进定位，错一个字全盘偏移。"""
        spoken = bt.extract_spoken(FINAL_MD)
        joined = "".join(bt.normalize(s) for s in bt.split_sentences(spoken))
        self.assertEqual(joined, bt.normalize(spoken))


class Alignment(TimelineCase):
    def test_source_srt_uses_existing_cues_without_transcribing(self):
        source_srt = self.dir / "provided.srt"
        source_srt.write_text(srt_text(), encoding="utf-8")
        data = bt.build(FINAL_MD, SHOTS, self.audio, True, self.prefix, False,
                        source_srt=source_srt)
        self.assertFalse(data["degraded"])
        self.assertEqual(data["transcript_source"], str(source_srt))
        self.assertEqual(data["minute_url"], "")

    def test_shots_get_real_seconds_despite_filler_words(self):
        data = self.build()
        self.assertFalse(data["degraded"])
        by_num = {s["镜号"]: s for s in data["shots"]}
        self.assertEqual(len(by_num), 2)
        # 镜1 的锚点整句落在第 2 条 cue（4.2–8.0）里
        self.assertAlmostEqual(by_num[1]["start"], 4.2, delta=0.5)
        self.assertAlmostEqual(by_num[1]["end"], 8.0, delta=0.5)
        # 镜2 落在第 3 条 cue（8.0–14.5）
        self.assertAlmostEqual(by_num[2]["start"], 8.0, delta=0.5)
        self.assertAlmostEqual(by_num[2]["end"], 14.5, delta=0.5)
        self.assertAlmostEqual(by_num[2]["duration"],
                               by_num[2]["end"] - by_num[2]["start"], places=3)
        # 语气词是 insert，不该拉低置信度
        for shot in data["shots"]:
            self.assertGreater(shot["confidence"], 0.8)

    def test_sentences_are_monotonic_and_within_audio(self):
        data = self.build()
        prev = 0.0
        for s in data["sentences"]:
            self.assertGreaterEqual(s["start"], prev - 1e-6)
            self.assertGreaterEqual(s["end"], s["start"])
            prev = s["end"]
        self.assertLessEqual(data["sentences"][-1]["end"], data["audio_duration"] + 0.01)

    def test_missing_anchor_is_reported_not_guessed(self):
        shots = SHOTS + [{"镜号": 9, "功能": "具象", "形式": "🤖动效",
                          "锚点口播": "这句话在定稿里根本不存在", "理想画面": "x", "切法": "硬切"}]
        data = self.build(shots)
        self.assertNotIn(9, {s["镜号"] for s in data["shots"]})
        self.assertTrue(any("找不到落点" in w for w in data["warnings"]))

    def test_blank_anchor_is_reported(self):
        data = self.build([{"镜号": 5, "功能": "情绪", "形式": "🤖图库",
                            "锚点口播": "", "理想画面": "x", "切法": ""}])
        self.assertEqual(data["shots"], [])
        self.assertTrue(any("没写「锚点口播」" in w for w in data["warnings"]))

    def test_overlapping_anchors_are_flagged(self):
        overlap = [
            dict(SHOTS[0]),
            {"镜号": 2, "功能": "解释", "形式": "🤖动效",
             "锚点口播": "AI 是被自己装笨的。同一个设计任务",
             "理想画面": "x", "切法": "硬切"},
        ]
        data = self.build(overlap)
        self.assertTrue(any("时间重叠" in w for w in data["warnings"]))

    def test_shots_are_sorted_by_start(self):
        data = self.build(list(reversed(SHOTS)))
        starts = [s["start"] for s in data["shots"]]
        self.assertEqual(starts, sorted(starts))


class Degraded(TimelineCase):
    def test_no_asr_marks_degraded_and_warns(self):
        bt.speech_intervals = lambda _a, d: [(0.0, d)]
        data = bt.build(FINAL_MD, SHOTS, self.audio, False, self.prefix, False)
        self.assertTrue(data["degraded"])
        self.assertTrue(any("估算" in w for w in data["warnings"]))
        self.assertTrue(all(s["start"] is not None for s in data["shots"]))
        md = bt.render_md(data)
        self.assertIn("⚠️ **本次没拿到逐字稿", md)

    def test_degraded_shots_stay_ordered(self):
        bt.speech_intervals = lambda _a, d: [(0.0, d)]
        data = bt.build(FINAL_MD, SHOTS, self.audio, False, self.prefix, False)
        for s in data["shots"]:
            self.assertGreaterEqual(s["end"], s["start"])


class TranscriptParsing(unittest.TestCase):
    def test_srt_round_trip_strips_speaker_labels(self):
        cues = tr.parse_srt(srt_text([(0.0, 2.0, "说话人 1 你好")]))
        self.assertEqual(cues[0]["text"], "你好")
        self.assertEqual(cues[0]["start"], 0.0)
        self.assertEqual(cues[0]["end"], 2.0)

    def test_timestamped_txt_fills_end_from_next_cue(self):
        cues = tr.parse_timestamped_txt("00:00:05 第一句\n[00:01:10.500] 第二句\n", 120)
        self.assertEqual(cues[0]["end"], cues[1]["start"])
        self.assertEqual(cues[1]["end"], 120)

    def test_plain_transcript_without_timestamps_is_rejected(self):
        """没时间戳的逐字稿必须报错，不能被当成能对齐的素材。"""
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "t.txt"
            p.write_text("说话人 1\n大家好，好久不见了。\n", encoding="utf-8")
            with self.assertRaises(tr.TranscribeError):
                tr.load_cues(p)


class LarkQueryParams(unittest.TestCase):
    """查询参数必须走 --params：拼在 path 里会被 lark-cli 丢掉，
    历史上 dissect 的 need_timestamp 因此从未生效。"""

    def test_params_survive_dry_run(self):
        proc = subprocess.run(
            ["lark-cli", "api", "GET", "/open-apis/minutes/v1/minutes/T/transcript",
             "--params", '{"need_timestamp":true,"file_format":"srt"}',
             "--dry-run", "--format", "json"],
            capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            self.skipTest("lark-cli 不可用")
        api = json.loads(proc.stdout)["data"]["api"][0]
        self.assertEqual(api.get("params", {}).get("file_format"), "srt")
        self.assertIs(api.get("params", {}).get("need_timestamp"), True)

    def test_query_string_in_path_is_dropped(self):
        proc = subprocess.run(
            ["lark-cli", "api", "GET",
             "/open-apis/minutes/v1/minutes/T/transcript?need_timestamp=true",
             "--dry-run", "--format", "json"],
            capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            self.skipTest("lark-cli 不可用")
        api = json.loads(proc.stdout)["data"]["api"][0]
        self.assertNotIn("params", api)
        self.assertNotIn("?", api["url"])

    def test_transcribe_source_uses_params_not_query_string(self):
        src = (ROOT / "tools" / "transcribe.py").read_text(encoding="utf-8")
        self.assertIn('"--params", params', src)
        self.assertNotIn("?need_timestamp", src)


if __name__ == "__main__":
    unittest.main()
