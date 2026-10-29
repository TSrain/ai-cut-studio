---
name: motion-broll
description: 用于自媒体工作流 content-package/content-broll 的跨仓库派发，或用户按逐镜需求单批量制作口播插片、关键帧与逐镜成片。支持 keyframes-only 和 render-final-shots。
---

# motion-broll — B-roll 批量模式

Package 规则唯一准源：../workflow/docs/complete-package-contract.md（本文件不重复）。

## 独立真实素材分支（real-footage-v1）

收到 phase=footage 或 real-footage-v1 合同时，主仓库 `../workflow/.devin/skills/content-footage/SKILL.md` 与 `docs/real-footage-contract.md` 为运行准源；这里只执行工程技术校验和应用，不走下方动画创作／Styleframe／旧分镜批准。project/source/canvas、共享 SRT、审稿清单与媒体 hash 校验后，全部可用候选加入项目素材库，推荐自动追加独立静音素材轨道。完整原片保留，横屏 UI 用原生 contain 完整显示并以不透明背景承托；不拉伸、循环、定格、裁掉关键 UI，也不把旧 overlay 的 Alpha 要求套到真实原片。

保留所有旧动画/模板/素材/主视频/字幕/音轨/镜头/封面、手调、锁定与显隐；同候选同目标幂等，删除/忽略/撤销不恢复，新版本独立，并发重读 CAS，不加公共库。

kind=footage 的 placementId=null 表示项目候选，有 placement 表示按真实 SRT/source.clips 定位的推荐；不出现旧镜头／槽位／位置批准。输出逐段审稿、报告与全部候选清单。技术、抽帧、连续观看、听审和最终采用分开；这条支线不执行镜头推拉、字幕、封面与声音。独立素材 worker 到此 return，不进入后续动画序列。

## 独立 motion-broll / 明确旧合同续作

以下仅用于独立动画或明确历史合同续作；当前 package 按顶部唯一合同执行。

历史逐镜制作步骤如下。

口播声音同读 `docs/sound-design.md`。上游 soundDesign 原样继承；制作时记录可听动作对应的实际本地事件时刻，交 broll 合并为独立音轨。模板默认配方见 tools/editor/sound-recipes.mjs，本期 silence/cues 优先，不能只因套了模板就强加声音。关键帧阶段只冻结声音意图，不渲音轨；镜头视频默认不烧 SFX，避免与编辑台声音轨重复。
不设置首尾帧最低墨量、最低材质种类、默认弹簧次数、固定语义节拍上限，不因计时/重试自动降质。密度与运动参数只描述本期设计，不作为默认必达额度；实际表达以批准方案和真实播放验收为准。60 分钟只作预算提示，不冻结范围、不自动判质量失败。

> **本 skill 经常由外部项目(自媒体工作流的 `$content-package` / `$content-broll`)派子代理调用,此时 cwd 不在本仓库。**
> 所有本仓库内的路径一律用绝对路径 `../studio/...`,或先 `cd` 进本仓库再用相对路径。
> 下文的 `tools/`、`docs/`、`templates/`、`projects/` 都相对本仓库根目录。

为口播视频生产通常 3–15 秒的**插片**（实际时长以批准合同及真实口播为准，不为凑范围延长或裁短）(B-roll):数据图表、流程示意、概念对比、数字滚动、金句卡、转场等图形化表达。

开工前读 `../workflow/docs/animation-design-standard.md`、`docs/visual-first.md` 和 `docs/styleframe-protocol.md`。

## 4358 工程接入与透明叠层

通过制作计划任务调用时，读取上游不可变工程快照中的当前需求、稳定 shotId/slotId、裁剪后真实时长和批准记录。这里的非交互命令仍有人在 4358 等待审批：缺分镜批准或视觉选择时返回 waiting_approval / waiting_selection 与实际候选路径，不能按“无人批次”自行盖章。每镜完成就按上游结果协议回传；技术检验与对照计划的内容核验分别记录。

`presentationMode: overlay` 优先于下文普通 MP4 示例：

- 从首次渲染就保持透明背景；Remotion 使用 `--codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png` 输出 MOV。HyperFrames 不能保持 Alpha 时返回该镜阻塞，不能输出黑底 MP4 冒充透明。
- 用 `node tools/normalize-overlay.mjs <raw.mov> <new-version.mov> <width> <height> <fps> none` 保持合同画幅及 Alpha。画幅比例不符须重新构图；工具拒绝覆盖原件。普通 normalize-shot 遇 Alpha 也会保护性路由，输出 MP4 时明确报错。
- `tools/validate-output.sh <file.mov> --size <WxH> --fps <fps> --duration <seconds> --dur-tol 0.1 --codec prores --pix-fmt yuva444p12le --audio none`；实际 ffprobe 可能报告其他 yuva 位深，必须记录实测值并确认真实 Alpha，不能按扩展名通过。
- 交付原透明 MOV、关键帧及真实主口播合成预览。4358 另建 WebM 透明预览镜像，导出继续用原 MOV；预览文件不取代原件。首中尾查看人物、字幕、关键内容区域，透明不代表整张背景半透明。

不透明 immersive 镜继续走下文 H.264 / yuv420p 路径；无录音的 keyframes-only 不渲任何最终视频。

## 提前时间、镜头与人物分层设计

读取当前有效计划的 `effectTiming`、`cameraIntent`、`presenterLayerIntent`，不得以旧 package 覆盖它们。口播关联区间不等于动画占用区间；package 设计入场、变化、停留和退场，broll 校准真实事件。手动区间和已剪短的实际实例优先，不能用整段字幕时长拉长动画。未确认时间保持草案，缺审批时通过原流程等待确认。

`cameraIntent` 在 package 先确定推拉/切换的表达目的、语义锚点和起止景别，broll 使用最终节奏落实为现有可编辑 `source.cameraPlan`；技术可行性或录制变化需要修改设计时明确记录，不能因制作方便略过。

