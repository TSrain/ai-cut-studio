import React from 'react';
import {interpolate} from 'remotion';
import type {TypographyContext} from '../../lib/theme';
import {alpha, textStyle} from '../../lib/theme';

// 状态开关:把一次抽象的状态转变落到一个**具体可操作物**上。
// 抽自 projects/2026-07-31-srt-automotion-ab 的 v2 `frame.tsx#StateToggle`(那里是「手工 → 全自动」)。
//
// 当初解决的问题:「A 变成了 B」这件事,默认做法是"A 淡出 / B 淡入"——
// 观众看到的是两个东西在换,读不出"这是同一件事的两个状态"。
// 换成一个开关之后,轨道是不变的那个"同一件事",旋钮的位置就是状态本身,
// 一眼读成"被切过去了"。这是本组件真正的价值,不是它长得像个 iOS 开关。
//
// 踩过的坑:
//
// 1. **颜色必须离散切换,不能插值。** 源码里那个函数名叫 `interpolateColorish`
//    是句反话——它 `return p >= 0.5`。状态是离散的,颜色也该是:两色之间做渐变,
//    中间帧会出现一个既不属于 A 也不属于 B 的脏色(两个色相中点通常是灰绿或灰紫)。
//    **只有位置连续,颜色跳变**——这正是"物体在动 / 状态已切换"的读法。
// 2. **非当前那一侧的标签留 0.28,不是 0。** 完全消失就没有对照物了,
//    观众看不出"从什么切到了什么"。源码是 `1 - p*0.72` 和 `0.28 + p*0.72`。
// 3. **轨道要 inset 阴影。** 没有内凹阴影时轨道读作"一个圆角色块",
//    旋钮读作"贴在上面的另一个色块";有内凹才读成"槽 + 滑块"。
// 4. **旋钮的居中要按 padding box 算。** 轨道有 2px 描边且这里写死
//    `boxSizing:'border-box'`,绝对定位子元素的 top/left 是相对 padding box 的,
//    所以是 `(trackH - 4 - knob) / 2`。按外框算会视觉偏下 1–2px
//    (源码里那个 `-1` 就是在手工补这件事)。
// 5. **组件不做绝对定位。** 源码是 `left: cx - trackW/2` 钉死在画面某点的,
//    那是镜头专用坐标。这里是 inline-flex 流式元素,位置由调用方的 style 决定。
// 6. `fromColor` / `toColor` **必须是 hex**:轨道底色走 `alpha()`,传别的格式会算出 NaN。

export type StateToggleProps = {
  typography: TypographyContext;
  fromLabel: string;
  toLabel: string;
  fromColor: string;
  toColor: string;
  /** 0 = fromLabel 状态,1 = toLabel 状态。会被钳到 0–1。 */
  progress: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const TRACK_W = 190;
const TRACK_H = 62;
const BORDER = 2;
const KNOB = 48;
const INSET = 7;
// 坑 4:全部按 padding box 算
const TRAVEL = TRACK_W - BORDER * 2 - KNOB - INSET * 2;
const KNOB_TOP = (TRACK_H - BORDER * 2 - KNOB) / 2;

export const StateToggle: React.FC<StateToggleProps> = ({
  typography,
  fromLabel,
  toLabel,
  fromColor,
  toColor,
  progress,
}) => {
  const p = clamp01(progress);
  // 坑 1:颜色只有两态,过半即换边
  const on = p >= 0.5;
  const active = on ? toColor : fromColor;

  const knobLeft = interpolate(p, [0, 1], [INSET, INSET + TRAVEL]);
  // 坑 2:非当前侧不归零
  const fromOpacity = interpolate(p, [0, 1], [1, 0.28]);
  const toOpacity = interpolate(p, [0, 1], [0.28, 1]);

  const labelStyle: React.CSSProperties = {
    ...textStyle(typography, 'label'),
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{display: 'inline-flex', alignItems: 'center', gap: 22}}>
      <div style={{...labelStyle, color: fromColor, opacity: fromOpacity}}>{fromLabel}</div>
      <div
        style={{
          position: 'relative',
          width: TRACK_W,
          height: TRACK_H,
          boxSizing: 'border-box',
          borderRadius: 999,
          background: alpha(active, 0.14),
          border: `${BORDER}px solid ${active}`,
          // 坑 3:内凹才读成"槽"
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.45)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: KNOB_TOP,
            left: knobLeft,
            width: KNOB,
            height: KNOB,
            borderRadius: 999,
            background: active,
            boxShadow: '0 3px 10px rgba(0,0,0,0.5)',
          }}
        />
      </div>
      <div style={{...labelStyle, color: toColor, opacity: toOpacity}}>{toLabel}</div>
    </div>
  );
};
