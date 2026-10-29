# 表达需求合同：semantic-template-v1

## 全文模板表现力复审（2026-10-14）

新 request.templateReviewVersion=1 同时执行 `docs/template-expression-review.md` 的 templateReview 合同：按序覆盖全部sections、表达机会、真实候选、具体画面收益和采用/留白理由。与 templateMatch 一致；没有固定覆盖率，旧未标记请求兼容。先行Claude任务不代表模板应用结束，当前工程中的表现与动态验收另核查。

## 完整制作默认合同（2026-10-13）

动画 sections 的语义限制只用于 Claude 定制动画。新 package/handoff 默认完整 `fullPackageVersion=1`，还须 `runId`、七项 productionDesign/productionReceiptPaths 和支线应用后的 productionReadbackPath，详见 `docs/complete-package-contract.md`。Codex具体设计并执行非动画镜头、字幕、封面标题、声音、节奏留白、脚本审阅和独立素材；模板+提示词不能代表完整包。finalize及runtime提交层校验本轮文件/工程回读、source/canvas身份和保护记录；blocked只能partial。旧无标记合同仅历史兼容。

独立真实素材不属于本文件的动画限制：新 package/broll 的当前结果保存后由宿主默认派发独立 `$content-footage` 子任务，遵循 `docs/real-footage-contract.md`；worker 只交自身 manifest，不递归调用 footage 或混入其结果，历史任务不自动补跑。素材子任务全文逐段审、实际获取并推荐独立入轨；动画分支结束不跳过它。素材报告在 package Claude 提示词之前，素材与动画状态分别记录。

新 package/broll 的默认合同为 `package-contract.json`；它把表达需求与模板实现分开，不要求 Codex 先设计具体画面。完成本分支后结束，不继续下方旧 designIntent/视觉审批/派发回执校验。旧产物只在明确续作时按原合同兼容，不批量迁移或伪造批准。

## 顶层与意义单元

| 字段 | 合同 |
| --- | --- |
| schemaVersion | 整数 1 |
| workflowMode | `semantic-template-v1` |
| projectId | 当前目标工程 ID；缺工程明确记录，不猜最近 |
| sourceSrtPath | 真实配套本地 SRT 绝对路径；缺失为 null 并报告未对齐 |
| sourceVideoPath | 真实主口播视频绝对路径；缺失为 null，不能据音频/封面推画幅 |
| sections | 按全文口播意义顺序的数组，稳定 ID，不因模板填入而删需求 |
| sections[].id / narration / title | 稳定段 ID、对应口播原文和内容主题 |
| animationNeed | `required` / `optional` / `none`，表示表达需要而非用户已采用 |
| goal | 观众需要理解/记住什么 |
| information / relations / boundaries | 必须传达的信息、关系、事实/示意/未知边界；用文字数组，不写具体视觉方案 |
| reason | 动画必要性、理解困难或保留真人的理由 |
| sourceCueIds | 当前 SRT 从 1 开始的连续整数编号；各段按序覆盖全文、不重叠不遗漏；缺 SRT 为 [] |
| templateMatch.status | `direct` / `partial` / `none` |
| templateMatch.presetId / props | 现用真实 preset ID 与原生参数；none 时 null 与 {} |
| templateMatch.gaps / reason | 文字数组表达缺口及匹配理由；partial 不冒充完整表达 |

需求分析禁止添加具体场景、构图、颜色、材质、运动路径、states.start/change/end、beats.action 或预设动画秒数，不强制 `designIntentVersion`、`designIntent`、`visual-contract.json`、Styleframe、源码或 `motion-execution-receipt.json`。有 SRT 时 narration 直接复制对应 cue 的实际口播，定稿只提供内容上下文，不能拿改写句替换实际锚点。工程模板的实际 source cue/剪辑映射、目标位置及技术证据由实现层独立记录，不倒写成 Claude 时间约束。

## 校验、应用与总结

```sh
python3 tools/animation_package.py finalize --request <external-job.json> --analysis <packageRoot/package-contract.json>
```

