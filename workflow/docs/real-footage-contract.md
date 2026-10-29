# 独立真实素材合同（real-footage-v1）

该支线独立审阅完整口播，先形成逐段画面需求，再搜索与获取。动画必要性、模板命中、Claude 状态、旧动画槽位和批准记录均不决定素材范围。与 `package-contract.json` 并存，不修改动画合同。设计依据见 [独立真实素材方案](superpowers/specs/2026-10-13-independent-real-footage-review-design.md)。

## 输入与逐段审稿

读取 SHA 绑定的 `external-job.json`、完整脚本、共享原始 SRT、实际主视频、当前工程快照及相关项目素材。工程 `source.clips` 为剪辑映射准源；不重复 ASR、不扫描私人全库。无明确工程、真实 SRT 或有效源身份时如实列缺项，不猜位置。

`footage-review.json` 为 `schemaVersion: 1`、`workflowMode: real-footage-v1`，顶层含 `projectId`、`sourceSrtPath`、`sourceVideoPath`、`sections`、`candidates`、`placements`。JSON 的精确字段和校验以 `tools/footage_package.py` 为准。

`sections` 按实际口播顺序覆盖当前工程保留的完整实际口播 cue，不重叠、不漏 cue；每段含稳定 `id`、`title`、精确 `narration`、`sourceCueIds`、`footageNeed: required|optional|none`、`reason`、`visualTargets`、`evidenceRestrictions`。visualTargets 的每项含 `description`、`action`、`searchQueries` 和 `evidenceRole: proof|illustration`。cue ID 为当前 SRT 从 1 开始的整数序号。画面目标写配画面的目的、可见对象／动作和不同角度；搜索来源与词保留在审稿记录中。保留真人也审素材备选；none 写理由。允许相邻段共享候选，但各段独立判断。

审稿角色先只读完整口播、真实 SRT 与当前项目，产出逐段需求；搜索角色依据这份需求判断来源、适配、复用与实际可见内容。可隔离运行两个角色，也可在同一会话先审再搜；不规定模型、token 数或机械评分阈值。定稿后的审稿文件和媒体按 hash 绑定，提交层只读取校验，不在应用时重新创作需求或猜测位置。

### 逐句语义方向与可见关系（semanticReviewVersion=1）

新审稿在顶层声明 `semanticReviewVersion: 1`，sections 增加 `semanticIntent: {affirmed: [当前句肯定的对象/行为], contrasted: [被否定/被替代/被比较对象], relations: [{id, description}]}`；无对比或关系时保留空数组。先按实际推荐 cue 判断句意，不能把整段主题相关当成每句都适配。需要对比画面时，只配在真实出现对比的句子，或在明确可理解的对照呈现中使用。说“离不开语音输入”时，键盘打字是被替代的行为，不能在该肯定句上作为支持画面；说“嘴边的麦克风”时，必须看见嘴、拾音头与二者距离，并看得出人在对它说话，仅有人、耳机、麦克风物件或主题标签不够。

每个 candidate 增加 `semanticMatches`，逐段记录 `{sectionId, sourceCueIds, sourceInSeconds, sourceOutSeconds, verdict, observedAction, relationEvidence, framePaths}`。`verdict` 为 `aligned|contradictory|uncertain`，来自实际目检判断，不由关键词相等或图库标题推断。`relationEvidence` 每项为 `{relationId, visible: 布尔值, observation}`，引用该段的关系ID；`framePaths` 必须引用该候选 `review.frames` 中已实际目检的帧，视频帧带真实 `seconds` 且位于声明源窗口内。肯定、否定对象不同但有合理对照设计时，将设计及画面观察写清，仍以该推荐句的真实含义为准。

推荐 placement 必须被同段、同 cue 且覆盖其完整源窗口的 `aligned` 记录支持，所有要求的关系均有 `visible: true` 观察；相反或未能确认的候选可保留为已下载备选/淘汰记录，不能自动推荐入轨。finalizer 只检查记录完整性、范围与证据绑定，不能替代真实语义判断或声称自动理解视频。新请求可用顶层 `semanticReviewVersion: 1` 强制此门，缺字段直接失败。历史未声明的合同保留兼容，报告明确“未记录逐句语义验收”，不能以兼容通过追认画面正确。

