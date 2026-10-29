# Package 专项技术协议

当前 package 的自动模板匹配已下线：新请求 scope.templates=false，templates 只记录 skipped，不派发。下文 templates 协议仅供独立手动及历史任务，素材、AI 提示词和封面继续执行。

Package 规则唯一准源：../workflow/docs/complete-package-contract.md（本文件不重复）。

## 同源剪辑期间的发布校正（editReconciliationVersion=1）

声明 `editReconciliationVersion:1` 的 v2 snapshot 使用本节发布校正协议。准备阶段从保存字幕派生工程时间正文/SRT及 provenance，显式传递 `transcriptTimeBase`、`transcriptProvenancePath`。这组字段与 `sourceSrtPath/transcriptBinding` 原子合并，防止路径与时基混搭；文件独立归档并绑定 SHA，同内容源文件迁移必须 SHA 一致。

每项 operation 的原始 payload、readSet/writeSet、业务校验不改写。发布另附 SHA 绑定的原始文档基线；宿主在每次 CAS 尝试回读最新工程，将提案经同源片段映射后做三方合并，仅写声明字段。原片替换、时间原点、帧率/画幅、变速和非单调重排拒绝校正。人工删除、文字、锁定、隐藏及时间手调优先；完全删除的段落取消且清理关联，不复活素材。连续播放偏移的映射段合并，避免额外碎片。

字幕专项已应用的文本，仅凭本轮真实应用 receipt/readback 的 SHA 和身份核验后，再与提案在当前位置精确匹配，才免于被误判为人工语义改动。用户之后改字、删除或新增 cue 仍保护关联区间，记录 `reconciliation.needsReview`，专项应用保持 blocked/partial 直到校正，不把未应用建议计为完成。

最终计划保存使用最新字幕生成独立不可变派生正文/SRT，原始 ASR 缓存保持不变。测试使用隔离工程，技术通过不代表已真实观看或听审整片。

## 协调器调用接口

```sh
python3 tools/package_branches.py run --request /absolute/external-job.json --semantic /absolute/semantic-baseline.json
python3 tools/package_branches.py run --request /absolute/external-job.json --semantic /absolute/semantic-baseline.json --retry-failed
```

Python：`run_branches(request_path, semantic_path, *, runner=None, max_workers=3, retry_failed=False, cancel_event=None, slot_root=None)`。默认 runner 真正启动 `codex --ask-for-approval never exec --ephemeral --json --sandbox workspace-write`，cwd 为本分支 attempt 目录，不开放仓库/visualization 写目录，不允许提权。每支保留 worker.log、process.json 和协调器 execution.json。模型上下文与主聊天隔离，执行权限由专项请求与唯一合同限定。模型参数由当前 runner 的统一 Codex 调用入口组装。

## 输入与范围

真实素材、AI参考图和封面支（footage/aiVideo/cover）的子进程显式允许网络读取与素材下载，仍只允许写自己的 attempt 目录。BGM 获取权限和文件格式见 `docs/bgm-auto-execution.md`；其余支沿用默认网络限制。联网能力不授权购买素材、调用付费视频API或启动Claude；实际工具不可用应记录 blocked，不能写假媒体占位。每次执行仍由父取消信号或 cancel.request 管理整个子进程组。

请求必须有 `projectId/runId/outputRoot`，semantic JSON 必须有非空完整 `sections`。请求的完整脚本、共享 SRT、项目快照/当前计划、音视频和 sources 文件做 SHA 绑定；shared-input.json 包含原始请求、完整语义和依赖身份，以只读权限保存。当前快照提供 source.clips、画布、现用及保护状态。运行器读取主控提供的语义和需求版本。

shared-input、inputFingerprint 和 readSet 记录输入身份与依赖；请求/依赖指纹变化时原 attempt 的证据不再匹配。

## 各支输出

每支独立 `outputRoot/branches/<branchId>/<attemptId>/`，统一 `proposal.json` 为 `{schemaVersion:1,branchId,items:[],reason}`，reason 为本轮审阅理由，另按职责携带下列原生格式。无收益可明确留白，缺必需工具/输入须 blocked。

