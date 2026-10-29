---
name: motion-srt
description: 字幕稿直出整片:读 SRT/口播稿按语义拆镜头、对整片选一次 Styleframe、逐镜实现渲染、ffmpeg 拼接成覆盖完整时间轴的 final.mp4。用户给字幕文件/带时间轴的口播稿并要求"做成一整支片子"时使用;单个短插片走 motion-broll,创意向单片走 motion。
---

# motion-srt — 字幕稿 → 整片

用户 2026-10-12 已取消首尾帧最低墨量、最低材质种类、默认弹簧次数、固定语义节拍上限及计时/重试自动降质。密度与运动参数只描述本期设计，不作为默认必达额度；实际表达以批准方案和真实播放验收为准。60 分钟只作预算提示，不冻结范围、不自动判质量失败。


输入一份带时间轴的 `transcription.srt`(或等价的时间轴口播稿),输出一支**时间轴完整覆盖**的 `final.mp4`。

开工前读 `docs/visual-first.md` 和 `docs/styleframe-protocol.md`。

和另外两个模式的分工:

| 模式 | 输入 | 输出 | 停点 |
|---|---|---|---|
| `$motion` | 自然语言需求 | 一支创意片 | Styleframe 选择(1 次) |
| `$motion-broll` | 逐镜需求单 | 一批独立插片 mp4 | 带合同则 0 次;无合同时 1 次(非交互批次自动选) |
| `$motion-srt` | 带时间轴的字幕稿 | 一支拼接好的整片 | Styleframe 选择(1 次,对整片) |

**本模式有 Styleframe 停点,但只有一次,而且是对整片做的**:镜头由字幕的语义结构决定,创意自由度在视觉语言上,
所以选的是"整片长什么样",不是逐镜询问。选定后每个镜头继承同一份 `visual-contract.json`。**质量门禁一项不降。**

## 生产序列(13 步,顺序固定,一步都不许跳)

和 `$motion` 同一条序列,差别只在"镜头从字幕里来"和"最后必须拼成覆盖完整时间轴的整片"。
`<P>` = 项目目录 `projects/<yyyy-mm-dd>-srt-<短名>/`;下面阶段 1–6 是每一步的展开。

| # | 动作 | 命令 / 角色合同 | 完成标准(看文件,不看汇报) |
|---:|---|---|---|
| 1 | 起时钟 | `node tools/production-clock.mjs start --project <P>` | 读字幕就算开工 |
| 2 | 三个 Styleframe **并行**派发(用代表镜) | `docs/subagents/styleframe-worker.md` × 3 | 各写各的 `styleframes/sf-N.*`,互不可见 |
| 3 | 出图前暂停计时 | `node tools/production-clock.mjs pause-selection --project <P>` | **先 pause 再贴图** |
| 4 | 用户选完恢复计时 | `node tools/production-clock.mjs resume-selection --project <P>` | 选择与时间落进 `proposals.md` |
| 5 | 冻结并校验合同 | `node tools/validate-contract.mjs <P>/visual-contract.json` | `shots[]` 覆盖**全部**镜头;不过不许派 worker |
| 6 | 生成逐镜派发清单 | `node tools/build-dispatch-manifest.mjs <P>` | 每镜有 `dispatch.md` + `source/` + `keyframes/` |
| 7 | worker 按波次并行 | `docs/subagents/shot-worker-remotion.md` / `docs/subagents/shot-worker-hyperframes.md` / `docs/subagents/asset-scout.md` | 每镜有首/中/尾帧和 `draft.mp4` |
| 8 | 正式渲染进受限队列 | `node tools/render-queue.mjs <P>/render-queue.json --concurrency 2` | 每项 exit 0 且 `expectedOutput` 非空 |
| 9 | 视觉 + 连续性评审 | `docs/subagents/visual-reviewer.md`、`docs/subagents/continuity-reviewer.md` | 逐镜 `review.json` + 整片 `continuity.json` |
| 10 | **一轮**集中修复 | 只允许一轮 | 仍不过就记降级往下走 |
| 11 | 规范化 → 拼接 | `tools/normalize-shot.sh` 逐镜 → `tools/concat-shots.sh` | 拼出的 `final.mp4` 覆盖完整字幕跨度 |
| 12 | 结构化评审 + 产物校验 | `node tools/validate-review.mjs <P>/review.json` + `tools/validate-output.sh` + `tools/check-density.sh --contract` | 全部 exit 0 |
| 13 | 停表 | `node tools/production-clock.mjs finish --project <P>` | 记录活跃时长与预算变化，不自动判失败 |

