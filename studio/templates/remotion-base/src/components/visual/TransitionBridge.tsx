import React from 'react';
import {interpolate} from 'remotion';
import {alpha} from '../../lib/theme';
import {MOVE} from '../../lib/anim';

// 转场桥:一个**共享轴**的元素(线 / 遮罩 / 物体)从上一镜的落点交接到下一镜的起点。
//
// **解决什么问题**:design-principles §3 说"转场要有空间逻辑:上一场的焦点位置
// 决定下一场从哪里开始"。合同里每镜有 `startAnchor` / `endAnchor` 两句话
// (例:"accent line enters from lower-left"),但**散文没法驱动像素**——
// 结果是每次都硬切加个淡入,整片读成 20 个不相干的小动画拼起来。
// 这个组件就是那两句散文的机器可读版:把 anchor 变成坐标 + 形态,让同一个元素
// 真的从 A 走到 B。
//
// **对应关系**(写合同时按这个翻译):
//   "accent line enters from lower-left"  → {kind:'line',  x:0.08, y:0.86, angle:-24}
//   "focus panel settles at upper-right"  → {kind:'panel', x:0.72, y:0.24, size:0.34}
//   "single dot at frame center"          → {kind:'dot',   x:0.5,  y:0.5}
//   "wipe covers the frame from the left" → {kind:'wipe',  x:0,    y:0.5, angle:0}
//
// **何时用**:两镜之间(上一镜末几帧 + 下一镜头几帧,各放一个,progress 首尾相接)。
// **何时不用**:
// - 同一镜内的元素移动 → 那是编排,直接 interpolate,不必上组件;
// - 两镜内容完全无关 → 强行连一条线是假连续,不如老实硬切;
// - 需要遮住整屏做真·擦切 → 用 `kind:'wipe'` 且两侧 anchor 的 `size` 都给 1。
//
// ============ 踩过的坑 ============
//
// 1. **坐标用归一化 0–1,不用像素。** 桥要跨两个镜头,而两镜可能不同分辨率
//    (竖版正片 + 横版预告)。像素坐标一换比例就飞了。
// 2. **形态(kind)可以变,但只能变一次。** line→dot 是"线收成一个点"(合理),
//    line→dot→panel 在一个桥里会读成三件不同的东西闪现。要三段就串两个桥。
// 3. **`progress` 必须两镜首尾相接。** 上一镜末段给 0→0.5,下一镜头段给 0.5→1。
//    两边都从 0 跑到 1 的话,元素会在切点上"倒回去",比不做转场还糟。
// 4. **元素只用一个强调色,不给它自己的底色。** 桥是"同一个东西在两个场景里",
//    给它底色就变成"第三个场景"了。
// 5. **不做模糊拖尾。** 试过给桥加 motion blur,压缩后糊成一团脏东西,
//    而且它会盖住下一镜的开场信息。速度感靠拉长(`stretch`)做,不靠模糊。
// 6. `accent` 必须是 hex(`alpha()` 内部 `parseInt(hex,16)`;传 'red' 会得到 NaN,
//    整条桥直接消失——而且不报错)。
// 7. **`pointerEvents:'none'` + 绝对定位铺满**:桥是覆盖层,不参与下面的布局。

export type BridgeAnchorKind = 'line' | 'dot' | 'panel' | 'wipe';

export type BridgeAnchor = {
  kind: BridgeAnchorKind;
  /** 归一化 0–1 的画面坐标(坑 1)。元素中心 */
  x: number;
  y: number;
  /** 角度(度)。line / wipe 用;0 = 水平,正值顺时针 */
  angle?: number;
  /**
   * 归一化尺寸 0–1:line 指长度占画面对角线的比例,dot 指直径占短边的比例,
   * panel 指边长占短边的比例,wipe 指覆盖比例(1 = 铺满)。
   * 默认 line 0.8 / dot 0.05 / panel 0.3 / wipe 1
   */
  size?: number;
  /** 透明度 0–1。默认 1。做"从无到有"时把起点设 0 */
  opacity?: number;
};

