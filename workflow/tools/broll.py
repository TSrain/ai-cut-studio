#!/usr/bin/env python3
"""B-roll 素材直链解析（零依赖，python3 标准库）。

⚠️ **在 /broll 阶段跑**（package 分镜批准之后）。/produce 与 /revise 一律不调用本工具——
脚本正文一改，素材就作废，提前找纯属浪费时间和额度；/produce 的画面产出只是正文里紧跟
口播段的一行 `> 🎬 一句话理想画面`，由 /package 逐镜路由后**自己生成** ```broll``` 块再喂给本工具。

读输入 .md 里的 ```broll``` 机读块（/package 写的分镜→英文关键词清单，通常只含实拍型镜头），
调免费图库 API（Pexels 主 / Pixabay 备）把关键词解析成可下载的视频/图片**直链**，
连同源文章图（引用类）和搜索兜底深链，回写进该文件「## B-roll 素材直链(自动)」节，
并在同目录落一份 sidecar json。无 key 时优雅降级：只输出源图 + 搜索深链。

```broll``` 块格式（/package 产出，见 .claude/commands/package.md 第 6 步）：
    ```broll
    [
      {"分镜":"开头钩子(0-8s)","类型":["视频"],"关键词":["delete app from phone","home screen swipe"],"源图URL":null},
      {"分镜":"入口之争(50-75s)","类型":["图"],"关键词":["apple google deal"],"源图URL":"https://.../x.png"}
    ]
    ```

用法：
    python3 tools/broll.py --script workspace/package/SC-0021-package.md
    python3 tools/broll.py --script <素材包.md> [--provider pexels|pixabay] [--per-beat 3] [--no-net]

key 来源（任一）：环境变量 BROLL_API_KEY / BROLL_PEXELS_KEY / BROLL_PIXABAY_KEY，
或 config/broll.secret（`pexels: <key>` / `pixabay: <key>`，或整行就是 key）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRET_FILE = ROOT / "config" / "broll.secret"
CONFIG_FILE = ROOT / "config" / "broll.md"
AUTO_HEADING = "## B-roll 素材直链(自动)"
UA = "zimeiti-broll/1.0"
DEFAULTS = {"provider": "pexels", "per_beat": 8, "orientation": "portrait"}


def load_prefs() -> dict:
    """从 config/broll.md 读可选覆盖（`- key: value` 或 `key: value` 行），缺省用 DEFAULTS。"""
    prefs = dict(DEFAULTS)
    if CONFIG_FILE.exists():
        for line in CONFIG_FILE.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*-?\s*(provider|per_beat|orientation)\s*[:：]\s*(\S+)", line)
            if m:
                k, v = m.group(1), m.group(2).strip().strip("`")
                prefs[k] = int(v) if k == "per_beat" and v.isdigit() else v
    return prefs


def load_keys() -> dict:
    """返回 {'pexels': key, 'pixabay': key}（缺则不含该键）。"""
    keys = {}
    env_map = {"pexels": ["BROLL_PEXELS_KEY"], "pixabay": ["BROLL_PIXABAY_KEY"]}
    for prov, names in env_map.items():
        for n in names:
            if os.environ.get(n):
                keys[prov] = os.environ[n].strip()
    generic = os.environ.get("BROLL_API_KEY", "").strip()
    if SECRET_FILE.exists():
        for line in SECRET_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"^(pexels|pixabay)\s*[:：]\s*(\S+)", line, re.I)
            if m:
                keys[m.group(1).lower()] = m.group(2).strip()
            elif "generic" not in keys:
                keys["generic"] = line  # 整行当 key
    if generic and "generic" not in keys:
        keys["generic"] = generic
    return keys


def http_get_json(url: str, headers: dict | None = None, timeout: int = 20):
    # Connection: close 避免 archive.org 等站点 keep-alive 下的偶发 IncompleteRead
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Connection": "close",
                                               **(headers or {})})
    last = None
    for _ in range(2):  # 大响应（如 archive.org metadata）偶发 IncompleteRead，重试一次
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


# ---------- 图库适配 ----------

def pexels_search(query: str, key: str, want_video: bool, want_photo: bool,
                  n: int, orientation: str) -> list[dict]:
    out = []
    base_q = urllib.parse.quote(query)
    headers = {"Authorization": key}
    if want_video:
        url = (f"https://api.pexels.com/videos/search?query={base_q}"
               f"&per_page={n}&orientation={orientation}")
        data = http_get_json(url, headers)
        for v in data.get("videos", [])[:n]:
            files = v.get("video_files", [])
            # 选 <=1920 宽里最大的 mp4，退而求其次第一个
            mp4 = [f for f in files if (f.get("file_type") == "video/mp4")]
            pick = None
            cand = [f for f in mp4 if (f.get("width") or 0) <= 1920]
            pick = max(cand or mp4 or files, key=lambda f: f.get("width") or 0, default=None)
            if pick and pick.get("link"):
                out.append({"type": "视频", "url": pick["link"], "preview": v.get("image"),
                            "size": f'{pick.get("width")}x{pick.get("height")}',
                            "dur": v.get("duration"), "page": v.get("url"),
                            "license": "Pexels（免归属·可商用）"})
    if want_photo:
        url = (f"https://api.pexels.com/v1/search?query={base_q}"
               f"&per_page={n}&orientation={orientation}")
        data = http_get_json(url, headers)
        for p in data.get("photos", [])[:n]:
            src = p.get("src", {})
            if src.get("original"):
                out.append({"type": "图", "url": src["original"], "preview": src.get("medium"),
                            "large": src.get("large2x") or src.get("large"),
                            "size": f'{p.get("width")}x{p.get("height")}', "dur": None,
                            "page": p.get("url"), "license": "Pexels（免归属·可商用）"})
    return out


def pixabay_search(query: str, key: str, want_video: bool, want_photo: bool,
                   n: int, orientation: str | None = None, **_) -> list[dict]:
    out = []
    q = urllib.parse.quote(query)
    per = max(3, n)  # Pixabay per_page 最小 3
    ori = {"landscape": "horizontal", "portrait": "vertical"}.get(orientation or "", "all")
    if want_video:
        url = f"https://pixabay.com/api/videos/?key={key}&q={q}&per_page={per}"
        data = http_get_json(url)
        for v in data.get("hits", [])[:n]:
            vids = v.get("videos", {})
            f = vids.get("large") or vids.get("medium") or {}
            if f.get("url"):
                out.append({"type": "视频", "url": f["url"], "preview": (vids.get("medium") or {}).get("thumbnail"),
                            "size": f'{f.get("width")}x{f.get("height")}', "dur": v.get("duration"),
                            "page": v.get("pageURL"), "license": "Pixabay（免归属·可商用）"})
    if want_photo:
        url = f"https://pixabay.com/api/?key={key}&q={q}&per_page={per}&image_type=photo&orientation={ori}"
        data = http_get_json(url)
        for p in data.get("hits", [])[:n]:
            if p.get("largeImageURL"):
                out.append({"type": "图", "url": p["largeImageURL"], "preview": p.get("webformatURL"),
                            "large": p.get("largeImageURL"),
                            "size": f'{p.get("imageWidth")}x{p.get("imageHeight")}', "dur": None,
                            "page": p.get("pageURL"), "license": "Pixabay（免归属·可商用）"})
    return out


def wikimedia_search(query: str, want_video: bool, want_photo: bool, n: int) -> list[dict]:
    """Wikimedia Commons 免 key 直链检索。强项：具体实体（人物/logo/产品/历史事件）的
    授权安全图片，正好补图库的盲区。授权按条目而异，输出里带上，用时须按要求署名。"""
    out = []
    types = ([("bitmap|drawing", "图")] if want_photo else []) + \
            ([("video", "视频")] if want_video else [])
    for ft, label in types:
        params = urllib.parse.urlencode({
            "action": "query", "format": "json", "generator": "search",
            "gsrsearch": f"filetype:{ft} {query}", "gsrlimit": n, "gsrnamespace": 6,
            "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1600,
        })
        data = http_get_json(f"https://commons.wikimedia.org/w/api.php?{params}")
        pages = (data.get("query") or {}).get("pages") or {}
        for p in list(pages.values())[:n]:
            ii = (p.get("imageinfo") or [{}])[0]
            if not ii.get("url"):
                continue
            meta = ii.get("extmetadata") or {}
            lic = ((meta.get("LicenseShortName") or {}).get("value") or "见条目页").strip()
            out.append({"type": label, "url": ii["url"], "preview": ii.get("thumburl"),
                        "size": f'{ii.get("width")}x{ii.get("height")}', "dur": None,
                        "page": ii.get("descriptionurl"),
                        "license": f"Wikimedia Commons（{lic}·须按条目署名）"})
    return out


def archive_search(query: str, n: int = 2) -> list[dict]:
    """Internet Archive 公版影像（Prelinger 老电影档案），免 key。
    黑白老片段配吐槽的经典梗素材来源，公有领域完全免版权。"""
    out = []
    q = urllib.parse.quote(f"collection:(prelinger) AND mediatype:(movies) AND ({query})")
    url = (f"https://archive.org/advancedsearch.php?q={q}"
           f"&fl%5B%5D=identifier&fl%5B%5D=title&rows={n}&page=1&output=json")
    docs = ((http_get_json(url).get("response") or {}).get("docs") or [])[:n]
    for d in docs:
        ident = d.get("identifier")
        if not ident:
            continue
        files = http_get_json(f"https://archive.org/metadata/{ident}").get("files") or []
        mp4 = [f for f in files if str(f.get("name", "")).lower().endswith(".mp4")]
        pick = max(mp4, key=lambda f: int(f.get("size") or 0), default=None)
        if not pick:
            continue
        out.append({"type": "视频",
                    "url": f"https://archive.org/download/{ident}/{urllib.parse.quote(pick['name'])}",
                    "preview": None, "size": d.get("title") or "", "dur": None,
                    "page": f"https://archive.org/details/{ident}",
                    "license": "Internet Archive·Prelinger（公有领域·免版权）"})
    return out


def search_links(query: str, want_video: bool) -> list[str]:
    q = urllib.parse.quote(query)
    links = []
    if want_video:
        links.append(f"https://www.pexels.com/search/videos/{q}/")
        links.append(f"https://pixabay.com/videos/search/{q}/")
        links.append(f"https://mixkit.co/free-stock-video/?q={q}")
        links.append(f"https://coverr.co/s?q={q}")
        links.append(f"https://www.videvo.net/search/{q}/")
        # YouTube 知识共享(CC)过滤：可用素材需标注作者，yt-dlp 下载合规复用
        links.append(f"https://www.youtube.com/results?search_query={q}&sp=EgIwAQ%3D%3D")
    else:
        links.append(f"https://www.pexels.com/search/{q}/")
        links.append(f"https://pixabay.com/images/search/{q}/")
        links.append(f"https://commons.wikimedia.org/w/index.php?search={q}"
                     f"&title=Special:MediaSearch&type=image")
    return links


# ---------- 主流程 ----------

def parse_broll_block(text: str) -> list[dict] | None:
    m = re.search(r"```broll\s*\n(.*?)```", text, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
        return data if isinstance(data, list) else None
    except json.JSONDecodeError as e:
        print(f"❌ ```broll``` 块不是合法 JSON：{e}", file=sys.stderr)
        return None


def source_host(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc or "源文章"
    except ValueError:
        return "源文章"


def _size_pair(value: object) -> tuple[int, int]:
    match = re.match(r"^\s*(\d+)x(\d+)\s*$", str(value or ""), re.I)
    return (int(match.group(1)), int(match.group(2))) if match else (0, 0)


def _technical_quality(hit: dict, orientation: str) -> float:
    """只做技术初筛；语义是否贴合仍必须由 /package 实际看预览。"""
    width, height = _size_pair(hit.get("size"))
    score = min(width * height, 1080 * 1920) / (1080 * 1920) if width and height else 0
    if orientation == "portrait":
        score += 3 if height > width else -2
    elif orientation == "landscape":
        score += 3 if width > height else -2
    elif orientation == "square" and width and height:
        score += max(0, 2 - abs(width - height) / max(width, height) * 4)
    if hit.get("preview"):
        score += 1
    if hit.get("page"):
        score += 0.2
    if hit.get("type") == "视频":
        try:
            duration = float(hit.get("dur"))
        except (TypeError, ValueError):
            duration = 0
        if 3 <= duration <= 12:
            score += 1
        elif 1.5 <= duration <= 20:
            score += 0.4
        elif duration:
            score -= 0.5
    return score


def shortlist_candidates(hits: list[dict], orientation: str, limit: int = 8) -> list[dict]:
    """保留短边至少 720px 的候选；0 表示全部，排序不代替用户选材。"""
    qualified = [hit for hit in hits if min(_size_pair(hit.get("size"))) >= 720]
    ranked = sorted(enumerate(qualified), key=lambda pair: (-_technical_quality(pair[1], orientation), pair[0]))
    choices = []
    labels = ("主选", "备选")
    selected = ranked if limit == 0 else ranked[:max(0, limit)]
    for rank, (_, hit) in enumerate(selected):
        item = dict(hit)
        item["choice"] = labels[rank] if rank < 2 else f"候选{rank + 1}"
        item["quality_status"] = "metadata_pass_pending_file_probe"
        item["technical_score"] = round(_technical_quality(item, orientation), 3)
        choices.append(item)
    return choices


def resolve_beat(beat: dict, prov: str, key: str | None, prefs: dict, no_net: bool,
                 extra: bool = True) -> dict:
    types = beat.get("类型") or ["视频"]
    want_video = "视频" in types
    want_photo = "图" in types
    kws = [k for k in (beat.get("关键词") or []) if str(k).strip()]
    zh_kws = [k for k in (beat.get("中文关键词") or []) if str(k).strip()]
    result = {"分镜": beat.get("分镜", "?"), "理想画面": beat.get("理想画面") or "",
              "源图": [], "直链": [], "搜索兜底": [], "关键词": kws, "中文关键词": zh_kws}

    src = beat.get("源图URL")
    if src:
        result["源图"].append({"url": src, "出处": source_host(src),
                              "note": "引用类，建议画面标注来源"})

    seen = set()
    for kw in kws:
        result["搜索兜底"] += [l for l in search_links(kw, want_video) if l not in seen]
        seen.update(result["搜索兜底"])
        if no_net or not key:
            continue
        try:
            fn = pexels_search if prov == "pexels" else pixabay_search
            hits = fn(kw, key, want_video, want_photo, prefs["per_beat"], orientation=prefs["orientation"])
            for h in hits:
                if h["url"] not in seen:
                    h["关键词"] = kw
                    result["直链"].append(h)
                    seen.add(h["url"])
        except Exception as e:  # noqa: BLE001 网络/限流/解析失败都降级，不阻断
            result.setdefault("warnings", []).append(f"{prov} 检索 “{kw}” 失败：{e}")

    # 免 key 公共源（不依赖 config/broll.secret，降级模式也能出直链）
    if extra and not no_net and kws:
        try:
            for h in wikimedia_search(kws[0], want_video, want_photo, 2):
                if h["url"] not in seen:
                    h["关键词"] = kws[0]
                    result["直链"].append(h)
                    seen.add(h["url"])
        except Exception as e:  # noqa: BLE001
            result.setdefault("warnings", []).append(f"wikimedia 检索失败：{e}")
        if want_video:
            try:
                for h in archive_search(kws[0], 2):
                    if h["url"] not in seen:
                        h["关键词"] = kws[0]
                        result["直链"].append(h)
                        seen.add(h["url"])
            except Exception as e:  # noqa: BLE001
                result.setdefault("warnings", []).append(f"archive.org 检索失败：{e}")
    hits = result["直链"]
    result["待核验"] = [h for h in hits if min(_size_pair(h.get("size"))) == 0]
    result["低清剔除数"] = sum(0 < min(_size_pair(h.get("size"))) < 720 for h in hits)
    result["直链"] = shortlist_candidates(hits, prefs.get("orientation", "portrait"),
                                          limit=prefs.get("candidate_limit", 8))
    return result


def render_section(beats: list[dict], degraded: bool) -> str:
    lines = [AUTO_HEADING, ""]
    if degraded:
        lines += ["> ⚠️ 未配置图库 API key（config/broll.secret），本节只给源文章图 + 搜索兜底链接。",
                  "> 配 key 后重跑 `python3 tools/broll.py --script <脚本>` 可换成可下载直链。", ""]
    lines += ["> 图库直链：Pexels/Pixabay 免归属·可商用；Wikimedia Commons 须按条目署名；"
              "Internet Archive·Prelinger 公有领域免版权。源文章图/官方素材为引用类，建议画面标注来源。",
              "> 搜索兜底里的 YouTube 链接已带知识共享(CC)过滤：选中的视频用 yt-dlp 下载、成片标注原作者即合规。", ""]
    for b in beats:
        lines.append(f"### {b['分镜']}")
        if b.get("理想画面"):
            lines.append(f"- 理想画面：{b['理想画面']}")
        if b["源图"]:
            for s in b["源图"]:
                lines.append(f"- 源图(引用)：{s['url']} ｜ 出处 {s['出处']}｜{s['note']}")
        for h in b["直链"]:
            dur = f"｜{h['dur']}s" if h.get("dur") else ""
            choice = h.get("choice") or "候选"
            preview = f"｜预览：{h['preview']}" if h.get("preview") else "｜预览：无"
            lines.append(f"- {choice}[{h['type']}]：{h['url']} ｜ {h['size']}{dur}｜{h['license']}"
                         f"｜关键词「{h.get('关键词','')}」{preview}")
        for h in b.get("待核验", []):
            lines.append(f"- 待核验尺寸（不计合格交付）：{h['url']}")
        if b.get("低清剔除数"):
            lines.append(f"- 已剔除短边低于 720px 的候选：{b['低清剔除数']} 条")
        if b["搜索兜底"]:
            lines.append(f"- 搜索兜底：{' ｜ '.join(b['搜索兜底'][:6])}")
        if b.get("中文关键词"):
            lines.append(f"- 剪映备选：剪映素材库搜「{' / '.join(b['中文关键词'])}」，与上面直链自行对比，更好就用剪映的")
        for w in b.get("warnings", []):
            lines.append(f"- ⚠️ {w}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_back(text: str, section: str) -> str:
    # 去掉旧的自动节（幂等），再插到「## B-roll / 配图建议」节之后，找不到则追加末尾
    text = re.sub(rf"\n{re.escape(AUTO_HEADING)}.*?(?=\n## |\Z)", "\n", text, flags=re.S).rstrip() + "\n"
    anchor = re.search(r"\n## B-roll[^\n]*\n", text)
    if anchor:
        nxt = re.search(r"\n## ", text[anchor.end():])
        pos = anchor.end() + (nxt.start() if nxt else len(text) - anchor.end())
        return text[:pos].rstrip() + "\n\n" + section + "\n" + text[pos:].lstrip("\n")
    return text.rstrip() + "\n\n" + section


def main():
    ap = argparse.ArgumentParser(description="B-roll 素材直链解析")
    ap.add_argument("--script", required=True)
    ap.add_argument("--provider", choices=["pexels", "pixabay"])
    ap.add_argument("--per-beat", type=int)
    ap.add_argument("--candidate-limit", type=int, default=8,
                    help="每镜保留的高清候选数，默认 8；0 保留全部检索到的合格候选")
    ap.add_argument("--no-net", action="store_true", help="不调网络，只出源图+搜索链接（测试用）")
    ap.add_argument("--no-extra", action="store_true",
                    help="跳过免 key 公共源（Wikimedia Commons / Internet Archive）")
    args = ap.parse_args()
    if args.candidate_limit < 0:
        ap.error("--candidate-limit 必须 >= 0")

    script_path = Path(args.script)
    if not script_path.exists():
        print(f"❌ 脚本不存在：{script_path}", file=sys.stderr)
        return 1
    text = script_path.read_text(encoding="utf-8")
    beats = parse_broll_block(text)
    if beats is None:
        print("⚠️ 文件里没有 ```broll``` 块，跳过 B-roll 解析。"
              "（本工具在 /broll 阶段消费已批准方案的 broll 块；"
              "/produce 的脚本按设计不含该块，画面只有正文里的 `> 🎬` 行。）")
        return 0

    prefs = load_prefs()
    prefs["candidate_limit"] = args.candidate_limit
    if args.per_beat:
        prefs["per_beat"] = args.per_beat
    keys = load_keys()
    prov = args.provider or prefs["provider"]
    key = keys.get(prov) or keys.get("generic")
    if prov == "pixabay" and "pixabay" in keys:
        key = keys["pixabay"]
    if prov == "pexels" and "pexels" in keys:
        key = keys["pexels"]
    degraded = args.no_net or not key

    resolved = [resolve_beat(b, prov, key, prefs, args.no_net, extra=not args.no_extra)
                for b in beats]
    section = render_section(resolved, degraded)
    script_path.write_text(write_back(text, section), encoding="utf-8")

    # sidecar 落在输入文件同目录（/package 的素材包 → workspace/package/）
    sidecar = script_path.with_name(f"{script_path.stem}-broll.json")
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    sidecar.write_text(json.dumps({"script": str(script_path), "provider": prov,
                                   "degraded": degraded, "beats": resolved},
                                  ensure_ascii=False, indent=1), encoding="utf-8")

    n_links = sum(len(b["直链"]) for b in resolved)
    n_src = sum(len(b["源图"]) for b in resolved)
    tag = "（降级：无 key/无网）" if degraded else ""
    print(f"✅ B-roll 解析完成{tag}：{len(resolved)} 个分镜，源图 {n_src} 条，图库直链 {n_links} 条")
    print(f"   写回 {script_path}｜sidecar {sidecar}")
    if degraded and not args.no_net:
        print("   ℹ️ 配 config/broll.secret 后重跑可得可下载直链。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