## 搜索、获取与证据边界

情境示意、视觉隐喻与具体产品实证分开判断。阅读、学习、电脑操作等素材可以承担场景与节奏收益，不必证明作者的私人经历或产品的真实能力；禁止仅因“不是本产品实录”就把所有相关素材留库不推荐。仅当镜头明确要展示该产品实际操作或真实结果时要求相应实证。素材仍须与所配句子的实际动作及关系一致。


有价值的段落争取至少三个不同角度或来源的可用候选，优先五至八个，无固定总数上限。该目标帮助扩大选择，不用重复、无关或低清凑数。一次空结果不足以结束：继续调整对象／动作／角度关键词、来源和中英文词，并记录已搜来源、搜索词、失败与剩余缺口。

复用 `tools/broll.py` 的现有 Pexels／Pixabay、Wikimedia Commons、Internet Archive 与浏览检索能力，先现读配置及实现；需要保留全部合格检索候选时 `--candidate-limit 0`。直链工具的结果只是候选，免费且已明确可复用的素材默认实际下载；密钥缺失或源失败不写“没有需求”，继续公开源与浏览检索。许可判断按具体页面记录，不凭网站名称断言整个站点均可用；付费、授权待核实和私有素材单列。

每个 candidate 保留稳定 `id`、完整原片 `path`、`sha256`、`pageUrl`、`licenseUrl`、`reuseStatus`、`sourceKind`、`visibleContent`、`matchedSectionIds`、`matchReason`、实际 `width`／`height`／`durationSeconds`、`technical: {passed, decoded, probePath}` 和 `review: {sampled, frames: [{path, sha256}]}` 的真实技术／抽帧证据。`sourceKind` 统一用 stock／official-demo／user／public-reference，分别表示图库、官方演示、本人素材和公开引用。可用 candidate 的 `reuseStatus` 为 `downloadable`，实际 `kind` 为 video/image；licenseUrl 为可回查的 HTTP(S) 许可页面。搜索链接、下载失败、许可待核实、实际可用分别记录；仅可用且核验通过的候选进入媒体结果。文件短边实际至少 720px、优先 1080p，不能放大低清达标；下载后 probe、全帧解码、代表帧目检。保留完整原片，源窗口另存。

### 网站候选也按口播交付（2026-10-13）

完整package内执行审稿、检索、下载验收和推荐入轨，不把网络搜集默认推迟到broll。broll复用现有审稿和候选，按缺口、新输入或明确请求增量补搜，更新同一交付入口。

文档必须同时列出已下载可用候选、未推荐的可用备选、未下载网站线索、下载失败/授权待核实及已下载未纳入可用池的结果。每项包含对应口播原句、句号编号sourceCueIds或稳定段落ID、配画面理由/检索目标、来源网页、下载/验收/入轨状态。不能只列关键词或裸链接；一个候选关联多句时逐项标明。口播原句从当前共享SRT读取，不自行改写，也不为网站线索预设动画时间。

网站线索写入`searchLog[].links[]`，含`id/title/pageUrl/matchedSectionIds/matchReason/status`，尽量给出精准`sourceCueIds`。status为`searched_not_downloaded`、`download_failed`、`license_pending`或`downloaded_not_selected`；旧`reuseStatus`仍兼容。sourceCueIds必须属于已关联段落。报告在对应段落内展示原句和网页；网站线索不进入可用candidate数量，不生成占位媒体或入轨结果。

原始检索返回也保留完整索引；尚未目检的结果标“待筛选”，关联的是检索目标句，不宣称画面已适配。明显不相关的返回只留检索记录和淘汰原因，不强行归为推荐候选。实际可用文件全进项目素材库，推荐自动入轨；未下载页面仅在文档中供用户到网站查看。

普通图库只证明其实际可见场景，用作概念示意；不能冒充 AI 工具实际能力、本人婚礼作品、私人询价／私信或付费成交。官方演示与截图说明其来源及证明范围。需要私人证据而未提供时诚实留缺口，外部婚礼素材至多作明确的概念场景。