| branchId | 专项指令及提案 |
| --- | --- |
| templates | 全文复审与现读 MENU/定义，items 给 shotId/requirementVersion/preset/props/真实 startSeconds/durationSeconds/reason，另存 templateReview；不改组件 |
| footage | 独立全文审稿、检索、免费获取及技术/目检；footageAnalysisPath 指向原生 real-footage-v1 分析，全部可用候选和未下载线索保留；提推荐 placement，不入轨 |
| aiVideo | sections[].id + aiVideoCandidates；复用 ai_video_package 格式；参考图按上传顺序，真实文件+SHA；最终需求版本绑定；无假 URL |
| camera | cameraPlan 使用原生 source.cameraPlan；readSet/writeSet 指向源剪辑/镜头字段，不写工程 |
| captions | captions 原生值、segmentationReviewPath、readSet/writeSet；逐cue语义断句、共享SRT与可信对齐，不平均伪造时点 |
| bgm | sections/bgmDesign、recommendations 与 execution；数据格式见 `docs/bgm-plan-contract.md`、`docs/bgm-auto-execution.md` |
| cover | coverCandidateManifestPath 指原生 schema2 manifest，source.md/source.json/references.json及实际图片全部列入 files/SHA；生成不可用则 blocked |

子 worker `result.json`：

- 原样绑定 `projectId/runId/branchId/attemptId/inputFingerprint/dependencies`。
- `status`: complete 或 blocked；blocked 必须有 gaps。
- `manifestPath/reportPath`: 本目录真实 proposal.json/report.md。
- `files`: 所有报告、提案、媒体及附属文件的 `{path,sha256}`，绝对路径且 resolve 后仍在本支目录。
- `proposedChanges`: 原生提案数组；主控读取并做各业务的完整校验后才统一应用。
- `acceptance`: `{applied:false,technical,viewed,listened}`，各维度独立如实记录。
- `gaps`: 缺口数组；complete 是子 worker 提案的状态。

运行器强验封套身份、全部文件 SHA、提案最低形状、文件位置及 applied=false。**各原生提案的业务校验仍由原有专项工具和主控完成**；它不自行把 JSON 提案变成有效工程修改。

## 状态、恢复、取消与预算

`outputRoot/package-branches.json` 持久保存 version/projectId/runId/inputFingerprint/sharedInputPath/sharedInputSha256/status/branches；branches 为启用专项字典。每支记录 queued/running/complete/blocked/failed/cancelled/skipped、attemptId、起止时间、request/result/manifest/report/execution 路径与 SHA、files、acceptance/gaps。协调器原子替换 JSON；同 outputRoot 文件锁保证只有一个协调器。

最多三个跨运行全局 flock 槽，默认系统临时目录 `codex-package-branch-slots-<uid>`。独立父任务不能靠加本地线程数绕过三个槽；每个真实进程继承槽 FD，协调器异常退出后活着的 worker 仍占槽。轮询空槽，不提供严格 FIFO 公平保证。`slot_root` 只供隔离测试或显式宿主统一配置，不应每个生产任务不同。

失败兄弟继续。有效成功成果复用；`--retry-failed` 只重跑失败支，产生新 attempt 目录。未完整发布的中断 running 被标失败，不无声重复；存在仍存活旧进程组则阻塞重试，避免并行重做。已完整发布并有成功 execution 回执的结果可直接恢复。若操作系统强制杀死协调器而没有终态回执，需要检查证据并明确重试；不能把未知结果自动当成功。

SIGTERM/SIGINT、cancel_event 或父 outputRoot/cancel.request 文件触发取消；独立监视线程每50ms检查取消文件，不依赖主控/模型/工具进程处于同一进程组。启动前与最终发布前同步检查，已存在取消文件不会启动任何新worker；重试前由父任务明确清理取消文件，运行器不自行删除。排队任务不启动，运行任务组 TERM 后 KILL，组内后代一并停止；即使 worker 随后返回成功，也拒绝迟到结果。此保障针对正常继承的进程组；自行脱离 session 的外部守护进程不能靠进程组机制管理，worker 被禁止发起脱离管理的后台工作。

## 主控校验接口

`validate_branch_run(request, path, allow_partial=False)` 返回已验证的整个状态字典。默认要求全部启用支线 complete；allow_partial=True 允许失败支存在，但仍完整验证每个成功支身份、输入、request/result/execution/文件 SHA，不能让失败支伪装 complete。

execution.runnerKind 区分 codex 与 injected，后者仅为可注入测试 runner 的执行证据，不是实际模型制作证明。`status` 字段不是 `state`。最终证据清单使用路径与 SHA 记录状态文件、shared-input、各支 request/result/execution 和 files。
