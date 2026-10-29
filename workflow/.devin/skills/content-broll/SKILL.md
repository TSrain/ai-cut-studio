---
name: content-broll
description: 终稿口播真实时间轴、原生模板与素材执行入口。复用 package 语义需求和共享 SRT；素材识别建议并自动并列入轨，不定制动画、不另建 Claude 提示词、不等待 Claude。
---

# content-broll — 真实时间轴、模板、素材与可编辑工程

Package 规则唯一准源：../workflow/docs/complete-package-contract.md（本文件不重复）。

## 当前默认入口：semantic-template-v1（完整执行后结束）

新 broll 和当前工程 worker 执行本分支，不要求动画分镜/模板审批、Styleframe/接触印张或关键帧选择，不由 Codex 定制动画、不自动调用或等待 Claude。明确续作旧冻结作品才读下方历史兼容流程；当前语义计划缺旧 designIntent、motion 回执不是回退理由。

明确导入 Claude 交付清单时，走 `--kind recognize --delivery-manifest` 的确定性导入，执行下列第 6–8 项；第 1–5 项是 broll 制作支线，不成为清单导入前置要求，不为导入补 package、SRT、ASR 或模型识别。

1. 先读根 AGENTS、`docs/animation-design-standard.md`、`docs/visual-design-contract.md`、`docs/artifact-layout.md`、`config/sound-design.md` 和 `docs/sound-design-contract.md`。visualization 的 AGENTS/motion-broll/runbook/visual-first 仅执行新分支。当前工程用 editor_plan.py read，只有SC用discover；唯一绑定才用，不猜最近。自然对话用 `jobs --project-id <ID> --kind broll` 并跟踪；主worker读external_job/SHA快照，不重建整期任务，新模式可按runner补专项，不飞书回读覆盖当前计划。
2. 读取当前 productionPlan 和 `package-contract.json` 的 semantic-template-v1 需求、模板匹配及总结。无语义分析时先走 `$content-package` 新分支；不重建旧具体画面方案或批准记录。broll 不另建、复制或维护 Claude 提示词，唯一交接在 package 总结末尾；源文件实质变化时通过 package 更新同一末尾区块及版本依据。Claude 未制作/回传不阻塞本次其他任务，提示词就绪不等于外部动画完成。
3. 复用 `tools/transcribe.py` 共享真实时间码。已有 sourceSrtPath 登记复用，不上传或重复 ASR；验证音轨及时间原点，剪切/变速/换音轨不能沿用旧码。以实际 SRT 和工程 source.clips 映射对齐，手动区间优先，删除口播不回填，不按字数声称逐字精准。单镜只处理明确 shot/slot/instance/range，scope.camera/sound=false；全期按本次 scope，不把单镜请求扩成全片制作。
4. 在已有需求不变前提下执行本地原生模板和本次授权素材、字幕、口播镜头/声音任务。模板只填已有 preset/props；增加动作、改组件或结构一律留给 package 末尾 Claude 提示词。direct 和有实际价值的 partial 经技术检查自动应用，明确 partial 缺口。原生可编辑实例无需强制先渲成 MP4。媒体检查真实性、下载实际分辨率、时长、画幅、可解码与 Alpha；候选链接/未生成 AI 素材不能标已制作。networkMode=candidates-only 按模式收集真实链接，不能擅自下载或付费生成；其他已授权下载原始素材短边至少 720px、优先 1080p，宽松保留候选。
5. 口播镜头支线复用现有 `$aroll-enhance` 和当前editable source.cameraPlan；主控完成本次视觉/字幕/镜头等实际应用回读后，最后按真实事件处理独立音轨声音。不重复转写、不烧进模板、不机械配声。已存在推拉不能再叠同一计划重复变焦；仅执行授权范围，单镜不扩展。事实/否定/数字有实质歧义集中报告，其他项继续，不设动画方案审批。
6. Claude 交付清单优先：Claude 交付真实媒体及 `animation-delivery.json`（`schemaVersion: 1`、`timeBase: "project"`；当前工程时间轴零点），每项包含 `file`、`startSeconds`、`durationSeconds`、布尔 `transparent`。文件可相对清单目录或为绝对路径；`projectId`、`sourceVideoSha256` 可选。起点、时长和跨段合镜由 Claude 自定，不必绑定原 shotId；相关段 ID 只作信息关联。详见 `docs/animation-delivery-manifest.md`。有交付清单时以清单秒点为唯一定位依据，经不可变快照及文件、时长、工程边界等技术校验后，直接追加独立实例和最上方独立动画轨道；不重新按 SRT/模型/抽帧匹配，不检查是否符合原分镜或旧视觉形式，不为塞旧模板区间拉伸、循环、定格或裁剪。清单错误明确报技术错误，不静默退回识别猜位置。`transparent: false` 按完整画面覆盖人物画面并保留工程原声，允许视频自带人物；旧 overlay 要求不再强制其 Alpha。`transparent: true` 可核验实际 Alpha 并透明叠加，属于技术检查。仅无清单时走原探测、解码、抽帧和当前计划内容匹配；不能凭文件名或编号猜定位。保留全部旧模板、素材、手调、锁定和显隐，独立轨道供用户开关删除，不标最终采用。重复导入幂等，已删除/忽略不恢复，新版本独立追加，并发时重读并 CAS 保存。

   控制台制作计划可输入交付 JSON 绝对路径；CLI 使用 `--delivery-manifest`。直接导入媒体路径时，先在原媒体同目录发现 `animation-delivery.json` 再归档，避免相对文件引用丢失。清单导入不强制补 SRT、独立 ASR 或模型核验，也不新增动画审批。
