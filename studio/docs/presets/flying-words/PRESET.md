# flying-words · 关键词隧道

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 关键词隧道
role: 口播列举一串事项时的"量感"画面——不是让观众逐个读完,是让他感到"这么多事"
duration_seconds: [4, 8]
source: video-shotcraft 的 flying-words 移植(2026-08-21)
colors: 词色 = oklch(L 0.72–0.88, C 0.10–0.16, accentHue−34°…+58°) 按词序伪随机;光晕/锚点线 = P.accent;禁 hex
typography: words=h1(52–92 伪随机错开)、finale=hero(118 起缩至 56)
space: perspective 2475;z 行程 −3940 → +1800(必须过 0 才有"擦身");散布半径 185–555px,纵向 ×1.42
motion:
  - {phase: enter, seconds: 0, action: 无开场——切进来观众就已经在隧道里}
  - {phase: hold, seconds: elastic, action: 每词恒速一趟 3.0s,相位按词序均分错开, easing: linear}
  - {phase: exit, seconds: 2.1, action: 片尾倒数 2.1s 起 finale 相位——词 0.75s 退散}
  - {phase: exit, seconds: 1.15, action: finale 从 z=-2600 推到 0 定格, easing: CALM+spring}
  - {phase: exit, seconds: 0.4, action: 锚点细线生长后静止}
slots:
  words: 关键词列表(必填,6–24 个)
  finale: 收尾定格句,可省
spring_accents: 1  # 只有 finale 定格那 1.5% 过冲
```

## 用法

```json
{"id": "shot-004", "preset": {"id": "flying-words", "version": 1},
 "presetProps": {"durationSeconds": 6,
   "slots": {"words": ["剪辑","配色","字体","节奏","转场","卡点","运镜","蒙版","调色","音效","分镜","特效"],
             "finale": "全都交给模板"}}}
```

## 什么时候用它

口播说到「这些全都要管」「一堆琐碎的事」时。它表达的是**量**与**压迫感**,不是清单——要让观众读清每一条请用 `bullet-run`,那才是列点。两者的区别在观看行为:这一镜观众的眼睛是不动的,词自己冲过来。

`finale` 是这一镜的落点:隧道给完压迫感之后,用一句结论把它收掉。没有 finale 就只剩压迫感没有出口,除非下一镜马上接结论,否则别省。

## 坑

- **z 终点必须过 0**(组件里是 +1800)。停在 z<0 就成了"飞到脸前停住",擦身感全无——这是配方卡点名的第一条。
- **词元素全程挂在 DOM 里**,只改 `transform`/`opacity`,不按帧增删节点。按帧增删会让 Remotion 每帧重建子树,渲染慢且可能闪。
- **生命曲线中段不要压到 0.5**。配方卡原值 0.5 是因为 demo 里词是背景层、要给前景让位;本 preset 里词就是主角,压到 0.5 任何一张静帧都读作"画面太素"(实测墨量掉到下限附近)。现值中段 0.7、峰值后移到 u=0.3,让词在更近更大的位置保持满亮。
- **中文词宽约是英文两倍**。字号上限压到 92 且过 `fitFontSize` 兜底(620px 宽,缩至 24 硬失败);词填成四字以上时会明显变小,尽量用 2–3 字词。
- **光晕呼吸周期锁死 = 单词过镜周期(3.0s)**。改成别的值两条节奏会打拍,画面开始"喘"。
- 时长伸缩改的是**圈数不是速度**:4s 和 8s 里词的飞行速度完全一样,这是 preset「timing is frozen」在循环类镜头上的写法。
- 散布椭圆在 `drift>1` 后会把词甩出画外——那是设计,彼时词已接近全透明;但如果你把 `Z_NEAR` 调大,甩出去的时机会提前到词还亮着,画面边缘就会出现半截字。
