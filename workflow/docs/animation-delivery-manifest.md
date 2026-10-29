# Claude 动画交付清单（2026-10-13）

本合同用于 semantic-template-v1 外部动画交付。Claude 随真实媒体生成 `animation-delivery.json`；Codex 直接按清单时间放入当前 Motion Studio 工程，不再校对原分镜、旧视觉形式或重新推断位置。package 总结末尾提示词只交需求、完整脚本/SRT/主视频/规则及输出路径，制作范围、跨段拆合镜、起点和时长由 Claude 自定。无动画审批或视觉选择停点。

## JSON 格式

| 字段 | 约定 |
| --- | --- |
| schemaVersion | 整数 1 |
| timeBase | `project`；当前工程时间轴 0 秒，不是未剪源视频零点或素材内部时间 |
| projectId | 可选，提供时必须与当前工程一致 |
| sourceVideoSha256 | 可选，提供时核验主视频身份 |
| files | 非空数组，允许多文件、跨段合镜和区间重叠 |
| files[].file | 真实媒体路径；可相对 JSON 所在目录或为绝对路径 |
| files[].startSeconds | 有限数字，非负；由 Claude 决定的工程起点 |
| files[].durationSeconds | 有限数字，大于 0；真实交付时长，不以旧模板时长补齐 |
| files[].transparent | 必填布尔值；false 为完整画面，true 为实际透明叠层 |

不要求 shotId、原分镜逐一对应、冻结视觉合同、关键帧、源码或 Codex 派发回执。相关段落 ID 可额外记录，仅作信息关联，不能成为入轨条件。

下列秒数仅示例格式，不是制作时间约束；实际清单由 Claude 根据当前工程时间基准与真实媒体填写。

```json
{
  "schemaVersion": 1,
  "timeBase": "project",
  "files": [
    {
      "file": "关系解释.mp4",
      "startSeconds": 12.4,
      "durationSeconds": 5.8,
      "transparent": false
    },
    {
      "file": "数字强调.mov",
      "startSeconds": 34.2,
      "durationSeconds": 3.6,
      "transparent": true
    }
  ]
}
```

清单作为文本放本期隐藏 `.制作资料` 或仓库 workspace，遵守 `docs/artifact-layout.md`；媒体留可直接使用的资源分类。相对路径以清单目录为准，不以 cwd、归档目录或文件名猜测。若直接从媒体路径触发导入，要在原媒体同目录自动发现标准文件名后再归档；归档/暂存必须保全原相对引用或解析为真实绝对路径。

## 导入与保存

控制台制作计划支持交付 JSON 绝对路径。当前工程已明确时，也可从主仓库执行：

```sh
python3 tools/editor_plan.py jobs --project-id ID --kind recognize --delivery-manifest /abs/.../animation-delivery.json --no-camera --no-sound
```

`ID` 与路径由实际目标工程和真实交付替换；该示例仅导入动画，不追加镜头或声音任务。通过同一工程 API 执行，不能直接改活动工程 JSON。

1. 任务提交层先解析原清单引用，暂存不可变清单及技术依据，记录哈希；worker 使用该快照，不读取随时可变的原清单替换位置。
2. 校验 JSON/字段、真实文件与解码可用性、实际时长、工程时间边界及提供的工程/主视频身份。声明 true 时可核验实际 Alpha；此为技术检查。不强制补 SRT、上传 ASR、模型复核或按内容抽帧匹配。
3. 清单 startSeconds/durationSeconds 是权威位置，按工程帧率换算到帧。允许与旧模板不同，允许跨段合镜，不拉伸、循环、定格或裁剪来塞旧范围。文件缺失/损坏、时长不符、越界、身份不符或透明声明不成立时报告技术错误，错误清单不静默转为旧识别猜位置。
4. 技术通过后直接追加独立实例，按`docs/automatic-visual-tracks.md`优先与非重叠自动素材/动画共轨，时间重叠或叠加顺序冲突时分轨，保留新交付在已有重叠画面上方的层级。transparent=false 的完整画面覆盖人物画面，可已经包含人物，保留工程原声；不因旧计划 overlay 而要求 Alpha，也不重复播放交付媒体中的原口播。transparent=true 按实际透明叠加。实例可独立选择或删除；不重排用户现有轨道。
5. 保留原模板、素材、用户手调、锁定、显隐和当前计划，不选择旧实例作替换目标。重复导入幂等，用户删除/忽略不自动恢复，新版本独立追加；并发重读并 CAS 保存。当前工程保存及实例回读才证明已入轨。

## 没有清单的普通素材

仅没有交付清单时复用原素材识别：探测、解码、抽帧，对照当前需求/SRT合理匹配后自动并列追加；不能凭文件名/编号猜位置，无法定位就记录歧义并保留文件。无清单 overlay 继续检查实际 Alpha 和真人合成。该回退不适用于已经发现但无效的清单。

技术通过、已入轨、实际连续观看、听审和用户最终采用分别报告。清单导入不设动画内容、模板、Styleframe、接触印张或关键帧审批，也不自动启动或等待 Claude。
