---
name: content-package
description: 完整制作总入口：脚本审阅、节奏留白、镜头、字幕、封面标题、声音、素材及 AI 视频提示词；仅定制动画交用户手动Claude，完整本轮设计和执行回执，不设动画审批。
---

# content-package — 素材、AI 视频提示词与手动 Claude 交接

Package 规则唯一准源：../workflow/docs/complete-package-contract.md（本文件不重复）。

## 当前任务操作入口

按上述合同依次定位当前工程、读取绑定输入、制作本轮合同与回执。命令在自媒体工作流仓库根目录运行。

1. 有 projectId 时读取当前工程；只有 SC 时先发现绑定：

```sh
python3 tools/editor_plan.py read --project-id <ID>
python3 tools/editor_plan.py discover --script-id <SC>
```

2. 普通对话启动任务后查询 jobs/read；收到 external_job 的 worker 直接读取该 JSON 及其输入：

```sh
python3 tools/editor_plan.py jobs --project-id <ID> --kind package
```

3. 准备 `<packageRoot>/semantic-baseline.json` 后执行早期交接和专项 runner；查看 controller-summary.json，再按需打开专项提案和原生校验结果：

```sh
python3 tools/package_early_handoff.py --request <external-job.json> --semantic <packageRoot/semantic-baseline.json>
python3 tools/package_branches.py run --request <external-job.json> --semantic <packageRoot/semantic-baseline.json>
```

4. 将本轮业务校验与实际应用结果汇入 `<packageRoot>/package-contract.json`，按合同的完成门禁执行：

```sh
python3 tools/animation_package.py finalize --request <external-job.json> --analysis <packageRoot/package-contract.json>
```

5. 查询任务和工程回读，打开产出的 plan.md 与控制台核对交付入口。

## 历史兼容分支（不属于 semantic-template-v1）

以下仅供既有旧合同的明确续作或独立历史任务使用。新 package/broll 已在上方分支执行并结束；不得继续落入下面的审批、视觉设计、派发或回执要求，不自动重做旧作品。

# content-package — 定稿分镜、完整设计与关键帧

## 效果优先的默认流程

先根据内容独立设计效果最好的主方案，再现读模板菜单，能满足目标的模板方案在同一份分镜中并列提供。定制更好就推荐定制，不以模板未命中为前提；模板效果相当或更好可推荐模板，不强做两套。按表达、构图、动作、节奏、可读性、真人关系解释差别，不能只比制作速度。`templateOptions` / `presetCandidates` 是候选，不是已选路线；批准后才按选定方案制作。候选与主方案同效果时合并说明，无合适模板明确写无。

这项判断先于下面的素材路由、菜单匹配和视觉路线分支。无需用户提供参考片；核心镜头自主比较不同视觉表达，不把本次空间回路的纸卡/透视当作以后所有题材的固定解法。分镜内容审批和视觉选择保持原有节点，不另加确认。

输入提示：`SC-XXXX [全broll/素材偏好/风格要求/跳过关键帧]`

先读取 `docs/animation-design-standard.md` 和 `docs/broll-parallel-options.md`；新制作同时执行 `docs/visual-design-contract.md`：顶层 `designIntentVersion: 1`，需视觉制作镜头填写完整 `designIntent`（goal、concept、states.start/change/end、beats 的 id/anchor/action、focus、presenterRelation、templateOptions、customOption、recommendation、acceptance、risks）。brief 与返回合同原样保留版本和对象，真实秒点另存，不改 `beats.anchor`；旧合同不强制补字段：同一适用语段并列设计动画与真实素材，选择合并到本期分镜审批，支持两者都做。候选方案记录在 plan.md 与 visual-options.json，不制造重叠口播镜号。

## 动画 / 素材与控制台交付

