import React from 'react';
import {useCurrentFrame} from 'remotion';
import {ENTER, progress} from '../lib/anim';

// 文字在裁剪容器内上滑入场。裁剪让运动发生在文字自己的空间里,
// 避免全屏飞入的廉价感。
export const TextReveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  dur?: number;
  style?: React.CSSProperties;
}> = ({children, delay = 0, dur = 18, style}) => {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, dur, ENTER);
  return (
    <div style={{overflow: 'hidden', ...style}}>
      <div
        style={{
          transform: `translateY(${(1 - p) * 100}%)`,
          opacity: Math.min(1, p * 1.6),
        }}
      >
        {children}
      </div>
    </div>
  );
};
