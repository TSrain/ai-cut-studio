# 字幕时间与样式质量门

共享原始转写是文字与粗时间依据，不等于逐短句上屏依据。字幕制作保留共享SRT及其SHA，编辑结果只写工程 captions。禁止为了修字幕重新上传、自动重转或重复ASR。

## 制作默认值

- 同一口播字幕轨默认继承全局颜色、字号、字体和字重。不因“数字”“重点”自动把整句变黄或变大。用户已明确授权的局部样式、确有证据的手调可以保留；不能把模型主动设计或旧自动结果当用户手调。
- 现场演示、停顿、低声说话按真实原声和现有剪辑映射处理。字幕文字不能提前跨过演示，把尚未说出的后半句整句提前展示；演示本身保留，不能通过删视频掩盖字幕问题。
- 对源cue及工程显示cue运行 `tools/caption_quality.py`。源cue超过5秒或工程单条显示超过5秒标记需时间复审；这是保守筛查阈值，不证明慢句有错，也不要求机械切成短句。
- 时长筛查不能替代断句：不足5秒也可能合并多句。每次按全文逐条审工程字幕的独立表达、演示引导、呼语及实际停顿；例如“你就可以解锁 / 和AI的悄悄话模式 / 给你看一下”不能因只有3.67秒就跳过。按实际话语边界上屏，不把完整SRT块或几句话提前合成一行；不是机械按字数或标点拆分。
- 新package/handoff请求在冻结前声明 `captionSegmentationVersion=1`。字幕executed回执须提供 `captionSegmentationReviewPath` 并将JSON文件列入files/SHA；该文件 `version:1`、`cues` 按当前全部cue覆盖，每项含 `cueId`、`cueSha256`（`cue_digest`生成）、`decision:keep|split_required`、具体 `reason`。缺记录、遗漏短cue、文字/边界变动或仍需拆分均不能通过。先完成拆分，再重读工程重新审阅；语义复审不替代词级时间/听审/本地对齐证据。
- 已有可信词级时间码必须先确认与当前视频及 source.clips 的对应关系。没有词级时间时，针对该段实际听审或用当前文字本地强制对齐；强制对齐不得生成新识别文案，不触发云上传。没有真实边界就记录缺口，不能按字数均分时间。SRT比对、截图和全片解码均不能证明音画同步。
- 制作前运行一次，CAS应用后按最新工程回读再运行。修改文字、区间或样式会使相关旧复审回执过期；沿用旧分支结果也要通过当前质量门。

## 只读命令

```sh
python3 tools/caption_quality.py \
  --snapshot /绝对路径/本轮工程回读.json \
  --source-srt /绝对路径/共享原始.srt \
  --out /绝对路径/caption-quality.json
```

退出码0表示所有机器筛查项已通过或有有效复审证据；退出码2表示仍有待处理项。报告 `listening: not_performed` 始终表示工具自身没有听音频，不能以退出码0宣称真实听审或用户采用。

全量语义断句复审使用 `--require-segmentation-review --segmentation-review /绝对路径/逐条断句复审.json`。工具校验覆盖范围与内容身份，语义判断由Codex逐条完成；不能声称哈希校验能自动理解口播。

`--reviews /绝对路径/reviews.json` 可提供时间/样式复审数组。每项包含：

```json
{
  "findingId": "source:12:coarse_source_timing",
  "findingSha256": "当前finding的内容SHA256",
  "method": "listening",
  "reason": "真实复审的具体结论及保留或修正理由",
  "evidencePath": "/绝对路径/本轮分段听审记录.json",
  "evidenceSha256": "证据文件SHA256"
}
```

finding SHA通过 `tools.caption_quality.finding_digest(finding)` 取得。时间类仅接受 `listening`、`word_timestamps`、`forced_alignment`；样式类仅接受 `user_authorized_style`、`preserved_manual_style`。原始SRT一致、机器均分或“已保存”不构成时间复审依据。真实慢句可按听审结论保留，无需为通过机器门硬拆。人工/对齐记录应写出源视频身份、实际听过/对齐的区间、上屏边界与结论；本工具只核对复审声明、内容绑定和文件完整性，不虚构感知验收。

## 完整package接入

`tools/package_production.py` 对 fullPackageVersion=1 的 captions executed 自动运行此门。可在字幕回执内放 `captionQualityReviews` 数组；每份证据同时列入本轮回执 `files/SHA`。存在未解决项时不能报字幕 executed 或完整package完成，应先修正或据实记录 blocked/partial。没有 fullPackageVersion 标记的历史合同保持兼容，不回写旧工程。

审查源cue和当前显示cue两层，避免把粗cue按字数拆短后就绕过时间复审。质量门不修改字幕、视频、剪映草稿或共享缓存，也不启动模型worker。
