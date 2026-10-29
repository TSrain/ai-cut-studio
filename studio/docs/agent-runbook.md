# AI Motion Studio

Package 规则唯一准源：../workflow/docs/complete-package-contract.md（本文件不重复）。

## 自动素材与动画共轨

自动视觉轨道分配接口见 `../workflow/docs/automatic-visual-tracks.md`。

不设置首尾帧最低墨量、最低材质种类、默认弹簧次数、固定语义节拍上限，不因计时/重试自动降质。密度与运动参数只描述本期设计，不作为默认必达额度；实际表达以批准方案和真实播放验收为准。60 分钟只作预算提示，不冻结范围、不自动判质量失败。

由 AI 驱动的个人动画设计与生产系统。愿景和完整需求见 `purpose.md`,本文件是**系统的运行手册**——每次会话按这里的规则工作。

**面向用户的白话手册是 `docs/GUIDE.md`**(README 是它的速查版)。用户问「这项目怎么用」「XX 是什么」「我有哪些资产」这类**理解性**问题时,答案要么直接讲清楚要么指向 GUIDE,**不要甩 `docs/` 下的技术文档**——那些是给我看的。每次系统能力有变(新模板/新资产类别/流程改动),GUIDE 和 README 同步更新,别让它们过期。

## 独立真实素材分支（real-footage-v1）

收到 phase=footage 或 real-footage-v1 合同时，主仓库 `../workflow/.devin/skills/content-footage/SKILL.md` 与 `docs/real-footage-contract.md` 为运行准源；这里只执行工程技术校验和应用，不走下方动画创作／Styleframe／旧分镜批准。project/source/canvas、共享 SRT、审稿清单与媒体 hash 校验后，全部可用候选加入项目素材库，推荐自动追加独立静音素材轨道。完整原片保留，横屏 UI 用原生 contain 完整显示并以不透明背景承托；不拉伸、循环、定格、裁掉关键 UI，也不把旧 overlay 的 Alpha 要求套到真实原片。

保留所有旧动画/模板/素材/主视频/字幕/音轨/镜头/封面、手调、锁定与显隐；同候选同目标幂等，删除/忽略/撤销不恢复，新版本独立，并发重读 CAS，不加公共库。

kind=footage 的 placementId=null 表示项目候选，有 placement 表示按真实 SRT/source.clips 定位的推荐；不出现旧镜头／槽位／位置批准。输出逐段审稿、报告与全部候选清单。技术、抽帧、连续观看、听审和最终采用分开；这条支线不执行镜头推拉、字幕、封面与声音。独立素材 worker 到此 return，不进入后续动画序列。

## 独立动画与历史合同规则

以下仅用于独立动画或明确历史合同续作；当前 package 按顶部唯一合同执行。

## 架构:五条核心决定

1. **不开发编排软件,Codex 会话即运行时。** purpose.md 里的"创意导演 / 分镜生成器 / 技术路由器 / 代码生成器 / 视觉审查器"不是要写的代码模块,而是工作流阶段(`.devin/skills/`)+ 设计知识(`docs/`)。
2. **一切皆文件。** 每个动画任务是 `projects/` 下的一个目录,阶段产物用固定文件名(见下),任何阶段可中断、可续做、可回看。
3. **效果设计先行，工程底座复用。** 先按内容设计最佳画面，再比较可满足的模板与定制；模板同等最好时可推荐复用，不能因为槽位能放下就自动选模板。Remotion 工程仍从 `templates/remotion-base` 复制，HyperFrames 从既有工程底座开始；复用工程配置不限制镜头表达。
4. **质量验收按阶段看真实结果。** package 检查实际关键帧与状态变化设计，对照批准的 Styleframe，明确动态尚未验收；broll 还须连续播放全部交付镜头，检查口播时点、运动、相邻衔接及真实口播合成。技术门禁、评分和静帧都不能替代本次动态观看。对照 `docs/quality-checklist.md` 与批准合同，发现偏差就修画面并重看，未看完的范围明确标未验收。
5. **品味会沉淀,而且必须沉淀成代码。** 每个项目收尾时把用户的选择、修改和不满写入 `memory/taste.md`;每个新项目开始时先读它。**更重要的是:用户满意后,把可参数化的新手法抽成组件回流 `templates/remotion-base/src/components/`,并登记 `docs/component-catalog.md`、在 `ComponentGallery` 里摆一个样品渲帧确认。**

   这一步过去长期被跳过——17 个项目下来 taste.md 里攒了二十几条具名手法,组件库却只有 3 个组件,于是每个新镜头都在手搓,质量随每次发挥波动、也不累积。散文描述留在记忆文件里不等于沉淀,**只有变成能 import 的组件才算**。判断标准:换一个内容还能用 → 抽组件;只对这条内容成立 → 留在项目里。抽的时候把踩过的坑写进组件注释,那才是下次真会被读到的地方。

## 工作流(调用 `$motion`,或直接说需求)

**用户全程只有一个决策点:看三张真实渲染的 Styleframe,选一张(或指名混搭)。** 短合同见 `docs/visual-first.md`,决策协议见 `docs/styleframe-protocol.md`,完整流程见 `.devin/skills/motion/SKILL.md`:

1. 用户描述需求 → 写 `brief.md` + 粗分镜 + 三份候选合同 → 三个并行 worker 渲出 `styleframes/sf-{1,2,3}.png`(**真实文案、真实中文字体、真实素材、目标比例**,不是 moodboard/线框/文字提案)→ 呈现三张图,**停,等用户选**
2. 选定后自动连跑,中间不再要确认:冻结并校验 `visual-contract.json` → 逐镜路由引擎 → 并行实现 → 自查(渲关键帧 + 质量检查单 + 对照选中的 Styleframe,循环到硬性项通过)→ 渲出成片草稿
3. 一次性交付:草稿 + 分镜摘要 + 关键帧图
4. 用户自然语言提修改 → 直接改、重渲、再交付,循环到满意
5. 满意后导出最终文件、写 `DELIVERY.md`、沉淀品味与组件

阶段产物(brief/proposals/storyboard/review)照常落盘,但只是过程留档,**不构成用户确认关卡**。唯一的硬顺序:没有被用户选中并校验通过的合同,不派发 shot worker。付费 AI 生成的费用确认是既有授权规则,保留,不算新增停点。

**三个工作流跑的是同一条 13 步生产序列**(每个 SKILL 开头有可执行的那一份表):
`production-clock start` → 三个 Styleframe 并行派发 → 出图前 `pause-selection` → 用户选完 `resume-selection` →
`validate-contract` → `build-dispatch-manifest` → worker 按波次并行 → `render-queue --concurrency 2` →
视觉 + 连续性评审 → 必要修复并重看 → 规范化 / 拼接 → `validate-review` + `validate-output` → `production-clock finish`。

**派发降级链**(按顺序试):原生 subagent → 共享文件系统的 headless worker → 内联串行。
降级只改变"谁来做、分几波",不改变"做多少"——**永远不许因为 harness 槽位少就砍镜头**。

**两个批量模式**——Styleframe 停点各有各的处理,但**渲帧自查、质量检查单、品味沉淀一项不降**:

| 模式 | 什么时候用 | 输入 → 输出 | Styleframe 停点 |
|---|---|---|---|
| `motion-broll` | 外部 package/broll 逐镜派发 | 逐镜需求单 → 关键帧或独立成片 | **最佳效果优先**：设计对象与状态变化，再并列比较能满足的模板；按批准路线制作。已选原生模板用真实预览印张，视觉未定 custom 做三图，同批一次视觉选择；带冻结合同继承设计、路线与视觉选择，不重选 |
| `motion-srt` | 用户给带时间轴的字幕/口播稿,要一整支片子 | `transcription.srt` → 拼接好的 `final.mp4`(时间轴完整覆盖) | 对整片一轮,选定后每镜继承同一份合同 |