export type TransitionBridgeProps = {
  /** 上一镜的落点(= 合同里那一镜的 endAnchor) */
  fromAnchor: BridgeAnchor;
  /** 下一镜的起点(= 合同里下一镜的 startAnchor) */
  toAnchor: BridgeAnchor;
  /** 0–1,会被钳到 0–1。两镜要首尾相接,见坑 3 */
  progress: number;
  /** 强调色,必须是 hex */
  accent: string;
  /** 画面尺寸。归一化坐标乘它得到像素 */
  width: number;
  height: number;
  /** 线宽(像素,1080p 尺度)。默认 6 */
  thickness?: number;
  /** 运动中段的拉伸量 0–1:速度感来源(坑 5)。默认 0.35,给 0 关闭 */
  stretch?: number;
  style?: React.CSSProperties;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const DEFAULT_SIZE: Record<BridgeAnchorKind, number> = {
  line: 0.8,
  dot: 0.05,
  panel: 0.3,
  wipe: 1,
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const TransitionBridge: React.FC<TransitionBridgeProps> = ({
  fromAnchor,
  toAnchor,
  progress,
  accent,
  width,
  height,
  thickness = 6,
  stretch = 0.35,
  style,
}) => {
  const p = clamp01(progress);
  // MOVE 是同屏移动的标准曲线:两端缓、中间快。桥永远不用线性
  const t = interpolate(p, [0, 1], [0, 1], {easing: MOVE});

  const short = Math.min(width, height);
  const diag = Math.hypot(width, height);

  const fSize = fromAnchor.size ?? DEFAULT_SIZE[fromAnchor.kind];
  const tSize = toAnchor.size ?? DEFAULT_SIZE[toAnchor.kind];
  const fOpacity = fromAnchor.opacity ?? 1;
  const tOpacity = toAnchor.opacity ?? 1;

  const cx = mix(fromAnchor.x, toAnchor.x, t) * width;
  const cy = mix(fromAnchor.y, toAnchor.y, t) * height;
  const angle = mix(fromAnchor.angle ?? 0, toAnchor.angle ?? 0, t);
  const size = mix(fSize, tSize, t);
  const opacity = mix(fOpacity, tOpacity, t);

  // 坑 2:形态在中点切换,一次。切换点做一次快速交叉淡化,不做形变插值
  //(线插值成方块的中间态是一堆读不出是什么的东西)
  const morph = interpolate(p, [0.42, 0.58], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const kind: BridgeAnchorKind = morph < 0.5 ? fromAnchor.kind : toAnchor.kind;
  const sameKind = fromAnchor.kind === toAnchor.kind;
  // 同形态不闪;换形态时在切点压一下透明度,读作"变了个形"而不是"闪了一下"
  const morphDip = sameKind
    ? 1
    : interpolate(morph, [0, 0.5, 1], [1, 0.35, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });

  // 坑 5:速度感靠中段拉长,不靠模糊。两端拉伸为 0,中间最大
  const speed = interpolate(p, [0, 0.5, 1], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const stretchK = 1 + clamp01(stretch) * speed;

  const common: React.CSSProperties = {
    position: 'absolute',
    left: cx,
    top: cy,
    opacity: opacity * morphDip,
    // 坑 4:只有强调色,没有自己的底
    background: accent,
    pointerEvents: 'none',
  };

  let el: React.ReactNode = null;
  if (kind === 'line') {
    const len = size * diag * stretchK;
    el = (
      <div
        style={{
          ...common,
          width: len,
          height: thickness,
          borderRadius: thickness / 2,
          transform: `translate(-50%, -50%) rotate(${angle}deg)`,
          boxShadow: `0 0 ${thickness * 4}px ${alpha(accent, 0.35)}`,
        }}
      />
    );
  } else if (kind === 'dot') {
    const d = size * short;
    el = (
      <div
        style={{
          ...common,
          width: d * stretchK,
          height: d,
          borderRadius: '50%',
          transform: `translate(-50%, -50%) rotate(${angle}deg)`,
          boxShadow: `0 0 ${d}px ${alpha(accent, 0.32)}`,
        }}
      />
    );
  } else if (kind === 'panel') {
    const s = size * short;
    el = (
      <div
        style={{
          ...common,
          width: s * stretchK,
          height: s,
          borderRadius: 20,
          // 面板形态用低透明填充 + 实描边:实心大色块会一次吃光强调面积配额
          background: alpha(accent, 0.14),
          border: `${thickness / 2}px solid ${accent}`,
          boxSizing: 'border-box',
          transform: `translate(-50%, -50%) rotate(${angle}deg)`,
        }}
      />
    );
  } else {
    // wipe:一条铺满短边、按 size 决定覆盖比例的带子
    el = (
      <div
        style={{
          ...common,
          width: diag * 1.2,
          height: Math.max(2, size * height),
          transform: `translate(-50%, -50%) rotate(${angle}deg)`,
          background: `linear-gradient(90deg, ${alpha(accent, 0)} 0%, ${accent} 22%, ${accent} 78%, ${alpha(accent, 0)} 100%)`,
        }}
      />
    );
  }

  return (
    // 坑 7:覆盖层,不参与布局
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width,
        height,
        overflow: 'hidden',
        pointerEvents: 'none',
        ...style,
      }}
    >
      {el}
    </div>
  );
};
