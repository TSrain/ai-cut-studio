# Visual-First Operating Contract

Package 规则唯一准源：../workflow/docs/complete-package-contract.md（本文件不重复）。

## 独立真实素材分支（real-footage-v1）

收到 phase=footage 或 real-footage-v1 合同时，主仓库 `../workflow/.devin/skills/content-footage/SKILL.md` 与 `docs/real-footage-contract.md` 为运行准源；这里只执行工程技术校验和应用，不走下方动画创作／Styleframe／旧分镜批准。project/source/canvas、共享 SRT、审稿清单与媒体 hash 校验后，全部可用候选加入项目素材库，推荐自动追加独立静音素材轨道。完整原片保留，横屏 UI 用原生 contain 完整显示并以不透明背景承托；不拉伸、循环、定格、裁掉关键 UI，也不把旧 overlay 的 Alpha 要求套到真实原片。

保留所有旧动画/模板/素材/主视频/字幕/音轨/镜头/封面、手调、锁定与显隐；同候选同目标幂等，删除/忽略/撤销不恢复，新版本独立，并发重读 CAS，不加公共库。

kind=footage 的 placementId=null 表示项目候选，有 placement 表示按真实 SRT/source.clips 定位的推荐；不出现旧镜头／槽位／位置批准。输出逐段审稿、报告与全部候选清单。技术、抽帧、连续观看、听审和最终采用分开；这条支线不执行镜头推拉、字幕、封面与声音。独立素材 worker 到此 return，不进入后续动画序列。

## 独立动画与历史合同规则

以下仅用于独立动画或明确历史合同续作；当前 package 按顶部唯一合同执行。

## 自主设计要求

package/broll 与 motion-broll 先执行 `../workflow/docs/animation-design-standard.md`：理想画面先于模板匹配，模板与定制并列说明，用户无需提供参考片。镜头先写具体对象、起始 → 变化 → 结束与口播锚点，再比较语义关系、对象结构、构图、运动、节奏和风格；模板/定制差距、收益、推荐与风险进入原审批。原技术门禁和内容审批继续执行；时限用于报告进度，未达标输出须标草稿与缺口，不能以分数替代实际观看。

每次会话都加载的短合同。它规定**怎么决策**,不规定怎么实现某个效果——后者在 profile、recipe 和组件目录里。
与任何旧文档冲突时,以本文件的优先级链为准。数值来源:`docs/superpowers/specs/2026-08-01-visual-first-dual-engine-design.md`。

一句话立场:**先有画面,再有工程。** 用户看到的是帧,不是文件合同;工程正确只是不翻车的下限,不是交付理由。

## Priority Order

冲突时从上往下裁决,上面的赢:

1. **选中的 Styleframe 图 + `visual-contract.json`** —— 用户看过图并选了,成片就该长成那样。
2. **技术硬门槛** —— 可渲染、偶数尺寸、时长/帧率/SRT 覆盖、确定性、事实正确、核心文字可读。
3. **当前 visual-first profile** —— `docs/styles/visual-max.md` / `editorial-luxe.md` / `brand-energy.md` / `data-cinematic.md`。
4. **镜头 recipe** —— 每镜最多加载 2–4 条。
5. **外部 skill 的通用建议** —— `frontend-design`、`hyperframes`、`remotion-*`、`motion-design`。
6. **旧项目经验** —— `memory/taste.md`、历史项目里的具体做法。

`docs/design-principles.md` 不再拥有压过 VisualContract 的审美优先级:它的确定性 / 输出规格 / 可读性条款留在第 2 层,
它的克制条款降为第 3 层的 profile 默认值,可被合同显式覆盖。

**下面这些从"全局硬限制"降为"合同默认值"**,合同可以覆盖,覆盖后不必再向用户解释:

| 旧硬限制 | 现在的默认值 |
|---|---|
| 8 秒最多 4 个视觉事件 | 节拍由口播与理解负荷设计，不设固定数量上限 |
| 每时刻仅一个焦点 | 一个主焦点 + 最多两个次级锚点 |
| 单一强调色相 + 面积上限 10% | 一个主色 + 最多两个辅助色;强调面积默认 10%–35% |
| 色彩必须编码信息 | 也可以表达品牌、情绪、能量、材质和空间 |
| 禁止环境光斑 / 辉光 / Bloom | 允许,只要不损害文字对比和主焦点 |
| 同屏最多三级字号 | 三个**主要语义层级**;微型元数据豁免 |
| 最多两个字体角色 | 两个**主**角色;小范围 mono / decorative 豁免 |
| 商务风格禁弹簧 | 弹簧为可选表达手段，不设默认次数或必用名额 |
| 动画结束必须全静止 | 文字要有阅读停留,背景可保持低强度运动 |
| 不许手写颜色 | 颜色在 VisualContract 里声明一次,组件只消费 token |