同时读取 `docs/broll-composition.md`。先由 Codex 判断每段用纯动画还是素材，两路都适合则给两路并写推荐理由；素材按表达适配、真实性、获取成本比较网络与 AI 等来源；选 AI 时给简述、详细可复制提示词、时长/画幅和目标槽位。分屏、截图铺叠是素材呈现模板，不另造“混合”路线。 选用 AI 素材时必须交付可复制的完整提示词。将推荐、备选和素材来源纳入本期分镜整批审批；批准前不组装正式时间轴、不制作关键帧。可先取得代表截图以完成真实素材设计，批量获取与真实秒点留到 broll。保留原 shots/options 合同，新增 composition.json 作为可编辑组装 sidecar，不能从草案估时声称已完成真实时间轴。

## 普通对话也读取当前工程

本节适用于没有 external_job 的自然语言请求。用户明确提供 4358 projectId 时，先运行
`python3 tools/editor_plan.py read --project-id <ID>`，用返回的最新 productionPlan 作为内容准源。
只有 SC-XXXX 时先运行 `python3 tools/editor_plan.py discover --script-id <SC-XXXX>`：唯一绑定才
使用该 projectId；多个匹配一次让用户选择，禁止猜最近工程；返回 unbound 才进入下文原独立内容流程。
服务不可达是缺连接，不能据此断言没有绑定；列出缺项，不直接改旧 package。
发现只读取已保存工程 JSON 的绑定元数据，不枚举、读取或分析用户所有私有素材。

已绑定工程的计划修改统一使用 `editor_plan.py edit/action/import` 的同一 CAS API；当前计划 Markdown
是派生视图，不能直接修改它来当作工程准源。保存明确内容修改后，用
`python3 tools/editor_plan.py jobs --project-id <ID> --kind package` 启动完整本技能 worker；
本技能在 worker 收到 external_job 后继续完整业务步骤，无重复 discover 或递归派发。
单镜请求显式传 --shot-id/--slot-id 及必要 --instance-id/--range-id；无目标不能猜。
审批与视觉选择用 `approve`，然后 `jobs --kind package --resume-job-id <上次任务ID>`；
等待状态真实持久化，风格继承不替代本期内容审批。重做保留当前手调、实际素材和版本，旧包仅历史。

## external_job：工作台本地作品入口

### 4358 当前工程模式

当前素材发现使用 snapshot.catalog / external_job.materialCatalog 的 project 与 shared 两个 scope；
统一目录是准源，不能把隔离 checkout 素材库为空当作共享库没有素材。只对当前任务相关记录读取
实际文件，保持 private/project 与 shared 身份，禁止整库无关内容分析。recordedScriptUnconfirmed=true
表示仅有真实录音复用的原始转写：它是未定稿草案，须先返回正文/分镜待批准，不能直接冻结视觉。

external_job 含 projectSnapshotPath/projectPlanPath 时，先完整读取这两份 SHA 绑定的只读输入以及
`docs/workbench-external-job.md` 的 4358 worker 合同。当前 productionPlan 是唯一内容准源，保留
稳定 shotId/slotId、当前画面要求、素材描述、备选、真人区段、手调与需求版本。旧 package 仅供追溯，
禁止目录扫描/飞书回读覆盖工程修改；运输层导出的 canonical 草案缺业务字段时按本技能补齐。
先设计、审批、必要候选选择，再关键帧，全部当前规则仍执行。纯脚本允许 audioPath/videoPath=null；
无真实时间保持有序分镜 timing=unaligned，不把估时填准确 ranges。实际源视频可用时继承探测画幅；
无主视频但工程 canvas 明确时继承它，没有明确目标画幅则交文字方案并返回缺项。

