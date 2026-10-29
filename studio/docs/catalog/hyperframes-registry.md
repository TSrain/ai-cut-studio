# HyperFrames Registry 可视化索引

**这是"能直接装进来用"的那一层**——169 个条目,`npx hyperframes add <名字>` 一句话装完(实测 2.6 秒),
不用手搓、不用翻源码。本文件是从中挑出的 **35 个和口播插片相关的**,每个都实渲了缩略图。

> 缩略图截于 2026-08-07,CLI `0.7.97`。全量列表随时用 `npx hyperframes catalog` 现查(本文件不是全集)。
> 分类网格图在 `docs/catalog/hyperframes/grid-*.png`,单张在同目录 `<名字>.png`。

## 怎么用

```bash
npx hyperframes catalog                      # 全量 169 条,带 tag
npx hyperframes catalog --tag transition     # 按标签筛
npx hyperframes catalog --json               # 机器可读
npx hyperframes add <名字> --dir <项目>       # 装单个
npx hyperframes add <标签> --dir <项目>       # 装整类(如 add captions)
npx hyperframes preview                      # 起浏览器 studio 自己翻着看
```

装完的 **block** 落成 `compositions/<名字>.html`(自包含子合成);
**component** 不落文件,它是要合并进 `index.html` 的代码片段——这是两种东西,别混。

## 挂载子合成的三个坑(踩过,别再踩)

第一次批量出图 35 个全黑,原因全在这三条,`add` 给的 snippet **不能照抄就用**:

1. **挂载 div 必须在 `#root` 内部**。`add` 输出的 snippet 只是一行 `<div data-composition-src=…>`,
   顺手贴在 `</body>` 前就等于贴到了合成树外面,渲染器根本不遍历它 → 全黑,而且 `lint` 不报错
   (它能读到 block 内部的 GSAP 时间线,所以看起来一切正常)。判断方法:`hyperframes check` 里
   **`Layout: 0 issues across 0 samples`** —— 0 samples 就是没挂上,不是"没问题"。
2. **必须补 `data-start`**。snippet 只给 `data-duration`。
3. **`#root` 的 `data-duration` 要 ≥ block 时长**,画布宽高也要跟着 block 走。
   blank 模板默认 10 秒,而 `transitions-dissolve` 是 24 秒,不改的话后半段采样全落空。

挂载器已沉淀成 `node tools/hyperframes-mount.mjs <项目目录> <block名> <宽> <高> <时长秒>`——
它按上面三条规则重建 `index.html` 的 body,配合 `npx hyperframes snapshot --at <秒> --no-end` 即可出图。

## 进成片的路径

HyperFrames 是**平级引擎**,不是 Remotion 的备选。这些 block 走既有的 Hybrid 路径:
HyperFrames 渲出 mp4 → `tools/normalize-shot.sh` 规范化 → Remotion 叠最终文字与拼接。
判据见 `docs/engine-routing.md`;**不要为了"两个引擎都用到"而选 Hybrid**。

---

## 一、转场合集 · `grid-transitions.png`

![transitions](hyperframes/grid-transitions.png)

**每个 block 是一份合集,不是一个转场**。缩略图底部的小字就是当前正在演示的手法名
(Blur Crossfade / Grid Dissolve / Overexposure Burn / Diamond Iris / Zoom Through /
Page Burn / Chromatic Aberration / Vertical Push / Horizontal Blinds…)。
一帧只抓得到其中一个,想看全要自己 `preview` 拖时间轴。

| 名字 | 时长 | 里面有什么 |
|---|---|---|
| `transitions-dissolve` | 24s | 溶解/淡入淡出族 |
| `transitions-blur` | 20s | 模糊族(含方向性模糊) |
| `transitions-grid` | 11s | 网格瓦片族 |
| `transitions-light` | 21s | 光效/过曝燃烧族 |
| `transitions-mechanical` | 15s | 快门/光圈族 |
| `transitions-radial` | 20s | 径向擦除族 |
| `transitions-scale` | 15s | 缩放/推近族 |
| `transitions-3d` | 11s | 3D 翻转旋转族 |
| `transitions-destruction` | 14s | 破碎解体族 |
| `transitions-distortion` | 21s | 扭曲/色差族 |
| `transitions-push` | 24s | 推移滑动族 |
| `transitions-cover` | 21s | 覆盖/揭开族 |

## 二、着色器转场 · `grid-shader.png`

![shader](hyperframes/grid-shader.png)

单个手法,GLSL 实现,比上面 CSS 族更重也更有质感。**它们需要前后两个场景才有意义**,
单独挂上去是黑的(我第一次就是这么被骗的)。

`domain-warp-dissolve`(分形噪声域扭曲)· `ridged-burn`(脊状湍流燃烧)· `swirl-vortex`(漩涡)
· `glitch`(数字故障)· `gravitational-lens`(引力透镜)· `sdf-iris`(SDF 虹膜)

同族还有:`whip-pan` `ripple-waves` `cinematic-zoom` `chromatic-radial-split`
`thermal-distortion` `flash-through-white` `cross-warp-morph` `light-leak`。

## 三、叠加层与质感 · `grid-overlay.png`

![overlay](hyperframes/grid-overlay.png)

**这一类对口播最实用**——不改内容,只改"看起来像什么"。