人物背后文字是可选强调方式，可用于关键数字和观点，不强制每处使用。批准采用时读取 `docs/presenter-layer.md`，用 `tools/presenter-foreground.mjs prepare` 准备与底片 SHA 和源帧绑定的本地透明人物序列，再用 `attach --out` 生成独立文档候选。通过既有工程保存/修订校验回写当前项目，不能直接覆盖活动工程文件。文字仍在原实例中可编辑，完整合成顺序为原底片 → 透明文字/动画 → 人物前景。使用完整合成预览和导出验证边缘与可读性；技术通过不等于质量通过，不能静默改为普通前置文字。没有实际前景或超出准备区间时报告缺口。

## 外部两阶段调用合同

新制作执行 `../workflow/docs/visual-design-contract.md` 的 v1 协议：顶层 `designIntentVersion: 1`，视觉制作镜条目的 `designIntent`（goal、concept、states、beats、focus、presenterRelation、templateOptions、customOption、recommendation、acceptance、risks）从需求单逐字保留到冻结合同与回执。真实秒点另存，不改 `beats.anchor`；仍填写原 presetCandidates/selectedPreset 等路由字段。旧合同不强制补字段，不能以旧合同兼容豁免新制作。

自媒体工作流通过需求单顶层的 `dispatch_phase` 明确本次只做设计，还是按真实时长出成片。两阶段共用同一个批次目录和 `visual-contract.json`，不得各自重做风格。

### `keyframes-only`：完整设计与逐镜关键帧

用于 `$content-package`。有绑定的主视频与共享 SRT 时继承效果时间草案；只有脚本时继承语义锚点，不估计绝对秒数：

1. 继承已批准的设计与实现路线；缺视觉选择时走“只出候选”，把定制 Styleframe 与适合的模板真实预览合并交上游一次选择。是否有模板候选不决定是否需要定制设计。
2. 上游把选择结果带回后，冻结 `visual-contract.json`，运行 `tools/validate-contract.mjs`，再逐镜路由 Remotion / HyperFrames / Hybrid。
3. 每个需要动效、运镜或录屏包装的镜至少渲一张代表关键帧；定帧时刻取需求单的 `keyframeMoment`，路径写进返回清单。preset 镜的关键帧必须来自 `tools/preset-preview.mjs` 的 Remotion still 结果或其同 SHA 复制件，不能另画一张 PNG 顶替。
4. 返回冻结合同、逐镜关键帧 PNG、preset/custom 判定、引擎和设计摘要。keyframes-only 回执若包含 preset 镜，必须写 `presetPreviewManifest:<P>/preview/preview-manifest.json`，并把 manifest、still、props、route、signals、关键帧全部列入 `files[]` 及 SHA。**本阶段不渲 mp4、不做成片规范化，也不把估算时长写进最终动画。**

### `render-final-shots`：真实时长逐镜成片

用于 `$content-broll`，需求单必须带已经通过校验的合同、每镜三位小数真实时长，以及相邻镜信息：

- `transition_in` / `transition_out`：匹配切、动作切、硬切、声音先行或无；
- `startAnchor` / `endAnchor`：画面主体、位置、运动方向和能量状态；
- `previousShot` / `nextShot`：相邻镜一句话摘要，避免每镜各做各的。

先校验并继承上游 `visual-contract.json` 的设计、已选路线与视觉选择，不重跑 Styleframe，不以重新匹配 preset 覆盖已批准 custom。真实时长仅用于对齐和实施；发现路线无法实现时回报具体缺口，不静默换方案。逐镜完成首/中/尾关键帧、`draft.mp4`、规范化、`--dur-tol 0.1` 输出校验和视觉评审；连续镜按顺序交给 continuity reviewer，结果写 `continuity.json`。相邻边界失败只返修边界两侧镜头。最终返回逐镜 MP4、每镜代表关键帧、合同与全部验证结果，不在本模式拼整条片。

## 第一件事:设计理想表达，再比较 preset 与定制

**先逐镜写具体对象与关系、起始状态 → 关键变化 → 结束状态及对应口播锚点，再现读 `docs/presets/MENU.md`，比较语义关系、对象结构、构图、运动过程、口播节奏与视觉风格。**
每镜在分镜/brief 中写模板可保留的表达与缺失动作、定制收益与制作负担、推荐和风险，并带入冻结合同与后续派发；沿用上游整批内容审批，不自动制作两套视频。简单完整适配可简写并推荐模板；达到同等最佳效果时无需硬造定制。核心镜头内部比较两种不同表达，以效果选推荐，制作速度只是附带取舍。用户无需提供参考片；陌生题材由 agent 按需查找并实际查看公开作品或专业资料，记录来源和可迁移手法，未查看则标未核验。
匹配结论必须落进合同的每个镜条目,四个字段一个都不许省:

| 字段 | 含义 |
|---|---|
| `presetCandidates` | 实际比较过的 preset ID；有候选不代表已选，也不免除理想画面设计 |
| `selectedPreset` | 本次所选原生模板 ID，并配套 `preset:{id,version}`、`presetProps`；定制或未选定时为 `null` |
| `matchReason` | 所选模板如何完整达到六项表达与质量目标，仅在 selectedPreset 非空时写 |
| `unmatchedReason` | 本次未选原生模板的真实原因：能力差距、定制收益或用户选定路线；可同时有合适模板候选，不得虚构“模板不支持” |

`node tools/validate-contract.mjs <P>/visual-contract.json --require-preset-matching` 检查现有字段。模板候选写 `designIntent.templateOptions` 与 `presetCandidates`；推荐写 `designIntent.recommendation`，冻结合同记录用户实际批准路线。**候选 ≠ 推荐 ≠ 已选**。需要通过旧 `presetAlternatives` 工具渲模板对照时，只在独立的候选预览合同中暂挂候选 preset；不可据此改写已批准正式合同。
槽位适配是技术条件。完整匹配且效果同等最好时可推荐模板；仅“能用”、省事或 verified 不足以胜过效果更好的定制。修改组件或增加动作按 custom 制作，可复用组件，不冒充原 verified preset。2.5D、透视和复杂镜头都按内容需要选择，不作为通用质量捷径。