阶段边界打点:`node tools/production-clock.mjs checkpoint --project <P> --note "<刚做完什么>"`。
**镜头多不是跳步的理由**——20 个镜头也走这 13 步,多出来的只是波次数量。

### 派发降级链(按顺序试,不许直接跳到最后一档)

1. **原生 subagent** —— harness 支持就用它,一镜一个 worker,各自只写自己那个 `shots/shot-NNN/`。
2. **共享文件系统的 headless worker** —— 没有原生 subagent 时起 headless 进程,输入输出全走项目目录里的文件,
   导演只认文件不认口头汇报。
3. **内联串行** —— 前两档都不可用时主 agent 自己一份份做完,dispatch 照写、隔离照守。

**降级只改变"谁来做、分几波",不改变"做多少"。本模式尤其危险:镜头数由字幕跨度决定,少做一镜整片就有一段空白,
时间轴当场对不上原声。** 所以**永远不许因为 harness 槽位少就砍镜头**;镜头做不下去只能按阶段 3 第 5 条降级成同时长的静默/纯文字镜,
时长一秒都不能少。降级发生在哪一档、为什么,写 `build-log.json` 一个事件 + `review.md` 一行。

## 阶段 1:拆镜(全部硬性)

读字幕,按语义拆成粗粒度镜头。一个镜头可以是一条字幕,也可以合并连续多条——**合并依据是这几条在讲同一个主题、同一个因果关系、或同一个视觉概念**,不是按条数凑。

四条不变量,写进 `storyboard.md` 前必须自己复核一遍:

1. **连续**:每个镜头对应一个连续时间区间,镜头之间首尾相接,不留缝、不重叠。
2. **全覆盖**:所有镜头合起来覆盖从第一条字幕开始到最后一条字幕结束的完整跨度。
3. **空白不丢**:字幕之间没有文字的空白必须并入前一个镜头,作为停顿/收尾/转场;空白很长(>2s)时也可以单独立一个静默镜或转场镜。
4. **毫秒精度**:镜头时长以秒为单位写成**小数**(`2.833`、`6.500`),保留 SRT 的毫秒精度,**不许四舍五入或截断成整数秒**。所有镜头时长之和与"最后一条字幕结束 − 第一条字幕开始"的误差必须 ≤ 0.1 秒。

> 第 4 条是整个模式最容易翻车的地方:每镜取整,20 个镜头能累出几秒的漂移,拼完就和原声对不上了。Remotion 的 `durationInFrames` 用 `Math.round(秒 × fps)`,并在 `storyboard.md` 里把秒和帧都记下来。

序列第 1 步先起表:`node tools/production-clock.mjs start --project <P>`。
建项目目录 `node tools/init-visual-project.mjs projects/<yyyy-mm-dd>-srt-<短名> srt-<短名>`(目录非空时它会拒绝,不覆盖),写:

- `brief.md`:字幕文件路径、总时长、整片表达目标、观众、画布、profile 选择、**假设列表**。
- `storyboard.json` + `storyboard.md`:逐镜一行 —— `镜号 | 起止时间 | 时长(秒/帧) | 画面 | 动画行为 | 文字 | 素材`。"动画行为"列用 `docs/motion-vocabulary.md` 的基元名写。
- 表末一行写总时长校验:`Σ镜头时长 = X.XXX s / 字幕跨度 = X.XXX s / 差 = 0.0XX s`。

