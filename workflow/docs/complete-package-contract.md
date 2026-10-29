# Package 当前规则（唯一准源）

本文件是当前 package/handoff 制作规则的唯一准源；入口、技能和跨仓库文档只引用本文件。专项文件保留技术协议、数据格式与专业验收方法。历史修订见 `docs/CHANGELOG.md`。

## 版本与默认值

- 新任务显式使用 `packageOrchestrationVersion=2`；未声明版本的任务也按 v2 处理。`packageOrchestrationVersion=1` 已退役并拒绝执行，历史仅见 git tag `v1-final`。
- 默认 `packageExecution={streamingApply:true,reusePolicy:"same-run"}`。新完整 package/handoff 声明 `fullPackageVersion=1`、当前唯一 `runId`、`bgmPlanVersion=1`、`bgmExecutionVersion=1`、`captionSegmentationVersion=1`；动画合同为 `schemaVersion=1`、`workflowMode=semantic-template-v1`。这些专项/数据版本不等于已退役的编排版本。
- package/handoff 默认完整制作，但自动模板匹配与应用已下线。新任务强制 `scope.templates=false`，不读取模板目录、不派发 templates 专项、不要求 templateReview、不生成模板应用结果；已有模板与手调保留，独立手动模板功能仍可使用。素材 `footage`、AI 视频提示词 `aiVideo` 默认开启，Claude 动画提示词和封面等七项职责继续保留。只有用户明确单项 scope 才关闭其他专项；`scope.bgm=false` 不关闭 sound 音效。
- 明确的历史关键帧、独立 motion-broll 等非编排合同续作保留在对应入口的历史章节，不作为当前 package 缺字段、缺回执或缺输入时的降级路径。

## 输入、工程保护与范围

明确 projectId 先 `python3 tools/editor_plan.py read --project-id <ID>`；只有 SC 时先 `discover --script-id <SC>`，唯一绑定才用，多绑定一次集中确认，不能猜最近工程。无绑定列缺工程，服务不可达列缺连接。自然对话以 `jobs --project-id <ID> --kind package` 启动主 worker 并持续跟踪；worker 收到 external_job 后不重复创建整期任务。

读取 `docs/workbench-external-job.md` 的协议与 SHA 绑定输入，核验 phase=package、绝对路径、outputRoot、finalScriptPath/sourceSrtPath 和工程快照。document.productionPlan 是工程内容准源，finalScriptPath 提供完整口播；只分析当前任务相关项目及共享素材，不扫描无关私人全库，不用旧包或飞书回读覆盖当前计划，不另建飞书脚本。旧包只追溯。

复用 `tools/transcribe.py` 共享原始转写；已有 SRT 先登记复用，同次录制且同时间原点的配套音视频才显式 alias。剪切、变速或换音轨后核验来源及时间基准，不凭文件名/时长猜关联，不重复上传/ASR，字幕润色不覆盖原始转写。recordedScriptUnconfirmed 或原转写的数字、否定、事实歧义要记录或集中确认，不伪装定稿，不变成动画方案批准。

每轮重新审阅完整口播及当前真实工程。保留稳定 ID、需求版本、剪辑来源映射、非动画任务、已选封面、用户手调、锁定、显隐、删除/忽略记录；自动备选与用户版本并列。通过原生工具、ResultStore/CAS 保存，冲突重读，禁止直接覆盖活动 JSON、派生计划 Markdown 或旧包。缺输入记 blocked/partial，其余可执行职责继续；旧成果存在不等于本轮完成。

## v2 执行流程

1. 主控完成全文脚本、节奏、事实边界及保护基线，按当前计划通过 build_plan 确定最终段 ID/requirementVersion；保存不可变 `semantic-baseline.json`。新 package 不要求 templateMatch/templateReview；兼容字段如保留，写 none 与“自动模板匹配已关闭”，不得触发匹配或应用。
2. 立即运行早期交接，将同一 `package/plan.md` 的唯一 Claude 提示词入口交用户；不等待素材或封面。早期交接只表示提示词就绪，不能称完整 package。

