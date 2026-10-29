#!/usr/bin/env python3
"""音频/视频 → 带时间码逐字稿（走飞书妙记，零第三方依赖）。

    python3 tools/transcribe.py --audio <路径> --out <产物前缀> [--format srt|txt]

三步：`drive +upload` 传云空间 → `minutes +upload` 生成妙记 → 轮询 `api GET .../transcript`
导出。产物：`{前缀}.srt`（或 `.txt`）+ `{前缀}-minute.json`（记 minute_url/token，
便于复查与重跑时跳过重传）。

⚠️ 为什么不用本地 whisper：官方 skill `lark-minutes` 明令「本地音视频转纪要/逐字稿
不要改用 ffmpeg/whisper 或其他本地 ASR」，本机也没有装 whisper。

⚠️ 查询参数必须走 `--params`：`lark-cli api GET "<path>?a=b"` 会**丢掉** query string
（`--dry-run` 实测请求里没有 params 字段）。这就是历史上 dissect 的逐字稿
明明传了 `need_timestamp=true` 却拿不到时间戳的原因。

消费方：tools/broll_timeline.py（口播对齐）、tools/dissect.py（竞品拆解）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

POLL_TRIES = 20      # 妙记转写轮询次数
POLL_INTERVAL = 15   # 轮询间隔秒


class TranscribeError(RuntimeError):
    """转写失败（调用方可据此走无 ASR 兜底）。"""


def run_lark(args_list, cwd=None, timeout=300):
    """运行 lark-cli，返回 CompletedProcess（不解析、不抛错，由调用方判断）。"""
    cmd = ["lark-cli", *args_list, "--as", "user", "--format", "json"]
    env = dict(os.environ, LARKSUITE_CLI_NO_UPDATE_NOTIFIER="1",
               LARKSUITE_CLI_NO_SKILLS_NOTIFIER="1")
    return subprocess.run(cmd, capture_output=True, text=True,
                          timeout=timeout, cwd=cwd, env=env)


SCOPE_HINT = ("缺妙记导出权限。请在主上下文按 lark-shared split-flow 执行：\n"
              "  lark-cli auth login --scope \"minutes:minutes.transcript:export\" "
              "--no-wait --json\n授权完成后重跑本命令")


def _missing_scope(stderr: str) -> bool:
    return "missing_scope" in stderr or "99991679" in stderr


# ---------- 逐字稿解析（供对齐工具复用） ----------

SRT_CUE_RE = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*"
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")
# 带时间戳的 txt：行首 [00:01:23] / 00:01:23 / 01:23（可带毫秒），其后是正文
TXT_STAMP_RE = re.compile(
    r"^\s*[\[\(]?\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?\s*[\]\)]?\s*(.*)$")


def looks_like_srt(text: str) -> bool:
    return bool(SRT_CUE_RE.search(text))


def parse_srt(text: str) -> list:
    """SRT → [{"start": 秒, "end": 秒, "text": str}]，按 start 排序。"""
    cues, blocks = [], re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip())
    for block in blocks:
        m = SRT_CUE_RE.search(block)
        if not m:
            continue
        g = m.groups()
        start = int(g[0]) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3].ljust(3, "0")) / 1000
        end = int(g[4]) * 3600 + int(g[5]) * 60 + int(g[6]) + int(g[7].ljust(3, "0")) / 1000
        body = block[m.end():].strip()
        # 去掉序号行残留和说话人前缀
        body = re.sub(r"^\d+\s*$", "", body, flags=re.M).strip()
        body = re.sub(r"^说话人\s*\d+\s*[:：]?\s*", "", body)
        if body:
            cues.append({"start": start, "end": max(end, start), "text": body})
    return sorted(cues, key=lambda c: c["start"])


def parse_timestamped_txt(text: str, total_duration: float | None = None) -> list:
    """带时间戳的 txt → 同 parse_srt 的结构。end 取下一条的 start。"""
    cues = []
    for line in text.replace("\r\n", "\n").split("\n"):
        m = TXT_STAMP_RE.match(line)
        if not m:
            continue
        hh, mm, ss, ms, body = m.groups()
        body = re.sub(r"^说话人\s*\d+\s*[:：]?\s*", "", (body or "").strip())
        if not body:
            continue
        start = (int(hh) if hh else 0) * 3600 + int(mm) * 60 + int(ss)
        if ms:
            start += int(ms.ljust(3, "0")) / 1000
        cues.append({"start": start, "end": start, "text": body})
    cues.sort(key=lambda c: c["start"])
    for i, cue in enumerate(cues):
        if i + 1 < len(cues):
            cue["end"] = cues[i + 1]["start"]
        elif total_duration:
            cue["end"] = max(total_duration, cue["start"])
        else:
            # 末条没有下界，按字数粗估 4.4 字/秒（config/platforms.md 实测语速）
            cue["end"] = cue["start"] + max(1.0, len(cue["text"]) / 4.4)
    return cues


def load_cues(path: Path, total_duration: float | None = None) -> list:
    """按内容自动判 srt / 带时间戳 txt，返回 cue 列表。"""
    text = path.read_text(encoding="utf-8", errors="replace")
    cues = parse_srt(text) if looks_like_srt(text) else parse_timestamped_txt(text, total_duration)
    if not cues:
        raise TranscribeError(f"{path} 里没解析出任何带时间码的片段（可能是无时间戳的纯文本）")
    return cues


# ---------- 转写主流程 ----------

def _upload_audio(audio: Path, name: str) -> str:
    """传云空间取 file_token。lark-cli 的 --file 只收 cwd 内相对路径。"""
    if os.environ.get("TRANSCRIBE_PROVIDER") != "feishu":
        raise TranscribeError("云端转写未启用。请用 --source-srt 登记同源 SRT；如同意上传音轨到飞书，请显式设置 TRANSCRIBE_PROVIDER=feishu 并完成官方 CLI 授权。")
    proc = run_lark(["drive", "+upload", "--file", f"./{audio.name}", "--name", name],
                    cwd=audio.parent, timeout=900)
    if proc.returncode != 0:
        raise TranscribeError(f"drive 上传失败：{proc.stderr.strip()[:600]}")
    try:
        return json.loads(proc.stdout)["data"]["file_token"]
    except (ValueError, KeyError) as exc:
        raise TranscribeError(f"drive 上传返回异常：{proc.stdout[:400]}") from exc


def _make_minute(file_token: str) -> tuple:
    proc = run_lark(["minutes", "+upload", "--file-token", file_token])
    if proc.returncode != 0:
        raise TranscribeError(f"妙记生成失败：{proc.stderr.strip()[:600]}")
    try:
        minute_url = json.loads(proc.stdout)["data"]["minute_url"]
    except (ValueError, KeyError) as exc:
        raise TranscribeError(f"妙记生成返回异常：{proc.stdout[:400]}") from exc
    return minute_url, minute_url.rstrip("/").split("/")[-1]


def _export(minute_token: str, dest: Path, fmt: str, need_speaker: bool) -> bool:
    """导出一次逐字稿到 dest。返回是否拿到非空内容。

    查询参数走 --params（拼在 path 里会被 lark-cli 丢弃）；二进制响应用 -o 落盘，
    -o 同样只收 cwd 内相对路径。"""
    params = json.dumps({"need_speaker": need_speaker,
                         "need_timestamp": True,
                         "file_format": fmt}, ensure_ascii=False)
    dest.unlink(missing_ok=True)
    proc = run_lark(["api", "GET",
                     f"/open-apis/minutes/v1/minutes/{minute_token}/transcript",
                     "--params", params, "-o", f"./{dest.name}"],
                    cwd=dest.parent, timeout=300)
    if _missing_scope(proc.stderr):
        raise TranscribeError(SCOPE_HINT)
    return dest.exists() and dest.stat().st_size > 0


def _transcribe_uncached(audio: Path, out_prefix: Path, fmt: str = "srt",
               need_speaker: bool = False, force: bool = False,
               total_duration: float | None = None) -> dict:
    """音频 → 带时间码逐字稿。返回 {"path", "format", "minute_url", "cues"}。

    格式降级链：先要 srt；内容不是合法 SRT → 退 txt + need_timestamp 解析行首时间戳；
    两者都拿不到 → 抛 TranscribeError，由调用方走无 ASR 兜底。
    """
    audio = Path(audio).resolve()
    if not audio.exists():
        raise TranscribeError(f"音频文件不存在：{audio}")
    out_prefix = Path(out_prefix).resolve()
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    meta_path = out_prefix.with_name(out_prefix.name + "-minute.json")

    # 幂等：已有非空产物直接复用（避免重复上传大文件）
    if not force:
        for ext in (".srt", ".txt"):
            done = out_prefix.with_name(out_prefix.name + ext)
            if done.exists() and done.stat().st_size > 0:
                try:
                    cues = load_cues(done, total_duration)
                except TranscribeError:
                    break
                meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
                print(f"[transcribe] 复用已有逐字稿：{done}（{len(cues)} 段）")
                return {"path": done, "format": ext.lstrip("."),
                        "minute_url": meta.get("minute_url", ""), "cues": cues}

    # 重跑时若已有 minute_token 就跳过上传与建妙记
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    minute_url, minute_token = meta.get("minute_url", ""), meta.get("minute_token", "")
    if not minute_token:
        print(f"[transcribe] 上传音频到飞书云空间：{audio.name}")
        file_token = _upload_audio(audio, f"口播-{out_prefix.name}{audio.suffix}")
        minute_url, minute_token = _make_minute(file_token)
        meta_path.write_text(json.dumps(
            {"minute_url": minute_url, "minute_token": minute_token,
             "audio": str(audio)}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[transcribe] 妙记：{minute_url}")

    formats = [fmt] + [f for f in ("srt", "txt") if f != fmt]
    for i in range(POLL_TRIES):
        for candidate in formats:
            dest = out_prefix.with_name(f"{out_prefix.name}.{candidate}")
            if not _export(minute_token, dest, candidate, need_speaker):
                continue
            try:
                cues = load_cues(dest, total_duration)
            except TranscribeError:
                # 这个格式没时间码，换下一个格式；都不行再等下一轮
                print(f"[transcribe] {candidate} 导出无时间码，试下一个格式")
                continue
            print(f"[transcribe] 逐字稿：{dest}（{candidate}，{len(cues)} 段）")
            return {"path": dest, "format": candidate,
                    "minute_url": minute_url, "cues": cues}
        print(f"[transcribe] 转写未就绪（{i + 1}/{POLL_TRIES}），{POLL_INTERVAL}s 后重试…")
        time.sleep(POLL_INTERVAL)

    raise TranscribeError(
        f"轮询 {POLL_TRIES} 次仍未拿到带时间码的逐字稿，稍后重跑或去妙记页面看：{minute_url}")


def register_transcript(audio, source_srt, aliases=(), need_speaker=False):
    import transcript_cache as cache
    cues = load_cues(Path(source_srt))
    for source in [audio, *aliases]:
        key = cache.media_key(source)
        with cache.locked(key):
            cache.put(key, cues, speakers=need_speaker, provenance={"source":str(Path(source).resolve()), "transcript":str(Path(source_srt).resolve()), "explicitAssociation":True})
    return cues


def _prepared_pcm_for(audio: Path, pcm_audio) -> Path | None:
    """Accept a compact PCM WAV only if its roughcut_audio receipt names this exact source identity."""
    if not pcm_audio:
        return None
    try:
        pcm = Path(pcm_audio).resolve()
        meta = json.loads((pcm.parent / "meta.json").read_text(encoding="utf-8"))
        stat = audio.stat(); source = meta["source"]
        same = (source["path"], source["size"], source["mtimeNs"], source["ctimeNs"]) == (str(audio), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        return pcm if same and pcm.is_file() else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


VIDEO_SUFFIXES = {'.mov','.mp4','.mkv','.webm','.avi','.m4v'}
UPLOAD_PROFILES = {"original": "48 kHz mono AAC 96k from the source (default)",
                   "speech16k": "16 kHz mono AAC 64k from roughcut's already-decoded PCM (opt-in)"}


def upload_profile() -> str:
    profile = os.environ.get("TRANSCRIBE_UPLOAD_PROFILE", "original").strip() or "original"
    if profile not in UPLOAD_PROFILES:
        raise TranscribeError(f"未知 TRANSCRIBE_UPLOAD_PROFILE：{profile}（可选 {', '.join(UPLOAD_PROFILES)}）")
    return profile


def upload_audio(audio: Path, work: Path, pcm_audio=None) -> Path:
    """What goes to Feishu on a cache miss. Audio files upload as-is; video sources upload a
    voice-only AAC. Quality is unchanged by default; the cheaper speech16k profile is opt-in."""
    if audio.suffix.lower() not in VIDEO_SUFFIXES:
        return audio
    profile = upload_profile()
    pcm = _prepared_pcm_for(audio, pcm_audio) if profile == "speech16k" else None
    upload = work / ('voice.m4a' if not pcm else 'voice-speech16k.m4a')
    if not upload.exists():
        temp = upload.with_name(upload.stem + '.part.m4a')
        if pcm:
            command = ['ffmpeg','-nostdin','-v','error','-y','-i',str(pcm),'-c:a','aac','-b:a','64k',str(temp)]
        else:
            command = ['ffmpeg','-nostdin','-v','error','-y','-i',str(audio),'-map','0:a:0','-vn','-ac','1','-ar','48000','-c:a','aac','-b:a','96k',str(temp)]
        subprocess.run(command, check=True)
        temp.replace(upload)
    return upload


def transcribe(audio: Path, out_prefix: Path, fmt: str = "srt",
               need_speaker: bool = False, force: bool = False,
               total_duration: float | None = None, pcm_audio=None) -> dict:
    import transcript_cache as cache
    audio = Path(audio).resolve()
    try:
        initial = audio.stat()
        identity = (initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns)
        key = cache.media_key(audio)
        with cache.locked(key):
            record = None if force else cache.read(key, need_speaker)
            if not record and not force:
                prefix = Path(out_prefix).resolve()
                old_meta = prefix.with_name(prefix.name+'-minute.json')
                old_srt = prefix.with_name(prefix.name+'.srt')
                if old_srt.exists():
                    meta = json.loads(old_meta.read_text()) if old_meta.exists() else {}
                    if meta.get('audio') and Path(meta['audio']).resolve()==audio and audio.stat().st_mtime_ns<=old_meta.stat().st_mtime_ns:
                        record = cache.put(key, load_cues(old_srt,total_duration), meta.get('minute_url',''), need_speaker, {'legacy':str(old_srt)})
                    elif not meta.get('transcript_key'):
                        raise TranscribeError('已有转写文件但缺少素材来源关联；请用 --source-srt 明确登记，避免重复识别或误用旧稿')
            if record:
                print(f"[transcribe] 复用共享逐字稿：{key[:12]}，无需上传/识别")
                return cache.materialize(record, out_prefix, fmt)
            # Stable source-based workspace also preserves a pending Minutes upload across callers.
            work = cache.root() / 'jobs' / (key + ('.speakers' if need_speaker else ''))
            work.mkdir(parents=True, exist_ok=True)
            upload = upload_audio(audio, work, pcm_audio)
            if force:
                (work / 'transcript-minute.json').unlink(missing_ok=True)
            result = _transcribe_uncached(upload, work / 'transcript', fmt, need_speaker, force, total_duration)
            final = audio.stat()
            if identity != (final.st_size, final.st_mtime_ns, final.st_ctime_ns):
                raise TranscribeError('识别期间原媒体已变化，不发布转写缓存')
            record = cache.put(key, result['cues'], result.get('minute_url',''), need_speaker, {'source':str(audio)})
            if upload != audio:
                cache.put(cache.media_key(upload), result['cues'], result.get('minute_url',''), need_speaker, {'derivedFrom':key,'source':str(upload)})
            output = cache.materialize(record, out_prefix, fmt); output['reused'] = False
            return output
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        raise TranscribeError(str(exc)) from exc


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", required=True, help="音频/视频文件路径")
    ap.add_argument("--out", required=True, help="产物前缀（不含扩展名）")
    ap.add_argument("--format", default="srt", choices=["srt", "txt"], help="首选导出格式")
    ap.add_argument("--source-srt", help="登记并复用已有时间码转写，不调用识别")
    ap.add_argument("--alias", action="append", default=[], help="明确同一口播、同一时间原点的音视频别名，可重复")
    ap.add_argument("--pcm-audio", help="roughcut_audio 已为同一原片解码好的 16kHz 单声道 WAV；仅 TRANSCRIBE_UPLOAD_PROFILE=speech16k 时用于上传转码")
    ap.add_argument("--speaker", action="store_true", help="保留说话人标注")
    ap.add_argument("--force", action="store_true", help="忽略已有产物，重新转写")
    args = ap.parse_args()
    try:
        if args.source_srt:
            register_transcript(args.audio, args.source_srt, args.alias, args.speaker)
        transcribe(Path(args.audio), Path(args.out), fmt=args.format,
                   need_speaker=args.speaker, force=args.force, pcm_audio=args.pcm_audio)
    except TranscribeError as exc:
        print(f"[transcribe] 错误：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
