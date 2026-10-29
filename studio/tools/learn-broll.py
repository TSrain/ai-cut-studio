#!/usr/bin/env python3
"""从真实口播视频里学 b-roll 画面手法（/learn-broll 用，零第三方依赖）。

子命令：
  fetch <链接或本地视频路径>   下载 + ffprobe + 场景检测 + 抽帧 + **逐帧视觉指标**
                              → workspace/learn/{id}/
  tokens --id <id> --frames t3.2,t7.8
                              对选中的 b-roll 帧反推设计令牌（配色/明度阶梯/强调色面积/
                              色相数/墨量），并与本项目 scenePalette() 并排对比

架构照搬 `自媒体工作流` 的 tools/dissect.py：**机械环节全在脚本里，主上下文不手写
ffmpeg**；一次 fetch 产出全部产物 + manifest.json；抽帧上限约束读图成本。

和 dissect 的根本差异：它拆内容结构（点击-留存-信任-转化），这里拆**画面手法**。
所以多了逐帧视觉指标，用来把 b-roll（图形插片）从 a-roll（口播人像）里初筛出来。

**指标只做初筛排序，不做判定。** 真正判断哪一帧是值得学的 b-roll，由主上下文
逐帧读图完成——肤色/边缘这类启发式对不同肤色、不同打光、不同风格都不可靠，
拿它当分类器一定会错。它的唯一作用是把 24 张帧排个序，让人先看最可能的那几张。

依赖外部命令：yt-dlp、ffmpeg/ffprobe（brew install yt-dlp ffmpeg）。
"""
import argparse
import colorsys
import json
import math
import re
import shutil
import subprocess
import sys
import urllib.request
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LEARN_DIR = PROJECT_ROOT / "workspace" / "learn"

MAX_FRAMES = 28          # **大图**上限（主上下文逐帧读图的成本约束）
SCAN_CAP = 240           # 小图扫描上限。38 分钟的长视频有 135 个切点,全扫得起;
                         # 真正贵的是主上下文读大图,所以省在大图不省在小图
LONG_VIDEO_SEC = 420     # 超过这个时长走"扫全部切点→挑高分"两阶段,不再均匀摊帧
SCENE_THRESHOLD = 0.25   # ffmpeg 场景切换检测阈值
GAP_FILL_SEC = 6.0       # 相邻切点间隔超过此值补中间帧（b-roll 常在长镜中段出现）
FRAME_WIDTH = 540        # 抽帧缩放宽度（文字可读且省 token）
METRIC_W, METRIC_H = 128, 160   # 算指标用的小图，抗噪且快


def die(msg: str, code: int = 1):
    print(f"[learn-broll] 错误：{msg}", file=sys.stderr)
    sys.exit(code)


def run(cmd, timeout=600, check=True):
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and proc.returncode != 0:
        raise RuntimeError(f"命令失败 {cmd[0]}: {proc.stderr.strip()[:800]}")
    return proc


def extract_url(text: str):
    m = re.search(r"https?://[^\s，。,]+", text)
    return m.group(0) if m else None


# ---------- 下载（抖音兜底逻辑同 dissect.py） ----------

MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")


