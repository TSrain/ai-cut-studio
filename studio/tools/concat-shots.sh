#!/usr/bin/env bash
# concat-shots.sh — 把一批已规范化的镜头首尾相接拼成整片
#
# 前提:各镜头规格一致(先跑 tools/normalize-shot.sh)。规格一致时用 stream copy 拼,
# 不重编码、不掉画质、秒级完成;万一某镜的编码参数仍然对不上导致 copy 失败或产物不对,
# 自动回退到重编码拼接(慢但一定拼得出来)。
#
# 用法:
#   tools/concat-shots.sh <output> <shot1> [shot2 ...]
#
# 示例:
#   tools/concat-shots.sh projects/x/out/final.mp4 norm/shot1.mp4 norm/shot2.mp4
#   tools/concat-shots.sh out/final.mp4 $(ls -1 norm/shot*.mp4)
#
# 只删自己 mktemp 出来的临时目录,绝不动调用方的任何文件。
#
# 退出码: 0 = 拼接成功并校验通过; 1 = 两种方式都失败; 2 = 参数错误; 127 = 缺少 ffmpeg/ffprobe
set -euo pipefail

usage() {
  echo "用法: $0 <output> <shot1> [shot2 ...]" >&2
}

if [[ $# -lt 2 ]]; then
  echo "参数不足: 需要 1 个输出 + 至少 1 个镜头,收到 $# 个参数" >&2
  usage
  exit 2
fi

OUTPUT="$1"; shift
SHOTS=("$@")

command -v ffmpeg  >/dev/null 2>&1 || { echo "缺少 ffmpeg(brew install ffmpeg)"  >&2; exit 127; }
command -v ffprobe >/dev/null 2>&1 || { echo "缺少 ffprobe(brew install ffmpeg)" >&2; exit 127; }

# 绝对路径化:concat 列表放在 mktemp 目录里,相对路径会相对列表文件解析而失效
abspath() {
  local p="$1" d b
  d="$(dirname -- "$p")"
  b="$(basename -- "$p")"
  printf '%s/%s\n' "$(cd -- "$d" >/dev/null 2>&1 && pwd)" "$b"
}

TMPDIR_SELF="$(mktemp -d "${TMPDIR:-/tmp}/motion-concat-XXXXXX")"
# 只清理自己建的临时目录,调用方的镜头文件一个都不碰
cleanup() { rm -rf "$TMPDIR_SELF"; }
trap cleanup EXIT

LIST="$TMPDIR_SELF/concat.txt"
: > "$LIST"

# concat demuxer 的单引号转义序列:路径里的 ' 要写成 '\'' (闭引号 + 转义引号 + 开引号)。
# 这里靠 unquoted 反斜杠拼出这六个字符,别改写成加引号的形式——很容易多吞一层反斜杠。
SQ_ESCAPE=\'\\\'\'

# 镜头签名:视频编码/宽/高/像素格式/帧率 + 音轨编码。签名全一致才允许 stream copy——
# 实测坑:把 h264 和 mpeg4 用 -c copy 拼进 mp4,ffmpeg 会 0 退出、时长尺寸全对,
# 打开却满屏 "missing picture in access unit"。产物校验查不出来,只能在拼之前拦。
signature() {
  local f="$1"
  local v a
  v="$(ffprobe -v error -select_streams v:0 \
        -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate \
        -of csv=p=0 "$f" 2>/dev/null || true)"
  a="$(ffprobe -v error -select_streams a \
        -show_entries stream=codec_name,sample_rate,channels \
        -of csv=p=0 "$f" 2>/dev/null | tr '\n' ';' || true)"
  printf 'v[%s] a[%s]' "$v" "$a"
}

EXPECTED_DUR=0
UNIFORM=1
FIRST_SIG=""
ABS_SHOTS=()
ALL_HAVE_AUDIO=1
ANY_HAS_AUDIO=0
TARGET_W=""; TARGET_H=""; TARGET_FPS=""
for shot in "${SHOTS[@]}"; do
  [[ -s "$shot" ]] || { echo "镜头文件不存在或为空: $shot" >&2; exit 2; }
  ABS="$(abspath "$shot")"
  [[ -s "$ABS" ]] || { echo "无法解析镜头绝对路径: $shot" >&2; exit 2; }
  ABS_SHOTS+=("$ABS")
  ESCAPED="${ABS//\'/$SQ_ESCAPE}"
  printf "file '%s'\n" "$ESCAPED" >> "$LIST"
  D="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$ABS" || echo 0)"
  EXPECTED_DUR="$(awk -v a="$EXPECTED_DUR" -v b="${D:-0}" 'BEGIN{printf "%.3f", a + (b+0)}')"

  NA="$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$ABS" | awk 'END{print NR}')"
  if (( NA > 0 )); then ANY_HAS_AUDIO=1; else ALL_HAVE_AUDIO=0; fi

  SIG="$(signature "$ABS")"
  if [[ -z "$FIRST_SIG" ]]; then
    FIRST_SIG="$SIG"
    # 第一镜的规格就是整片的目标规格(回退重编码时按它统一)
    TARGET_W="$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 "$ABS")"
    TARGET_H="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$ABS")"
    TARGET_FPS="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$ABS")"
  elif [[ "$SIG" != "$FIRST_SIG" ]]; then
    UNIFORM=0
    echo "  ! 规格不一致: $shot" >&2
    echo "      首镜 $FIRST_SIG" >&2
    echo "      本镜 $SIG" >&2
  fi
