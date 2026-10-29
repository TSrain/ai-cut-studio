# screen-push · 截图推近

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 6
name: 截图推近
role: 口播提到某个网页/产品/曲线图时,把那张截图搬上屏并指着看。历史上手搓过四次
duration_seconds: [2.5, 10]
colors: 全部来自皮肤;窗口上下各一条 accent 半透明细线,来源角标压半透明 bg 底
typography: 眉题 label 档、说明句 h2 档自动缩字、来源角标 22px caption 档
layout: >
  截图窗口固定 1080×1020 于 y=380;眉题 220;说明句在窗口下方 88px;
  来源角标压在窗口右下内侧 34/46
motion:
  - {phase: enter, seconds: 0, action: 截图第 0 帧完整在场(硬切不淡入), easing: —}
  - {phase: move, seconds: 0%–78%, action: Ken Burns 焦点推移+缩放(push/pull/pan), easing: MOVE}
  - {phase: enter, seconds: 18%–42%, action: 说明句上浮淡入, easing: ENTER}
  - {phase: hold, seconds: elastic, action: 78% 起完全定格,静止读取}
slots:
  image: public/screens/ 下的文件名(必须本地,渲染期不许联网取图)
  imgW / imgH: 源图真实像素尺寸(控制台自动探测填入)
  focusX / focusY: 归一化焦点 0–1。**必须走网格法量,不许目测**
  eyebrow: 可选,顶部眉题
  caption: 可选,底部说明句,可折行
  credit: 可选但强烈建议,来源角标,全程压在画面上
variants:
  move: push 推近看细节 / pull 退开看全局 / pan 横扫读一条线 / static 不动 / graze 贴面低掠巡览
```

## graze 档(v6 新增)

来自 video-shotcraft `graze-face-tour` 的融合:相机**贴着页面低掠**,依次巡览 `focus → focus2 → focus3`(给几站走几站),每站短暂停留,末站收到最平的英雄机位定格。像在桌面上滑过一份文件,而不是盯着一张图推近。

```json
"variant": {"move": "graze", "mark": "underline"},
"slots": {"image": "sample-docs.png", "imgW": 1140, "imgH": 530,
          "focusX": 0.227, "focusY": 0.278,
          "focus2X": 0.5545, "focus2Y": 0.3868,
          "markX": 0.5545, "markY": 0.3868, "markW": 0.1717, "markH": 0.0638}
```

**四个站点坐标一律走 `ocr-locate`/网格法,不许目测**——2026-08-21 首版用目测坐标渲出来,末站落在一片空白上,红线画在了没有内容的地方。文字目标一条命令就能拿到精确框:

```bash
node tools/ocr-locate.mjs <图> "results far exceeding"   # 直接吐 markX/Y/W/H
```

三条实现约束:

- **倾角不要学"大倾角"字面开到 45°+**。贴面感来自「巨大平面 + 近 perspective(≈1000)」,不是来自角度;参考实现的 rx 只有 12–20°,角度一大文字就读不了。
- **站点钳制优先于对准**(与 KenBurns 的 clampEdges 同一取舍):焦点太靠图边时钳住相机而不是硬对窗心,否则平面边缘会飞进画面。`GRAZE_MARGIN` 是按 ry≤22°、scale 低谷 0.93 倒算的,别随手改小。
- **批注只在末站停留段画**,飞行途中画了也读不到;不给 mark 坐标时默认框自动挪到末站。

`push`/`pull`/`pan`/`static` 四档**逐帧不变**,历史项目原样重渲(对拍帧:`review/shotcraft-presets/screen-push/push-110-before.png` 与 `push-110-after.png`)。

## 用法

合同镜条目只写:

```json
{"id": "shot-006", "preset": {"id": "screen-push", "version": 1},
 "presetProps": {"durationSeconds": 4, "variant": {"move": "push"},
   "slots": {"image": "metr-curve.png", "imgW": 1600, "imgH": 900,
     "focusX": 0.72, "focusY": 0.38,
     "eyebrow": "实物佐证 · EVIDENCE",
     "caption": "这条线在这里拐了弯。",
     "credit": "METR · 2026"}}}
```

## 为什么静图 + 推镜就够,不用真录屏

口播插片只有 3–8 秒。观众要的是"哦,是这个东西" + "注意这一处",不是完整操作流程。
一张高清截图 + 一次缓慢推镜,信息到位、成本极低,而且**天然满足确定性条款**
(无网络、无外部进程、任意一帧可独立算出)。

真要演操作流程(光标移动、点击、滚动、面板展开),那是另一个模板(伪 UI 录屏),
不是把这个模板加开关。

## 踩过的坑(改这个模板前先读)

1. **焦点不许目测。** `focusX/focusY` 要跑 `node tools/locate.mjs` 的四步网格法量
   (`docs/locate-protocol.md`)。目测平均误差 6.5%,在推近末帧会明显偏出画;
   网格法 2.3%,而且末步 `mark` 会当场把偏移画出来给你看。
2. **末段必须定格。** `moveEnd` 卡在 78%。推镜到最后一帧还在动的话,观众读不完那处细节,
   而且和下一镜硬切时会"撞车"。
3. **来源角标全程可见。** 用了第三方网页/产品截图,署名要烧进画面,不是可选项。
   `assets.md` 记来源是一道,画面上写是第二道,两道都要。
4. **`imgW/imgH` 必须是源图真实像素。** KenBurns 用它把归一化焦点映射成像素坐标,
   填错推镜会偏。控制台会自动探测;手写合同用 `sips -g pixelWidth -g pixelHeight <图>`。
5. **图必须在 `public/screens/` 下。** 2026-08-12 发现 `KenBurns` 有个老 bug:
   src 只要含斜杠就被当成完整外部 URL,绕过 `staticFile()`,于是 public 子目录里的图
   渲染时 404 —— 而且报错只在浏览器控制台里,画面就是一片空底,极难查。已在组件里修掉。
