#!/usr/bin/env bash
# 把验收用的全分辨率缩略图(1080×1920 PNG,一张 ~1MB)压成面板用的小图
# (320px 宽 JPEG,一张 ~7KB)。渲了新的模板/组件/观感缩略图之后跑一次。
#
# 为什么不直接渲小的:那些 PNG 同时是"用户过目确认"的样张,必须保持全分辨率。
# 面板要的是另一种东西 —— 96px 宽卡片里的一张图。两个用途,两份文件。
#
# 用 sips 不用 ffmpeg:本机这个 ffmpeg 没编 webp 编码器(和没编 drawtext 同源)。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/catalog/thumbnails/sm
n=0
for f in docs/catalog/thumbnails/remotion/*.png docs/catalog/thumbnails/hyperframes/*.png docs/catalog/thumbnails/looks/*.png; do
  [ -f "$f" ] || continue
  b="$(basename "$f" .png)"
  out="docs/catalog/thumbnails/sm/$b.jpg"
  [ -f "$out" ] && [ "$out" -nt "$f" ] && continue
  sips -Z 320 -s format jpeg -s formatOptions 72 "$f" --out "$out" >/dev/null
  n=$((n+1))
done
echo "面板小图:新生成 $n 张 → docs/catalog/thumbnails/sm/ ($(du -sh docs/catalog/thumbnails/sm | cut -f1))"
