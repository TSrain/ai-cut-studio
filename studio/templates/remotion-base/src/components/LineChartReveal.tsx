import React from 'react';
import {useCurrentFrame} from 'remotion';
import {ENTER, progress} from '../lib/anim';
import {ink, surface} from '../lib/theme';
import type {TypographyContext} from '../lib/theme';

// 折线绘制入场 + 端点圆点 + 直接标签。
// 折线段长精确可算,所以用 dasharray 做绘制进度,不需要测量 DOM。
export const LineChartReveal: React.FC<{
  /** 字体套装,必填。端点标签是数字,走 data 角色。 */
  typography: TypographyContext;
  data: number[];
  width: number;
  height: number;
  color: string;
  delay?: number;
  dur?: number;
  label?: string;
  strokeWidth?: number;
  grid?: boolean;
  surfaceColor?: string;
}> = ({
  typography,
  data,
  width,
  height,
  color,
  delay = 0,
  dur = 45,
  label,
  strokeWidth = 6,
  grid = true,
  surfaceColor = surface.dark,
}) => {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, dur, ENTER);

  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const padX = 24;
  const padY = 40;
  const labelRoom = label ? 240 : 0; // 右侧给端点标签留位,避免溢出
  const sx = (i: number) =>
    padX + (i / (data.length - 1)) * (width - padX * 2 - labelRoom);
  const sy = (v: number) =>
    height - padY - ((v - lo) / (hi - lo || 1)) * (height - padY * 2);

  const pts = data.map((v, i) => [sx(i), sy(v)] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const total = pts
    .slice(1)
    .reduce(
      (acc, [x, y], i) => acc + Math.hypot(x - pts[i][0], y - pts[i][1]),
      0,
    );

  const [ex, ey] = pts[pts.length - 1];
  const dotP = progress(frame, delay + dur - 8, 12, ENTER);

  return (
    <svg width={width} height={height}>
      {grid &&
        [0.25, 0.5, 0.75].map((t) => {
          const y = padY + t * (height - padY * 2);
          return (
            <line
              key={t}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke={ink.grid}
              strokeWidth={2}
            />
          );
        })}
      <line
        x1={padX}
        x2={width - padX}
        y1={height - padY}
        y2={height - padY}
        stroke={ink.baseline}
        strokeWidth={2}
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={total}
        strokeDashoffset={total * (1 - p)}
      />
      <g opacity={dotP} transform={`translate(${ex}, ${ey}) scale(${dotP})`}>
        <circle r={14} fill={color} stroke={surfaceColor} strokeWidth={5} />
      </g>
      {label ? (
        <text
          x={ex + 36}
          y={ey + 14}
          opacity={dotP}
          fill={ink.primary}
          fontSize={44}
          fontWeight={650}
          fontFamily={typography.families.data}
          style={{fontVariantNumeric: 'tabular-nums'}}
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
};
