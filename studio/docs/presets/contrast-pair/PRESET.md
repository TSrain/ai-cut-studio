# contrast-pair · 左右对照

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
role: 「旧 vs 新 / 不值得 vs 值得」一镜说清。语义靠色:左=退灰,右=点亮
duration_seconds: [2.5, 6]
colors: 皮肤令牌;左列 inkMuted+缩 0.97,右列 ink+accent 标签+下划线(四变量同向叠加)
typography: label 32 / 主句 h2 64(每列半屏,自动缩至 40)
layout: 竖版双列律——中线 x=540,两侧各 80px 留白(原律 40,为中缝圆盘让位加宽),左列右对齐/右列左对齐
motion:
  - {phase: enter, seconds: 0.07, action: 左列先入——对照两侧逐个出,绝不同时淡入(最高频节奏律)}
  - {phase: enter, seconds: 0.40, action: 中线自上而下画出}
  - {phase: enter, seconds: 0.63, action: 中缝符号圆盘 knockout,缩放无弹跳}
  - {phase: enter, seconds: 0.83, action: 右列入场+下划线}
  - {phase: hold, seconds: elastic}
slots: {leftLabel, leftText, rightLabel, rightText, eyebrow?}
variants: {symbol: ≠(否定)|→(演进)|VS(对抗)}
```

## 硬规矩

- **逐个出**:左右同时淡入是这个模板的头号禁忌(shot2redo 的返工原因)。
- **中缝符号无弹跳**(taste.md C6);圆盘用 surface 色 knockout 掉中线交叉段。
- 每侧主句 ≤2 行、每行 ≤6 个中文字(64px 时);更长的话这不是对照镜,是两句话硬挤。

## 用法

```json
{"id": "shot-007", "preset": {"id": "contrast-pair", "version": 1},
 "presetProps": {"durationSeconds": 3.5, "variant": {"symbol": "≠"}, "slots": {
   "leftLabel": "堆提示词", "leftText": "越写越长\n越改越乱",
   "rightLabel": "上下文工程", "rightText": "给对信息\n给够信息"}}}
```
