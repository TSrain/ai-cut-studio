# Hybrid 桥接:HyperFrames 出景观,Remotion 出精确文字

一句话分工:**HyperFrames 负责景观(spectacle)——背景、UI 重构、3D、Shader、粒子、复杂遮罩;
Remotion 负责精确层——文字、字幕、数据、时间与最终拼接。**

两个引擎不是"都用一下"就叫 Hybrid。Hybrid 是**例外路径**:只在同一个镜头里
既有强视觉层、又有必须逐帧对准的字/数/时的时候才走(spec §6.3)。
判断和评分规则在 `docs/engine-routing.md`,本文只讲**接起来怎么做**。

可执行版本是 `tools/smoke-dual-engine.sh`;可看的产物是
`templates/remotion-base/review/hybrid-smoke-75.png` 和
`templates/remotion-base/out/hybrid-smoke.mp4`。

---

## Route Conditions

同时满足以下两组条件的镜头才走 Hybrid;只满足一组的,单引擎做完即可。

**视觉侧(要 HyperFrames):**

- 网页截图 / 产品界面 / DOM 重构;
- WebGL、Shader、3D、液态玻璃、粒子;
- Kinetic Typography、GSAP 时间线、复杂遮罩与文字变形;
- Registry 里已有高度匹配的 block。

**精确侧(要 Remotion):**

- 字幕、配音对齐、逐帧节拍、毫秒级时长;
- 真实数据绑定、数字计算、图表;
- 跨镜头的位置 / 颜色 / 元素延续;
- 需要一个最终集成层去叠加多个来源。

**不走 Hybrid 的情形(比走要多):**

- 只是"想让画面好看一点"——那是 HyperFrames 单引擎;
- 只是"文字要准"——那是 Remotion 单引擎;
- 为了"两个引擎都用到"而用——spec §6.3 明确禁止;
- 路由分数一边倒(差值超过 `docs/engine-routing.md` 规定的阈值)。

Hybrid 的成本是实打实的:多一次渲染、多一次转码、多一份时长必须对齐的约束。
拿不出"这一层非 HyperFrames 不可、那一层非 Remotion 不可"的理由,就别走。

## HyperFrames Layer

景观层是一个**独立、完整、自己能通过 check 的 HyperFrames 工程**,
不是给 Remotion 用的半成品。它自己的时长就是这一镜的时长。

```bash
cd templates/hyperframes-base
npm run --silent check
npm run --silent render -- --quality draft --output out/hybrid-bg.mp4
```

几条硬要求:

- **画布尺寸必须等于最终镜头尺寸**(这里 1080×1920)。让 HyperFrames 出小图再放大,
  会把它最值钱的锐度全部丢掉——Hybrid 的意义就没了。
- **帧数必须等于 Remotion 合成的 `durationInFrames`**。见 Timing Alignment。
- **景观层里不要放需要精确的文字**。可以有装饰性字块(模板里的 `HYPERFRAMES BASE` 就是),
  但一旦有一个字需要和口播对齐,它就该搬到 Remotion 层去。
- **调用要用工程自己钉住的版本**(`npm run check` / `npm run render`,内部是
  `npx --yes hyperframes@<pinned>`)。裸 `npx hyperframes` 会拉最新版,
  渲出来的可能不是当初人眼验收过的那张画面。
- 正式交付把 `--quality draft` 换成 `standard` 或 `high`;draft 只用于自查回路。

## Normalize

HyperFrames 的输出**不能直接进 Remotion**,中间必须过 `tools/normalize-shot.sh`。

```bash
tools/normalize-shot.sh \
  templates/hyperframes-base/out/hybrid-bg.mp4 \
  templates/remotion-base/public/hybrid-bg.mp4 \
  1080 1920 30 none
```

为什么这一步不能省:

- `npx hyperframes render --quality draft` 出的是 **H.264 Constrained Baseline**,
  而合同规格(spec §6.4)要 **High Profile**。这是**正常差异,不是 HyperFrames 的 bug**,
  也不要去改 HyperFrames 的渲染参数——规范化就是干这个的。
- 统一 `yuv420p`、`SAR 1:1`、整数帧率。SAR 不是 1:1 时 Remotion 里看着正常、
  ffmpeg 拼接时才变形,是最难查的一类问题。
- `audio=none`:合同默认镜头无音轨。各镜有轨/无轨不一致,`ffmpeg concat -c copy` 会直接失败。

规范化产物落到 **`templates/remotion-base/public/`**,因为 Remotion 的 `staticFile()`
只认 `public/`。放别处 Remotion 找不到,而且报错信息不会告诉你是路径问题。

> 例外:**带 alpha 的素材不要过这个脚本**,它会把 alpha 压掉。见 Alpha Alternative。

