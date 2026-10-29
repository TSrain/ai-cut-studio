# number-beat · 数字强调

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 3
role: 一个数字承担整个节拍——全帧唯一被放大的元素就是它
duration_seconds: [2.5, 5]
colors: 皮肤令牌;数字滚动期 ink 色,落定瞬间 interpolateColors 变 accent
typography: 数字 hero 210(tabular-nums,滚动不抖宽;按最终文案缩字);label=body 44
motion:
  - {phase: enter, seconds: 0.64, action: celebrate=confetti 时纸屑抢拍爆出(见下)}
  - {phase: enter, seconds: 0.8, action: 数字 0→值滚动,前快后慢(cubic out)}
  - {phase: enter, seconds: 0.8, action: 落定变色+唯一弹簧名额 1.5% 过冲}
  - {phase: enter, seconds: 0.9, action: accent 底线扫入}
  - {phase: enter, seconds: 1.0, action: 说明句上浮}
  - {phase: hold, seconds: elastic}
slots: {value: 数值, prefix?: $/¥/×, suffix?: 万/%/倍, label: 一句说明, eyebrow?}
variants: {celebrate: none(默认) | confetti}
```

## celebrate 档(v3 新增)

`confetti` 来自 video-shotcraft 的 counter-confetti 融合:数字撞停那一拍,**52 片纸屑分两簇从数字两端爆出**,走重力弧线 + 自转,着地前淡出。

**什么时候开**:这个数字本身是好消息(增长、达标、里程碑)。`$2,000` 那种"十年只攒下这么点"的反讽数字开了就跑偏——纸屑是情绪注解,不是装饰。

三条实现约束(改的时候别破坏):

- **纸屑色相收在 `accentHue` 邻近带内**,不是原效果的五彩。一帧画面不该有二十个颜色(`docs/color.md`),原片那套彩虹纸屑放进本项目的皮肤体系里会立刻显得廉价。
- **不开第二个弹簧名额**:数字的 punch 共用原有的 `landSpring`,只是把过冲从 1.5% 提到约 4%。
- **纸屑运动窗口按 `durationSeconds` 压缩**,保证片内落完;短时长时初速与窗口同时收。

`celebrate` 缺省或 `'none'` 时**与 v2 逐帧一致**,历史项目原样重渲不受影响(对拍帧:`review/shotcraft-presets/number-beat/none-v2-f50.png` 与 `none-v3-f50.png`)。

## 硬规矩

- **全帧只放大这一个数字**;说明句里不许再出现同一个数字换个容器重复(信息去重)。
- **视觉与信息不重复**(taste.md C10):数字是视觉主角,label 说"它意味着什么",不复述"它是多少"。
- `facts.mode: "exact"` 的批次,value 的来源必须登记 assets.md;演示数字走 illustrative。

## 用法

```json
{"id": "shot-004", "preset": {"id": "number-beat", "version": 1},
 "presetProps": {"durationSeconds": 3, "slots": {
   "value": 2000, "prefix": "$", "label": "十年攒下的,不过是一部手机的钱。"}}}
```