`motion-srt` 的硬约束:镜头按语义拆、首尾相接完整覆盖字幕跨度、空白并入前镜、时长写小数秒保留毫秒精度、**各镜时长之和与字幕跨度误差 ≤0.1 秒**(每镜取整会累出几秒漂移,拼完就和原声对不上)。详见各自的 `SKILL.md`。

## 项目目录合同

```
projects/<yyyy-mm-dd>-<短名>/
├── brief.md              # 需求理解:表达目标、观众、场景、画布时长、素材策略、系统假设
├── storyboard.json       # 机器可读分镜(镜号、时长秒、语义节拍、视觉目标)
├── storyboard.md         # 分镜表:镜头号|时间|画面|动画行为|文字|素材|音效
├── visual-contract.json  # 冻结的 VisualContract,所有 worker 的只读输入
├── proposals.md          # 三张 Styleframe 路径 + 设计摘要 + 用户选择记录(不是文字提案)
├── styleframes/          # sf-{1,2,3}.png + sf-{1,2,3}.contract.json
├── assets.md             # 素材清单:文件、来源(元数据)、使用位置
├── assets/               # 素材文件(选中即下载到本地)
├── shots/shot-NNN/       # route.json / dispatch.md / context-pack.json / props.json(preset 镜) / source/ / keyframes/ / review.json / draft.mp4
├── build/                # Remotion 工程(从模板复制)
├── continuity.json       # 相邻镜头首尾锚点
├── build-log.json        # 各阶段开始/结束/降级事件
├── review.md             # 视觉与连续性审查记录
├── out/                  # 渲染产物
└── DELIVERY.md           # 交付说明:文件清单、素材来源、关键设计决策
```

## 关键规则

**规则优先级(冲突时从上往下裁决,上面的赢):**

```
选中的 Styleframe / VisualContract
> 技术硬门槛(可渲染、偶数尺寸、时长/SRT、确定性、事实正确、文字可读)
> 当前 visual-first profile(docs/styles/)
> 镜头 recipe
> 外部 skill 的通用建议
> 旧项目经验(memory/taste.md、历史项目做法)
```

`docs/design-principles.md` 不再拥有压过 VisualContract 的审美优先级:它的确定性/输出规格/可读性条款留在第 2 层,克制条款降为 profile 默认值,可被合同显式覆盖。

- **先有画面,再有工程。** 用户选的是帧,不是文件合同;工程正确只是不翻车的下限,不是交付理由。每个运动仍要答得出"这个动画帮观众理解了什么"。
- **三张 Styleframe 必须方向不同**(构图、字体、材质、运动设想四项同时拉开),不是同一方案的微调。默认三向:Brand Impact / Editorial Cinematic / Digital Spectacle。
- **信息不足时可以假设,但必须在 brief.md 里明确标注假设**,不允许沉默地替用户做决定。
- **字体和配色是画面质感的第一来源,不许用默认值。** 字体套装(kit)是合同里的显式输入,`textStyle()` 必须同时收 kit 和 style role(`docs/typography.md`);颜色在 `visual-contract.json` 里声明一次、组件只消费 token(`docs/color.md`)。**`system-ui` 和中文静默回退到默认字体一律不通过。**
- 设计执行遵守 `docs/visual-first.md`(优先级、画布、密度、评分、禁止回归项)+ 选中的 profile(`docs/styles/`);`docs/design-principles.md` 提供时序、缓动、编排、图表、安全区的默认参数;审美方向参考 `docs/visual-language.md`。
- **技术选型按镜头双引擎路由**(短合同见 `docs/visual-first.md` 的 Engine Routing,完整判据见 `docs/engine-routing.md`,索引在 `docs/tech-routing.md`):字幕/数据/跨镜延续/复杂 `<Sequence>` → **Remotion**;网页截图/DOM 重构/Kinetic Type/Shader/3D/Registry 已有 block → **HyperFrames**;同一镜既要强视觉层又要精确字幕数据 → **Hybrid**(HyperFrames 出层规范化成 MP4,Remotion 做最终文字与拼接)。**不许因为"模板在这儿"就把所有镜路由到 Remotion**;Hybrid 是例外,不为"两个引擎都用到"而选。
  逐镜写十一个信号(0/1/2)→ `node tools/route-shot.mjs` → `shots/shot-NNN/route.json`,人工改路由必须在 `route.json` 里写 `override` 和理由。**`2` 是"不满足就等于这镜做失败了",不是"这镜有这个东西"——带字幕的镜绝大多数填 `captions: 1`。** 精确侧和视觉侧各出现一个 2 会直接短路成 Hybrid;一批里超过一半镜头被判 Hybrid,回去重填信号,不要接受结果。
- **确定性**:一切从 `useCurrentFrame()` 推导,代码里不许有 `Date.now()`、未播种 `Math.random()`、渲染期网络请求;素材一律引项目内本地文件。任意一帧必须能独立算出来——否则重渲结果不一致,抽帧自查也就失去意义(`docs/design-principles.md` §9)。
- **素材搜索两极查询**:要么原子式(1–3 词,可组合),要么具体式(5–15 词,唯一事物),**不用中间长度**;具体式查不到就丢弃该需求,不要放宽——放宽出来的都是通用图库垃圾。**筛选才是难的部分,不许拿第一个结果**,每条需求过一遍"用/备选/弃"。
- **素材政策是放开的**:真实品牌 logo、网页截图、来源不明的网络图片都允许使用,**不因版权/商标/来源/署名状态阻塞视觉演示**。`assets.md` 记录来源作为**非阻塞元数据**。硬门槛只有两条:**选中的素材必须立刻下载进项目 `assets/` 并以本地路径参与渲染**(为了确定性和重渲),以及**事实正确**——演示可以用虚构数字,但合同要写 `facts.mode: "illustrative"`,不得让演示数字伪装成真实结论。
- **素材库先行**:选素材先查 `assets/library/LIBRARY.md`(CC0 的 HDRI/PBR 材质/模型;3D 玻璃金属质感的模板用法也记录在那里)。**新入库一个 HDRI/材质,同时补 `hdri/HDRI.json` / `materials/MATERIALS.json` 的中文说明并渲样品球**(`node tools/build-library-previews.mjs`)——只有文件名的素材等于没入库,用户在控制台里看不懂也就选不动。沉淀与淘汰:只有进入用户满意的最终成片的素材才入库;修改循环中被弃用的下载素材交付时删除、不入库。
- **并行**:角色分工与写入边界见 `docs/subagents/`(六份角色合同),**每个 worker 只写自己那一个目录**,派发包由 `node tools/build-dispatch-manifest.mjs` 生成。并发上限只作用于吃内存的浏览器正式渲染队列——走 `node tools/render-queue.mjs <queue.json> --concurrency 2`(内存不足降 1,队列项的 `command` 必须是数组)。方案、素材、代码、审查一律并行,不得因为渲染队列上限而串行思考或砍镜头。**worker 的完成标准是目标文件存在并通过校验,不是它口头说完成了。**
- **计时**:每个项目从读需求起表——`node tools/production-clock.mjs start|pause-selection|resume-selection|checkpoint|finish --project <P>`,事件 append-only 写进 `build-log.json`。展示 Styleframe **之前**必须 `pause-selection`(用户思考时间不算活跃时长),选完立刻 `resume-selection`。活跃时间只提示预算变化，不自动判失败。
- 交付前必须通过 `docs/quality-checklist.md` 的全部硬性项,并通过结构化评审门禁 `node tools/validate-review.mjs projects/<name>/review.json`(评分卡格式见 `docs/visual-scorecard.md`:总分 ≥80 / 任一维度 ≥6 / 英雄帧 ≥8 / `technical` 五项全 true)。散文 review.md 照写,但**门禁读的是那份 JSON**。

