# 组件 Catalog（机器可读)

`components.json` 是双引擎视觉模块的**唯一权威清单**：74 条（46 条 Remotion 原生组件 + 28 条官方 HyperFrames Registry 条目）。

2026-08-20 补登记了 `src/components/` 下 13 个表达型组件（KenBurns / ContrastColumns / SkeletonCard …）。它们一直在生产中使用，却从未进过这份 JSON——而 dispatch 的 shortlist 正是从这里算的，于是最常用的一批组件在机器路径上完全隐身。同时新增 `params` / `pitfalls` 两个字段（参数 / 典型值 / **调节手感**，以及踩过的坑），由 `tools/tests/component-catalog.test.mjs` 的**棘轮**强制：新条目不写就红，存量 33 条列在豁免名单里，**那份名单只许变短**。缩略图渲染走 `node tools/build-catalog-thumbs.mjs`（合成 `CatalogThumb`，一次一个 id）。

散文版 `docs/component-catalog.md` 讲的是"这个手法怎么做、别做错在哪"；本目录讲的是"有哪些可选项、能不能用、怎么装"。**写任何新镜头之前先按标签查这里**，默认动作是复用+调参，不是手搓。

## 条目字段

| 字段 | 含义 |
|---|---|
| `id` | 唯一小写连字符 id。HyperFrames 条目的 id 必须与官方 Registry 名字逐字一致（`install` 命令直接用它） |
| `engine` | `remotion` \| `hyperframes` |
| `kind` | `component` \| `block` \| `adapter` |
| `title` | 人读名字（Remotion 条目即 PascalCase 组件名） |
| `tags` | 路由维度，见下 |
| `source` | Remotion：仓库内 `.tsx` 路径；HyperFrames：官方 Registry base URL |
| `install` | HyperFrames 安装命令；原生组件为 `null` |
| `thumbnail` | 关键帧缩略图路径（`thumbnails/<engine>/<id>.png`） |
| `verified` | 是否已由人眼看过缩略图确认。**默认 `false`** |
| `seekSafe` | 任意帧可独立计算（无 `Date.now()` / 无 CSS 无限动画 / 无渲染期随机） |
| `cost` | `low` \| `medium` \| `high`（渲染开销量级） |
| `canvas` | 已确认可用的画布尺寸，至少含 `1080x1920` |
| `seekSafeNote` | 仅 `seekSafe: false` 的条目有：为什么先按不安全处理、复核时机 |

## 怎么发现组件

```js
import {filterComponents} from '../../tools/lib/component-catalog.mjs';
const entries = JSON.parse(await readFile('docs/catalog/components.json', 'utf8'));

// 竖屏数据镜头，最多取 3 个候选
filterComponents(entries, {engine: 'remotion', tags: ['data'], max: 3});
```

`filterComponents(entries, {engine, tags, max})` 的语义：engine 精确匹配（省略则不限），`tags` 是**与**关系（条目必须含全部请求标签），`max` 默认 3。

当前标签词表（按用途分组）：

- 内容类型：`data` `chart` `metric` `diagram` `map` `code` `type` `image` `screenshot` `ui` `device` `logo` `brand`
- 结构与版面：`layout` `panel` `stage` `background` `state` `status`
- 运动与处理：`kinetic` `transition` `reveal` `camera` `post` `overlay` `texture` `shader` `3d`

**HyperFrames 条目的 `tags` 目前只按名字能确定的部分填，不确定的宁可少填；Task 4 实装审计（真正装下来渲一帧看过）之后可能修订。** 已知偏薄的条目：`app-showcase`（只填了 `ui`）、`freeze-frame-dressing`、`vfx-iphone-device`。原生 Remotion 条目的标签在组件实现落地后同样要回头对齐实际 props。

## 收录标准（硬性）

1. **必须有实际渲染出来的缩略图，才允许把 `verified` 置 `true`。** 缩略图缺失或没人看过 → 保持 `false`。
2. **`verified: false` 的条目不许在生产镜头里使用。** 它们只是候选池，不是可交付资产。
3. **`verified` 的翻转权只在主 agent（亲眼看过图的那一方）手里。** 实现 worker、后续任务的 worker 一律不得自行翻转——没看过图的人翻这个字段，等于把"验证"降级成"填了个字段"。
4. `seekSafe: false` 的条目不得进入需要抽帧自查或分布式渲染的镜头；要用必须先改造成 frame-driven（`docs/design-principles.md` §9 确定性）。
5. 每条改动后必须跑 `node tools/validate-component-catalog.mjs docs/catalog/components.json`。

## 每镜最多三个主要视觉模块

规格 §10 硬规定：**一个镜头最多引入三个主要视觉模块**。超过三个，不同组件的版面、缓动、材质语言会各说各话，画面就散。`filterComponents` 的 `max` 默认值 3 就是这条规则的落地——需要更多候选时可以调大 `max` 供挑选，但最终进入镜头的主要模块不超过三个。

（背景、颗粒、暗角这类全屏氛围层不计入"主要视觉模块"，但它们本身也受质量检查单约束。）

## 校验

```bash
node --test tools/tests/component-catalog.test.mjs
node tools/validate-component-catalog.mjs docs/catalog/components.json
```

CLI 打印全部错误并在失败时 exit 1；通过时打印 `PASS component catalog: <N> entries`。

## 新增条目的流程

1. **先确认它值得进目录**：换一个内容还能用 → 收；只对这条内容成立 → 留在项目里（`docs/agent-runbook.md` 核心决定 #5）。
2. 在 `components.json` 追加条目，`verified: false`、`thumbnail` 先写好目标路径。
   - Remotion 原生：先把组件落到 `templates/remotion-base/src/components/visual/<PascalCase>.tsx`，`install: null`。
   - HyperFrames：`id` 必须与官方 Registry 名字逐字一致，`install` 用 `npx hyperframes add <id> --dir templates/hyperframes-base --no-clipboard`。
3. 跑校验命令，确认通过。
4. 渲出关键帧缩略图到 `thumbnails/<engine>/<id>.png`。
5. **主 agent 亲眼看图**，确认画面成立后才把 `verified` 改成 `true`，并按实际行为回头修正 `tags` / `cost` / `seekSafe` / `canvas`。
6. 手法层面的坑（为什么这个数、为什么不能那样做）写进组件注释与 `docs/component-catalog.md`，不要只留在记忆文件里。
