# Engine Routing — 逐镜双引擎路由

`docs/visual-first.md` 的 Engine Routing 一节是短合同,本文件是它的展开:**信号怎么填、路由器怎么判、产物怎么规范化、人工改路由怎么记账**。
两者冲突时**以 `docs/visual-first.md` 为准**,并回来修本文件。

一句话立场:**路由单位是镜头,不是项目。** 同一个项目里 Remotion 镜和 HyperFrames 镜可以并存;
"模板在这儿所以全用 Remotion"是 `docs/visual-first.md` 列明的六条禁止回归之一。

实现在 `tools/lib/engine-router.mjs`,命令行入口 `tools/route-shot.mjs`,产物落在 `shots/shot-<NNN>/route.json`。

```bash
node tools/route-shot.mjs projects/<name>/shots/shot-003/signals.json \
  > projects/<name>/shots/shot-003/route.json
```

## 1. 十一个信号

信号是**视觉导演主观填写的**,不是测量出来的。路由器只是把这十一个数按固定公式算一遍——
**路由质量的上限就是填数的严谨程度**,填松了没有任何下游环节能救回来。

### 1.1 三档刻度(先记这三句,再看逐信号)

| 档 | 含义 | 判定问句 |
|---|---|---|
| **2** | **硬需求。这一条不满足,这个镜头就等于做失败了。** | "降一档会毁掉这镜吗?"——答不出**具体**哪里毁了,就是 1。 |
| **1** | **明显有这个需求,但可以让步。** 降一档画面仍然成立,只是不如原计划。 | "降一档还能交吗?"——能,就是 1。 |
| **0** | **不涉及。** 本镜没有这个东西,或者有也不影响选哪个引擎。 | "这条对选引擎有影响吗?"——没有,就是 0。 |

**2 不是"这个镜头有这个东西"。** `captions: 2` 的意思是「毫秒级字幕同步是本镜不可妥协的硬需求」,
**不是**「本镜有字幕」——**绝大多数带字幕的镜头应该填 1**。同理 `shader3d: 2` 不是"画面里有点辉光",
而是"本镜的视觉主体就是 shader,换成 2D 实现等于换了个镜头"。

**填 2 之前先看第 3 节的连锁反应:同一个镜头里同时出现两个 2(一个精确侧、一个视觉侧)就会直接触发 Hybrid,双引擎渲染成本翻倍。**
所以每填一个 2,先自己答一句"这个真的不能让步吗"。

### 1.2 Remotion 侧信号

| 信号 | 2(硬需求) | 1(可让步) | 0(不涉及) |
|---|---|---|---|
| `framePrecision` | 画面事件必须钉在**具体帧**上(对轨、卡点、逐帧节拍),差两帧当场看得出来 | 有节奏要求,但差几帧没人看得出来 | 镜内没有需要对齐的时间点 |
| `dataBinding` | 画面几何由**外部真实数据**算出来(图表形状、比例、数字),改一个数值画面必须跟着变;写死等于做假 | 有数字或图表,但值是固定的,直接写进源码就行 | 镜内没有数据 |
| `continuity` | 本镜元素必须和相邻镜在**同一位置 / 同一颜色 / 同一尺寸**接上,接不上就穿帮 | 希望和相邻镜风格连贯,但没有必须逐像素对齐的元素 | 独立镜,前后不共享元素 |
| `captions` | **毫秒级字幕同步是本镜不可妥协的硬需求**——逐词高亮、对口型、SRT 逐条驱动,错 0.1 秒就是事故 | **本镜有字幕或屏幕文字,按时间轴出现即可**(绝大多数带字幕的镜在这一档) | 本镜没有字幕 |
| `audioSync` | 画面必须跟**音频波形 / 鼓点**对齐,错开听得出来 | 有配乐或口播,画面大致跟着走 | 无音轨,或音轨与画面无关 |

### 1.3 HyperFrames 侧信号

| 信号 | 2(硬需求) | 1(可让步) | 0(不涉及) |
|---|---|---|---|
| `webUi` | 本镜的视觉主体就是**真实网页 / App 界面,必须用 DOM 重建**(滚动、真实布局、状态切换);换成图片或手绘 UI 等于换了个镜头 | 画面里有 UI 元素或截图,但只是当素材用,静态贴图就够 | 不涉及界面 |
| `shader3d` | 本镜的视觉主体就是 **shader / 3D / 粒子 / 液态玻璃,换成 2D 实现等于换了个镜头** | 想要一点三维感或程序化质感(景深、微粒、噪声渐变),2D 近似也能接受 | 纯 2D |
| `kineticType` | **文字本身就是本镜的动画主体**——逐字变形、遮罩切分、沿路径走、字重形变;换成整块淡入等于换了个镜头 | 文字有进出场动画(滑入、遮罩擦除),但只是常规上屏 | 文字静态,或无文字 |
| `registryFit` | Registry 里有一个 block **几乎就是本镜要的东西**,调参就能用。**填 2 之前必须真的 `hyperframes catalog` 查过,并把 block 名写进 `dispatch.md`** | 有方向接近的 block,能当骨架但要大改 | 没查到匹配的,或压根没查 |

