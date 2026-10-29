# 组件目录

> ## 先看这里:可发现的目录已经是机器可读的
>
> **`docs/catalog/components.json` 是 74 个视觉模块的唯一事实来源**(46 个原生 Remotion 组件 + 28 个官方 HyperFrames Registry 条目),
> 每条含 `engine` / `kind` / `tags` / `source` / `install` / `thumbnail` / `verified` / `seekSafe` / `cost` / `canvas`。
>
> ```bash
> # 按引擎 + 标签查(这是写镜头前的默认动作)
> node tools/validate-component-catalog.mjs docs/catalog/components.json   # 先确认目录本身有效
> node tools/route-knowledge.mjs <remotion|hyperframes|hybrid> <tags>      # 顺带路由该镜要读的知识
> ```
>
> - **缩略图库**:`docs/catalog/thumbnails/remotion/<id>.png` 与 `docs/catalog/thumbnails/hyperframes/<id>.png`
> - **收录与验收规则**:`docs/catalog/README.md`
> - `verified: false` 的条目**不许进生产镜头** —— 它意味着还没有人看过它渲出来长什么样
> - **每镜最多引入三个主要视觉模块**(规格 §10),超过就会变成不同组件各说各话
>
> 本文件保留的是 `templates/remotion-base/src/components/` 下**早期 12 个表达型组件**的散文笔记 ——
> 尤其是每条的「别做错的地方」,那是踩过坑才写得出来的东西,JSON 目录装不下。
> 新组件请同时登记进 JSON 目录并渲出缩略图,不要只写在这里。
>
> **2026-08-19 起,参数表与坑的机器可读版在 JSON 的 `params` / `pitfalls` 字段**——
> `dispatch.md` 的 Component shortlist 从那里取(重合度前 3 名展开完整参数表)。
> 本文件是同一批知识的散文版,**worker 读的是 JSON**,所以补了这里也要补那里。
> 新条目由 `tools/tests/component-catalog.test.mjs` 的棘轮强制:不写参数表,测试直接红。
> 缩略图渲染:`node tools/build-catalog-thumbs.mjs`(合成 `CatalogThumb`,一次一个 id)。

`templates/remotion-base/src/components/` 里已有的可复用组件。**写任何新镜头之前先查这张表**——默认动作是"复用+调参",不是"手搓一个新的"。

手搓一个已有组件的等价物,是本项目最常见的浪费:同一个手法每次重做一遍,质量随每次发挥波动,也不会累积。

写文字和定色之前另有两份**方法论**要读:`docs/typography.md`(字体角色 / `textStyle()` 阶梯 / 中西文混排)和 `docs/color.md`(`scenePalette()` / 明度阶梯 / 强调色面积)。组件只解决"这个手法怎么做",字体配色决定"看着 low 不 low",两者都不能靠现场发挥。

改了任何组件,渲这三个样品册合成看一眼(改了 `lib/fonts.ts` / `lib/color.ts` 则渲 `TypeSpecimen`):

```bash
cd templates/remotion-base
npx remotion still TypeSpecimen     --frame=60  review/type-60.png
npx remotion still ComponentGallery --frame=100 review/gallery-100.png
npx remotion still ContrastDemo     --frame=95  review/contrast-95.png
npx remotion still KenBurnsDemo     --frame=200 review/kenburns-200.png
```

## 表达型(有语义,不是装饰)

| 组件 | 表达什么 | 关键参数 | 别做错的地方 |
|---|---|---|---|
| `SemanticIcon` | 用一个图标点明某一侧的含义(耗时间/增值/被过滤…) | `name` `size` `color` | 10 个具名图标:clock/growth/decline/filter/duplicate/check/cross/search/doc/alert。零素材、免版权登记,别去图库下图标 |
| `ContrastColumns` | 一对一对照:「A ≠ B」「旧 vs 新」 | `left` `right` `symbol` `timing` | **绝不左右同时淡入**——逐个出(左→右→中线→符号);两列贴中线向内对齐;中央符号必须压底色圆盘 knockout 掉中线交叉处 |
| `HesitantCursor` | 犹豫、想选选不下去、试了又退回 | `home` `attempts[{x,y,start,reach}]` | `reach` 取 0.5–0.6 最像犹豫;走太少看不出意图,>0.8 观众以为要点下去。每次试探之间回 home 停一下 |
| `StalledProgress` | 卡住了、努力过没进展 | `pct` `probes[{frame,delta}]` | `delta` 只给 1–2 个百分点,给多了读成"在推进";试探 1–2 次,多了变滑稽抖动 |
| `SkeletonCard` | 一堆内容(信息流/搜索结果/同质化/待筛选) | `w` `h` `title` `highlight` `dim` | 卡里的字是**肌理不是内容**——标题必须弱化(muted+小字+低透明),一旦可读观众就会去读,焦点就散了 |
| `KeywordHighlight` | 在整句里划出关键词 | `delay` `dur` `color` | 色带**后扫**(句子安定之后);跨行连续;**绝不放大关键词占满画面**(丢上下文) |
| `AnnotationMark` | 在截图/图片上**当场画**批注:红笔下划线 / 荧光笔描字 / 手绘圈 / 方框(ScreenPush preset 的勾选层) | `box{x,y,w,h}` `markStyle` `color` `delay` `dur` `seed` | `box` 坐标**必须走网格法**(locate.mjs),目测会骑到别的字上;挂进 `KenBurns` 的 children 才随镜头走,别在外层自算 transform;**画面安定后才下笔**;荧光笔靠 multiply 透字,深色截图上不成立(换红笔系);同屏多个批注换 `seed`。样品:ComponentGallery `--frame=250` |
| `LottieClip` | 24 个描边图标**动效**(判断/风险/状态/趋势/检索/留存/评价) | `name` `size` `color` `fillColor` `durationInFrames` `delay` | 外来 Lottie 的唯一入口,自动重着色成令牌 + 时长重映射。**别裸用 `<Lottie>`**:原素材是 UI toggle,正放末帧常是语义反面(`locked` 停在开锁),`up`/`down`/`signal` 末帧是空的——这些 `ICON_META` 已逐个兜住。图标**永远晚于文字入场**(delay ≥8),它是盖章不是主角。静态版见 `SemanticIcon` |

