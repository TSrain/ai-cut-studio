# segmented-thumb · 分段开关特写

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 分段开关特写
role: 口播讲「二选一/模式切换」时的固定画面——把 segmented control 放大拍特写,滑块那次位移本身就是叙事
duration_seconds: [2.5, 5]
colors: 全部来自皮肤;槽底=surfaceRaised+line 描边,滑块=P.ink(暗皮肤下亮面胶囊,亮皮肤自然反转),活性标签=P.bg,涟漪与强调点=P.accent(唯一强调色,面积极小)
typography: leftLabel/rightLabel=h1(60 起缩至 32)/ caption=body;kit 由皮肤定;不做字重交换(minimal weightCap 500,手写粗体会触发合成字体)
spacing: 控件 880×184 居中于 (540,860),滑块内缩 14;caption y1560 居中
motion:
  - {phase: enter, seconds: 0.00, action: 底第 0 帧已在;控件自下 180px 浮入 0.6s, easing: CALM}
  - {phase: enter, seconds: 0.67, action: 描边箭头光标从目标侧画外滑入 0.8s, easing: Easing.out(cubic)}
  - {phase: enter, seconds: 1.60, action: 按下(光标 1→0.86→1)+ 控件 press 0.985 + 涟漪 12f 锁点击点}
  - {phase: enter, seconds: 1.73, action: 滑块弹簧滑向目标段(唯一弹簧名额,过冲限幅 10px);标签主次交换+强调点同弹簧驱动, easing: spring(13/210/0.7)}
  - {phase: enter, seconds: 2.00, action: caption 底部上浮淡入 0.4s}
  - {phase: hold, seconds: elastic, action: 新态静置(默认 3.7s 下 ≈1.3s)}
variants:
  land: right(默认,左→右)/ left(镜像)
slots:
  leftLabel: 左段标签,2–4 个中文字最稳(60px 起缩至 32)
  rightLabel: 右段标签,同上
  caption: 底部一句注脚,可省
```

## 用法

```json
{"id": "shot-004", "preset": {"id": "segmented-thumb", "version": 1},
 "presetProps": {"durationSeconds": 3.7, "variant": {"land": "right"},
   "slots": {"leftLabel": "手搓", "rightLabel": "模板", "caption": "同一个镜头,两种成本。"}}}
```

## 什么时候用 / 不用

- **用**:口播宣告「从 A 换到 B」「两种做法选后者」的节拍;一个 UI 微交互撑一整镜的特写拍法(Ask→Computer、Chat→Agent 式)。
- **不用**:三个以上选项(滑块跨多段 8f 读不出停靠,拉长又破手感——本卡只吃二选一);光标在完整页面里点击(那是 screen-push / cursor-performance 的地盘,同一次点击别既拍页面版又拍特写版);两段文字长到要折行(标签是按钮不是句子,长文案走 contrast-pair)。

## 设计取舍记录

- **因果链四拍缺一不可**(配方卡):光标滑入(有人来了)→ 按下+涟漪(做了决定)→ 滑块滑动(世界响应)→ 标签交换+强调点(新身份确立)。缺光标=UI 自己在动;缺涟漪=光标只是路过;缺强调点=切换没有奖励。
- demo 的 8f Easing.out 滑块改成弹簧(damping 13/stiffness 210/mass 0.7):preset 体系里滑块就是这一镜的唯一弹簧名额,快速到位+一次轻微回弹比纯 ease-out 更有「落位」感。过冲限幅 10px——弹簧原始过冲会把贴边的滑块顶出轨道,限幅后读作「撞到边界弹了一下」。
- 标签主次交换、目标段强调点弹出、起始段强调点塌缩,全部由同一根弹簧的值驱动——一个名额,多处消费,不额外开弹簧。
- demo 的功能图标(笑脸 laptop)换成强调色圆点:preset 槽位不收图标,点是「奖励感」的令牌化替身;收起时 width 与 scale 同步归零让文字回流(只 scale 会留幽灵缝,配方卡坑位)。
- 不做字重交换:minimal 皮肤 weightCap 500,绕过 textStyle 手写 fontWeight 700 会让浏览器横向拉胖伪造粗体(fonts.ts 明令禁止)。主次交换由颜色 crossfade(interpolateColors)+ 尺寸 0.97↔1.03 + 强调点承担。
- 滑块用 P.ink 而不是写死白色:暗皮肤下它就是 iOS 那颗白 thumb,paper 亮皮肤下自然反转成深色胶囊,两个方向都成立。
- 涟漪圆心锁点击点(光标笔尖),zIndex 压滑块之上——跟着滑块走就成了拖尾,语义变错(配方卡坑位)。
- 2026-10-10 用户要求修复硬切退场：默认与长版本保留原入场节拍；最短版本压缩交互时间，caption 完成后留至少 0.25s 静置，最后约 0.35s 下移回收并溶出。此次兼容性修复保留槽位、版本标识和总时长，避免旧合同失效。统一退场见 `docs/preset-exit.md`。
