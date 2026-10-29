# 编辑器导出性能与实时进度

导出仍通过 `tools/render-queue.mjs --concurrency 2`，逐个任务由 `tools/editor-export-worker.mjs` 执行，保留独立的文档、源码与 props 快照。

- 队列日志实时写入，每秒读取最后 256 KiB 展示阶段进度；不是按时间伪造的总百分比。准备、编译、渲染、编码、校验各自显示状态。帧数足够时显示本阶段预计剩余时间，文件验收通过才完成。
- 编译缓存位于 `workspace/editor-bundle-cache`，键覆盖 src、配置、锁文件与实际安装依赖版本。临时目录编译成功后原子发布；同键互斥，失败不发布。public 使用本地符号链接，避免重用过期素材副本。修改文案或时间轴无需重新编译。
- 独立视频实例只有在完整覆盖画布、无裁剪/变形/转场/额外效果、实际文件与画布及 CFR 时间轴一致时走原生视频路径。未知字段、HDR、旋转、变帧率等均回到 Remotion。逐实例静音行为保持与 MediaPip 一致。
- 原生 MP4 只在完整 H.264 输入可精确复用时复制视频流；其他情况准确裁切转码。MOV 保持 ProRes4444 与 Alpha。文件先写同目录临时路径，成功才替换输出，失败保留旧文件。
- MOV 尝试 VideoToolbox，失败自动回退软件编码。MP4 原生转码和浏览器编码暂保留软件 H.264；没有用未经验证的画质设置换速度。

排查证据：每项 `.performance.json` 记录路径、缓存命中与耗时，`queue.logs/` 包含阶段事件和底层日志。`getEditorJob()` 是异步接口，HTTP 调用需 await。

验证命令：

```sh
node --test tools/tests/editor-bundle-cache.test.mjs tools/tests/editor-native-video.test.mjs tools/tests/editor-export-progress.test.mjs tools/tests/editor-export-progress-ui.test.mjs tools/tests/editor-export-lifecycle.test.mjs tools/tests/editor-export.test.mjs tools/tests/render-queue.test.mjs
node tools/build-editor.mjs
```

2026-10-09 的本机样本：同一 189 帧、1920×1080、6.3 秒 MOV，原浏览器流程 190.5 秒；原生软件导出 15.5 秒；缓存命中与硬件编码的浏览器流程 81.9 秒。不同内容与机器负载差异很大，不把该样本外推为所有动画的加速倍数。详细测试产物在 `workspace/export-performance/`。

验收补充：27 项自动化测试通过；浏览器实测出现 78/90 帧、87% 的实时进度并完成下载。透明动画的硬件/软件输出均包含透明、半透明和不透明像素；中间帧 alpha 的平均绝对差为 0.0046/255。真实视频中间帧已目检，三帧对照 SSIM 为 0.9965。

## 2026-10-10：整片底片与镜头推拉

此前原生快速路径只覆盖独立素材，不能用其耗时代替整片性能。另有多端口旧 Node 服务保留旧模块：4360 的旧进程仍直接调用 Remotion CLI，新前端却只读取 telemetry，导致有帧进度时仍显示准备素材。前端现在兼容旧服务的 progress；新导出必须由加载新版 editor-export.mjs 的服务发起，刷新网页不会更新 Node 模块。

`editor-native-source.mjs` 为无动画实例、只有本地底片与镜头轨的 full MP4 提供视频合成。复用导出快照中的镜头编译器，按文档时间处理推拉和裁切；全景区间跳过透视滤镜。VideoToolbox 解码与 H.264 20Mbps 编码失败时回退软件 libx264 CRF18。保留首条原声音轨内容，AAC 192kbps 输出。当前限制 SDR、恒定且相同帧率、不超过30fps和1080p像素数；叠层、未知源属性、HDR、旋转等仍走 Remotion。输出先写临时文件，再原子替换。