### 按所选路线制作

| 路线状态 | 怎么走 |
|---|---|
| **已选原生 verified preset** | 填本次真实文案素材 → 槽位校验 → 0.4 时刻 Preset Preview → 批次接触印张及既有视觉确认 → 视频。此路线不出三张 Styleframe、不派实现 worker、不写新 TSX；仍检查本次效果。 |
| **模板/定制仍待选择** | 先按最佳效果提出推荐，同时展示能满足的模板方案与具体差异；适合比较时同步渲真实模板预览和定制候选，同批确认。不自动做两套最终视频。 |
| **已选 custom，视觉方向未定** | 即使存在合适模板，也走三张不同方向的 Styleframe → 一次视觉选择 → 定制全流程；不能因有候选跳过设计。已选视觉方向则直接继承，不重复询问。 |

已选原生 draft preset 不享受 verified 技术快车道，按 custom 全量技术门禁；原生版式已选定时无需人为增加三图探索。

### 一批只有一次确认

**接触印张(preset 镜)和三张 Styleframe(待选定制方向)在同一条消息里一次贴出,用户一次回复解决全部选择。**
这里只合并已有视觉选择：贴之前 `pause-selection`，回复之后 `resume-selection`。上游内容审批照旧；带批准视觉选择的合同直接继承，不再重复确认
(付费 AI 生成的费用确认是既有授权规则,保留)。

### 合同顶层字段(kit / 色板 / 密度 / 材质)从哪来

| 调用情形 | 怎么走 |
|---|---|
| **外部管线带 VisualContract 调用** | `node tools/validate-contract.mjs <路径>` 确认有效后**直接继承**,复制进批次目录,不重跑三图。同时继承已选实现路线，尤其不能把批准的 custom 改成新匹配到的 preset；只能核验所选实现，不重选。 |
| **全批已选原生 preset、无上游合同** | 顶层取 preset 皮肤基线 `docs/presets/baseline.json` + profile 默认值,**不跑 Styleframe**:版式与色板已被 preset 冻结,三图无处可探索。 |
| **有 custom 且视觉方向未定、无上游合同** | 为这些定制镜跑**一轮** Styleframe:挑一个代表镜写三份候选合同 → 三个并行 worker 渲 `styleframes/sf-{1,2,3}.png` → 与印张同批贴出 → 用户选一次 → 冻结,定制镜整体继承。 |
| **上游预生产候选调用**(dispatch 注明「只出候选,不做决定」) | 渲候选图 / 印张就返回。不打分、不自动选、**不冻结合同、不盖 `--confirm`、不渲视频**。返回每张 PNG 绝对路径 + 一行设计摘要 + 一句推荐理由。真人在派发方那一层。 |
| **非交互批次**(子代理模式,**整条链上都没有人**) | 印张照渲照落盘;有三图时按 `docs/visual-first.md` 的 100 分评分表自动选最高分那张。确认用 `--confirm "非交互批次自动确认:<依据>"` 盖章,并把这件事写进 `review.md` 和交付报告。**不向派发方要确认。** |

⚠️ **"有没有人"要看整条链,不是看自己这一层。** 子代理内部永远没有人,照这个判法就永远走自动选——
但真人常常就在派发方那一层等着看图。**dispatch 注明「只出候选」时走上面那一档,自动确认条款不适用。**
(2026-08-10 修:`/package` 的预生产调用一直被误判成非交互,用户因此从未见过候选。)

自动确认不是"跳过预览":印张照渲、照落盘、照记录,少的只是那次人工点击。

## 生产序列(13 步,顺序固定,一步都不许跳)

和 `$motion` 同一条序列，B-roll 的已有视觉选择同时容纳定制方向与原生模板真实预览；带批准合同的执行调用跳过已完成的选择，
且**第 11 步不做整片拼接**(每镜自己就是成片)。`<P>` = 批次目录 `projects/<yyyy-mm-dd>-broll-<批次名>/`。

以下 preset 预览步骤只适用于已选原生 preset 或独立模板候选预览；**custom-only 批次跳过 preset 展开、预览与 --check-confirmed，继承自己的 Styleframe 批准记录和冻结合同，不要求 preview-manifest。混合批次只对 preset 子集执行这些命令。**

先判定原生模板预览状态：**已有批准视觉选择且预览回执的 props/route/signals/still SHA 校验有效时，第 2a、2c、3、4 步全部只校验并复用，不执行展开、重渲或重新盖章。** `preset-preview` 的普通渲染命令每次都会写 pending 并清空确认时间，不能把它当成只读检查。只有新候选或内容、props、preset 版本确实变化时，才进入重建分支；改变用户看过的结果后按原有变更审批处理，不能用旧原话给新版自动盖章。纯搬迁且内容 SHA 不变时，依已有回执规则更新路径引用/映射、保留确认及原始证据并重新校验，不要求用户再确认。