所有新产物在本任务 outputRoot，不覆盖历史 package。每项按 progressDirectory 写原子渐进结果及
真实进度，等待批准/选择时持久化返回。正常完成仍交完整 result-manifest.json，shots 保留
productionShotId/requirementVersion/slots 与完整 canonical 意图，keyframe 只引用实际文件。
审批必须绑定当前 requirementVersions；视觉选择必须绑定上一任务 choices 的文件 SHA。
本模式不再使用下文“未提供 basePackageRoot/contextPaths 扫描同一期”的回退。
visualization 路径优先用环境 VISUALIZATION_ROOT（任务隔离根），未设时用既有桌面目录；现读它的
AGENTS/skill/runbook/visual-first。overlay 全链路保留 Alpha MOV 与真实口播合成预览，不让旧 MP4
要求覆盖；缺真实口播时关键帧可交，合成预览明确待录制。

收到 `external_job: /绝对路径/job.json` 时，先完整读取 `docs/workbench-external-job.md` 并校验
`version=1`、`phase=package`、`finalScriptPath`、`videoPath`、`packageRoot`、`outputRoot` 和
`resultManifestPath`。所有路径必须是绝对路径；所有新产物必须位于 `outputRoot` 内。

可选 `contextPaths` 是调用方传来的既有方案/用户要求文件，必须逐一列入 `sources` 并完整读取，保留其审批状态，不把待审稿当批准稿。

可选 `sourceSrtPath` 作为已有带时间码字幕及实际口播锚点准源；可选 `basePackageRoot` 表示用户要求继承或
修订上一版 package。若提供，先校验绝对路径及 `sources` 哈希；`basePackageRoot` 的
`shots.json` 必须在 `sources` 中；有 `visual-contract.json` 时也须列入，hybrid 文字/纯素材方案可无合同。读取它们作为上游上下文后，仍由本
skill 按当前完整规则决定继承与修订，不允许调用方预先改写分镜、合同或视觉方法。

**外部任务模式只替换飞书 fetch/commit**：不运行 `package_io.py fetch/commit`，把
`finalScriptPath` 当作唯一已定稿正文准源，把原本写到 `workspace/package/` 的文件改写到
`packageRoot`。本 skill 其余章节全部原样执行，尤其不能跳过意义单元切镜、素材库匹配、
Visualization preset 现读、`$motion-broll`、视觉合同、关键帧、前后镜设计和质量校验。

外部任务由工作台异步执行，当前 Codex 进程内不得等待用户回复。首先遵守根 AGENTS.md 的本期
分镜内容审批：未批准时完成文字分镜与素材缺口清单，写 waiting_approval 后返回，不做关键帧。
获得明确内容批准后，才按第 4 节进入 Visualization 的视觉路线；风格继承不等于内容批准。

续跑请求提供 `approvedShotsPath` 与 `storyboardApprovalPath`，两者必须在 sources；完整读取批准记录，
校验 status=approved、文件哈希与当前输入，继承 approvedShotsPath 中的分镜内容，仅继续视觉设计和
素材接入。contextPaths 中较早的 approved:false 记录是历史状态，不覆盖这次精确绑定的新批准。
完成时 validate 额外传 `--approved-shots <approvedShotsPath>`，不允许批准后重做画面/素材选择。

外部任务标准文件名：

- `packageRoot/final.md`
- `packageRoot/shots.json`
- `packageRoot/plan.md`
- `packageRoot/keyframe-brief.md`
- `packageRoot/visual-contract.json`
- `packageRoot/keyframes/shot-<NNN>.png`

写成功清单前必须先把可能由模型写出的等价英文字段收敛为本项目 canonical 中文合同，并完成确定性校验：

```bash
python3 tools/package_contract.py normalize --shots <packageRoot>/shots.json --source-srt <sourceSrtPath>
```

仅当请求未提供 `sourceSrtPath` 时省略 `--source-srt`。提供 SRT 时，每镜 `锚点口播` 必须直接复制
其中连续、按序的实际字幕原文；定稿文案仍用于叙事和视觉设计，但不得拿改写后的定稿句替代实际口播锚点。
这一步只规范化结构字段并校验锚点，不得自动改写锚点口播或分镜内容。必须在规范化后重新计算 `shots.json` 的 SHA-256；
命令失败时写 `state=failed` 和具体错误，不得继续写成功清单。

完成后先运行只读验收：