```sh
python3 tools/package_early_handoff.py --request <external-job.json> --semantic <semantic-baseline.json>
python3 tools/package_branches.py run --request <external-job.json> --semantic <semantic-baseline.json>
```

3. `footage/aiVideo/camera/captions/cover` 五个基础专项，加独立 `bgm` 专项；templates 记录为 skipped，不启动，使用职责裁剪的独立临时上下文与 attempt 目录。所有专项共用最多三个全局模型槽；人工 Claude 和等待用户外部生成不占槽。
4. 主控优先读 `controller-summary.json`，按需读具体提案、报告及原生校验回执，不把各支日志/全部检索历史灌回主控；保留完整语义和必要源片观察。语义计划先保存，字幕/封面/AI 候选可提前可见；素材/镜头按依赖顺序实际应用。
5. 跟踪 `application-queue/journal.json` 与真实 API 回读；兄弟支失败不抹除已保存成果。视觉、字幕、镜头等实际事件保存后，以真实应用回执和当前工程快照运行独立短上下文的 sound 阶段：

```sh
python3 tools/package_sound_stage.py --request <external-job.json> --events <applied-events.json> --snapshot <current-readback.json>
```

6. 仅重试失败支（`--retry-failed`），成功内容按具体依赖核验复用，不能冒用旧执行回执。跨轮复用须显式 `reusePolicy=validated-project-artifacts`，只读取当前工程明确引用的上一轮索引；保留原始执行证据，本轮重新业务校验、保护检查和回读。新源或时间原点变化拒绝旧提案。
7. 持续监控到后台任务终态及文件/工程回读完成，再交控制台与最终总结；中间交接不结束监控。最终总结替换同一 plan.md，末尾只有一份 Claude 提示词，不再被早期版本覆盖。

## 完整制作七项职责

Codex 负责 `scriptReview/rhythm/camera/captions/cover/sound/footage` 七项本轮设计、执行或有理由留白/保护手调；定制动画由用户手动运行 Claude。semantic-template-v1 只限定动画语义及原生模板边界，非动画镜头、字幕、封面和声音可具体设计画面、字号、颜色、位置、变化及时间。模板支线的 return 不结束完整制作，模板和提示词不能替代七项回执。

- scriptReview：只报告严重事实、理解和节奏问题，不重写当前定稿。
- rhythm：全文检查节奏、真实停顿、真人留白及非动画镜头节奏。
- camera：实际应用 editable `source.cameraPlan`；已存在推拉不重复叠加变焦。
- captions：设计、断句、强调后写入实际 captions，并完成保存后的质量/语义断句复核。
- cover：实际交付完整候选与标题或有证据保护已选作品。
- sound：依据本轮真实事件匹配音效，独立可编辑音轨；空音效也须全文审阅和本轮理由，不烧进模板、不机械配声。
- footage：独立全文审稿、搜索、下载验收、全部可用候选入项目库、推荐入轨。

没有新增收益可有理由留白，不机械重复添加。只填 cameraIntent/designIntent/soundDesign 不能算 executed。BGM 是额外专项，不替代 sound 音效或七项回执。

## 专项与主控合并

专项共享只读全文、当前源身份、SRT/source.clips、画布和保护记录，只在独立目录产出提案、报告、真实文件及 SHA，不调用活动工程 API、不发布父结果、不制作工程回执，不递归 package/broll 或再派专项。专项 complete 只代表提案完成。

主控按 `docs/package-branches-contract.md` 验证真实 `package-branches.json` 的 projectId/runId/inputFingerprint、共享基线以及成功支 request/result/execution/files SHA，再调用各原生业务校验器。合并写另一份 `package-contract.json`，不得覆盖 semantic-baseline 或已绑定输入。Python 业务门通过后，由宿主唯一工程队列通过 ResultStore/CAS 实际保存；每次发布先比对冻结字段，只允许本轮真实 receipt/readback 证明的队列改动更新基线，不能将用户手调变成旧提案的覆盖基线。

