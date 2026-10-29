import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {MOVE} from '../lib/anim';
import {ink, seriesDark} from '../lib/theme';

// 停滞进度条:停在某个百分比不动,偶尔"试探着 +1% 又缩回去"。
//
// 语义动效:表达"卡住了""努力过但没进展"。比一个静止不动的进度条强得多——
// 完全静止观众会以为是静态图,而"试探一下又退回"让"卡住"变成一个可见的**动作**。
//
// 参数节制:delta 给 1–2 个百分点就够,给多了会读成"在推进";
// 试探次数 1–2 次,多了变成滑稽的抖动。

export type ProgressProbe = {
  /** 试探起始帧。 */
  frame: number;
  /** 试探涨幅(百分点)。1–2 最好。 */
  delta?: number;
  /** 涨上去用的帧数。 */
  upDur?: number;
  /** 在高点停留的帧数。 */
  hold?: number;
  /** 缩回用的帧数。 */
  downDur?: number;
};

export const StalledProgress: React.FC<{
  /** 卡住的基准百分比(0–100)。 */
  pct: number;
  probes?: ProgressProbe[];
  width: number;
  height?: number;
  color?: string;
  trackColor?: string;
  /** 是否在右侧显示百分比数字。 */
  showLabel?: boolean;
  labelSize?: number;
  style?: React.CSSProperties;
}> = ({
  pct,
  probes = [],
  width,
  height = 10,
  color = seriesDark[0],
  trackColor = ink.grid,
  showLabel = false,
  labelSize = 28,
  style,
}) => {
  const frame = useCurrentFrame();

  let current = pct;
  for (const p of probes) {
    const delta = p.delta ?? 1;
    const upDur = p.upDur ?? 10;
    const hold = p.hold ?? 8;
    const downDur = p.downDur ?? 10;
    current += interpolate(
      frame,
      [p.frame, p.frame + upDur, p.frame + upDur + hold, p.frame + upDur + hold + downDur],
      [0, delta, delta, 0],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: MOVE},
    );
  }
  const clamped = Math.max(0, Math.min(100, current));

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 16, ...style}}>
      <div
        style={{
          width,
          height,
          borderRadius: height / 2,
          background: trackColor,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            borderRadius: height / 2,
            background: color,
          }}
        />
      </div>
      {showLabel ? (
        <div
          style={{
            fontSize: labelSize,
            color: ink.muted,
            fontVariantNumeric: 'tabular-nums',
            minWidth: labelSize * 2.6,
          }}
        >
          {Math.round(clamped)}%
        </div>
      ) : null}
    </div>
  );
};