```bash
python3 tools/package_contract.py validate --shots <packageRoot>/shots.json --source-srt <sourceSrtPath> --motion-receipt <packageRoot>/motion-execution-receipt.json
```

未提供 SRT 则省略参数。失败不得写成功。完成后按协议写 `result-manifest.json` 到 `resultManifestPath`。清单必须包含实际文件绝对路径、
SHA-256、角色和校验状态；不能把 Agent 汇报当作文件证据。失败时写 `state=failed` 和具体
`errorCode/message`，不得写伪成功清单。

## 声音设计

完整读取 `config/sound-design.md` 和 `docs/sound-design-contract.md`。新 package 每镜先决定希望观众听到什么效果，再匹配现有库或模板声音候选；明确留白同样算设计。顶层 soundDesignVersion=1，每镜 soundDesign 写 decision/reason/cues，cue 保留稳定 id、role、intent、anchor、event、texture、priority。不选最终音频、不估绝对秒点。沿用“声音意图”人话摘要，在 plan.md **加粗声音设计及需增加的音效/素材**，纳入本期分镜同批批准；不能另加重复确认。真实时间、实际音效文件和可编辑音轨由 broll 交付；模板候选不能覆盖本镜 silence 或显式 cues。

## 目标与边界

本阶段把定稿变成可执行的分镜、完整视觉设计和逐镜关键帧。它不搜图库、不选曲、不写绝对时间码，且**不渲 mp4**。真实时长只来自终稿录音，留给 `$content-broll`。

`coverage` 默认 `hybrid`；用户明确说“全broll / 全覆盖 / 无真人出镜”时取 `full`。`full` 的视觉生产镜不能跳过视觉合同或关键帧；纯原始素材镜不强造动画合同。full 开工额外读取 `docs/broll-methodology.md` §11，按并列方案处理。

## 0. 先找同一期上下文

### 审批与业务分支（飞书和 external_job 同样适用，优先于后文笼统要求）

- 先把逐句完整口播、是否 B-roll、画面、具体来源、真人区段、缺失素材回写飞书（`package_io.py commit`），标“待用户批准分镜”；external_job 返回 `waiting_approval`。本期批准后才派发关键帧。继承风格不免内容审批，早期试稿不能反推批准。缺脚本 ID 但授权创建时走既有登记 I/O 并回传飞书链接，不只编本地 ID。
- `🤖动效` 不设固定镜数或占比上限，按逐镜必要性、理解成本和整片节奏决定；说明每镜帮助理解的具体关系，不因数量把合适动效改成低效果素材。
- 每镜必填布尔 `金句`，来自正文 `> ⭐【金句】`；未标 false，不编金句。金句可静止、运动或人物后方强调，按本期表达设计，不强制定格/减法。金句和 `声音意图` 传给 broll 安排声音留白。
- full 禁止 `✂️景别切` 和回真人的 `动作切`。多句持续演进只记一镜，锚点覆盖连续全文，不逐句翻页。hybrid 核心结论、情绪转折、CTA 优先回真人；full 按表达选择留白或有目的的变化。
- `🤖运镜` 须有 `源图` 绝对路径，依次找用户图、素材库、官方/公开图；缺图列缺口，文字方案可交、不能派该镜生产。broll 可按功能降级图库或录屏，实质设计变化重新审批。录屏填 `requiresPackaging: true|false` 区分纯素材与视觉包装。
- 截图/录屏/文档默认圈注；证据不虚构，意象不设数量上限，但不得充当证据。开头画面与前 2 秒口播一起设计；约 5–8 秒推进仅作节奏自检，不机械切镜。旧 `🎬` 行可作起点，功能保留、形式动作可改判；不恢复用户删掉内容。
- 完整读取 `config/sound-design.md`，声音意图用 3–5 行人话写气质、金句/结论留白、叙事转折换曲和必要音效，不写绝对秒数、不选曲、不输出能量代码。

