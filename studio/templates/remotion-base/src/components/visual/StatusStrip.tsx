import React from 'react';
import {interpolate} from 'remotion';
import type {TypographyContext} from '../../lib/theme';
import {alpha, textStyle} from '../../lib/theme';
import {PANEL_SHEEN, panelSurface} from './SurfacePanel';

// 状态条:标签 + 分段进度 + 右侧真实计数。
// 抽自 projects/2026-07-31-srt-automotion-ab 的 v2 `frame.tsx#StatusBar`。
//
// 当初解决的问题:画面底部需要一条"系统在做什么、做到哪了"的带子,
// 但一条连续进度条读起来是"加载中"(纯状态),分段之后才读成**可数的离散步骤**
// ——观众能数出"5 段里走完了 3 段",这是信息,不是氛围。
// 右侧计数是同一件事的数字表达:**画面上有几条线就写几,不编数字**。
//
// 踩过的坑:
//
// 1. **每段各自 interpolate 到自己的子区间并两端 clamp**,不是一条
//    `width: progress*100%` 再切几刀。子区间写法下"第 i 段"是独立单位,
//    段与段之间的间隙不会被填充穿过去。
// 2. **段的轨道必须 `overflow:hidden` 且内外同圆角。** 填充是个直角矩形,
//    不裁的话会从圆角轨道的两端戳出直角,小尺寸下特别脏。
// 3. **计数必须 `tabular-nums` + `whiteSpace:'nowrap'`。** 比例数字下
//    "1→2→3" 每帧宽度都不同,整条右侧会抖;换行则会把条撑高。
// 4. **标签和计数都要 `whiteSpace:'nowrap'`,中间的段组吃 `flex:1`。**
//    反过来(段组固定、文字自适应)一换文案长度,进度条长度就跟着变,
//    多镜之间对不齐。
// 5. `segments` 会被钳到 ≥1 并取整:传 0 会得到一条空带子(读作渲染出错),
//    传小数会让 `interpolate` 的子区间算出非预期结果。
// 6. `color` **必须是 hex**:标签色、段轨道色都走 `alpha()`,别的格式会算出 NaN。
// 7. 组件不做定位、不吃宽度:`width:'100%'`,横向尺寸和位置由调用方容器决定
//    (源码里是 `left: BAR.x, top: BAR.y, width: BAR.w` 钉死的镜头专用坐标)。

export type StatusStripProps = {
  typography: TypographyContext;
  label: string;
  /** 右侧计数。是字符串,因为常带单位/分母("3 / 5"、"12 条")。 */
  count: string;
  color: string;
  /** 分几段。会被钳到 ≥1 的整数。 */
  segments: number;
  /** 0–1,整条的填充进度。会被钳到 0–1。 */
  progress: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const RADIUS = 14;

export const StatusStrip: React.FC<StatusStripProps> = ({
  typography,
  label,
  count,
  color,
  segments,
  progress,
}) => {
  const p = clamp01(progress);
  const n = Math.max(1, Math.floor(segments)); // 坑 5

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 56,
        boxSizing: 'border-box',
        borderRadius: RADIUS,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '0 22px',
        ...panelSurface('solid', false, color),
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS,
          background: PANEL_SHEEN,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          // 标签是 color 的弱化版,不是暗塞进来的中性色——
          // 层级靠同色相的透明度阶梯做,不引入第二个色相
          ...textStyle(typography, 'label'),
          letterSpacing: '0.06em',
          color: alpha(color, 0.72),
          whiteSpace: 'nowrap', // 坑 4
        }}
      >
        {label}
      </div>
      <div style={{display: 'flex', gap: 6, flex: 1, alignItems: 'center'}}>
        {Array.from({length: n}, (_, i) => {
          // 坑 1:每段映射到自己的子区间,两端 clamp
          const t = interpolate(p, [i / n, (i + 1) / n], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: 10,
                borderRadius: 3,
                background: alpha(color, 0.18),
                overflow: 'hidden', // 坑 2
              }}
            >
              <div
                style={{
                  width: `${t * 100}%`,
                  height: '100%',
                  background: color,
                  borderRadius: 3,
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        style={{
          ...textStyle(typography, 'label'),
          fontFamily: typography.families.mono,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color,
          fontVariantNumeric: 'tabular-nums', // 坑 3
          whiteSpace: 'nowrap',
        }}
      >
        {count}
      </div>
    </div>
  );
};