| # | 动作 | 命令 / 角色合同 | 完成标准(看文件,不看汇报) |
|---:|---|---|---|
| 1 | 起时钟 | `node tools/production-clock.mjs start --project <P>` | 读需求单就算开工 |
| 2 | 理想表达与最佳效果设计 → 读菜单并列比较模板 → 记录推荐与批准路线；仅为视觉未定的 custom 派三个 Styleframe worker | `docs/subagents/styleframe-worker.md` × 3 | 每镜保留设计与四个路由字段；候选不代替选择，冻结路线不重匹配；独立候选各写自己的 `styleframes/sf-N.*` |
| 2a | **新候选或批准变更才展开；有效已批准产物只校验复用** | 重建分支：`node tools/expand-presets.mjs <P>`；继承分支用第 5 步只读校验 | 每个 preset 镜有 `props.json`/`signals.json`/`route.json`,并列候选另有 `alt-<id>.props.json`;合同字段(engine/objective/anchors/tags)已回填;exit 1 可在批准表达与路线内修 props；不得静默重选实现，需换路线则回报上游 |
| 2b | **校验匹配记录**(渲预览前先拦一次,别浪费渲染) | `node tools/validate-contract.mjs <P>/visual-contract.json --require-preset-matching` | exit 0 |
| 2c | **仅重建分支渲预览；继承分支保留原确认回执** | 重建：`node tools/preset-preview.mjs <P>`；继承：`node tools/preset-preview.mjs <P> --check-confirmed` 并执行第 5 步哈希校验 | `<P>/preview/contact-sheet.png` + `contact-sheet.md` + `preview-manifest.json`(version:2，仅重建分支 status:pending，每格含 Remotion still 命令、props/route/signals/still SHA 绑定)；继承分支保持原 confirmed 状态，不重写回执；custom-only 不适用 |
| 3 | 仅视觉仍待选时，贴图前暂停计时；已有批准选择跳过 | `node tools/production-clock.mjs pause-selection --project <P>` | 非交互批次不暂停,时钟不停 |
| 4 | 仅视觉仍待选时，用户一次回复 → 恢复计时 → **盖章**；已有批准选择复用绑定回执 | `node tools/production-clock.mjs resume-selection --project <P>` + `node tools/preset-preview.mjs <P> --confirm "<用户原话>"` | 与第 3 步成对;改过文案要重跑 2a/2c 再盖章(重渲会把 status 打回 pending);非交互批次把自动确认依据写进 `review.md` |
| 5 | 冻结并校验合同(并列候选必须已清空) | `node tools/validate-contract.mjs <P>/visual-contract.json --require-preset-matching --preset-resolved --require-preset-artifacts` | exit 0;不过不许派任何 worker。`--require-preset-artifacts` 会校验 preview v2 真实渲染回执与 SHA 绑定,不能只靠文件存在 |
| 6 | 生成逐镜派发清单 | `node tools/build-dispatch-manifest.mjs <P>` | custom 镜有 `dispatch.md` + `source/` + `keyframes/`;preset 镜的 dispatch 首行是 `Mode: preset-fastlane` |
| 7 | worker 按波次并行(**preset 镜零 worker、零新 TSX**) | `docs/subagents/shot-worker-remotion.md` / `docs/subagents/shot-worker-hyperframes.md` / `docs/subagents/asset-scout.md` | custom 镜有首/中/尾帧和 `draft.mp4`;preset 镜由主 agent 直接把 `props.json` 排进渲染队列 |
| 8 | 正式渲染进受限队列(**确认闸门在这里**) | `node tools/render-queue.mjs <P>/render-queue.json --concurrency 2 --require-confirmed <P>/preview/preview-manifest.json` | 每项 exit 0 且 `expectedOutput` 非空;没盖章直接 exit 2,**用户确认前不渲完整视频** |
| 9 | 全部镜连续播放 + 内容/节奏/合成/连续性评审(custom/draft 另做结构化全量评审) | `docs/subagents/visual-reviewer.md`、`docs/subagents/continuity-reviewer.md` | 逐镜 `review.json`;同一批次共享视觉语言；实际时间轴相邻镜还须检查首尾锚点、切法与动作衔接，非相邻候选素材池只检查批内风格一致 |
| 10 | 集中修复并重看 | 记录轮数与预算 | 不过则继续必要修复；无法继续交草稿、缺口与下一步，不自动降质 |
| 11 | 规范化(不拼整片) | `tools/normalize-shot.sh` 逐镜 → 交付即每镜一个 mp4 | 批次内规格逐镜一致;**只有 hybrid 镜的分层产物才用 `tools/concat-shots.sh`** |
| 12 | 产物校验 + 结构化评审 | `tools/validate-output.sh … --codec h264 --pix-fmt yuv420p`(全部镜) + `node tools/validate-review.mjs <P>/review.json` + `tools/check-density.sh --contract`(custom / draft preset 镜) | 全部 exit 0;verified 的 technical 证据可复用；本次播放与合成结论仍落 review.md，`validate-review` 覆盖 custom/draft 镜 |
| 13 | 停表 | `node tools/production-clock.mjs finish --project <P>` | 记录活跃时长与预算变化，不自动判失败 |

**已选原生 verified preset 的技术快车道**：槽位校验、真实文案 Preset Preview、输出成功、分辨率/时长/编码/音轨继续执行；未改组件时可免重复实现、frame-audit / lint-shot / check-density 和重复模板评分。
**本次全部交付镜仍须连续播放**，检查批准表达、口播时点、节奏、可读性、相邻衔接；overlay 看真实口播合成，记录时间段、问题与结论。静帧确认或 verified 不代替本次观看。keyframes-only 只审真实关键帧与状态变化设计，明确动态未验收，不渲 MP4。
draft preset 和 custom 镜按第 6 节全量自查。
阶段边界打点:`node tools/production-clock.mjs checkpoint --project <P> --note "<刚做完什么>"`。
**"外部管线在催"不是跳步的理由**——批量模式省的是那次人工点击,不是渲帧、评审和校验。

### 派发降级链(按顺序试,不许直接跳到最后一档)

1. **原生 subagent** —— harness 支持就用它,一镜一个 worker,各自只写自己那个 `shots/shot-NNN/`。
2. **共享文件系统的 headless worker** —— 没有原生 subagent 时起 headless 进程,输入输出全走批次目录里的文件,
   导演只认文件不认口头汇报。
3. **内联串行** —— 前两档都不可用时主 agent 自己一份份做完,dispatch 照写、隔离照守。

**降级只改变"谁来做、分几波",不改变"做多少"。** 需求单上有几镜就交几镜:
**永远不许因为 harness 槽位少就砍镜头**,也不许把两镜合成一镜或缩短时长来凑波次——
派发方拿到的镜数少一个,它的口播就有一段没有画面。降级发生在哪一档、为什么,写 `build-log.json` 一个事件 + `review.md` 一行,并在交付里报出来。

## 输入:需求单

一份 markdown,逐镜一节,至少含:镜号 / 类型(动效 | 静图运镜 | 录屏包装) / 时长秒 / 比例 / 要表达什么(理想画面描述,以此为创意基准,不要自行降级表达) / 屏幕文字与关键数字 / 口播原文(节奏对齐用) / 风格要求。字段缺失时按合同默认值处理并在交付时标注假设。

