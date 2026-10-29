#!/usr/bin/env python3
"""/package 与 /broll 共用的确定性飞书 I/O：定稿后的取数与落库。

fetch    按脚本id 查脚本表最新版本行 + 关联灵感行，下载定稿文档并剥离页眉页脚
         （复用 learn_io.strip_doc_chrome），存 workspace/package/{脚本id}-final.md；
         输出 -digest.md（元信息 + 判断素材是否需更新所需的上下文与路径）和
         -pending.json（record_id / 文档URL 映射，供 commit 引用）。
commit   把编排层写好的文件包上「## {--section}（日期 · 对照 vN 定稿）」标题，
         追加到脚本飞书文档末尾；带 --title 时顺带更新脚本表最新版本行的「标题」字段。
         `--section 创意方案` 给 /package（分镜 + 创意方案 + 关键帧），
         `--section 封面方案` 给 /cover（封面候选 + 标题），
         `--section 素材包` 给 /broll（真实时间轴 + 成片 + 素材 + 配乐卡点）。
         不新增版本行、不改状态；/learn 的定稿对比会自动剥离这些附录节。

用法：
    python3 tools/package_io.py fetch --id SC-0003
    python3 tools/package_io.py commit --id SC-0003 --section 创意方案 \
                                --package workspace/package/SC-0003-plan.md [--title "新标题"]
    python3 tools/package_io.py commit --id SC-0003 --section 封面方案 \
                                --package workspace/covers/SC-0003-cover.md [--title "新标题"]
    python3 tools/package_io.py commit --id SC-0003 --section 素材包 \
                                --package workspace/broll/SC-0003-broll.md [--dry-run]
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lark_io import (load_feishu_config, list_records, update_record,  # noqa: E402
                     append_doc_markdown, delete_doc_blocks, fetch_doc_fragment,
                     fetch_doc_markdown, url_cell_to_link)
from learn_io import strip_doc_chrome  # noqa: E402

OUT_DIR = Path("workspace/package")


def first_str(v) -> str:
    if isinstance(v, list):
        return str(v[0]) if v else ""
    return str(v) if v is not None else ""


def to_int(v) -> int:
    try:
        return int(float(first_str(v) or 0))
    except ValueError:
        return 0


def fetch_latest_script_row(cfg, sid: str) -> dict | None:
    rows = list_records(cfg, cfg["script_table"],
                        ["脚本id", "关联灵感id", "版本号", "标题", "脚本文档URL",
                         "研究文档URL", "状态", "创作参数"],
                        filter_json={"logic": "and",
                                     "conditions": [["脚本id", "==", sid]]})
    if not rows:
        return None
    return max(rows, key=lambda r: to_int(r.get("版本号")))


def cmd_fetch(args):
    sid = args.id
    cfg = load_feishu_config()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    row = fetch_latest_script_row(cfg, sid)
    if row is None:
        print(f"❌ 脚本表找不到 脚本id={sid}", file=sys.stderr)
        return 1
    iid = first_str(row.get("关联灵感id"))
    ver = to_int(row.get("版本号"))
    status = first_str(row.get("状态"))
    title = first_str(row.get("标题"))
    doc_url = url_cell_to_link(row.get("脚本文档URL"))
    if not doc_url:
        print(f"❌ {sid} v{ver} 的「脚本文档URL」为空，无定稿可打包", file=sys.stderr)
        return 1

    insp = {}
    if iid:
        insp_rows = list_records(cfg, cfg["insp_table"],
                                 ["灵感id", "选题方向", "选题名候选", "脚本撰写意见"],
                                 filter_json={"logic": "and",
                                              "conditions": [["灵感id", "==", iid]]},
                                 max_records=5)
        insp = insp_rows[0] if insp_rows else {}

    raw_md = fetch_doc_markdown(doc_url)
    final_path = OUT_DIR / f"{sid}-final.md"
    final_path.write_text(strip_doc_chrome(raw_md), encoding="utf-8")

    ai_path = Path(f"workspace/scripts/{iid}-v{ver}.md")
    has_broll_block = "```broll" in raw_md
    has_link_section = "## B-roll 素材直链(自动)" in raw_md
    has_old_package = re.search(r"\n##\s*素材包", raw_md) is not None
    has_old_plan = re.search(r"\n##\s*创意方案", raw_md) is not None
    has_old_cover = re.search(r"\n##\s*封面方案", raw_md) is not None
    shots_path = OUT_DIR / f"{sid}-shots.json"

    warns = []
    if status != "已定稿":
        warns.append(f"⚠️ 状态是「{status or '（空）'}」而非「已定稿」——请先向用户确认要不要继续")
    if not ai_path.exists():
        warns.append(f"⚠️ AI 版缺失（{ai_path}），无法做定稿 diff，只能按定稿全文独立判断")
    if has_old_plan:
        warns.append("⚠️ 文档里已有「创意方案」节（此前跑过 /package），本次会追加新节，旧节保留作历史")
    if has_old_cover:
        warns.append("⚠️ 文档里已有「封面方案」节（此前跑过 /cover），本次会追加新节，旧节保留作历史")
    if has_old_package:
        warns.append("⚠️ 文档里已有「素材包」节（此前跑过 /broll），本次会追加新节，旧节保留作历史")

    lines = [f"# 素材包取数 {sid}", "",
             f"- 脚本id｜灵感id｜版本：{sid}｜{iid}｜v{ver}",
             f"- 状态：{status}",
             f"- 当前标题：{title}",
             f"- 脚本文档：{doc_url}",
             f"- 选题方向：{first_str(insp.get('选题方向'))}",
             f"- 选题名候选（/score 旧候选，仅参考）：{first_str(insp.get('选题名候选'))}",
             f"- 脚本撰写意见：{first_str(insp.get('脚本撰写意见'))}",
             f"- 创作参数：{first_str(row.get('创作参数'))}",
             "",
             f"- 定稿版（已剥离页眉页脚）：{final_path}",
             f"- AI 版（diff 基线）：{ai_path}{'' if ai_path.exists() else '（缺失）'}",
             f"- 定稿含 broll 关键词块：{'是' if has_broll_block else '否（可能被人工删除，需按定稿分镜重建）'}",
             f"- 文档已有 B-roll 直链节：{'是' if has_link_section else '否'}",
             f"- 分镜创意方案 shots.json：{shots_path if shots_path.exists() else '未产出（/broll 需要它，先跑 /package）'}",
             ""]
    lines += warns
    digest = OUT_DIR / f"{sid}-digest.md"
    digest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT_DIR / f"{sid}-pending.json").write_text(json.dumps({
        "脚本id": sid, "灵感id": iid, "版本号": ver, "状态": status,
        "标题": title, "record_id": row["_record_id"], "脚本文档URL": doc_url,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"输出: {digest}")
    for w in warns:
        print(w)
    return 0


def cmd_commit(args):
    sid = args.id
    pending_path = OUT_DIR / f"{sid}-pending.json"
    if not pending_path.exists():
        print(f"❌ 找不到 {pending_path}，先运行 fetch", file=sys.stderr)
        return 1
    pending = json.loads(pending_path.read_text(encoding="utf-8"))
    pkg_path = Path(args.package)
    if not pkg_path.exists():
        print(f"❌ 素材包文件不存在: {pkg_path}", file=sys.stderr)
        return 1

    cfg = load_feishu_config()
    date = datetime.date.today().isoformat()
    section = args.section
    body = (f"---\n\n## {section}（{date} · 对照 v{pending['版本号']} 定稿）\n\n"
            + pkg_path.read_text(encoding="utf-8").strip())
    append_doc_markdown(pending["脚本文档URL"], body, dry_run=args.dry_run)

    if args.title and args.title != pending["标题"]:
        update_record(cfg, cfg["script_table"], pending["record_id"],
                      {"标题": args.title}, dry_run=args.dry_run)

    tag = "[dry-run] " if args.dry_run else ""
    print(f"{tag}{section}已追加 → {pending['脚本文档URL']}")
    if args.title and args.title != pending["标题"]:
        print(f"{tag}脚本表标题已更新：{pending['标题']} → {args.title}")
    return 0


SECTION_RE = re.compile(r"^(创意方案|封面方案|素材包)（[^）]*）\s*$")
_TAG_RE = re.compile(r"<(/?)([a-zA-Z][\w-]*)((?:\s[^>]*?)?)(/?)>")


def _outline_h2(doc_url: str) -> list:
    """返回文档所有 h2：[(block_id, 文本)]，顺序即文档顺序。"""
    frag = fetch_doc_fragment(doc_url, scope="outline")
    return [(m.group(1), re.sub(r"<[^>]+>", "", m.group(2)))
            for m in re.finditer(r'<h2 id="(doxcn[^"]+)">(.*?)</h2>', frag, re.S)]


def _section_toplevel_ids(doc_url: str, start_block_id: str) -> list:
    """取某 h2 章节内所有**顶层** block id（跳过表格单元格等嵌套子块）。"""
    frag = fetch_doc_fragment(doc_url, scope="section", start_block_id=start_block_id)
    inner = frag[frag.index(">", frag.index("<fragment")) + 1:]
    ids, depth = [], 0
    for m in _TAG_RE.finditer(inner):
        closing, tag, attrs, self_close = m.group(1), m.group(2), m.group(3), m.group(4)
        if tag == "fragment":
            continue
        if closing:
            depth -= 1
            continue
        if depth == 0:
            mid = re.search(r'id="(doxcn[^"]+)"', attrs or "")
            if mid:
                ids.append(mid.group(1))
        if not self_close:
            depth += 1
    return ids


def cmd_cleanup(args):
    """删除文档里过期的「创意方案 / 封面方案 / 素材包」节，每类只保留最后一份。"""
    cfg = load_feishu_config()
    row = fetch_latest_script_row(cfg, args.id)
    if not row:
        print(f"未找到脚本 {args.id}", file=sys.stderr)
        return 1
    doc_url = url_cell_to_link(row.get("脚本文档URL"))

    h2s = _outline_h2(doc_url)
    targets = [(i, bid, txt) for i, (bid, txt) in enumerate(h2s)
               if SECTION_RE.match(txt.strip())]
    if not targets:
        print("文档里没有「创意方案 / 封面方案 / 素材包」节")
        return 0
    by_name = {}
    for i, bid, txt in targets:
        by_name.setdefault(SECTION_RE.match(txt.strip()).group(1), []).append((i, bid, txt))
    stale = [x for lst in by_name.values() for x in lst[:-1]]
    kept = [lst[-1] for lst in by_name.values()]

    print(f"共 {len(targets)} 节 → 保留 {len(kept)} 节，删除 {len(stale)} 节")
    for _, bid, txt in kept:
        print(f"  ✅ 保留 {txt}  [{bid}]")
    plans = []
    for _, bid, txt in stale:
        ids = _section_toplevel_ids(doc_url, bid)
        plans.append((txt, ids))
        print(f"  🗑 删除 {txt}  [{bid}] → {len(ids)} 个顶层 block")
    if args.dry_run:
        print("[dry-run] 未执行删除")
        return 0
    for txt, ids in reversed(plans):
        delete_doc_blocks(doc_url, ids)
        print(f"  已删 {txt}（{len(ids)} block）")
    print(f"✅ 整理完成 → {doc_url}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="/package 与 /broll 的飞书读写")
    ap.add_argument("mode", choices=["fetch", "commit", "cleanup"])
    ap.add_argument("--id", required=True, help="脚本id，如 SC-0003")
    ap.add_argument("--package", help="commit：要追加的 markdown 文件路径")
    ap.add_argument("--section", default="素材包", choices=["创意方案", "封面方案", "素材包"],
                    help="commit：追加节的标题（/package 传「创意方案」，/cover 传「封面方案」，/broll 传「素材包」）")
    ap.add_argument("--title", help="commit：同时把脚本表「标题」改为该值")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.mode == "commit" and not args.package:
        ap.error("commit 需要 --package")
    if args.mode == "fetch":
        return cmd_fetch(args)
    if args.mode == "cleanup":
        return cmd_cleanup(args)
    return cmd_commit(args)


if __name__ == "__main__":
    sys.exit(main())