| 名字 | 用途 |
|---|---|
| `organic-light-leak-overlay` | 漏光,回忆/转场动机 |
| `editorial-flash-overlay` | 闪光切,社交感揭示(缩略图偏空是因为闪光只在瞬间) |
| `freeze-frame-dressing` | 定格 + 纸/胶带/拼贴装饰 |
| `camcorder-hud` | REC / 电量 / 时间码,DV 摄像机质感 |
| `vfx-liquid-background` | WebGL 液体位移背景,HTML 内容浮在波面上 |
| `liquid-glass-widgets` | 磨砂玻璃卡片 + 极光着色器底(WebGPU) |

### component 是另一种东西(装法不同)

`add` 装 component 时**不落 `compositions/<名>.html`,落 `compositions/components/<名>.html`**,
而且它不是子合成、是要**粘进 index.html** 的代码片段。第一次批量出图时我按 block 的路径去找,
误判成 8 个"安装失败"——其实一直是成功的。

8 个:`grain-overlay` 颗粒 · `vignette` 暗角 · `shimmer-sweep` 扫光 · `motion-blur` 速度驱动运动模糊
· `texture-mask-text` 66 种材质切字(装出来是目录)· `morph-text` 粘液字变形
· `grid-pixelate-wipe` 像素格擦除 · `caption-blend-difference` 自动反色字。

**其中三个已经移植成 Remotion 组件,口播镜直接用,不必走 HyperFrames:**
`FilmGrain` / `Vignette` / `ShimmerSweep`(见 `docs/component-catalog.md`)。
它们本来就是纯 CSS/SVG,为一层颗粒走 Hybrid 转一圈不值。**移植时必须改掉时间驱动**——
原版 `grain-overlay` 用的是 `animation: … infinite`(墙钟驱动),在 Remotion 里
重渲结果不一致、抽帧自查失效;改成每帧从 `frame` 推导 feTurbulence 的 `seed`。

剩下 5 个不移植:`morph-text` 要 SVG 阈值滤镜 + GSAP,`motion-blur` 要逐帧采样元素位移,
`texture-mask-text` 带 66 张材质资源——这几个留在 HyperFrames 侧用,走 Hybrid 更划算。

## 四、内容型:数据 / 地图 / 社交卡 · `grid-content.png`

![content](hyperframes/grid-content.png)

| 名字 | 是什么 | 备注 |
|---|---|---|
| `data-chart` | NYT 风格柱+线图,交错入场 | 米色纸感底,排版讲究 |
| `world-map` | 世界 GDP 分级填色 + 旋转地球嵌套 | D3 Natural Earth 投影 |
| `us-map` | 美国州级人口密度分级填色 | 同族还有 bubble / hex / flow 四种 |
| `flowchart` | 决策树,SVG 连线 + 便签节点 + 光标交互 | 带打字纠错动画 |
| `x-post` | X/Twitter 卡片 + 互动数 | |
| `reddit-post` | Reddit 卡片 + upvote | |
| `macos-notification` | macOS 通知横幅 | 缩略图里在右上角,很小 |
| `news-ticker` | 广播下三分之一 + LIVE 标 + 滚动条 | |

地图这一类正好补上 `docs/broll-capability-report.md` 点名的 Johnny Harris / Vox 甜区,
和 `remotion-maps` 是两条并行的路。

> **⚠ 地图 block 违反确定性条款,不能直接进成片。** `nyc-paris-flight` / `north-korea-locked-down`
> 这类实景地图渲出来右下角带 `© OpenStreetMap contributors © CARTO`——**瓦片是渲染期网络请求**,
> 和 `docs/agent-runbook.md` 里对 MapLibre 的警告是同一条:重渲结果不一致、断网直接失败、抽帧自查失去意义。
> 要用必须先把瓦片落到本地再渲。**默认仍走 `remotion-maps` 的 `static-map`**(图片先下载进
> `build/public/` 再做动画),这是唯一天然满足确定性的路径;Registry 的地图 block 只在
> 已经把瓦片本地化之后才允许进队列。
> `world-map` / `us-map` / `spain-map` 是 **D3 + 内联 SVG**(不吃瓦片),不受这条限制,可以放心用。

## 五、展示型 · `grid-showcase.png`

![showcase](hyperframes/grid-showcase.png)

`logo-outro`(逐件拼装的 logo 揭示 + 辉光 + slogan)· `ui-3d-reveal`(UI 元素透视 3D 揭示)
· `apple-money-count`(Apple 风格金额计数 + 闪绿 + 钱币爆发 + 音效)

同族还有 `nyc-paris-flight`(地图飞线)· `north-korea-locked-down`(地图推近 + 红圈批注)
· `vpn-youtube-spot` · `app-showcase` · `blue-sweater-intro-video`。
这些自带音效,是完整的成品级插片,适合直接改文案复用。

---

## 没进本索引的

- **字幕样式 15 种**(`caption-*`):卡拉OK / 霓虹 / 字重变化 / emoji / 编辑部强调 / 视差 /
  RGB 故障 / 矩阵解码 / 粒子爆发 / 材质 / 擦除 / 动感撞击 / 渐变 / TikTok 高亮 / 混合反色。
  `npx hyperframes add captions` 一次装全。口播上字幕时现查。
- **下三分之一 12 种**(`lt-*` + `lower-third-bild`):访谈/播客人名条。
- **VFX / 液态玻璃**:`vfx-text-cursor` `vfx-iphone-device`(真 GLTF iPhone/MacBook + 屏内 HTML)
  `vfx-magnetic` `vfx-portal` `liquid-glass-notification/context-menu/media-controls`。
- 各国地图变体、`spain-map`、`instagram-follow` / `tiktok-follow` / `yt-lower-third` / `spotify-card`。