7. 工程写入走同一提交层，worker 输出原子 progress 和完整 manifest，plan、template、media 的实际核验分别记录；不直接改活动工程 JSON、派生 Markdown或旧包，不创建平行 composition 工程替代当前工程。没有可用时间/连接报告 plan_only/输入缺口，局部技术缺口 partial；动画分支不得 waiting_approval/waiting_selection。完成需工程保存和实例回读证据，原生预览供用户直接调整删除。
8. 返回控制台及既有 package 总结入口，列实际模板/素材入轨、待外部媒体、技术缺口、观看/听审范围。无清单 overlay 的实际 Alpha 与真人合成检查继续；清单按 transparent 声明核验技术条件，不重新匹配内容；真实尺寸/时长与文件可用性继续；测试、verified 或静帧不等于动态/听感/全期通过。入轨不等于用户最终采用；满意后模板沉淀另开任务。

**执行到此 return；不继续下方旧定制动画派发、内容/视觉审批或另外建立 Claude 提示词。**

## 历史兼容分支（不属于 semantic-template-v1）

以下仅供既有旧合同的明确续作或独立历史任务使用。新 package/broll 已在上方分支执行并结束；不得继续落入下面的审批、视觉设计、派发或回执要求，不自动重做旧作品。

# content-broll — 真实时间轴、镜头切换与逐镜成片

## 效果优先，忠实执行批准方案

按 package 的最佳效果设计制作：定制、组件复用、原生模板都是实现方式，不按省时或目录命中自动排序。已批准的 `designIntent`、对象变化、路线及选择原样继承；模板候选存在不等于选定，不能重匹配覆盖 custom。没有批准设计时回 package 先出最佳效果主方案与可行模板并列比较；不在 broll 私自补一套模板代替设计。用户只选一套就生产一套，两套都批准才分别制作与验收。

把批准的语义 beats 映射到共享真实转写，另存秒点、来源及核对状态；长句字数插值仅用于初排，不声称逐字精确。核验音画时间原点；连续播放、原声/音效听审、小屏可读性分别验收。只有关键帧、间隔截图或工具无法听音时如实留待验；技术通过、模板 verified 和播放器播完不替代质量判断。

输入提示：`SC-XXXX <终稿口播音频路径> [已剪成片路径/素材偏好]`

先读取 `docs/animation-design-standard.md`、`docs/broll-parallel-options.md` 及 package 的 visual-options.json（如有）。新制作同时执行 `docs/visual-design-contract.md`：顶层 `designIntentVersion: 1`，需视觉制作镜头填写完整 `designIntent`（goal、concept、states.start/change/end、beats 的 id/anchor/action、focus、presenterRelation、templateOptions、customOption、recommendation、acceptance、risks）。brief 与返回合同原样保留版本和对象，真实秒点另存，不改 `beats.anchor`；旧合同不强制补字段。按批准选择并列推进动画生产和真实素材获取；下文章节序号不要求先完成动画再找素材。原始素材最低短边 720px、默认保留多条候选供用户筛选，动画与真实素材分别验收和报告；旧 package 没有双方案选择时不擅自补做动画，按原审批范围执行。

