# card-showcase · 卡片列阵

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 卡片列阵
role: 把一组并列项拍成有体积的卡阵——不是列表,是"这一副牌"
duration_seconds: [4, 8]
source: video-shotcraft 的 card-stack(fan) + carousel-3d(carousel) 合并移植(2026-08-21)
colors: 卡色 = oklch 同明度同彩度、色相 accentHue±16°/张(邻近色相环,永远一家人);禁 hex
typography: 卡标题=h2(carousel 42 / fan 36,缩至 24)、小注=caption 19、caption=h2(56 缩至 36)
geometry: 卡 250×340;carousel 半径 340–440(弦距 ≈1.35 卡宽);fan 展开横移按卡数+旋转甩幅反推
motion:
  # carousel(默认)
  - {phase: enter, seconds: 0.00, action: 卡片 0.04s/张 stagger 缩放浮现(0.5s/张), easing: ENTER}
  - {phase: hold,  seconds: 3.60, action: 圆环自转恰好 360°,背面卡按方位角压暗, easing: MOVE}
  - {phase: hold,  seconds: 3.00, action: caption 淡入}
  # fan
  - {phase: enter, seconds: 0.05, action: 每 0.13s 一张从下方 deal 弹入(0.55s/张), easing: spring(0.3)}
  - {phase: hold,  seconds: 1.70, action: 整摞展开成 3D 扇形(绕 50% 130% 的"手腕"), easing: MOVE}
  - {phase: hold,  seconds: 2.40, action: caption 淡入}
  - {phase: hold,  seconds: elastic, action: 定格静止}
slots:
  cards: 卡片列表(必填,4–8 张),每条 `标题 | 小注`
  caption: 底部结论句,可省
variants:
  mode: carousel(默认) | fan
spring_accents: 1  # 只有 fan 的 deal 落位
```

## 用法

```json
{"id": "shot-006", "preset": {"id": "card-showcase", "version": 1},
 "presetProps": {"durationSeconds": 6,
   "variant": {"mode": "carousel"},
   "slots": {"cards": ["关键概念","数字节拍","对比卡","引用卡","趋势图","列点推进","流程推进"],
             "caption": "一句话一个画面,\n七种画面都有模板。"}}}
```

## 两档怎么选(**这一条决定文案怎么写**)

| | carousel(默认) | fan |
|---|---|---|
| 语义 | 逐个亮相——每张都会转到正面 | 一摞的量感——中心卡是主角 |
| 观众能读到 | **每张卡的完整标题** | 中心卡完整;翼侧卡只露一条 |
| 卡数甜点 | 5–8 | **4–5** |
| 标题长度 | 不限(198px 内自动缩字) | 4–5 张时 4 字整字可读;6 张以上压到 3 字 |
| 弹簧 | 0 | 1(deal 落位) |

**实测(2026-08-21 自查帧)**:fan 档 5 张卡时「关键概念」「数字节拍」四字标题全部完整;7 张时翼侧只露得下两三个字。这不是参数没调好,是 936px 安全区除以 7 条的物理极限——**要每张都读全就用 carousel**。

## 坑

- **carousel 防镜像**是配方卡点名的第一条:每张卡挂**正反两层同向贴图** + `backface-visibility: hidden`,环转到背面时看到的是 back 层的正读文字。卡只绕 Y 公转,**永不绕 X/Z**;相机全程固定(浅俯角),所有运动来自环的自转。任何"让卡自己转一下更好看"的改动都会立刻出现镜像字。
- **carousel 的半径不能小于 1.5 倍卡宽**,否则背面卡会从正面卡的缝里挤出来。组件按 `弦距 ≈ 1.35 × 卡宽` 反推并夹在 340–440 之间。
- **carousel 必须转整圈**(360°,不是 355° 也不是 370°):末帧要与排布起点重合、0 号卡正对镜头,否则定格帧是个歪的中间态。
- **fan 的展开起点必须晚于末张 deal 落定**(8 张时 1.51s,组件里设 1.7s)。早了就是配方卡警告的"还在飞就开始转",一团乱。
- **fan 的旋转轴在卡片下缘之外**(`transform-origin: 50% 130%`)——扇柄在手里,卡绕手腕转开。改成 `50% 50%` 会退化成风车。
- **fan 的展开横移不能写定值**。旋转绕腕会把外侧卡再向外甩 `0.8·卡高·sinθ`(7 张时 27° → 123px):横移给小了标题被邻卡压住,给大了外侧卡被画框切。组件里按卡数 + 甩幅 + 旋转后包围宽反推,别改成常数。
- **牌堆微乱是确定性的**(`rand(卡序号)`),而且展开时收干净——齐整段要能看出"是一摞"(下层卡露角),终态扇形则是纯几何。
- fan 档翼侧卡的文字**贴各自露出的那一侧**(左翼左对齐、右翼右对齐),这样露出来的那条里才是标题的开头/结尾而不是中间。
- `tune` 的 x/y/scale 只挪卡阵,caption 有独立版位不跟着动——挪卡阵是为了避开口播人像,底部结论句不该跟着跑。
