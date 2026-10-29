#!/usr/bin/env python3
"""/learn 的确定性飞书 I/O：查可学习行 + 下载定稿文档并剥离页眉页脚，学完批量勾「已学习」。

fetch   查脚本表 状态∈{已定稿,已拍摄} 且 已学习=false 的行；逐行用 docs +fetch 拉
        定稿文档 markdown，剥离文首标题/研究材料链接、文末「## 评审结果」段，
        存 workspace/scripts/{灵感id}-v{n}-final.md（飞书全文不经过模型上下文）。
        输出 workspace/learn/{date}-digest.md（行清单 + 两版文件路径 + AI 分数）
        和 {date}-pending.json（record_id 映射）。
commit  按脚本id 勾选「已学习」：python3 tools/learn_io.py commit SC-0001 SC-0002

用法：
    python3 tools/learn_io.py fetch [--id SC-0002]
    python3 tools/learn_io.py commit SC-0001 [SC-0002 ...] [--dry-run]
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lark_io import (load_feishu_config, list_records, update_record,  # noqa: E402
                     fetch_doc_markdown, url_cell_to_link)

LEARNABLE_STATUSES = ("已定稿", "已拍摄")


def first_str(v) -> str:
    if isinstance(v, list):
        return str(v[0]) if v else ""
    return str(v) if v is not None else ""


def strip_doc_chrome(md: str) -> str:
    """剥离落库时由 produce_io 附加的部分：文首 H1 标题、「研究材料」引用行、
    文末「## 评审结果」段、/package 追加的「## 创意方案」段、/cover 追加的
    「## 封面方案」段和 /broll 追加的「## 素材包」段（含其前的分隔线），
    还原成与本地 AI 版可比的纯脚本。

    ⚠️ 新增会追加到文档末尾的节时，这里必须同步加——否则 /learn 的定稿对比会把
    附加节当正文，package_io.fetch 产出的 -final.md 也会脏。"""
    text = md.strip()
    lines = text.split("\n")
    while lines and (not lines[0].strip()
                     or re.match(r"^<title>.*</title>\s*$", lines[0])
                     or re.match(r"^#\s*【脚本】", lines[0])
                     or re.match(r"^>?\s*研究材料[:：]", lines[0].lstrip("> "))):
        lines.pop(0)
    text = "\n".join(lines).strip()
    cuts = [m.start() for m in
            (re.search(r"\n(?:-{3,}\s*\n+)?##\s*评审结果\b", text),
             re.search(r"\n(?:-{3,}\s*\n+)?##\s*创意方案", text),
             re.search(r"\n(?:-{3,}\s*\n+)?##\s*封面方案", text),
             re.search(r"\n(?:-{3,}\s*\n+)?##\s*素材包", text)) if m]
    if cuts:
        text = text[:min(cuts)].rstrip().rstrip("-").rstrip()
    return text + "\n"


def cmd_fetch(args):
    cfg = load_feishu_config()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    Path("workspace/scripts").mkdir(parents=True, exist_ok=True)

    conditions = [["状态", "intersects", list(LEARNABLE_STATUSES)]]
    if args.id:
        conditions.append(["脚本id", "==", args.id])
    rows = list_records(cfg, cfg["script_table"],
                        ["脚本id", "关联灵感id", "版本号", "标题", "脚本文档URL",
                         "评估总分", "已学习", "状态"],
                        filter_json={"logic": "and", "conditions": conditions})
    rows = [r for r in rows if not r.get("已学习")]
    if not rows:
        print("没有可学习的行。先在飞书把满意的脚本状态改为「已定稿」。")
        return 0

    lines = [f"# 学习清单 {args.date}：{len(rows)} 行", "",
             "（final = 人工定稿剥离页眉页脚后的版本；AI 版缺失的行跳过学习并汇报）", ""]
    index = []
    for r in rows:
        sid = first_str(r.get("脚本id"))
        iid = first_str(r.get("关联灵感id"))
        ver = int(float(r.get("版本号") or 0))
        ai_path = Path(f"workspace/scripts/{iid}-v{ver}.md")
        final_path = Path(f"workspace/scripts/{iid}-v{ver}-final.md")
        doc_url = url_cell_to_link(r.get("脚本文档URL"))
        problem = ""
        if not doc_url:
            problem = "脚本文档URL为空，无法取定稿"
        else:
            try:
                final_path.write_text(strip_doc_chrome(fetch_doc_markdown(doc_url)),
                                      encoding="utf-8")
            except RuntimeError as e:
                problem = f"文档下载失败：{e}"
        if not problem and not ai_path.exists():
            problem = f"AI 版缺失（{ai_path}），无法对比"
        mark = f"❌ {problem}" if problem else "✅"
        lines.append(f"- {sid}｜{iid} v{ver}｜AI 分 {r.get('评估总分')}｜{mark}")
        if not problem:
            lines.append(f"  - AI 版: {ai_path}")
            lines.append(f"  - 定稿版: {final_path}")
        index.append({"脚本id": sid, "灵感id": iid, "版本号": ver,
                      "record_id": r["_record_id"], "AI分": r.get("评估总分"),
                      "可学习": not problem, "问题": problem or None})

    digest = out_dir / f"{args.date}-digest.md"
    digest.write_text("\n".join(lines), encoding="utf-8")
    (out_dir / f"{args.date}-pending.json").write_text(
        json.dumps({"date": args.date, "items": index}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    ok = sum(1 for i in index if i["可学习"])
    print(f"可学习 {ok} 行｜有问题 {len(index) - ok} 行")
    print(f"输出: {digest}")
    return 0


def cmd_commit(args):
    if not args.ids:
        print("❌ commit 需要至少一个脚本id", file=sys.stderr)
        return 1
    pending_path = Path(args.out_dir) / f"{args.date}-pending.json"
    if not pending_path.exists():
        print(f"❌ 找不到 {pending_path}，先运行 fetch", file=sys.stderr)
        return 1
    index = {i["脚本id"]: i for i in
             json.loads(pending_path.read_text(encoding="utf-8"))["items"]}
    unknown = [s for s in args.ids if s not in index]
    if unknown:
        print(f"❌ 不在本次学习清单里: {unknown}", file=sys.stderr)
        return 1
    cfg = load_feishu_config()
    for sid in args.ids:
        update_record(cfg, cfg["script_table"], index[sid]["record_id"],
                      {"已学习": True}, dry_run=args.dry_run)
    tag = "[dry-run] " if args.dry_run else ""
    print(f"{tag}已勾选「已学习」{len(args.ids)} 行: {', '.join(args.ids)}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="/learn 的飞书读写")
    ap.add_argument("mode", choices=["fetch", "commit"])
    ap.add_argument("ids", nargs="*", help="commit：要勾「已学习」的脚本id")
    ap.add_argument("--id", help="fetch：只学这一条脚本id")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--out-dir", default="workspace/learn")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    return cmd_fetch(args) if args.mode == "fetch" else cmd_commit(args)


if __name__ == "__main__":
    sys.exit(main())