**纯真实素材分支：** 没有动画/运镜/录屏包装时，仍读取批准分镜并执行时间轴与素材获取；下文 visual-contract、Visualization 前置检查、渲染和 review/continuity 门禁仅适用于需渲染的镜头。原始候选以下载文件、探测记录、预览及来源清单验收，不伪造动画回执。external_job 调用方若强制要求动画合同则报告协议缺口，保留实际素材交付，不把它标成动画渲染成功。

## 推荐版自动组装

同时读取 `docs/broll-composition.md`。在批准范围内，Codex 自行推荐纯动画或素材版；素材按表达效果比较网络与 AI 等来源，选 AI 时给简述及详细提示词，由用户生成回传。对每份素材独立设计取景与入场。使用真实口播秒点生成 composition.json；原生模板动画保留可编辑 props，定制动画保留源码工程、合同、实际媒体与可编辑范围，不伪造 preset/props，也不为了组装接口改成低效果模板。素材引用本地文件；未生成标 pending。接口暂不支持该定制工程时明确接入缺口，保留实际产物，不称已原生可编辑。

完成媒体准备后执行 `python3 tools/broll_composition.py compose --manifest <composition.json> --output <本期交付目录> --collect --serve --port 4325`。读取 editor-receipt.json 后打开其 URL 预览：时间轴仅装推荐版，文档保留全部已产出的动画/素材备选、文件、参数与提示词；不能只列推荐版。缺 AI 文件先预排待素材槽，回传后重跑绑定。保护手动修改，冲突和缺口如实汇报。正式渲染仍走 visualization 队列与质量门禁，组装成功不等于成片完成。将交付与备选.md 链接合并进既有素材包飞书回写。

## 口播镜头推拉（默认集成）

本期有真人主视频时，默认同时调用 visualization 的 `$aroll-enhance` **仅镜头支线**。复用已读取的终稿、`sourceSrtPath`/本期 transcript.srt、真实 timeline、已批准 B-roll 时段和现有节奏审查记录；不重传、不重复转写，不把字幕文本冒充听审。明确仅做素材、无主视频或用户关闭镜头时跳过并说明。

执行前读取对方 `.devin/skills/aroll-enhance/SKILL.md`、`references/shot-switching.md` 和 `docs/aroll-camera-style.md`，由 visualization 维护唯一选点与渲染规则。进入对方目录后，按语义生成 version=2 shot-plan.json，完成 check、代表试片、apply 和原声音轨/时长/构图验收。复用已完成的真实节奏检查，仅对本次候选镜头补充必要检查；不得声称未听音频。已有沉浸式 B-roll 遮挡和烧入口播的合成预览区段保持 A，避免回到人物时倍率跳变；透明叠层本身不跟随推拉。镜头视频写新文件，不覆盖原片，不默认新增字幕。

自动组装必须把原始主视频作为 `composition.json.source.path`，将同一 `shot-plan.json` 内容放入 `source.cameraPlan`。控制台、预览和导出使用该计划；不能把已经烧好推拉的视频再作为带 cameraPlan 的底片，否则会重复变焦。单独交付的推拉 MP4 供剪映使用。已有人手调整的工程保留，改计划或主轨时用新工程 ID，或按原保护机制报告冲突。

向 visualization 传递：scriptId、projectRoot、原视频、已有 SRT/时间轴、真实节奏检查证据路径、B-roll 遮挡区间、仅镜头支线。回收：shot-plan.json、独立口播推拉视频、技术及视觉审查记录、可编辑工程入口。推拉成片放可见 `成片/`；计划与记录放内部目录。此分支通过不代表其他 B-roll 缺口完成。

## 普通对话也读取当前工程

本节适用于没有 external_job 的自然语言请求。用户明确提供 4358 projectId 时，先运行
`python3 tools/editor_plan.py read --project-id <ID>`，用返回的最新 productionPlan 作为内容准源。
只有 SC-XXXX 时先运行 `python3 tools/editor_plan.py discover --script-id <SC-XXXX>`：唯一绑定才
使用该 projectId；多个匹配一次让用户选择，禁止猜最近工程；返回 unbound 才进入下文原独立内容流程。
服务不可达是缺连接，不能据此断言没有绑定；列出缺项，不直接改旧 package。
发现只读取已保存工程 JSON 的绑定元数据，不枚举、读取或分析用户所有私有素材。