## 版本备份(git)

本仓库只备份**架构**,不备份**资源**——判据:删掉能靠命令重建或重新下载的进 `.gitignore`,手写的思考与代码入库。当前入库约 870 个文件 / 13MB(docs 知识、tools 工具链、templates 的 src 与配置、`.devin/skills/`、benchmarks 的 cases/baselines、assets 的索引 md+json、memory/taste.md);`projects/`、`workspace/`、`node_modules/`、渲染产物、素材二进制、评测 runs 全部排除。

**什么时候必须提交**(架构改动):

- 改了 `tools/` 下任何脚本、`tools/lib/` 的采集/写入/页面层
- 改了 `templates/*/src/`——新组件、新 preset、皮肤、`fonts.ts` / `color.ts` / `anim.ts`
- 改了 `docs/` 的规则文档、蓝图、配方目录、preset 定义、风格 profile
- 改了 `AGENTS.md` / `docs/agent-runbook.md` / `.devin/skills/` / `skills-lock.json`
- 收尾时把新手法抽成组件回流模板(第 5 条核心决定)——**沉淀完必须提交,否则等于没沉淀**

**什么时候不提交**:渲了新片子、下载了新素材、跑了评测、控制台重建缓存、生成缩略图/预览片——这些都是资源,`.gitignore` 已经挡住,不要用 `git add -f` 硬塞。

提交粒度按**一件事一次**,信息写清「改了什么架构、为什么」;一次会话做了多件事就分多次提交。目前**只有本地仓库,没有远端**,用户没要求就不要 `git remote add` / `git push`。

## Skill 路由(设计/创意类)

工作流仍以 `$motion` 为唯一入口;以下 skill 是它在不同阶段调用的工具,按场景路由:

