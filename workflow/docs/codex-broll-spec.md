# Codex 的 Package / B-roll 双阶段合同

本文档说明定稿之后的视觉生产边界。详细执行规则以 `$content-package`、`$content-broll` 和 `../studio` 当前的 `$motion-broll` 为准；`docs/broll-methodology.md` 只提供内容侧的分镜判断方法。

## 总原则

视觉工作从人工定稿后开始，分成两个阶段：

1. Package 决定“讲到哪里切镜、每镜为什么存在、画面如何表达”，冻结视觉合同并生成关键帧。
2. Broll 在终稿口播录音完成后取得真实时间轴，继承同一合同并生成逐镜素材。

两阶段同读 `docs/animation-design-standard.md`：先独立设计本段效果最好的主方案，再并列给能满足目标的模板方案；以效果选择，不因模板存在而放弃定制。模板同效果可推荐复用。broll 继承批准的设计与实际路线，不能重新套模板覆盖。

写稿和 revise 阶段只负责口播，不预埋画面引用行，不搜索素材，不估算最终镜头秒数。

## 阶段一：`$content-package`

自然语言示例：

```text
给 SC-0012 做 package
给 SC-0012 做 package，全 broll
```

输入是状态为“已定稿”的最终正文。内容侧按意义单元切镜，为每镜确定叙事功能、形式、动作、理想画面、创意方案、切法以及首尾锚点，写入 `workspace/package/{脚本id}-shots.json`。

Package 的分镜步骤可以读取 `素材库/` 文件名做路由，也可以读取 visualization 的 preset 菜单；分镜步骤本身不下载图库、不写绝对时间码、不渲最终 MP4。配乐不在分镜步骤里决定：BGM 由完整 package 的独立 bgm 专项负责，按 `docs/complete-package-contract.md` 的「BGM」一节执行（规划后检索、下载首选曲目并铺到时间轴），本文不另定配乐规则。

视觉派发进入 `../studio`，使用：

```yaml
dispatch_phase: keyframes-only
scene_context: talking-head-insert
creative_priority: expressiveness-first
profile: visual-max
safe_area: 按实际口播画幅及平台确定；仅竖屏抖音使用 douyin-vertical
```

先将完整分镜、最佳效果与模板比较回写飞书，获得本期内容批准。首次或换风格时再让用户一次选择真实视觉候选，模板预览可同步并列；visualization 随后冻结并校验 `visual-contract.json`，为每镜返回代表关键帧 PNG，核心多阶段镜检查起始、变化、结束帧。Package 回填合同和关键帧并回写结果；继承已有批准选择不重复确认。

## 阶段二：`$content-broll`

自然语言示例：

```text
给 SC-0012 做 broll，录音在 /absolute/path/final.wav
```

Broll 必须同时拿到脚本 ID、终稿录音、package 的 `shots.json` 和已校验的 `visual-contract.json`。先运行 `tools/broll_timeline.py align`，把真实录音对齐定稿正文；后续所有镜头使用三位小数的真实开始、结束和时长。

无法取得带时间戳转写时只能标记为降级估算，不能宣称是实测时间轴。`coverage=full` 时，渲染前先一次展示逐镜真实时长与合并/精简建议，等用户确认后继续。

最终派发使用：

```yaml
dispatch_phase: render-final-shots
visual_contract: /absolute/path/visual-contract.json
```

每镜同时传入真实时长、口播、内容功能、前后镜摘要、`transition_in`、`transition_out`、`startAnchor` 和 `endAnchor`。visualization 负责 Remotion / HyperFrames / Hybrid 路由，返回逐镜 MP4、首中尾关键帧、`continuity.json` 和规格校验结果。

动画与真实素材按批准范围并列推进：素材实际打开目检，声音实际试听并核对授权。逐镜正常速度播放并检查合成与衔接，问题定位到具体时间段、修复后复看；不得因达到固定修复轮数就自动验收。未能看/听的范围明确待验，交草稿与缺口，不宣称最终通过。

## 跨仓库边界

内容项目拥有：

- 最终口播、逐镜内容与叙事功能；
- 真实时间轴；
- 素材选择与授权判断；
- 用户检查点和飞书落库。

visualization 项目拥有：

- `visual-contract.json` 的设计字段与校验；
- 字体、配色、版式、动效和安全区实现；
- Remotion / HyperFrames / Hybrid 引擎路由；
- 关键帧、逐镜视频、连续性和输出规格验证。

内容项目只传内容、时长、上下镜关系和素材绝对路径，不复制对方的设计规则，也不读取对方的历史 benchmark 作为运行时合同。

## 完成标准

Package 完成意味着：分镜覆盖正确、视觉方向已冻结、合同通过校验、关键视觉镜都有关键帧；它不代表素材已经完成。

Broll 完成意味着：真实时间轴和语义揭示时点已核对、批准效果及逐镜输出通过实际音画与技术验收、前后镜连续性已检查、素材和配乐状态如实汇报、素材包已落库。降级估点、缺少动态观看或听审只能交阶段草稿；没有检查过的文件不得标为完成。