已绑定工程的计划修改统一使用 `editor_plan.py edit/action/import` 的同一 CAS API；当前计划 Markdown
是派生视图，不能直接修改它来当作工程准源。保存明确内容修改后，用
`python3 tools/editor_plan.py jobs --project-id <ID> --kind broll` 启动完整本技能 worker；
本技能在 worker 收到 external_job 后继续完整业务步骤，无重复 discover 或递归派发。
单镜请求显式传 --shot-id/--slot-id 及必要 --instance-id/--range-id；无目标不能猜。
审批与视觉选择用 `approve`，然后 `jobs --kind broll --resume-job-id <上次任务ID>`；
等待状态真实持久化，风格继承不替代本期内容审批。重做保留当前手调、实际素材和版本，旧包仅历史。

## external_job：工作台本地作品入口

### 4358 当前工程模式

当前素材发现使用 snapshot.catalog / external_job.materialCatalog 的 project 与 shared 两个 scope；
统一目录是准源，不能把隔离 checkout 素材库为空当作共享库没有素材。只对当前任务相关记录读取
实际文件，保持 private/project 与 shared 身份，禁止整库无关内容分析。recordedScriptUnconfirmed=true
表示仅有真实录音复用的原始转写：它是未定稿草案，须先返回正文/分镜待批准，不能直接冻结视觉。

含 projectSnapshotPath/projectPlanPath 时，先完整读取 SHA 绑定的工程最新计划和
`docs/workbench-external-job.md` 的 worker 合同；仍调用本技能全部阶段。旧 package/飞书仅历史，
不覆盖当前要求，不扫描“最近一次结果”。保留稳定 shotId/slotId、需求版本、备选及当前审批。
当前批准内容缺 canonical 意图或视觉依赖失效时先返回待设计/待批准，不伪造旧批准。

原始转写统一走 tools/transcribe.py 共享缓存：sourceSrtPath 已有则登记复用，无则 canonical aligner
复用同音轨缓存；不因新工程或 outputRoot 更换重新上传识别。数字、否定、事实与结论变化集中确认，
不确定镜保持待对齐。真实原片秒点按 source.clips 映射到剪辑位置，保留手调，删除片段不回填。
单镜 projectTarget 精确指定 shot/slot/instance/range；targetRange 是当前实际采用位置与真实时长，
覆盖原始锚点估时。多实例未指定则返回缺项。只制作目标，检查必要前后衔接，scope.camera/sound=false；
不重做全片推拉、字幕或配乐。全期按 scope 保留本次授权的镜头与声音范围。

每项完成按 progressDirectory 原子写结果，worker 真实核验后交服务，不等整批完成。媒体结果提供
实际文件、native preset/props 可编辑参数（有则保留）、素材入出点、目标、技术 probe 与内容帧证据。
逐张目检 contentReview 写观察文字、mediaSha256、真实 frames 哈希，不用 validated=true 代替。
overlay 保持实际 Alpha MOV/ProRes4444 和真人合成预览，不强制 H264/MP4；hasAlpha 与视觉目检独立。
继承完整原生 render/review/continuity 门禁；一镜通过不等于全期通过。

networkMode=candidates-only 时检索真实候选链接，适用镜宽松给五条以上供用户下载筛选；不足报告缺数据，
不伪造、不自动下载、不把链接算实际到位。AI 交完整提示词、时长、画幅及目标槽位，用户外部生成。
不调用旧 composition compose 创建新工程或直接覆写既有工程；交 composition/preset/媒体供 4358
统一提交层校验填空槽，保留手调占用与未知归属的集中确认。
visualization 路径优先用环境 VISUALIZATION_ROOT，未设用既有桌面根；所有当前技能/门禁从该根现读。

收到 `external_job: /绝对路径/job.json` 时，先完整读取 `docs/workbench-external-job.md` 并校验
`version=1`、`phase=broll`、`finalScriptPath`、`audioPath`、`videoPath`、`packageRoot`、
`outputRoot` 和 `resultManifestPath`。所有路径必须是绝对路径；所有新产物必须位于
`outputRoot` 内。`packageRoot` 必须含 `shots.json`；需动效/运镜/录屏包装时才要求 `visual-contract.json`。hybrid/full 纯原始素材或声音任务可无合同，按 §0 分支执行；full 实测时长审批仍保留。

可选 `sourceSrtPath` 是调用方已有的带时间码字幕；提供时校验绝对路径及 `sources` 哈希。
可选 `modification` 包含 `shotId`、用户原话 `instruction`、旧成片 `sourceVideoPath` 和
`baseResultManifestPath`；基线清单、旧成片及清单引用的全部文件都必须列入 `sources`。单镜修订
仍读取同一 `packageRoot`、真实时间轴、目标镜及相邻镜合同，
由本 skill 决定如何修订并完成原生门禁，不得退化成调用方或单独 Visualization 直调。

