---
id: texture-floor
一句话: 底纹 + 胶片颗粒 + 暗角三层压在一起,给画面一个不是死色块的地板
适用: 全片底层;任何"底色是一块纯色"的画面;引用别人素材时压边
时长: 全镜常驻
能量: 低(它必须不被注意到)
canvas: 1080x1920
uses_components: [DotField, FilmGrain, Vignette]
uses_sfx: []
camera: none
externalRef: null
---

## 意图
底色不能是一块死掉的纯色——这是"看着专业"和"看着像 PPT"之间最容易被忽略的一层。
但它的成功标准很特别:**观众注意到有点、有颗粒,就已经过头了**。它只负责让画面不塑料。

## 动效核心
- 核心配方一行:**三层都压在感知阈值附近,合起来有、单独看没有**。
- `DotField` 给密度与尺度感;`FilmGrain` 去塑料感;`Vignette` 把注意力收回中心。
- 叠放顺序:Vignette 在下,DotField 在中,FilmGrain 在最上(前景颗粒盖在一切之上)。

## 参数表
| 参数 | 典型值 | 调节手感 |
|---|---|---|
| `DotField.opacity` | **0.55 已是上限区** | 实测原片亮度差只有 +3~+11。调到 1.0 点清晰可见,那就不是肌理是装饰 |
| `DotField.gap` | 1080 宽画布 12 | 画布更大要按比例放大,别让点变稀 |
| `FilmGrain.intensity` | ≤0.2 | 视频压缩最吃高频噪声 |
| `Vignette.strength` | 0.2–0.35 | 放别人的素材时最有用 |

## 已知坑
- 同一帧放多个 `DotField` 必须给不同 `id`,否则 SVG pattern id 撞车会串色。
- 多层叠加要用 `offsetX`/`offsetY` 错开相位,不然出摩尔纹。
- `FilmGrain` 暗底必须 `blend='soft-light'`;`Vignette.color` 只吃 hex,传 `'black'` 会 NaN 静默失效。
- 这三层**不算**"主要视觉模块"(规格 §10 的每镜 ≤3 不含它们),但仍受质量检查单约束。

## 参考实现
`templates/remotion-base/src/components/{DotField,FilmGrain,Vignette}`;样张 `texture-floor`