## Remotion Overlay

参考实现:`templates/remotion-base/src/demo/HybridSmoke.tsx`。三层结构,顺序不能换:

1. **景观层** — `<OffthreadVideo src={staticFile('hybrid-bg.mp4')} style={{width:'100%',height:'100%',objectFit:'cover'}} />`
2. **压暗层(scrim)** — 一层线性渐变,只压住要放字的那个带
3. **精确层** — 文字,全部从 `useCurrentFrame()` 推导

四个必须知道的点:

- **必须用 `OffthreadVideo`,不是 `<Video>`。** `<Video>` 在渲染进程里靠
  HTMLVideoElement 去 seek,长镜头会漂帧;`OffthreadVideo` 由 ffmpeg 按帧号取帧,
  和 `useCurrentFrame()` 严格对齐。**这个对齐就是 Hybrid 的全部前提**,换掉它整件事就不成立。
- **`objectFit: 'cover'` 要显式写。** 默认按原始像素铺,背景比合成大一点点就露错位边,
  而这种偏移在单帧上极难看出来。
- **文字底下必须有自己的压暗。** 背景是另一个引擎出的画面,亮度不由你控制;
  没有 scrim 的话换一版背景就可能把标题吃掉——这是 Hybrid 最常见的返工原因。
  但渐变**必须在背景自己的内容开始之前归零**,压过头会把 HyperFrames 那层一起洗灰,
  两层都变脏(`HybridSmoke` 第一版就是这么翻车的:背景的白色主标题被压成了灰色)。
- **构图要和背景对角平衡。** `hyperframes-base` 的重量压在中下偏左,
  所以 `HybridSmoke` 的精确层放右上。跟着挤同一侧会变成两摞标题打架。
  可用竖向空间由背景决定(这里是安全区 220 → 背景标题起始 555),
  空间只够两级排版就别塞第三级。

排版和配色照旧走令牌,不因为是"烟雾测试"就放宽:
`createTypography('impact')` + `textStyle()`(`docs/typography.md`)、
`scenePalette()`(`docs/color.md`)。`HybridSmoke` 的配色特意跟着景观层走
(蓝色中性 + 琥珀强调),两层才像同一张图,而不是两张贴在一起。

## Timing Alignment

**HyperFrames 的帧数 = Remotion 合成的 `durationInFrames`。这是硬约束。**

| 两边 | 值 | 写在哪 |
|---|---|---|
| HyperFrames | `data-duration="5"` @ 30fps = 150 帧 | `templates/hyperframes-base/index.html` |
| Remotion | `durationInFrames={150}`, `fps={30}` | `templates/remotion-base/src/Root.tsx` |

对不齐的后果是**不报错的**,所以要特别小心:

- Remotion 比背景长 → 超出部分背景**定格在最后一帧**。画面不会炸,只是突然不动了,
  抽帧自查如果没抽到尾段就完全看不出来。
- Remotion 比背景短 → 背景后半段被静默丢弃,你以为渲进去了的东西根本没出现。

所以改任一侧时长,**两侧必须一起改**,并且用 `tools/validate-output.sh --duration --dur-tol`
把期望时长钉死(`smoke-dual-engine.sh` 用的是 `--duration 5 --dur-tol 0.2`:
150/30 = 5.000s,±0.2s 已经足够宽;默认的 ±0.5s 对 5 秒的镜头太松,
漏掉一整秒的漂移都还能过)。

精确层的关键动作也用**帧号**写死,不用秒:`HybridSmoke` 的标题在 12–32 帧之间揭示、
保持到 130 帧、之后 18 帧退场。秒数会随 fps 变,帧号不会。

## Alpha Alternative

背景不是满幅、而是要**盖在 Remotion 内容之上**的前景层(3D 物件、粒子、玻璃质感遮罩)时,
MP4 不够用——它没有 alpha。两条路:

**WebM(VP9 + alpha),适合整段前景:**

```bash
cd templates/hyperframes-base
npm run --silent render -- --format webm --output out/hybrid-fg.webm
```

```tsx
<OffthreadVideo src={staticFile('hybrid-fg.webm')} transparent style={{...}} />
```

**PNG 序列,适合要逐帧精确对齐或后期还要再加工的层:**

```bash
cd templates/hyperframes-base
npm run --silent render -- --format png-sequence --output out/hybrid-fg
```

```tsx
const frame = useCurrentFrame();
<Img src={staticFile(`hybrid-fg/${String(frame).padStart(4, '0')}.png`)} />
```

三条坑:

- **带 alpha 的素材绝对不要过 `tools/normalize-shot.sh`。** 它强制
  `libx264 + yuv420p`,alpha 会被直接压掉,而且是静默压掉——你只会看到前景层突然有了黑底。