hybrid 明确“跳过关键帧”时写 `skipKeyframes: true`，保留文字关键帧描述并跳过 §3–4；没有动效/运镜/录屏包装也不强造合同。full 中需要视觉生产的镜头不能跳过关键帧，说明原因后仍按关键帧流程执行；纯原始素材镜不要求动画合同或关键帧。已批准 hybrid 文字方案可落库，但需渲染且跳过关键帧须标 `renderReady: false`，先回 package 补合同/关键帧。单镜关键帧失败可 null 并报缺口；full 视觉生产镜重试一次仍失败停止交接；候选失败所有模式均重试一次后停止，不能自动代选。

交接执行 `package_contract.py validate --shots <shots.json> --stage package`。只有渲染就绪分支才用 `--motion-receipt` 验真实派发；文字方案不伪造回执。external_job 文字完成未就绪返回 `plan_only`，不写渲染成功；调用方不支持时报告协议缺口。已有审批/哈希/receipt 校验继续保留。

external_job 未提供 basePackageRoot/contextPaths 时，也要在本仓库 `workspace/package/` 检查是否存在
同一口播的 final/plan/approval 文件（先按标题和独特原句找候选，再完整对照正文；不能仅取最新目录）。
记录匹配依据与原审批状态；同一期既有的录屏、来源、导航和真人安排要参与本次判断，不得因为入口
没有飞书脚本 ID 就将已讨论的方案清空。存在歧义时在方案中列明，不擅自继承其他期的合同。

## 1. 取定稿与切镜

1. 从用户请求提取 `SC-XXXX` 和补充描述；缺脚本 ID 且未授权创建时一次列全缺项；已授权创建按上方合同登记。external_job 使用 finalScriptPath，不要求脚本 ID。
2. 运行 `python3 tools/package_io.py fetch --id SC-XXXX`。状态不是“已定稿”时停止，不继续派发。
3. 只把 `workspace/package/{脚本id}-final.md` 当正文准源。
4. 读取 `docs/broll-methodology.md` 的 §1、§1.5、§2；按意义推进切镜，不按固定秒数切。
5. 每镜先判叙事功能，再判形式，最后判动作；在读模板菜单前写具体对象、关系、起始状态 → 关键变化 → 结束状态及对应口播锚点。锚点口播必须是定稿精确子串，相邻镜不重叠；所有锚点按序拼回去要覆盖需要设计的正文。
6. `full` 模式里，没有新功能的句子并入上一镜持续演进；核心结论、情绪转折和 CTA 可用留白或有目的的运动强化原意，不能虚构新事实。

写 `workspace/package/{脚本id}-shots.json`。顶层至少包含 `脚本id`、`coverage`、`visual_contract`；逐镜至少包含锚点口播、叙事功能、形式、动作、理想画面、创意方案、关键帧描述、切法、估算时长意图、`keyframe`。

## 2. 先做路由，不找素材

1. 递归列 `素材库/` 文件名，逐镜做语义匹配；命中只记绝对路径和路由理由。
2. 现读 `../studio/docs/presets/MENU.md`，按已设计的理想镜头逐镜比较 preset 的语义关系、对象结构、构图、运动过程、口播节奏和风格；槽位能装下文字仅是技术条件，不缓存、不复制对方设计规则。
3. 路由类别：个人素材、自己录屏/实拍、官方页面/截图/公开影像、自制动效/图表、图库、AI 图/视频。动画与真实素材并列比较，按 `docs/broll-parallel-options.md` 给用户选一种或两种；类别顺序不表示优劣。
4. 改判形式时功能不变；证据镜不得改成虚构界面。

### 分镜内容自检与结构化路由

每镜记录 `必要性`：这镜新增的理解/证据/节奏功能，为什么不能保留真人。`功能`（接受 `叙事功能`
等价字段）必须使用方法论 §1 的十种功能，不能用“第一步选题”“本片实证”等内容标题代替分类。
`形式` 使用现有六种枚举；`overlay/immersive` 只填 presentationMode，不代替素材形式。

