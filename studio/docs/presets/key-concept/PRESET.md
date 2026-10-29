# key-concept · 关键概念强调卡

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 关键概念强调卡
role: 口播点到一个关键概念时,把它钉在观众视网膜上(用户点名的第一模板)
duration_seconds: [2.5, 6]
colors: 全部来自皮肤;色板用 slab.deep(深蓝反白),禁直接读 P.accent
typography: term=hero(185 起缩至 120)/ en=label / sentence=body;kit 由皮肤定
spacing: 色板斜切 -8°,top 620 高 640;term 左对齐 pad+0.14em(斜体出血补偿)
motion:
  - {phase: enter, seconds: 0.07, action: term 上浮 0.4s,弹簧过冲 1.5%(唯一弹簧名额), easing: ENTER+spring}
  - {phase: enter, seconds: 0.33, action: en 左滑淡入 0.33s}
  - {phase: enter, seconds: 0.60, action: sentence 上浮淡入 0.4s}
  - {phase: enter, seconds: 0.87, action: 记号笔色带扫过 highlight 0.47s}
  - {phase: hold, seconds: elastic, action: 静止读取}
slots:
  term: 关键词,支持 \n 折行(每行 ≤5 个中文字在 185px,自动缩至 120)
  en: 西文小标,可省
  sentence: 一句解释,可省,支持 \n
  highlight: sentence 里上色带的子串,必须逐字出现在 sentence 中
```

## 用法

```json
{"id": "shot-005", "preset": {"id": "key-concept", "version": 1},
 "presetProps": {"durationSeconds": 3.5, "slots": {
   "term": "上下文\n工程", "en": "CONTEXT ENGINEERING",
   "sentence": "给模型的不是一句提示词,\n而是一整套工作记忆。", "highlight": "工作记忆"}}}
```

## 什么时候用 / 不用

- **用**:口播第一次引入一个具名概念;观众需要记住这个词。
- **不用**:概念需要图解才能懂(那是解释镜,走 custom);一镜里想强调两个词(strong emphasis ×2 = no emphasis)。

## 设计取舍记录

- 琥珀橙亮色板被用户否掉(「像语文教科书封皮」),定为深蓝色板反白字(2026-08-06,见 baseline changelog)。
- enter 各相位是绝对秒:2.5s 和 6s 的版本前 1.34s 完全一样,伸缩全部落在 hold——改这里等于改这张卡的性格,须 bump 版本。
- highlight 色带扫入方向固定左→右(阅读方向);别做居中扩散,那是另一种语义(爆发,不是划重点)。
