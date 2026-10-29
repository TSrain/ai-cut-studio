#!/usr/bin/env bash
# normalize-shot.sh — 把任意引擎(Remotion / HyperFrames / 外部素材)的输出规范化成统一规格
#
# 各引擎出片的尺寸、帧率、像素格式、SAR 往往不一致,直接 concat 会失败或画面变形。
# 本脚本把单个镜头统一成:H.264 / yuv420p / 方形像素(SAR 1:1)/ 指定宽高帧率,
# 画面用 scale+pad 居中(保持原比例,不拉伸,缺的部分补黑边)。
#
# 先探测后动手:输入已经完全合规(h264/yuv420p/目标宽高帧率/方形像素)就 stream copy
# 直接换封装,不重编码——Remotion 按合同画布渲的镜头天生合规,一批 13 镜能省 3–6 分钟,
# 还少一代画质损失。任何一项不合规才走转码路径。两条路径共用同一段 ffprobe 自检。
#
# 用法:
#   tools/normalize-shot.sh <input> <output> <width> <height> <fps> <audio:none|keep>
#
# 示例:
#   tools/normalize-shot.sh raw/shot1.mp4 norm/shot1.mp4 1080 1920 30 none
#   tools/normalize-shot.sh raw/shot2.mov norm/shot2.mp4 1920 1080 30 keep
#
# 编码后会再跑一次 ffprobe 自检(宽/高/帧率/像素格式),不符就非 0 退出——
# 不自检等于把问题推到拼接阶段才爆,那时候已经很难定位是哪一镜的锅。
#
# 退出码: 0 = 规范化并自检通过; 1 = 编码或自检失败; 2 = 参数错误; 127 = 缺少 ffmpeg/ffprobe
set -euo pipefail

usage() {
  echo "用法: $0 <input> <output> <width> <height> <fps> <audio:none|keep>" >&2
}

if [[ $# -ne 6 ]]; then
  echo "参数个数错误: 需要 6 个,收到 $#" >&2
  usage
  exit 2
fi

INPUT="$1"; OUTPUT="$2"; WIDTH="$3"; HEIGHT="$4"; FPS="$5"; AUDIO="$6"

command -v ffmpeg  >/dev/null 2>&1 || { echo "缺少 ffmpeg(brew install ffmpeg)"  >&2; exit 127; }
command -v ffprobe >/dev/null 2>&1 || { echo "缺少 ffprobe(brew install ffmpeg)" >&2; exit 127; }

[[ -s "$INPUT" ]] || { echo "输入文件不存在或为空: $INPUT" >&2; exit 2; }

# 宽高:必须是正整数,且必须是偶数——奇数边会让 libx264/yuv420p 编码失败或画面变形
for pair in "宽:$WIDTH" "高:$HEIGHT"; do
  name="${pair%%:*}"; val="${pair#*:}"
  [[ "$val" =~ ^[0-9]+$ ]] || { echo "${name}必须是正整数,收到「${val}」" >&2; exit 2; }
  (( val > 0 )) || { echo "${name}必须大于 0,收到 $val" >&2; exit 2; }
  (( val % 2 == 0 )) || { echo "${name}为奇数($val)——yuv420p 编码会失败或变形,改成偶数" >&2; exit 2; }
done

# 帧率:正整数(项目统一整数帧率,避免 30000/1001 这类拼接对不齐的分数帧率)
[[ "$FPS" =~ ^[0-9]+$ ]] || { echo "帧率必须是正整数,收到「${FPS}」" >&2; exit 2; }
(( FPS > 0 )) || { echo "帧率必须大于 0,收到 $FPS" >&2; exit 2; }

case "$AUDIO" in
  none|keep) ;;
  *) echo "audio 只接受 none|keep,收到「${AUDIO}」" >&2; usage; exit 2 ;;
esac

OUT_DIR="$(dirname "$OUTPUT")"
mkdir -p "$OUT_DIR"

if [[ "$AUDIO" == "keep" ]]; then
  AUDIO_ARGS=(-c:a aac -b:a 192k)
else
  AUDIO_ARGS=(-an)
fi

# ——— 探测输入:全部合规就免转码 ———
IN_PROBE="$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,sample_aspect_ratio \
  -of default=noprint_wrappers=1:nokey=0 "$INPUT")"
iget() { sed -n "s/^$1=//p" <<<"$IN_PROBE" | head -1; }
IN_CODEC="$(iget codec_name)"; IN_W="$(iget width)"; IN_H="$(iget height)"
IN_PIX="$(iget pix_fmt)"; IN_RATE="$(iget r_frame_rate)"; IN_SAR="$(iget sample_aspect_ratio)"
# Alpha is never routed through the opaque H.264 normalizer.
IN_ALPHA_TAG="$(ffprobe -v error -select_streams v:0 -show_entries stream_tags=alpha_mode -of default=noprint_wrappers=1:nokey=1 "$INPUT")"
if [[ "$IN_PIX" =~ ^(yuva|rgba|argb|bgra|abgr|gbrap) || "$IN_ALPHA_TAG" == "1" ]]; then
  exec node "$(dirname "$0")/normalize-overlay.mjs" "$INPUT" "$OUTPUT" "$WIDTH" "$HEIGHT" "$FPS" "$AUDIO"
