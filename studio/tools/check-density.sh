#!/usr/bin/env bash
# check-density.sh — 首尾帧墨量与明度层数描述，不设密度门禁。
# 首尾留白、入场和退场由真实连续播放判断；抽帧失败仍返回非零。
# 旧 --min-ink / --first-ink 参数兼容接收，不再强制任何阈值。
set -euo pipefail

FILE="${1:-}"
[[ -n "$FILE" ]] || { echo "用法: $0 <file.mp4> [--contract <json>] [--profile <名>] [--min-ink N] [--first-ink N] [--at S]" >&2; exit 2; }
shift

MIN_INK=""; FIRST_INK=""; AT=""; CONTRACT=""; PROFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --min-ink)   MIN_INK="$2"; shift 2 ;;
    --first-ink) FIRST_INK="$2"; shift 2 ;;
    --at)        AT="$2"; shift 2 ;;
    --contract)  CONTRACT="$2"; shift 2 ;;
    --profile)   PROFILE="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

command -v ffprobe >/dev/null || { echo "缺少 ffprobe" >&2; exit 127; }
command -v python3  >/dev/null || { echo "缺少 python3" >&2; exit 127; }
[[ -s "$FILE" ]] || { echo "文件不存在或为空: $FILE" >&2; exit 1; }

if [[ -n "$CONTRACT" ]]; then
  python3 - "$CONTRACT" <<'PYCONTRACT'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    value = json.load(handle)
if not isinstance(value, dict):
    raise ValueError('合同必须是对象')
PYCONTRACT
fi

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$FILE")
# 尾帧默认取「时长 - 0.1s」:末段静止读取区,画面最完整的时刻
[[ -n "$AT" ]] || AT=$(python3 -c "print(max(0.0, $DUR - 0.1))")

echo "画面密度描述 $FILE"
echo "  墨量与明度层数仅作描述，不设门禁"
# `set -e` 会让下面这段 python 一失败就直接终止脚本,末尾的 FAIL 那行从来没打印过。
# 用 `|| RC=$?` 接住,让判定结果自己走完。
RC=0
python3 - "$FILE" "$AT" <<'PY' || RC=$?
import subprocess, collections, sys

path, at = sys.argv[1], float(sys.argv[2])

def sample(t):
    # 缩到 270×360 再量:抗噪、快,且和人眼在缩略图尺度上的感受一致
    r = subprocess.run(
        ['ffmpeg', '-v', 'error', '-ss', str(t), '-i', path, '-frames:v', '1',
         '-vf', 'scale=270:360,format=rgb24', '-f', 'rawvideo', '-'],
        capture_output=True)
    d = r.stdout
    return [tuple(d[i:i+3]) for i in range(0, len(d), 3)]

def metrics(px):
    n = len(px)
    if n == 0:
        return None
    bg = collections.Counter(px).most_common(1)[0][0]
    ink = sum(1 for p in px
              if max(abs(p[0]-bg[0]), abs(p[1]-bg[1]), abs(p[2]-bg[2])) > 12) / n
    lum = [round((0.299*p[0] + 0.587*p[1] + 0.114*p[2]) / 8) for p in px]
    bands = sum(1 for _, c in collections.Counter(lum).items() if c > n * 0.005)
    return ink * 100, bands

fail = 0
for label, t in (('首帧', 0.0), ('尾帧', at)):
    m = metrics(sample(t))
    if m is None:
        print(f"  ✗ {label} 抽帧失败")
        fail = 1
        continue
    ink, bands = m
    print(f"  ✓ {label}墨量 {ink:.1f}%   明度层数 {bands}")

sys.exit(fail)
PY
[[ $RC -eq 0 ]] && echo "PASS" || echo "FAIL"
exit $RC
