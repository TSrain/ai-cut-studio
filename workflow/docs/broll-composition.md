# B-roll：动画 / 素材推荐与可编辑组装

2026-10-09 用户批准。与 `broll-parallel-options.md` 同读；本文件的表达路由、推荐版组装规则优先于旧“动画总是主交付”和“控制台只接动画”的说明。

## 表达判断由 Codex 完成

逐段读取真实口播，先决定是否需要 B-roll；适合纯动画才给动画，纯动画和素材都适合则给两路方案并推荐一版，不为凑选项强做两路。纯动画是图形、文字、图表等；真实/生成图片视频的入场、裁切、铺叠、分屏都归素材呈现。制作方式不决定优先级。

素材优先找网络来源。按语义动作、证据属性、构图、清晰度与可用片段判断能否满足；找不到或不准确时，对概念/解释场景提供 AI 视频方案。不得用 AI 新闻截图、伪现场替代事实证据。用户在即梦等工具生成后回传，工作流不自动调用付费生成服务。

每个 AI 片段交付 `generation`：`brief` 简述、完整可复制 `prompt`、`durationSeconds`、`aspectRatio`，可加 `avoid`。提示词写主体、场景、具体行为及时间变化、景别、机位、运镜、光线风格、分屏所需留白；不要把分屏边框和入场焊死在原始视频中。分屏两路各给一段，组内按素材 ID 对应槽位。未生成仅计提示词完成。视频短于展示区间时默认停留末帧，可设置 playback=loop；交付文档注明选择，不能默默拉长视频。

## 数据与审批

组装服从 `docs/animation-design-standard.md` 的效果优先与批准路线。原生 preset 保留真实 props；定制工程保留源码、合同、实际媒体及可编辑范围。定制渲染可作为媒体接入已有支持的路径，但不能把渲染文件说成内部对象可编辑；接口未支持时报告接入缺口。不能为了满足模板 props 的接口，把已批准定制降为模板，也不能伪造 preset 身份。

保留原 shots.json、visual-options.json 和 package 审批。新增 sidecar `composition.json` 记录可编辑工程，不改旧 `selection=both` 两套备选语义。package 先写推荐及理由，整批分镜内容批准后制作关键帧；broll 才使用终稿录音的真实秒点并组装。网络素材获取困难时可交 AI 生成提示词，不静默改成纯动画。

`composition.json` 必须为：

```json
{
  "version": 1,
  "id": "SC-demo-composition",
  "name": "本期可编辑作品",
  "approval": {"status": "approved"},
  "canvas": {"width": 1920, "height": 1080, "fps": {"num": 30, "den": 1}, "durationFrames": 450},
  "source": null,
  "shots": [{
    "id": "shot-01", "text": "本段实际口播原文", "startSeconds": 3.0, "endSeconds": 9.0,
    "recommended": "media", "reason": "实拍能直接展示动作",
    "options": [{
      "id": "media", "route": "media", "status": "pending", "description": "两路视频错时斜分屏",
      "assetId": "media-split",
      "props": {"layout": "diagonal", "items": [
        {"id": "left", "label": "左侧场景", "origin": "ai", "role": "illustration", "media": null,
         "enterSeconds": 0, "generation": {"brief": "机械臂拿起零件", "prompt": "固定中景，现代装配车间，一只机械臂从输送带平稳拿起金属零件并放入托盘。画面左侧保留完整机械臂动作，柔和工业照明，写实纪录片风格，单镜头，无文字无拼贴。", "durationSeconds": 6, "aspectRatio": "16:9"}},
        {"id": "right", "label": "右侧场景", "origin": "ai", "role": "illustration", "media": null,
         "enterSeconds": 0.8, "generation": {"brief": "工人在另一工位检查零件", "prompt": "固定中景，现代装配车间，一名工人拾起金属零件，在检验灯下转动检查后放入托盘。动作集中在画面右侧，柔和工业照明，写实纪录片风格，单镜头，无文字无拼贴。", "durationSeconds": 6, "aspectRatio": "16:9"}}
      ]}
    }]
  }]
}
```

上例是协议示例，不是实际事件证明。`approval.status=approved` 只能在真实本期批准后填写。每个镜号的推荐版不重叠，多画面组成同一镜的 items，不制造重复口播区间。

