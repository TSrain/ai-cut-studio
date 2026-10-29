---
id: depth-surface-stack
一句话: 底场渐变 + 结构层 + 抬升承托面 + 暗角,四层叠出纵深,内容坐在上面
适用: **任何觉得"画面太素"的镜**;引用别人的素材需要压住边缘;信息卡类画面的地板
时长: 全镜常驻(不是一个事件)
能量: 低(它是地板,不是主角)
canvas: 1080x1920
uses_components: [BackgroundSystem, SurfacePanel, Vignette, FilmGrain]
uses_sfx: []
camera: none
externalRef: null
---

## 意图
"画面太素"几乎从来不是元素不够多,是**层级不够**:平色底 + 一个元素 = 两层明度,
`frame-audit` 的明度层数只有 1–3,墨量个位数。加元素解决不了,加**层**才能。
这不是装饰——`docs/design-principles.md` §8 禁的是"无信息理由的光",不禁用材质做**版式层级**。

## 动效核心
- 核心配方一行:**底场(带方向的渐变,不是纯色)→ 结构层(网格/颗粒)→ 抬升面 → 压边**。
- 光从上方来:`BackgroundSystem` 的 field 是 `radial-gradient(... at 50% -10%)` 上亮下暗,
  `SurfacePanel` 的顶部高光同一个光源假设——**两者的光源必须一致**,不一致会看着脏。
- 内容坐在 `SurfacePanel` 上而不是直接贴底,是为了让内容和背景之间有一道明确的边界。
- `Vignette` 放在最下、`FilmGrain` 放在最上(前景颗粒盖在一切之上)。

## 参数表
| 参数 | 典型值 | 调节手感 |
|---|---|---|
| `BackgroundSystem.intensity` | 0.5–0.6 | 结构层不透明度。>0.75 网格开始抢戏 |
| `BackgroundSystem.variant` | 技术/数据用 `grid`,情绪用 `aurora` | 信息密度高时 `aurora` 会抢戏 |
| `SurfacePanel.material` | `glass` | 半透明能透出底场的结构,`solid` 会把下面四层全挡掉 |
| `FilmGrain.intensity` | ≤0.2 | 视频压缩最吃高频噪声,超了会让码率全花在噪点上 |
| `Vignette.strength` | 0.2–0.35 | 放**别人的素材**时最有用——那些图边缘又亮又杂 |

## 已知坑
- `FilmGrain` 在暗底必须 `blend='soft-light'`;`overlay` 在明度 <0.5 的底上算出来还是黑,等于没加。
- `Vignette` 的 `color` 只吃 hex(内部走 `alpha()`),传 `'black'` 会 NaN **静默失效**。
- 整画布组件(自带绝对坐标的那些)不要塞进 `SurfacePanel`,会画到面板外面去。
- 判据不是"看着够不够":跑 `node tools/frame-audit.mjs`,明度层数 <6 就是没搭起来。

## 参考实现
`templates/remotion-base/src/components/visual/{BackgroundSystem,SurfacePanel}.tsx` +
`{FilmGrain,Vignette}`;`CatalogThumb.tsx` 的 `Frame` 外壳就是这份配方的实现,样张 `depth-surface-stack`
