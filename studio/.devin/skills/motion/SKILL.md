---
name: motion
description: 动画任务全流程:理解需求→并行渲三张真实 Styleframe→用户选一次→自动完成分镜、代码、自查并渲出成片草稿→按自然语言反馈修改→导出。用户描述任何动画/视频需求,或对进行中的动画提修改意见时使用。
---

# $motion — 动画全流程(visual-first)

用户 2026-10-12 已取消首尾帧最低墨量、最低材质种类、默认弹簧次数、固定语义节拍上限及计时/重试自动降质。密度与运动参数只描述本期设计，不作为默认必达额度；实际表达以批准方案和真实播放验收为准。60 分钟只作预算提示，不冻结范围、不自动判质量失败。


**全程唯一的用户停点是 Styleframe 选择:看三张真实渲染的画面,选一张或指名混搭。**
其余阶段自动连续执行,不向用户要确认;阶段产物照常落盘留档,但只是过程记录,不是关卡。

开工前读 `docs/visual-first.md`(短合同,规定优先级、画布、评分与禁止回归项)和
`docs/styleframe-protocol.md`(三张图怎么产生、怎么呈现、选完怎么冻结)。

## 生产序列(13 步,顺序固定,一步都不许跳)

下面这张表是**可执行的那一份**调度;时间预算与熔断见 `docs/visual-first.md` 的 60-Minute Gates。
`<P>` = 项目目录 `projects/<yyyy-mm-dd>-<短名>/`。下面阶段 A–D 是每一步的展开,不是另一条路径。

| # | 动作 | 命令 / 角色合同 | 完成标准(看文件,不看汇报) |
|---:|---|---|---|
| 1 | 起时钟 | `node tools/production-clock.mjs start --project <P>` | `<P>/build-log.json` 里有 `start` 事件 |
| 2 | 三个 Styleframe **并行**派发 | `docs/subagents/styleframe-worker.md` × 3 | 三份 dispatch 各自只声明一个可写目标 `styleframes/sf-N.*`,**互不可见** |
| 3 | 出图前暂停计时 | `node tools/production-clock.mjs pause-selection --project <P>` | **先 pause 再把图贴给用户**;顺序反了就把用户的思考时间算进了生产失败 |
| 4 | 用户选完恢复计时 | `node tools/production-clock.mjs resume-selection --project <P>` | 选择内容与时间落进 `proposals.md` |
| 5 | 冻结并校验合同 | `node tools/validate-contract.mjs <P>/visual-contract.json` | exit 0;不过**不许派发任何 shot worker** |
| 6 | 生成逐镜派发清单 | `node tools/build-dispatch-manifest.mjs <P>` | 每镜有 `shots/<id>/dispatch.md` + `source/` + `keyframes/` |
| 7 | worker 按波次并行 | `docs/subagents/shot-worker-remotion.md` / `docs/subagents/shot-worker-hyperframes.md` / `docs/subagents/asset-scout.md` | 每镜有首/中/尾关键帧和 `draft.mp4` |
| 8 | 正式渲染进受限队列 | `node tools/render-queue.mjs <P>/render-queue.json --concurrency 2` | 每项进程 exit 0 **且** `expectedOutput` 存在且非空 |
| 9 | 视觉 + 连续性评审 | `docs/subagents/visual-reviewer.md`、`docs/subagents/continuity-reviewer.md` | 每镜一份 `review.json`,整片一份 `continuity.json` |
| 10 | **一轮**集中修复 | 只允许一轮,第二轮不许开 | 修完重渲重评;仍不过就记降级并往下走,不是无限循环 |
| 11 | 规范化 → 拼接 | `tools/normalize-shot.sh` 逐镜 → `tools/concat-shots.sh` | 每镜规格一致;单镜项目也照走这两步 |
| 12 | 结构化评审 + 产物校验 | `node tools/validate-review.mjs <P>/review.json` + `tools/validate-output.sh` + `tools/check-density.sh --contract` | 全部 exit 0;`validate-review.mjs` 不过不许交付 |
| 13 | 停表 | `node tools/production-clock.mjs finish --project <P>` | 活跃时长打印出来；预算仅作提示 |