def _http_get(url: str, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": MOBILE_UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(), resp.geturl()


def _http_download(url: str, dst: Path, timeout=900):
    req = urllib.request.Request(url, headers={"User-Agent": MOBILE_UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dst, "wb") as f:
        shutil.copyfileobj(resp, f)


def _find_key(obj, key, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                out.append(v)
            _find_key(v, key, out)
    elif isinstance(obj, list):
        for v in obj:
            _find_key(v, key, out)


def douyin_share_fetch(url: str, workdir: Path) -> dict:
    """抖音免签名兜底：分享页 SSR（_ROUTER_DATA）拿 play_addr 直链。零 cookie 零账号。"""
    m = re.search(r"(?:/video/|modal_id=|/share/video/)(\d{15,25})", url)
    if not m:
        _, final_url = _http_get(url)
        m = re.search(r"(?:/video/|modal_id=|/share/video/)(\d{15,25})", final_url)
    if not m:
        raise RuntimeError("无法从链接解析出视频 id")
    vid = m.group(1)
    body, _ = _http_get(f"https://www.iesdouyin.com/share/video/{vid}")
    page = body.decode("utf-8", "ignore")
    jm = re.search(r"_ROUTER_DATA\s*=\s*(\{.*?\})\s*</script>", page, re.S)
    if not jm:
        raise RuntimeError("分享页未返回 _ROUTER_DATA（命中风控降级页，不重试）")
    data = json.loads(jm.group(1))
    addrs, descs, nicks = [], [], []
    _find_key(data, "play_addr", addrs)
    _find_key(data, "desc", descs)
    _find_key(data, "nickname", nicks)
    urls = [u for a in addrs if isinstance(a, dict) for u in (a.get("url_list") or [])]
    if not urls:
        raise RuntimeError("分享页里没有 play_addr（可能是图文笔记或已删除）")
    dst = workdir / f"{vid}.mp4"
    last_err = None
    for u in dict.fromkeys([urls[0].replace("/playwm/", "/play/"), urls[0]]):
        try:
            _http_download(u, dst)
            if dst.stat().st_size < 100 * 1024:
                raise RuntimeError(f"返回体过小（{dst.stat().st_size}B），疑似拦截页")
            last_err = None
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    if last_err is not None:
        raise RuntimeError(f"play_addr 直链下载失败：{last_err}")
    return {"id": vid, "title": (descs[0] if descs and isinstance(descs[0], str) else "").strip(),
            "uploader": nicks[0] if nicks and isinstance(nicks[0], str) else "",
            "source_url": f"https://www.douyin.com/video/{vid}", "path": dst}


def download_video(url: str, workdir: Path) -> dict:
    tpl = str(workdir / "%(id)s.%(ext)s")
    # 学画面必须要清晰度：≤1080p（dissect 只需要看结构所以 720p 够，这里不够）
    cmd = ["yt-dlp", "--no-playlist", "--write-info-json",
           "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
           "--merge-output-format", "mp4", "-o", tpl, url]
    proc = run(cmd, timeout=900, check=False)
    if proc.returncode != 0:
        if "douyin" in url.lower() or "iesdouyin" in url.lower():
            print("[learn-broll] yt-dlp 被拦（抖音要求新鲜 cookies+签名），改走分享页免签名兜底…")
            try:
                return douyin_share_fetch(url, workdir)
            except Exception as e:  # noqa: BLE001
                die(f"yt-dlp 与分享页兜底均失败：{e}\n"
                    "请在抖音 App 里「分享→保存到相册」拿到视频文件，"
                    "再执行 python3 tools/learn-broll.py fetch <本地文件路径>")
        die(f"yt-dlp 下载失败：{proc.stderr.strip()[-600:]}")
    infos = sorted(workdir.glob("*.info.json"))
    if not infos:
        die("yt-dlp 未产出 info.json")
    info = json.loads(infos[0].read_text(encoding="utf-8"))
    vid = str(info.get("id") or infos[0].stem.replace(".info", ""))
    video = next((workdir / f"{vid}.{e}" for e in ("mp4", "mkv", "webm", "mov")
                  if (workdir / f"{vid}.{e}").exists()), None)
    if video is None:
        die("下载完成但找不到视频文件")
    return {"id": vid, "title": info.get("title") or "", "uploader": info.get("uploader") or "",
            "source_url": info.get("webpage_url") or url, "path": video}


def import_local(src: Path, workdir: Path) -> dict:
    vid = re.sub(r"[^\w\-]", "_", src.stem) or "local"
    dst = workdir / f"{vid}{src.suffix.lower()}"
    if src.resolve() != dst.resolve():
        shutil.copy2(src, dst)
    return {"id": vid, "title": src.stem, "uploader": "", "source_url": f"local:{src}", "path": dst}


# ---------- 探测与抽帧 ----------

def probe(video: Path) -> dict:
    proc = run(["ffprobe", "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", str(video)])
    data = json.loads(proc.stdout)
    out = {"duration": round(float(data["format"].get("duration", 0)), 2)}
    for s in data.get("streams", []):
        if s.get("codec_type") == "video":
            out["width"], out["height"] = s.get("width"), s.get("height")
            try:
                num, den = s.get("r_frame_rate", "0/1").split("/")
                out["fps"] = round(float(num) / float(den), 2) if float(den) else 0
            except ValueError:
                out["fps"] = 0
    return out


def detect_scenes(video: Path, workdir: Path) -> list:
    scenes_txt = workdir / "scenes.txt"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(video),
         "-vf", f"select='gt(scene,{SCENE_THRESHOLD})',metadata=print:file={scenes_txt}",
         "-f", "null", "-"], timeout=900)
    cuts = [float(m.group(1)) for m in
            re.finditer(r"pts_time:([\d.]+)", scenes_txt.read_text())]
    dedup = []
    for t in cuts:
        if not dedup or t - dedup[-1] > 0.5:
            dedup.append(round(t, 2))
    return dedup


def scan_times(cuts: list, duration: float, window=None) -> list:
    """要扫描指标的时间码。切点后 +0.35s 取:切点那一瞬间常在转场中途,画面糊的或半透明。"""
    lo, hi = window if window else (0.0, duration)
    times = [t for t in ([max(lo, 0.6)] + [round(t + 0.35, 2) for t in cuts])
             if lo <= t <= min(hi, duration - 0.5)]
    filled, bounds = [], sorted(set(times)) + [min(hi, duration)]
    for a, b in zip(bounds, bounds[1:]):
        filled.append(a)
        gap = b - a
        if gap > GAP_FILL_SEC:
            n = int(gap // GAP_FILL_SEC)
            filled += [round(a + gap * (i + 1) / (n + 1), 2) for i in range(n)]
    filled = sorted(set(filled))
    if len(filled) > SCAN_CAP:
        step = (len(filled) - 1) / (SCAN_CAP - 1)
        filled = [filled[round(i * step)] for i in range(SCAN_CAP)]
    return filled


def raw_pixels(video: Path, t: float, w=METRIC_W, h=METRIC_H):
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(video), "-frames:v", "1",
         "-vf", f"scale={w}:{h},format=rgb24", "-f", "rawvideo", "-"],
        capture_output=True, timeout=120)
    d = proc.stdout
    return [tuple(d[i:i + 3]) for i in range(0, len(d), 3)]