同源剪辑期间的发布校正使用 `editReconciliationVersion=1` 技术协议；原始提案及 readSet/writeSet 保持不变，衍生正文/SRT 与 provenance 绑定。源替换、时间原点、画幅/帧率、变速或非单调重排不能靠校正复用；人工语义改动记录 needsReview，未应用建议不计完成。细节见专项技术协议。

最终 manifest 的 `outputs.packageBranchesPath` 指向真实状态文件，绑定共享输入、语义基线、成功分支请求/结果/执行回执、全部产物及应用/复用文件 SHA。必需支 blocked/failed/cancelled 或必需实际应用缺口只能 partial；提案、占位 JSON、分支 complete 不能代替 executed，不得删除外部标记绕过不可变快照门禁。

## 全文语义与动画提示词

按意义单元覆盖全文，允许相关相邻句合并；不机械一段一镜。每段写稳定 id、narration、title、animationNeed(required/optional/none)、goal、information、relations、boundaries、reason、sourceCueIds。none 写保留真人或其他既有任务承担的理由。sourceCueIds 为当前 SRT 从 1 开始的连续整数编号；各段按序覆盖全文、不重叠不遗漏。有 SRT 时 narration 直接复制这些 cue 的实际口播原文，finalScriptPath 的定稿用于上下文，不能改写实际口播锚点。不能凭字数伪造时间；没有 SRT 保留有序文本、sourceCueIds=[] 并记录缺口。

本阶段的动画语义sections不写构图、颜色、材质、卡片形状、动画镜头运动、场景、二维/三维、起始/变化/结束、具体动画动作、时长或起止秒数。非动画productionDesign可具体设计镜头、字幕、封面和声音，不受此限制。记录内容约束，例如“不能把效率下降写成准确率下降”。不要求 `designIntent`、states/beats/focus/customOption 或旧 `visual-contract.json`。

新 package 不再比较、匹配或自动应用原生模板。既有模板保留，不因缺少模板匹配、模板复审或模板目录而阻塞制作。以下语义用于素材匹配、Claude 动画提示词和 AI 视频提示词；独立手动模板的技术协议保留在 `docs/template-expression-review.md`，不进入 package。

实际画幅继承主口播显示比例（含旋转/像素宽高比）或用户明确目标，不默认 9:16、不用 MP3/SRT/封面推定；以 `tools/broll_canvas.py probe` 核查。缺目标画幅列缺项。强调文字有入场且不提前泄露后文；按 `docs/animation-design-standard.md` 检查人物保留、阅读负担和真实合成节奏，技术通过、静帧与连续观看分别记录。

执行前读 zmt 的 `docs/animation-design-standard.md`、`docs/visual-design-contract.md`、`docs/artifact-layout.md`、`config/sound-design.md`、`docs/sound-design-contract.md`，再读 visualization 的 AGENTS、motion-broll、agent-runbook、visual-first；visualization 根取 VISUALIZATION_ROOT 或 `../studio`。当前任务不进入旧 keyframes-only/render-final-shots、`.claude` 或 benchmark 创作流程。

## BGM

新 package 的独立 bgm 专项先按 `docs/bgm-plan-contract.md` 全文逐段规划 music/silence、收益、音乐类型、音色、衔接与收束，再按 `docs/bgm-auto-execution.md` 的自动执行授权广泛检索、比较并下载首选曲目，提交实际可实现的剪辑。首选无法获取或许可不适用须记录原因并按偏好顺序尝试后续候选，不静默付费。

音乐判断保留连续体验、过程与结构想象、推进期待、转折余味、主观气氛等收益；不能缩成轻底乐/留白二分。reason、texture、transition、recommendations[].reason 的判断必须进入控制台字段，不只留在报告；不固定两秒双淡化、不侵占留白、不编造未试听的结构。具体方法及检索、许可、下载、解码、选段、混音证据门禁由两份 BGM 专项规范定义。

