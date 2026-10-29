> ## ⚠️ 已废弃(DEPRECATED)——历史参考,新项目不得选用
>
> 本风格卡属于 **visual-first 改造之前**的旧体系。它的若干硬规则已被 `docs/visual-first.md`
> 与四份新 profile 取代,具体点名如下:
>
> | 本文件的条款 | 现在的规则 |
> |---|---|
> | 「参数」段 · 缓动:「标准曲线;**禁用弹跳**」 | `docs/visual-first.md`「商务风格禁弹簧 → 改为风格参数;每镜允许 1–3 个受控强调弹簧」 |
> | 「禁止」段的「弹跳、任何『炫』的转场」 | 同上;转场语言由 `visual-contract.json` 的 `transition` 声明,不由风格卡一刀切 |
> | 通篇的低密度 / 低材质预设 | `docs/visual-first.md` 的评分表与 `docs/styles/data-cinematic.md` 的密度要求(密度由结构提供,不是"素") |
>
> 正文一字未改,保留仅为历史参考(读旧项目、追溯 taste.md 里的具名手法时用)。
> **新项目从 `visual-max` / `editorial-luxe` / `brand-energy` / `data-cinematic` 中选。**
> 汇报 / 财务数据类内容对应 `docs/styles/data-cinematic.md`。
> 本文件**不在 `docs/knowledge-manifest.json` 里**,因此永远不会被路由到任何镜头。

# 风格卡:商业咨询(汇报 / 金融数据)

**适用**:项目汇报、商业计划、路演、财务数据解释。

## 参数

- **底色**:浅色 `surface.light`,墨色用 `inkLight` 系
- **色彩**:`scenePalette(hue, 'light', {neutralChroma: 0.006})` 做底色与墨色骨架,图表系列色另取 `theme.seriesLight` 功能色(两套分开,见 `docs/color.md` §5);品牌色替换系列 1
- **字体**:全片 `FONT.text`(Inter + 思源黑体)一个角色;标题 `h2` weight 600,数据用 `textStyle('data')` + `numeric(true)` 等宽对齐
- **字号**:克制——正文密度可以高,但层级要靠字重和灰度拉开,不靠放大
- **动画速度**:中速。入场 12–18 帧;信息多时靠 stagger 分批进入,不同时轰炸
- **缓动**:标准曲线;**禁用弹跳**;数字滚动是主要的强调手段
- **镜头**:基本无镜头运动;转场用干净的推移/淡替,保持"翻页"感
- **图表**:是主角。严格执行 design-principles §4;每页一个图表结论,标题直接写结论句("Q3 由入口业务驱动"而非"Q3 收入构成")

## 禁止

- 弹跳、任何"炫"的转场
- 深色底(汇报场景投影仪上发灰)
- 每页超过一个核心结论