# ---------- 逐帧视觉指标 ----------

def is_skinish(r, g, b) -> bool:
    """粗判肤色。**这是一个已知有偏的启发式**——对深肤色、暖光、暖色滤镜都不准。
    这里只用来给帧排序（b-roll 候选优先），绝不作为判定依据；
    真正判断由主上下文逐帧读图完成。"""
    mx, mn = max(r, g, b), min(r, g, b)
    return (r > 95 and g > 40 and b > 20 and mx - mn > 15
            and abs(r - g) > 15 and r > g and r > b)


def frame_metrics(px: list) -> dict:
    n = len(px)
    if n == 0:
        return {}
    # 墨量:偏离底色(众数)的像素占比。见 tools/check-density.sh 同款定义
    bg = Counter(px).most_common(1)[0][0]
    ink = sum(1 for p in px
              if max(abs(p[0] - bg[0]), abs(p[1] - bg[1]), abs(p[2] - bg[2])) > 12) / n

    # 明度层数:8 级量化后占比 >0.5% 的档数,粗略反映表面层级
    gray = [0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] for p in px]
    bands = sum(1 for _, c in Counter(round(v / 8) for v in gray).items() if c > n * 0.005)

    # 边缘密度:相邻像素梯度均值。图形/文字锐利 → 高;实拍浅景深 → 低
    edge_sum = 0.0
    for y in range(METRIC_H - 1):
        row = y * METRIC_W
        for x in range(METRIC_W - 1):
            i = row + x
            edge_sum += abs(gray[i] - gray[i + 1]) + abs(gray[i] - gray[i + METRIC_W])
    edge = edge_sum / ((METRIC_W - 1) * (METRIC_H - 1) * 2)

    skin = sum(1 for p in px if is_skinish(*p)) / n

    sats = [colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)[1] for p in px]
    sat_mean = sum(sats) / n

    # 主色板:每通道量化到 16 级。
    # **中性与彩色分开取**——纯按面积排是错的:深色画面的底色能占 70%,
    # 一路把真正定调性的强调色挤出榜外(2026-08-01 首次反推就栽在这:
    # #000000 占 69.4%,青色和黄绿卡片一个都没进前十)。
    # 定一支片子调性的是强调色,不是底色面积。
    q = Counter((p[0] >> 4, p[1] >> 4, p[2] >> 4) for p in px)
    def _chroma(r, g, b):
        return (max(r, g, b) - min(r, g, b)) / 15.0
    neu, chrom = [], []
    for (r, g, b), c in q.most_common():
        item = {"hex": "#%02x%02x%02x" % (r * 17, g * 17, b * 17), "share": round(c / n, 4),
                "kind": "neutral" if _chroma(r, g, b) < 0.14 else "chromatic"}
        (neu if item["kind"] == "neutral" else chrom).append(item)
        if len(neu) >= 5 and len(chrom) >= 6:
            break
    palette = neu[:5] + chrom[:6]

    # 色板集中度:前 6 个量化色的累计面积占比。
    # 这是区分「设计过的图形」和「实拍/截图」**最有效**的单一信号——
    # 设计画面用少数几个令牌色铺大面积(通常 >0.6),照片和屏幕截图的色分布连续而分散。
    # 2026-08-01 标定发现:肤色指标在「半身口播 + 深色衣服 + 杂乱背景」构图下几乎失效
    # (纯人像帧肤色仅 8.9%,纯截图帧 2.9%,区分度不够),所以主信号换成集中度。
    concentration = sum(c["share"] for c in palette)

    # b-roll 候选分。只用于排序,不是判定线。
    score = (min(1.0, concentration / 0.75) * 0.45
             + min(1.0, edge / 12) * 0.3
             + (1 - min(1.0, skin / 0.15)) * 0.15
             + min(1.0, ink / 0.45) * 0.10)

    return {"ink": round(ink * 100, 1), "lum_bands": bands, "edge": round(edge, 2),
            "skin": round(skin * 100, 1), "sat": round(sat_mean * 100, 1),
            "conc": round(concentration * 100, 1),
            "palette": palette, "broll_score": round(score, 3)}