主控经 animation_package.finalize 读取已验证提案，把 bgmDesign/曲目池写入 productionPlan；原生业务门另产 kind=bgm 队列操作，宿主保存计划与可编辑音乐片段，通过 CAS 回读。计划轨显示当前真实 music 段 ranges，silence 留空，类型/作用/衔接/推荐可查看；计划显示不代表可播放音轨已保存。

有音乐需求而未下载/未应用只能 partial；全文合理留白可零音频，但须逐段审查。BGM 额外以专项校验、应用队列回执和工程回读证明完成。sound 专项负责音效，BGM 不代替音效；两者 silence 分开判断。计划就绪、来源许可核实、下载、数值混音检查、保存、真实听审和用户采用分别记录，未听始终标待听审。

## AI 视频候选

AI 专项独立考虑视觉隐喻、情境、氛围、动作和转场带来的表达收益，不以“真人已能说清”“可以用动画”或“无法证明产品能力”单独否掉候选。宣传与概念画面允许大胆构思，作为 illustration 使用；只有明确声称实际操作或实际成果的镜头才要求相应实证。先给有创意价值的可选提示词，再由用户决定采用，不调用生成 API。空候选须说明逐段尝试的画面方向及具体不适用原因，并在最终交付明显列出，不能让用户误以为专项被移除。

`sections[].aiVideoCandidates` 完整传到 `productionPlan.shots[].aiVideoCandidates`。无收益用空数组，不填假候选或假 URL；同段可有多个候选。每项必含 `id/title/prompt/promptVersion/requirementVersion/sourceCueIds/reason/aspectRatio/durationSeconds/references`；references 为上传顺序的 `{path,label,purpose,sha256}`，真实本地参考文件和 SHA 由 `tools/ai_video_package.py` 验证。证据角色只允许 `illustration`，不冒充事实/私人案例/产品能力证据，不复用网络 candidateId。

候选绑定冻结的最终语义 requirementVersion；AI 提案不创建槽位、不推进需求版本。提示词、需求或参考内容/上传顺序改变必须升 promptVersion，不静默重绑旧视频。当前片段卡片复制完整提示词并显示参考顺序，用户外部手动生成；关联回传明确 `shotId/aiVideoCandidateId/aiVideoPromptVersion`，宿主冻结候选、需求与引用身份，必要时建立独立 AI 视频槽，再识别实际文件/内容并追加。普通无关联导入沿原识别；手动拖入时间轴保留用户位置；Claude delivery manifest 继续唯一定位，不重新识别。

提示词就绪只代表本轮 AI 专项交付，不是生成/上传/入轨/观看/采用。等待外部视频不占模型槽，不调用付费视频 API，不自动启动或等待 Claude；有媒体后仍做当前身份、技术与内容校验。AI 候选章节与真实素材报告放在总结末尾唯一 Claude 提示词之前。AI 目标时长属于外部生成提示，不成为 Claude 动画的时间约束。

## 真实素材

footage 专项按 `docs/real-footage-contract.md` 独立覆盖完整口播，包括 animationNeed=none、保留真人、模板未命中或 Claude 未回传段落；动画任务结束不跳过素材职责。免费可复用候选实际下载，完整原片 SHA、probe、全帧解码和代表帧核验；原始短边至少 720px、优先 1080p，不放大低清凑数。图库示意不冒充私人案例或产品能力证据；但普通电脑操作、阅读、学习、文件等情境可以直接承担示意与节奏作用，不把用户未要求的产品实录当成所有素材的门槛。真实 SRT/source.clips 决定 placement，源窗口不超媒体时长，不统一规定镜长。

