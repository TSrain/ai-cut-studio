# quote-card · 引用卡

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
role: 引用原话上屏(推文/访谈/书/论文)——证据感来自"原句逐字",不是来自装饰
duration_seconds: [3, 6]
colors: 皮肤令牌;卡片几何冻结(微旋 -1.6°/圆角 26/1.5px 描边/大引号水印)
typography: quote=body 41px 行高 1.58(不缩字,装不下减行);source=caption;note=label
motion:
  - {phase: enter, seconds: 0.5, action: 卡上浮 28px+淡入(首帧 30% 在场)}
  - {phase: enter, seconds: 0.33, action: 引文逐行 stagger 0.12s}
  - {phase: enter, seconds: 1.0, action: 作者小字条左滑入}
  - {phase: hold, seconds: elastic}
slots: {quote: 原句(\n 断行,≤5 行), source: 来源行, note: 作者换算小字条, noteTag: 胶囊标签}
variants: {tone: warm|cool——cool 用于信任/官方语境,只换色温不换几何}
```

## 硬规矩

- **原句逐字一致**:不改写、不翻译、不省略号截断;英文就上英文。
- **层级**:官方原句 > 来源 > 作者换算。作者的推断永远走 note 槽,不许混进 quote。
- 卡片高度随内容走(不写死 minHeight——v1 教训:空卡下半截非常显眼)。

## 用法

```json
{"id": "shot-001", "preset": {"id": "quote-card", "version": 1},
 "presetProps": {"durationSeconds": 4, "variant": {"tone": "cool"}, "slots": {
   "quote": "Most people overestimate what they\ncan do in one year.",
   "source": "Bill Gates · The Road Ahead · 1996",
   "note": "十年维度的复利,一年看不出来", "noteTag": "作者引述"}}}
```