阶段边界上打点:`node tools/production-clock.mjs checkpoint --project <P> --note "<刚做完什么>"`。
`build-log.json` 是 append-only 的,任何一次覆写都会把前面的时间账抹掉。

**第 8 步的队列文件**长这样(`command` **必须是数组**——字符串命令要经过 shell,而项目路径里天然带日期和短横,空格/引号一进来就是注入点):

```json
[{"id": "shot-001", "cwd": "projects/<name>/build",
  "command": ["npx", "remotion", "render", "Shot1", "../shots/shot-001/raw.mp4"],
  "expectedOutput": "projects/<name>/shots/shot-001/raw.mp4"}]
```

### 派发降级链(按顺序试,不许直接跳到最后一档)

1. **原生 subagent** —— harness 支持就用它。一个角色一个 agent,各自只写自己那一个目录。
2. **共享文件系统的 headless worker** —— 没有原生 subagent 时起 headless 进程,输入输出全走项目目录里的文件
   (`dispatch.md` 进,`keyframes/` + `draft.mp4` + `review.json` 出),导演只认文件不认口头汇报。
3. **内联串行** —— 前两档都不可用时,主 agent 自己按 dispatch 一份份做完,dispatch 照写、隔离照守。

**降级只改变"谁来做、分几波",不改变"做多少"。** 落到哪一档都一样:镜头数、三张 Styleframe、评审与那一轮修复,一项不减。
**永远不许因为 harness 槽位少就砍镜头**——槽位是执行资源,镜头是内容承诺,拿后者填前者的坑就是交付缩水。
并发上限只作用于吃内存的浏览器正式渲染队列(2,内存不足降 1);方案、素材、代码、审查照常铺开。
降级发生在哪一档、为什么,写 `build-log.json` 一个事件 + `review.md` 一行。

## 阶段 A:需求 → 三张 Styleframe(唯一的停点)

0. **序列第 1 步:起时钟**——`node tools/production-clock.mjs start --project <P>`。读需求就算开工,别等写完 brief 才起表。
1. 读 `memory/taste.md`;按内容选一个 profile:`docs/styles/visual-max.md`(默认)/ `editorial-luxe.md` / `brand-energy.md` / `data-cinematic.md`。
2. 建项目目录 `node tools/init-visual-project.mjs projects/<yyyy-mm-dd>-<短名> <短名>`(目录非空时它会拒绝,不会覆盖),写 `brief.md`:表达目标 / 观众要记住的一句话 / 场景与平台 / 画布与时长 / 素材策略 / **系统假设**(信息不足时假设并逐条列出,供用户否决)。
3. 写粗分镜(`storyboard.json` + `storyboard.md` 的骨架):镜号、时长秒、这一镜的**唯一语义节拍**、视觉目标。此时不写实现细节。
4. 生成**三份候选合同** `styleframes/sf-{1,2,3}.contract.json`,三向必须在构图、字体、材质、运动设想上同时拉开(默认 Brand Impact / Editorial Cinematic / Digital Spectacle),
   至少用到两个不同的中文 typography kit。每份先跑
   `node tools/validate-contract.mjs projects/<name>/styleframes/sf-N.contract.json`,不过不派发。
5. **序列第 2 步:同时派三个 styleframe-worker**(角色合同 `docs/subagents/styleframe-worker.md`),各渲一张真实帧到
   `styleframes/sf-1.png`、`sf-2.png`、`sf-3.png`:真实文案、真实中文字体、目标比例、真实素材;**不是 moodboard、线框或文字描述**。
   **三个 worker 在同一条消息里一次派完,不是渲完一张再派下一张**;每个 worker 的可写域只有自己那组 `styleframes/sf-N.*`,
   **互不可见**——不给它看另外两个方向,免得三张图互相收敛成同一套。
   导演用 Read 逐张看过才算完成——文件存在 + 校验通过 + 亲眼看过,三样缺一不算。