## 最小 JSON 示例

以下为仅含一条 0–3 秒口播 cue、30fps／90 帧工程的一候选结构示例；实际使用须替换所有绝对路径、哈希、页面、许可和实测数据，不把示例视为已验证素材。少于三个候选会被明确报告候选不足。

```json
{
  "schemaVersion": 1,
  "workflowMode": "real-footage-v1",
  "projectId": "project-1",
  "sourceSrtPath": "/absolute/raw.srt",
  "sourceVideoPath": "/absolute/source.mov",
  "sections": [{
    "id": "section-1",
    "title": "原型评审",
    "narration": "展示原型评审过程",
    "sourceCueIds": [1],
    "footageNeed": "optional",
    "reason": "用可见行为说明迭代过程",
    "visualTargets": [{"description": "团队评审原型", "action": "指向屏幕讨论", "searchQueries": ["prototype review"], "evidenceRole": "illustration"}],
    "evidenceRestrictions": ["图库仅作情境示意，不证明本人客户反馈"]
  }],
  "candidates": [{
    "id": "candidate-1",
    "path": "/absolute/完整原片.mp4",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "kind": "video",
    "width": 1920,
    "height": 1080,
    "durationSeconds": 8,
    "pageUrl": "https://example.com/media/1",
    "licenseUrl": "https://example.com/license",
    "reuseStatus": "downloadable",
    "sourceKind": "stock",
    "visibleContent": "团队指向屏幕讨论原型",
    "matchedSectionIds": ["section-1"],
    "matchReason": "真实可见的评审行为，可作概念场景",
    "technical": {"passed": true, "decoded": true, "probePath": "/absolute/probe.json"},
    "review": {"sampled": true, "frames": [{"path": "/absolute/frame.png", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}
  }],
  "placements": [{
    "id": "placement-1",
    "candidateId": "candidate-1",
    "sectionId": "section-1",
    "sourceCueIds": [1],
    "startFrame": 0,
    "durationFrames": 90,
    "sourceInSeconds": 1,
    "sourceOutSeconds": 4,
    "layout": "contain",
    "reason": "完整显示屏幕和讨论行为"
  }]
}
```

`sections[].id` 是段落 ID；只有 `placements[].sectionId` 引用该 ID。候选时长字段为 `durationSeconds`，不能写 `duration`。不同来源的证明范围仍须逐项核查，sourceKind 不能代替证据判断。

## 推荐位置与项目保护

`placements` 仅为本次推荐，含 `id`、`candidateId`、`sectionId`、`sourceCueIds`、工程 `startFrame`／`durationFrames`、原片 `sourceInSeconds`／`sourceOutSeconds`、`layout: cover|contain` 与 `reason`。真实 SRT 经当前 `source.clips` 映射到工程帧；可以只覆盖最有画面意义的部分 cue，不机械填满段落、不统一剪三秒。每个 placement 的 cue IDs 必须连续，多个分离位置用独立 placement。视频源窗口受实测时长约束，不拉伸、循环、定格或裁剪来凑原动画区间。静图 `kind=image` 的实测 `durationSeconds` 和两个源窗口值均为0，显示时长由工程 `durationFrames` 决定；视频不可伪报成静图。

全部可用候选通过统一媒体目录进入项目素材库，不自动加入公共库。推荐增加独立素材轨道／实例，素材自带音频静音，保留工程原声。横屏 UI 用完整显示的原生静态呈现，必要时原生不透明背景承托；场景／人像可按明确构图裁切，不裁掉关键界面信息。真实原片不继承旧 overlay 的 Alpha 要求。

这里的独立是指素材实例独立于口播，不要求每份文件单独占轨。新自动新增项按`docs/automatic-visual-tracks.md`优先与非重叠的自动素材/动画共轨，冲突才分轨；已存在及手动轨道不重排。

