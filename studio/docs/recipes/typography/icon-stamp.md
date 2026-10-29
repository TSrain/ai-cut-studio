---
id: icon-stamp
一句话: 文字先落定,图标随后盖上去——图标是盖章,不是主角
适用: 结论行 / 状态标记 / 清单项的语义标注
时长: 约 2.0s(60f;文字 0–18f,图标 26–44f,静止)
能量: 低
canvas: 1080x1920
uses_components: [TextReveal, SemanticIcon, LottieClip]
uses_sfx: []
camera: none
externalRef: null
---

## 意图
图标和文字同时出现时,观众的眼睛会先被图形吸走,然后再回来读字——这一趟往返是白花的。
让文字先落定、图标后盖,阅读顺序就是**先知道说什么,再拿到一个语义标记**。

## 动效核心
- 核心配方一行:**图标永远晚于文字入场(`delay` ≥8),且不超过一次强调**。
- 静态用 `SemanticIcon`(10 个具名图标,零素材免版权),要动效用 `LottieClip`。
- 图标尺寸与文字大小同量级(88px 对 h2),不要做成"一个大图标 + 一行小字"——那是海报不是镜头。
- 图标颜色跟随语义侧:被否定的一侧走 `ink.muted`,肯定侧走强调色。

## 参数表
| 参数 | 典型值 | 调节手感 |
|---|---|---|
| 图标 `delay` | 文字结束后 +8f | <8f 读成同时出现,盖章感消失 |
| `size` | 88(对 h2 正文) | <40 在竖屏里读不出形状 |
| `strokeWidth` | 7(100 viewBox 基准);细腻时 5–6 | 图标线重要和正文字重观感一致 |
| 图标数量 | 一屏 ≤3 | 超过就变成图标墙,语义被稀释 |

## 已知坑
- **别去图库下图标**——`SemanticIcon` 的 10 个具名图标就是全部词汇;不够用说明该换表达方式。
- `LottieClip` 是外来 Lottie 的唯一入口,别裸用 `<Lottie>`:原素材是 UI toggle,正放末帧常是语义反面
  (`locked` 停在开锁),`up`/`down`/`signal` 末帧是空的。
- 图标不承担信息,只承担语义。信息写在字里。

## 参考实现
`templates/remotion-base/src/components/{SemanticIcon,LottieClip,TextReveal}.tsx`;样张 `icon-stamp`