6. **序列第 3 步:先 `node tools/production-clock.mjs pause-selection --project <P>`,再呈现**三张图 + 每张一行设计摘要
   (kit / 主色 / 密度 / 材质 / 运动性格)+ 一句推荐理由,**停,等用户选择或混搭。此阶段禁止写镜头代码。**
   不呈现逐镜文字计划——那些落进 `proposals.md` 留档即可。用户等待不计入活跃 60 分钟,所以 pause 必须发生在贴图之前。
7. 第 15 分钟仍没有三张合格图 → 熔断:用匹配度最高的已验证 preset / Registry block 补齐,记进 `review.md`。

## 阶段 B:选定后自动跑到成片草稿(中间不停)

0. **序列第 4 步:恢复计时**——`node tools/production-clock.mjs resume-selection --project <P>`,用户一选完就跑,别拖到写完合同。
1. **序列第 5 步:冻结合同**:把选中(或混合出的)候选提升为 `projects/<name>/visual-contract.json`,补齐每镜的
   `id / durationSeconds / engine / objective / startAnchor / endAnchor`,跑
   `node tools/validate-contract.mjs projects/<name>/visual-contract.json`——**不过不许派发 shot worker**。
   在 `proposals.md` 记录三张图路径、设计摘要、用户选了哪张、混了什么、选择时间。
2. 细化 `storyboard.md` 逐镜表(镜头|时间|画面|动画行为|文字|素材|音效),**不向用户确认**。
   总时长与合同一致,多镜时各镜时长之和等于总时长、逐镜相接不留缝。
   "动画行为"列用 `docs/motion-vocabulary.md` 的基元名写(如 `slide_up(18f) → hold(45f)`),不要写自由散文。
3. **逐镜路由引擎**——判据全文 `docs/engine-routing.md`,短合同 `docs/visual-first.md` 的 Engine Routing。**每镜四件事,一件不能省:**

   1. 写 `shots/shot-<NNN>/signals.json`:十一个信号各取 0/1/2(`framePrecision` `dataBinding` `continuity` `captions` `audioSync` / `webUi` `shader3d` `kineticType` `registryFit` / `remotionRisk` `hyperframesRisk`)。
      **`2` 的含义是"这条不满足,这镜就等于做失败了",不是"这镜有这个东西"**——带字幕的镜绝大多数填 `captions: 1`;`shader3d: 2` 指的是"换成 2D 实现等于换了个镜头"。
   2. 跑路由器,产物落盘:
      ```bash
      node tools/route-shot.mjs projects/<name>/shots/shot-<NNN>/signals.json \
        > projects/<name>/shots/shot-<NNN>/route.json
      ```
   3. 把 `route.json` 的 `engine` 同步进合同的 `shots[].engine`,**两处不一致不许派发 shot worker**。
   4. **Hybrid 用量自检**:精确侧(`framePrecision`/`captions`/`audioSync`)和视觉侧(`webUi`/`shader3d`)各出现一个 2 就会短路成 `hybrid`,不看分数。
      一批里 hybrid 超过一半,几乎肯定是信号填松了——**回去重填信号重跑,不是手改 `route.json`**。

   **不许因为"模板在这儿"就把所有镜都路由到 `remotion`。** Hybrid 是例外,不为"两个引擎都用到"而选。
   人工改路由必须在 `route.json` 里写 `override`(`from` / `to` / `reason` / `at` / `by`),理由要说清"路由器的判断为什么在这一镜不成立",并在 `review.md` 记一行、`build-log.json` 记一个事件。
4. 素材:先查 `assets/library/LIBRARY.md`,再去开源站下载。**真实品牌 logo、网页截图、来源不明的网络图都允许使用**,
   不因版权/商标/署名状态阻塞;`assets.md` 记录来源作为元数据。**选中的素材立刻下载进 `assets/`,渲染一律引本地路径。**
   搜索纪律不变:查询只用两极长度(原子式 1–3 词 / 具体式 5–15 词),具体式查不到就丢弃该需求不要放宽;
   每条需求过一遍"用 / 备选 / 弃",不许拿第一个结果。
   **付费 AI 生成(万相文生图等)保留费用确认**:生成前列出张数、每张内容、预估费用,确认后执行,生成的图保留不删。这是既有授权规则,不是新增停点。