全部可用候选加入项目素材库，推荐自动追加静音实例，其余留文档和项目库，不加公共库、不新增素材批准。横屏 UI 原生 contain 完整显示并以不透明背景承托，不裁关键 UI、不拉伸/循环/定格，也不套旧 overlay 的 Alpha 要求。placementId=null 表示项目候选，有 placement 表示推荐。

真实素材在本阶段完成独立全文审稿、搜索获取、核验与推荐入轨；broll复用已有结果并增量补缺口。最终总结及其直接链接的素材报告同时交付所有可用候选和未下载/下载失败/待许可网站线索，逐项标注对应的共享SRT原句、sourceCueIds/段落ID、配图理由、来源网页与当前状态；只有搜索词或链接不算完整交付。未经目检的检索结果标待筛选，其句子关联只说明搜索目标。详见`docs/real-footage-contract.md`。

footage 专项只交 real-footage-v1 原生分析与提案；主控业务门（`tools/package_branch_validation.py`）调用 `footage_package.py finalize` 生成并校验原生素材结果，再作为 kind=footage 的队列操作由宿主按原生协议/CAS 实际应用。主控持续回读项目库及轨道，写本轮 footage engineering 回执；七项就绪后提供 productionReadbackPath，再 full finalize。宿主不重复派 parentJobId 素材子任务，也不再使用父任务内 `publish-footage` 运输（随 v1 下线）。已有独立素材成果只能经本轮依赖核验及实际回读复用，不重复导入。仅明确只做动画或 scope.footage=false 才跳过素材职责；候选不足、私人证据不可用照实列缺口。

## 字幕与封面

字幕同时执行 `docs/caption-quality-contract.md`：默认统一全局字体与颜色，不按数字自动整句变黄。源SRT粗cue及工程长cue必须根据实际原声或可信词级时间复审，不能按字数均分或仅对照原SRT即报字幕同步。`caption_quality.py` 在制作前与保存回读后执行，fullPackageVersion=1 的 captions executed 由生产回执校验强制接入。

新package/handoff同时声明captionSegmentationVersion=1，字幕回执通过captionSegmentationReviewPath绑定逐条语义断句审阅文件及files/SHA。所有当前cue都要覆盖，包括不足5秒的短字幕；缺审阅或仍有split_required不能报executed。文字、时点改变使对应断句审阅过期，必须按保存回读后的工程重新核查。

公开版不预设人物身份或肖像库，默认 `coverContract.requirePerson=false`。用户明确要求本人封面时，才扫描其本次授权的肖像目录，将实际路径及 SHA 绑定到 `coverReferences`，并设 `requirePerson=true`。已明确要求本人而肖像缺失时，仅阻塞封面专项，不静默改为无人物。原生校验保留该约束。

封面 executed 按 `$content-cover` 成套交付：默认三组，每组 3:4 与 4:3 两张 PNG，共六张，双比例独立构图，含标题报告；用户明确要求四/五组时绑定 coverGroups。单张概念图或仅标题不能代替整套。回执包含 coverCandidateManifestPath；schema 2 manifest、source.md/source.json/references.json 和全部图片列入 files/SHA，调用 cover.py 只读校验。关联当前工程候选列表并实际读取封面 API，检查各组双比例均可显示（包括 package 专项目录里的候选，不能仅检查旧封面库），不替用户选定。机器校验、逐张目检、语义回读和用户选用分别记录；保护已选作品须有本轮理由及真实证据。

## Claude 交接与媒体导入

`plan.md` 前半记录全文需求、非动画安排、匹配/实际参数、应用状态、未覆盖需求、源文件和工程关联。当前 productionPlan 仍是唯一计划准源，不因实现已填而删需求或重编 ID。

末尾使用标题“给 Claude 的动画提示词”，只保留一份公共说明＋逐段可整段删除区块。公共说明含主题、完整脚本、真实本地 SRT、主视频、必要素材、现用 visualization 规则、独立输出目录和回传方式的绝对路径；文件存在才写可用，缺项写缺失。SRT 明确复用不重转。每段有明显起止边界，包含 id、口播、必要上下文、goal、information、relations、boundaries；删掉其他段后仍独立成立，段落标识不规定镜头数量。

