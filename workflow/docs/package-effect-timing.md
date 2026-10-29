# Package 效果时间与镜头计划

在有真实主视频及共享原始 SRT 时，package 提前设计效果起始、关键变化、读懂停留和结束。只有脚本时保持语义设计，不估绝对秒数。最佳效果设计先于模板/定制比较；已有审批节点和 keyframes-only 边界不变。

## 可选 schema

每镜 `effectTiming` 是效果使用区间，`anchor` 是整段口播关联，两者独立：

```json
{"effectTiming":{"status":"draft","sourcePath":"/absolute/talk.mov","startSeconds":1.5,"changeSeconds":1.8,"holdSeconds":2.0,"endSeconds":2.5,"evidence":{"sourceSha256":"64 lowercase hex","transcriptHash":"64 lowercase hex","sourceCueIds":[1,2],"reason":"关键词后揭示、留出读懂时间"}},"cameraIntent":{"action":"push","anchor":"对应原文","reason":"收紧注意力","startState":"中景","endState":"近景"},"presenterLayerIntent":{"placement":"behind-presenter","reason":"文字在人物后展开","avoid":"脸、手势与原字幕"}}
```

秒数必须有限非负且 `start <= change <= hold <= end`、`end > start`；均为原视频源秒数，随现有 source clips 的剪切、时间线起点和 FPS 映射。sourcePath 必须等于当前 document.source.path，实际视频 SHA 必须匹配 sourceSha256，不能只凭相同路径复用。transcriptHash 必须匹配 snapshot inputs 中已绑定原始 SRT 及实际文件 SHA；cueIds 为一开始的连续序号，其全文必须对应当前镜头 narration。reason 非空。非法显式 timing 失败，禁止静默降为字幕时长。

Package 写 draft；confirmed 仅用于明确的实测时长确认，不自动意味着分镜批准。现有 `package_preview_timing` 保持 narration anchor，效果 start/end 决定 draft ruler ranges；manual ranges 及实际绑定素材区间优先。显式当前效果设计替换仅用于口播关联的 ranges；原已确认 narration anchor 不改。新 draft 效果使用 review 状态，不能沿用口播 aligned 状态作为渲染批准。效果和镜头意图经 `plan_from_package` / `canonical_package` 双向保留，其他 unknown 上游字段原样保留。草案 ranges 不作为实际渲染 target。

cameraIntent/presenterLayerIntent 是设计对象，无真实输入可只含语义锚点和起止状态。人物后方文字需 visualization 验证实际前景序列、透明度与合成；保存字段不是渲染能力或质量完成。broll 继承本期批准设计，精调真实事件与可编辑镜头，不因模板更省事替换路线。本批列举的创作限制已获用户批准取消；真实性、画幅、同步、可读性及审批继续执行。

人物后方强调属于可选候选，可用于非金句的重要概念，不强制所有金句采用。动效固定镜数/占比、金句定格、意象次数和固定来源排名已取消，full 无真人定义继续保持。准备真实前景后，visualization 可将批准实例设置 `props.presenterLayer="behind"` 并挂接带源 SHA/FPS/源帧范围的 `presenterForeground`；计划意图不等于已抠像或连续合成验收。

当前计划删除 effectTiming/cameraIntent/presenterLayerIntent 时，canonical 输出会移除历史值并记录 `deletedPlanningFields` 显式删除列表；导入只对该列表执行删除。旧 package 缺少可选字段不代表删除当前意图，不能借历史数据复活已删除设计；同一字段不能同时赋值和删除。显式删除也参与审批摘要。