finalize 验证 semantic-template-v1、全文 sourceCueIds、当前 preset/原生 props、来源 SHA，生成 package/plan.md、template-capabilities.json、result-manifest.json。manifest.workflowMode 同名；outputs.semanticPackagePath/planPath 指向实际文件。finalize 本身不写活动工程；worker 先提交 plan 再提交 kind=template 原生实例，由工程 API 经 CAS 追加、保存并回读。无真实时间 plan_only 加缺口，不能以动画审批结束。不把旧 `package_contract.py --stage`、`--approved-shots` 或 `--motion-receipt` 要求套在新合同上。

`plan.md` 末尾唯一 Claude 提示词，真实 SRT 等输入用绝对路径，逐段可删，只给语义和事实约束。Claude 用户手动运行、自读 SRT 自主定设计、跨段拆合镜及区间，流程不自动执行。broll 不另维护提示词。Claude 交付真实媒体及 `animation-delivery.json`（`schemaVersion: 1`、`timeBase: "project"`；当前工程时间轴零点），每项包含 `file`、`startSeconds`、`durationSeconds`、布尔 `transparent`。文件可相对清单目录或为绝对路径；`projectId`、`sourceVideoSha256` 可选。起点、时长和跨段合镜由 Claude 自定，不必绑定原 shotId；相关段 ID 只作信息关联。详见 `docs/animation-delivery-manifest.md`。

有交付清单时以清单秒点为唯一定位依据，经不可变快照及文件、时长、工程边界等技术校验后，直接追加独立实例和最上方独立动画轨道；不重新按 SRT/模型/抽帧匹配，不检查是否符合原分镜或旧视觉形式，不为塞旧模板区间拉伸、循环、定格或裁剪。清单错误明确报技术错误，不静默退回识别猜位置。`transparent: false` 按完整画面覆盖人物画面并保留工程原声，允许视频自带人物；旧 overlay 要求不再强制其 Alpha。`transparent: true` 可核验实际 Alpha 并透明叠加，属于技术检查。仅无清单时走原探测、解码、抽帧和当前计划内容匹配；不能凭文件名或编号猜定位。保留全部旧模板、素材、手调、锁定和显隐，独立轨道供用户开关删除，不标最终采用。重复导入幂等，已删除/忽略不恢复，新版本独立追加，并发时重读并 CAS 保存。控制台制作计划可输入交付 JSON 绝对路径；CLI 使用 `--delivery-manifest`。直接导入媒体路径时，先在原媒体同目录发现 `animation-delivery.json` 再归档，避免相对文件引用丢失。清单导入不强制补 SRT、独立 ASR 或模型核验，也不新增动画审批。不伪造 Codex 派发回执，不强制可编辑动画源码。

结构通过只证明记录与参数可核验，模板已应用须当前工程实例证据；技术通过、观看与用户采用分别记录。非动画输入确认、来源真实性、共享转写、实际画幅/Alpha和媒体验收继续。

**新合同执行到此 return。**

## 历史设计协议 v1（仅旧合同续作）

# 镜头设计协议 v1

目的：让批准的视觉概念、对象变化和模板取舍在 package、visualization、broll 之间完整传递。结构校验不评价艺术质量，实际观看仍按 `docs/animation-design-standard.md` 执行。

## 使用范围

新制作的 `shots.json` 顶层写 `designIntentVersion: 1`。动效、静图运镜、`requiresPackaging: true` 的录屏/素材镜头填写 `designIntent`；纯真人与无需包装的真实素材不强制填写。若其他镜头主动填写，同样校验完整性。

历史合同没有这两个字段时保持原路径；不自动改写、不重新计算旧批准记录。新设计必须声明整数版本 1，不能只放镜头对象而漏版本。带 v1 的方案被批准后，删除版本或设计对象也会改变审批摘要，须重新审批。

## 字段

