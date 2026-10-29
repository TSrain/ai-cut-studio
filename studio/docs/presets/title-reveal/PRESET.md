# title-reveal · 标题入场卡

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 标题入场卡
role: 章节开场/口播换段时,把一句标题体面地放到位(video-shotcraft 三卡合一)
duration_seconds: [2.5, 6]
colors: 全部来自皮肤;标题 P.ink / 副标题 P.inkSecondary / 马克笔与花括号 P.accent,零 hex
typography: title=hero(118 起缩至 64;brace 档给括号留 2.6em,单独缩至 56)/ subtitle=body(40);kit 由皮肤定
spacing: 三档同一坐标骨架——title 顶 y≈880 居中,subtitle 其下 +56,y1648 一条锚点短线,底部留白
motion:
  - {variant: blur,   phase: enter, seconds: 0.23, action: 逐词 y90→0+blur22→0+opacity 三通道共用同一个 p 同一条 outCubic;stagger 3.5f,词窗 0.67s}
  - {variant: blur,   phase: enter, seconds: ~0.9,  action: 副标题错峰跟进(标题末词进行到 45% 时起手);stagger 2.5f、dy 58}
  - {variant: marker, phase: enter, seconds: 0.00, action: 标题整块下方 36px 落定 0.73s;副标题 0.6s 上浮淡入}
  - {variant: marker, phase: enter, seconds: 1.07, action: 马克笔 10f 左→右扫过 accent(变宽笔形+毛糙边缘,水平微抖 ≤±0.2 笔宽)}
  - {variant: brace,  phase: enter, seconds: 0.23, action: 花括号硬切出现(紧贴、0.6 倍,不淡入)}
  - {variant: brace,  phase: enter, seconds: 0.50, action: outBack 弹开 24f 过冲 ~8%(唯一过冲名额)+放大 0.6→1,clip 严格绑括号间距;1.6s 后字距松弛}
  - {phase: hold, seconds: elastic, action: 静止读取(时长伸缩全部落在这里)}
slots:
  title: 主标题,必填,单行 shrink-to-fit(6–10 字最好;brace 档更挤)
  subtitle: 一行小字,可省
  accent: title 的子串;marker 划它 / brace 只括它 / blur 让它独立成段。不命中则 marker 不划、brace 括整行,不崩
```

## 用法

```json
{"id": "shot-001", "preset": {"id": "title-reveal", "version": 1},
 "presetProps": {"durationSeconds": 3.8, "variant": {"style": "blur"}, "slots": {
   "title": "把品味沉淀成组件", "subtitle": "每个新镜头,都站在上一个的肩膀上", "accent": "沉淀"}}}
```

## 三档怎么选

- **blur(默认)**:文字 reveal 的低能量默认解——没有奇观、没有机械感。一支片里已有别的重手法时,标题一律用它让位。
- **marker**:标题里要把一个词从排版里"拎出来"(手写感/人味)。命门是快(10f 一笔呵成)和近(贴字底)。
- **brace**:技术产品语境的极简一拍,`{}` 自带代码语感。命门是 clip 严格绑括号间距——文字自己淡入括号就退化成装饰。

## 什么时候用 / 不用

- **用**:片头/章节标题;口播换段的一拍定场;需要"专业但不抢戏"的标题入场。
- **不用**:标题本身是数据或概念定义(那是 key-concept / trend-chart 的活);一镜要同时强调两个词(strong emphasis ×2 = no emphasis);brace 档标题超过 ~7 个汉字(括号会把字挤到缩字下限)。

## 设计取舍记录

- 三个 shotcraft 横版 demo(480×270)合并重排为竖版:位移/模糊参数 ×2.25 换算(dy 40→90、blur 10→22),保持与逐帧验证版的视觉幅度一致;字号改走 fitFontSize 而不是定值。
- **blur 的中文拆词**:无空格中文按标点断、超长段 2–4 字切块(3 字优先避免孤字尾块),accent 命中时优先让它独立成段——配方卡的坑:`split(' ')` 在中文上得到一整块,逐字又太碎。
- **marker 的斜向**:原 demo 跟斜体字势左低右高;本卡标题是正体中文,按配方卡判例改为水平微抖,抖动 ≤±0.2 笔宽(用户旧反馈:直中带手感)。笔色从 #111 改为 P.accent(暗底皮肤上黑笔不可见)。
- **brace 的 accent 编排**是本卡新增:原 demo 只括整行;accent 存在时只括子串,pre/post 文字随弹开被推出(opacity=ex + 外推 24px),整行读作"被括号撑开"。括号与文字共用同一个 sc(分两条曲线会在过冲帧错位——配方卡判例)。
- 弹簧名额:0 个 spring() 调用;唯一过冲是 brace 档的 outBack(配方卡:过冲只此一次,再叠别的 back 缓动就贬值)。
- enter 各相位是绝对秒:2.5s 和 6s 的版本前 2.4s 完全一样,伸缩全部落在 hold——改这里等于改这张卡的性格,须 bump 版本。
- 底部 y1648 的锚点短线是竖版重排补的:三档内容都集中在中带,没有它下半场全空(墨量下限),它是退让级的锚点不是装饰。