**静图运镜镜**:需求单必须附源图绝对路径和运镜意图(推向图中哪个焦点/扫过什么区域)。图拷入 `assets/` 并登记 `assets.md`(来源作为元数据,不阻塞);位移与缩放走缓动令牌,速度以"看清内容"为准,忌快;可按需叠局部高亮/圈注/箭头引导视线;图分辨率不足以支撑放大时改为拉远或平移并在交付时标注。

**运镜有九式,不是四式**(受控词表在 `docs/motion-vocabulary.md` 的「运镜」段):平面四式 `push`/`pull`/`pan`/`diagonal` 走 `KenBurns`;**分层五式** `crash_zoom`(急推撞停,配 `lib/shake.ts` 震屏)/ `dutch_roll`(斜角滚正)/ `multiplane`(多层视差)/ `dolly_zoom`(主体钉死背景压来)/ `orbit_freeze`(冻结环绕)走 `DepthCam`。后三式**要真实前景层**:`swiftc -O tools/matte.swift -o /tmp/matte` 编一次再抠;**抠不出来就退回平面四式并在交付时标注**,不要拿两张平面图假装分层。需求单 `运镜` 字段(`describe-spec.md` §6.2)留空时由本项目按内容判。

**需求单给了 `source_url`(网页地址)时**:先 `node tools/capture-page.mjs --url <地址> --out projects/<P>/assets/` 采成整页 2x 截图 + `layout.json`,再交给 `PageCam` 做 2.5D 运镜。`layout.json` 里的元素坐标是浏览器量的,**网页镜头据此定位,不必跑 `locate.mjs` 的网格法**(那套留给照片/长图)。

**录屏包装镜**:需求单必须附**原始录屏绝对路径**(不要接收别处预剪好的片段——起止点、速度、构图都是本镜的创作决定,不是别人先替你定好的输入)、要观众看到的那个动作、以及该动作在原始文件里的大致时间。这类镜的底层是真实视频,**Remotion 负责的是包装而不只是搬运**——只做裁切拼接、画面上什么都不加,等于没走本项目。

实现要点:录屏拷入 `assets/` 并登记 `assets.md`;用 `<OffthreadVideo>` 引本地文件,`startFrom`/`endAt` 取段,变速用 `playbackRate` 或自定义帧映射(慢放低于源帧率一半时先用 ffmpeg `minterpolate` 预处理成插帧版再引入,别在 Remotion 里硬拖);**必须裁掉设备状态栏**(时间/电量/信号/录屏红点),交付前逐帧确认无通知横幅、账号名、其他标签页等穿帮与隐私内容。

包装层至少做到其中两项,否则这镜不算完成:局部放大跟随焦点(手机上小字必须可读)、圈注/箭头引导视线(走定位协议拿坐标)、关键信息文字标注(字号与系列其他镜同级)、与系列统一的色板与安全区、设备外框或圆角投影、首尾转场。**包装是为了让观众看懂此刻口播在说什么,不是给录屏加装饰**——答不出"这个标注帮观众理解了什么"就删掉。

**要在图上定位焦点(推向哪、圈住谁、箭头指哪)时,先跑 `docs/locate-protocol.md` 的网格定位循环拿坐标,不许目测。**目测像素坐标平均误差 6.5%,圈注经常落在目标外面;网格法 2.3%,而且最后的 `mark` 验证步骤会把偏移当场暴露出来。

## 流程

1. **准备(序列第 1 步)**:`node tools/production-clock.mjs start --project <P>`,然后读 `memory/taste.md`、`docs/visual-first.md`、
   合同指定的 profile(`docs/styles/*.md`,未指定默认 `visual-max`)。
   建批次目录 `node tools/init-visual-project.mjs projects/<yyyy-mm-dd>-broll-<批次名> broll-<批次名>`(批次名用需求单里的脚本 id 或短名;
   目录非空时它会拒绝,不覆盖),写精简 `brief.md`(需求单路径 + 逐镜一行的理解确认 + 假设列表)。
2. **分镜 + preset 匹配(序列第 2 步)**:写 `storyboard.json`/`storyboard.md`,然后**现读 `docs/presets/MENU.md`**,
   逐镜比较六项表达条件与模板/定制收益,把 `presetCandidates` / `selectedPreset` / `matchReason` / `unmatchedReason` 写进合同镜条目。
   按最佳效果比较并推荐实现，再继承用户批准路线。只有已选原生模板才在正式合同填 `presetProps.slots`；模板对照预览使用独立候选合同。
   模板不能保留理想表达、定制有实际效果收益或用户已选 custom 时按定制实现；素材缺失先补素材，不因技术方便降低表达。
   **视觉方向未定的 custom 出三张 Styleframe，无论是否有模板候选**：三个 `docs/subagents/styleframe-worker.md` 在同一条消息里一次派完,
   各自可写域只有自己那组 `styleframes/sf-N.*`,互不可见。合同顶层字段来源见上表。
2a. **先判定镜头类型，再判继承或重建(序列第 2a–2c 步)**：
   **custom-only 跳过本步全部 preset 命令**，直接校验并继承自己的 Styleframe 批准记录与冻结合同，不创建或要求模板 preview-manifest。混合批次以下展开、预览和 --check-confirmed 只针对 preset 子集。
   已有批准视觉选择及有效 SHA 绑定回执时，**只执行下面两条校验**，复用 props/signals/route/still 与原确认；跳过展开、预览重渲和第 3 步。
   ```bash
   node tools/validate-contract.mjs <P>/visual-contract.json --require-preset-matching --preset-resolved --require-preset-artifacts
   node tools/preset-preview.mjs <P> --check-confirmed
   ```
   新候选或内容/props/preset 版本变更才执行以下重建命令；重建将使预览回执回到 pending，需沿原有变更审批确认新版，不能沿用旧原话自动盖章。纯搬迁且 SHA 不变只按既有规则更新路径引用/映射并重验，保留原批准证据，不重复询问。
   ```bash
   node tools/expand-presets.mjs <P>                                    # 槽位校验(必填/估宽/enum/版本)+ props/signals/route + 并列候选 props
   node tools/validate-contract.mjs <P>/visual-contract.json --require-preset-matching
   node tools/preset-preview.mjs <P>                                    # 每镜 0.4 时刻一帧真实文案 → preview/contact-sheet.png + preview-manifest.json(v2 绑定回执)
   ```
   估宽失败先在批准语义不变下调整；不能靠删关键内容迁就模板，也不能静默换已批准路线。需要新布局/动作则明确按 custom 处理，保留上游审批边界。
