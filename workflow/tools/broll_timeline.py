#!/usr/bin/env python3
"""口播录音 → 真实分镜时间轴（/broll 用，零第三方依赖）。

    python3 tools/broll_timeline.py align --id SC-0003 --audio ~/口播.m4a
    python3 tools/broll_timeline.py align --final <定稿.md> --shots <shots.json> \
        --audio <音频> --out-prefix workspace/broll/自定义名
    python3 tools/broll_timeline.py align ... --source-srt <已有带时间码字幕.srt>

做的事：把**定稿口播正文**和**录音的带时间码逐字稿**做模糊对齐，得出每句、每镜的
真实 in/out 秒数，取代 /package 阶段按 3.9-4.9 字/秒估算出来的假时间轴。

为什么要模糊对齐而不是逐句硬切：用户是照着定稿念，但会有口误、语气词和临场加词
（「呃…这两年呢我在香港做了个基金」vs 定稿「这两年我在香港做了一个基金」）。
difflib 的 equal 块天然跳过这些增删，比按标点硬切稳得多。

降级：`--no-asr`（或妙记不可用）时退到 ffmpeg silencedetect 切语句 + 按字数比例分配，
产物打 degraded 标记，调用方必须在汇报里说清「时间轴是估算不是实测」。
"""
import argparse
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PACKAGE_DIR = PROJECT_ROOT / "workspace" / "package"
BROLL_DIR = PROJECT_ROOT / "workspace" / "broll"

LOW_MATCH = 0.55      # 低于此匹配率的句子进告警区
LOW_SHOT = 0.70       # 低于此匹配率的镜头锚点进告警区
SILENCE_DB = "-32dB"  # silencedetect 阈值
SILENCE_MIN = 0.35    # 最短静音时长（秒）
CHARS_PER_SEC = 4.4   # config/platforms.md 实测语速，只用于降级估算


def die(msg: str, code: int = 1):
    print(f"[timeline] 错误：{msg}", file=sys.stderr)
    sys.exit(code)


# ---------- 定稿正文提取 ----------

BODY_HEADING = re.compile(r"^#{1,4}\s*.*(完整口播脚本|口播正文|口播脚本)\s*$")
ANY_HEADING = re.compile(r"^#{1,4}\s+")
# 整行只是个段落标签：【开头钩子】（提问，直奔观众自己的行为）
LABEL_LINE = re.compile(r"^\s*【[^】]*】\s*(（[^）]*）|\([^)]*\))?\s*$")


def extract_spoken(md: str) -> str:
    """从定稿 markdown 里抠出**真正要念出来的**文本。

    去掉：非口播小节、`> 🎬` 等引用行、`【段落标签】` 整行、markdown 标记。
    """
    lines = md.replace("\r\n", "\n").split("\n")
    body, inside = [], False
    for line in lines:
        if BODY_HEADING.match(line):
            inside = True
            continue
        if inside and ANY_HEADING.match(line):
            break
        if inside:
            body.append(line)
    if not body:  # 没有「完整口播脚本」小节 → 整篇当正文（手工模式/裸稿）
        body = [ln for ln in lines if not ANY_HEADING.match(ln)]

    out = []
    for line in body:
        if line.lstrip().startswith(">"):      # 🎬 画面引用行、其他引用
            continue
        if LABEL_LINE.match(line):             # 段落标签行
            continue
        if re.match(r"^\s*[-*_]{3,}\s*$", line):
            continue
        line = re.sub(r"[*`~]", "", line)      # 加粗/代码/删除线标记
        line = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", line)   # 链接/图片
        out.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


SENT_END = "。！？!?…；;"


def split_sentences(text: str) -> list:
    """按句末标点 + 换行切句，返回 [{"text": 原文}]（保留原始写法给人读）。"""
    sents, buf = [], ""
    for ch in text:
        if ch == "\n":
            if buf.strip():
                sents.append(buf.strip())
            buf = ""
            continue
        buf += ch
        if ch in SENT_END:
            if buf.strip():
                sents.append(buf.strip())
            buf = ""
    if buf.strip():
        sents.append(buf.strip())
    return [s for s in sents if normalize(s)]


