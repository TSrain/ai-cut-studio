# brand-open · 品牌开场卡

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 品牌开场卡
role: 片头/栏目开场的固定画面——让字标以两种语义之一"出场",然后静止
duration_seconds: [2.5, 5]
source: video-shotcraft 的 letterspace-materialize + brand-ink-open 合并移植(2026-08-21)
colors: 全部来自皮肤;地平线光带 = oklch(0.68, 0.12, accentHue+28),十字/glint/光标 = P.accent,禁直接写 hex
typography: wordmark=hero(letterspace 160 起缩至 54 / ink 150 起缩至 60)、tagline=label(34)或 mono(30)
spacing: 内容宽 936(pad 72);整组视觉居中上移 60px(竖版几何居中永远看着偏低)
motion:
  # letterspace 档
  - {phase: enter, seconds: 0.30, action: 全字符并行显形 1.33s(软掩膜自底向上 + blur 9→0), easing: easeInOut}
  - {phase: enter, seconds: 1.63, action: 结晶提亮回落 0.27s(全字符同帧)}
  - {phase: enter, seconds: 1.70, action: tagline 上浮淡入 0.4s, easing: ENTER}
  # ink 档
  - {phase: enter, seconds: 0.00, action: 十字竖线画出 0.3s, easing: bezier(0.3,0,0.2,1)}
  - {phase: enter, seconds: 0.27, action: 十字横线画出 0.33s, easing: linear}
  - {phase: enter, seconds: 0.33, action: wordmark 逐字戳印(单字 0.4s,步长自适应,总窗口 ≤0.9s), easing: bezier(0.2,0.7,0.25,1)}
  - {phase: enter, seconds: 0.80, action: 十字淡出 0.33s}
  - {phase: enter, seconds: 0.93, action: tagline 打字机 0.7f/字符 + 方块光标}
  - {phase: hold,  seconds: elastic, action: 静置(硬底线 0.8s)}
  - {phase: exit,  seconds: 0.30, action: 仅 ink 且时长 ≥4.5s:上浮缩小溶出, easing: EXIT}
slots:
  wordmark: 字标(必填)。letterspace 自动转大写、按空格拆行竖排
  tagline: 副标语,可省
variants:
  style: letterspace(默认) | ink
spring_accents: 0
```

## 用法

```json
{"id": "shot-001", "preset": {"id": "brand-open", "version": 1},
 "presetProps": {"durationSeconds": 3.5,
   "variant": {"style": "letterspace"},
   "slots": {"wordmark": "MOTION STUDIO", "tagline": "AI 驱动的动画工作台"}}}
```

## 两档怎么选

不是深浅档,是**两种品牌调性**,选错等于换了个品牌:

| | letterspace | ink |
|---|---|---|
| 语义 | 整体显形,一次成型 | 先定位、后落字,有工序感 |
| 气质 | 仪式感、克制、电影片头 | 考据感、编辑部、栏目/系列开场 |
| 字标适配 | 拉丁大写最佳(自动转大写);多词拆行竖排 | 中西文都行,单行 |
| 配套 | 地平线光带氛围底景 | 强调色十字准星 + 字底 glint |
| 退场 | 无(静止到末帧) | 时长 ≥4.5s 时上浮缩小溶出 |

## 坑

- **letterspace 的两条命门**(配方卡原文):①**连续**——掩膜是连续生长的软边,任何中间帧都像"显影到一半",不许分段跳变;②**同步**——全字符同帧起、同帧收,逐字错峰是打字机语义(那是 ink 档的事),混进来仪式感立刻散掉。
- **字标估宽不走 `fit.ts`**。`fitFontSize` 的拉丁系数 0.52 是混排正文均值,而品牌字标几乎全大写(Inter caps 实测 ≈0.64em/字),用 0.52 量会放大约 25%,两档首渲都溢出安全区(2026-08-20 自查帧实锤)。组件内自带 `brandCharEm`(大写 0.68 / 数字 0.62 / CJK 1.0 / 小写 0.56,含安全余量),改字号或字距时改那里。
- **ink 的逐字步长必须自适应**。固定步长遇到长字标会把戳印挤出时长窗口(末字还没落定就该静置了),组件里按 `min(0.1s, 0.9s/(字数-1))` 压缩,总错峰窗口封顶 0.9s。
- **十字画完必须撤**。残留准星会和字标抢焦点——这是复刻源码里就写死的编排,不要因为"觉得好看"留着。
- letterspace 的字距由 flex `gap` 承担,组件里显式把 `letterSpacing` 归零盖掉 hero 角色自带的 -0.03em;tagline 的 0.3em 字距会吃掉一个尾空,靠 `paddingLeft: 0.3em` 补回视觉居中。
- 中文字标在 letterspace 档字距档位自动切到 0.35em(拉丁 0.6em)——中文方块字用拉丁字距会散架。
- 弹簧名额 0:这一镜的仪式感来自匀速与静止,任何过冲都会让它变"活泼"。