| `FilmGrain` | 前景胶片颗粒,盖在**任意内容之上**(素材/截图/图表) | `intensity` `coarse` `frozen` `blend` `seed` | 与 BackgroundSystem 的 grain variant 不同,这个不铺底、能当 foreground。**暗底必须 `blend='soft-light'`**(默认已是):overlay 在明度<0.5 的底上算出来还是黑,等于没加。intensity 别超 0.2,视频压缩最吃高频噪声 |
| `Vignette` | 径向压暗四边,把注意力收回中心 | `strength` `color` `size` `shape` `fadeIn` | 放**别人的素材**(截图/录屏/图库图)时最有用——那些图边缘又亮又杂,文字压上去读不清。`color` 只吃 hex(内部走 `alpha()`),传 'black' 会 NaN 静默失效。和 FilmGrain 叠放时 Vignette 在下 |
| `ShimmerSweep` | 一道高光扫过文字,用在"这个数字是重点"的那一下 | `delay` `duration` `color` `width` `angle` `mode` | 默认 `mode='text'`——高光只走字形内部。`mode='box'` 是原版做法,会把整个矩形一起提亮,看起来是"亮方块扫过"而不是"文字在反光"。**一镜最多扫一次**,且在文字安定之后;扫多了变促销横幅 |

## 材质与版式型

| 组件 | 用途 | 关键参数 | 别做错的地方 |
|---|---|---|---|
| `MetalCoin` | 程序化金属圆盘(硬币/徽章/奖章) | `size` `tone` `face` `sweepStart` | 金属感靠四件套:齿边+偏心径向高光+inset 双环+**一次性**反光扫过。币面只放表意符号(¥/★),别写具体信息(会和旁边文字冗余) |
| `StickerChip` | 叠在别人画面上的小信息块(口播/录屏之上) | `enterFrame` `exitFrame` | 半透明深色底是为了**在未知底片上可读**,这是它存在的全部理由。小信息点别占独立全屏,做成 chip 叠上去 |
| `KenBurns` | 静图运镜:焦点 A 缓慢推移到焦点 B | `imgW/imgH` `windowW/H` `focusStart/End` `moveEnd` | 焦点坐标**必须**用 `docs/locate-protocol.md` 网格法拿,不许目测;两个轴都做边缘钳制(已内置)。**钳制优先于对准**——焦点靠近图边时会贴边而不是落窗心,想真正对准就把 scale 调大或焦点往图内挪;末段留静止定格 |
| `TextReveal` | 文字在裁剪容器内上滑入场 | `dur` 18f(>24 拖、<12 注意不到)· `delay` 多行 stagger 6–10f · `style` **必须给高度**,裁剪才生效 | 裁剪让运动发生在文字自己的空间里,避免全屏飞入的廉价感。opacity 走 `p*1.6` 提前到顶——文字还没滑完就已不透明,**这是故意的**,改成线性会显得「飘上来」 |
| `NumberTicker` | 数字滚动(数值插值,不是滚轮) | `dur` 36f · `from` 默认 0(从 0 起跳最有累加感)· `delay` 晚于标签 · `format` 千分位/百分比/单位一起格式化 | 已内置 `tabular-nums`,别再自己设 `fontVariantNumeric`(数字宽度会跳)。曲线前快后慢,最后 1/3 几乎停稳给观众读。**滚动中的中间值是假数字**,别在滚动期叠结论文案 |
| `LineChartReveal` | 折线图绘制 | `dur` 45f · `strokeWidth` 6(1080 宽的下限,更细压缩后断续)· `label` 端点直接标签(留 240px)· `grid` 点少于 4 个时关掉 · `data` 4–7 个点 | 线宽/端点/网格线均已按 §4 图表硬规则内置,别在外层再调。端点圆点在绘制结束**前 8 帧**才出现,结论文案别排在它之前。演示数字须在合同写 `facts.mode` 为 illustrative 并在画面标注 |

## 怎么往里加

新手法做完一个镜头、**用户满意之后**,把可参数化的部分抽成组件回流到这里(`docs/agent-runbook.md` 核心决定 #5)。判断标准:

- 换一个内容还能用吗?能 → 抽组件。只对这一条内容成立 → 留在项目里。
- 抽的时候把**踩过的坑写进注释**(为什么这个数、为什么不能那样做)。`memory/taste.md` 里的教训应该迁移到组件注释里,那才是下次真会被读到的地方。
- 加完更新本表 + 在 `ComponentGallery` 里摆一个样品,渲帧确认。
