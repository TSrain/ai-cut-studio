# Package → Broll → 编辑台：音效合同 v1

准则：`config/sound-design.md`。所有自然语言、非交互 worker 共用本合同。旧作品不强制补声音、不自动重做。

## Package

新 `shots.json` 顶层 `soundDesignVersion:1`，每镜写 `soundDesign`：

```json
{"decision":"cues","reason":"让最终数字落稳","cues":[{"id":"result-land","role":"emphasis","intent":"结果出现时一记温和落点","anchor":"这是最终结果","event":"number-land","texture":"短、干、轻，不盖口播","priority":2}]}
```

无需音效写 `{"decision":"silence","reason":"让结论由人声独立表达","cues":[]}`。这里的 silence 仅指不新增 SFX，不禁止 BGM；BGM 留白同样不自动禁用必要短音效。`role` 是 hook/emphasis/turn/action/transition/texture；priority 1 普通、2 重点、3 核心。每条 id 全片唯一。锚点和事件是意图，package 不填绝对时间。`package_contract.py validate` 自动校验新版；当前完整模式使用声音内容指纹，不触发动画需求版本或旧设计审批。保留原 `声音意图` 供人阅读。

独立 BGM 计划按 `docs/bgm-plan-contract.md` 执行，存 productionPlan 的 bgmDesign/推荐池而非 sound-cues.json。音效专项读取已保存的 BGM 计划作为协同意图，并核对实际 audioClips；不要把计划误当已播放音乐。避免持续底乐上再密集叠加强调，高理解负担段优先减小额外刺激。

4358 工程模式：在该镜 canonical 内容中保留 `soundDesign` 和顶层版本，不覆盖 productionPlan 用户修改；若 worker 的运输层无法完整保留新字段，返回缺口，不能静默丢字段后报成功。

## Broll

1. 继承批准的声音意图；与最新真实时间范围、源 SRT 和动画事件表对齐，复用转写。源视频有剪切/变速时用实际编辑映射，不拿原始 SRT 秒点直接当工程秒点。
2. 优先检查 visualization 音效库目录与 `tools/editor/sound-recipes.mjs` 的候选，按意图选音；不等于全部采用默认。scene 决策 silence 禁用该镜默认声；显式 cues 覆盖默认，同一事件去重。
3. 每项核实文件、来源及本次使用许可，记录试听。未听不得 reviewed。仅 technical-ready 的候选可标 draft 导入并显示待试听。
4. 输出 `sound-cues.json`，包含当前工程 id、revision、fps、总帧数与批准 shots.json 的 SHA-256。局部时间是镜头内解析结果，落到工程后写绝对 startSeconds；两者不能混用。

```json
{"version":1,"projectId":"<实际工程ID>","expectedRevision":12,"fps":30,"durationFrames":900,"planPath":"/绝对路径/批准的shots.json","planSha256":"<批准 shots.json 的64位SHA256>","cues":[{"id":"sfx-result-land","name":"结果落定","intent":"短而温和的落点","anchor":"这是最终结果","event":"number-land","timingEvidence":"shot-003 对齐的既有 SRT + number-beat 0.8 秒动画事件；实际工程起点 12.0 秒","file":"/绝对路径/已核实音效.mp3","startSeconds":12.8,"sourceInSeconds":0,"durationSeconds":0.17,"gainDb":-20,"fadeOutSeconds":0.03,"audition":"draft"}]}
```

在 visualization 目录执行：

```sh
node tools/editor-sound-design.mjs --manifest /绝对路径/sound-cues.json --url http://localhost:4358 --out /内部目录/sound-receipt.json --apply
```

去掉 `--apply` 只生成可审阅工程，不保存。导入复用原生 load/save CAS API，不直接改工程 JSON，不重启浏览器或服务。仅处理声音，不修改主片、字幕、画面和 productionPlan。revision 变化即停止，需要重新读取当前范围再解析，不能只把新 revision 抄入旧计划。

全量 broll scope.sound=true 才调用；4358 单镜任务 scope.sound=false 不导入全片声音。单镜声音仍可设计和回传待采用清单，用户可使用模板侧栏“添加默认音效”；不越过单镜任务范围。现有 worker 不自动识别 sound 类型渐进结果，因此此 CLI 是完整 broll 的显式收尾步骤，不伪造 result kind。

重复导入更新未手调音效，保留手动删除、音量修改、移动、锁定/禁用音轨和其他配乐。需要改变声音设计后重做，使用新的 cue ID 或明确由用户修改，禁止覆盖手调。每条为独立音轨片段，支持预览、拖动裁剪、静音、音量、淡入淡出；现有整片导出包含音轨。模板单层导出是否带声音须另行核验，不能把整片通过当单层通过。

## 验收

校验帧率/总长、源时长、重复 id、越界、素材哈希；CAS 冲突不重试覆盖。实际导出一段，ffprobe 确认音轨并检查采样数据，不只验证 JSON。完成有声/无声对比试听后才宣布效果通过。默认模板候选未经本期试听，不能等同“所有模板已配好最终音效”。
