# cube-nav · 立方体导航

> principle: atoms are sacred · slots are the only freedom · timing is frozen

```yaml
version: 1
name: 立方体导航
role: 把一个系统的几个部分拍成同一个立方体的几个面——强调"它们是一个整体的不同面"
duration_seconds: [4, 8]
source: video-shotcraft 的 cube-navigation 移植(2026-08-21)
colors: 面色 = oklch(0.36/0.23, C, accentHue+{0,±28,±56,+84}°);素面退到 P.surface;禁 hex
typography: 面标题=label(56 缩至 30)、caption=body(44 缩至 32)
geometry: 棱长 560、perspective 2240(persp/S≈4)、中心 (540,800);特写 d=+690 / 等轴 d=-380
motion:
  - {phase: enter, seconds: 0.00, action: 第 1 面正视特写,首帧即在}
  - {phase: hold,  seconds: 0.55, action: 转面(中段 sin(π·u) 拉远到等轴距离 + -24° 俯角), easing: MOVE}
  - {phase: hold,  seconds: 0.45, action: 每面停留读面}
  - {phase: hold,  seconds: 0.60, action: 拉出到等轴测全景定格;顶/底面标题同步淡出, easing: MOVE}
  - {phase: hold,  seconds: elastic, action: 全景静止(英雄帧)}
slots:
  faces: 面标题列表(必填,3–6 个)
  caption: 底部结论句,可省
spring_accents: 0
```

## 用法

```json
{"id": "shot-002", "preset": {"id": "cube-nav", "version": 1},
 "presetProps": {"durationSeconds": 6.5,
   "slots": {"faces": ["总览","数据","时间线","素材","设置"], "caption": "一个工作台,五个面。"}}}
```

## 什么时候用它

口播说「这个系统有这么几块」「同一个东西的不同视角」时。它和 `card-showcase` 的区别在**语义**:卡片是并列的独立项,立方体的面是**同一个物体**的几个面——用错了观众会误读关系。面之间没有整体感(比如三个不同产品)就别用它。

3–6 个面:前 4 个贴侧环、第 5 个贴顶面、第 6 个贴底面。不足 6 个时剩余面自动退成中性素面,只有骨架条,不抢戏。

## 坑

- **面上文字任何时刻不许镜像正对观众**,组件里是双保险:每面 `backfaceVisibility: hidden` 剔除背面 + 法线明暗把背离面沉下去。
- **顶/底面在等轴测定格里字必然是倒的**——这不是 bug 是几何:同一块面要在「特写正视」和「俯视全景」两个姿态里都正立,数学上差 180° 面内旋转,办不到。特写是观众真正读面标题的时刻,必须保它正立;所以末段拉出时把顶/底面的标题与角标淡掉,只留方向中性的骨架条(2026-08-21 定格帧实锤)。**不要"顺手"把这个淡出删掉**。
- **顶/底面的正视姿态 ry 必须是 -360**(不是 0 也不是 -180):只有 `ry ≡ 0 (mod 360)` 时净变换 `Rx(∓90)·Ry(-360)·Rx(±90) = I`,面上文字才正立。改这两个停点的 ry 会让特写里的字歪掉或倒过来。
- **相机动的是 rig,不是每个面**。变换顺序固定为 `translateZ → rotateX → rotateY`,法线明暗公式 `z2 = ny·sin rx + (-nx·sin ry + nz·cos ry)·cos rx` 与这个矩阵绑定。改成"让每个面自己转"会同时打破明暗与背面剔除。
- **六面色相是「我在哪一面」的第一识别信号**。全部同色 = 转了但观众不知道到了哪。底部进度点是第二信号(巡到哪一面,哪个点亮成那面的色相)。
- `persp/棱长 ≈ 4` 是配方卡标定的均衡点:小了棱角畸变像鱼眼,大了立方体读作贴图没有体积。改棱长要同比改 perspective。
- 时长不够时**巡览整段等比压缩**(不是砍面),末段定格保底 0.8s。面多又要短片时会显得赶,那说明该减面而不是减时长。