不指定 Claude 从几秒到几秒、时长、入退场时点或动作节拍，不默认传模板候选。Claude 自读完整 SRT 与脚本，自主拆合镜、设计视觉、确定区间，允许跨段合镜。Claude 交付真实媒体及 `animation-delivery.json`（`schemaVersion: 1`、`timeBase: "project"`；当前工程时间轴零点），每项包含 `file`、`startSeconds`、`durationSeconds`、布尔 `transparent`。文件可相对清单目录或为绝对路径；`projectId`、`sourceVideoSha256` 可选。起点、时长和跨段合镜由 Claude 自定，不必绑定原 shotId；相关段 ID 只作信息关联。详见 `docs/animation-delivery-manifest.md`。清单是 Claude 交付的一部分，不让用户补制作区间；不要求关键帧或 Codex 派发回执。发现常见可复用缺口才附一句参数可替换建议，本期不注册模板/扩菜单。用户手动运行，Codex 不启动、不等 Claude；手动专线入口为 `../studio/claude-lane/SKILL.md`，不以公共模板注册或源码工程为交付前提。

有交付清单时以清单秒点为唯一定位依据，经不可变快照及文件、时长、工程边界等技术校验后，直接追加独立实例，按自动视觉轨道协议分配并满足声明的叠加顺序；不重新按 SRT/模型/抽帧匹配，不检查是否符合原分镜或旧视觉形式，不为塞旧模板区间拉伸、循环、定格或裁剪。清单错误明确报技术错误，不静默退回识别猜位置。`transparent: false` 按完整画面覆盖人物画面并保留工程原声，允许视频自带人物；旧 overlay 要求不再强制其 Alpha。`transparent: true` 可核验实际 Alpha 并透明叠加，属于技术检查。仅无清单时走原探测、解码、抽帧和当前计划内容匹配；不能凭文件名或编号猜定位。保留全部旧模板、素材、手调、锁定和显隐，独立轨道供用户开关删除，不标最终采用。重复导入幂等，已删除/忽略不恢复，新版本独立追加，并发时重读并 CAS 保存。

控制台制作计划可输入交付 JSON 绝对路径；CLI 使用 `--delivery-manifest`。直接导入媒体路径时，先在原媒体同目录发现 `animation-delivery.json` 再归档，避免相对文件引用丢失。清单导入不强制补 SRT、独立 ASR 或模型核验，也不新增动画审批。

无清单普通媒体先探测、完整解码、多时点抽帧，对照当前计划/SRT 判断内容与合理位置；技术可用且有匹配依据才自动并列追加，不凭文件名/编号猜时间，不替换已有目标内容，允许同一需求多个实现。无合理定位或技术失败保留媒体并列具体缺口，未知来源本身不是待批准理由。无清单 overlay 必须有实际 Alpha 与真人合成预览；MOV 扩展名不证明 Alpha，截图不证明动态看过。

自动视觉轨道按 `docs/automatic-visual-tracks.md` 分配：非重叠素材、原生模板、识别媒体及 Claude 动画优先共轨，重叠或叠加顺序冲突才增加轨道；后续非重叠项继续复用。只作用于新追加，不重排旧轨，改名/改序/锁定/隐藏/混入手动项的自动轨不再复用；主视频、字幕、镜头、音频专用轨不变。“独立”要求实例可编辑、可开关删除，不表示每个文件必须独占一轨；自动共轨规则同样适用于清单动画。

broll 复用当前语义需求、共享时间轴、有效专项证据和 AI 候选，按输入变化及当前 scope 增量补缺；无语义合同先走 package。不另建 Claude 提示词、不定制动画、不等外部生成，源输入实质变化由 package 更新同一总结和版本依据。单项/清单导入不扩成整期；单镜明确 shot/slot/instance/range，camera/sound=false。仅导入清单不以补 package、SRT、ASR 或模型识别为前置。