| 场景 | 用什么 |
|---|---|
| **任何动画任务开工前(每次)** | `docs/visual-first.md`——优先级链、画布与密度、三张 Styleframe、合同字段、引擎路由、评分门槛、六条禁止回归项。**它排在本表第一位,与其他条目冲突时它赢** |
| **控制台的信息架构(改之前先读这条)** | 导航按**使用频率**排,不按功能分类排:总览 / 做片子 / 项目与产物 → 资产各区 → 「例行·不常用」(风格皮肤、存储清理、系统体检、我的偏好,视觉弱化压底部)。三条已被验证的原则:①**同一堵墙不许出现两次**(原「镜头模板」和「做片子」都列 7 张模板缩略图,合并了);②**重叠 90% 的两个区要合并**(原「成片库」48 支里 46 支属于项目,并进「项目与产物」并用成品/单次产物切换);③**上传属于资产区,不是独立功能**(每个资产区自带上传条,分类由所在区决定,不用用户先想清楚归哪类) |
| **「存储清理」和「资产就地删除」是两件事** | 别合并。存储清理管**腾磁盘**——18.9GB 里几乎全是评测产物/node_modules 克隆/渲帧中间物,真资产统共 176MB(0.9%),而且要横向比大小才判得出该删哪块;资产就地删管**管理资产本身**(这款字体我不喜欢)。两套入口、两套安全语义:前者走路径白名单,后者走 `deleteAsset(kind,file)` 只认类别+文件名,浏览器传不进路径 |
| **往控制台里加任何区块** | **默认懒加载,不许在页面加载时全量初始化。** 用 `onView(id, fn)` 包住重活(扫盘/大文件/动画),视频一律 `preload="none"`,自动播的挂 `data-auto="1"` 交给 `videoIO` 按视口播停。2026-08-14 之前所有区块都是页面一打开就全量加载:89MB 字体 + 48 支成片 preload=metadata + 12 支视频常驻播放 + 24 个 Lottie 同时跑,首屏 8.5MB;改完 1.59MB。<br>**另一条同等重要:默认收起。** 每面墙渲完调 `autoCap(wall, rows, unit)`——只露前几行,其余进「展开更多」;`rows` 是**量出来的行**不是个数(auto-fill 的列数随窗宽变),只多出 1 个就不收(按钮的决策成本大于多露一格)。展开是**粘性**的,重画不许收回去。项目区收两层:组内一行 + **只露 2 个项目**——只压扁单个项目的高度没用,项目一多整个区照样长得没边,把后面的模块全顶到看不见的地方 |
| **控制台里任何会触发渲染的交互** | 走 `runRemotionInLane(lane, …)`,**不要用 `runRemotion`**。它保证同一 lane 的新请求先把旧的**连进程组一起杀掉**(`detached:true` + `kill(-pid)`);只 kill npx 壳的话 node 和 Chromium 会活下来继续烧 CPU,那是假修复。路由层还要挂 `req.on('close') → cancelLane(lane)`,浏览器一断开就收工 |
| **给用户看模板效果 / 让他自己调模板** | **不要只给静帧**——时序(入场生不生硬、末段静止够不够)静帧里看不出来,而那恰恰是他要确认的。控制台「做片子」的模板墙**默认就在播预渲好的样例动效**(`assets/previews/presets/<id>.mp4`,由 `build-asset-previews.mjs --only presets` 用 preset.json 的 `sample` 文案提前渲好存盘,滚到即播、零等待);「预览动效」按钮渲的是**用户自己填的字**,两者不是一回事,别拿样例片顶替它。**改了 preset 组件 / 皮肤 / sample 文案之后要重渲样例片**,否则墙上播的还是旧版式。「去 Studio 微调」会深链到 `/<compositionId>` 直接选中;「去 Studio 微调」会深链到 `/<compositionId>` 直接选中。Studio 侧栏已用 `<Folder>` 分组(口播模板 / 样品册与样张 / 皮肤与演示),新增合成要放进对应 Folder,别再平铺 |
| **用户想在剪映里继续改**(改节奏 / 删一段 / 换配乐 / 换素材) | `docs/jianying-export.md` + `tools/jianying/export.py`。字幕导成**剪映原生文本轨**(内容/字号/颜色全开),镜头按硬切分段可变速重排,音频独立成轨;镜头内动效只能烘焙。**字幕工程尤其值**——与其交带 alpha 的 .mov 让用户自己合成,不如给一份字幕能改的草稿。装之前必须完全退出剪映。⚠️ Mac 版实测通过、Windows 未验证;本机草稿全加密所以要走 `--allow-missing-fingerprint` 实验通道(**无指纹草稿能否被剪映加载尚未实测**);草稿含设备指纹,**不要直接分发给他人** |
| **用户给实拍口播 + SRT 要「增强/镜头切换/连字幕一起处理」** | `aroll-enhance` skill(编排型总入口):并行跑字幕管线 + 有目的 A/B/C 镜头轨。完整读 `.devin/skills/aroll-enhance/references/shot-switching.md`,结合字幕、语气、表情与证据素材写 `version=2 shot-plan.json`,先跑 `tools/aroll-breath.mjs check`,再 apply 到新文件。禁止按段落自动推拉；默认内部自检后直出。交付分两层:镜头视频在底、字幕层 mov 在顶,字**不跟着变焦**。配套双通道模板 pill-stack / word-cascade 仍叠在同一时间线。 |
| **用户对已经出好的字幕提修改意见**(错字/断句/节奏/加字) | **先把控制台的「改字幕」区给他,不要自己动手改 JSON**:`node tools/build-asset-browser.mjs --serve`。他十秒能判断的事,走一轮"说给我听→我去找→我改→重渲"成本远大于问题本身。那里能改字、拆并块、拖时间轴、听着音频看实时预览、一键重新出片(约 4 分钟跑完子集化→ProRes→HEVC→带音预览)。<br>只有**需要重新理解内容**的改动(整段重新分句、换表达方式、加新的强调逻辑)才由我改脚本。<br>实时预览是 `CaptionLayer.tsx` 的浏览器孪生体,**改了渲染器的出入场逻辑必须同步 `panel-page.html` 的 `capLineHTML`**,并用面板上的「对拍一帧」验证(实测两边差 ≤0.21% 画幅)。版式常数不用同步:`tools/lib/caption-spec.mjs` 把 `spec.ts` 转译出来,控制台/linter/预览共用一份 |
| **用户想「自己套模板填字出片」** | 控制台的「做片子」区(`node tools/build-asset-browser.mjs --serve`)。表单从 `docs/presets/<id>/preset.json` 的 `label`/`hint`/`slots`/`variants` **自动生成**——加第六个模板时把这几项写对,表单自动就有,不要回头改面板代码。观感套装在 `docs/presets/looks.json`(改完跑 `node tools/build-look-thumbs.mjs`);品牌标记与音效走 `src/style/chrome.tsx` 的外挂层,在 `presets/index.tsx` 的 `withChrome` 统一注入,**不要写进单个 preset 组件** |
| **用户问「我有哪些资产 / 在哪管理 / 怎么加 / 磁盘满了 / 系统还好吗」** | `node tools/build-asset-browser.mjs --serve`——**给他这条命令,不要甩 markdown 表格,也不要让他去 IDE 里找文件**。这是控制台不是画册:看(字体渲样句/运镜动图/音效试听/6363 图标可搜)+ 做(拖拽上传自动归位、批量清磁盘并区分独占与 APFS 克隆、系统体检红绿灯、一键起 Studio 调模板、拖滑杆改皮肤色相当场重渲、当前生效的偏好与硬门槛、项目与成片库)。目录索引才是 `docs/ASSETS-MAP.md`,那是给我看的;白话手册是 `docs/GUIDE.md`。资产变了重跑一次刷新 |
| **决定这次的视觉方向** | `docs/styleframe-protocol.md`(三图怎么产生/呈现/冻结)+ `docs/styles/visual-max.md`(默认)/ `editorial-luxe.md` / `brand-energy.md` / `data-cinematic.md` |
| **用户自带定帧进来**(Codex 图像生成 / 其他生图工具 / 设计稿),或问「怎么描述才专业」 | `docs/describe-spec.md`——定帧 17 维 + 单镜 16 维,每维都标了落到哪个合同字段。**自带定帧时按这 17 项反查缺什么**:缺的项当场问一句或按默认值假设并写进 `brief.md`,**不许沉默补默认值**;补齐后反推 `visual-contract.json` 再走校验。用户问描述方法一律给这份,不要现编一套 |
| **上游需求单带 `## 视觉规格` 块**(自媒体工作流 `/package` 采集的批次级取值) | `docs/describe-spec.md` §6 是这个块的接口定义(§6.1 批次级 11 项 → 合同顶层,§6.2 镜级 3 项 → `shots[]`)。**填齐 6.1 时三张 Styleframe 降为一张直出**——顶层字段已被上游定死,探索无意义;填一半按填到的项收窄探索。留空项照旧假设并逐条写进 `brief.md` 假设区。**§6 是本项目对上游的对外接口,改字段名等于改接口,要同步通知上游** |
| 定审美方向、怕做得"像模板" | **两遍法,Styleframe 阶段必做不是可选**:第一遍 `docs/visual-language.md` 定签名元素与反模板,第二遍 `frontend-design`(插件)把它落成令牌方案(字号阶梯 / 间距节奏 / 层次对比)。**先定方案再写代码**;跳过它的结果就是默认间距 + 居中堆叠 + 平庸字号阶梯。这两条**不走 `route-knowledge.mjs` 的 token 预算**——预算是给镜头 worker 的,审美层在定帧阶段是必读。worker 交付要回一行 `two-pass:` 说明两遍各定了什么,写不出退回重做(角色合同 `docs/subagents/styleframe-worker.md`) |
| **任何有文字的画面**(即几乎所有画面) | `docs/typography.md` + 模板 `src/lib/fonts.ts`。合同里写死 `typography.kit`(impact / editorial / human / modern / tech-data),`textStyle()` 同时收 kit 和 style role。**禁止 `system-ui`,禁止中文静默回退** |
| **任何画面的定色** | `docs/color.md` + 模板 `src/lib/color.ts`。颜色在 `visual-contract.json` 的 `palette` 里**声明一次**,组件只消费 token;骨架是明度阶梯,一个主色 + 最多两个辅助色,强调面积 10%–35% |
| **用户点名"做成某品牌那种感觉"**(Stripe / Linear / Apple / 特斯拉…),或想要一套可信的品牌级配色与字体层级 | `design-md`(全局 skill,74 个品牌的 DESIGN.md 令牌库,每周自动更新)。先读它的 `INDEX.md` 挑品牌,再只读那份 DESIGN.md 的 YAML frontmatter,**不要整篇通读**。硬边界三条:①网页组件规范(按钮态/表单/breakpoint/hover)不进画面,只取颜色角色、字体层级、间距节奏、圆角尺度、Do's-Don'ts;②专有字族本机没有,只迁移字重/字距/行高的**比例关系**,字族映射到 `typography.kit`,禁止 `system-ui` 与中文静默回退;③它在裁决链里属于"外部 skill 的通用建议"层,和 `docs/color.md` 的一主色 + ≤2 辅助色 / 强调面积 10–35% 冲突时**项目规则赢**——品牌网页有二十个色,一帧画面没有。产出的仍是候选合同,照常渲 Styleframe 让用户挑 |
| **口播插片(B-roll)设计与实现选择** | 先读 `../workflow/docs/animation-design-standard.md`，按内容目标设计最佳起始→变化→结束及口播关系；再现读 `docs/presets/MENU.md`，同时说明模板方案、差距、定制收益与推荐。模板同等最好可推荐，不以存在候选自动选择；`presetCandidates` 与 `selectedPreset` 分开。已批准合同含实现路线，不以重匹配覆盖 custom。仅已选原生 verified preset 走展开、真实预览印张、既有确认与技术快车道；视觉未定 custom 无论有无模板候选均走三图。方案同批展示，不加审批轮；全部镜真实观看。命令与完整门禁见 `.devin/skills/motion-broll/SKILL.md` |
| **写任何新镜头之前(两件事,顺序固定)** | ① 查 `dispatch.md` 的「**Recipe shortlist**」和「Component shortlist」两段——**配方在前**(几个组件按什么时序凑成一个具名手法,与批准表达完整适配时复用；否则调整或定制，不让配方时序改写口播节奏),组件在后——**复用能达到批准效果的零件与参数，不能为复用降低效果**;手搓一个已有组件的等价物是本项目最常见的浪费。那份清单由 `build-dispatch-manifest.mjs` 按本镜标签从 74 条目录里算出重合度前 10,并把**重合度前 3 名的参数表与坑**一并展开(约 1600 tokens),**只有它不够用时**才去读全表 `docs/catalog/components.json`;HyperFrames 侧另跑 `hyperframes catalog`。**没命中本地配方时去控制台「镜头配方」区挑外部卡**(152 张 / 209 式,索引层,`docs/catalog/recipes-external/`;标着「需页面采集」的先别挑)。② 按标签路由知识:`node tools/route-knowledge.mjs <engine> <tags>`,把输出写进 `shots/shot-<NNN>/dispatch.md`(见下一行) |
| **给 shot worker 准备 dispatch** | `docs/knowledge-routing.md` + `node tools/route-knowledge.mjs <remotion\|hyperframes\|hybrid> <逗号分隔tags>`。输出恒为 `docs/visual-first.md` + **最多 4 条**动态资源。**不许把外部 skill 的完整源码粘进 dispatch**——只给资源标识符和一行"这一镜为什么需要它";`skill:<name>` 是逻辑 id,worker 按名字调用仓库 skill。标签词汇与组件目录同一套 |
| **一镜不知道怎么编排**(分几相、每相多少帧、哪相要重叠) | `docs/blueprints/` — **正向结构,不是禁令**。`docs/` 其余部分几乎全在说"不许出现 X",空画面照样过;蓝图说的是"照这个搭"。**不用手查**,`route-knowledge.mjs` 按标签自动路由进 dispatch,已列入 `exclusiveKinds` 一镜最多进一份。来源是 `$learn-broll` 从真片子反推的编排,每份都能回溯到 `docs/reference/` 的参考帧。新蓝图的判断标准与写法见 `docs/blueprints/INDEX.md` |
| **想看"做得好的画面长什么样"**(定 Styleframe 方向时) | `docs/reference/INDEX.md` — 从真片子里抽的参考帧库,每张记了「值得学的那一句话」。**这是本项目唯一的参考系**:其余文档都是散文规则,只有规则没有参考等于看着化学教材学做菜。新素材入库走 `$learn-broll <链接>`。**参考帧只作内部学习引用,不得进入任何交付成片** |
| 写分镜表的"动画行为"列 | `docs/motion-vocabulary.md`(受控词汇表,不要写自由散文) |
| **在图上定位**:圈注/箭头指向/局部高亮/Ken Burns 推向某焦点 | **目标是文字时先跑 `node tools/ocr-locate.mjs <图> "<文字>"`**(macOS Vision 离线 OCR,子串级精度,实测与网格法误差 <0.3% 画幅,一步出 markX/Y/W/H;匹配自动容忍空格与全半角)。没命中或非文字目标再走 `docs/locate-protocol.md` + `node tools/locate.mjs` 网格法。**不许目测坐标**——目测平均误差 6.5%,网格法 2.3%,且末步 `mark` 会当场暴露偏移。控制台「做片子」的截图类模板另有拖框/输字定位,用户自己就能填 |
| 校验渲染产物(尺寸/偶数边/帧率/时长/音轨) | `tools/validate-output.sh <文件> --size WxH --fps 30 --duration S`,交付前必跑 |
| **记录画面诊断与技术检查** | `tools/check-density.sh <文件>` + `node tools/lint-shot.mjs <shots目录>` + `node tools/frame-audit.mjs <关键帧...>`；墨量/层数不设最低额度，技术检查与真实观看分别执行 |
| **看关键帧之前(每次)** | `node tools/frame-audit.mjs <帧...> --contract <合同>` 记录指标；墨量/明度层数/构图偏压只辅助观看，不能代替真实播放与合成判断。**自查帧 `--scale=0.4`**，必要时补读全分辨率 |
| **给静图/素材定运镜**(9 式) | 平面四式(慢推/慢拉/横移/对角推)走 `KenBurns`,一个组件的参数表达。**分层五式**(急推撞停 / 斜角滚正 / 多层视差 / dolly-zoom / 冻结环绕)走 `DepthCam` —— 后三式必须真分层,`KenBurns` 的单图 2D 模型装不下。分层素材:`swiftc -O tools/matte.swift -o /tmp/matte` 编一次,`matte <图> <前景.png> --trim --alpha-gamma 3.2 --width <显示宽>`。**抠不出来就退回 KenBurns**,不要拿两张平面图假装分层。震屏走 `src/lib/shake.ts`(确定性,不用 Math.random)。九式都能在控制台「运镜」区看循环片 |
| 定动效参数:时长/缓动/编排/stagger/运动性格 | `motion-design`(项目 skill,LottieFiles 参数手册) |
| 写 Remotion 弹簧/插值/循环/帧计算代码 | `remotion-animation`(项目 skill) |
| 写 Remotion 代码遇到具体专题:转场/音频/字体加载/文字测量/序列编排等 | `remotion-markup`(官方,28 个专题参考文件) |
| 查 Remotion API 准确签名和文档 | `remotion-docs`(官方,Algolia 搜索 + 文档页加 `.md` 取源) |
| 字幕/caption 实现 | `remotion-captions`(官方) |
| **网页/产品 UI 镜头**(要真实页面画面) | `docs/page-capture.md`:`node tools/capture-page.mjs --url <网址> --out projects/<name>/assets/` 零配置全页 2x 截图(自动关 cookie 横幅、滚一遍触发懒加载),再交给 `PageCam` 做 2.5D 运镜。**`layout.json` 是页面空间协议**——元素真实 `{x,y,w,h}`,网页镜头据此定位,**误差 0,不必再跑 `locate.mjs` 的网格法**(那套留给照片/长图)。要元素抠图才需要为该站写一次选择器 |
| **地图/地理镜头**:路线飞线、城市定位、区域高亮、地缘叙事(`docs/broll-capability-report.md` 点名的 Johnny Harris / Vox 甜区,过去一直手搓) | `remotion-maps`(官方,五条技术各自独立:`static-map` / MapLibre / Mapbox / MapTiler / Cesium,只读要用的那份 `TECHNIQUE.md`)。**默认 `static-map`**——地图图片先下载进 `build/public/` 再在上面做动画,这是唯一天然满足确定性条款的路径。真需要地图本身动(飞线跟随、镜头推移)用 **MapLibre**(免 API key、自带 Turf 地理运算);但它的 style JSON 与瓦片是**渲染期网络请求**,直接用就违反下面的确定性规则,**必须先把 style 和瓦片落到本地再渲**。Mapbox/MapTiler 要 key,Cesium 只在需要地形飞越时才值得 |
| 进阶渲染(批量、透明背景等,超出简单 render 命令时) | `remotion-render`(官方) |
| 图表/数据可视化画面 | **准源是 `docs/chart-rules.md`**(选形 / 坐标比例诚信 / 颜色编码 / 动画图表的坑 / 交付前六检),带 `data` 或 `chart` 标签的镜由 `route-knowledge.mjs` 自动派发。<br>**先判观看场景再定标注密度**:①**口播插片**(≤30 秒、看一遍就过)→ 走「结论与表现力优先」,最大字号承担当前节拍的信息、锁版承担结论,图表只负责作证,**不上审计信息**;②**独立解释镜**(观众会停下来读)→ 可以多标注;③**仪表盘/长图表**(需要反复查阅)→ 才走完整报告规范。<br>**三档的正确性规则完全相同,变的只是标注密度**;`chart-rules.md` §2/§4 属于技术硬门槛层,选中的 Styleframe 也不能覆盖。<br>⚠️ 旧文档里的外部 `dataviz` skill **已不存在**(marketplace 和磁盘都查无此物,2026-08-10 核实),规则已内化进 `chart-rules.md`,不要再引用那个名字。 |
| **路由到 HyperFrames 的镜头**:网页截图/DOM 重构、Kinetic Typography、GSAP 时间线、复杂遮罩、WebGL/Shader/3D/液态玻璃/粒子、Registry 已有匹配 block | `hyperframes` 系列(`hyperframes-core` / `-animation` / `-keyframes` / `-registry` / `-cli`)。这是**平级引擎**,不是 Remotion 的备选 |
| **想知道 Registry 里现成有什么**(挂 HyperFrames 的镜之前必查) | `docs/catalog/hyperframes-registry.md`——35 个口播相关 block 的**实渲缩略图索引**(转场合集/着色器/叠加层/数据地图/社交卡/展示型),`npx hyperframes add <名字>` 2.6 秒装完。**先翻这份再决定手搓**。全量 169 条用 `npx hyperframes catalog` 现查。<br>**挂载子合成有三个坑**(第一次批量出图 35 个全黑就是它们):挂载 div 必须在 `#root` **内部**(贴 `</body>` 前等于贴到合成树外)、必须补 `data-start`、`#root` 的 `data-duration` 要盖住 block 时长。判据:`hyperframes check` 报 `Layout: 0 issues across 0 samples` —— **0 samples 是没挂上,不是没问题** |
| 校验 VisualContract(冻结后、派发 shot worker 前) | `node tools/validate-contract.mjs projects/<name>/visual-contract.json`,不过不许派发 |
| **派并行 worker**(Styleframe / 镜头 / 素材 / 评审) | `docs/subagents/` 六份角色合同 + `node tools/build-dispatch-manifest.mjs <项目目录>`。同一波在**同一条消息里一次派完**;每份 dispatch 只声明一个可写目录 |
| **正式渲染排队**(唯一受并发约束的环节) | `node tools/render-queue.mjs <queue.json> --concurrency 2`。队列项 `{id, cwd, command, expectedOutput}`,`command` 必须是数组;过关 = 进程 exit 0 **且** 产物存在非空。B-roll 的 preset 批次再加 `--require-confirmed <项目>/preview/preview-manifest.json`——印张没盖章直接 exit 2,一帧都不渲 |
| **活跃计时与预算提示** | `node tools/production-clock.mjs start\|pause-selection\|resume-selection\|checkpoint\|finish --project <P>`。贴 Styleframe 前必须 pause,选完立刻 resume |
| **交付前的结构化评审门禁** | `docs/visual-scorecard.md` + `node tools/validate-review.mjs projects/<name>/review.json`。四条门槛任一不过即 exit 1 |
| **决定这一镜用哪个引擎**(合同冻结后、派 shot worker 前,逐镜各跑一次) | `docs/engine-routing.md` + `node tools/route-shot.mjs <signals.json>` → `shots/shot-NNN/route.json`。**不许拍脑袋定引擎,也不许手改 route.json 的 engine 而不写 override** |
| **任何引擎的镜头产物进拼接队列前** | `tools/normalize-shot.sh <in> <out> <W> <H> <fps> none`(自带 ffprobe 自检,不过不许拼)+ `tools/concat-shots.sh <final> <各镜>` |
| AI 生成图片素材 | **首选 codex CLI**(2026-08-06 实测:内置图像生成工具,写实质感优于万相,用户会员内**不额外花钱,因此不需要费用确认**):`cd <可写目录> && codex exec --skip-git-repo-check --sandbox workspace-write "生成一张图片:<内容描述>。保存为当前目录下的 <名字>.png"`。已知限制:版权角色/知名 IP 会被 OpenAI 安全系统 moderation_blocked(实测连拦三次),此时**回落万相**。<br>回落:`node tools/wan-t2i.mjs "提示词" --out <路径>`(阿里云万相 wan2.7-image,0.2 元/张,需环境变量 `DASHSCOPE_API_KEY`)。**万相是付费操作:生成前必须向用户确认张数与每张内容,确认后才执行**。两条通道生成的图都保留在项目 assets/ 里不删、登记 assets.md 版权。<br>**提示词写法**:按`风格关键词 + 主体 + 关键视觉元素 + 配色 + 负面约束`组织。**必须显式给风格词,否则默认吐写实照片**(平面/矢量:`flat illustration, vector art, UI style, no photography no realistic textures`;拼贴:`paper cut collage, torn paper edges, layered flat shapes`;复古:`vintage travel poster, sun-faded tones`)。付费,第一版往往最平庸——确认时就把风格词想清楚,别指望多生成几张试 |
| AI 生成视频素材 | `runway-api`(插件,需 API key;素材必须登记 assets.md 版权) |
| **声音设计 / 选音 / BGM 卡点** | `docs/sound-design.md`(判例 S1–S6 + 卡点方法)+ `assets/library/sfx/CATALOG.json`(181 条中文索引)。**两套库调性不同别混用**:根目录 33 个是梗音效(整活口播),`cinematic/<16 类>/` 149 个是电影系(成片/showcase)。**找音先定类别再挑音色**;`ui/` 必须逐条看 `verdict` 字段,不许整目录放行。BGM 在 `assets/library/bgm/`(5 首),配了 BGM 的片子**固定交付两版**(带 BGM / 只留 SFX)。⚠️ Mixkit 授权不允许把素材当独立文件再分发,**本项目将来若公开必须排除这两个目录** |
| **要卡点的片子**(用户已选好有鼓点的 BGM) | `node tools/beat-grid.mjs <BGM>` 先拿网格再分镜——**不通过验收的歌不要卡点**,跟着一个不存在的拍子剪比不卡点更糟。时间线写拍号 `beatF(n)` 不写帧号;稀疏重音钉 `onsetFrame`(真实瞬态)不钉 `frame`(网格点)。渲完必跑 `node tools/verify-beat-sync.mjs <成片> <beats.json>`,切点误差 ≤3 帧才算过 |
| 音效 | 首选 remotion.media 官方免费音效库(33 个常用 whoosh/click/ding 等,`<Audio src="https://remotion.media/xxx.wav">` 直接引用,清单见 `remotion-markup` 的 sfx.md;渲染稳定起见实际使用时下载到 `build/public/` 引本地文件,照常登记 assets.md)。免费库覆盖不了的定制音效,再用 `runway-api` 的 `rw-generate-audio --type sfx`(付费,`RUNWAYML_API_SECRET` 尚未配置,用前需配 key 并向用户确认) |
| 取用户在 Canva/Figma 里的设计稿、品牌规范 | `canva` / `figma`(插件,需授权) |
| 图片编辑加工(抠图/扩图等) | `adobe-for-creativity`(插件,需授权) |

