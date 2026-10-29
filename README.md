# AI Cut Studio

**本地运行、可编辑、保留原片的 AI 口播剪辑工作室。**

把视频导入时间轴，编辑字幕、调整镜头、放置模板和素材，再导出视频。需要时接入 AI 做口播粗剪和制作调度；不要求先建飞书业务表，也不携带作者的个人资料。

**状态：0.1.0 Alpha。** 适合愿意自行安装环境的创作者与开发者，不是开箱即用的桌面安装包，也不是可直接上线的多人 SaaS。

## 第一版包含什么

- 可编辑时间轴、非破坏式片段引用、撤销/重做、轨道锁定与保存。
- 同源 SRT 导入与共享转写缓存，避免不同制作环节重复识别。
- 口播粗剪：停顿检测、可选字词对齐、AI 重录选择及可恢复的切点。
- 字幕、镜头控制、画中画、音轨、素材和 28 个 Remotion 模板定义。
- Package / B-roll 制作合同、任务恢复、结果校验及版本冲突保护。
- 外部动画按交付清单导入，不覆盖已有手动编辑。

**刻意不包含：** 作者的选题采集系统、账号定位、个人写作训练、历史脚本、肖像、私有飞书表、商业音效/BGM、参考视频和已完成项目。

界面和现有创作合同以中文为主。`studio/` 负责编辑与渲染；`workflow/` 负责粗剪、时间轴和制作调度。它们在同一仓库内，不依赖另一个私人仓库。

## 安装与启动

需要 **Node.js 22+、Python 3.11+、FFmpeg/ffprobe**。使用 Chrome 或 Chromium 系浏览器。

目前主要在 macOS 验证；Linux 有源码测试路径，但未完成全部用户操作验收。Windows 原生尚不支持（文件锁、shell 与部分系统工具依赖 POSIX），可尝试 WSL2。

先从本仓库 GitHub 页面克隆或下载源码，然后在根目录运行：

```sh
npm run setup
npm run doctor
npm start
```

`setup` 用现有锁文件安装 npm 依赖，并从上游下载带许可和 SHA-256 校验的字体。首次渲染可能另外下载 Chrome Headless Shell。字体与浏览器安装需要网络，**不上传用户媒体**。

打开启动日志中的本机地址。保持终端运行，`Ctrl+C` 结束。默认只监听 `127.0.0.1`。换端口可用：

```sh
PANEL_PORT=4399 npm start
```

首次启动不会批量渲染模板卡片。未生成的缩略图/循环预览是正常状态，模板本身仍可编辑和渲染。

## 不用 AI 也能开始

1. 新建工程，导入自己的视频。
2. 导入与原视频时间原点一致的 SRT，或手动编辑字幕。
3. 调整片段、字幕、镜头、模板和音轨，保存工程。
4. 从编辑器导出，确认实际分辨率、帧率和内容。

源媒体、工程、缓存位于 `studio/workspace/` 与本地 `public/`；交付物默认放根目录 `output/`。这些目录不进 Git。

无账号的最小转写复用示例：

```sh
python3 workflow/tools/transcribe.py \
  --audio /absolute/path/video.mp4 \
  --source-srt /absolute/path/video.srt \
  --out workflow/workspace/demo/transcript
```

这一步只登记并复用已有时间码，不执行 ASR。不得把来源未知的字幕、变速后字幕或另一遍录音绑定到当前视频。

## AI 与云服务是可选配置

### AI 粗剪与制作

目前后台 worker 使用 **Codex CLI**，不是任意模型 API 的统一适配器。请自行安装并完成官方登录，先确认你的 CLI 支持 `codex exec`。

默认从 PATH 找 `codex`，模型与推理配置继承用户自己的 CLI 设置。需要覆盖时：

```sh
CODEX_BIN=/absolute/path/codex CODEX_MODEL=your-available-model npm start
```

也可在忽略的 `workflow/.devin/codex.local.json` 写入 `binary`、`model`、`reasoningEffort`。不要提交账号凭据。

在 Agent 中打开本仓库并读取 `AGENTS.md`；Devin 可直接使用根目录 `cut-studio` skill，其他 Agent 可按文件路径读取相同合同。自然语言例如：

> 给这个视频做口播粗剪，保留完整观点；已有同源 SRT，不重新识别。
>
> 给当前工程做 package，保留手动修改，缺少的外部能力请明确报告。