fi

IN_FPS="$(awk -F/ 'BEGIN{f=0} $2>0{f=$1/$2} END{printf "%.3f", f}' <<<"$IN_RATE")"
IN_AUDIO_CODEC="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name \
  -of default=noprint_wrappers=1:nokey=1 "$INPUT" | head -1 || true)"

COPY_OK=0
if [[ "$IN_CODEC" == "h264" && "$IN_W" == "$WIDTH" && "$IN_H" == "$HEIGHT" && "$IN_PIX" == "yuv420p" ]] \
   && awk -v a="$IN_FPS" -v b="$FPS" 'BEGIN{exit !(a-b<=0.01 && b-a<=0.01)}' \
   && [[ -z "$IN_SAR" || "$IN_SAR" == "1:1" || "$IN_SAR" == "N/A" || "$IN_SAR" == "0:1" ]]; then
  COPY_OK=1
fi

if (( COPY_OK )); then
  echo "规范化 $INPUT -> $OUTPUT (已合规,stream copy 免转码)"
  if [[ "$AUDIO" == "keep" ]]; then
    if [[ "$IN_AUDIO_CODEC" == "aac" ]]; then
      COPY_AUDIO_ARGS=(-c:a copy)
    elif [[ -n "$IN_AUDIO_CODEC" ]]; then
      COPY_AUDIO_ARGS=(-c:a aac -b:a 192k)   # 只转音频,视频仍 copy
    else
      COPY_AUDIO_ARGS=()
    fi
    ffmpeg -y -v error -i "$INPUT" -map 0:v:0 -map '0:a?' -c:v copy \
      "${COPY_AUDIO_ARGS[@]}" -movflags +faststart "$OUTPUT"
  else
    ffmpeg -y -v error -i "$INPUT" -map 0:v:0 -c:v copy -an -movflags +faststart "$OUTPUT"
  fi
else
  echo "规范化 $INPUT -> $OUTPUT (${WIDTH}x${HEIGHT} @ ${FPS}fps, audio=${AUDIO})"
  # in_range=auto:out_range=tv:全范围输入(yuvj420p,常见于旧 draft/屏幕录制)不显式转成
  # 限范围的话,ffmpeg 会把输出重新标成 yuvj420p,下面的自检必挂
  ffmpeg -y -v error -i "$INPUT" \
    -vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:in_range=auto:out_range=tv,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}" \
    -c:v libx264 -profile:v high -pix_fmt yuv420p -color_range tv -r "$FPS" -movflags +faststart \
    "${AUDIO_ARGS[@]}" "$OUTPUT"
fi

# ——— 自检:编码出来的东西必须真的是要的规格 ———
[[ -s "$OUTPUT" ]] || { echo "  ✗ 输出文件不存在或为空: $OUTPUT" >&2; exit 1; }

PROBE="$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,pix_fmt,r_frame_rate \
  -of default=noprint_wrappers=1:nokey=0 "$OUTPUT")"

get() { sed -n "s/^$1=//p" <<<"$PROBE" | head -1; }

GOT_W="$(get width)"; GOT_H="$(get height)"
GOT_PIX="$(get pix_fmt)"; GOT_RATE="$(get r_frame_rate)"
GOT_FPS="$(awk -F/ 'BEGIN{f=0} $2>0{f=$1/$2} END{printf "%.3f", f}' <<<"$GOT_RATE")"

FAILED=0
fail() { echo "  ✗ $*" >&2; FAILED=1; }

[[ "$GOT_W" == "$WIDTH"  ]] || fail "宽 $GOT_W,期望 $WIDTH"
[[ "$GOT_H" == "$HEIGHT" ]] || fail "高 $GOT_H,期望 $HEIGHT"
[[ "$GOT_PIX" == "yuv420p" ]] || fail "像素格式 $GOT_PIX,期望 yuv420p"
awk -v a="$GOT_FPS" -v b="$FPS" 'BEGIN{exit !(a-b<=0.01 && b-a<=0.01)}' \
  || fail "帧率 ${GOT_FPS}fps($GOT_RATE),期望 ${FPS}fps"

if (( FAILED )); then
  echo "自检失败 — 规范化产物规格不符,不要拿去拼接" >&2
  exit 1
fi

echo "  ✓ ${GOT_W}x${GOT_H} ${GOT_PIX} ${GOT_RATE}"