`素材路由` 填 `route`、`source`、`status: available|missing|planned`。
route 使用本节类别名称（最后一项统一写 `AI图/视频`）。按表达适配、真实性与实际获取条件比较合理方案，
不强制固定来源排序；旧 higherPriority 作为历史元数据保留，新方案无需逐项排除所谓更高优先来源。
需要但尚未取得的真实录屏/网络素材使用 `missing`，同时填写 `acquisition`（录什么页面/操作，或
查哪个官方来源/搜索词）。package 不实际搜图库；此处只写素材预告与取得建议。不得因尚未取得就
静默改成虚构图形。证据位仍遵循方法论的真实来源硬约束。

plan.md 的动画镜按“最佳效果主方案 → 可行模板方案 → 效果差距 → 推荐与风险”并列呈现，包含具体状态变化、真实 preset ID、定制收益与制作负担，合并进本期分镜审批。完整适配且效果相当的模板可推荐复用，无收益的定制写不建议；完整适配但定制有具体可见收益时仍可选定制。核心镜头内部比较两种不同表达；用户无需提供参考片，陌生题材由 Codex 按需研究并实际查看公开资料，记录来源与未核验部分。

plan.md 必须对照全文列出真人区段、插片区段、必要性和缺失素材；导航与具体实例分开说明。
不是强制多加导航或规定固定镜数。用当前方法论审查每个插入点，不将 hybrid 做成全片贴动画。

写完 shots.json 后、任何关键帧之前执行：

```bash
python3 tools/package_contract.py normalize --shots <packageRoot>/shots.json --source-srt <sourceSrtPath>
python3 tools/package_contract.py validate --shots <packageRoot>/shots.json --source-srt <sourceSrtPath>
```

未提供 SRT 则省略参数。该检查只拦可确定的分类/路由遗漏，不能替代逐镜内容判断。

## 3. 写 keyframe brief

先 `python3 tools/broll_canvas.py probe --video <主视频>`，交对方冻结 `sourceVideo`、`sourceCanvas`、`canvas`、每镜 `output`；明确目标比例才加 `--aspect-ratio`。只有音频/封面不能猜画幅，缺主视频或目标比例一次问全。每镜记录 `presentationMode: overlay|immersive` 及 `presentationReason`；短标题/关键词/简单类别/图标优先 overlay，复杂关系/证据/章节切换才 immersive。full 无真人时选符合无真人要求的呈现。

叠层须真 Alpha，保留脸、手势及字幕空间，不能淡化整页冒充叠层；要求真实口播合成预览。强调文字绑定语义入场，不首帧预埋、不提前放后文结论。当前对方 motion-broll 的 Alpha 接口缺口见 broll §3，不能以不透明片段替代。合同返回后运行 `broll_canvas.py check --video <主视频> --contract <合同>`；比例不符返工，不拉伸/黑边蒙混。

写 `workspace/package/{脚本id}-keyframe-brief.md`，顶部必须包含：

```yaml
animation_design_standard: ../workflow/docs/animation-design-standard.md
dispatch_phase: keyframes-only
scene_context: talking-head-insert
creative_priority: expressiveness-first
profile: visual-max
safe_area: 按主视频画幅与平台指定；仅竖屏抖音用 douyin-vertical
facts.mode: exact 或 illustrative 中的确定值
```

批次视觉规格现读 `../studio/docs/describe-spec.md` §6.1，只采集用户明确值、上期已冻结合同值，其余留空让对方记录假设。每镜附理想起始/变化/结束与口播锚点、模板表达差距、定制收益、推荐和已选路线及风险，再附叙事功能、动作、类型、理想画面、创意方案、关键帧时刻、焦点、`startAnchor`、`endAnchor`、屏幕文字/关键数字、口播原文和源素材绝对路径。

需求单不写时长秒，也不复制字体、配色、版式、动效或质量门禁规则。

## 4. 调用 visualization

