import React from 'react';
import {Easing, useCurrentFrame} from 'remotion';
import {progress} from '../lib/anim';

// 前快后慢,最后 1/3 时间里数字几乎停稳,观众来得及读
const TICK = Easing.bezier(0.22, 1, 0.36, 1);

export const NumberTicker: React.FC<{
  to: number;
  from?: number;
  delay?: number;
  dur?: number;
  format?: (n: number) => string;
  style?: React.CSSProperties;
}> = ({
  to,
  from = 0,
  delay = 0,
  dur = 36,
  format = (n) => Math.round(n).toString(),
  style,
}) => {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, dur, TICK);
  const value = from + (to - from) * p;
  return (
    <span style={{fontVariantNumeric: 'tabular-nums', ...style}}>
      {format(value)}
    </span>
  );
};