## 阶段 2:整片 Styleframe(唯一停点)

1. 从分镜里挑一个**代表镜**(通常是信息最重、或第一个建立视觉语言的那镜),它的画面决定整片调性。
2. 写三份候选合同 `styleframes/sf-{1,2,3}.contract.json`,三向在构图、字体、材质、运动设想上拉开,
   至少用到两个不同的中文 typography kit;各自先跑 `node tools/validate-contract.mjs`。
3. **序列第 2 步:同时派三个 styleframe-worker**(角色合同 `docs/subagents/styleframe-worker.md`),用**代表镜的真实文案与真实素材**
   渲出 `styleframes/sf-1.png`、`sf-2.png`、`sf-3.png`。**三个在同一条消息里一次派完**,各自可写域只有自己那组 `styleframes/sf-N.*`,
   **互不可见**——不给它看另外两个方向,免得三张收敛成一套。
4. **序列第 3 步:先 `node tools/production-clock.mjs pause-selection --project <P>`,再呈现**三张图 + 每张一行设计摘要 + 推荐理由,
   **停,等用户选一张或指名混搭**。用户等待不计入活跃 60 分钟,所以 pause 必须发生在贴图之前。
5. **序列第 4–5 步**:选完立刻 `node tools/production-clock.mjs resume-selection --project <P>`,
   再把候选提升为 `projects/<name>/visual-contract.json`,把**全部**镜头写进 `shots[]`
   (`id / durationSeconds / engine / objective / startAnchor / endAnchor`;`engine` 一律取阶段 3 第 1 步
   `tools/route-shot.mjs` 的路由结果,不许拍脑袋填、也不许整片一刀切),跑
   `node tools/validate-contract.mjs projects/<name>/visual-contract.json`,不过不许往下走。
   在 `proposals.md` 记录三图路径、设计摘要、用户选择与时间。
6. **之后每镜继承这份合同,不再逐镜询问,也不再新增任何确认点。**

已有合同的续做项目(`visual-contract.json` 存在且校验通过)直接跳过本阶段。

## 阶段 3:逐镜实现

1. **逐镜路由引擎**(判据全文 `docs/engine-routing.md`)。每镜四件事:

   1. 写 `shots/shot-<NNN>/signals.json`:十一个信号各取 0/1/2。
   2. `node tools/route-shot.mjs projects/<name>/shots/shot-<NNN>/signals.json > projects/<name>/shots/shot-<NNN>/route.json`
   3. 把 `route.json` 的 `engine` 同步进合同的 `shots[].engine`,两处不一致不许派 worker。
   4. **Hybrid 用量自检**(本模式最容易翻车的地方,见下)。

   > **本模式每一镜都有字幕,所以 `captions` 的档位决定整片成本。**
   > `captions: 2` 的含义是「毫秒级字幕同步是本镜不可妥协的硬需求」——逐词高亮、对口型、SRT 逐条驱动;
   > **不是**「本镜有字幕」。**默认填 1**,只有真的错 0.1 秒就是事故的那几镜才填 2。
   > 路由器有一条短路硬规则:精确侧(`framePrecision`/`captions`/`audioSync`)出现一个 2、
   > 视觉侧(`webUi`/`shader3d`)出现一个 2,这一镜**直接判 `hybrid`,不看分数**。
   > 如果整片选了 Digital Spectacle 方向(含 Shader/3D)而每镜 `captions` 都填了 2,
   > **整片会全部路由成 Hybrid,双引擎渲染成本翻倍,而观众看不出任何差别。**
   > 整片路由跑完必看 hybrid 占比:**超过一半就是信号填松了,回去重填重跑,不是接受结果、更不是手改 `route.json`。**

   人工改路由必须在 `route.json` 里写 `override`(`from` / `to` / `reason` / `at` / `by`),
   理由要说清"路由器的判断为什么在这一镜不成立",并记进 `review.md` 和 `build-log.json`。
