# card-swarm · 卡片群收束

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 卡片群收束
role: 口播讲「东西很多 → 真正有用的很少」时的画面。历史上手搓最多次的一种镜头,四次
duration_seconds: [3, 8]
colors: 全部来自皮肤;走卡=surfaceRaised + line 描边,留存卡=accent 渐变 + accent 描边 + 微光
typography: 眉题 label 档、留存标签 label 档(accent 色)、结论句 h2 档自动缩字
layout: >
  网格居中于画布 520–1500;列数由 variant.cols 定(4/5/6),卡片尺寸随列数自动算(不写死);
  留存卡收束到网格中心区,最多 4 列一排;结论句固定在 1560
motion:
  - {phase: enter, seconds: 0, action: 由内向外依次弹入填格(1.15 帧/张);第 0 帧底与眉题已在, easing: ENTER}
  - {phase: move, seconds: 40%–68%, action: dedup 被最近留存卡吸走缩没 / filter 变暗下滑出画, easing: MOVE}
  - {phase: move, seconds: 52%–80%, action: 留存卡收束到中心并点亮(与上一拍重叠), easing: ENTER}
  - {phase: hold, seconds: elastic, action: 完全静止读取(末段约 1.5–2s)}
slots:
  total: 铺满网格的卡片总数(8–48;30 左右最像「很多」)
  keep: 收束后剩下几张(1–6 最好读;必须小于 total)
  eyebrow: 可选,顶部眉题
  keepLabel: 可选,贴在留存卡上方的 accent 小字
  caption: 可选,底部结论句,可折行
variants:
  mode: dedup 被合并(讲重复/同质) / filter 被刷掉(讲筛选/过滤)
  cols: 4 / 5 / 6 列
```

## 用法

合同镜条目只写:

```json
{"id": "shot-004", "preset": {"id": "card-swarm", "version": 1},
 "presetProps": {"durationSeconds": 5, "variant": {"mode": "dedup", "cols": 5},
   "slots": {"total": 30, "keep": 4,
     "eyebrow": "信息收束 · SIGNAL",
     "keepLabel": "真正新增的信息",
     "caption": "看起来有几十条,\n真正新增的只有几条。"}}}
```

## 为什么是三拍,不是五拍

历史上做过五阶段版(涌入 / 去重 / 过滤 / 打分 / 精选,13 秒),用户当时反馈
「精简两拍版没有第一版好」。但返工复盘的结论是:**多的那几拍值钱的是"演完整",
不是"分得细"**——观众记住的是"多 → 少"这一件事,中间分几步他不数。

所以模板固化三拍骨架,中间那拍用 `mode` 切语义。真需要逐阶段演示(比如要讲清楚
"先去重、再过滤、最后打分"三个不同动作),那是 custom 镜,不该塞进模板——
塞进来就会变成一个有七个开关的模板,而那正是模板存在的反面。

## 踩过的坑(改这个模板前先读)

1. **settle 必须和 cull 重叠。** 初版让"留存卡聚拢"等到"非留存卡走光"之后再开始,
   结果 67% 处出现一段死画面:走的没了,留的还散在原位且没高亮,画面上只有几张孤零零的暗卡。
   现在 settle 从 52% 起(cull 中段),两件事读作同一个动作的两面。
2. **留存卡要均匀撒开,不能随机挑。** 随机会撞出"两张留存卡挨着、另一角一张都没有",
   被吸走的卡就得横穿半个画面,读作乱飞而不是合并。`layout()` 按 total/keep 步长均匀取。
3. **卡内不放真文字。** 三十张卡上的真文字没人看得完,只会把画面变脏。两条骨架线足够
   让它读作"一张有内容的卡"。
4. **卡片尺寸不许写死。** 4 列和 6 列的视觉密度差很多,写死一套值换列数就崩。
