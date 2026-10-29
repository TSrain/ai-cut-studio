#!/usr/bin/env python3
"""lark-cli 的轻量 Python 封装，供 tools/ 下确定性脚本共用（零第三方依赖）。

提供：读 config/feishu.md 拿 ID、分页查记录（字段投影+过滤）、批量建行。
Agent 不应直接 import 本文件做即兴查询——交互式查询仍走 lark-cli 命令行；
本文件只服务 dedup_sources.py / commit_selection.py 这类固定流程脚本。
"""
import json
import re
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FEISHU_CONFIG = PROJECT_ROOT / "config" / "feishu.md"

PAGE_SIZE = 200          # record-list 单页上限
BATCH_CREATE_SIZE = 100  # 批量建行每批条数（接口上限 200，留余量）


def load_feishu_config() -> dict:
    """从 config/feishu.md 解析 app_token 和 3 个 table_id。"""
    text = FEISHU_CONFIG.read_text(encoding="utf-8")

    def grab(label: str) -> str:
        m = re.search(rf"\|\s*{re.escape(label)}[^|]*\|\s*`([^`]+)`", text)
        if not m:
            raise RuntimeError(f"config/feishu.md 中找不到「{label}」，请先运行 /setup-feishu")
        return m.group(1)

    return {
        "app_token": grab("app_token"),
        "raw_table": grab("原始数据表"),
        "insp_table": grab("灵感表"),
        "script_table": grab("脚本管理表"),
        "folder_token": grab("脚本库 folder_token"),
    }


def run_lark(args: list, timeout: int = 90) -> dict:
    """运行 lark-cli 子命令，返回解析后的 JSON（统一 --as user --format json）。"""
    cmd = ["lark-cli", *args, "--as", "user", "--format", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"lark-cli 失败: {' '.join(args[:3])}…\n{proc.stderr.strip()[:500]}")
    data = json.loads(proc.stdout)
    if not data.get("ok", True):
        raise RuntimeError(f"lark-cli 返回 ok=false: {json.dumps(data, ensure_ascii=False)[:500]}")
    return data


def list_records(cfg: dict, table_id: str, fields: list,
                 filter_json=None, sort_json=None,
                 max_records: int = 2000) -> list:
    """分页拉记录，返回 [{字段名: 值, "_record_id": ...}]。值保持 lark 原始形态
    （URL 字段是 "[text](link)"，多选/单选可能是数组）。"""
    out, offset = [], 0
    while len(out) < max_records:
        args = ["base", "+record-list",
                "--base-token", cfg["app_token"], "--table-id", table_id,
                "--limit", str(PAGE_SIZE), "--offset", str(offset)]
        for f in fields:
            args += ["--field-id", f]
        if filter_json:
            args += ["--filter-json", json.dumps(filter_json, ensure_ascii=False)]
        if sort_json:
            args += ["--sort-json", json.dumps(sort_json, ensure_ascii=False)]
        data = run_lark(args)["data"]
        names = data.get("fields") or fields
        rows = data.get("data") or []
        rids = data.get("record_id_list") or [None] * len(rows)
        for row, rid in zip(rows, rids):
            rec = dict(zip(names, row))
            rec["_record_id"] = rid
            out.append(rec)
        if not data.get("has_more") or not rows:
            break
        offset += len(rows)
    return out


def batch_create(cfg: dict, table_id: str, field_names: list, rows: list,
                 dry_run: bool = False) -> int:
    """批量建行（分批）。rows 为按 field_names 顺序的值数组列表。返回写入条数。"""
    written = 0
    for i in range(0, len(rows), BATCH_CREATE_SIZE):
        chunk = rows[i:i + BATCH_CREATE_SIZE]
        payload = json.dumps({"fields": field_names, "rows": chunk}, ensure_ascii=False)
        if dry_run:
            print(f"[dry-run] batch-create {table_id} {len(chunk)} 行:\n{payload[:2000]}")
        else:
            run_lark(["base", "+record-batch-create",
                      "--base-token", cfg["app_token"], "--table-id", table_id,
                      "--json", payload])
        written += len(chunk)
    return written


def batch_delete(cfg: dict, table_id: str, record_ids: list, dry_run: bool = False,
                 chunk: int = 100) -> int:
    """按 record_id 批量删行（分批）。高危写操作，仅供 prune_raw.py 这类
    显式清理脚本使用；调用方必须自己先做 --dry-run 展示。返回删除条数。"""
    deleted = 0
    for i in range(0, len(record_ids), chunk):
        ids = record_ids[i:i + chunk]
        if dry_run:
            print(f"[dry-run] record-delete {table_id} {len(ids)} 行")
        else:
            run_lark(["base", "+record-delete",
                      "--base-token", cfg["app_token"], "--table-id", table_id,
                      "--json", json.dumps({"record_id_list": ids}), "--yes"])
        deleted += len(ids)
    return deleted