5. **序列第 6–7 步:生成派发清单,再按波次并行派 shot worker**(一镜一个,各自只写 `shots/shot-NNN/`)。

   ```bash
   node tools/build-dispatch-manifest.mjs projects/<name>          # 每镜建 source/ keyframes/ + 写 dispatch.md
   ```

   它先校验合同,再为每镜写一份 `dispatch.md`,**每份只声明自己那一个可写目录**——隔离是并行 worker 不互相踩踏的唯一保证。
   然后按 `route.json` 的 engine 挑角色合同派发,**同一波的 worker 在同一条消息里一次派完**:

   - `remotion` 镜 → `docs/subagents/shot-worker-remotion.md`
   - `hyperframes` 镜 → `docs/subagents/shot-worker-hyperframes.md`
   - `hybrid` 镜 → 两份都给(HTML 层 + Remotion 集成层)
   - 素材另派 `docs/subagents/asset-scout.md`,**与 shot worker 同时跑**,它只碰 `assets/`

   **worker 的完成标准是文件存在并通过校验,不是它说完成了。** 波次划分见本文开头的降级链一节。

   派发前先按标签路由知识(协议见 `docs/knowledge-routing.md`):

   ```bash
   # <engine> 取 route.json 的 engine;<tags> 从标签表里挑 2–4 个描述这一镜要做什么
   node tools/route-knowledge.mjs <engine> <tags>
   ```

   标签词汇:`data chart ui screenshot shader 3d kinetic type transition overlay texture brand logo code device map layout background caption audio render media`。
   把输出**原样**写进 `dispatch.md` 的「Knowledge」段,每条后面加一行"这一镜为什么需要它"。
   输出恒为 `docs/visual-first.md` + 最多 4 条动态资源。**不许把外部 skill 的完整源码粘进 dispatch**——
   只给资源标识符,worker 自己去读;`skill:<name>` 用 Skill 工具按名字调用。
   dispatch 还要带:`visual-contract.json` 路径、本镜 `objective` / 时长 / 首尾锚点、`route.json` 的 engine 与理由。

   然后按引擎起工程:
   - `remotion` 镜:`cp -Rc templates/remotion-base/ projects/<name>/build`(APFS 克隆,连 node_modules 和 webpack 缓存,秒级;**不要 npm install**,除非模板 package.json 变过);
   - `hyperframes` 镜:从 `templates/hyperframes-base` 起;`registryFit` 高的先 `hyperframes catalog` / `hyperframes add` 装 block,不从零手写工程配置;
   - `hybrid` 镜:HyperFrames 出背景 / UI / 3D / Shader 层 → 规范化成 MP4(必要时带 alpha 的图像序列)→ Remotion 做最终文字、字幕、数据、时间与拼接。

   动手前查 `dispatch.md` 的「Component shortlist」段(按本镜标签算出的重合度前 10,约 1200 tokens)/ `hyperframes catalog`(HyperFrames Registry)——默认复用现成组件 + 调参,不手搓等价物;**只有清单不够用时**才去读全表 `docs/catalog/components.json`(约 6600 tokens)。
   颜色字号缓动一律取合同声明的 token;每镜最多引入 3 个主要视觉模块。
6. 自查(内部循环,不打扰用户):每镜渲首/中/尾帧(**`--scale=0.4`,自查帧不是交付物**),
   **先跑 `node tools/frame-audit.mjs <帧...> --contract <合同>` 看数字,再用 Read 逐张看图**,
   对照 `docs/quality-checklist.md` 硬性项与
   **选中的 `sf-N.png`**——密度、层数、材质、字体、色彩关系对不上就改画面,不许引用旧规则辩护。
   能被 frame-audit 算出来的(墨量/明度层数/构图偏压/安全区边缘/离板颜色/强调色面积)仅作诊断描述,
   真实观看检查表达、焦点和合成效果;只有数字或眼睛已经起疑的那一帧才补读全分辨率。
   **自适应循环:过即停,不再有固定加法轮数。** 首轮渲帧后立即跑全部技术检查与诊断
   (`frame-audit.mjs` + `tools/check-density.sh <mp4>` + `node tools/lint-shot.mjs build/src/shots`)再过眼睛;
   **数字与眼睛都过 → 立即停,不许为凑轮数继续加东西**;不过 → 缺什么补什么,按实际问题继续必要修复,
   仍不过按角色合同的 Failure Report 上报,不许静默耗着。
   按真实画面检查是否需要减法，不以前置墨量下限决定。
   (「至少三轮加法」已废除:2026-08-03 盲评证明固定轮数催生冗余堆料——数值印两遍、差值印三遍,排名反而落后。
   防空屏交给 check-density 的下限,防过载靠「过即停」,见 `docs/quality-checklist.md` 的删除说明。)
   **关键帧和源码是并行做的**——它们不吃浏览器渲染队列。
