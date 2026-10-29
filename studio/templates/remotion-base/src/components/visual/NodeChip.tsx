import React from 'react';
import {interpolate} from 'remotion';
import type {TypographyContext} from '../../lib/theme';
import {alpha, textStyle} from '../../lib/theme';
import {PANEL_SHEEN, panelSurface} from './SurfacePanel';

// 链路节点(流程图/架构图/产线上的"一个东西")。
// 抽自 projects/2026-07-31-srt-automotion-ab 的 v2 `stage.tsx#NodePanel`。
//
// 当初解决的问题:**空框读不出"这是个东西"**。
// v1 用一个描边矩形 + 一行字表示节点,渲出来是流程图占位符。
// 一个能读成实体的节点有四件解剖学构件,缺一件就塌回占位符:
//   左侧语义图标(它是什么类别) → 名称(它叫什么) → 副标 / 型号(它的规格) → 右侧状态点(它现在在不在工作)
// 状态点是这里唯一承载**时间信息**的构件:整支片子"产线在运转"的读感来自它,不是装饰。
//
// 踩过的坑:
//
// 1. **状态点在 active≈0 时不能直接把 opacity 设成 0。** 源码是
//    `opacity = live>0.05 ? 0.35+live*0.65 : 1`,熄灭态用的是**暗色实点**而不是透明。
//    点整个消失会读成"这里本来就没有这个构件",而不是"这个节点还没启动"。
// 2. **0.05 这个死区不能去掉。** 没有死区时 active 从 0 微微抬起,点会以"半亮"
//    出现——半亮的状态灯在观众眼里是"故障",不是"正在启动"。
// 3. **状态点用 `marginLeft:'auto'` 顶到右边,不要绝对定位。** label 长度是变的,
//    绝对定位一换文案就压字。
// 4. **文字列必须 `minWidth: 0`。** flex 子项默认 min-width:auto,长 label 会把
//    面板从内部撑破而不是收缩,面板宽度就再也管不住了。
// 5. **图标必须 `flexShrink: 0`。** 少了它,长 label 会把方形图标压成一条竖片。
// 6. `color` **必须是 hex**(scenePalette()/oklch() 的输出都是)。副标和描边都走
//    `alpha(color, …)`,传 'red' / 'rgb(...)' 会算出 NaN,那两处会直接不显示。
// 7. 高光层同 SurfacePanel:第一个子节点、圆角与外层一致,否则盖字或溢角。

export type NodeChipProps = {
  typography: TypographyContext;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  color: string;
  /** 0–1,右侧状态点的活跃度。会被钳到 0–1,超范围不会炸。 */
  active: number;
  /** 不给则按内容自适应宽度。并排成组时给固定值才对得齐。 */
  width?: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const RADIUS = 14;

export const NodeChip: React.FC<NodeChipProps> = ({
  typography,
  label,
  sublabel,
  icon,
  color,
  active,
  width,
}) => {
  const a = clamp01(active);
  // 坑 1/2:死区之上才点亮,熄灭态是暗色实点而不是透明
  const lit = a > 0.05;
  const dotOpacity = lit ? interpolate(a, [0, 1], [0.35, 1]) : 1;

  return (
    <div
      style={{
        position: 'relative',
        width,
        boxSizing: 'border-box',
        borderRadius: RADIUS,
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 24px',
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
      {icon ? (
        <div style={{width: 40, height: 40, flexShrink: 0, color}}>{icon}</div>
      ) : null}
      {/* 坑 4:minWidth 0,否则长 label 撑破面板 */}
      <div style={{display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0}}>
        <div
          style={{
            // 节点名是"画面上一个对象的名字",不是正文——字号收 body 的 44,
            // 字重从 400 提到 600。这是本组件唯一一处覆盖 textStyle,
            // 字距/行高照收令牌,不手写。
            ...textStyle(typography, 'body'),
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
            color,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        {sublabel ? (
          <div
            style={{
              // 副标走等宽:它是型号/规格/编号那一类,等宽才读成"机器上的铭牌"
              ...textStyle(typography, 'caption'),
              fontFamily: typography.families.mono,
              letterSpacing: '0.12em',
              color: alpha(color, 0.62),
              whiteSpace: 'nowrap',
            }}
          >
            {sublabel}
          </div>
        ) : null}
      </div>
      {/* 状态点:承载信息(这个节点在不在工作),不是装饰 */}
      <div
        style={{
          marginLeft: 'auto',
          width: 12,
          height: 12,
          borderRadius: 6,
          flexShrink: 0,
          background: lit ? color : alpha(color, 0.22),
          opacity: dotOpacity,
        }}
      />
    </div>
  );
};
