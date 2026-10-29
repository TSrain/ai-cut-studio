# 镜头配方(本地层)

一张配方 = **一个具名手法**:哪几个组件组合起来、按什么时序、参数调到多少、哪些参数不能降档、
画面上怎么判断做失败了。它是「散文品味」和「可 import 组件」之间**一直缺的那一层**。

## 和蓝图、组件、preset 的分工(先看清楚再动手,别造第二套系统)

| | 管什么 | 粒度 | 一镜能用几个 | 怎么被读到 |
|---|---|---|---|---|
| **蓝图** `docs/blueprints/` | 一镜的**整体编排**:分几相、每相多少帧、哪相要重叠 | 整镜 | **最多 1 个**(`exclusiveKinds`) | `route-knowledge.mjs` 按标签路由进 dispatch |
| **配方** `docs/recipes/`(本目录) | 一个**具名手法**:组件组合 + 时序 + 参数手感 + 坑 | 手法 | 多个 | dispatch 的 **Recipe shortlist**(按标签重合度) |
| **组件** `src/components/` | 一个**可复用零件**怎么用 | 零件 | 每镜主要视觉模块 ≤3 | dispatch 的 Component shortlist |
| **preset** `docs/presets/` | **填字就能出片**的成品版式 | 整镜 | 1 个(走快车道就不写 tsx) | `docs/presets/MENU.md` 逐镜匹配 |

一句话:**蓝图说「这一镜怎么搭」,配方说「这个手法怎么做」,组件说「这个零件怎么调」,preset 说「这张卡直接填字」。**

⚠️ 已经有蓝图覆盖的编排**不要再写成配方**——那就是「同一堵墙出现两次」。
`evidence-tile-accumulate` / `bilingual-type-interleave` / `scale-pullback-reveal` 三份归蓝图,配方不重复。

## 两层:本地层 vs 索引层

本目录是**本地层**——有实现代码、渲过缩略图、`verified: true`,**可以直接进生产镜头**。

`docs/catalog/recipes-external/` 是**索引层**——152 张外部卡(video-shotcraft,Apache-2.0),
只能浏览和挑,**不能直接用**,也刻意不进 dispatch(152 条涌进 shortlist 会把信噪比冲垮)。
挑中一张再本地化,步骤见那边的 README。

## 卡片格式

```
---
id: <kebab-case>              # 与 components.json 的 id 逐字一致
一句话: <画面上到底发生了什么>
适用: <什么内容该用它>
时长: 约 N.Ns(F 帧@30fps)
能量: 低 / 中 / 中高 / 高
canvas: 1080x1920
uses_components: [...]        # 组合了哪些组件
uses_sfx: [...]               # 音效(没有就写 []);见 assets/library/sfx/
camera: <运镜式名 | none>     # push / pull / pan / diagonal / none
externalRef: <外部卡 key>     # 若源自索引层的某张外部卡,写它的 key;原创写 null
---

## 意图        —— 为什么是这个手法,不是另一个。写不出这段说明它还没成型。
## 动效核心    —— **第一行必须是「核心配方一行」**,一句话讲清机制。
## 参数表      —— | 参数 | 典型值 | 调节手感 |  ← 「调节手感」= 调大调小画面会怎样,这栏才是价值所在
## 已知坑      —— 具体到会犯的错和它长什么样。这一段是下次真会被读到的地方。
## 参考实现    —— 确切的 tsx 路径 / preset id / 样张渲染 id
```

## 加一张配方要做的事

1. 写本目录的卡(格式如上);
2. 在 `templates/remotion-base/src/demo/CatalogThumb.tsx` 的 `SAMPLES` 里加一格样品
   —— **样品必须是真文案**,不是 Lorem;
3. `node tools/build-catalog-thumbs.mjs --only <id>` 渲图,**亲眼看**;
4. 登记进 `docs/catalog/components.json`,`kind: "recipe"`,
   `params` / `pitfalls` 必填(棘轮强制:不写,`node --test tools/tests/*.test.mjs` 直接红);
5. 若源自外部卡,填 `externalRef`,然后 `node tools/build-recipe-index.mjs` 重建索引
   —— 索引里那一式会标成「已本地化」,不会被重复挑中。

## 判断标准

**换一条内容还成立吗?** 成立才写配方;只对某条具体内容成立的编排留在项目里。
和抽组件同一条标准(`docs/agent-runbook.md` 核心决定 #5),只是粒度更粗:
组件是「一个零件」,配方是「几个零件按什么时序凑成一个手法」。