# ---------- 归一化：只留 CJK + 小写拉丁 + 数字 ----------

KEEP = re.compile(r"[一-鿿0-9a-z]")


def normalize(text: str) -> str:
    return "".join(KEEP.findall(text.lower()))


def normalize_indexed(text: str) -> tuple:
    """返回 (归一化字符串, 每个归一化字符在原文里的下标)。"""
    chars, idx = [], []
    for i, ch in enumerate(text.lower()):
        if KEEP.match(ch):
            chars.append(ch)
            idx.append(i)
    return "".join(chars), idx


# ---------- 音频 ----------

def probe_duration(audio: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(audio)],
        capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        die(f"ffprobe 读不出音频时长：{proc.stderr.strip()[:300]}")
    try:
        return round(float(proc.stdout.strip()), 3)
    except ValueError:
        die(f"ffprobe 返回的时长无法解析：{proc.stdout[:100]}")


def speech_intervals(audio: Path, duration: float) -> list:
    """silencedetect 反推有声区间 [(start, end)]（只读分析，不产出交付画面）。"""
    proc = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(audio),
         "-af", f"silencedetect=noise={SILENCE_DB}:d={SILENCE_MIN}", "-f", "null", "-"],
        capture_output=True, text=True, timeout=600)
    log = proc.stderr
    starts = [float(m) for m in re.findall(r"silence_start:\s*([\d.]+)", log)]
    ends = [float(m) for m in re.findall(r"silence_end:\s*([\d.]+)", log)]
    silences = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else duration
        if e > s:
            silences.append((s, e))
    speech, cursor = [], 0.0
    for s, e in silences:
        if s > cursor:
            speech.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < duration:
        speech.append((cursor, duration))
    return speech or [(0.0, duration)]


# ---------- 逐字稿 → 每个字符一个时间点 ----------

def cue_char_times(cues: list) -> tuple:
    """把 cue 列表摊平成 (归一化字符串, [(start, end), ...])，cue 内线性插值。"""
    chars, times = [], []
    for cue in cues:
        norm = normalize(cue["text"])
        if not norm:
            continue
        span = max(cue["end"] - cue["start"], 0.001)
        step = span / len(norm)
        for k, ch in enumerate(norm):
            chars.append(ch)
            times.append((cue["start"] + k * step, cue["start"] + (k + 1) * step))
    return "".join(chars), times


# ---------- 对齐 ----------