- `route`: `animation | media`。每套方案状态 `planned | pending | ready | rendered` 分别表示设计、待文件、可编辑就绪、已有成片。`ready` 不代表已经渲染视频。
- 已选原生模板的动画方案提供真实 `assetId/assetVersion/props`；可在 `files` 放逐镜成片和预览的绝对路径。定制方案按实际支持的媒体接口接入，同时保留源码、合同与修改入口；没有原生对象编辑能力就明确边界，不能捏造模板身份或倒逼改为模板。
- 素材使用 `media-stack`、`media-split`，或单路 `source-pip`（`sourceMode=media`）。模板项含 `id/label/origin/media`；`origin=network|ai|user`。网络条目保留 `sourceUrl`、作者、日期及适配理由等元数据。
- 实际文件为 `media:{kind:"image"或"video",path:"绝对路径",startSeconds:0}`。工作流探测真实宽高和时长，不信任填写的尺寸。素材起点与 `enterSeconds`（镜头内入场时刻）分开。
- 网络条目只有直链时用 `downloadUrl` + `kind`，`media:null`；网页 URL 不能假装素材直链。截图由 Codex 实际浏览源页面、采集到本地后填 path。图库仍走现有 broll.py 多候选检索，不能将检索结果直接视为已交付文件。
- 模板组内 `exitSeconds:null` 代表随组结束；`transitionSeconds`、`crop`（归一化矩形）、`x/y`（画布百分比偏移）、`scale`、`rotation`、`entrance`（left/right/up/down）可逐项设置。组级 `gap/tilt/shadow` 调整疏密、倾斜幅度和阴影。不填写时由模板补默认值。
- 主视频可填 `source:{path:"本地主视频绝对路径",startFrame:0}`。只有音频时保持 `source:null`，真实时间轴仍来自该音频，画幅用明确目标比例；不能猜画幅或填假人像。

## 执行入口

4358 production-plan external_job 使用 projectId/projectSnapshotPath/projectPlanPath 明确当前工程；
本节旧 compose 命令仅供独立组装。工程计划任务只输出 composition/preset/实际媒体，交服务同一 CAS
提交层校验、填空槽或集中确认，不调用旧 compose 另建平行工程。单镜真实时长来自快照 targetRange，
不从旧 shots 秒点覆盖手调实例；media.startSeconds 始终是素材内部起点。原 package 不反写。
候选模式只交来源链接，由用户下载；--collect 只有明确批准直链下载的独立组装才用。
overlay 保持实际 Alpha MOV 与真实口播合成预览，不能由 composition 输出路径强制转成 MP4。

```bash
python3 tools/broll_composition.py validate --manifest <composition.json>
python3 tools/broll_composition.py prepare --manifest <composition.json> --output <交付目录> --collect
python3 tools/broll_composition.py compose --manifest <composition.json> --output <交付目录> --collect --serve --port 4325
```

`--collect` 只下载 manifest 明确列出的素材直链；语义检索、事实核验与推荐由当前 Codex 会话完成，不用关键词规则假装创作判断。下载或探测失败逐项保留问题并降为 pending，不丢候选、不冒报成功。网络和 AI 视频均检查实际原始短边至少 720px，优先 1080p；截图同样检查原图，另需在最终裁切尺寸目检可读性。

`compose` 在 visualization 目录运行 `node tools/editor-compose.mjs`，保存原生可编辑实例与本地媒体引用。返回 `editor-receipt.json`，包含工程地址、推荐/实际装入方案、待素材、受保护的手动修改。`--serve` 仅复用对应端口服务或新开本地服务，不终止已有进程、不重启浏览器。端口占用会报错而非杀进程。Codex 最后用浏览器打开回执 URL 验收并交付。

重复执行更新未手调的自动实例，不重复添加。已手调或手动删除的镜头保留并写入回执，不能报“全部更新成功”。变更画幅或源工程身份时新建项目 ID，避免覆盖用户工程。现有主轨在更新时保留。待 AI 生成时模板可预排并显示待素材，正式导出必须等素材齐全。

## 文档保留与替换

输出 `composition.prepared.json`、`交付与备选.md`、`options/<镜号>--<方案>.json`、下载素材目录及控制台回执。每条口播列出全部方案、实际文件/预览、来源、AI 简述与提示词、模板参数、就绪状态，标明默认推荐。两路都做过就两路都保留，时间轴只装推荐版。