1.5. **序列第 6 步:每镜先有 `shots/shot-<NNN>/dispatch.md`,没写不许派 shot worker。**

   ```bash
   node tools/build-dispatch-manifest.mjs projects/<name>   # 校验合同 → 每镜建 source/ keyframes/ + 写 dispatch.md
   ```

   **每份 dispatch 只声明自己那一个可写目录**,不出现任何别的镜头——隔离是并行 worker 不互相踩踏的唯一保证。
   本模式镜头多,这条尤其要守:两个 worker 同时改一个 `build/src/` 就会互相覆盖,而症状要到拼片才暴露。

   按标签路由知识(协议见 `docs/knowledge-routing.md`):
   ```bash
   node tools/route-knowledge.mjs <route.json 的 engine> <2–4 个标签>
   ```
   标签词汇:`data chart ui screenshot shader 3d kinetic type transition overlay texture brand logo code device map layout background caption audio render media`。
   输出**原样**写进 `dispatch.md` 的「Knowledge」段(恒为 `docs/visual-first.md` + 最多 4 条动态资源),每条补一行"这一镜为什么需要它"。
   **不许把外部 skill 的完整源码粘进 dispatch**——只给资源标识符,worker 自己去读。
   dispatch 还要带:合同路径、本镜字幕原文与精确时长(小数秒)、engine 与理由、首尾锚点。
   整片各镜继承同一份合同,所以 dispatch 之间只有标签和字幕文本不同——**不要每镜重述一遍全套规则**。

2. **按 `route.json` 建对应引擎的工程**:
   - `remotion` 镜:`cp -Rc templates/remotion-base/ projects/<name>/build`(APFS 克隆,连 node_modules 和 webpack 缓存,秒级;**不要 npm install**,除非模板 package.json 变过);
   - `hyperframes` 镜:从 `templates/hyperframes-base` 起,`registryFit` 高的先 `hyperframes catalog` / `hyperframes add`;
   - `hybrid` 镜:HyperFrames 出视觉层 → `tools/normalize-shot.sh` 规范化 → Remotion 做最终字幕、文字与时间。
3. **每镜一个 composition**,命名 `Shot1`、`Shot2`…,`durationInFrames` 严格按分镜表。优先复用现成组件,颜色字号缓动一律取合同 token。
4. **序列第 7 步:按波次并行,不是一次一镜。** 源码、关键帧、素材、审查全部并行——它们不吃浏览器渲染队列;
   **只有正式的浏览器渲染进受限队列:并发上限 2**(内存不足降为 1),超出的排下一波。
   **并发上限只改变执行波次,不许因此减少镜头**,也不许因此把源码和关键帧改成串行做。
   一镜一个 shot worker,各写各的 `shots/shot-NNN/`;按 `route.json` 的 engine 挑角色合同:
   `remotion` 镜 → `docs/subagents/shot-worker-remotion.md`,`hyperframes` 镜 → `docs/subagents/shot-worker-hyperframes.md`,
   `hybrid` 镜两份都给;素材另派 `docs/subagents/asset-scout.md` 与它们同时跑,它只碰 `assets/`。
   **同一波的 worker 在同一条消息里一次派完;完成标准是文件存在并通过校验,不是 worker 说完成了。**
5. 单镜实现不下去(素材缺失、需求本身矛盾)**不要卡住整片**:该镜降级成同时长的静默/纯文字/转场镜,记进 `review.md` 的失败清单,继续往下走。整片跑完后一次性向用户报告哪几镜降级了、为什么。

镜与镜之间要有**空间/逻辑关联**:上一镜的 `endAnchor` 就是下一镜的 `startAnchor`,写进 `continuity.json`。整片不是 20 个不相干的小动画拼起来。

## 阶段 4:自查(硬性,不可省)

