---
id: metal-object-beat
一句话: 一枚金属物件加速落下、触底 squash、弹起一次、落回定位,文字随后 spring 弹出
适用: 金句/数字的一次性重击;成本、代价、分量这类需要"实体感"的概念
时长: 约 3.5s(105f)
能量: 高(瞬时冲击,非持续高能)
canvas: 1080x1920
uses_components: [MetalCoin, StickerChip]
uses_sfx: [impact, sparkle]
camera: none
externalRef: null
---

## 意图
抽象的量(钱、代价、分量)靠字号是压不出重量的。给它一个**有质量的物体**,
让观众通过物理直觉接收——落下的加速度、触底的形变、弹起的高度,都是"这东西有多重"的信息。

## 动效核心
- 核心配方一行:**重量感来自加速度和形变,不是尺寸**。
- 落地 squash:`transformOrigin: center bottom`,scaleY 压 / scaleX 鼓;
  接地软阴影随离地高度**变宽变实**——阴影是高度的唯一读数。
- 弹跳分工:主体走**手动分段插值**(EXIT 落 / ENTER 起,重力 = 加速缓动),
  文字用 `spring()`(不 `overshootClamping`)拿轻 overshoot。
- 两者**时间错开**,保证任一时刻只有一个元素在弹——同时弹会读成画面在抖。

## 参数表
| 参数 | 典型值 | 调节手感 |
|---|---|---|
| 落体时长 | 14–18f | 太慢没有重量,太快看不清形变 |
| squash 幅度 | scaleY 0.86 / scaleX 1.08 | 超过 0.8/1.2 就成卡通了 |
| 弹起高度 | 落差的 22–28% | 弹太高读成轻,不弹读成掉了块砖 |
| 文字 spring `delay` | 落定后 +6f | 同时出现 = 两个弹跳打架 |
| `sweepStart` | 落定后 | 反光**一次性**。扫两次变促销横幅 |

## 已知坑
- **币面只放表意符号**(¥ / ★),别写具体信息——会和旁边文字冗余(v1 币面写「5角」+ 旁边写「不到5毛」就是这个错)。
- 金属感靠四件套:齿边 + 偏心径向高光 + inset 双环 + 一次性反光,缺一件就是扁平圆形。
- 竖版里长文案落物件**右侧**而非下方,避免挤下安全区。
- 弹簧名额:这一镜用掉的是合同 `motion.springAccents` 的名额,别在同镜再给别的元素弹。

## 参考实现
`templates/remotion-base/src/components/{MetalCoin,StickerChip}.tsx`;样张 `metal-object-beat`