先一次性检查以下文件；缺少任一项就列全并停止跨仓库派发：

```text
../studio/AGENTS.md
../studio/.devin/skills/motion-broll/SKILL.md
../studio/docs/agent-runbook.md
../studio/docs/visual-first.md
```

分镜内容批准后，用本仓库的确定性派发器进入 Visualization 调用完整 `$motion-broll`：

```bash
python3 tools/dispatch_motion_broll.py --brief <packageRoot>/keyframe-brief.md --output-root <packageRoot>
```

需要“只出候选”时使用同一命令加 `--phase candidates`，返回 `motion-candidates-receipt.json`
和真实候选图，不要求也不冻结合同。选择完成后用默认 keyframes-only 再次派发。
该工具只传递 brief、调用进程并记录回执，不决定视觉方法。禁止在本仓库手写通用 TSX/合同后只调用
Remotion 或末端 validator 冒充 `$motion-broll`。返回的 `motion-execution-receipt.json` 必须保留并列入
结果清单 files，关键帧和合同须与该回执的 SHA 一致。已有试稿需使用新 packageRoot，不混写旧批次。
不得读取 benchmark 目录作为代码、合同或模板。模板的比例适配、draft 门禁和复用决策交由
Visualization 当前 skill；draft 不享受快车道不等于禁止复用，不能据此整批改为手写 custom。

视觉路线：

- A：有可继承合同且用户没要求换风格，校验后直接出逐镜关键帧，不停。
- B：效果比较后本期方案选择原生模板的镜头，展示真实文案接触印张；不能按模板候选命中数量跳过定制设计。与定制候选合并在同一次视觉选择中。
- C：首次或换风格，先返回真实 Styleframe 候选；在当前会话展示图片、摘要和推荐，等用户只选一次。

选择完成后再次调用 `$motion-broll` 的 `keyframes-only` 阶段：冻结并运行 `node tools/validate-contract.mjs <合同>`，逐镜路由引擎并渲代表关键帧。核心多阶段镜另出起始、关键变化、结束的状态帧，检查对象身份、焦点、遮挡和变化能否成立。必须返回 `visual-contract.json` 绝对路径和逐镜关键帧 PNG；**不渲 mp4**。同批展示可行模板与定制不等于自动渲两套；未选方案留比较记录，不写入正式已选路线。

把关键帧复制到 `workspace/package/{脚本id}-keyframes/shot{镜号}.png`，回填 shots 的 `keyframe`；把合同绝对路径回填顶层 `visual_contract`。`full` 模式任一关键视觉镜缺关键帧或合同校验失败时重试一次，仍失败则停止落库。

## 5. 前后镜设计

每镜必须填写 `切法` 和首尾锚点：匹配切、动作切、硬切、景别切、声音先行或无。连续动效镜的 `endAnchor` 必须能成为下一镜的 `startAnchor`；若故意断开，要写清是节奏重置。关键帧验收同时检查真实渲染画面、批准的状态变化设计和前后镜衔接，不只看孤立静图；明确动态尚未验收，评分和文件校验不能证明艺术质量，不为检查提前渲 MP4。

## 6. 落库

写 `workspace/package/{脚本id}-plan.md`，从 `###` 小节开始避免 commit 双标题。分镜表写完整原文、画面、切法、显著标为字数估算的时长意图；金句标 ⭐；full 覆盖全文、画面无空白，持续镜写演进、退让镜写减法。视觉规格记录 A/B/C 路线、选中方向、用户/上期确定项与留空假设项；只有实际生成才列关键帧，未冻结不能声称风格已冻结。声音意图、素材预告写录屏要录什么流程、AI 要什么画面、素材库路径及各路由数量，不提前写详细操作或 AI 提示词。路由记录含改判理由、引用行来源“原有 N 行/补写 M 行”；full 附动效占比、AI 镜数、退让位置。标题封面只在用户要求时给推荐/备选，明确选定新标题才加 `--title`。区分待审批、文字完成未就绪、关键帧完成，再运行：

