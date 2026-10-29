# aspect-embed · 尺寸镶嵌

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 尺寸镶嵌
role: 异画幅素材进片——16:9 里嵌 9:16(或任意互嵌),视频装卡片、旁边配文字,不显脱节
duration_seconds: [3, 20]
colors: 全部来自皮肤;卡片描边 alpha(P.ink,0.14),落影随 mode 深浅
typography: title=hero(横 84 / 竖 72 起缩至 34,≤3 行逐行 fit 取最小)/ sub=caption(32);kit 由皮肤定
spacing: 横画布=卡片内接(0.46W×0.84H)盒靠 side 侧、文字对侧垂直居中;竖画布=卡片+文字整组垂直居中(防下半屏空掉);卡片圆角 28
motion:
  - {phase: enter, seconds: 0.00, action: 皮肤底第 0 帧已在;视频卡片上浮 40px 落定 0.5s, easing: CALM}
  - {phase: enter, seconds: 0.30, action: 眉题小条先到,标题按 textFx 进(rise 逐行上浮 / cascade 逐词飞入 / typewriter 匀速打字机)}
  - {phase: hold, seconds: elastic, action: 文字静止,视频继续播(srcDur 短于镜头时 Loop 无缝循环);容器绝对不动}
variants:
  ratio: auto 从素材推(默认)/ 9:16 / 1:1 / 4:5 / 16:9
  side: 横画布卡片靠 left(默认)/ right
  textFx: rise(默认)/ cascade / typewriter
  sound: off 静音(默认)/ keep 保留原声
slots:
  clip: build/public/footage/ 的本地视频文件名(video 槽首用;控制台装载自动填 srcW/srcH/srcDur)
  title: 大标题,回车折行 ≤3 行
  sub: 眉题小字,可省
```

## 用法

```json
{"id": "shot-005", "preset": {"id": "aspect-embed", "version": 1},
 "presetProps": {"durationSeconds": 6, "canvas": "1920x1080",
   "variant": {"ratio": "9:16", "side": "left", "textFx": "rise"},
   "slots": {"clip": "app-record.mp4", "srcW": 1080, "srcH": 1920, "srcDur": 8,
     "title": "手机上的操作\n三步走完", "sub": "实录 · 未加速"}}}
```

## 什么时候用 / 不用

- **用**:手机录屏/竖屏实拍要进横片(或反过来);素材本身画质普通,用卡片+底策展它;素材旁边需要一句话立论。
- **不用**:素材要占满全屏沉浸播放(直接 normalize 进拼接,不用嵌);要对素材内容做标注圈点(screen-push 的活)。

## 设计取舍记录

- **来源**:高高lindsey 拉片时用户笔记点名「16:9 画面中配 9:16 的画面旁边配合文字也不会显得脱节,各类尺寸的镶嵌都可以」。原片里没抓到对应帧(该截图疑似来自另一支视频),按用户描述的规格实现。
- **卡片纪律**与 white-sweep 蓝图同源:圆角+细描边+大落影,四周留出的底就是「被展示的素材」的语义;直接铺满等于硬切。
- **video 槽位类型首用**:`SLOT_TYPES` 加了 `video`,assetDir=footage;srcW/srcH/srcDur 走 derivedFrom 由控制台 ffprobe 自动填——让人手输素材时长是必错的坑。
- **竖画布整组垂直居中**:卡片钉 9% 的话 16:9 矮卡片会让下半屏空 40%,空画面能过掉其余所有检查(check-density 的教训)。
- **Loop 依赖 srcDur**:比镜头短的素材无缝循环;不填 srcDur 且素材偏短会渲到末尾定格——所以控制台装载时必须探测,手动写合同也别省这三个数。