AI 输出需审看和试听。完整 package 还可能需要图像生成、素材搜索、授权媒体与可选对齐模型；源码测试不能证明这些外部能力已经配置或效果达标。

### 飞书转写

**默认不启用云端上传。** 没有缓存或同源 SRT 时会报告缺少转写。
只有同意将音轨上传到自己的飞书账户，并自行配置好 `lark-cli` 后，才设置：

```sh
TRANSCRIBE_PROVIDER=feishu npm start
```

登录、权限、额度、费用和数据处理受服务商条款约束。代码没有为你授权，也不附带作者账号。当前没有内置本地 Whisper ASR；可用外部工具生成 SRT 再导入。

### 肖像、声音与自定义动画

- 封面默认不要求本人。仅在用户授权并提供肖像后使用人物方案；可通过 `--portrait-dir` 或忽略的 `workflow/.devin/cover.local.json` 指定目录。
- 不打包音效、BGM 或网络视频。模板声音配方是候选事件说明，不代表素材存在、可以再分发或已经试听；请导入自己有权使用的音频。
- 人物抠像使用 macOS Vision，目前该功能限 macOS。
- HyperFrames 是可选渲染路线，需独立安装和验证；默认编辑器渲染走 Remotion。
- 自定义动画可由用户选用的 Agent 生成，交付合同见 `workflow/docs/animation-delivery-manifest.md`。不自动启动 Claude 或替用户购买生成服务。

## 开发与验证

```sh
npm test
npm run build
npm run test:studio
npm run test:workflow
npm run audit:release
```

启动编辑器后，另一个终端运行 `npm run smoke` 可生成纯合成测试片、登记同源 SRT、通过真实 HTTP 接口导入/保存/导出，并核验解码、分辨率、时长及音轨。使用非默认端口时设置 `STUDIO_URL=http://127.0.0.1:4399`。这不调用 AI、不上传媒体，也不代表真人口播听审。

源码测试默认不要求私人音效库和生成的模板预览；相应资源验收会明确显示 skipped，而不是通过。已安装自己的完整资源库时，可用 `STUDIO_ASSET_TESTS=1 npm run test:studio` 执行相关检查；该验收仍包含原资源库的历史规模断言，不是通用安装门槛。

部分图像合成回归测试使用系统 `/usr/bin/python3` 的 Pillow。Ubuntu 开发环境可安装 `python3-pil`；其他系统需为该解释器配置 Pillow。它不是基础编辑器启动依赖，也不要把现有测试夹具解释器当作所有 Python 工具的统一配置。

源码保留了部分历史工具和合同以支持既有数据结构；标注为历史分支的入口不是第一版推荐路径。首次使用从编辑器及当前 package 合同开始，不按历史工具逐个执行。

### 当前边界

- 没有打包安装器；依赖下载、FFmpeg 和 AI CLI 仍需用户安装。
- 没有公网认证、租户隔离和服务配额，不支持把本地服务暴露到公网。
- 没有承诺所有平台、所有模板、任意 CLI 版本和付费生成服务都已端到端验证。
- 包含 28 个模板定义不等于 28 个都已完成公开版连续观看验收；人物抠像模板仍为 draft。
- 听审、肖像授权、第三方素材再利用和最终发布由使用者确认。

## 许可与贡献

原创部分使用 **Apache-2.0**，见 `LICENSE` 和 `NOTICE`。

**Remotion 使用自己的许可证，不受本项目 Apache-2.0 覆盖。** 当前锁定版本对个人、小规模组织和较大营利组织区分授权条件；商用前请核查其当前条款及你实际安装的版本。字体、图标、第三方参考代码、FFmpeg 与云服务也保留各自许可。

欢迎提交可复现问题和小范围修复。请使用合成素材复现，不在 Issue 或 PR 中上传私人视频、转写、账号配置或商业音效。新功能应保留原片、手调、可撤销编辑和输入版本校验；新增依赖需说明用途及许可证。

---

**English:** AI Cut Studio is a local-first, source-available editing workflow with Apache-2.0 original code: editable timelines, captions, reversible talking-head roughcuts, templates, and optional Codex-based production orchestration. Personal content and accounts are excluded. Start with `npm run setup`, `npm run doctor`, then `npm start`. Remotion and other dependencies retain separate licenses. This alpha is not a hosted multi-user service.