7. **序列第 8 步:正式渲染进受限队列**——写 `projects/<name>/render-queue.json`,然后:
   ```bash
   node tools/render-queue.mjs projects/<name>/render-queue.json --concurrency 2   # 内存紧张改 --concurrency 1
   ```
   队列项 `{id, cwd, command, expectedOutput}`,`command` **必须是数组**;某项算过关要同时满足"进程 exit 0"和
   "`expectedOutput` 存在且非空"——写出 0 字节文件还报成功的 worker 算失败。
   **并发上限只改变执行波次,不许因此减少镜头**;方案、素材、代码、审查照常并行,不许因为渲染队列而串行思考。
8. **序列第 9–10 步:结构化评审 + 必要修复。** 派两个评审角色,它们只看画面、不评审代码:
   - `docs/subagents/visual-reviewer.md`:拿选中的 `sf-N.png` + 每镜首/中/尾帧 + 客观脚本输出,逐镜写 `shots/<id>/review.json`
     (七维各 0–10 + `heroFrame` + `technical` 五项 + 0–3 条**真实**不符(合格镜可为 0,不许凑数)+ 最多五条按分数影响排序的修复,FAIL 时至少一条),格式见 `docs/visual-scorecard.md`。
   - `docs/subagents/continuity-reviewer.md`:拿有序的「尾帧 → 下一镜首帧」配对,写 `continuity.json`,
     **只能要求修改失败边界两侧的那两镜**。

   ```bash
   node tools/validate-review.mjs projects/<name>/review.json   # 总分<80 / 任一维<6 / 英雄帧<8 / technical 有 false → exit 1
   ```

   **只允许一轮集中修复**:按 `repairs` 的分数影响从高到低修 → 重渲那几镜 → 重跑评审。
   第二轮仍不过就记降级到 `review.md` + `build-log.json` 并往下走,不许在这儿无限循环。
9. **序列第 11 步:规范化每镜产物**——不管哪个引擎出的片,进拼接队列前一律过这一步(脚本自带 ffprobe 自检,不过不许往下走):
   ```bash
   tools/normalize-shot.sh <引擎原始产物> projects/<name>/shots/shot-<NNN>/shot-<NNN>.mp4 <W> <H> <fps> none
   ```
   统一为合同的偶数宽高、30fps(除非合同覆盖)、H.264 High、`yuv420p`、无音轨、timebase/SAR/色彩标记一致。
10. **序列第 12 步:拼接 + 客观校验**(不要肉眼核对):
   ```bash
   tools/concat-shots.sh projects/<name>/out/draft.mp4 projects/<name>/shots/shot-*/shot-*.mp4
   tools/validate-output.sh projects/<name>/out/draft.mp4 --size <W>x<H> --fps 30 --duration <合同时长>
   tools/check-density.sh projects/<name>/out/draft.mp4 --contract projects/<name>/visual-contract.json
   ```
   单镜项目也照样过 `normalize-shot.sh` 再转存为 `draft.mp4`,不要让交付物规格取决于哪个引擎出的。
11. **序列第 13 步:停表**——`node tools/production-clock.mjs finish --project <P>`,把活跃时长记进 `build-log.json`。
    超过60分钟记录预算变化与瓶颈；按批准方案继续必要制作和修复。