def ensure_text_field(cfg: dict, table_id: str, name: str) -> None:
    """确保表里存在指定文本字段：直接尝试创建，已存在时创建失败并被忽略。
    真正的字段缺失问题会在随后的 batch_create 报出，不在这里吞掉。"""
    try:
        run_lark(["base", "+field-create",
                  "--base-token", cfg["app_token"], "--table-id", table_id,
                  "--json", json.dumps({"name": name, "type": "text"},
                                       ensure_ascii=False)])
    except RuntimeError:
        pass  # 字段已存在（或权限问题——后续写入会给出真实错误）


def update_record(cfg: dict, table_id: str, record_id: str, patch: dict,
                  dry_run: bool = False) -> None:
    """更新单条记录。batch-update 接口是同一份 patch 应用到多条，
    评分这类每行 patch 都不同的场景只能逐条调用（脚本里循环，不耗模型 token）。"""
    payload = json.dumps(patch, ensure_ascii=False)
    if dry_run:
        print(f"[dry-run] upsert {table_id} {record_id}:\n{payload[:1000]}")
        return
    # 用 record-upsert（单条 UpdateRecord 接口）而非 batch-update：
    # OpenAPIBatchUpdateRecords 接口有独立的低频率配额，逐行回写场景易被限流(800004135)，
    # upsert 走单记录更新接口、配额独立；带 --record-id 即为更新，--json 是顶层字段映射。
    run_lark(["base", "+record-upsert",
              "--base-token", cfg["app_token"], "--table-id", table_id,
              "--record-id", record_id, "--json", payload])


def create_doc(cfg: dict, title: str, body_md: str, dry_run: bool = False) -> str:
    """在「脚本库」文件夹下以 markdown 创建飞书文档，返回文档 URL。

    标题用 XML `<title>` 标签设置：markdown 模式下首个 `# H1` 不会被提取为文档标题
    （会留成「Untitled」并把 H1 塞进正文），而 `<title>` 标签即使在 markdown 模式也会
    被解析为文档标题。
    """
    import tempfile
    content = f"<title>{title}</title>\n\n{body_md.strip()}\n"
    if dry_run:
        print(f"[dry-run] docs +create 《{title}》（{len(content)} 字符）")
        return f"https://dry-run.example/{title}"
    # lark-cli 的 --content @file 要求是 cwd 内的相对路径，临时文件必须落在当前目录
    with tempfile.NamedTemporaryFile("w", suffix=".md", encoding="utf-8",
                                     dir=".", delete=False) as f:
        f.write(content)
        tmp = f.name
    rel = "./" + Path(tmp).name
    try:
        data = run_lark(["docs", "+create", "--api-version", "v2",
                         "--doc-format", "markdown",
                         "--parent-token", cfg["folder_token"],
                         "--content", f"@{rel}"], timeout=120)
    finally:
        Path(tmp).unlink(missing_ok=True)
    doc = (data.get("data") or {}).get("document") or data.get("data") or {}
    url = doc.get("url") or ""
    if not url:
        raise RuntimeError(f"docs +create 未返回 url: {json.dumps(data, ensure_ascii=False)[:300]}")
    return url


def _update_result(data: dict) -> tuple:
    """docs +update 的业务结果：lark-cli 可能 ok=true 但 data.result=failed（如 append 的
    block 定位降级），必须显式检查。返回 (result, warnings)。"""
    d = data.get("data") or {}
    return d.get("result"), d.get("warnings") or []


def _doc_last_block_id(doc_url: str) -> str:
    """取文档真实末尾 block id：先 outline 拿最后一个标题，再取该 section 的最后一个 block。"""
    data = run_lark(["docs", "+fetch", "--api-version", "v2", "--doc", doc_url,
                     "--scope", "outline", "--detail", "with-ids"], timeout=120)
    d = data.get("data") or {}
    content = (d.get("document") or {}).get("content") or d.get("content") or ""
    ids = re.findall(r'id="(doxcn[^"]+)"', content)
    if not ids:
        raise RuntimeError(f"无法从文档大纲取得 block id: {doc_url}")
    anchor = ids[-1]
    data = run_lark(["docs", "+fetch", "--api-version", "v2", "--doc", doc_url,
                     "--scope", "section", "--start-block-id", anchor,
                     "--detail", "with-ids"], timeout=120)
    d = data.get("data") or {}
    content = (d.get("document") or {}).get("content") or d.get("content") or ""
    ids2 = re.findall(r'id="(doxcn[^"]+)"', content)
    return ids2[-1] if ids2 else anchor


