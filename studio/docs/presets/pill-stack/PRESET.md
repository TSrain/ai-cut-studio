# pill-stack · 胶囊标签堆叠层

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 胶囊标签堆叠层
role: 口播列举要点时的 overlay 层——白胶囊按口播节奏逐条浮现,叠在实拍上,人一直在场
duration_seconds: [2, 12]
colors: 白胶囊(oklch 0.985 固定)+ 深强调色字(0.42/0.13/skin.accentHue);不走皮肤暗面板——要叠在未知实拍上
typography: items=label(44 起缩至 26)/ title=caption(30);kit 由皮肤定
spacing: 胶囊高=2 倍字号,列间距 0.34 倍胶囊高;整列垂直居中,贴 align 侧(竖 72 / 横 96 内边距)
motion:
  - {phase: enter, seconds: 0.00, action: title(若有)淡入 0.3s, easing: ENTER}
  - {phase: enter, seconds: 0.40, action: 胶囊逐条浮现(透明度 0.25s 先到 + 位移 16px CALM 稳落 + scale 0.97→1),默认每 BEAT 一条,条目带「| 秒数」按写的时间出}
  - {phase: hold, seconds: elastic, action: 出完静置;胶囊不动不呼吸——标签是旁白的注脚,不是主角}
variants:
  align: left 左(默认)/ right 右
  bg: transparent 透明底出 alpha 层(默认)/ scene 皮肤场景底出成片段
slots:
  items: 一行一条,可「标签 | 出现秒数」卡口播节奏;3–5 条,秒数不上画面
  title: 标签列上方一行小字(白+投影),可省
```

## 用法

```json
{"id": "shot-002", "preset": {"id": "pill-stack", "version": 1},
 "presetProps": {"durationSeconds": 4.5, "canvas": "1920x1080",
   "variant": {"align": "left", "bg": "transparent"},
   "slots": {"title": "好习惯的三个标准", "items": ["简单可持续 | 0.5", "随时捡得起来 | 1.6", "不靠意志力 | 2.8"]}}}
```

## 什么时候用 / 不用

- **用**:口播正在列举 2–5 个要点,想让要点"跟着话音浮现"而不切走人;交付双通道 .mov 给用户在剪映里叠。
- **不用**:要点本身需要展开解释(那是 bullet-run 的独立插片);单独一个关键词强调(key-concept)。

## 设计取舍记录

- **来源**:高高lindsey VZ8qrng2nIo t10.7(参考帧 `docs/reference/text-overlay/lindsey-pill-stack.jpg`)。
  原片手法:说到第几条左侧出第几个白胶囊,配合镜头慢拉远。拉远那半在 `tools/aroll-breath.mjs`(作用于实拍),这里只做标签层——**两个运动分属两层,各自独立交付**。
- **本项目第一个双通道 overlay preset**:bg=transparent 时不渲 Foreground/Backdrop(颗粒暗角会压脏用户实拍);预览通道传 `preview:true` 垫深灰演播室底(不然预览一片黑)。
- **白胶囊不走皮肤面板色**:overlay 要叠在未知画面上,白底深字对任何实拍成立(Lindsey 原款);色相仍从 skin.accentHue 派生,调旋钮字色跟着走。
- **落影是 overlay 的分界线**:没有它白胶囊会「印」在画面上而不是「浮」在画面前。
- 位置只给 align 粗方向:精确躲人脸由用户在剪映里拖,这是双通道形态的分工。