单镜修订必须返回与批准 package 镜头 ID 完全一致且顺序一致的完整结果清单。只允许重新制作
`modification.shotId`；其余镜头从 `baseResultManifestPath` 原样复制或引用，逐镜视频 SHA-256
必须与基线相同，禁止重渲。目标镜交付容器扩展名必须与 `sourceVideoPath` 相同；需要换容器时停止，
要求调用方重新生成并批准 package。

**外部任务模式只替换飞书 fetch/commit**：不运行 `package_io.py fetch/commit`，其余步骤
全部原样执行。真实时间轴必须使用 canonical 工具的手工路径模式：

```bash
python3 tools/broll_timeline.py align \
  --audio <audioPath> \
  --final <finalScriptPath> \
  --shots <packageRoot>/shots.json \
  --out-prefix <outputRoot>/timeline
```

若任务提供 `sourceSrtPath`，在上述命令追加 `--source-srt <sourceSrtPath>`。该模式直接通过
`transcribe.load_cues` 读取已有带时间码 cues，不上传音频、不创建妙记；无此字段时才按既有
转写流程执行。

需要视觉生产时必须继承 `packageRoot/visual-contract.json`，写标准 motion brief，进入 Visualization 调用
`$motion-broll`，完成逐镜关键帧、视频、review、continuity 和真实输出校验。本项目仍不得
自行实现动画，也不得让调用方绕过本 skill 直接调用 `$motion-broll`。

回收后必须在 `../studio` 逐镜运行：

```bash
node tools/validate-broll-review.mjs <visual-contract.json> <shotId> <review.json>
```

verified preset 由该门禁核验可复用的技术证据，仍须实际连续播放本次全部交付镜头，检查语义表达、口播揭示时点、节奏与可读性；overlay 还须看真实口播合成，记录具体时间段与结论。技术通过不等于视觉验收：review 的
`technical.contract/output/fonts/assets/thumbnail` 必须全为 `true`，并包含 `slots`、`preview`、
`render`、`output` 各一条 `exitCode=0` 的 command 及 `receiptPath`。每份 receipt 必须真实包含
`command/stdout/stderr/exitCode/signal`。custom/draft 由同一门禁调用 Visualization 既有
`validate-review.mjs`，不得由本项目复制其质量规则。

整批再运行：

```bash
node tools/validate-continuity.mjs <continuity.json> <visual-contract.json>
```

全部 command receipt 与 `continuity.json` 中 `boundaries[].frames` 指向的帧都必须进入结果
清单 `files`，记录 SHA-256 与 `validated:true`；任一门禁失败不得写成功清单。

完成后按协议写 `result-manifest.json` 到 `resultManifestPath`。清单逐镜记录 ID、三位小数真实
时长、视频、关键帧、review、preset/custom、引擎和校验状态，并列出 timeline、motion brief、
continuity、素材包和配乐结果。失败时写 `state=failed` 和具体 `errorCode/message`。

## 0. 一次性前置检查

开始前一次列全检查脚本 ID（external_job 免）、音频、已批准 shots。运行 `package_contract.py validate --shots <shots.json> --stage broll` 判断分支：hybrid/full 纯原始素材、未包装录屏或声音任务无合同可继续时间轴与素材，不写 motion brief、不派渲染、不造 review/continuity；full 仍在 §1 先确认实测时长。动效、运镜或 `requiresPackaging: true` 的镜缺合同/关键帧回 package 补设计，不擅自发明风格。运镜须实际存在的源图。

需要渲染才完整读取 visualization 的 `AGENTS.md`、`.devin/skills/motion-broll/SKILL.md`、`docs/agent-runbook.md`、`docs/visual-first.md`，缺项只阻断依赖它的生产，不回退旧 Claude 或 benchmark 路径。所有分支读取 `config/sound-design.md` 并继承 package 的金句、留白、声音意图。

画幅继承主视频：先 `python3 tools/broll_canvas.py probe --video <主视频>`，核对合同 `sourceVideo/sourceCanvas/canvas` 与逐镜 `output`；派发前 `check --video <主视频> --contract <合同>`，回收再加 `--files <全部成片>`。明确目标比例才传 `--aspect-ratio`；只有 MP3 不能猜竖屏。缺主视频/目标比例一次问全，仅暂停依赖画幅的步骤。不得拉伸、黑边或把竖屏缩入横屏。

## 1. 真实时间轴

