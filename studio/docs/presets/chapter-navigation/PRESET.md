# 章节导航卡

来源：`projects/2026-09-05-broll-SC-0030-D-navigation/build/src/Navigation.tsx`、`nav-state.ts` 与该项目 DELIVERY / out/keyframes。已查看 `shot-021-established.png`：局部冷灰半透明面板、固定灰显条目、当前章节高亮，总览标题淡变为当前章节。

普通 Studio composition：`PresetChapterNavigation`。编辑页资产：`chapter-navigation`。两处共用组件，没有复制成另一套视觉。

## 参数

- `slots.title`：总览标题；`slots.items`：1–8 条章节。
- `slots.activeIndex`：当前章节的零起索引；`slots.activateAt`：相对当前动画起点的高亮秒数。
- `variant.align`：left / right；`variant.bg`：transparent / scene。
- `tune.font/scale/x/y`：整体字体、缩放、位置；skin/accentHue/neutralHue 可选，未设置时保留来源冷灰色板。
- `elements.title/currentTitle/item-N/panel`：真实节点上的字体、字号、字重、行高、颜色、透明度与位置等样式。当前标题正文由当前列表条目派生。

默认 1920×1080，兼容 1080×1920。透明模式保留局部面板透明度，输出 ProRes 4444 MOV；scene 可输出 MP4。每次调用使用局部帧时钟，任意 seek 可还原同帧状态。灰显预告是来源效果的一部分。

状态为 draft，未把新增画幅适配冒充原项目的 verified 评级。长标题/极端字号需按实际画幅查看；最多 8 项并不意味着任何长文都能自动适配。