done

OUT_DIR="$(dirname "$OUTPUT")"
mkdir -p "$OUT_DIR"

echo "拼接 ${#SHOTS[@]} 个镜头 -> $OUTPUT (期望时长 ${EXPECTED_DUR}s)"

# 产物校验:能被 ffprobe 读出视频流、总时长约等于各镜之和、且整片能无错解码。
# 只看 exit code 不够——stream copy 常常"成功退出"却只拼进第一段,或拼出解不了的码流。
verify() {
  local f="$1"
  [[ -s "$f" ]] || return 1
  local json w h dur decode_err
  json="$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -show_entries format=duration -of json "$f" 2>/dev/null)" || return 1
  w="$(sed -n 's/.*"width": *\([0-9]*\).*/\1/p' <<<"$json" | head -1)"
  h="$(sed -n 's/.*"height": *\([0-9]*\).*/\1/p' <<<"$json" | head -1)"
  dur="$(sed -n 's/.*"duration": *"\([0-9.]*\)".*/\1/p' <<<"$json" | head -1)"
  [[ -n "$w" && -n "$h" && "$w" != "0" && "$h" != "0" ]] || return 1
  [[ -n "$dur" ]] || return 1
  awk -v a="$dur" -v b="$EXPECTED_DUR" 'BEGIN{d=a-b; if(d<0)d=-d; exit !(d<=0.5)}' || return 1
  # 全片解码一遍,有任何 error 级别输出就算不过(拼坏的码流在这里才现形)
  decode_err="$(ffmpeg -v error -i "$f" -f null - 2>&1 || true)"
  [[ -z "$decode_err" ]] || { echo "$decode_err" | head -3 >&2; return 1; }
  return 0
}

CONCAT_DONE=0
if (( UNIFORM )); then
  # —— 第一次尝试:stream copy(不重编码,秒级、无画质损失) ——
  if ffmpeg -y -v error -f concat -safe 0 -i "$LIST" -c copy -movflags +faststart "$OUTPUT" \
     && verify "$OUTPUT"; then
    echo "  ✓ stream copy 拼接完成"
    CONCAT_DONE=1
  else
    echo "  ! stream copy 失败或产物校验不过,回退到重编码拼接" >&2
  fi
else
  echo "  ! 各镜规格不一致,跳过 stream copy 直接重编码(建议先跑 tools/normalize-shot.sh)" >&2
fi

if (( ! CONCAT_DONE )); then
  # —— 回退:重编码 ——
  # 注意用的是 concat **滤镜** 而不是 concat demuxer:demuxer 只认第一镜的编码参数,
  # 后面镜头的包会被喂进错的解码器,加了 -c:v libx264 也救不回来(实测 h264+mpeg4 会
  # 整段 "Invalid data found")。concat 滤镜是各输入独立解码后再接,才真的能跨规格拼。
  N=${#ABS_SHOTS[@]}
  INPUTS=()
  CHAINS=""   # 各输入的预处理链
  PADS=""     # 喂给 concat 的标签序列
  for ((i = 0; i < N; i++)); do
    INPUTS+=(-i "${ABS_SHOTS[$i]}")
    CHAINS+="[${i}:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,"
    CHAINS+="pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,"
    CHAINS+="fps=${TARGET_FPS},format=yuv420p[v${i}];"
    PADS+="[v${i}]"
    if (( ALL_HAVE_AUDIO )); then
      CHAINS+="[${i}:a]aresample=async=1,"
      CHAINS+="aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}];"
      PADS+="[a${i}]"
    fi
  done

  if (( ALL_HAVE_AUDIO )); then
    FILTER="${CHAINS}${PADS}concat=n=${N}:v=1:a=1[outv][outa]"
    MAPS=(-map "[outv]" -map "[outa]" -c:a aac -b:a 192k)
  else
    (( ANY_HAS_AUDIO )) && echo "      (并非每镜都有音轨,回退拼接丢弃音频)" >&2 || true
    FILTER="${CHAINS}${PADS}concat=n=${N}:v=1:a=0[outv]"
    MAPS=(-map "[outv]" -an)
  fi

  if ffmpeg -y -v error "${INPUTS[@]}" -filter_complex "$FILTER" "${MAPS[@]}" \
       -c:v libx264 -profile:v high -pix_fmt yuv420p -r "$TARGET_FPS" -movflags +faststart "$OUTPUT" \
     && verify "$OUTPUT"; then
    echo "  ✓ 重编码拼接完成"
  else
    echo "拼接失败 — stream copy 与重编码均未产出合规文件" >&2
    echo "        先用 tools/normalize-shot.sh 把各镜统一成同一规格再拼" >&2
    exit 1
  fi
fi

FINAL="$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,pix_fmt,r_frame_rate \
  -show_entries format=duration -of default=noprint_wrappers=1:nokey=0 "$OUTPUT")"
echo "$FINAL" | sed 's/^/  /'
