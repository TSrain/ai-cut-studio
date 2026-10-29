#!/usr/bin/env bash
# validate-output.sh — 渲染产物的客观校验（质量检查单"技术(硬性)"项的自动化执行）
#
# 只看客观事实:文件非空、尺寸、偶数边、帧率、时长、音轨。不判断画面好坏——
# 画面质量仍然靠渲帧用 Read 逐张看(docs/quality-checklist.md)。
#
# 用法:
#   tools/validate-output.sh <file.mp4> [--size 1080x1920] [--fps 30] \
#                            [--duration 8.5] [--dur-tol 0.5] [--audio none|any] \
#                            [--codec h264] [--pix-fmt yuv420p]
#
# --codec / --pix-fmt 是"编码检查":preset 快车道把逐帧审查降档之后,编码规格是
# 剩下的四道硬检查之一(拼接与播放器兼容性全压在它上面),不给值就只报告不判定。
#
# 示例:
#   tools/validate-output.sh projects/x/out/shot1.mp4 --size 1080x1920 --fps 30 --duration 6.2 --audio none
#   tools/validate-output.sh projects/x/out/final.mp4 --size 1920x1080 --fps 30
#
# 退出码: 0 = 全过; 1 = 有硬性项不过(逐条打印); 127 = 缺少 ffprobe
set -euo pipefail

FILE="${1:-}"
[[ -n "$FILE" ]] || { echo "用法: $0 <file.mp4> [--size WxH] [--fps N] [--duration S] [--dur-tol S] [--audio none|any]" >&2; exit 2; }
shift

EXP_SIZE=""; EXP_FPS=""; EXP_DUR=""; DUR_TOL="0.5"; EXP_AUDIO="any"; EXP_CODEC=""; EXP_PIXFMT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --size)     EXP_SIZE="$2"; shift 2 ;;
    --fps)      EXP_FPS="$2"; shift 2 ;;
    --duration) EXP_DUR="$2"; shift 2 ;;
    --dur-tol)  DUR_TOL="$2"; shift 2 ;;
    --audio)    EXP_AUDIO="$2"; shift 2 ;;
    --codec)    EXP_CODEC="$2"; shift 2 ;;
    --pix-fmt)  EXP_PIXFMT="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

command -v ffprobe >/dev/null 2>&1 || { echo "缺少 ffprobe(brew install ffmpeg)" >&2; exit 127; }

FAILED=0
fail() { echo "  ✗ $*"; FAILED=1; }
pass() { echo "  ✓ $*"; }

echo "校验 $FILE"

[[ -s "$FILE" ]] || { fail "文件不存在或为空"; exit 1; }

JSON="$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,avg_frame_rate,r_frame_rate,duration,codec_name,pix_fmt \
  -show_entries format=duration -of json "$FILE")"

W="$(jq -r '.streams[0].width  // 0' <<<"$JSON")"
H="$(jq -r '.streams[0].height // 0' <<<"$JSON")"
CODEC="$(jq -r '.streams[0].codec_name // "unknown"' <<<"$JSON")"
PIXFMT="$(jq -r '.streams[0].pix_fmt // "unknown"' <<<"$JSON")"
FPS_RAW="$(jq -r '.streams[0].avg_frame_rate // .streams[0].r_frame_rate // "0/0"' <<<"$JSON")"
DUR="$(jq -r '.format.duration // .streams[0].duration // 0' <<<"$JSON")"
FPS="$(awk -F/ 'BEGIN{f=0} $2>0{f=$1/$2} END{printf "%.3f", f}' <<<"$FPS_RAW")"
NA="$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$FILE" | awk 'END{print NR}')"

near() { awk -v a="$1" -v b="$2" -v t="$3" 'BEGIN{exit !((a-b<=t)&&(b-a<=t))}'; }

# 尺寸
if [[ -n "$EXP_SIZE" ]]; then
  [[ "${W}x${H}" == "$EXP_SIZE" ]] && pass "尺寸 ${W}x${H}" || fail "尺寸 ${W}x${H},期望 $EXP_SIZE"
else
  pass "尺寸 ${W}x${H}"
fi

# 偶数边——奇数宽或高会让 libx264/yuv420p 编码失败或画面变形(auto-motion 实测坑)
if (( W % 2 == 0 && H % 2 == 0 )); then
  pass "宽高均为偶数"
else
  fail "宽或高为奇数(${W}x${H})——yuv420p 编码会失败或变形,改成偶数"
fi

# 帧率
if [[ -n "$EXP_FPS" ]]; then
  near "$FPS" "$EXP_FPS" 0.2 && pass "帧率 ${FPS}fps" || fail "帧率 ${FPS}fps,期望 ${EXP_FPS}fps"
else
  pass "帧率 ${FPS}fps"
fi

# 时长
if [[ -n "$EXP_DUR" ]]; then
  near "$DUR" "$EXP_DUR" "$DUR_TOL" && pass "时长 ${DUR}s" || fail "时长 ${DUR}s,期望 ${EXP_DUR}s(容差 ±${DUR_TOL}s)"
else
  pass "时长 ${DUR}s"
fi

# 编码(视频编码器 + 像素格式)
if [[ -n "$EXP_CODEC" ]]; then
  [[ "$CODEC" == "$EXP_CODEC" ]] && pass "编码 $CODEC" || fail "编码 $CODEC,期望 $EXP_CODEC"
else
  pass "编码 $CODEC(未校验)"
fi
if [[ -n "$EXP_PIXFMT" ]]; then
  [[ "$PIXFMT" == "$EXP_PIXFMT" ]] && pass "像素格式 $PIXFMT" || fail "像素格式 $PIXFMT,期望 $EXP_PIXFMT"
else
  pass "像素格式 $PIXFMT(未校验)"
fi

# 音轨
case "$EXP_AUDIO" in
  none) [[ "$NA" == "0" ]] && pass "无音轨" || fail "有 $NA 条音轨,期望静音无音轨" ;;
  any)  pass "音轨 $NA 条(未校验)" ;;
  *)    fail "--audio 只接受 none|any,收到 $EXP_AUDIO" ;;
esac

if [[ "$FAILED" == "0" ]]; then
  echo "PASS"
else
  echo "FAIL — 修复后重渲重校验" >&2
  exit 1
fi