1. 运行 `python3 tools/package_io.py fetch --id SC-XXXX` 刷新定稿。
2. 运行 `python3 tools/broll_timeline.py align --id SC-XXXX --audio <音频路径>`。
3. 读取 `workspace/broll/{脚本id}-timeline.md` 和 JSON。只有 `degraded=false` 才能称为实测对齐；否则明确标为估算，不做强卡点长动效。
4. 后续逐镜时长使用三位小数，全部来自这份时间轴，不再使用 package 的字数估时。

`coverage=full` 时先展示逐镜真实时长表，标出照做/需精简/需合并，等用户一次确认后才进入渲染、图库和选曲。混合模式不新增这一停点。

确认表含镜号、完整口播、估算→实测、形式、方案摘要、三选一结论；表后写几镜需改及建议。降级也必须确认并标估算。外部异步任务返回 `waiting_approval`，绑定 timeline/shots SHA 和确认表，取得本期时长确认再续跑，不能沿用分镜批准冒充时间确认。用户批准合并/精简后保留锚点顺序无交集并据已对齐句级时间重算镜区间，不重复上传/转写。

## 2. 写最终镜头 brief

写 `workspace/broll/{脚本id}-motion-brief.md`，顶部包含：

```yaml
dispatch_phase: render-final-shots
scene_context: talking-head-insert
creative_priority: expressiveness-first
profile: visual-max
safe_area: 按主视频画幅与平台指定；仅竖屏抖音用 douyin-vertical
visual_contract: /绝对路径/visual-contract.json
```

每镜必须传：真实开始/结束/时长、叙事功能、动作、理想画面、创意方案、口播、屏幕文字、素材绝对路径、package 关键帧、以及：

```yaml
transition_in: 匹配切/动作切/硬切/声音先行/无
transition_out: 匹配切/动作切/硬切/声音先行/无
startAnchor: 主体+位置+运动方向+能量状态
endAnchor: 主体+位置+运动方向+能量状态
previousShot: 前一镜一句话摘要
nextShot: 后一镜一句话摘要
```

镜头超过 6 秒时附句级 `start/end` 节拍。退让镜明确写“不新增信息元素”。brief 只携带内容、真实时长、前后关系和素材，不复制 visualization 的设计规则。

brief 必须重申内容红线：不得在成片阶段加回 package 已删除的重复数字与元数据。继承 presentationMode 及理由；overlay 保留人物，强调文字按对应语义入场，不首帧预埋或提前展示后文结论。

## 3. 调用 visualization 出逐镜成片

motion brief 附 `animation_design_standard: ../workflow/docs/animation-design-standard.md`，继承批准的理想起始/变化/结束与口播锚点、模板差距、所选路线及风险。时限与修复轮数不授权自动降质；无法继续时交当前草稿、缺口、未验收范围和下一步，不称完成。

进入 `../studio`，调用 `$motion-broll` 并传 motion brief 绝对路径。必须：

1. 先运行 `node tools/validate-contract.mjs <visual_contract>`，校验并继承 package 的同一合同，不重跑 Styleframe。
2. 使用 `render-final-shots`，逐镜路由 Remotion / HyperFrames / Hybrid；不得默认全走 Remotion。
3. custom/draft 镜生成首/中/尾关键帧和最终 `draft.mp4`；verified preset 镜可复用已确认的真实
   文案 Preset Preview，至少返回一张关键帧，免重复实现工作和无变化模板的技术审计；全部镜仍须本次连续播放与内容/节奏/合成检查，不能用静帧或 verified 状态代替。正式渲染走
   `tools/render-queue.mjs --concurrency 2`。
4. 连续镜按顺序检查 `transition_in`、`transition_out`、`startAnchor`、`endAnchor`，把结论写入 `continuity.json`。失败边界只返修两侧镜头。
5. immersive 镜按合同真实宽高/帧率规范化后运行（变量取合同，不默认竖屏）：

```bash
tools/validate-output.sh <shot.mp4> --size <合同width>x<合同height> --fps <合同fps> --duration <真实秒数> --dur-tol 0.1 --codec h264 --pix-fmt yuv420p --audio none
```

   overlay 不得套 H.264/yuv420p 规范化：对方现有 `tools/lib/panel-api.mjs` 的 `makeExport({compositionId, props, name, alpha:true})` 使用 ProRes4444→HEVC Alpha MOV，并通过实际品红底合成检测透明；`caption-finalize.mjs` 也有 Alpha 检验。HEVC Alpha 的 ffprobe 可能仍报 yuv420p，不能仅凭像素格式/扩展名断言透明。需要由 `$motion-broll` 接入并返回真实 Alpha 检验证据、合同尺寸校验和口播合成预览；预览目检脸、手势、字幕、可读性，不用独立全屏墨量门槛放大叠层。

   **已知接口缺口（2026-10-08 只读核对）**：motion-broll 当前仍要求全部镜 H.264，尚未统一调用上述 Alpha 导出。不能在本仓库旁路手搓渲染或伪造 review；受影响 overlay 返回具体失败/待补接口说明，保留已完成素材。跨仓库接口修复另行审批后才可声称透明成片链路贯通。