| 路径 | 类型与约束 |
| --- | --- |
| `designIntent.goal` | 非空文字：本镜新增的理解 |
| `designIntent.concept` | 非空文字：具体对象和关系 |
| `designIntent.states.start/change/end` | 三个非空文字：起始、变化和结束状态 |
| `designIntent.beats` | 非空数组，每项含非空 `id`、`anchor`、`action`；ID 不重复，锚点按顺序取自该镜口播，不能凭空改写 |
| `designIntent.focus` | 非空文字：观看焦点及其变化 |
| `designIntent.presenterRelation` | 非空文字：人物与字幕的空间关系；无真人时明确说明 |
| `designIntent.templateOptions` | 数组，可为空。每项含 `presetId`、`fit` 非空文字和 `gaps` 文字数组；完整匹配时 gaps 为 `[]` |
| `designIntent.customOption` | `approach`、`benefit`、`cost` 三个非空文字；无需定制可明确写“无额外表达收益，不建议定制”，不强造方案 |
| `designIntent.recommendation` | `route` 为 `preset`、`component-custom`、`custom`，另有非空 `reason` |
| `designIntent.acceptance` | 非空文字数组，指向具体可观看的画面/动作 |
| `designIntent.risks` | 文字数组，已知缺口；无已知缺口写 `[]` |

`templateOptions` 的 presetId 顺序及内容必须与现有 `presetCandidates` 相同；不得编造模板。派发器读取 visualization 当前 preset.json 目录核验候选 ID。

`route: preset` 时，`selectedPreset` 必须指向一个无 gaps 的候选，后续仍遵循原 preset/version/props 原生合同；`component-custom` 与 `custom` 时，`selectedPreset` 必须显式为 null。组件复用不意味着使用未经修改的 verified preset。

`gaps: []` 只说明能保留已记录的表达，不自动产生模板选择。先按最佳效果决定推荐及批准路线：模板等效可选 preset，定制有具体视觉收益仍可选 custom，并保留可行模板作为并列方案。`unmatchedReason` 兼容字段在定制路线解释“本次未选模板”的效果理由，不要求声称没有可用模板。`presetAlternatives` 是模板工具的比较字段，不用它把未选模板塞进已冻结 custom 合同。

正式返回合同的实现必须与路线一致：preset 路线实际 `preset.id` 与 `selectedPreset` 相同；custom/component-custom 不得挂实际 `preset`。批准设计文字保持不变但偷偷换成模板，同样阻断回收。旧的无 designIntentVersion 合同继续按原验证路径，不批量改写历史作品。

## 审批与交接

1. package 写完整设计单和模板/定制比较，合并进本期内容审批。所有新增设计字段进入 `design_digest`；新协议下的候选、选择和匹配理由也进入摘要。
2. keyframe brief 引用同目录的 `shots.json` 与本协议。派发前校验设计结构、口播锚点和当前模板 ID；失败不启动子进程。派发器另外保存 shots.json 整个文件的 SHA，子进程只读源分镜，不能修改源视频、画布或转写路径；成功返回前复核该 SHA。回收后由上游单独登记 keyframe/visual_contract 等产物引用，不把下游改写源文件作为输出方式。
3. visualization 原样拷贝顶层 `designIntentVersion` 与对应镜头的 `designIntent`、`presetCandidates`、`selectedPreset`，保留源镜号的身份。上游数值镜号 18 可映射为下游 `shot-018`。
4. 返回合同在签发成功回执前与源设计比较；漏镜、重复镜号、删字段、修改状态/动作/路线都不能通过。package 回收回执与渲染就绪检查再次验证绑定。
5. broll 继承冻结对象。按共享真实转写解析出的秒点/帧点写在独立时间轴或 motion brief 的映射表，以镜号和 beat ID 关联；不把时间码塞回并修改批准的 `beats.anchor`。

package 仍是 keyframes-only。源 SRT 的时间区间可用于定位样本，不意味着已经确认最终剪辑点。结构与摘要通过只能证明记录完整、交接没有改写，不能证明创意充分或动画优秀。

## 验证命令

```sh
python3 tools/package_contract.py validate --shots <shots.json> --source-srt <已有转写.srt>
python3 tools/package_contract.py validate --shots <shots.json> --approved-shots <批准时的shots.json>
python3 -m unittest discover -s tests -p 'test_visual_design.py'
```

缺已有转写时省略 `--source-srt`，但 beat 的锚点仍须来自镜头口播。渲染就绪和回执沿用 `--stage`、`--motion-receipt` 原接口，不因新字段绕过旧技术门禁。