**支持边界**(超出就拆批次,批次间共享同一份合同和连续锚点):

| 项 | 值 |
|---|---|
| 总时长 / 镜头数 | ≤30 秒,或 ≤6 镜 |
| 单镜时长 | 3–15 秒 |
| 默认画布 | 1080×1920,30fps(其他尺寸由 brief 指定,宽高必须偶数) |
| 音轨 | 最多一条主音轨;默认不合成音轨 |
| 活跃生产时间 | 60分钟参考预算(不含用户等待)，仅提示成本 |

## Required Artifacts

```text
projects/<yyyy-mm-dd>-<name>/
├── brief.md                    表达目标 / 观众 / 场景 / 画布时长 / 素材策略 / 假设
├── storyboard.json             机器可读分镜(镜号、时长秒、语义节拍、视觉目标)
├── storyboard.md               人读分镜表
├── visual-contract.json        冻结的合同,所有 worker 的只读输入
├── proposals.md                三张 Styleframe 的路径 + 隐藏设计摘要 + 用户选择及时间
├── assets.md / assets/         素材登记与本地缓存
├── styleframes/
│   ├── sf-1.png  sf-1.contract.json
│   ├── sf-2.png  sf-2.contract.json
│   └── sf-3.png  sf-3.contract.json
├── shots/shot-001/             route.json / dispatch.md / source/ / keyframes/ / review.json / draft.mp4
├── continuity.json             相邻镜头的首尾锚点
├── build-log.json              各阶段开始、结束、降级事件
├── review.md                   视觉与连续性审查记录
├── out/final.mp4
└── DELIVERY.md
```

`proposals.md` **不再是三个文字提案**,它只记录三张图的路径、每张的隐藏设计摘要和用户的选择。
用户选择前不展示冗长文字计划。并行 agent 的完成标准是**目标文件存在并通过校验**,不是它口头说完成了。

## Three Real Styleframes

所有直接面向用户的任务,在写完整分镜和镜头代码之前,必须先产出三张可视 Styleframe。协议全文见 `docs/styleframe-protocol.md`。

- 用**真实文案、真实中文字体、目标比例、真实素材**渲染;不是 moodboard、线框、文字描述或色卡。
- 三个方向必须在**构图、字体、材质、运动设想**四项上同时拉开,不是同一方案的调参。
- 默认三向:`Brand Impact`(大字/品牌资产/强色块/英雄构图)、`Editorial Cinematic`(摄影/拼贴/衬线/编辑版面/镜头运动)、
  `Digital Spectacle`(UI/数据/网格/玻璃/3D/Shader/Kinetic Type)。
- 每向产出 `styleframes/sf-N.png` + `styleframes/sf-N.contract.json`。
- 三张至少用到**两个不同的中文 typography kit**(品牌规范锁死字体时例外)。
- **用户只看图、只选一次**,可以选一张,也可以指名混合哪些特征。选完冻结合同。
- 之后只有"推翻整体方向"级别的反馈才允许重新进入 Styleframe 阶段;其余反馈直接改画面。
- `motion-srt`:全片做一轮代表性选择,每镜继承同一份合同,不逐镜询问。
- `motion-broll`：**最佳效果先行，模板方案并列**。先设计每镜对象、起始→变化→结束与口播关系，再现读 `docs/presets/MENU.md` 比较六项表达和实际效果；模板同等最好时可推荐，不强制定制。
  `presetCandidates` 记录比较，`selectedPreset` 记录所选原生模板；定制为 null，`unmatchedReason` 解释本次未选原因而不必谎称模板不可用。候选存在不免设计、不授权切换路线。
  已选原生 verified preset 用真实文案 Preset Preview 与批次印张，免三向探索；视觉方向未定的 custom 仍出三图，即使有合适模板。适合的模板对照可与定制候选同步展示，一次视觉选择，不自动渲两套最终视频。
  带冻结合同直接继承设计、实现路线与视觉选择，不重匹配覆盖 custom；无交互任务沿既有自动选择授权执行并留痕，不能因子代理无人就跳过上游用户审批。