每镜渲首/中/尾帧到 `build/review/`(`--scale=0.4`),先数字后眼睛逐张核,对照 `docs/quality-checklist.md` 硬性项**和选中的 `sf-N.png`**,问题直接修,过即停。

**自查循环是自适应的:过即停,最多三轮。**(「至少三轮加法」已废除——2026-08-03 盲评证明
固定轮数催生冗余堆料,见 `docs/quality-checklist.md` 的删除说明。防空屏交给下限检查,不靠多跑轮数。)

1. **首轮渲帧后立即跑下限检查**,**这三条不过不许往下走**:
   ```bash
   node tools/frame-audit.mjs <该镜关键帧...> --contract projects/<name>/visual-contract.json
   tools/check-density.sh <该镜 mp4>
   node tools/lint-shot.mjs build/src/shots
   ```
   自查帧一律 `--scale=0.4` 渲,**先读 frame-audit 的数字,再用 Read 看图**;
   能被数字判定的不用眼睛判,只有数字或眼睛已经起疑的那一帧才补读全分辨率。
2. **数字与眼睛都过 → 立即停,不许为凑轮数继续加东西。**
   不过 → 缺什么补什么,按实际问题继续必要修复,仍不过按 Failure Report 上报。典型该补的:
   节点只有一个空框(补图标/副标/状态点)、线上没有东西在动、
   图表只有一条光秃秃的线(补坐标系/面积/端点描边环/选择性标注)，是否使用弹簧按表达需要判断。
   只重渲被改动波及的那几帧,数字没变的帧不重新看。
3. 按实际播放检查是否需要减法，不设前置墨量下限。

> 次序反了就是纯亏。"穿戴完再摘一件",不是"少穿一件出门"。
> 2026-07-31 那次在画面本来就素的情况下先做减法,是做出空画面的直接原因之一。

跨镜还要额外看三件事(单镜自查看不出来的):

- **重复感**:相邻几镜是不是同一个手法反复用。整片最容易出的问题就是"每镜都是一句话滑上来"。
- **节奏曲线**:信息密度有没有起伏,还是从头到尾一个速度。
- **视觉连续性**:配色、字号阶梯、构图重心在整片范围内一致(合同已经保证了 token 一致,这里看的是构图)。

**序列第 9–10 步:把自查结论落成结构化评审,再做必要修复。** 派两个只看画面、不评审代码的角色:

- `docs/subagents/visual-reviewer.md`:拿选中的 `sf-N.png` + 每镜首/中/尾帧 + 客观脚本输出,逐镜写 `shots/<id>/review.json`
  (七维各 0–10 + `heroFrame` + `technical` 五项 + 0–3 条**真实**不符(合格镜可为 0,不许凑数)+ 最多五条按分数影响排序的修复,FAIL 时至少一条),格式见 `docs/visual-scorecard.md`。
- `docs/subagents/continuity-reviewer.md`:拿有序的「尾帧 → 下一镜首帧」配对写 `continuity.json`,**只能要求修改失败边界两侧的那两镜**。
  本模式镜头多,跨镜漂移正是最常见的失分点,这一步不许省。

```bash
node tools/validate-review.mjs projects/<name>/review.json   # 总分<80 / 任一维<6 / 英雄帧<8 / technical 有 false → exit 1
```

按 `docs/visual-first.md` 的评分表打分:总分 ≥80、任一维度 ≥6/10、英雄帧 ≥8/10,**只允许一轮集中修复**——
按 `repairs` 的分数影响从高到低修 → 重渲那几镜 → 重跑评审;第二轮仍不过就记降级到 `review.md` + `build-log.json` 并往下走。

## 阶段 5:渲染 + 拼接

**序列第 8 步:正式渲染按波次走受限队列。** 写 `projects/<name>/render-queue.json`(每项 `{id, cwd, command, expectedOutput}`,
`command` **必须是数组**——字符串命令要过 shell,带空格的项目路径进来就是注入点),然后:

