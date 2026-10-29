# doc-typewriter · 文档自书写

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 文档自书写
role: 文档/报告/笔记类功能镜头——「文档是真的」是这一镜的全部说服力,观众会读清每个字
duration_seconds: [3.5, 8]
colors: 零 hex;纸面/墨色由 oklch(L, skin.neutralChroma·k, P.hue) 派生,caret/@底纹用 P.accent。
  纸就是纸——暗皮肤下卡面仍是浅色,P.mode 只影响纸的白度与投影深浅
typography: docTitle=quote(衬线,58 起缩至 34)/ meta·正文·列点=body / ##小标·@成员=h2 / kicker=等宽 mono;kit 由皮肤定
spacing: 文档卡宽 888(左右留 96),内 pad 64,圆角 26,占画面中带;历史带在卡下方 36px;kicker 屏幕空间 top 148
motion:
  - {phase: enter, seconds: 0.00, action: 纸卡第 0 帧已在(首帧不黑);相机从 docTitle 特写 zoom 1.25 一条 bezier 拉到整卡(66f), easing: bezier(0.33,0,0.15,1)}
  - {phase: enter, seconds: 0.20, action: kicker 等宽小字顶部盖章戳入 8f;首对内容块开始写出}
  - {phase: enter, seconds: 0.20, action: 内容块两两一组写出——纸色遮罩右锚左→右擦开 8f,强调色 caret 骑在书写前沿(永远只有一个笔尖)、写完 2f 熄灭;@成员擦出后 4f 底纹从左长出 8f, easing: bezier(0.4,0,0.6,1)}
  - {phase: enter, seconds: 1.73, action: history=show 时 4 条骨架历史条目从上方逐条落进卡下历史带,间隔 5f、9f 落地,落地 1.15 过冲+空中投影, easing: bezier(0.2,1.15,0.3,1)}
  - {phase: hold, seconds: elastic, action: 整卡定格静止读取(时长伸缩全部落在这里)}
slots:
  docTitle: 文档标题,一行,衬线感,相机开场焦点
  meta: 标题下弱字元信息,可省
  lines: 3–10 行。行语法:`## `=小标题 / `- `=列点 / `@`开头=成员名(带强调色底纹)/ 其余=正文。每行单行不折行,超宽自动缩字、缩到下限仍装不下=硬失败
  kicker: 顶部等宽大写戳记,可省
variant:
  history: show(默认)=卡下历史带 4 条骨架条目逐条落入 / none=只有文档卡
```

## 用法

```json
{"id": "shot-004", "preset": {"id": "doc-typewriter", "version": 1},
 "presetProps": {"durationSeconds": 5, "variant": {"history": "show"}, "slots": {
   "docTitle": "2026-W34 · 产品周报",
   "meta": "8 月 20 日 · 自动汇总 · 12 位成员",
   "lines": ["## 本周摘要", "发布节奏恢复正常,两条主线按期合入。",
             "@陈默", "- 渲染队列重构,峰值内存降 38%",
             "@林晚", "- 模板预览墙上线,滚动即播零等待"],
   "kicker": "WEEKLY BRIEF"}}}
```

## 什么时候用 / 不用

- **用**:口播讲到"自动生成的文档/周报/纪要/清单"这类产出物;需要观众相信"这份文档是真的、正在被产出"。信息密度最高的一拍,节奏放稳让观众读字。
- **用 history=none**:上下文里没有"持续产出/往期"语义,或镜头时长贴近 3.5s 下限想给正文更多静止时间。
- **不用**:要展示真实产品页面的像素级还原(那是截图镜,走 screen-push / 网页采集);一镜只想强调一句话或一个数(key-concept / number-beat 更便宜);行内容需要折行长段落(本卡每行单行,长文案会被缩字)。

## 设计取舍记录

- **竖版重排**:原片(横版 1920×1080)历史条目落进左侧栏;1080×1920 没有侧栏空间,重排为**文档卡下方一条横向历史带**,条目仍从上方逐条落下——这是布局重排,不是删动效词汇(配方卡 Q10:砍侧栏=砍"完整产品"的说服力,历史带保住了这层时间纵深)。
- **历史条目是骨架小卡**(折角纸图标+两条灰度条,无文字):slots 里没有往期内容槽,伪造日期/标题违反事实正确;骨架卡读作"之前还有几期",正好够用。
- **caret 纪律**:永远只有一个"笔尖"(配方卡原话:多 caret 同屏立刻穿帮);列点的遮罩向左多盖 30px,不然圆点提前穿帮。
- **@底纹晚于写入 4f**:同帧出现读作贴图,晚 4f 才读作"重点被标出"(配方卡)。
- **节奏伸缩**:两两一组 step 3.5f 起,行数多/时长短时压缩到最小 2f;"块数×节拍先对预算"是这张卡的核心算术。3.5s 与 8s 的版本前段性格一致,伸缩全落在末段静止。
- **相机一条 bezier**:zoom 1.25→1.0 66f 拉完,不做微呼吸——竖版卡面占比大,呼吸在窄画幅里读作晃。