优先级:选中的 Styleframe / VisualContract > 技术硬门槛 > 当前 profile(`docs/styles/`)> 镜头 recipe > 外部 skill 的通用建议 > 旧项目经验。外部 skill 与项目规则冲突时,以项目规则为准。

**Remotion 官方 skill 包**(`npx skills add remotion-dev/skills` 装于 `.devin/skills/`;整包安装因 skill 间有相互引用)——**当前 11 个,version 4.0.503,2026-08-02 全量更新**,清单以 `skills-lock.json` 为准。采用与否按上表;以下**明确不采用**,与项目规则冲突或形态无关:

- `remotion-create`:与"复用工程底座"约定冲突,新项目一律复制 `templates/remotion-base`,不走它的从零创建流程。
- `remotion-saas` / `remotion-multimedia`:面向 Player/Lambda/浏览器内多媒体的产品集成,本项目是本地出视频文件,用不上。(`remotion-multimedia` 就是旧 `mediabunny` 改名,旧目录已删除,不要再单独装回来。)
- `remotion-interactivity`:面向 Remotion Studio 可视化编辑(`<Interactive.*>`);本项目走自然语言反馈→改代码,不采用。它连带的"interpolate 内联到 style"写法也不采用,动画曲线仍抽到 `src/lib/anim.ts` 统一管理。