12. **一次性交付**:草稿路径 + 分镜列表摘要(含每镜引擎)+ 2–3 张关键帧图 + 自查中的取舍说明。

## 阶段 C:自然语言修改循环

用户说哪里不满意 → 直接改代码 → 重渲草稿再交付,**不新增确认点**。
只有"整体视觉方向不对"这一类反馈才回到阶段 A 重跑一轮三张 Styleframe;
"字太小""这镜节奏慢""换个素材"一律直接改画面。每轮修改要点追加进 `review.md`。

## 阶段 D:用户满意 → 导出与沉淀

1. 渲最终文件到 `out/`(默认 MP4),ffprobe 核对。
2. 写 `DELIVERY.md`:文件清单 / 使用说明 / 素材来源汇总(元数据,不阻塞交付)/ 关键设计决策。
3. **沉淀(不可省略,且必须落成代码)**:
   - 追加 `memory/taste.md`(选了哪张 Styleframe、改了什么、不满、确认偏好)。
   - **把本片里可参数化的新手法抽成组件**放进 `templates/remotion-base/src/components/`,踩过的坑写进组件注释,
     登记 `docs/component-catalog.md`,在 `ComponentGallery` 摆样品渲帧确认。判断标准:换一个内容还能用 → 抽;只对这条内容成立 → 留在项目里。
   - 新的视觉结论更新对应 profile(`docs/styles/*.md`)。

   > 只写进 taste.md 不算沉淀。手法停在散文描述里,下个项目还是会手搓一遍。
4. **素材沉淀与淘汰**:只把最终成片实际用到且可复用的开源素材复制进 `assets/library/` 并登记 `LIBRARY.md`;
   修改循环中被弃用的下载素材从项目里删除,不入库。

## 断点续做

会话中断后回到一个已有项目,**按产物判断从哪一步继续**,不要重问用户也不要从头再来:

| 目录里已有 | 从哪继续 |
|---|---|
| 只有 `brief.md` | 阶段 A 第 3–4 步(粗分镜 + 三份候选合同) |
| 有候选合同,`styleframes/` 里图不全 | 阶段 A 第 5 步(派 worker 渲图) |
| `sf-1.png` / `sf-2.png` / `sf-3.png` 齐全,`proposals.md` 没记选择 | 阶段 A 第 6 步(呈现三图,停,等选) |
| `proposals.md` 已记录选择,无 `visual-contract.json` | 阶段 B 第 1 步(冻结并校验合同) |
| 有 `visual-contract.json`,`shots/*/route.json` 不全 | 阶段 B 第 3 步(逐镜填 `signals.json` + 跑 `tools/route-shot.mjs`) |
| `route.json` 齐全,没有引擎工程 | 阶段 B 第 4–5 步(素材 + 按引擎建工程并派 worker) |
| 有引擎工程,`shots/*/shot-*.mp4` 不全 | 阶段 B 第 6–9 步(自查 + `tools/render-queue.mjs` + 评审 + `tools/normalize-shot.sh`) |
| 各镜规范化产物齐全,`out/` 里没有草稿 | 阶段 B 第 10–11 步(`tools/concat-shots.sh` + 校验 + `production-clock finish`) |
| `out/` 里有草稿 | 交付,然后进阶段 C 等反馈 |
| 有 `DELIVERY.md` | 项目已收尾;新需求当作新项目或阶段 C 修改 |

判断依据是**文件是否存在且非空**(合同还要校验通过),不是记忆。开工前先 `ls` 一遍项目目录。
`build-log.json` 已有 `start` 事件时**不要再 start**(会被拒),用 `node tools/production-clock.mjs status --project <P>`
看现在处在哪一档,续做期间照常 `checkpoint`,收尾时才 `finish`。

## 统一产物位置

执行前读取 `docs/artifact-layout.md`。统一入口 `../output/<SC-XXXX>/` 只放可直接使用的资源，分类目录内平铺中文内容名文件；无内容不建目录。合同、报告、日志、工程与旧版本留在仓库 workspace 或隐藏 `.制作资料`。内部验收后同步可用资源到用户目录，不再放 README 和制作流程目录。