```bash
node tools/render-queue.mjs projects/<name>/render-queue.json --concurrency 2   # 内存紧张改 --concurrency 1
```

某项算过关要同时满足"进程 exit 0"和"`expectedOutput` 存在且非空";写出 0 字节还报成功的 worker 算失败。
每波渲完立刻规范化 + 校验,不要攒到最后:

```bash
# 队列里每一项的命令形如(remotion 镜):
#   ["npx","remotion","render","Shot<N>","../shots/shot-<NNN>/raw.mp4"]
# hyperframes 镜走 hyperframes render,产物同样落到 shots/shot-<NNN>/raw.mp4

tools/normalize-shot.sh projects/<name>/shots/shot-<NNN>/raw.mp4 \
  projects/<name>/shots/shot-<NNN>/shot-<NNN>.mp4 <W> <H> 30 none
tools/validate-output.sh projects/<name>/shots/shot-<NNN>/shot-<NNN>.mp4 \
  --size <W>x<H> --fps 30 --duration <该镜秒数> --dur-tol 0.1
```

**每一镜都过 `normalize-shot.sh`,不分引擎**——Remotion 镜也要过。只给 HyperFrames/Hybrid 镜规范化,
等于默认 Remotion 的输出天然对齐,而 timebase 和 SAR 恰恰是拼接时最容易对不上的两项。
脚本自带 ffprobe 自检,不过不许进拼接队列。

全部通过后拼接(`concat-shots.sh` 优先 stream copy,规格万一仍对不上会自动回退重编码):

```bash
tools/concat-shots.sh projects/<name>/out/final.mp4 projects/<name>/shots/shot-*/shot-*.mp4
```

只有一个镜头时,也要过规范化再转存为 `final.mp4`,不要让交付物名字和规格不一致。

**序列第 12 步:拼完必须校验整片**(不要肉眼核对):

```bash
tools/validate-output.sh projects/<name>/out/final.mp4 --size <W>x<H> --fps 30 --duration <字幕跨度> --dur-tol 0.3
tools/check-density.sh projects/<name>/out/final.mp4 --contract projects/<name>/visual-contract.json
```

**序列第 13 步:停表**——`node tools/production-clock.mjs finish --project <P>`。
超过60分钟记录预算变化与瓶颈；按批准方案继续必要制作和修复。

## 阶段 6:交付与沉淀

交付内容:`final.mp4` 路径 + 分镜表摘要 + 3–5 张跨镜关键帧图 + 降级镜清单 + 假设列表。

之后按 `$motion` 阶段 C 走自然语言修改循环(改单镜 → 重渲该镜 → 重新拼接 → 重新校验整片),**不新增确认点**;
只有"整体视觉方向不对"才回阶段 2 重跑一轮三图。用户满意后按 `$motion` 阶段 D 写 `DELIVERY.md`、沉淀 `memory/taste.md` 和组件。

## 约束

- 字幕文字**不需要逐字上屏**。用图形、图标、概念性文字或少量标签表达含义;整片满屏搬字幕是最差的做法。
- 语义节拍按口播与理解负荷设计，不设固定数量上限；一个主焦点 + 最多两个次级锚点。
- 遇到不认识的专有名词,先查清楚它是什么、有没有明确的品牌视觉资产(logo/配色),再决定怎么表达。素材政策同 `$motion`:品牌 logo、截图、来源不明的网络图都允许,选中即下载进 `assets/` 引本地路径。
- 默认无音轨(口播音轨由外部管线合成),渲染校验时用 `--audio none`;需求明确要求带音时才留音轨。

## 统一产物位置

执行前读取 `docs/artifact-layout.md`。统一入口 `../output/<SC-XXXX>/` 只放可直接使用的资源，分类目录内平铺中文内容名文件；无内容不建目录。合同、报告、日志、工程与旧版本留在仓库 workspace 或隐藏 `.制作资料`。内部验收后同步可用资源到用户目录，不再放 README 和制作流程目录。