公开版手动动画入口为 `../studio/.devin/skills/custom-animation/SKILL.md`；上文 `claude-lane` 是私有历史入口，不随公开版分发。这里的 Claude 指用户自行选择的外部动画制作 Agent，不代表必须订阅某一服务。

## 回执格式

`package-contract.json` 保持 schemaVersion=1/workflowMode=semantic-template-v1 的动画 sections，另增加：

- fullPackageVersion: 1
- runId: 当前批次唯一标识，与 external-job.json 一致
- productionDesign: 七项键 `scriptReview/rhythm/camera/captions/cover/sound/footage`，每项含 decision 和 reason，可追加具体非动画设计
- productionReceiptPaths: 同七项键，对应本轮回执的绝对路径，回执 JSON 位于本轮 outputRoot
- productionReadbackPath: 各支线应用后本轮最新 API 回读快照绝对路径，位于 outputRoot；与初始快照的源媒体 SHA、source.clips、画布一致，允许 cameraPlan/captions/音轨/素材等本轮变化，文件 SHA 纳入最终 manifest

每条回执为独立 UTF-8 JSON：

```json
{
  "schemaVersion": 1,
  "branch": "camera",
  "runId": "本轮唯一标识",
  "projectId": "真实工程ID",
  "sourceVideoSha256": "当前真实源视频SHA256，无视频为null",
  "canvas": {"width": 1080, "height": 1920, "fps": {"num": 30, "den": 1}, "durationFrames": 300},
  "status": "executed",
  "rationale": "本轮设计与实际动作",
  "protected": ["本轮核对并保留的具体用户手调"],
  "files": [{"path": "真实报告或产物绝对路径", "sha256": "文件SHA256"}],
  "acceptance": {"technical": "passed", "visual": "not_performed", "listening": "not_performed"},
  "engineering": {
    "snapshotPath": "实际API回读快照绝对路径",
    "revision": 123,
    "instanceIds": [],
    "fields": [{"pointer": "/source/cameraPlan", "sha256": "字段规范JSON的SHA256"}]
  }
}
```

status/decision 允许 executed、leave_blank、preserved_manual、blocked、skipped。只有明确 scope 对应项=false 才能 skipped；其他非 executed 均须本轮理由和报告，preserved_manual 必须具体 protected。

camera/captions/sound/footage 的 executed 必须携带 engineering。快照 document.id/revision/画布真实有效；字段或实例在该回读和本轮最新 projectSnapshot 中必须一致，允许其他支线更新导致 revision 更大。摄像与字幕绑定具体分支字段，避免整 source 哈希因其他支线变化失效。字段哈希使用 tools/package_production.py 的 json_digest：UTF-8、ensure_ascii=false、sort_keys=true、separators=(',',':')、禁止 NaN。源媒体别名通过 SHA 验证身份，不能仅以路径字符串判断。报告或产物文件有实际文件和 SHA，不以候选 URL 充数。

executed 的镜头、字幕、声音分别强制绑定 `/source/cameraPlan`、`/captions`、`/audioClips`（允许其子字段），其他字段或旧意图不能代替实际支线。cover preserved_manual 也需真实PNG/JPG和 `/cover` 工程字段回读，executed需真实封面文件。完整package父请求在ingest入口强制semantic-template-v1/fullPackageVersion=1/同runId，不能改成素材或旧模式绕过七项职责校验。

每份 engineering.snapshotPath 必须列入该原始回执的 files/SHA；该回执本身在最终manifest内SHA绑定。工程快照可在外部本轮支线目录，不把外部artifact硬塞manifest.files；修改工程快照必须导致校验失败，不能只在内存补一个snapshotSha256后当作固定证据。

完整模式的提交门禁同时读取不可变任务snapshot与external-job：任一标记fullPackageVersion=1即强制完整，runId优先使用snapshot，删除或改写external-job标记不能降级。全文SRT拼接与当前镜头口播只有normalize意义相同的格式差异时，保留当前narration/mediaDescription原格式、需求版本和已有绑定，避免换行/分隔符引起重复模板；正文或信息实质变化仍更新动画需求版本。

