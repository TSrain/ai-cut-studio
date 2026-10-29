---
name: content-footage
description: Use when the user asks for 真实素材审稿、素材搜集、给口播配网络画面 or footage, or a current package/broll needs its independent full-script real-footage branch.
---

# content-footage — 独立真实素材审稿与获取

读取根 AGENTS、`docs/artifact-layout.md`、[真实素材合同](../../../docs/real-footage-contract.md) 与 `docs/workbench-external-job.md` 的 real-footage-v1 分支。本技能是现有本地工具和合同的入口；外部 skill 只作经核查的参考，不安装或执行外部软件，也不迁移工作台。

明确 projectId 先 `python3 tools/editor_plan.py read --project-id <ID>`；只有 SC 先 discover，唯一绑定才使用，多绑定一次选择，不猜最近工程。普通对话启动并跟踪：

```sh
python3 tools/editor_plan.py jobs --project-id <ID> --kind footage
```

worker 收到 `external_job: /绝对路径/external-job.json` 时直接读 SHA 绑定输入，不递归派发。复用完整脚本、真实共享 SRT、源视频与 `source.clips`；缺输入诚实报告，不重复 ASR。

先逐段审完整口播，包括 animationNeed=none 和保留真人段，产出 `footage-review.json` 的 sections：稳定 id／title、精确 narration／sourceCueIds、素材必要性／理由、画面目标及事实边界。再按对象、动作、角度、多来源搜索，实际下载免费可复用素材。详见合同中“搜索、获取与证据边界”，复用 `tools/broll.py` 现有网络能力与浏览检索；有意义的候选优先五至八个，无硬总数上限，空结果调整词／来源继续并记录失败。图库概念示意不能充当 AI 能力或私人婚礼／询价／付费证据。

新审稿必须声明 `semanticReviewVersion: 1`，按合同记录 `sections[].semanticIntent` 与 `candidates[].semanticMatches`。先分清推荐句正在肯定的对象、被否定/替代对象；按实际 cue 判断，禁止把主题相关、被替代行为配到肯定句上。距离、方向、因果或比较关系必须有可见观察；例如“嘴边麦克风”须同框看清嘴、拾音头及距离，并由所选源窗口的实际开口动作支持。候选逐句判断 aligned/contradictory/uncertain，引用窗口内实际目检帧；仅 aligned 且关系完整可见才可推荐。没有合适画面就保留真人并记缺口，不用泛物件、泛键盘或标题标签凑数。

下载后核验完整原片的 SHA、实际尺寸／时长、全帧解码及代表帧；实际短边至少720、优先1080。真实 SRT 与当前剪辑映射决定 placements，源窗口不能超过媒体时长，不指定统一镜长。审稿和搜索判断可以隔离进行，最终文件只读提交：

```sh
python3 tools/footage_package.py finalize --request <external-job.json> --review <footage-review.json>
```

后端把全部可用候选加入项目素材库，推荐自动追加独立静音素材轨道；保留旧动画、手调、锁定和显隐，不加公共库、不新增批准。普通对话回读 jobs/read 核查已保存实例和报告；worker 返回真实 manifest，由后端提交，不能把提交或候选冒充入轨。

交付控制台与独立审稿报告；package 的“真实素材审稿与候选”章节链接本报告，Claude 提示词保持末尾。分别报告缺口、技术通过、抽帧、连续观看与用户采用。镜头推拉、字幕、封面和声音属于其它入口；本任务完成不代表这些已执行。
