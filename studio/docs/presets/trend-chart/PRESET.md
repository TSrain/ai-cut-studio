# trend-chart · 趋势图表

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 趋势图表
role: 口播念到「从 X 涨到 Y」「三年翻了四倍」「这里拐弯了」时的画面。八个模板里一张图表都没有,这是最刺眼的空位
duration_seconds: [4, 14]
colors: 全部来自皮肤;图元由 ChartStage 从 palette 取系列色,文字一律走 ink 阶梯(不穿系列色)
typography: 结论句 h1(88,自动缩字,**最大的那个**)、系列名 label、注解 body 46、来源 caption 26
layout: >
  结论句 400;绘图区 880×620 居中于 780;注解 1560;来源 1760。
  轴刻度只留 3 条,单位拼在数值后面
motion:
  - {phase: enter, seconds: 0, action: 结论句立住;**轴与网格先于数据出现**, easing: CALM}
  - {phase: enter, seconds: 20%–72%, action: 折线/面积/柱按时间方向左→右画出,终值为真值, easing: CALM}
  - {phase: hold, seconds: elastic, action: 注解与来源浮出后完全静止读数,约占全片 28%}
slots:
  headline: 结论句(必填)。这一镜最大的那行字
  values: 数据(必填)。逗号隔开,如 3, 8, 19, 40, 61
  seriesName: 这条线是什么(必填)
  xLabels / unit / note / source / eyebrow: 可选
variants:
  mark: line 折线 / area 面积 / bar 柱
  yScale: zero 从零起(默认) / tight 收紧(只对折线生效,且强制画断轴符号)
```

## 用法

```json
{"id": "shot-005", "preset": {"id": "trend-chart", "version": 1},
 "presetProps": {"durationSeconds": 8, "variant": {"mark": "line", "yScale": "zero"},
   "slots": {"headline": "四年,从 3% 到 61%",
     "values": "3, 8, 19, 40, 61",
     "xLabels": "2022, 2023, 2024, 2025, 2026",
     "seriesName": "用 AI 做视频的创作者占比",
     "unit": "%",
     "note": "拐点不在技术,在它变得不用学。",
     "source": "示意数据 · illustrative"}}}
```

**演示数字必须在合同里写 `facts.mode: "illustrative"`**,并把 `source` 填成「示意数据」之类。
模板不校验真实性,但不许让演示数字伪装成真实结论。

## 主角是结论句,不是图

`docs/chart-rules.md` 按观看场景分三档,口播插片是第一档:

> **结论与表现力优先,最大字号承担当前节拍的信息,锁版承担结论,图表只负责作证,不上审计信息。**

所以版面是 **结论句(最大)→ 图(中)→ 注解与来源(最小)**,不是"一张完整报表加个标题"。
y 刻度只留 3 条、单系列不出图例、不给每个点都标数字——这些不是偷工,是这一档该有的样子。

一句自检:**观众看完这一镜,记住的应该是结论句,不是图。** 图的作用是让那句话可信。

## 正确性:结构上做不到违反

`chart-rules.md` 的 §2(坐标比例诚信)和 §4(动画图表的坑)属于**技术硬门槛层**,
连选中的 Styleframe 也不能覆盖。这里不靠调用方自觉:

| 规则 | 怎么保证的 |
|---|---|
| 单轴 | `ChartStage` 只有一个 `yDomain`,永远不提供第二根 Y 轴 |
| 系列色固定顺序、不循环 | `ChartStage` 按数组下标从 CVD 验证过的色板取;超 4 系列直接抛错 |
| 不用彩虹映射数值 | 面积填充是系列色本身的低透明度版,一个色相到底 |
| 文字不穿系列色 | 数值、轴标签全走 ink 阶梯,身份由色块承载 |
| 柱图从零起 | **本模板短路**:`mark: 'bar'` 时无视 `yScale`,强制 `zero` |
| 折线截断必须标记 | `yScale: 'tight'` 时**强制**画断轴符号(轴脚两道斜杠) |
| 轴先于数据出现 | `progress=0` 时 `ChartStage` 已经把轴和网格画好 |
| 绘制方向 = 时间方向 | `progress` 单调 0→1,左→右 |
| 终值是真值 | 绘制进度只走 0→1,不冲过头再回落 |

**为什么不自己画图元:** 上面这一整列,`ChartStage` 已经在组件层实现并 verified 过了。
手搓一份等于把这些规则重新犯一遍——这也是"默认动作是复用+调参,不是手搓"那条规矩最典型的正例。

## `yScale: 'tight'` 什么时候用

数据在 58→61 之间波动时,零基线会把它压成一条平线,趋势就看不见了。这时用 `tight`。

但**它会自动在轴脚画出断轴符号**,不能关。折线可以不从零起(它表达的是变化率),
但截断且不标记,比脚注冗余严重得多——观众读的是形状,不是刻度,
只把最低刻度标成非零数字不算"可感知的标记"。

柱图选 `tight` 会被静默改成 `zero`:柱子长度即数值,截断长度就是骗人,这一条没有例外。

## 踩过的坑

1. **`values` 用逗号分隔的字符串,不用数组槽。** 控制台表单里「3, 8, 19, 40, 61」一行打完最顺手;
   做成一行一个数的多行框,填五个数要按四次回车。中英文逗号、顿号、空格都认。
2. **`xLabels` 数量和 `values` 对不上时整个不画 x 刻度**,不补空字符串——
   补出来的空刻度会让人以为那一格没数据。
3. **单位至少完整出现一次。** `unit` 拼在刻度和端点标签后面;没有单位的图表是读不了的图表。