3. **一次确认(序列第 3–4 步，仅视觉仍待选时执行以下命令)**：已有批准视觉选择与有效绑定回执则跳过本步，直接校验继承；不得重复询问或重新盖章。待选时 `pause-selection` → 在同一条消息里贴出**接触印张**
   (附 `preview/contact-sheet.md` 的编号↔镜号↔文案对照)和待选定制方向的三张 `sf-N.png` → 用户一次回复
   (改文案 / 并列二选一 / 选 sf-N)→ `resume-selection` → 应用决定(改了文案就重跑 2a 的三条命令)→
   `node tools/preset-preview.mjs <P> --confirm "<用户原话>"` 盖章。
   **盖章前不许渲任何完整视频**;`render-queue --require-confirmed` 会在第 8 步再拦一次。
4. **逐镜路由引擎**(判据全文 `docs/engine-routing.md`,**preset 镜跳过本节**——engine 由 preset 钉死)。
   **Remotion 是本模式的默认引擎**:custom 镜先按 Remotion 实现,只有信号真的判到 `hyperframes`/`hybrid` 才换,
   且必须两处留痕——`route.json` 的 `override` 和合同镜条目的 `engineReason`(`--require-preset-matching` 会拦缺项)。
   每镜四件事:
   1. 写 `shots/shot-<NNN>/signals.json`:十一个信号各取 0/1/2。
      **`2` 是"这条不满足这镜就等于做失败了",不是"这镜有这个东西"**——本模式的插片大多带屏幕文字,
      但那是 `captions: 1`;`shader3d: 2` 指的是"换成 2D 实现等于换了个镜头"。
   2. `node tools/route-shot.mjs projects/<name>/shots/shot-<NNN>/signals.json > projects/<name>/shots/shot-<NNN>/route.json`
   3. 把 `route.json` 的 `engine` 同步进合同的 `shots[].engine`,两处不一致不许派 worker。
   4. **Hybrid 用量自检**:精确侧和视觉侧各出现一个 2 会短路成 `hybrid`,不看分数;
      一批里 hybrid 超过一半就是信号填松了,**回去重填重跑,不是手改 `route.json`**。

   人工改路由必须在 `route.json` 里写 `override`(`from` / `to` / `reason` / `at` / `by`),理由要说清路由器为什么在这镜判错,并记进 `review.md`。
5. **实现(序列第 6–7 步,只针对 custom 镜)**——先生成派发清单,再按 `route.json` 派对应引擎的 worker。

   ```bash
   node tools/build-dispatch-manifest.mjs projects/<name>   # 校验合同 → 每镜建 source/ keyframes/ + 写 dispatch.md
   ```

   **每份 dispatch 只声明自己那一个可写目录**,不出现任何别的镜头——隔离是并行 worker 不互相踩踏的唯一保证。
   角色合同:`remotion` 镜 → `docs/subagents/shot-worker-remotion.md`,`hyperframes` 镜 → `docs/subagents/shot-worker-hyperframes.md`,
   `hybrid` 镜两份都给;素材另派 `docs/subagents/asset-scout.md` 与它们同时跑,它只碰 `assets/`。
   **同一波的 worker 在同一条消息里一次派完;完成标准是文件存在并通过校验,不是 worker 说完成了。**

   派发前按标签路由知识(协议见 `docs/knowledge-routing.md`):
   ```bash
   node tools/route-knowledge.mjs <route.json 的 engine> <2–4 个标签>
   ```
   标签词汇:`data chart ui screenshot shader 3d kinetic type transition overlay texture brand logo code device map layout background caption audio render media`。
   输出**原样**写进 `dispatch.md` 的「Knowledge」段(恒为 `docs/visual-first.md` + 最多 4 条动态资源),每条补一行"这一镜为什么需要它"。
   **不许把外部 skill 的完整源码粘进 dispatch**——只给资源标识符,worker 自己去读。
   dispatch 还要带:合同路径、本镜需求单原文、时长/比例、engine 与理由。

   `remotion` 镜复制 `templates/remotion-base` 建 `build/`(`cp -Rc` APFS 克隆连 node_modules,秒级,**免 npm install**);
   `hyperframes` 镜从 `templates/hyperframes-base` 起,`registryFit` 高的先 `hyperframes catalog` / `hyperframes add`;
   `hybrid` 镜由 HyperFrames 出视觉层、规范化后交 Remotion 做最终文字与数字。
   **每镜一个独立 composition**(命名 `Shot1`、`Shot2`…,时长/比例按需求单)。
   动手前先查 `dispatch.md` 的「Component shortlist」段(按本镜标签算出的重合度前 10,约 1200 tokens;HyperFrames 侧另跑 `hyperframes catalog`)——默认复用现成组件 + 调参,不手搓等价物;**只有清单不够用时**才去读全表 `docs/catalog/components.json`(约 6600 tokens)。颜色字号缓动取合同 token,每镜最多引入 3 个主要视觉模块。
   逐镜落一行到 `storyboard.md`(镜号|时长|画面|动画行为|文字),"动画行为"列用 `docs/motion-vocabulary.md` 的基元名写。
   shot worker 按波次并行,**只有浏览器正式渲染进受限队列,并发上限 2**(内存不足降为 1);
   **并发上限只改变执行波次,不许因此减少镜头**,也不约束思考、素材、代码和审查的并行。