def scan_metrics(video: Path, times: list) -> list:
    """阶段 A:只抽小图算指标,不落盘大图。便宜,可以扫很多。"""
    out = []
    for i, t in enumerate(times):
        m = frame_metrics(raw_pixels(video, t))
        if m:
            out.append({"t": t, **m})
        if (i + 1) % 40 == 0:
            print(f"    扫描 {i + 1}/{len(times)}…")
    return out


def shoot_frames(video: Path, scanned: list, workdir: Path, cap: int) -> list:
    """阶段 B:只对高分帧抽 540px 大图供逐帧读图。

    挑选策略 = 高分优先 + **保底时间覆盖**:纯按分数挑会把大图全押在同一段
    (同一个插片的连续切点分数都高),后半程一张都没有,等于没看过整片。
    所以先按分数取 2/3,再从剩下的按时间均匀补 1/3。"""
    fdir = workdir / "frames"
    fdir.mkdir(exist_ok=True)
    by_score = sorted(scanned, key=lambda f: -f["broll_score"])
    picked = {f["t"]: f for f in by_score[:max(1, cap * 2 // 3)]}
    rest = [f for f in scanned if f["t"] not in picked]
    need = cap - len(picked)
    if need > 0 and rest:
        step = max(1, len(rest) // need)
        for f in rest[::step][:need]:
            picked[f["t"]] = f
    out = []
    for t in sorted(picked):
        name = f"t{t:g}.jpg"
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", str(video),
             "-frames:v", "1", "-vf", f"scale={FRAME_WIDTH}:-1", str(fdir / name)], timeout=90)
        out.append({**picked[t], "file": name})
    return out


def cmd_fetch(args):
    for tool in ("yt-dlp", "ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            die(f"缺少 {tool}，先 brew install yt-dlp ffmpeg")
    target = args.target.strip()
    local = Path(target).expanduser()
    tmp = LEARN_DIR / "_downloading"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True, exist_ok=True)

    if local.exists() and local.is_file():
        meta = import_local(local, tmp)
    else:
        url = extract_url(target)
        if not url:
            die("既不是本地文件也没有识别到 URL")
        meta = download_video(url, tmp)

    workdir = LEARN_DIR / meta["id"]
    if workdir.exists():
        shutil.rmtree(workdir)
    tmp.rename(workdir)
    video = workdir / Path(meta["path"]).name

    info = probe(video)
    cuts = detect_scenes(video, workdir)
    window = None
    if args.window:
        a, b = args.window.split("-")
        window = (float(a), float(b))
    times = scan_times(cuts, info["duration"], window)
    print(f"[learn-broll] 场景切点 {len(cuts)} 个，扫描 {len(times)} 个时间码算指标…")
    scanned = scan_metrics(video, times)
    print(f"[learn-broll] 挑高分帧抽大图（上限 {MAX_FRAMES}）…")
    frames = shoot_frames(video, scanned, workdir, MAX_FRAMES)

    dur = info["duration"]
    manifest = {"id": meta["id"], "title": meta["title"], "uploader": meta["uploader"],
                "source_url": meta["source_url"], "video_file": video.name, **info,
                "scene_cuts": cuts,
                "avg_cut_interval_sec": round(dur / (len(cuts) + 1), 2) if cuts else dur,
                "scanned_count": len(scanned), "window": args.window,
                "frames": frames}
    (workdir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[learn-broll] 完成：{workdir}")
    print(f"  {video.name}  {dur}s  {info.get('width')}x{info.get('height')}  "
          f"平均 {manifest['avg_cut_interval_sec']}s/切")
    # 素材适配性:全片扫描的色板集中度分布。设计过的图形插片集中度高(>60%),
    # 实拍/屏幕截图低。集中度峰值都上不去 → 这条片子里没有设计过的 b-roll,换素材。
    concs = sorted((f["conc"] for f in scanned), reverse=True)
    top10 = concs[:max(1, len(concs) // 10)]
    peak = sum(top10) / len(top10)
    print(f"\n  素材适配性:全片色板集中度 前10%均值 {peak:.1f}%  中位 {concs[len(concs)//2]:.1f}%")
    if peak < 55:
        print("  ⚠ 集中度峰值偏低 → 这条片子大概率**没有设计过的图形插片**")
        print("    (只有实拍口播 / 屏幕共享截图 / 手绘圈注)。这类素材学不到画面设计,建议换。")
    ranked = sorted(frames, key=lambda f: -f.get("broll_score", 0))
    print("\n  b-roll 候选排序（分数只排序不判定，逐帧读图确认）：")
    print(f"    {'帧':>12s} {'分':>5s} {'集中%':>6s} {'边缘':>6s} {'肤色%':>6s} {'墨量%':>6s}")
    for f in ranked[:14]:
        print(f"    {f['file']:>12s} {f['broll_score']:>5.2f} {f['conc']:>6.1f} "
              f"{f['edge']:>6.1f} {f['skin']:>6.1f} {f['ink']:>6.1f}")
    print(f"\n  下一步：主上下文逐帧读完 {workdir}/frames/ 全部图片，")
    print(f"        选出真正的 b-roll，再跑 tokens --id {meta['id']} --frames <时间码逗号分隔>")


# ---------- 令牌反推 ----------

def srgb_to_oklch(hexstr: str):
    """sRGB hex → OKLCH。与 src/lib/color.ts 的 oklch() 互为逆运算，
    这样反推出来的数能直接和 scenePalette() 的参数对比。"""
    n = int(hexstr.lstrip("#"), 16)
    rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    r, g, b = lin
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    C = math.hypot(A, B)
    H = math.degrees(math.atan2(B, A)) % 360
    return round(L, 3), round(C, 3), round(H, 1)


def cmd_tokens(args):
    workdir = LEARN_DIR / args.id
    mpath = workdir / "manifest.json"
    if not mpath.exists():
        die(f"找不到 {mpath}，先跑 fetch")
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    want = {round(float(x), 2) for x in args.frames.split(",") if x.strip()}
    sel = [f for f in manifest["frames"] if round(f["t"], 2) in want]
    if not sel:
        die(f"选中的时间码在 manifest 里找不到。可用：{[f['t'] for f in manifest['frames']]}")

    # 汇总所有选中帧的色板，按面积占比加权
    agg, kinds = Counter(), {}
    for f in sel:
        for c in f.get("palette", []):
            agg[c["hex"]] += c["share"]
            kinds[c["hex"]] = c.get("kind", "neutral")
    total = sum(agg.values()) or 1
    rows = []
    for hexv, share in agg.most_common():
        L, C, H = srgb_to_oklch(hexv)
        rows.append({"hex": hexv, "share": round(share / total, 4), "L": L, "C": C, "H": H,
                     "kind": kinds.get(hexv, "neutral")})

    neutrals = [r for r in rows if r["kind"] == "neutral"][:6]
    chromatics = [r for r in rows if r["kind"] == "chromatic"][:8]
    rows = neutrals + chromatics
    hues = sorted({round(r["H"] / 30) * 30 % 360 for r in chromatics})
    accent_share = sum(r["share"] for r in chromatics)
    ls = sorted(r["L"] for r in neutrals)
    steps = [round(b - a, 3) for a, b in zip(ls, ls[1:])] if len(ls) > 1 else []

    out = {
        "id": args.id, "frames": [f["t"] for f in sel],
        "palette": rows,
        "neutral_L_ladder": ls,
        "neutral_L_steps": steps,
        "accent_hues_30deg": hues,
        "accent_area_share": round(accent_share, 4),
        "ink_pct_avg": round(sum(f["ink"] for f in sel) / len(sel), 1),
        "lum_bands_avg": round(sum(f["lum_bands"] for f in sel) / len(sel), 1),
        "edge_avg": round(sum(f["edge"] for f in sel) / len(sel), 1),
    }
    (workdir / "tokens.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[learn-broll] 令牌反推（{len(sel)} 帧）→ {workdir}/tokens.json\n")
    print("  主色板（按面积占比）")
    print(f"    {'hex':>9s} {'占比':>7s} {'L':>6s} {'C':>6s} {'H':>6s}")
    for r in rows:
        tag = "中性" if r["kind"] == "neutral" else "强调"
        print(f"    {r['hex']:>9s} {r['share']*100:>6.1f}% {r['L']:>6.3f} {r['C']:>6.3f} {r['H']:>6.1f}  {tag}")
    print(f"\n  中性明度阶梯 L: {ls}")
    print(f"  相邻层间距    : {steps}   ← 本项目 scenePalette 的 dark 档是 0.17/0.22/0.27/0.33（间距 0.05~0.06）")
    print(f"  强调色相(30°粒度): {hues}   ← 本项目硬规则:一个色相;>2 个要能说出各自编码什么")
    print(f"  强调色面积占比: {accent_share*100:.1f}%   ← 本项目硬规则:≤10%")
    print(f"  平均墨量      : {out['ink_pct_avg']}%   ← 本项目下限:尾帧 ≥20%")
    print(f"  平均明度层数  : {out['lum_bands_avg']}")
    print("\n  ↑ 差异不等于要照抄。抄之前先问：这条差异是这个赛道的共性，还是这一支的个性？"
          "\n    单支视频只能提假设，攒够 3–5 支同赛道的才谈得上改 theme 基线。")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    pf = sub.add_parser("fetch", help="下载/导入视频，抽帧并算逐帧视觉指标")
    pf.add_argument("target", help="分享链接、分享口令文本或本地视频路径")
    pf.add_argument("--window", help="只看某个时间段，如 120-300（秒）。长视频里已知哪段有插片时用")
    pf.set_defaults(func=cmd_fetch)
    pt = sub.add_parser("tokens", help="对选中的 b-roll 帧反推设计令牌")
    pt.add_argument("--id", required=True)
    pt.add_argument("--frames", required=True, help="时间码逗号分隔，如 3.2,7.8,12.4")
    pt.set_defaults(func=cmd_tokens)
    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
