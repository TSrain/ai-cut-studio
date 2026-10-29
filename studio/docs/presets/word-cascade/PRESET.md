# word-cascade · 逐词飞入动字

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 逐词飞入动字
role: 悬念提问 / 章节开场 / 把「别人的声音」抬出口播;qa 模式=问题胶囊+答案散点
duration_seconds: [2.5, 14]
colors: aurora 底=oklch(0.975/0.012/hue) + 两团漂移光斑;字=深强调色(0.42/0.14/hue);全部随 skin.accentHue
typography: lines=hero(竖 60 / 横 78 起缩至 30,单句单行);kit 由皮肤定
spacing: 行光学居中于画面中部;换句锚点上下交替 ±3%H;qa 胶囊高=2.1 倍问题字号
motion:
  - {phase: enter, action: 逐词飞入——从最终位置斜上方(伪随机弧线)带 blur 10→0 入场,stagger 6f < 行程 8f 相相重叠,基线先偏 ±6px 再对齐;行随新词到达向左缓移保持光学居中, easing: ENTER,禁弹簧}
  - {phase: hold, action: 整行静止 ≥ 入场总时长 70%(字数加权分配);句间 8f 淡出,新句在稍偏锚点重组}
  - {phase: enter, action: qa:空胶囊先滑入→问题填入→胶囊上移让位→答案散点虚→实显影(blur 12→0 + 浮 18px,隔 22f;x 偏移不单调,散点≠楼梯)}
variants:
  mode: cascade 逐句(默认)/ qa 问题胶囊+散点答案
  bg: aurora 浅色光斑(默认)/ scene 皮肤底 / transparent 透明 alpha 层
slots:
  lines: 一行一句;句内空格分词(飞入按词);qa 模式第一行=问题其余=答案;单句 ≤8 词
```

## 用法

```json
{"id": "shot-001", "preset": {"id": "word-cascade", "version": 1},
 "presetProps": {"durationSeconds": 7, "canvas": "1920x1080",
   "variant": {"mode": "qa", "bg": "aurora"},
   "slots": {"lines": ["如果 一个人 英语 写得好?", "语法 扎实", "逻辑 清楚", "表达 流畅"]}}}
```

## 什么时候用 / 不用

- **用**:引用观众/别人的提问(动字=另一个声音);章节开场只有一句钩子;问题→2–4 个要点(qa)。
- **不用**:句子超过 8 个词(入场超 2 秒,观众开始等);一批里连用两次以上(它是换气手法);要点需要停留细读(bullet-run)。

## 设计取舍记录

- **来源**:蓝图 `docs/blueprints/kinetic-word-cascade.md`(高高lindsey VZ8qrng2nIo,参考帧
  lindsey-kinetic-midflight / lindsey-qa-scatter)。蓝图四条命门全部落地:
  ① 模糊在行程前 70% 归零(落定那刻必须是锐的);② stagger 6f < 行程 8f;
  ③ 无弹簧(基线「先偏后正」已承担活泼感);④ 行漂移由词的**线性到达进度**驱动,不是时间驱动。
- **中文分词**:空格是用户的分组权;没分组的纯 CJK 长串自动按 2 字切块(单字太碎,整句太钝)。
- **伪随机弧线**:`sin(li*127.1+wi*311.7)` 确定性散列——每个词的出发角略不同,但每次渲染一致。
- **qa 散点 x 偏移故意不单调**([-0.28,+0.18,-0.06,+0.30,-0.20]):一路递增读作楼梯=没对齐的列表。
- aurora 底色相跟 skin.accentHue:默认皮肤 abyss(hue 252)出蓝调;要 Lindsey 的淡紫把 accentHue 旋到 ~285。