用户可在控制台替换组内素材，保留同槽位的裁切/时间/位置。更换整套方案时，可依据 options 文件由 Codex 新建版本并替换该镜，或用户手动在同时间区间加入对应模板后移除旧实例。自动更新不覆盖该手调结果。

仍遵守本期 package 内容审批与 visualization 渲染/视觉验收；组装成功只证明工程已写入，不自动代表素材核验、逐镜视频或音画验收完成。external_job 的回执和交付文档写回其 outputRoot，控制台工程与素材缓存是 visualization 的本地可编辑镜像，须把工程路径和文件哈希登记在结果中，不伪造旧逐镜合同回执。

2026-10-09 模板增补：`media-stack` 数量1–9，控制台侧栏可直接改。`media-split` 需显式填写 `mode:"sequence"` 使用1–4段顺序（①全屏、②进入分屏、③替换①、④替换②）；`mode:"simultaneous"` 保持普通两路分屏。各项 `enterSeconds` 是组合内部时间，sequence首项必须0，后续入场帧严格递增，`exitSeconds:null` 由替换和组合结束控制。`motion/exitMotion` 可分别选 slide/fade/none/zoom/pop/flip/drop/wipe。视频源时间仍用 media.startSeconds，不能与画面入场混淆。

排列增补：`media-stack.layout` 支持 stack/spread/fan/staircase/alternating/deck，分别为桌面散放、平铺、扇形、阶梯、左右交错、中心叠牌。媒体按原图比例布局，支持9:16；每项 `motion/exitMotion` 可独立覆盖，省略继承组默认。`x/y/rotation/scale` 是单项微调，切换排列保留。斜切分屏使用 `layout:"diagonal"`、separatorAngle正/负决定方向、separatorPosition调整占比，与mode:"sequence"独立组合。

沉浸式堆叠增补：新建 `media-stack` 默认 `framing:"immersive"`，`stackFill:1.15`（0.7–2）。设计优先大图覆盖、错位重叠和动画，不要求完整显示每张边缘；保持素材比例，允许越界与遮挡。stack/fan/staircase/alternating/deck均适用，spread继续平铺。既有实例缺少framing时按旧版contained渲染，需要改为沉浸式时显式写入；`framing:"contained"`可保留完整收纳布局。单张x/y/scale/rotation和动效覆盖仍可调整；重要标题、人物或证据区域需在实际构图里目检，不能把保持原比例当作关键内容可见的保证。

主图可见性修正（2026-10-09）：沉浸式自动布局在保留图片比例的同时，使每张图片入场停稳后、下一张覆盖前至少80%的面积处于画布内（内部按84%留余量，计算旋转后的真实相交面积）。后入场的图片置于旧图之上；同时入场按列表层次。旧图被后续图片覆盖不受80%限制。入场过程仍可从画外滑入；逐项手动x/y/scale/rotation优先，可能打破该下限。安排入场时点时应留下可辨认的焦点停留，不能让每张刚落稳就被下一张遮住；本次演示间隔1.3秒、过渡0.45秒。

## 口播镜头参数

有真人主视频时按 content-broll 的镜头支线调用 visualization；组装清单 source.cameraPlan 传入已校验的 version=2 计划，source.path 保持原片。控制台可调整倍率、锚点、每次推拉的时间与速度；保存和导出复用同一计划。禁止对已烧推拉的视频重复附加 cameraPlan。

## 口播镜头效果块（2026-10-09）

交付编辑工程时，按“推近—保持—回程”将每组变化转成独立镜头效果块，放在口播镜头轨道。调用 `templates/remotion-base/src/editor/camera-clips.mjs` 的 `cameraClips(plan)` 与 `withCameraClips(plan, clips)`，将返回完整计划写入 source.cameraPlan。clipGroups 是可编辑块，events 是同源执行结果；不得分别手改两份数据。原生验证拒绝二者不一致。已迁移计划逐帧核对无变化。每块独立倍率、启用状态和进/停/出时长；预览、拖拽与导出均读取同一计划。切换模板保持块的起止范围，拖边按比例调整三阶段；复制只放空位，不覆盖相邻镜头。