def align(script_norm: str, trans_norm: str) -> list:
    """返回长度 = len(script_norm) 的列表，每项是对应的转写字符下标或 None。

    只信 equal 块（口误/加词/漏字都落在 replace/insert/delete 里，不做锚点）；
    没被 equal 覆盖的位置留 None，交给上层按邻居插值。
    """
    mapping = [None] * len(script_norm)
    sm = difflib.SequenceMatcher(None, script_norm, trans_norm, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for off in range(i2 - i1):
                mapping[i1 + off] = j1 + off
    return mapping


def span_time(mapping, times, a: int, b: int):
    """归一化区间 [a,b) → (start, end, 匹配率)；无锚点返回 (None, None, 0.0)。"""
    hit = [mapping[i] for i in range(a, min(b, len(mapping))) if mapping[i] is not None]
    if not hit:
        return None, None, 0.0
    return times[min(hit)][0], times[max(hit)][1], len(hit) / max(b - a, 1)


def interpolate(items: list, duration: float):
    """给没拿到锚点的条目按前后邻居 + 字数比例补时间，并强制单调不重叠。"""
    n = len(items)
    for i, it in enumerate(items):
        if it["start"] is not None:
            continue
        prev_end = next((items[k]["end"] for k in range(i - 1, -1, -1)
                         if items[k]["end"] is not None), 0.0)
        nxt_start = next((items[k]["start"] for k in range(i + 1, n)
                          if items[k]["start"] is not None), duration)
        gap_items = [k for k in range(i, n) if items[k]["start"] is None
                     and all(items[j]["start"] is None for j in range(i, k + 1))]
        total = sum(items[k]["nchars"] for k in gap_items) or 1
        cursor = prev_end
        for k in gap_items:
            share = (nxt_start - prev_end) * items[k]["nchars"] / total
            items[k]["start"], items[k]["end"] = cursor, cursor + share
            items[k]["interpolated"] = True
            cursor += share
    prev = 0.0
    for it in items:
        start = it["start"] if it["start"] is not None else prev
        end = it["end"] if it["end"] is not None else start
        it["start"] = max(round(float(start), 3), prev)
        it["end"] = round(max(float(end), it["start"]), 3)
        prev = it["end"]
    return items


def degraded_times(sentences: list, audio: Path, duration: float) -> list:
    """无 ASR 兜底：有声区间总时长按各句字数比例摊分。"""
    speech = speech_intervals(audio, duration)
    total_speech = sum(e - s for s, e in speech) or duration
    total_chars = sum(len(normalize(s)) for s in sentences) or 1
    out, seg, used = [], 0, 0.0
    for sent in sentences:
        want = total_speech * len(normalize(sent)) / total_chars
        start = None
        while want > 0 and seg < len(speech):
            s, e = speech[seg]
            avail = e - max(s, used)
            if avail <= 0:
                seg += 1
                used = 0.0
                continue
            if start is None:
                start = max(s, used) if used else s
            take = min(avail, want)
            used = max(s, used) + take
            want -= take
            if want > 1e-6:
                seg += 1
                used = 0.0
        out.append({"text": sent, "start": round(start if start is not None else 0.0, 3),
                    "end": round(used if used > 0 else duration, 3),
                    "match_ratio": 0.0, "interpolated": True,
                    "nchars": len(normalize(sent))})
    return out


# ---------- 主流程 ----------

def build(final_md: str, shots: list, audio: Path, use_asr: bool,
          out_prefix: Path, force: bool, source_srt: Path = None,
          transcript_time_base: str = "source", project_duration: float = None,
          project_document: dict = None, transcript_provenance_path: Path = None) -> dict:
    # Derived SRTs carry a hash-bound sidecar. Detect it even for historical
    # callers so this file can never contaminate the original recording cache.
    project_provenance_verified = False
    sidecar = Path(transcript_provenance_path) if transcript_provenance_path else (Path(source_srt).with_suffix('.json') if source_srt else None)
    if sidecar and sidecar.is_file():
        metadata = json.loads(sidecar.read_text(encoding='utf-8'))
        if metadata.get('origin') == 'saved-document-captions' and metadata.get('timeBase') == 'project':
            import hashlib
            if metadata.get('srtSha256') != hashlib.sha256(Path(source_srt).read_bytes()).hexdigest():
                raise ValueError('project transcript sidecar SHA mismatch')
            if not metadata.get('sourcePath') or not Path(audio).is_file():
                raise ValueError('project transcript source identity mismatch')
            try:
                from .package_edit_transcript import file_sha256
            except ImportError:
                from package_edit_transcript import file_sha256
            actual_source_sha = file_sha256(audio)
            if metadata.get('sourceSha256'):
                if metadata['sourceSha256'] != actual_source_sha:
                    raise ValueError('project transcript source SHA mismatch')
            elif Path(metadata['sourcePath']).resolve() != Path(audio).resolve():
                raise ValueError('project transcript source identity mismatch')
            if project_document is not None:
                try:
                    from .package_edit_transcript import fingerprint
                except ImportError:
                    from package_edit_transcript import fingerprint
                if metadata.get('projectId') != project_document.get('id'):
                    raise ValueError('project transcript project identity mismatch')
                if metadata.get('sourceClipsSha256') != fingerprint((project_document.get('source') or {}).get('clips')):
                    raise ValueError('project transcript source clips identity mismatch')
            project_provenance_verified = True
            transcript_time_base = 'project'
            project_duration = metadata['projectDurationSeconds']
    if transcript_time_base == 'project' and not project_provenance_verified:
        raise ValueError('project transcript requires bound provenance')
    if transcript_time_base not in {'source','project'}:
        raise ValueError('unknown transcript time base')
    if transcript_time_base == 'project' and (not source_srt or project_duration is None or project_duration <= 0):
        raise ValueError('project transcript requires SRT and project duration')
    duration = project_duration if transcript_time_base == 'project' else probe_duration(audio)
    spoken = extract_spoken(final_md)
    if not spoken:
        die("从定稿里没抠出任何口播正文（检查是否有「## 完整口播脚本」小节）")
    sent_texts = split_sentences(spoken)
    script_norm, orig_idx = normalize_indexed(spoken)

    degraded, minute_url, cues, transcript_source = True, "", [], ""
    if source_srt is not None:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from transcribe import load_cues, register_transcript
        cues = load_cues(source_srt, duration)
        if transcript_time_base == "source":
            register_transcript(audio, source_srt)
        degraded = False
        transcript_source = str(source_srt)
    elif use_asr:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from transcribe import TranscribeError, transcribe as do_transcribe
        try:
            got = do_transcribe(audio, out_prefix.with_name(out_prefix.name + "-transcript"),
                                fmt="srt", force=force, total_duration=duration)
            cues, minute_url, degraded = got["cues"], got["minute_url"], False
            transcript_source = "minutes"
        except TranscribeError as exc:
            print(f"[timeline] ⚠️ 转写不可用（{exc}）→ 降级为静音切分 + 字数比例估算",
                  file=sys.stderr)

    warnings = []
    if degraded:
        sentences = degraded_times(sent_texts, audio, duration)
        mapping, times = None, None
        warnings.append("时间轴是**估算值**（未拿到逐字稿，走静音切分 + 字数比例）"
                        "——切点误差可能到秒级，剪辑时以实际听感为准。")
    else:
        trans_norm, times = cue_char_times(cues)
        mapping = align(script_norm, trans_norm)
        sentences, cursor = [], 0
        for sent in sent_texts:
            n = len(normalize(sent))
            # 句子在 script_norm 里是顺序拼接的，游标推进即可
            start, end, ratio = span_time(mapping, times, cursor, cursor + n)
            sentences.append({"text": sent, "start": start, "end": end,
                              "match_ratio": round(ratio, 3), "interpolated": False,
                              "nchars": n, "_a": cursor, "_b": cursor + n})
            cursor += n
        sentences = interpolate(sentences, duration)
        overall = sum(s["match_ratio"] * s["nchars"] for s in sentences) / max(
            sum(s["nchars"] for s in sentences), 1)
        if overall < LOW_MATCH:
            warnings.append(f"整体匹配率只有 {overall:.0%}——录音和定稿差异较大，"
                            "逐条核对下面的时间轴再往下走。")
        weak = [s for s in sentences if s["match_ratio"] < LOW_MATCH]
        for s in weak[:8]:
            warnings.append(f"低置信度句（匹配 {s['match_ratio']:.0%}）：{s['text'][:40]}")
        if len(weak) > 8:
            warnings.append(f"…另有 {len(weak) - 8} 句低置信度，详见 -timeline.json")

    # 镜头挂点
    shot_rows = []
    for shot in shots:
        anchor = shot.get("锚点口播") or ""
        a_norm = normalize(anchor)
        num = shot.get("镜号")
        if not a_norm:
            warnings.append(f"镜 {num} 没写「锚点口播」，无法定位，已跳过")
            continue
        pos = script_norm.find(a_norm)
        ratio = 1.0
        if pos < 0:  # 锚点不是精确子串 → 退到最长公共块
            sm = difflib.SequenceMatcher(None, script_norm, a_norm, autojunk=False)
            m = sm.find_longest_match(0, len(script_norm), 0, len(a_norm))
            if m.size < max(6, len(a_norm) * 0.4):
                warnings.append(f"镜 {num} 的锚点口播在定稿里找不到落点"
                                f"（「{anchor[:30]}」）——定稿改过？请核对 shots.json")
                continue
            pos, ratio = m.a, round(m.size / len(a_norm), 3)
            warnings.append(f"镜 {num} 锚点只匹配上 {ratio:.0%}，按最长公共段定位")
        a, b = pos, pos + len(a_norm)
        if degraded:
            start, end = _range_from_sentences(sentences, a, b, sent_texts)
            conf = 0.0
        else:
            start, end, conf = span_time(mapping, times, a, b)
            if start is None:
                start, end = _range_from_sentences(sentences, a, b, sent_texts)
        if start is None:
            warnings.append(f"镜 {num} 在录音里定不到时间，已跳过")
            continue
        shot_rows.append({
            "镜号": num, "功能": shot.get("功能", ""), "形式": shot.get("形式", ""),
            "锚点口播": anchor, "理想画面": shot.get("理想画面", ""),
            "创意方案": shot.get("创意方案", ""), "关键帧描述": shot.get("关键帧描述", ""),
            "切法": shot.get("切法", ""), "素材库命中": shot.get("素材库命中"),
            "keyframe": shot.get("keyframe"),
            "start": round(start, 3), "end": round(end, 3),
            "duration": round(end - start, 3), "confidence": round(conf, 3),
        })

    shot_rows.sort(key=lambda r: r["start"])
    for i in range(1, len(shot_rows)):
        if shot_rows[i]["start"] < shot_rows[i - 1]["end"] - 0.001:
            warnings.append(
                f"镜 {shot_rows[i-1]['镜号']} 与镜 {shot_rows[i]['镜号']} 时间重叠"
                f"（{shot_rows[i-1]['end']:.3f}s / {shot_rows[i]['start']:.3f}s）"
                "——两镜锚点口播有交集，回 /package 改 shots.json")

    return {"script_id": out_prefix.name, "audio": str(audio),
            "audio_duration": duration, "degraded": degraded,
            "minute_url": minute_url, "transcript_source": transcript_source, "transcript_time_base": transcript_time_base, "warnings": warnings,
            "sentences": [{k: v for k, v in s.items() if not k.startswith("_")}
                          for s in sentences],
            "shots": shot_rows}


def _range_from_sentences(sentences, a, b, sent_texts):
    """降级模式下镜头挂点：找归一化区间覆盖到的句子，取首句 start / 末句 end。"""
    cursor, start, end = 0, None, None
    for s, text in zip(sentences, sent_texts):
        n = len(normalize(text))
        if cursor < b and cursor + n > a:
            start = s["start"] if start is None else start
            end = s["end"]
        cursor += n
    return start, end


def fmt_tc(sec: float) -> str:
    m, s = divmod(sec, 60)
    return f"{int(m):d}:{s:06.3f}"


def render_md(data: dict) -> str:
    lines = [f"# 真实分镜时间轴 · {data['script_id']}", ""]
    src = "静音切分 + 字数比例**估算**" if data["degraded"] else "录音逐字稿实测"
    lines += [f"> 音频 `{Path(data['audio']).name}`｜总时长 **{fmt_tc(data['audio_duration'])}**"
              f"｜时间来源：{src}"]
    if data["minute_url"]:
        lines.append(f"> 妙记：{data['minute_url']}")
    lines.append("")
    if data["degraded"]:
        lines += ["⚠️ **本次没拿到逐字稿，时间轴是估算值**——"
                  "派动效前请先人工核一遍关键切点，或补授权后重跑。", ""]

    if data["warnings"]:
        lines += ["## ⚠️ 告警", ""]
        lines += [f"- {w}" for w in data["warnings"]]
        lines.append("")

    lines += ["## 时间轴（四列：时间轴 | 口播文案 | 画面 | 切法）", "",
              "| 时间轴 | 口播文案 | 画面 | 切法 |", "|---|---|---|---|"]
    shots = data["shots"]
    for s in data["sentences"]:
        covering = [sh for sh in shots
                    if sh["start"] < s["end"] - 0.05 and sh["end"] > s["start"] + 0.05]
        pic = "；".join(f"镜{sh['镜号']}【{sh['功能']} · {sh['形式']}】{sh['理想画面']}"
                       for sh in covering)
        cut = "；".join(sh["切法"] for sh in covering if sh["切法"])
        text = s["text"].replace("|", "｜")
        lines.append(f"| {fmt_tc(s['start'])}–{fmt_tc(s['end'])} | {text} | {pic} | {cut} |")
    lines.append("")

    lines += ["## 镜头实测时长（派 visualization 用这一列）", "",
              "| 镜 | 功能 · 形式 | in | out | 时长秒 | 置信度 | 素材库/关键帧 |",
              "|---|---|---|---|---|---|---|"]
    for sh in shots:
        asset = sh.get("素材库命中") or sh.get("keyframe") or ""
        lines.append(f"| {sh['镜号']} | {sh['功能']} · {sh['形式']} | {fmt_tc(sh['start'])} | "
                     f"{fmt_tc(sh['end'])} | **{sh['duration']:.3f}s** | "
                     f"{sh['confidence']:.0%} | {asset} |")
    lines.append("")
    return "\n".join(lines)


def cmd_align(args):
    if args.id:
        final_path = PACKAGE_DIR / f"{args.id}-final.md"
        shots_path = PACKAGE_DIR / f"{args.id}-shots.json"
        out_prefix = BROLL_DIR / args.id
    else:
        if not (args.final and args.shots and args.out_prefix):
            die("手工模式需要同时给 --final、--shots、--out-prefix")
        final_path, shots_path = Path(args.final), Path(args.shots)
        out_prefix = Path(args.out_prefix)
    for p in (final_path, shots_path):
        if not p.exists():
            die(f"找不到 {p}"
                + ("（先跑 /package 产出分镜创意方案）" if p == shots_path else "（先跑 package_io.py fetch）"))
    audio = Path(args.audio).expanduser()
    if not audio.exists():
        die(f"音频文件不存在：{audio}")

    shots_doc = json.loads(shots_path.read_text(encoding="utf-8"))
    shots = shots_doc["shots"] if isinstance(shots_doc, dict) else shots_doc
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    source_srt = Path(args.source_srt).expanduser() if args.source_srt else None
    if source_srt is not None and not source_srt.is_file():
        die(f"带时间码字幕文件不存在：{source_srt}")
    data = build(final_path.read_text(encoding="utf-8"), shots, audio,
                 use_asr=not args.no_asr, out_prefix=out_prefix, force=args.force,
                 source_srt=source_srt)
    if isinstance(shots_doc, dict) and shots_doc.get("visual_contract"):
        data["visual_contract"] = shots_doc["visual_contract"]

    json_path = out_prefix.with_name(out_prefix.name + "-timeline.json")
    md_path = out_prefix.with_name(out_prefix.name + "-timeline.md")
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_md(data), encoding="utf-8")

    print(f"[timeline] 音频 {data['audio_duration']:.3f}s｜"
          f"句 {len(data['sentences'])}｜镜 {len(data['shots'])}｜"
          f"{'降级估算' if data['degraded'] else '实测对齐'}")
    for w in data["warnings"]:
        print(f"[timeline] ⚠️ {w}")
    print(f"[timeline] 产物：{md_path}\n           {json_path}")
    print("[timeline] 下一步：主上下文读 -timeline.md，按 /broll 第 4 步做素材路由")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("align", help="口播录音对齐出真实分镜时间轴")
    p.add_argument("--id", help="脚本id，如 SC-0003（走 workspace/package/ 标准产物）")
    p.add_argument("--audio", required=True, help="终稿口播音频路径")
    p.add_argument("--final", help="手工模式：定稿 markdown 路径")
    p.add_argument("--shots", help="手工模式：分镜 shots.json 路径")
    p.add_argument("--out-prefix", help="手工模式：产物前缀")
    p.add_argument("--source-srt", help="复用已有带时间码 SRT，不调用妙记转写")
    p.add_argument("--no-asr", action="store_true", help="跳过妙记转写，直接走静音切分估算")
    p.add_argument("--force", action="store_true", help="忽略已有逐字稿，重新转写")
    p.set_defaults(func=cmd_align)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