- WebM 的 `transparent` 必须显式传给 `OffthreadVideo`,不传就按不透明解。
- PNG 序列的文件名补零位数要和 HyperFrames 实际输出一致,对不上就是空白帧
  (Remotion 不会报错,只是画面里那一层没了)。先 `ls` 看一眼再写 `padStart`。

alpha 路线更贵(体积大、解码慢),**能用满幅 MP4 解决就别用 alpha**。

## Failure Fallback

Hybrid 有两次渲染、一次转码,失败面比单引擎大。按下面的顺序降级,**不要卡在原地重试**:

| 症状 | 先查 | 降级动作 |
|---|---|---|
| `hyperframes check` 不过 | check 的报错行 | 修景观层;修不动就整镜降级为 Remotion 单引擎 |
| HyperFrames 渲染超时 / 卡住 | 首次跑要拉依赖,约 40 秒起,不是挂了 | 等;仍失败则 `--quality draft` 或减 worker |
| `normalize-shot.sh` 自检失败 | 它打印的宽/高/帧率/像素格式 | 尺寸对不上就回去改 HyperFrames 画布,不要靠 pad 硬凑 |
| Remotion 里背景是黑的 | `public/hybrid-bg.mp4` 在不在、`staticFile()` 路径对不对 | 重跑规范化那一步 |
| 背景定格不动 | 两侧帧数是否相等(见 Timing Alignment) | 对齐时长 |
| 标题被背景吃掉 | scrim 的范围和强度 | 加 scrim / 挪构图,**不要靠加粗字重硬顶** |
| `validate-output.sh` 报有音轨 | Remotion 默认会写一条静音 AAC 轨 | 渲染加 `--muted`(合同默认无音轨,spec §6.4) |

**整体降级顺序:Hybrid → 单引擎 → 降低画面野心。**
两个引擎接不上时,交一个由单引擎完整做出来的镜头,永远好过交一个半拉的 Hybrid。
Hybrid 是加分项,不是及格线。

## Verification

一条命令跑完整条链路:

```bash
tools/smoke-dual-engine.sh
```

它按顺序执行(所有 `cd` 关在 subshell 里,任何一步失败都不会把后续步骤留在错误的工作目录):

```bash
cd templates/hyperframes-base
npm run --silent check
npm run --silent render -- --quality draft --output out/hybrid-bg.mp4
cd ../..
tools/normalize-shot.sh templates/hyperframes-base/out/hybrid-bg.mp4 \
                        templates/remotion-base/public/hybrid-bg.mp4 1080 1920 30 none
cd templates/remotion-base
npx tsc --noEmit
npx remotion still HybridSmoke --frame=75 review/hybrid-smoke-75.png
npx remotion render HybridSmoke out/hybrid-smoke.mp4 --muted
cd ../..
tools/validate-output.sh templates/remotion-base/out/hybrid-smoke.mp4 \
  --size 1080x1920 --fps 30 --duration 5 --dur-tol 0.2 --audio none
```

期望输出:HyperFrames `◇ Check passed`、规范化自检 `✓ 1080x1920 yuv420p 30/1`、
`tsc` 无输出、validate 全 `✓` 后 `PASS`。

**脚本退 0 不等于通过。** 必须用 Read 打开 `templates/remotion-base/review/hybrid-smoke-75.png`
亲眼确认两件事:

1. **景观层确实在画面里** —— 认得出 `hyperframes-base` 那张图(深蓝渐变、网格、
   左下琥珀辉光、环弧、右下 LAYERS 卡片),不是黑屏也不是纯色;
2. **精确层清晰锐利** —— 标题没被背景吃掉,中文字形是得意黑(Smiley Sans,带斜切笔画),
   不是回退字体(思源黑体是正的,一眼能分)。

任一条不成立就改 `HybridSmoke.tsx` 重跑。**画面质量没有自动化替代品**,
`validate-output.sh` 只查客观规格,查不出"背景没铺上"或"字被吃了"。

已知产物规格(2026-08-01 实测):

```
codec h264 / profile High / level 40 / 1080x1920 / SAR 1:1
30 fps / 150 帧 / 5.000s / 无音轨 / pix_fmt yuvj420p
```

> **注意 `yuvj420p`(full range)**:Remotion 默认输出是全范围,而合同规格(spec §6.4)
> 要的是 `yuv420p`。单镜自查不受影响,但**多镜拼接前必须把 Remotion 的产物也过一遍
> `tools/normalize-shot.sh`**,否则同一条片子里会出现色域范围不一致的镜头——
> 表现是切换时整体亮度跳一下,很容易被误判成"转场没做好"。
