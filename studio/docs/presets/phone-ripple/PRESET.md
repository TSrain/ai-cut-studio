# phone-ripple · 波纹手机芯片

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 波纹手机芯片
role: 移动端产品的"这就是它"定格镜——三层极慢的动作叠起来,画面不静但也不吵
duration_seconds: [4, 8]
source: video-shotcraft 的 radial-ripple-phone-chips 移植(2026-08-21)
colors: 波纹/机壳/屏内骨架 = oklch(L, neutralChroma, P.hue)(只动明度不动色相);芯片 = 亮面 L0.96;禁 hex
typography: 芯片=label(40 缩至 24)、caption=h2(54 缩至 34)
geometry: 手机 560×1120(圆角 92,bezel 26),中心 (540,830);波纹 1560/1240/940/680;芯片锚 calc(50%±240)
motion:
  - {phase: enter, seconds: 0.00, action: 波纹与手机首帧已在;手机上浮 36px + scale 0.965→1, easing: CALM}
  - {phase: hold,  seconds: 0.08, action: 屏内匀速滚动(片长 8%→98%), easing: linear}
  - {phase: hold,  seconds: 1.00, action: 芯片每 0.5s 一个左右交替 pop(0.55s 过冲)→ 渐入悬浮, easing: outBack}
  - {phase: hold,  seconds: 1.70, action: caption 淡入上浮}
  - {phase: hold,  seconds: elastic, action: 三层慢动作持续(波纹 0.27Hz / 芯片 0.36Hz)}
slots:
  chips: 功能芯片(必填,2–5 个)
  screenshot + imgW/imgH: 屏内截图,可省(不给就滚骨架流)
  caption: 底部结论句,可省
spring_accents: 1  # 只有芯片 pop 的 outBack 过冲
```

## 用法

```json
{"id": "shot-007", "preset": {"id": "phone-ripple", "version": 1},
 "presetProps": {"durationSeconds": 5.6,
   "slots": {"chips": ["自动分镜","模板匹配","一键出片"],
             "caption": "三步,从口播稿到成片。"}}}
```

带真实截图:

```json
"slots": {"chips": ["自动分镜","模板匹配"], "screenshot": "app-home.png", "imgW": 1170, "imgH": 2532}
```

## 三层动作,一层都不能停

这一镜的全部功力在**三个各自极慢、频率互质的动作叠加**:

1. **波纹呼吸**(0.27Hz,相邻层错相 1.7rad)——氛围;
2. **屏内匀速滚**——证明"里面有内容在跑";
3. **芯片悬浮**(0.36Hz)——点出卖点名。

单看每一层都慢到几乎静止,叠起来画面就活了。去掉任何一层,剩下的两层立刻显得"卡住了"。

## 坑

- **波纹是实色圆叠放,不是描边环**,而且必须**由大到小**依次画(顺序反了只剩最大那层盖住一切)。相邻层错相是"水波"而非"整体缩放"的关键。
- **呼吸幅度 ±0.05 已经接近上限**,到 0.1 就读作"脉冲动画"了。频率按**绝对秒**定,所以 4s 版和 8s 版性格一致(不是"短片里波纹变快")。
- **屏内滚动必须匀速,不许加缓动**。加 ease 立刻读作"有人在滑",而这一镜要的是"自动播放"。
- **换真实截图时,内容总高必须大于滚动距离 + 屏高**,否则滚到底露白。组件已做双保险:`min(可滚上限, 1.15 屏高)`——长图也不会滚成快进。
- **芯片锚在 `calc(50% ± 240px)`**,即贴着手机 bezel。**改 `PHONE.w` 必须同步改 `CHIP_ANCHOR`**,否则芯片压到屏上(配方卡已知坑 #1)。
- **芯片 pop 用 outBack 的过冲**,那是"弹出"的全部质感,换成 outCubic 就平了。左右先后错开 0.5s 才有"一个一个说"的节奏;悬浮是 pop 完之后**渐渐介入**的,不是一落位就开始飘。
- **芯片是亮面(近白)**——暗皮肤下它就是画面里的高光点,和亮屏一个材质家族。这是原片"白 chip"的正确移植,**不要改成暗底芯片**。
- **手机的落地投影不许去掉**:它是"手机浮在波上"的唯一依据,没有它整个画面会塌成贴纸。
- `tune` 的 x/y 平移"波纹+手机+芯片"整组(用于避开口播人像),caption 锚在底部安全区不跟着走。