## VisualContract

`visual-contract.json` 是所有 worker 的共享只读输入,schema 见 `docs/visual-contract.schema.json`,
校验命令 `node tools/validate-contract.mjs projects/<name>/visual-contract.json`。字段:

| 字段 | 内容 |
|---|---|
| `version` / `project` / `mode` | `1` / 项目 slug / `"visual-first"` |
| `canvas` | `width`(偶)、`height`(偶)、`fps`、`durationSeconds` |
| `density` | `target`(1–10)、`occupancyMin`、`occupancyMax`、`layerCount` |
| `focus` | `primary` 一个 + `secondary` 最多两个 |
| `palette` | `mode`、`dominant`、`support[]`、`accent[]`、`surfaces[]` |
| `typography` | `kit` + `displayRole` / `bodyRole` / `dataRole` |
| `material` / `background` / `motion` / `transition` | 材质信号、背景系统、运动性格与可选弹簧设计、转场语言 |
| `assets` | `allowBrandLogos` / `allowScreenshots` / `allowUnknownNetworkImages` / `cacheSelectedLocally`,四项均为 `true` |
| `facts.mode` | `exact` 或 `illustrative` |
| `shots[]` | 每项 `id`、`durationSeconds`、`engine`、`objective`、`startAnchor`、`endAnchor` |

**颜色在合同里声明一次,组件只消费 token。** 缺字体套装、镜头引擎、画布或连续锚点时**不得派发 shot worker**。
子 agent 不得自行修改合同;需要改动时回报视觉导演,由导演改并重新校验。

## Engine Routing

路由单位是**镜头**,不是项目。同一个项目里 Remotion 镜和 HyperFrames 镜可以并存。

| 选 Remotion | 选 HyperFrames | 选 Hybrid |
|---|---|---|
| 字幕、配音、逐帧节拍、毫秒级时长 | 网页截图、产品网站、App 界面、DOM 重构 | 同一镜既有强视觉层又有精确字幕/数据层 |
| 真实数据绑定、数字计算、图表 | Kinetic Typography、GSAP 时间线、复杂遮罩与文字变形 | HyperFrames 出背景/UI/3D/Shader 层 |
| 跨镜位置、颜色、元素延续 | WebGL、Shader、3D、液态玻璃、粒子 | 输出规范化 MP4,必要时带 alpha 图像序列 |
| 长序列、复杂 `<Sequence>` 编排 | Registry 已有高度匹配的 block | Remotion 做最终文字、字幕、数据、时间与拼接 |
| 需要作为最终集成层叠加多来源 | 视觉表现需求高于数据/字幕精度 | 仅当两引擎得分都高且差值在阈值内 |

Hybrid 是例外,**不得为了"两个引擎都用到"而选它**。所有镜头在拼接前统一为:合同指定的偶数宽高、30fps(除非合同覆盖)、
不透明镜为 H.264 High Profile、`yuv420p`、无音轨(除非合同声明)、timebase / SAR / 色彩标记一致、文件名 `shot-<NNN>.mp4`。合同声明 `presentationMode: overlay` 的透明镜改用 ProRes 4444 / Alpha MOV，由 `tools/normalize-overlay.mjs` 保持透明；不得为统一 MP4 而丢失 Alpha。

### 图表镜:先判观看场景,再决定标注密度

**正确性规则的准源是 `docs/chart-rules.md`**(选形 / 坐标与比例诚信 / 颜色编码 / 动画图表的坑 / 六检),
带 `data` 或 `chart` 标签的镜自动路由到它。下面这张表只管**标注密度**,画之前先分类:

| 场景 | 判据 | 标注密度 |
|---|---|---|
| **口播插片** | ≤30 秒,观众看一遍就过 | **最低**。最大字号承担当前节拍的信息、锁版承担结论;图表只负责作证。**不上样本量、来源、轴起点说明** |
| **独立解释镜** | 观众会停下来读 | 中等。可以多标注 |
| **仪表盘 / 长图表** | 需要反复查阅 | 完整报告规范 |

**三种场景下 `docs/chart-rules.md` 的正确性规则一律保留**(单轴、系列色固定顺序、坐标方向、比例诚信、不用彩虹渐变映射数值);
**变的只是标注密度,不是正确性**。

2026-08-03 教训:round-01 案例 03 把仪表盘规范照搬进 10 秒插片,五个数值印两遍、差值印三遍、加 `n=5` 脚注,盲评排第 3。