保留全部已有动画、模板、素材、镜头、字幕、音轨、封面、用户手调、锁定与显隐。同候选同目标幂等；删除、忽略、撤销不自动恢复，新版独立保留；并发重读并 CAS 保存。素材入轨、技术通过、代表帧目检、连续观看、听审与最终采用分别记录。

## 确定性提交与交付

```sh
python3 tools/footage_package.py finalize --request <external-job.json> --review <footage-review.json>
```

finalizer 校验只读输入、完整覆盖、文件身份与源窗口，生成报告、候选清单和结果 manifest，不直接写活动工程。已交付审稿和 manifest 不可原位重做覆盖；复用已验证结果，修订另建任务。每个媒体结果为 `kind: footage`，`footage: {reviewPath, reviewSha256, candidateId, placementId}`；`placementId: null` 为项目候选，有 placement 为推荐位置。`shotId` 和 target 对纯候选可省略；media 保留原片与可选源窗口，technical 绑定真实 probe／解码／hash。当前工程保存与实例回读才证明已入轨。

`outputs.footageReviewPath`、`footageSummaryPath`、`allCandidateManifestPath` 分别链接审稿、独立报告与全部候选清单；工程 `upstream.footagePackage.summaryPath` 链接最新报告。独立报告逐段列理由、目标、多候选、来源／许可／下载／核验、推荐位置及不足，不把待许可／未下载链接写成项目素材。

新 package/broll 当前模板／素材结果保存后，由宿主默认启动一次绑定 `parentJobId` 的独立 footage 子任务；用户明确只做动画或 `scope.footage=false` 才跳过。broll 的素材子任务复用当前审稿独立补素材；package/broll worker 只返回自身当前模板／素材任务的 manifest，不递归调用 footage、不将 footage 结果混入原 manifest。历史任务不自动补跑素材支线。package 总结增加“真实素材审稿与候选”完整章节和报告链接，区分进行／完成／缺口，唯一 Claude 提示词仍在文档末尾。素材任务不执行镜头推拉、字幕、封面或声音；这些仍是独立授权支线。无新增素材／动画审批。

## 只作方法参考的外部来源

已读源码与适配差异记录在本期 [公开技能调研](../workspace/footage/AI时代入行与赚钱门槛/research/skill-research.md)。[Louise find-broll](https://github.com/louisedesadeleer/b-roll-finder/blob/main/SKILL.md) 可参考全文意义审查、真实 artifact 和官方来源；[stock-media](https://github.com/anasdallah/stock-media-skill/blob/master/SKILL.md) 可参考多来源 API 和来源记录；[video-material-finder](https://github.com/30bewater/video-material-finder/blob/main/SKILL.md) 可参考来源页／许可／限制字段。它们是社区小仓库，安装数未知、未在本项目运行验证，不作为已验证软件或安装推荐。只借鉴方法，不继承其重复 ASR、固定镜长／覆盖率、默认单候选、低清回退、外部执行器或审批停点；下载后验收与本工程提交仍由现有本地工具负责。

## 单片段反馈素材执行

人工单片段修改可返回 `execution: {kind: "footage", instructions: "具体素材要求"}`，语义 patch 与执行请求独立；修改模型的只读限制不限制宿主随后派发的素材 worker。无执行需求时模型返回 `kind: "none"`，发布结果省略 execution；新增定制动画或声音仍报告真实能力缺口。

只有 `external-job.projectTarget.shotId` 明确存在才启用局部范围。使用冻结工程、共享 SRT、`source.clips` 与 `targetRange` 确定当前真实 cue；当前 SHA 绑定素材审稿优先提供语义关联，旧 package cue 序号可能属于润色前转写，必须与当前时间映射核对。sections 唯一一段且 id 必须等于 projectTarget.shotId，只完整覆盖所选范围，candidate/网站线索只关联这些 sections，placements 必须等于真实 cue 映射与 targetRange 的交集。禁止跨片段推荐或覆盖已有素材。其他 footage 请求继续全文覆盖。

执行分支实际复用或获取免费素材，保留来源和授权记录，probe、全帧解码、代表帧目检后提交可用候选与推荐；语义修改和未下载链接不算执行完成。