完整模式的每个动画语义section可同时带独立非动画 `cameraIntent` 和 `soundDesign`，声音复用 soundDesignVersion=1 合同（silence/cues、全片唯一cue id、实际口播anchor、无绝对秒点）。只要声明声音设计，每段均须明确cues或silence，不能静默从旧稿继承未填段落。build_plan将本轮字段同步到canonical shot及upstream.packageShot，plan/shot保留soundDesignVersion=1；canonical导出优先当前shot.soundDesign。镜头/声音意图不进入Claude提示词，不因非动画意图更新触发动画需求版本或旧审批；实际执行仍以cameraPlan/audioClips回执为准。

## 完成、验收与交付

七项 productionReceiptPaths、本轮最新 productionReadbackPath 及全部专项/应用/复用文件 SHA 必须完整。finalize 和 runtime ingestion 均执行确定性校验；只有模板/提示词而缺完整设计或回执直接拒绝，必需职责 blocked 只能 partial。最终 `plan.upstream.completePackage` 记录版本、批次、各项状态、设计路径、总结路径和回执路径。

```sh
python3 tools/animation_package.py finalize --request <external-job.json> --analysis <package-contract.json>
```

finalize 生成 `plan.md`、`template-capabilities.json`、`result-manifest.json`，不直接写工程。manifest.workflowMode=semantic-template-v1，outputs.semanticPackagePath/planPath 指向真实文件；提交层先合 plan，再交 kind=template 的原生 preset/props、来源映射与真实区间，幂等保护已应用项。后端保存和回读当前实例才计入轨；原生实例不强制先渲 MP4。worker 返回真实 manifest 后由后端提交，普通对话持续读 jobs/read 到终态，不把提交当应用。

无真实 SRT/源/画布/连接列依赖缺口，不伪造时间；无真实时间的有序计划为 plan_only，工程未应用须明示。不得以 waiting_approval/waiting_selection 结束动画分支，也不伪造 approved；必要的非动画事实/输入确认保留。取消和重试不能重写当前需求、恢复删除项或重复入轨。

最终交本期控制台和同一总结入口，逐项说明本轮动作、保护、缺口及报告。模板已应用、提示词就绪、待外部媒体、识别/入轨、技术通过、连续观看、听审、用户采用分别记录；verified、测试、截图或播放器播完不代替动态与听感验收。模板沉淀由用户另开任务。

产物位置按 `docs/artifact-layout.md`；导出前按 `docs/export-preflight.md` 核对源显示分辨率、画布及实际输出，不默认降分辨率/帧率，不用代理或放大低清替代源片重渲染。

## 相关专项合同

- `docs/package-branches-contract.md`：分支请求/结果、校正、状态、恢复、取消与校验接口。
- `docs/workbench-external-job.md`：外部任务与提交协议字段。
- `docs/bgm-plan-contract.md`、`docs/bgm-auto-execution.md`：BGM 方法、计划数据、获取与实际执行。
- `docs/real-footage-contract.md`：真实素材全文审稿、语义适配、来源与验收。
- `docs/caption-quality-contract.md`：字幕质量与语义断句。
- `docs/automatic-visual-tracks.md`：自动视觉轨道分配。
- `docs/template-expression-review.md`、`docs/visual-design-contract.md`、`docs/animation-design-standard.md`：模板全文复审、语义格式与视觉质量。
- `docs/animation-delivery-manifest.md`：Claude 媒体交付和确定性导入。
- `config/sound-design.md`、`docs/sound-design-contract.md`：声音作用和音效事件。
- `.devin/skills/content-cover/SKILL.md`：封面制作和候选交付。
- `docs/artifact-layout.md`、`docs/export-preflight.md`：产物位置与导出验收。
