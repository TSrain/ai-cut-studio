#!/usr/bin/env bash
# smoke-dual-engine.sh — 双引擎(HyperFrames + Remotion)桥接的端到端烟雾测试
#
# 它是 docs/hybrid-bridge.md 那条链路的可执行版本,一次跑完六步:
#   1. HyperFrames 侧自检(check)
#   2. HyperFrames 渲染景观层 → templates/hyperframes-base/out/hybrid-bg.mp4
#   3. normalize-shot.sh 规范化 → templates/remotion-base/public/hybrid-bg.mp4
#      (HyperFrames 的 draft 出片是 H.264 Constrained Baseline,规格 §6.4 要 High;
#       这一步转 High + yuv420p + SAR 1:1,是正常流程,不是 HyperFrames 的 bug)
#   4. Remotion 侧类型检查
#   5. 渲第 75 帧关键帧 + 渲成片
#   6. validate-output.sh 客观校验成片规格
#
# 任何一步失败即整体失败(set -e);所有路径都从仓库根算绝对路径,
# cd 一律关在 subshell 里——失败时不会把后续步骤留在错误的工作目录。
#
# 用法: tools/smoke-dual-engine.sh
# 退出码: 0 = 全链路通过; 非 0 = 某一步失败(上一条输出即失败点)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HF_DIR="$ROOT/templates/hyperframes-base"
RM_DIR="$ROOT/templates/remotion-base"
HF_OUT="$HF_DIR/out/hybrid-bg.mp4"
RM_BG="$RM_DIR/public/hybrid-bg.mp4"
STILL="$RM_DIR/review/hybrid-smoke-75.png"
FINAL="$RM_DIR/out/hybrid-smoke.mp4"

step() { echo; echo "▸ $*"; }

mkdir -p "$HF_DIR/out" "$RM_DIR/review" "$RM_DIR/out"

# ——— 1/6 HyperFrames 自检 ———
# 用模板自己 package.json 里钉住的版本(npx --yes hyperframes@x.y.z),
# 不用裸 `npx hyperframes`——那会拉最新版,渲出来的画面可能和人眼验收过的不是一个东西。
step "1/6 HyperFrames check"
(cd "$HF_DIR" && npm run --silent check)

# ——— 2/6 HyperFrames 渲染景观层 ———
step "2/6 HyperFrames render → $HF_OUT"
(cd "$HF_DIR" && npm run --silent render -- --quality draft --output out/hybrid-bg.mp4)

# ——— 3/6 规范化到合同规格 ———
step "3/6 normalize → $RM_BG"
"$ROOT/tools/normalize-shot.sh" "$HF_OUT" "$RM_BG" 1080 1920 30 none

# ——— 4/6 Remotion 类型检查 ———
step "4/6 Remotion typecheck"
(cd "$RM_DIR" && npx tsc --noEmit)

# ——— 5/6 关键帧 + 成片 ———
# 关键帧必须人眼看(Read 打开 review/hybrid-smoke-75.png):脚本退 0 只能证明链路通,
# 证明不了背景真的铺上了、标题真的没被吃掉——那两件事只有看图才知道。
step "5/6 Remotion still (frame 75) + render"
(cd "$RM_DIR" && npx remotion still HybridSmoke --frame=75 review/hybrid-smoke-75.png)
# --muted 不是可选项:合同规定镜头默认无音轨(spec §6.4)。不加它 Remotion 会写进一条
# 静音 AAC 轨,ffmpeg concat 时各镜有轨/无轨不一致会直接拼失败,而且成片时长会被
# 音频轨拖长(实测 5.000 → 5.056s)。真要带声音的镜头由合同显式声明,不走默认。
(cd "$RM_DIR" && npx remotion render HybridSmoke out/hybrid-smoke.mp4 --muted)

# ——— 6/6 客观校验 ———
# --dur-tol 0.2:150 帧 / 30fps = 5.000s,容差收到 ±0.2s。
# 默认的 ±0.5s 对 5 秒的镜头太松——漏掉一整秒的漂移都还能过。
step "6/6 validate output"
"$ROOT/tools/validate-output.sh" "$FINAL" \
  --size 1080x1920 --fps 30 --duration 5 --dur-tol 0.2 --audio none

echo
echo "✓ 双引擎烟雾测试通过"
echo "  景观层(HyperFrames): $HF_OUT"
echo "  规范化背景:          $RM_BG"
echo "  关键帧(人眼必看):    $STILL"
echo "  成片:                $FINAL"