5a. **preset 镜的实现 = 一条渲染命令**(替代第 5 步,**零 worker、零新 TSX**):整批共用**一个** `build/` 克隆
   (`cp -Rc templates/remotion-base <P>/build`,不逐镜克隆;预览渲染也用它),队列项命令
   `["npx","remotion","render","<compositionId>","--props=<shots/shot-NNN/props.json>","--color-space=bt709","<shots/shot-NNN/raw.mp4>"]`
   (`--color-space=bt709` 出限范围 yuv420p,normalize 走 stream copy 免转码)。compositionId 在 props.json 里。
   **这条命令只有在印张盖过章之后才允许跑**——队列一律带 `--require-confirmed <P>/preview/preview-manifest.json`。
6. **自查**(硬性,不可省)。已选原生 verified preset 复用技术快车道：
   ①槽位校验 ②真实文案 Preset Preview 与 SHA 回执及确认 ③真实渲染成功 ④输出规格校验。
   `review.json` 的 technical 五项取值来自真实 command/receipt，不许直接填 true。未改组件可免重复代码实现与模板数值审计。
   **全部镜实际连续播放并审本次内容、节奏、可读性与衔接；overlay 看真实口播合成。** 结论在 review.md 指向实际文件与时间段；只有抽帧或缺合成时标未验收。发现问题先修本镜重看，模板问题另回流升版本，不能用 verified 拒绝检查。
   **draft preset 镜和 custom 镜全量自查**:每镜渲首/中/尾帧到 `build/review/`(**`--scale=0.4`,自查帧不是交付物**),
   **先跑 `node tools/frame-audit.mjs <帧...> --contract <合同>` 看数字,再用 Read 逐张看图**,
   对照 `docs/quality-checklist.md` 硬性项**和选中的 `sf-N.png`**,问题直接修,循环到过。
   能被 frame-audit 算出来的(墨量/明度层数/构图偏压/安全区边缘/离板颜色/强调色面积)仅作诊断描述,
   真实观看检查表达、焦点和合成效果;只有数字或眼睛已经起疑的那一帧才补读全分辨率。
   首尾帧墨量仅作描述；留白、入场与退场按真实播放和合成检查。
   **自适应循环:过即停,不再有固定加法轮数。** 首轮渲帧后立即跑技术检查与诊断
   (`frame-audit.mjs` + `tools/check-density.sh` + `node tools/lint-shot.mjs`)再过眼睛;
   都过 → 立即停,**不许为凑轮数继续加东西**;不过 → 缺什么补什么,每两轮检查剩余预算并记录；仍不过继续必要修复，无法继续按 Failure Report 上报草稿与缺口。
   按真实画面检查是否需要减法，不以前置墨量下限决定。
   (「至少三轮加法」已废除——2026-08-03 盲评证明固定轮数催生冗余,见 `docs/quality-checklist.md` 的删除说明。)

   **序列第 9–10 步:把结论落成结构化评审,集中修复并重看(全部镜实际观看；custom 镜与 draft preset 镜另做结构化全量评审)。**
   派两个只看画面、不评审代码的角色:
   - `docs/subagents/visual-reviewer.md`:逐镜写 `shots/<id>/review.json`(七维各 0–10 + `heroFrame` + `technical` 五项
     + 0–3 条**真实**不符(合格镜可为 0,不许凑数)+ 最多五条按分数影响排序的修复,FAIL 时至少一条),格式见 `docs/visual-scorecard.md`。
   - `docs/subagents/continuity-reviewer.md`:实际时间轴相邻镜检查首尾锚点、切法与动作衔接，失败只返修边界两侧镜头；非相邻候选素材池只检查批内风格一致。
     同时检查配色、字体套装、密度曲线和运动性格是否漂移，结论写 `continuity.json`。
   ```bash
   node tools/validate-review.mjs projects/<name>/review.json   # 总分<80 / 任一维<6 / 英雄帧<8 / technical 有 false → exit 1
   ```
   评分门槛:总分 ≥80、任一维度 ≥6/10、英雄帧 ≥8/10,记录集中修复轮数与成本；未过继续必要修复，无法继续则在 `review.md` + `build-log.json` 写草稿状态、缺口与下一步，不自动改变批准表达，不称完成。
   全批 verified 也须逐镜连续播放与内容/节奏/合成检查，批内一致与相邻边界检查照做；无需重复模板七维评分。
7. **序列第 8 + 11 + 12 步:渲染 → 规范化 → 校验**,按波次走。正式渲染写进队列文件再跑(每项 `{id, cwd, command, expectedOutput}`,
   `command` **必须是数组**——字符串命令要过 shell,带空格的批次路径进来就是注入点):
   ```bash
   node tools/render-queue.mjs projects/<name>/render-queue.json --concurrency 2 \
     --require-confirmed projects/<name>/preview/preview-manifest.json   # 内存紧张改 --concurrency 1
   ```
   没盖章 exit 2,一帧视频都不会渲——**用户确认前不渲完整视频**这条不靠自觉。
   某项算过关要同时满足"进程 exit 0"和"`expectedOutput` 存在且非空"。每镜渲完立刻做完规范化和校验,不要攒到最后。
   **不分引擎,每一镜都过 `normalize-shot.sh`**——只规范化 HyperFrames/Hybrid 镜,等于默认 Remotion 输出天然对齐,
   而 timebase 和 SAR 恰恰是最容易对不上的两项。交付给外部管线的 mp4 规格必须逐镜一致。
   **本模式不做整片拼接**(每镜就是一支成片);只有 hybrid 镜的分层产物才用 `tools/concat-shots.sh` 先合成本镜。
   ```bash
   # 队列项的命令形如 ["npx","remotion","render","Shot<N>","../shots/shot-<NNN>/raw.mp4"];hyperframes 镜走 hyperframes render
   tools/normalize-shot.sh projects/<name>/shots/shot-<NNN>/raw.mp4 \
     projects/<name>/out/shot<N>.mp4 1080 1920 30 none
   # 分辨率/时长/编码/音轨:verified preset 镜剩下的四道硬检查之一,--codec/--pix-fmt 不许省
   tools/validate-output.sh projects/<name>/out/shot<N>.mp4 --size 1080x1920 --fps 30 \
     --duration <该镜秒数> --dur-tol 0.5 --codec h264 --pix-fmt yuv420p --audio none
   # 密度只查 custom 镜与 draft preset 镜
   tools/check-density.sh projects/<name>/out/shot<N>.mp4 --contract projects/<name>/visual-contract.json
   ```
