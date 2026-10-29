# 人物背后可编辑强调层

在现有 Editor instance 上启用 `props.presenterLayer: "behind"`，保持文字、时间段、入退场和位置照常可编辑。原底片保持原来的 RGB，只用人物 PNG 的 Alpha 遮住文字，避免重绘人物造成肤色变化。原音频只由 SourcePip 播放一次；遮罩采用和底片相同的 cover、camera anchor/zoom 与剪辑 sourceFrameAt。

本地 macOS Vision 准备，禁止上传、无需转写：

```sh
node tools/presenter-foreground.mjs prepare --document project.json --source-start-frame 176 --frames 180
node tools/presenter-foreground.mjs attach --document project.json --instance emphasis --manifest <returned-manifest.json> --out prepared-project.json
node tools/presenter-foreground.mjs validate --document prepared-project.json
```

`--public-root` 可指定工程 public。源帧单位采用工程 fps，按 ffmpeg fps 采样，输出宽度不超过当前工程画布宽度、保持原显示比例。prepare 逐帧检查实际 best_effort PTS：要求零起点、逐帧等于 n/fps（仅允许 time_base 舍入），不以相同 avg/r 帧率标头当作 CFR 证明。当前限工程 fps 一致的 CFR、方形像素源；其他输入明确拒绝，不能猜测源帧对应。每次准备只覆盖指定源区段，manifest 绑定源 SHA256、path/publicPath、fps 和源帧覆盖。移动时间段到未准备区间、换底片、fps 修改、缺帧都会拒绝，不能静默省略前景。源 clips 重排/裁剪但仍位于覆盖区内可以复用；文字与源区段之间的时间关系依旧由实例时间段管理。manifest 在 instance.props.presenterForeground 中内联保存。

支持透明文字/动画，不能同时使用该实例整屏背景或重叠真人小窗。需要背景的效果使用普通沉浸式方案。完整导出前复验实际底片 SHA256 和全部 PNG 存在，native 优化明确回退 Remotion。单独动画/layer 导出缺少原背景会破坏此效果，因此明确拒绝。编辑器预览与导出共用组件，包的 behind 意图仅是提案，准备/attach 才是实现。

当前 Vision person 分割为顺序局部模型，无外部网络、渲染期间不做分割。PNG 序列确保任意 seek 的输出固定。头发、快速手势、运动模糊、前景与背景同色仍可能出现边缘闪烁/漏分；这些必须看连续合成，不能把技术通过宣称艺术验收。多个人会一起被保留，目前无主体选择。不自动替换现有工程或批准本期设计。

`attach` 必须显式输出新文档，禁止原地覆盖。活动工程由现有 productionPlan/editor 保存和 revision 校验流程接收准备结果，CLI 不是 canonical 工程同步的替代路径。服务端可以调用 `validatePresenterAssets(document,{publicRoot})` 后沿用现有保存 API；只有后端使用真实 source hash 检验后才能把前景视为可用。

准备先写独立 `.pending-<run>` 临时目录，全部 PNG 及 manifest 成功后原子发布到唯一资源目录；失败只清理本次临时目录，不接触之前有效资源，不能混用旧 manifest 和新半成品。

## 网页预览性能

prepare 同时从 PNG Alpha 生成 preview-mask-v1/0000.png 等灰度反向遮罩图集，单帧长边不超过 640，8×8 帧为一页。网页提前两秒预载当前与下一页，播放时仅移动 SVG 的取图窗口，不逐帧请求/解码 4K PNG，也不等待每帧遮罩来暂停播放器。相邻页提前挂载，当前页未载入时隐藏文字，防止文字突然穿过人物；缺失资源在预览显示明确错误。新准备自动生成图集；旧缓存可由 tools/lib/presenter-preview.mjs 的 preparePresenterPreview(directory, manifest) 补齐，不改工程或原 PNG。

完整导出仍逐帧使用原分辨率 PNG Alpha，并等待精确源帧就绪；预览图集不参与导出。播放性能验收需记录真实时间、缓冲次数和遮罩就绪状态，单张截图不能证明不卡顿。