## Typography

字体套装是**显式输入**,不是库存里的可选项。合同必须写死 `typography.kit`。

| kit | 中文 | 拉丁 / 数字 | 性格 |
|---|---|---|---|
| `impact` | Smiley Sans 得意黑 | Archivo | 品牌冲击、大标题 |
| `editorial` | Noto Serif SC | Instrument Serif | 编辑、文化、权威 |
| `human` | LXGW WenKai 霞鹜文楷 | Inter | 人文、叙事、温度 |
| `modern` | Noto Sans SC | Archivo / Inter | 科技、产品、现代商业 |
| `tech-data` | Noto Sans SC | JetBrains Mono / Archivo | 数据、代码、界面 |

- `theme.font.family` 已删除;新代码不得把 `FONT.text` 当全局字体。
- `textStyle()` 必须同时接收 **kit 和 style role**;可复用文字组件必须接收 typography context,不许在组件内部暗选默认字体。
- 一支片子两个**主**角色(展示 + 正文);小范围 mono / decorative 豁免。
- 同屏三个**主要语义层级**;微型元数据(眉题、署名、单位、时间码)不计入。
- 自动检查字体文件是否加载,视觉检查实际中文字形。**审查发现中文回退到默认字体时不得通过。**

## Assets

按用户明确选择,素材政策是放开的:

- **允许**真实品牌 logo、网页截图、来源不明的网络图片。
- **不因**版权、商标、来源或署名状态**阻塞**视觉演示。`assets.md` 可以记录来源,但该字段是元数据,不是交付硬门槛。
- 选中素材后**立即下载到项目 `assets/`,用本地路径参与渲染**。缓存是为了确定性和重渲,不代表使用审批。
- 素材搜索仍走两极查询(原子式 1–3 词 / 具体式 5–15 词),仍然不许拿第一个结果,每条需求过一遍"用 / 备选 / 弃"。
- 付费外部生成(万相文生图、Runway 等)保留既有的费用确认规则:生成前报张数、内容与预估费用。这是既有授权,不是新增确认点。
- 事实正确仍是硬门槛:演示界面可以用虚构数字,但合同必须写 `facts.mode: "illustrative"`,不得让演示数字伪装成真实结论。
- **`facts.mode: exact` 只约束内部事实,不要求把审计信息全部上屏。** 它的含义是:数据不得篡改、不得乱算、不得用虚构的中间值。
  它**不**意味着必须显示样本量、数据来源、完整量纲说明或轴起点注释 —— 那是论文与仪表盘的规范,口播插片照搬会挤掉结论(round-01 案例 03 的实测教训)。
  **但简化不能以误导为代价**,两条底线保留:①**单位至少完整出现一次**;②**Y 轴若从非零起,必须有可感知的断轴符号,或者直接改用零基线** —— 截断且不标记就是骗人,比脚注冗余严重得多。

## Parallel Work

| 角色 | 数量 | 写入范围 |
|---|---|---|
| `visual-director` | 1,主 agent,不下放 | 全项目;唯一能改合同的人 |
| `styleframe-worker` | 3,并行 | `styleframes/sf-N.*` |
| `shot-worker` | 一镜一个 | `shots/shot-NNN/` |
| `asset-scout` | 并行 | `assets/`、`assets.md` |
| `visual-reviewer` | 按需 | `shots/*/review.json` |
| `continuity-reviewer` | 按需 | `continuity.json`、`review.md` |
| `integrator` | 主 agent 兼任 | 规范化、拼接、最终校验 |

**并行限制只作用于真正吃内存的浏览器正式渲染:队列默认并发 2,内存不足时降为 1。**
方案、素材、代码、审查一律并行,不得因为渲染队列的并发上限而减少镜头范围或串行思考;超出并发数按波次处理。

## 60-Minute Budget Checkpoints

| 活跃时间 | 阶段 | 退出条件 |
|---|---|---|
| 0–6 分钟 | brief / 粗分镜 / 三份候选合同 | 三个 worker 收到完整 dispatch |
| 6–15 分钟 | 三个 Styleframe 并行 | 三张真实 PNG 可供选择 |
| 用户等待 | 暂停计时 | 用户选中,或非交互任务自动选择 |
| 15–20 分钟 | 冻结合同 / 路由 / 连续锚点 | `validate-contract.mjs` 通过 |
| 20–40 分钟 | shot worker 并行构建 | 每镜有首中尾关键帧和 draft |
| 40–48 分钟 | 视觉与连续审查 + 一轮集中修复 | 修复后重看；未过记录草稿与缺口 |
| 48–56 分钟 | 正式渲染 / 规范化 / 拼接 | `final.mp4` 生成 |
| 56–60 分钟 | 抽帧 / 时长 / 资源校验 | 所有硬门槛通过 |