6. 返回每镜实际视频容器（immersive MP4 / overlay 真 Alpha MOV）、代表关键帧、preset/custom、引擎、合同路径、`continuity.json` 和实际验证结果。
7. 逐镜运行 `node tools/validate-broll-review.mjs <visual_contract> <shotId> <review.json>`，整批运行
   `node tools/validate-continuity.mjs <continuity.json> <visual_contract>`；遵守 external_job 段所述
   verified preset 技术证据、custom/draft 既有 review 门禁、回执与 continuity 帧证据要求。

把通过验证的片段复制到 `workspace/broll/{脚本id}-motion/`。本项目不手搓或重编码这些画面，也不声称未通过的镜头已完成。

## 4. 其余素材与声音

- 素材库命中：实际打开检查后才保留。
- 景别切：仅写切法，不找素材。录屏：列具体操作及按真实时长建议的录制长度，已有录屏先抽帧检查隐私、空等、目标动作；需包装才交 visualization。
- 图库：写合法 broll JSON 后运行 `python3 tools/broll.py --script <package.md> --per-beat 8 --candidate-limit 8`；宽松收集时用 `--candidate-limit 0`。按并列方案约定下载、探测真实尺寸、预览并提供候选清单，不再限定每镜主备各一条；链接解析不计文件交付。
- AI 视频：只交首帧图提示词和运动提示词；证据镜禁用虚构画面。
- 图库实际打开预览图/视频页，检查首帧、与口播的关系、画幅适配和动作；不能只看关键词/技术分。宽松保留高清候选并注明适配建议，最终构图和风格由用户筛选；不因单个候选不合格就把整镜改成动画。
- AI 视频提示词含首帧和运动、按真实时长，不冒称已生成。
- 配乐：联网打开可播放页面并实际听预览，1 首主选、最多 1 首备选；每首写曲名、作者、平台、播放链接、授权/署名、适合原因，以及真实时间轴的进入/压低/抽掉/恢复/收尾。金句 true 的每个区间必须进入压低或抽掉列表。无法播放、未听到、授权不明写“未选曲”和原因，关键词不代曲目。音效按 `config/sound-design.md` 与 `docs/sound-design-contract.md` 继承 package 的逐镜 soundDesign；不设全片固定次数，按开头、观点、转折、动画事件的实际表达价值设计。

### 声音落到可编辑音轨

读取 `docs/sound-design-contract.md`，先复用既有转写与工程范围，再解析口播/动画事件，不重跑 ASR。按效果查音效库和模板默认配方，试听并记录来源、许可、实际时长；待试听标 draft，不能 reviewed。显式声音设计优先于模板默认，单事件去重，留白镜不套默认声。

全量 scope.sound=true 或明确授权独立工程声音时，写 sound-cues.json，在 visualization 调用 `node tools/editor-sound-design.mjs --manifest <文件> --url <当前编辑台地址> --out <内部回执> --apply`。必须带当前 projectId/revision/fps/总帧数与批准计划哈希，经同一 load/save CAS API 更新独立音轨。保留手调、删除和锁定轨；冲突重新读当前工程并重新对齐，禁止强行覆盖。单镜 scope.sound=false 不应用全片声音。声音不能只停留在文字清单或烧进 MP4；读取回执确认实际加入，整片导出音轨和真实试听分别验收。缺工程绑定时在已组装工程获得真实 id/revision 后执行，不猜工程。用户只需成片时仍保留内部可编辑源工程。

## 5. 音画复核与落库

连续播放全部交付镜头，检查开头、口播可懂度、语义揭示时点、前后镜切换、安全区、素材是否过泛、全覆盖是否逐句翻页、退让镜是否真的退下；叠层看真实口播合成。优先修最大问题并重看，记录实际时间段与结论。修复次数或预算耗尽仍未过时交草稿、缺口及下一步，不自动降质或声称完成。

