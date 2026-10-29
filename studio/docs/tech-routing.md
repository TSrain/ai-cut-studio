# 技术选型路由(索引)

**路由单位是镜头,不是项目。** 判据、信号定义、分数公式、示例全部在 **`docs/engine-routing.md`**;
短合同版本在 `docs/visual-first.md` 的 Engine Routing 一节,两者冲突时以短合同为准。
本文件只做索引和"引擎之外的技术怎么选"。

## 三个路由

| 路由值 | 什么时候 | 谁来做 |
|---|---|---|
| `remotion` | 字幕、配音、逐帧节拍、毫秒级时长;真实数据绑定与图表;跨镜位置/颜色/元素延续;长序列复杂 `<Sequence>`;需要作为最终集成层 | `templates/remotion-base` |
| `hyperframes` | 网页截图 / 产品网站 / App 界面 / DOM 重构;Kinetic Typography、GSAP 时间线、复杂遮罩与文字变形;WebGL / Shader / 3D / 液态玻璃 / 粒子;Registry 已有高度匹配的 block | `templates/hyperframes-base` + `hyperframes` skill 系列 |
| `hybrid` | **例外**。同一镜既有离不开 HyperFrames 的视觉主体,又有离不开 Remotion 的字幕/数据/时间精度 | HyperFrames 出层 → 规范化 MP4 → Remotion 做最终文字与拼接 |

**不得为了"两个引擎都用到"而选 `hybrid`;也不得因为"模板在这儿"把所有镜路由到 `remotion`。**
后者是 `docs/visual-first.md` 明列的禁止回归项。

## 怎么跑

```bash
node tools/route-shot.mjs projects/<name>/shots/shot-003/signals.json \
  > projects/<name>/shots/shot-003/route.json      # 十一个信号 → 引擎 + 两个分数 + 理由
tools/normalize-shot.sh <引擎产物> <目标> <W> <H> <fps> none   # 任何引擎的输出都要过这一步
tools/concat-shots.sh projects/<name>/out/final.mp4 <规范化后的各镜>
```

细则见 `docs/engine-routing.md`:十一个信号的 0/1/2 判定措辞、判定顺序、Hybrid 用量自检、
输出规范化标准、`route.json` 与人工覆盖的记账方式、五个示例镜头。

## 引擎之外(按输出形态选,不按技术偏好选)

| 需求 | 用什么 | 说明 |
|---|---|---|
| 数据驱动的复杂布局(力导向 / 桑基 / 地图投影) | D3 只做布局计算,渲染仍走本镜的引擎 | 简单图表继续在 Remotion 里用 SVG 画(模板已有 `LineChartReveal`),不为此引入 D3/ECharts |
| 三维场景 | HyperFrames 镜用 Three.js;Remotion 镜用 `@remotion/three` | 视觉主体是 3D 时优先按 `shader3d` 路由到 HyperFrames |
| 矢量 / 角色动画交付给开发集成 | Lottie(静态装饰)/ Rive(交互与数据驱动) | 用户明确要该交付格式时 |
| 批量转码、拼接、加音轨 | FFmpeg | `tools/normalize-shot.sh`、`tools/concat-shots.sh` 已封装常用路径 |
| 网页嵌入、随滚动或交互驱动 | GSAP(复杂时间轴)/ Motion(React UI)/ anime.js v4(轻量) | 交付物是网页而不是视频文件时 |

## 引入新技术栈的规矩

1. 先在 `templates/` 下建立对应模板并跑通一个演示,再用于真实项目。
2. 每个偏离默认双引擎的决策记入项目的 `DELIVERY.md`:为什么选它、为什么两个引擎都不行。