### 1.4 风险信号(负权重,拉低对应引擎的分)

| 信号 | 2 | 1 | 0 |
|---|---|---|---|
| `remotionRisk` | 已知 Remotion 做这镜会踩坑:要的效果在 React/Remotion 里没有干净实现,或本项目已经试过一次失败 | 能做,但要写不少一次性代码 | `docs/component-catalog.md` 或模板里有现成做法 |
| `hyperframesRisk` | 已知 HyperFrames 做这镜会踩坑:seek 不确定、字体加载不稳、逐帧截取对不齐 | 能做,但要自己写适配 | Registry / preset 里有现成做法 |

> 风险填的是**已知的**坑,不是"我不熟"。不熟不是风险,是还没查 `docs/component-catalog.md` 或 `hyperframes catalog`。

## 2. 两个分数

```
remotionScore    = framePrecision×3 + dataBinding×3 + continuity×3 + captions×4 + audioSync×4 − remotionRisk×2
hyperframesScore = webUi×3 + shader3d×4 + kineticType×3 + registryFit×2 − hyperframesRisk×2
```

`captions` 和 `audioSync` 权重 4 而不是 3,因为这两条错了是**事故**(和声音对不上),
其余是**遗憾**(不够好看)。`shader3d` 在 HyperFrames 侧同理拿 4——它是最不可能被另一个引擎替代的一条。

分数范围:`remotionScore` ∈ [−4, 34],`hyperframesScore` ∈ [−4, 24]。
两侧量纲不同,**不要横向比绝对值**;它们只在第 3 节第 4 条(双高且接近)和第 5–6 条(比大小)里被用到。

## 3. 判定顺序(路由器实际执行的顺序,前面命中就不看后面)

```
exactLayer     = framePrecision==2 || captions==2 || audioSync==2
spectacleLayer = webUi==2 || shader3d==2

1. exactLayer && spectacleLayer                              → hybrid   (硬规则:精确层 + 视觉层)
2. captions==2 || audioSync==2 || dataBinding==2              → remotion (硬规则:精确 / 数据)
3. shader3d==2 || (webUi==2 && registryFit>=1)                → hyperframes (硬规则:视觉 / Registry)
4. 两分都 ≥10 且 |差| ≤2                                      → hybrid   (分数分支,罕见)
5. hyperframesScore > remotionScore                           → hyperframes
6. 否则                                                        → remotion (含平局)
```

**第 1 条是短路的,不看分数。** 这就是"两个 2 的连锁反应":精确侧任一信号取 2、视觉侧任一信号取 2,
这一镜立刻变成 Hybrid,`remotionScore` 和 `hyperframesScore` 完全不参与判断。

第 3 条里 `webUi==2` 需要 `registryFit>=1` 才硬路由——**没有 Registry 支撑的 DOM 重建走分数分支**,
因为从零手写一个网页界面并不比在 Remotion 里画便宜。

## 4. Hybrid 规则

### 4.1 分工(`docs/visual-first.md` / spec §6.3)

1. **HyperFrames 渲背景 / UI / 3D / Shader 层**;
2. 该层输出为**规范化 MP4**,必要时输出带 alpha 的图像序列;
3. **Remotion 负责最终文字、字幕、数据、时间和拼接。**

### 4.2 Hybrid 是例外

> **不得为了"两个引擎都用到"而选 Hybrid。**

一个 Hybrid 镜要跑两套构建、两次渲染、一次桥接,成本大致是单引擎镜的两倍。它只在
"这一镜的视觉主体离不开 HyperFrames,同时它的时间/文字精度离不开 Remotion"时才划算。

### 4.3 Hybrid 用量自检(每批必做)

把所有被判 `hybrid` 的镜列出来,算一下占比:

| 占比 | 结论 |
|---|---|
| **0 – 25%** | 健康。Hybrid 确实是例外。 |
| **25% – 50%** | 偏高。逐镜复核一遍那两个 2,能降的降。 |
| **超过一半(> 50%)** | **几乎肯定是信号填得太松,回去重填,不要接受这个结果。** |

复核办法,逐个 hybrid 镜问两句:

1. 那个**精确侧**的 2(`framePrecision` / `captions` / `audioSync`)真的不能降成 1 吗?
2. 那个**视觉侧**的 2(`webUi` / `shader3d`)真的不能降成 1 吗?

**两句里只要有一句答"能",就改信号、重跑 `tools/route-shot.mjs`**,不是在 `route.json` 里手动改 engine。