```bash
python3 tools/package_io.py commit --id SC-XXXX --section 创意方案 --package workspace/package/{脚本id}-plan.md
```

汇报覆盖模式、分镜数、视觉路线、合同路径、关键帧目录、缺失镜头和下一步：录完终稿口播后调用 `$content-broll`。

## 外部视觉候选回传

内容已批准、但仍需用户选 Styleframe 或 preset 接触印张时，调用派发器 `--phase candidates`，
将可选方向整理为整批候选（每个候选标明包含的 preset 选择），返回 `state=waiting_selection`。
结果仍包含已批准的 finalScriptPath/shotsPath/planPath，另加 `choices:[{id,label,previewPath}]`。
每个 previewPath 是真实候选 PNG，必须在 files 中有哈希；不冻结、不写 succeeded。工作台展示
真实候选图片并让用户选一个整批方向。不能把“无人工选图入口”解释成任意自动选。

续跑请求的 `visualSelectionPath` 指向 status=selected 的选择记录，记录 selected（id/label/previewPath）
和所选批次 files 哈希；记录本身和这些文件全部位于 sources。先核对已批准内容及候选文件 SHA，
继承用户所选方案，在新 outputRoot 内完成 keyframes-only。不能把视觉选择当成重新批准分镜，
也不能因为新目录而重新从零生成风格。没有候选需求的继承路线直接进入关键帧。

## 统一产物位置

执行前读取 `docs/artifact-layout.md`。统一入口 `../output/<SC-XXXX>/` 只放可直接使用的资源，分类目录内平铺中文内容名文件；无内容不建目录。合同、报告、日志、工程与旧版本留在仓库 workspace 或隐藏 `.制作资料`。内部验收后同步可用资源到用户目录，不再放 README 和制作流程目录。

## 有真实输入时提前设计效果时间与镜头意图

本节优先于下文 package“不写绝对时间码/不估秒点”和 broll 才设计时长的旧表述，仅限已绑定真实主视频及共享原始 SRT。先设计最佳效果主方案，再比较模板/定制；package 就设计起始、变化、停留、结束及景别/推拉意图，纳入既有整批内容审批，仍只做关键帧。只有脚本时保留语义 anchor 和状态顺序，不编秒数。口播关联区间不等于效果使用时长，不用整句字幕区间自动填满特效。

每镜可写 `effectTiming`（source 秒）：`{status:"draft",sourcePath,startSeconds,changeSeconds,holdSeconds,endSeconds,evidence:{sourceSha256,transcriptHash,sourceCueIds,reason}}`，细则见 `docs/package-effect-timing.md`。必须用当前源身份、SHA 绑定的共享 SRT、连续真实 cue 和完整对应原文；有限非负秒点有序，结束晚于开始。不得重复上传或 ASR。效果可只占关联口播的一部分，不能因此截断 narration anchor。草案仅映射计划尺供审阅，不能据此直接渲染或自动批准。已有手调及实际绑定素材区间优先；显式效果设计可替换口播关联 ranges，原 narration anchor 保留。

`cameraIntent` 写语义锚点、目的、景别/推拉及起止状态；`presenterLayerIntent` 写前后景关系（如 `placement:"behind-presenter"`）、理由及人脸/手势/字幕避让。这些对象原样进入 canonical package、当前 productionPlan 和 broll 输入，不把计划意图冒充已完成 cameraPlan 或已验证人物抠像。broll 继承批准意图，以实际录音、动画事件和真人合成精调/渲染；confirmed 仅由明确实测时长确认产生。用户已批准取消本批列举的创作限制：动效固定镜数/占比、金句只能定格、意象次数、固定来源排名；真实性、画幅、同步、可读性及审批继续执行。

人物后方强调是可选表达候选，不要求每条金句都采用；也可用于未标记金句的重要概念。不设固定次数及表现形式限制；full 无真人定义保持。