`remotion-upgrade` 采用但低频——升 Remotion 时跑它(`npx remotion upgrade` 会连带更新本地 skills)。**跑之前先向用户确认**:模板锁在 `4.0.490`,skills 已经是 `4.0.503`,升级会动 `templates/remotion-base` 和所有历史项目的 `build/`,属于要确认的操作,不要顺手升。

官方 skill 倾向 `interpolate()` + `Easing.bezier()`、弹簧作为特化选项;本项目的默认曲线仍在 `src/lib/anim.ts`,但弹簧是可选表达手段，不设默认次数或必用名额。`remotion-animation`(项目 skill)继续作为弹簧参数速查保留。

## 常用操作

```bash
# 新建项目(APFS 写时复制克隆:连 node_modules 和 webpack 缓存一起,实测 1.7 秒、几乎不占磁盘;
# 克隆出的工程首张 still 约 5 秒——缓存是热的。不要再用 rsync --exclude node_modules + npm install,
# 那条老路每个工程要多花 1–2 分钟)
cp -Rc templates/remotion-base/ projects/<name>/build
# 仅两种情况需要克隆后补 npm install:模板 package.json 改过还没重装;或目标在另一块卷上(cp -c 自动退化为普通复制)。
# 模板依赖变更后记得焐热缓存:在模板里 npm install 并渲一张 TypeSpecimen,此后所有克隆受益。
#
# ⚠️ **node_modules 的真身是 `node_modules.nosync/`,`node_modules` 只是指向它的符号链接。不要改回去。**
# 本仓库在 ~/Desktop 下,被 iCloud「桌面与文稿」同步接管。iCloud 会把同步目录里的文件驱逐成
# dataless 空壳(文件名和大小都在,内容不在磁盘上),Node 读到空文件就报一个看起来像 Remotion bug
# 的错(2026-08-28 实测:`withInteractivitySchema is not a function`,抽样 3000 个 js 有 1101 个是空壳,
# 另有 21712 个 iCloud 冲突副本「xxx 3.js」白占 356MB)。iCloud 不同步 `.nosync` 后缀的目录,
# 所以工具链放在那里就不会再被驱逐。
# **`npm install` 会把符号链接换成真目录(日志里的 `npm warn reify Removing non-directory`)**,
# 所以每次装完依赖都要复位:
#   npm install && rm -rf node_modules.nosync && mv node_modules node_modules.nosync && ln -s node_modules.nosync node_modules
# `cp -Rc` 克隆时符号链接照原样复制、克隆体内部自洽,已实测(克隆 6.7 秒,模块解析正常)。
#
# 排查空壳:`ls -lO <文件>` 带 dataless 标记即是;`du` 为 0 而 `ls` 有大小也是同一回事
# (量磁盘占用一律用 du,不能看 ls)。回填办法是把文件读一遍触发下载:
#   find <目录> -type f -print0 | xargs -0 -P 8 -n 200 cat > /dev/null
# assets/library/ 里的字体音效同样会被驱逐,**字体空壳会让渲染报「字体加载失败」**(fonts.ts 拒绝静默回退,
# 这是对的);iCloud 拉不回来时从 assets/library/fonts/ 拷一份覆盖过去。

# 渲染单帧检查画面(自查的主要手段)
# 自查帧一律 --scale=0.4:1080×1920 全分辨率读一张约 1844 tokens,0.4 约 442,
# 而本项目自己的门槛是「缩到 320px 宽仍可读」。全分辨率只留给三种帧:
# 选中的 sf-N.png、英雄帧、以及数字或眼睛已经起疑的那一帧。
npx remotion still DataExplainer --frame=120 --scale=0.4 frame.png

# Styleframe 不降分辨率(它是交付物、是用户唯一要看的东西、是所有镜头的验收基准)
npx remotion still DataExplainer --frame=120 styleframes/sf-1.png

# 口播 preset 镜：先判断继承/重建，不能对已批准回执无条件重跑预览
# 已批准视觉选择且 SHA 绑定有效：只校验并复用；不 expand、不重渲、不重新 confirm
node tools/validate-contract.mjs projects/<name>/visual-contract.json --require-preset-matching --preset-resolved --require-preset-artifacts
node tools/preset-preview.mjs projects/<name> --check-confirmed
# 以下展开/预览/确认仅适用于新候选或内容/props/preset版本变更；新版回原有变更审批
# 普通 preset-preview 会重写 pending/清空确认时间，不是只读检查。
# 纯搬迁 SHA 不变：按既有回执规则更新路径引用/映射并重验，保留确认，不重复询问。
node tools/expand-presets.mjs projects/<name>             # 槽位/估宽/版本校验 → 回填合同 → 落 props/signals/route(+并列候选 alt-*.props.json);在 validate-contract 之前跑
node tools/validate-contract.mjs projects/<name>/visual-contract.json --require-preset-matching   # B-roll 门:四字段匹配记录 + 非 remotion 引擎必须写 engineReason
node tools/preset-preview.mjs projects/<name>             # 每镜 0.4 时刻一帧真实文案 → preview/contact-sheet.png + .md + preview-manifest.json(v2 真实渲染绑定)
node tools/preset-preview.mjs projects/<name> --confirm "<用户原话>"   # 印张过目之后盖章;重渲预览会打回 pending
node tools/validate-contract.mjs projects/<name>/visual-contract.json --require-preset-matching --preset-resolved --require-preset-artifacts
node tools/build-recipe-index.mjs                         # 配方索引层(152 外部卡)重建;新增本地配方并填了 externalRef 之后跑
node tools/build-catalog-thumbs.mjs [--only <id>] [--force]   # 目录缩略图(合成 CatalogThumb,一次一个 id);渲完必须亲眼看图才许翻 verified
node tools/build-preset-menu.mjs                          # 任何 preset.json 变动后重新生成 docs/presets/MENU.md(上游现读的能力菜单)
node tools/build-asset-previews.mjs --only presets        # 新模板的**面板循环片**(缺了模板卡在控制台里不会动,只剩静图;
#   build-asset-browser.mjs 每次重建会自动补渲缺的,tests/preset-registration.test.mjs 拦漏。改了组件要 --force 重渲)

# 校验 VisualContract(候选合同渲图前、冻结合同派发 shot worker 前,各跑一次)
node tools/validate-contract.mjs projects/<name>/styleframes/sf-1.contract.json
node tools/validate-contract.mjs projects/<name>/visual-contract.json

# 字幕的二次编辑(用户自己改错字/断句/节奏 —— 优先给他这个,不要自己改 JSON)
node tools/build-asset-browser.mjs --serve      # → 「改字幕」区,选项目、改、拖、听、一键重新出片
node tools/lint-caption-script.mjs <项目>/caption-script.json --duration <音频秒>   # 命令行版校验(判据和面板同一份)

# 字幕层的两条命令 —— **迭代永远走第一条,不要渲 4K 去看效果**
# 2026-08-19 做 DSH 那支时,6 次 4K 渲染里 5 次是版式返工,光渲染烧掉 84 分钟;
# 换成下面这条,一轮 54 秒,而且能验出当时全部问题(越界/整块偏心/两行同侧)。
node tools/caption-iterate.mjs <项目名>          # 校验 → 低分辨率整片渲一次 → 逐块量像素 → 拼全片接触印张
#   印张:每块一格、只裁字幕带、画中线与安全区线 → <项目>/review/contact-sheet.png,交给用户过目
node tools/caption-finalize.mjs <项目名> --tag <名字>    # 印张盖章后才跑。画幅读脚本顶层的 canvas
#   **横屏片子在 caption-script.json 顶层写 `"canvas":{"width":1920,"height":1080}`**,版式自动切到
#   LAYOUT_LANDSCAPE(底边 88% / 字号 ×1.5 / 单行 62%);不写就是竖屏 1080×1920,历史脚本不受影响。
#   竖屏那套常数是从抖音竖屏逐帧标定来的,**照搬到横屏会让字小 44% 并浮在半空**,不要手改数字
#   要 4K 传 --scale 2(渲染时间 3–4 倍;成片导出 1080 的话没有画质收益)
#   只出两个文件:<tag>-hevc.mov(交付,带 alpha)+ <tag>-preview.mp4(带音预览)
#   ProRes 只作中间物,转完即删 —— 每轮留一份 2.5GB 母版是纯浪费,要留传 --keep-master
#   转码失败重跑加 --reuse-master,不必再等一次整片渲染

# ⚠️ **不要用 `npx remotion still` 逐帧抽字幕层**:实测单张 49 秒,其中约 45 秒是重新打包工程。
#    要看某几帧,从 caption-iterate 产出的 review/sweep.mp4 里 ffmpeg 抽,几秒钟的事。

# 控制台(用户唯一的操作入口:看资产 + 上传 / 清磁盘 / 体检 / 起 Studio / 调皮肤 / 查项目成片)
# 用户问"我有哪些资产/在哪管理/怎么加/磁盘满了"一律给这条,不要甩 markdown 表格。
# 任何资产变动(新字体/新音效/新组件/新模板/改了 KineticText 之类)后重跑一次即可刷新。
# 实现分三层:tools/lib/panel-scan.mjs(采集) + panel-api.mjs(写入,自带路径白名单) + panel-page.html(页面)
node tools/build-asset-browser.mjs --serve     # 生成 + 起本地服务(127.0.0.1:4321)+ 自动打开浏览器
node tools/build-look-thumbs.mjs --force      # 改了 looks.json 或加了新模板后重渲观感缩略图(7 模板 × 6 观感 = 42 张)
tools/build-thumb-smalls.sh                   # 渲了任何新缩略图后跑一次:压成面板用的 320px 小图
                                              # (原图 1MB/张是给用户过目的样张;面板卡片只需要 7KB/张)
node tools/build-asset-previews.mjs --force    # 只在运镜/文字出场/底纹的**代码**改了之后跑(重渲 12 段循环预览片)
node tools/build-library-previews.mjs         # 新下载 HDRI/PBR 材质之后渲样品球(控制台重建时会自动补缺的,
                                              # --force 用于改了 LibrarySample 合成之后重渲全部)
node tools/build-asset-previews.mjs --only presets --force   # 改了 preset 组件/皮肤/sample 文案之后跑
                                              # (8 段模板样例动效 → assets/previews/presets/,面板滚到即播)

# 本次升级(2026-08-20 的 A–H)的自动验收:目录/配方/音效/BGM/运镜/采集/剪映/控制台一次查完
node tools/verify-upgrade.mjs

# 网页采集(零配置:一个网址就够;截图必须落进项目 assets/ 才满足确定性)
node tools/capture-page.mjs --url https://example.com --out projects/<name>/assets/
node tools/capture-page.mjs --config capture.json --out projects/<name>/assets/   # 元素抠图 + layout.json

# 剪映工程导出(成片交付后问一次;这是交付后的可选项,不是新增停点)
tools/jianying/.venv/bin/python tools/jianying/export.py projects/<项目> [--name 草稿名]
tools/jianying/.venv/bin/python tools/jianying/export.py projects/<项目> --no-install   # 只生成不安装

# 声音:选音 / 卡点 / 回测(配了 BGM 的片子必跑这三条)
node tools/build-sfx-catalog.mjs                          # 音效库中文索引(新增音效后跑);181 条,ui/ 带逐条质感判定
node tools/beat-grid.mjs assets/library/bgm/<名字>.mp3     # 节拍网格:最小二乘拟合求真 BPM/相位,自带验收结论
#   验收不过 = 这首歌有变速或自由段,**不要卡点**。--bpm-range 可收窄搜索区间
node tools/verify-beat-sync.mjs <成片.mp4> <beats.json>    # 渲后回测:scdet 找硬切,量切点与网格的偏差,≤3 帧才过

# 排版配色样张(改了 src/lib/fonts.ts 或 color.ts 就渲它;也是定令牌时的参考图)
cd templates/remotion-base
npx remotion still TypeSpecimen --frame=60 review/type-60.png

# 组件样品册(改了 src/components/ 就渲这三个看一眼;Gallery 两页:f100 原样品页,f250 批注笔迹页)
cd templates/remotion-base
npx remotion still ComponentGallery --frame=100 review/gallery-100.png
npx remotion still ComponentGallery --frame=250 review/gallery-250.png
npx remotion still ContrastDemo     --frame=95  review/contrast-95.png
npx remotion still KenBurnsDemo     --frame=200 review/kenburns-200.png

# 实时预览(交给用户看时)
npm run dev

# 导出成品
npx remotion render DataExplainer ../out/final.mp4

# 客观校验产物(交付前必跑;宽/高为奇数会让编码失败或变形,这里会拦住)
# --codec/--pix-fmt 是编码检查:preset 快车道把逐帧审查降档之后,它是剩下的四道硬检查之一
tools/validate-output.sh projects/<name>/out/final.mp4 --size 1080x1920 --fps 30 --duration 8.5 \
  --codec h264 --pix-fmt yuv420p --audio none

# 画面诊断与源码技术检查（无密度或材质次数门槛）
# 合同用于诊断上下文，不派生首尾帧墨量下限
tools/check-density.sh projects/<name>/out/final.mp4 --contract projects/<name>/visual-contract.json
node tools/lint-shot.mjs projects/<name>/build/src/shots              # 字体/配色令牌、确定性与本地资源

# 关键帧诊断（无首尾帧墨量下限），须另做真实观看
# 量:墨量 / 明度层数 / 构图偏压 / 安全区外缘硬边 / 离板颜色 / 强调色面积
# 数字只作描述，不能替代关键帧目检和连续播放
node tools/frame-audit.mjs projects/<name>/shots/shot-003/keyframes/*.png \
  --contract projects/<name>/visual-contract.json

# 生产序列的四个工具(三个工作流共用,详见各自 SKILL.md 开头的 13 步表)
node tools/production-clock.mjs start --project projects/<name>       # 读需求就起表;贴 Styleframe 前 pause-selection
node tools/build-dispatch-manifest.mjs projects/<name>                # 校验合同 → 逐镜写 dispatch.md(每份只声明一个可写目录)
node tools/render-queue.mjs projects/<name>/render-queue.json --concurrency 2   # 只有浏览器正式渲染进队列
#   B-roll preset 批次追加 --require-confirmed projects/<name>/preview/preview-manifest.json(没确认不许渲)
node tools/validate-review.mjs projects/<name>/review.json            # 交付前的结构化评审门禁

# 给某一镜路由知识(派 shot worker 前必跑,输出写进 shots/shot-<NNN>/dispatch.md)
node tools/route-knowledge.mjs hyperframes ui,shader     # → visual-first.md + 最多 4 条动态资源
node tools/route-knowledge.mjs remotion data,chart
node tools/route-knowledge.mjs hybrid caption,shader     # hybrid = 两个引擎的并集,仍截到 4 条

# 在图上定位目标(圈注/箭头/推镜焦点)——四步循环,每步之间用 Read 看图
node tools/locate.mjs overlay <图> --out <目录>          # 读 gv.png/gh.png 挑条带号
node tools/locate.mjs region  <图> --vids .. --hids .. --out <目录>   # 读 gc.png 再挑一次
node tools/locate.mjs final   <图> --region .. --vids .. --hids ..   # 得到 box/center
node tools/locate.mjs mark    <图> --box .. --out <目录>/check.png    # 必做:读它验证

# 逐镜路由引擎(合同冻结后、派 shot worker 前;signals.json 是十一个 0/1/2 信号)
node tools/route-shot.mjs projects/<name>/shots/shot-003/signals.json \
  > projects/<name>/shots/shot-003/route.json

# 规范化 + 拼接(任何引擎的产物都要先规范化;normalize 自带 ffprobe 自检)
tools/normalize-shot.sh <引擎原始产物> projects/<name>/shots/shot-003/shot-003.mp4 1080 1920 30 none
tools/concat-shots.sh projects/<name>/out/final.mp4 projects/<name>/shots/shot-*/shot-*.mp4
```

本机已装 ffmpeg / ffprobe / jq(homebrew)。注意这个 ffmpeg **没编译 `drawtext`**,任何依赖该滤镜的脚本都会直接失败——`tools/locate.mjs` 因此改成纯 JS 像素绘制,ffmpeg 只负责编解码。