### 4.4 为什么这条自检非做不可(实测数据)

把十一个信号的全部 3¹¹ = **177,147** 种取值组合喂给路由器:

| 路由 | 组合数 | 占比 |
|---|---:|---:|
| `remotion` | 81,468 | 46.0% |
| `hybrid` | **71,049** | **40.1%** |
| `hyperframes` | 24,630 | 13.9% |

而这 71,049 个 hybrid 里,**69,255 个来自第 1 条硬规则**,只有 **1,794 个来自第 4 条分数分支**。

结论:**Hybrid 几乎完全由人填的那两个 2 决定。** 路由器不会自己变贪心,是信号填松了。

### 4.5 `motion-srt` 的具体风险

`motion-srt` 每个镜头都带字幕。如果整片视觉方向选了 **Digital Spectacle**
(`docs/visual-first.md` 的三个默认方向之一,明写含 UI / 数据 / 网格 / 玻璃 / 3D / Shader / Kinetic Type),
而每镜的 `captions` 都图省事填了 2、`shader3d` 又填了 2 —— **整片会全部路由成 Hybrid,渲染成本直接翻倍**,
而观众看不出任何差别,因为绝大多数镜的字幕根本不需要毫秒级同步。

正确做法:

- `captions` **默认 1**;只有真的要逐词高亮 / 对口型 / SRT 逐条驱动的那几镜才填 2。
- `shader3d` **默认 1**;只有视觉主体就是 shader 的那几镜才填 2。
- 整片跑完路由后照 4.3 做一次占比自检。

### 4.6 `motion-broll` 的默认引擎

**B-roll 的默认引擎是 Remotion**,理由不是"模板在这儿",而是这个模式的镜头本来就集中在
文字排版 + 数据 + 短时序,正是 Remotion 的甜区;插片彼此独立、时长 3–15 秒,
换引擎带来的收益很难覆盖多一套工程和一次规范化的成本。

因此 B-roll 的路由多了一道留痕要求:

- **preset 镜**不跑路由 —— engine 由 preset 定义钉死,`tools/expand-presets.mjs` 在 `route.json` 里自动带 `override`。
- **custom 镜**照常跑十一信号;结果是 `hyperframes` / `hybrid` 时,除了 `route.json` 的 `override`,
  还要在合同镜条目写 `engineReason`,一句话说清**换回 Remotion 这镜为什么就等于做失败了**。
  `node tools/validate-contract.mjs <合同> --require-preset-matching` 会拦下缺 `engineReason` 的非 Remotion 镜。

这不是禁止换引擎——网页截图重构、Shader、Kinetic Type 该走 HyperFrames 就走,
拦的是"顺手换个引擎试试"这种没有理由的漂移。

## 5. 输出规范化标准

**任何引擎出来的镜头,在进拼接队列之前都必须规范化。** 各引擎的尺寸、帧率、像素格式、SAR 天然不一致,
直接 concat 要么失败要么画面变形,而且报错时已经很难定位是哪一镜的锅。

```bash
tools/normalize-shot.sh <input> projects/<name>/shots/shot-<NNN>/shot-<NNN>.mp4 \
  <合同 canvas.width> <合同 canvas.height> <合同 canvas.fps> none
```

统一规格(spec §6.4):

| 项 | 值 |
|---|---|
| 宽 × 高 | VisualContract 的 `canvas.width` × `canvas.height`,**必须是偶数** |
| 帧率 | 30fps,除非合同明确覆盖 |
| 编码 | H.264 **High Profile** |
| 像素格式 | `yuv420p` |
| 音轨 | **无**,除非合同声明 |
| timebase / SAR / 色彩标记 | 各镜一致(`setsar=1`) |
| 文件名 | `shot-<NNN>.mp4`(三位零填充) |

`normalize-shot.sh` 编码后会自己跑一次 ffprobe 自检(宽/高/帧率/像素格式),不符就非 0 退出。
**自检没过的产物不许进拼接队列**;拼接用 `tools/concat-shots.sh`。

Hybrid 镜的 HyperFrames 层同样走这一步:先规范化成 MP4(或带 alpha 的图像序列)再交给 Remotion 当素材,
不要把一个规格不明的中间文件直接 import 进 Remotion。

## 6. `route.json` 与人工覆盖

每镜必须有 `shots/shot-<NNN>/route.json`,内容是**路由器的原始输出 + 实际采用的引擎 + 覆盖记录**:

```json
{
  "shot": "shot-003",
  "signals": {
    "framePrecision": 0, "dataBinding": 0, "continuity": 1,
    "captions": 0, "audioSync": 0,
    "webUi": 2, "shader3d": 1, "kineticType": 1, "registryFit": 2,
    "remotionRisk": 2, "hyperframesRisk": 0
  },
  "router": {
    "engine": "hyperframes",
    "remotionScore": -1,
    "hyperframesScore": 17,
    "reason": "hard web, registry, or shader requirement"
  },
  "engine": "hyperframes",
  "override": null
}
```