预算检查点：第 15/30/45/50 分钟检查已完成内容、风险与剩余成本，优先修实际问题、减少无关工作；换引擎或复用组件须保留批准的对象、关系与状态变化。时限、修复轮数和渲染失败均不授权自动降低表达或改风格。
超过60分钟只记录预算变化与瓶颈，继续按批准方案制作和修复，不自动判质量失败。无法继续交当前草稿、未验收范围、缺口与下一步，不称完成。每阶段开始、结束、修复与实现调整写进 `build-log.json`。

## Visual Score

| 维度 | 权重 |
|---|---:|
| 构图、焦点和第一眼冲击 | 20 |
| 字体个性和排版层级 | 15 |
| 视觉密度、空间和细节 | 15 |
| 动效节奏与镜头组织 | 15 |
| 材质、色彩和独特性 | 15 |
| 内容清晰度和事实正确性 | 10 |
| 跨镜头连续性 | 10 |

通过标准:**总分 ≥80;任一主要维度 ≥6/10;英雄帧主观评分 ≥8/10;`technical` 五项全 `true`。**
四条彼此独立,任一不过即 FAIL。分数与技术通过只是门禁，不能代替全部交付镜头的真实连续播放、内容/口播节奏和 overlay 的真实口播合成检查；verified 仅复用技术审计，不免本次观看。keyframes-only 不渲 MP4，明确动态未验收。分数落成 JSON 才是门禁——散文 review.md 照写,但拦不住"整体不错,可以交付"这种句子:

```bash
node tools/validate-review.mjs projects/<name>/review.json    # 格式与七个维度键见 docs/visual-scorecard.md
```

另外:320px 缩略图能认出主焦点；每镜检查首、中、尾三帧与真实连续播放。
`tools/check-density.sh` 与 `tools/frame-audit.mjs` 仅记录墨量、明度层数和构图指标，不以首尾帧下限、占屏率或最低材质种类判失败。入场、退场、留白和叠层按批准表达与真实合成验收。

客观脚本继续跑:`tools/validate-output.sh`、`tools/check-density.sh --contract`、`node tools/lint-shot.mjs`、
`node tools/validate-contract.mjs`、`node tools/validate-review.mjs`,以及 typography kit 与 engine normalizer 校验。
逐镜像素评分由 `docs/subagents/visual-reviewer.md` 出,跨镜边界由 `docs/subagents/continuity-reviewer.md` 出。

## Forbidden Regressions

以下六条出现即回归,发现就地改正并在 `review.md` 记一行:

1. **纯文字提案** —— 用三段文字描述代替三张真实渲染图让用户选。用户选的是画面,文字提案没有信息量。
2. **隐式字体回退** —— 不写 kit、用 `FONT.text` 当全局字体、或让中文静默落回 Noto Sans SC。字体库存不产生输出差异就等于没有。
3. **Remotion-only 路由** —— 因为"模板在这儿"就把截图、Kinetic Type、Shader 镜也塞给 Remotion。路由按镜头需求判断。
4. **因渲染内存而串行思考** —— 并发上限只约束浏览器正式渲染队列(2),不约束方案、素材、代码和审查的并行,更不允许因此砍镜头。
5. **版权阻塞** —— 用"版权不明"卡住素材、画面或交付。来源是非阻塞元数据;真正的硬门槛是事实正确和本地缓存。
6. **把极简当超时降级** —— 时间不够就交一张空画面并称之为"极简风格"。极简是需要被选中的视觉方向,不是缺省退路;
   没有任何一个 profile 叫 safe / restrained / fallback。

7. **为了不平庸而不平庸** —— 无承接或无寓意的斜排/旋转、把本该在一起的信息拆开的分屏、纯装饰的字符墙。
   判据是「观众不看解释能否感知这个变形在表达什么」;**同方向装饰和代码注释都不算证明**。
   评审时做反事实删除测试:恢复普通排版后理解与情绪都不受损,就删掉它。详见 `docs/typography.md` §5.5。
   注意这条**不禁止**任何具体手段,也**不存在「中文默认居中」** —— 约束的是理由,不是形式。
