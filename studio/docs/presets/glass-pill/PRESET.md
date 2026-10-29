# glass-pill · 玻璃胶囊打字

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 玻璃胶囊打字
role: 语音/AI 输入框的登场;"跟它说话"的交互提示镜;高能段之间的一个安静过渡拍
duration_seconds: [1.5, 4]
colors: 全部来自皮肤;辉光色相从 skin.accentHue 走 oklch 派生(glowCore L0.78/C0.17),零 hex
typography: text=body(46 起缩至 30,单行)/ caption=label;kit 由皮肤定
spacing: 胶囊高 104、圆角 52,定宽=估宽+243(上限 888),中心 y900;caption y1560 居中
motion:
  - {phase: enter, seconds: 0.00, action: 胶囊弹入 scale 1.16→1 + blur 14→0 收敛 0.3s,唯一弹簧名额=一次轻过冲, easing: spring(damping 12)+ENTER}
  - {phase: enter, seconds: 0.20, action: 光标先行淡入 0.1s(输入框已就绪,早于第一个字)}
  - {phase: enter, seconds: 0.35, action: 逐字匀速打完 text(结束于 durationSeconds−0.6),辉光沿长轴游走(周期 3.2s), easing: linear}
  - {phase: enter, seconds: 0.55, action: caption 上浮淡入 0.4s}
  - {phase: hold, seconds: elastic, action: 静置 ≥0.5s:光标慢闪、辉光收到 55% 继续游走、图标呼吸 ±3.5%}
variants:
  icon: mic 听写(默认)/ search 搜索 / sparkle AI 生成 —— 内联 SVG,决定输入框语义
slots:
  text: 胶囊内打出的一句话,单行,十几个字最好(46px 起缩,30px 下限,超了硬失败)
  caption: 下方居中一行小字,可省
```

## 用法

```json
{"id": "shot-004", "preset": {"id": "glass-pill", "version": 1},
 "presetProps": {"durationSeconds": 2.5, "variant": {"icon": "mic"},
   "slots": {"text": "帮我把这段口播配上画面", "caption": "说一句话,画面自己长出来。"}}}
```

## 什么时候用 / 不用

- **用**:口播讲到"你只要说一句话/输入一个需求"的那一拍;AI 产品的输入交互登场;两个高能镜之间需要一个安静的休止符。
- **不用**:要展示真实产品 UI 的完整界面(那是 screen-push / 网页采集镜);一镜里想打两句话(输入条只有一条,第二句是另一镜)。

## 设计取舍记录

- **复刻来源** `src/shotcraft/GlassPillDictationTyping.tsx`(逐帧验证版)+ 配方卡
  `docs/catalog/recipes-external/interaction/glass-pill-dictation-typing.md`。三处刻意偏差:
  ① DOM 测宽(useLayoutEffect)换成 `style/fit.ts` 估宽——渲染期 DOM 测量首帧可能拿到兜底值,
  估宽确定且与展开器同口径;② 参考版光随打字**熄灭到底**,这版收到 55% 保住游走辉光——
  竖版画面只有这一条胶囊,光全灭墨量撑不住,也丢了"AI 待命"语义;③ 写死的紫
  (`ACCENT_RGB 146,126,212`)换成 skin.accentHue 派生,换皮肤/调旋钮光跟着走。
- **定宽是关键**(配方卡):胶囊宽 = 文本估宽 + 243px 富余,不随打字伸缩——随字伸缩会读作
  chip 而不是输入条。上限 888(两侧留 96px 呼吸),text 槽因此上限 640px 估宽。
- **打字必须匀速**:加 ease 读作"有人在犹豫"。速度按字数自适应:窗口 = 0.35s → durationSeconds−0.6s,
  静置恒 ≥0.5s;1.5s 短版对十几个字约 1.5 帧/字,仍逐字可辨。
- **图标呼吸 ±3.5% 封顶**:幅度再大就成了"正在录音"的活跃态,与"待命"矛盾(配方卡同款约束)。
- enter 各相位是绝对秒:1.5s 和 4s 的版本前 0.95s 完全一样,伸缩全部落在打字窗口和 hold——改这里等于改这张卡的性格,须 bump 版本。