有已剪成片必须实际播放；无成片只能基于真实时间轴、看过的预览、听过的音乐做方案级复核。抽帧不冒充播放、链接不冒充试听。每支已交付镜抽帧查实际比例的平台安全区；越界回 visualization，不在本仓库改画面。配乐混音的手机小音量外放检查不能实际完成时列为用户待验。

写 `workspace/broll/{脚本id}-package.md`，包含真实时间轴、逐镜成片与素材、录屏/实拍待办、配乐、`continuity.json` 结论和音画复核，然后运行：

```bash
python3 tools/package_io.py commit --id SC-XXXX --section 素材包 --package workspace/broll/{脚本id}-package.md
```

最终汇报真实/降级时间轴、已交付和缺失镜头、前后切换检查、配乐、本地目录、合同与飞书链接。逐镜片段的最终拼接由 visualization 的整片链路或用户剪辑软件完成。

## 统一产物位置

执行前读取 `docs/artifact-layout.md`。统一入口 `../output/<SC-XXXX>/` 只放可直接使用的资源，分类目录内平铺中文内容名文件；无内容不建目录。合同、报告、日志、工程与旧版本留在仓库 workspace 或隐藏 `.制作资料`。内部验收后同步可用资源到用户目录，不再放 README 和制作流程目录。

## 有真实输入时提前设计效果时间与镜头意图

本节优先于下文 package“不写绝对时间码/不估秒点”和 broll 才设计时长的旧表述，仅限已绑定真实主视频及共享原始 SRT。先设计最佳效果主方案，再比较模板/定制；package 就设计起始、变化、停留、结束及景别/推拉意图，纳入既有整批内容审批，仍只做关键帧。只有脚本时保留语义 anchor 和状态顺序，不编秒数。口播关联区间不等于效果使用时长，不用整句字幕区间自动填满特效。

每镜可写 `effectTiming`（source 秒）：`{status:"draft",sourcePath,startSeconds,changeSeconds,holdSeconds,endSeconds,evidence:{sourceSha256,transcriptHash,sourceCueIds,reason}}`，细则见 `docs/package-effect-timing.md`。必须用当前源身份、SHA 绑定的共享 SRT、连续真实 cue 和完整对应原文；有限非负秒点有序，结束晚于开始。不得重复上传或 ASR。效果可只占关联口播的一部分，不能因此截断 narration anchor。草案仅映射计划尺供审阅，不能据此直接渲染或自动批准。已有手调及实际绑定素材区间优先；显式效果设计可替换口播关联 ranges，原 narration anchor 保留。

`cameraIntent` 写语义锚点、目的、景别/推拉及起止状态；`presenterLayerIntent` 写前后景关系（如 `placement:"behind-presenter"`）、理由及人脸/手势/字幕避让。这些对象原样进入 canonical package、当前 productionPlan 和 broll 输入，不把计划意图冒充已完成 cameraPlan 或已验证人物抠像。broll 继承批准意图，以实际录音、动画事件和真人合成精调/渲染；confirmed 仅由明确实测时长确认产生。用户已批准取消本批列举的创作限制：动效固定镜数/占比、金句只能定格、意象次数、固定来源排名；真实性、画幅、同步、可读性及审批继续执行。

人物后方强调是可选表达候选，不要求每条金句都采用；也可用于未标记金句的重要概念。不设固定次数及表现形式限制；full 无真人定义保持。

## 将提前设计落到可编辑工程

当前 snapshot.productionPlan 是准源；每镜把最新 `effectTiming`、`cameraIntent`、`presenterLayerIntent` 带入 motion brief，与 canonical package 一并校对，不从旧目录恢复覆盖。依据批准语义锚点及复用 SRT 将 cameraIntent 精调为 visualization 的 version=2 shot-plan.json，继承既有真人构图规则，执行 check/代表试片/apply；写入 `composition.json.source.cameraPlan`，保留可编辑数据及人手调整。只有意图字段不能声称镜头计划已经应用。

批准 behind-presenter 后在 visualization 调用 `node tools/presenter-foreground.mjs prepare --document <工程JSON> --source-start-frame <源起帧> --frames <真实帧数>`，再用 `attach --document <工程JSON> --instance <实例ID> --manifest <前景清单> --out <新工程JSON>` 将源 SHA/FPS 绑定的逐帧前景挂到可编辑实例；检查实际源片与 cameraPlan 一致，并看连续合成后的人脸、手势、字幕与强调文字。不支持的重叠/独立层导出明确报缺口，不自动宣称已完成。