8. **交付(序列第 13 步先停表:`node tools/production-clock.mjs finish --project <P>`)**——给派发方的返回值:
   每镜一行——`镜号 | mp4 绝对路径 | 一句实现说明 | preset id@v 或 custom | 1 张关键帧图绝对路径`;
   另附假设/取舍列表 + 逐镜所选路线及效果依据(几镜原生 preset / 几镜 custom / 候选与所选差异；模板使用率不是目标);
   非交互批次还要附"自动确认的依据"和(有三图时)"自动选了 sf-N、得分多少、为什么"。
   **不等待反馈**——修改循环由用户之后在本项目会话里按 `$motion` 阶段 C 进行,交付里报出项目目录名即可。
   交付行末**再加一句剪映导出的可用性**:整条片子的最终拼接在派发方或用户的剪辑软件里做,
   要在剪映里改字幕/变速/换配乐的话跑 `tools/jianying/.venv/bin/python tools/jianying/export.py projects/<P>`
   (见 `docs/jianying-export.md`)。**这是交付后的可选项,不是新增确认点**,一句话带过即可。
9. **沉淀**:`memory/taste.md` 追加一行批次记录(做了什么类型的镜、用了什么手法、用的哪份合同);
   提炼得动的结论进 `docs/taste-rules.md` 的编号判例(每条要标**落点**:门禁 / 资产 / 仅文档)。
   **可参数化的新手法抽成组件回流 `templates/remotion-base/src/components/`,并登记进
   `docs/catalog/components.json`(`params` / `pitfalls` 必填,棘轮测试会拦),渲缩略图
   `node tools/build-catalog-thumbs.mjs --only <id>` 并亲眼看过才翻 `verified`**——
   只写进 taste.md 不算沉淀,下个批次还是会手搓一遍。
   **几个组件按固定时序凑成的手法抽成配方**(`docs/recipes/`,`kind:"recipe"`),
   它会自动进下一批的 `dispatch.md` 的 Recipe shortlist ——
   组件回答「这个零件怎么调」,配方回答「这个手法整套怎么做」,后者才是不再手搓的关键。
   **preset 级回流(两条,`AGENTS.md` 的沉淀原则延伸到整镜粒度)**:
   ①**模式识别是自动的,不等用户请求**:给每个 custom 镜写"模式签名"进 `docs/presets/CANDIDATES.md`
   (先通读该表判断同构);签名第二次出现(本批内 ≥2 镜,或与登记簿既有签名跨批同构)→
   **当场建 draft preset**(组件 + preset.json + PRESET.md + StyleBible 页 + 重跑 build-preset-menu;
   组件必须带全套 tune 旋钮——font/scale/x/y + skin/accentHue/neutralHue,见 presets/index.ts 头注⑥),
   交付报告附一行「新提名模板 X,下批自动试用」;下批实际用过且样张过目后转 verified;
   ②preset 镜在修复轮被人工改过 → 改动必须回流 `docs/presets/<id>/preset.json`(bump version + changelog)与模板组件,
   **不许只留在批次 build/ 里**——否则下批又是旧样子。任何 preset/皮肤变动后跑 `node tools/build-preset-menu.mjs` 重新生成菜单,
   并重渲 `StyleBible` 对应页给用户过目(样式类用户反馈同样走这条:改皮肤/preset → 升版本 → 重渲样张,不许只改当次镜头)。

## 约束

- **理想表达先于实现选择**:先设计对象、状态变化和口播关系，再比较模板与定制；模板可满足时同步给出方案；以最佳效果推荐，批准后才按所选路线制作。
- **已选原生 verified preset 镜:不出三张 Styleframe、不派 worker、不写新 TSX、不改 preset 组件**。
  样式类不满意一律走回流(改皮肤/preset → bump version → 重渲样张),不许只改这一批的 `build/`。
- **确认点只有一个**:接触印张(+ 待选定制方向的三图)一次贴出、一次回复。用户确认前不渲完整视频,
  盖章由 `preset-preview.mjs --confirm` 记录、由 `render-queue --require-confirmed` 强制。
- **Remotion 是默认引擎**:preset 镜由 preset 钉死;custom 镜换 `hyperframes`/`hybrid` 必须同时写
  `route.json` 的 `override` 和合同的 `engineReason`,理由要说清"换回 Remotion 这镜为什么就等于做失败了"。
- 每镜**一个主焦点 + 最多两个次级锚点**;答不出"这个动画帮观众理解了什么"的运动一律删。
- 画幅继承主口播实际显示比例与批准合同；缺主视频/明确目标比例须一次询问，不默认 9:16。帧率按合同，宽高必须偶数;文字停留 ≥1 秒/10 字。
- 素材策略:需求单附带的源图、用户自录的录屏/实拍、以及合同允许的品牌 logo / 网页截图 / 网络图片都可用,**选中即下载进 `assets/` 引本地路径**,登记 `assets.md` 作为元数据(不阻塞交付)。
  实拍类分镜本来就不该路由到本模式——需要去网上找大量实拍素材的需求走 `$motion`。
- 时长严格按需求单(误差 ≤0.5s),口播对齐靠节奏而不是塞满画面。
- 确定性不降级:不许 `Date.now()`、未播种 `Math.random()`、渲染期网络请求。

## 统一产物位置

执行前读取 `docs/artifact-layout.md`。统一入口 `../output/<SC-XXXX>/` 只放可直接使用的资源，分类目录内平铺中文内容名文件；无内容不建目录。合同、报告、日志、工程与旧版本留在仓库 workspace 或隐藏 `.制作资料`。内部验收后同步可用资源到用户目录，不再放 README 和制作流程目录。