def append_doc_markdown(doc_url: str, body_md: str, dry_run: bool = False) -> None:
    """在已有飞书文档末尾以 markdown 追加一段内容。

    先试 `--command append`；实测 append 的「-1=末尾」定位会对部分文档降级失败
    （ok=true 但 data.result=failed, degrade_code=1002），此时自动降级为
    「取真实末尾 block id + block_insert_after」。任一路径 result 非 success 都抛错，
    绝不静默假成功。"""
    import tempfile
    if dry_run:
        print(f"[dry-run] docs +update append → {doc_url}（{len(body_md)} 字符）")
        return
    # 同 create_doc：--content @file 要求 cwd 内相对路径
    with tempfile.NamedTemporaryFile("w", suffix=".md", encoding="utf-8",
                                     dir=".", delete=False) as f:
        f.write(body_md.strip() + "\n")
        tmp = f.name
    rel = "./" + Path(tmp).name
    try:
        data = run_lark(["docs", "+update", "--api-version", "v2",
                         "--doc", doc_url, "--command", "append",
                         "--doc-format", "markdown", "--content", f"@{rel}"], timeout=120)
        result, warnings = _update_result(data)
        if result == "success":
            return
        # append 降级失败 → 用真实末尾 block id 精确插入
        last_id = _doc_last_block_id(doc_url)
        data = run_lark(["docs", "+update", "--api-version", "v2",
                         "--doc", doc_url, "--command", "block_insert_after",
                         "--block-id", last_id,
                         "--doc-format", "markdown", "--content", f"@{rel}"], timeout=120)
        result2, warnings2 = _update_result(data)
        if result2 != "success":
            raise RuntimeError(
                f"文档追加失败（append: {result} {warnings}；"
                f"block_insert_after@{last_id}: {result2} {warnings2}）")
    finally:
        Path(tmp).unlink(missing_ok=True)


def fetch_doc_fragment(doc_url: str, scope: str = "outline",
                       start_block_id: str | None = None) -> str:
    """按 scope 局部取文档片段（含 block id）。scope: outline / section。"""
    args = ["docs", "+fetch", "--api-version", "v2", "--doc", doc_url,
            "--scope", scope, "--detail", "with-ids"]
    if start_block_id:
        args += ["--start-block-id", start_block_id]
    data = run_lark(args, timeout=120)
    d = data.get("data") or {}
    return (d.get("document") or {}).get("content") or d.get("content") or ""


def delete_doc_blocks(doc_url: str, block_ids: list, dry_run: bool = False) -> None:
    """按 block id 批量删除文档 block（每批 ≤50，避免命令行过长）。"""
    if not block_ids:
        return
    if dry_run:
        print(f"[dry-run] docs +update block_delete × {len(block_ids)} → {doc_url}")
        return
    for i in range(0, len(block_ids), 50):
        chunk = block_ids[i:i + 50]
        data = run_lark(["docs", "+update", "--api-version", "v2", "--doc", doc_url,
                         "--command", "block_delete",
                         "--block-id", ",".join(chunk)], timeout=120)
        result, warnings = _update_result(data)
        if result != "success":
            raise RuntimeError(f"block_delete 失败: {result} {warnings}")


def delete_doc_markdown(doc_url: str, body_md: str, dry_run: bool = False) -> None:
    """按 markdown 原文精确匹配并删除文档中的一段内容（str_replace 空替换）。

    用于 /package、/broll 反复提交后清理过期的「创意方案 / 素材包」节。
    只删除完全匹配的片段；匹配不到直接抛错，绝不静默跳过。"""
    import tempfile
    if dry_run:
        print(f"[dry-run] docs +update str_replace(删除) → {doc_url}（{len(body_md)} 字符）")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".md", encoding="utf-8",
                                     dir=".", delete=False) as f:
        f.write(body_md)
        tmp = f.name
    rel = "./" + Path(tmp).name
    try:
        data = run_lark(["docs", "+update", "--api-version", "v2",
                         "--doc", doc_url, "--command", "str_replace",
                         "--doc-format", "markdown", "--pattern", f"@{rel}",
                         "--content", ""], timeout=120)
        result, warnings = _update_result(data)
        if result != "success":
            raise RuntimeError(f"文档删除失败: {result} {warnings}")
    finally:
        Path(tmp).unlink(missing_ok=True)


def fetch_doc_markdown(doc_url: str) -> str:
    """整篇读取飞书文档为 markdown 文本。"""
    data = run_lark(["docs", "+fetch", "--api-version", "v2",
                     "--doc", doc_url, "--doc-format", "markdown"], timeout=120)
    d = data.get("data") or {}
    content = d.get("content")
    if content is None and isinstance(d.get("document"), dict):
        content = d["document"].get("content")
    if not isinstance(content, str):
        raise RuntimeError(f"docs +fetch 未返回 content: {json.dumps(data, ensure_ascii=False)[:300]}")
    return content


def url_cell_to_link(value) -> str:
    """lark URL 字段读出来是 "[text](link)" markdown，提取纯链接。"""
    if not isinstance(value, str):
        return ""
    m = re.search(r"\(([^)]+)\)\s*$", value)
    return m.group(1) if m else value