规则:

1. `router` 字段是 `tools/route-shot.mjs` 的**原样输出,不许手改、不许删**。要改判断就改 `signals` 重跑。
2. `engine` 是实际派发用的引擎。没有覆盖时它等于 `router.engine`。
3. **人工改路由必须写 `override`,并写明理由**——理由要说清"为什么路由器的判断在这一镜不成立",
   不接受"我觉得"、"想试试另一个引擎"这类措辞:

```json
"override": {
  "from": "hybrid",
  "to": "remotion",
  "reason": "第 30 分钟熔断:HyperFrames 玻璃层连续两次渲染超时,按 visual-first 熔断条款降级为 Remotion 单引擎同构图实现,牺牲折射质感保住交付",
  "at": "2026-08-01T14:32:00+08:00",
  "by": "visual-director"
}
```

4. 覆盖同时要在 `review.md` 记一行,`build-log.json` 记一个降级事件。
5. **`visual-contract.json` 的 `shots[].engine` 必须与 `route.json` 的 `engine` 一致**,不一致就是派发前没同步,回去改合同。
6. 只有 `visual-director` 能改路由;shot worker 发现路由不合适时**回报**,不自行切换引擎。

## 7. 五个示例镜头

以下取值全部实跑过 `tools/route-shot.mjs`,`R` / `H` 是两个分数。

| 镜头 | fPrec | dataB | cont | capt | audio | webUi | sh3d | kType | regFit | rRisk | hRisk | 路由 | R / H | 命中规则 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|---|
| **数据镜** 营收曲线 + 端点数字,和下一镜共享坐标系 | 1 | **2** | **2** | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | `remotion` | 19 / 1 | 第 2 条(`dataBinding==2`) |
| **UI 镜** 产品官网滚动,Registry 有现成 block | 0 | 0 | 1 | 0 | 0 | **2** | 1 | 1 | **2** | 2 | 0 | `hyperframes` | −1 / 17 | 第 3 条(`webUi==2 && registryFit>=1`) |
| **shader 镜** 液态玻璃开场,主体就是 shader | 0 | 0 | 1 | 0 | 0 | 1 | **2** | 1 | 1 | 2 | 1 | `hyperframes` | −1 / 14 | 第 3 条(`shader3d==2`) |
| **字幕镜** 口播插片,字幕按时间轴上屏 | 1 | 0 | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 1 | `remotion` | 14 / 1 | 第 6 条(Remotion 分高) |
| **混合镜** 3D 粒子背景 + 逐词高亮字幕 | 1 | 1 | 1 | **2** | 1 | 1 | **2** | 1 | 1 | 1 | 1 | `hybrid` | 19 / 14 | 第 1 条(两个 2 短路) |

读法上有两处值得记住:

- **字幕镜的 `captions` 填 1 而不是 2。** 它有字幕、也有节奏,但字幕差 2 帧没人看得出来,所以是 1。
  即便如此 `remotionScore` 仍然 14 比 1 遥遥领先——**不需要靠填 2 来"确保"它走 Remotion**,填 2 只会平白引入 Hybrid 风险。
- **混合镜是唯一填了两个 2 的镜。** 3D 粒子背景在 Remotion 里做不出来(视觉侧硬需求),
  逐词高亮字幕在 HyperFrames 里对不齐(精确侧硬需求),两个都降不了档 —— 这才是 Hybrid 该出现的场合。

## 8. 常见错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 把"本镜有字幕"填成 `captions: 2` | 视觉方向一带 shader/UI 就全片 Hybrid,成本翻倍 | 默认 1,只有毫秒级同步才 2 |
| 因为"模板在这儿"把所有镜填成 Remotion 侧高分 | `docs/visual-first.md` 明列的禁止回归第 3 条 | 按镜头需求填,截图/Kinetic/Shader 镜照实填 |
| `registryFit` 没查就填 2 | 硬路由到 HyperFrames 后发现没有 block,现场手写,时间全花在这镜上 | 填 2 前跑 `hyperframes catalog`,block 名写进 `dispatch.md` |
| 手改 `route.json` 的 `engine` 不写 `override` | 下次没人知道为什么这镜和信号对不上 | 改信号重跑;真要覆盖就写 `override` 三件套(from/to/reason) |
| 跳过 `normalize-shot.sh` 直接 concat | 拼接失败或画面变形,报错时定位不到是哪一镜 | 每镜规范化并通过自检才进队列 |
| 因为渲染队列并发上限 2 就砍镜头 | `docs/visual-first.md` 禁止回归第 4 条 | 并发上限只改变**执行波次**,不改变镜头数量 |