本次恢复副本的完整快照为239.7秒、7191帧，硬件合成实测163.7秒；实际输出1080p30，声音239.678秒，与视频相差22毫秒。真实推拉片段的浏览器/原生画面已目检，原生缩放滤波与浏览器栅格化不同，并非逐像素相同（该3秒片段SSIM约0.931）。自动化覆盖帧数、音轨、裁切、延后开始的镜头曲线和整片/片段一致性、硬件失败回退及旧服务进度兼容。

随后从已更新后端的4358编辑器页面发起同一恢复副本整片，页面确认完成，用时2分19秒；任务 e319b4a4-2bd8-4849-a68b-4e75e9c9cc21，独立 performance/manifest 均完成。4360旧任务保留，不能把网页刷新当成后端升级。截图和对照文件在 `workspace/export-full-fix/`。


## 2026-10-12：统一混合导出与内容缓存

所有编辑器模式（full/layer/instances/clip/single-layer）共用 worker 和内容缓存。完整画幅的既有视频/Alpha MOV 直接复用；底片剪辑和镜头曲线交给 FFmpeg，复杂 CSS/PIP 仅在其必要区段回退到原渲染器。源媒体未知属性、HDR、旋转或非恒定时间轴时保留正确性回退，不静默删效果。

字幕使用同一 CaptionLayer 渲染每种实际文字的 PNG 图版，按半开帧区间合成；不是将字体换成另一个字幕引擎。裁切只去掉透明空域，不改变字形或位置。独立音轨和淡入淡出在最终混音里保留，不再因存在音效强迫整片浏览器渲染。CoverFrame 第一帧保留其现有背景、模糊和适配。

使用 VideoToolbox 编码，硬件不可用才回退软件。复杂视频/PNG 栅格缓存、最终合成缓存与模板/旧字幕 CLI 缓存均绑定实际素材字节、字体和编译指纹；同内容跨保存版本可复用。编译仍走既有 ensureExportBundle，正式渲染仍走 render-queue。缓存锁可恢复，临时文件验收后才发布；APFS 写时复制减少内部重复文件占用，用户交付文件保持独立。

模板 makeExport、透明模板 exportAlpha、caption-store、caption-finalize 和 caption-iterate 的生产 render 由 tools/remotion-export-cached.mjs 统一包装，保留各自合同与 Alpha 复核；不是只改 tocapcut。源码/props/实际素材变化会失效缓存。

导出 manifest 原子保存，保留 worker/owner PID；新进程可恢复读取已完成/失败任务，不用旧 running 状态冒充活跃任务。产物优先进入 projectBinding 指定的本期目录。

实测当前 4139 帧、2160×3840、30fps 全片：229 秒（3 分 49 秒），4 段既有画面原生合成、0 个复杂区段、110 种字幕图版（含空白）、6 路音轨（原声+5 音效）。完整 MP4 137.966667 秒，605480508 字节，已全片解码；镜头/字幕和 Alpha 对照帧已目检。原生缩放与浏览器栅格化不是逐像素相同。

3.067 秒真实 4K 片段第一次完整准备为 8.6 秒；视觉图版缓存后为 5.3 秒，最终合成缓存命中为 0.694 秒。模板包装器二次输出 SHA 相同且命中缓存。45 项导出/队列/时间轴/取消/Alpha/混音回归通过；这些数值不外推成所有项目固定耗时。

依赖：本机 FFmpeg、既有 Remotion 环境；字幕图版裁透明边界使用 /usr/bin/python3 的 Pillow。模块：tools/lib/editor-hybrid.mjs、editor-export-cache.mjs、tools/export-caption-plates.py、remotion-export-cached.mjs。

旧字幕独立引擎 CaptionFromProps 的正式 narration 角色短片也已通过包装器真实 ProRes4444/Alpha 渲染；空/过短脚本继续被原引擎拒绝，未绕过其业务校验。
