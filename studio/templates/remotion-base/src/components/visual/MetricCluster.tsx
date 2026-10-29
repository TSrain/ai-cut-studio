import React from 'react';
import {interpolate} from 'remotion';
import type {ScenePalette, TypographyContext} from '../../lib/theme';
import {alpha, ink as inkDark, good, oklch, textStyle} from '../../lib/theme';
import {ENTER} from '../../lib/anim';

// 指标簇:一个主指标 + 若干次级指标,表格式对齐。
//
// **解决什么问题**:镜头里要交代"一个结论数字 + 支撑它的几个数字"。
// 过去每个镜头现搓一遍 flex 布局,结果是(a)次级数字左右对不齐,读起来像随手摆的;
// (b)数字入场/滚动时逐帧宽度变化,整簇在抖。这两件事都是**结构问题**,
// 不是审美问题,所以固化成组件。
//
// **何时用**:结论先行的镜头开场(design-principles §4 的默认叙事顺序)、
// 数据对比、KPI 面板、片尾成果汇总。
//
// **何时不用**:
// - 只有一个数字 → 直接 textStyle(typography,'hero') 写一行,不必套簇;
// - 数字要随帧滚动 → 外面套 NumberTicker,把 ticker 的输出字符串喂给 `value`;
// - 需要坐标轴/时间序列 → 那是 ChartStage,不是这里。
//
// **踩过的坑**:
//
// 1. **所有数字必须 `tabular-nums`,主数字也不例外。**
//    dataviz 的通行建议是"大号独立数字用比例数字更好看"——那条建议成立的前提是
//    **静态页面**。视频里数字会随帧变化(count-up / 逐帧插值),比例数字下
//    "1" 比 "0" 窄,每帧总宽度都不同,整块会左右抖动。抖动比字距不完美难看得多,
//    所以这里全局 tabular,并且是硬编码不给开关。
// 2. **次级指标必须走 CSS Grid,不是一排 flex 卡片。**
//    flex 下每个卡片自己决定宽度,数值列永远对不齐;grid 的 `auto` 列会取
//    所有行的最大宽度,数值天然右对齐成一列——"表格式对齐"就是这一条。
// 3. **`value` 收字符串,组件不做数值格式化。** 千分位、小数位、单位、正负号
//    都是内容决定的(¥1,284 / 12.9K / 3.4%),塞进组件就会变成一堆格式化开关。
// 4. **delta 的颜色是状态色,不是系列色**(design-principles §5)。状态色永远
//    配一个方向箭头一起出现,不允许只靠颜色区分涨跌——色弱观众读不出。
// 5. **`accent` 只染主数字和一条细规则线,不染次级数字。** 一整簇都上强调色,
//    强调面积一次就超标,而且"哪个是主指标"这条信息就没了。
// 6. `accent` 必须是 hex(`alpha()` 内部 `parseInt(hex,16)`,传 'red' 会得到 NaN,
//    规则线直接消失)。scenePalette() / oklch() 的输出都满足。

export type Metric = {
  id: string;
  /** 指标名。短名词短语,不写句子 */
  label: string;
  /** 已格式化好的显示值(见坑 3) */
  value: string;
  /** 单位后缀。会用小一号、弱一档呈现,避免和数字抢视觉 */
  unit?: string;
  /** 变化量,已格式化(如 '+12.4%')。给了就必须给 trend,见坑 4 */
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
};

export type MetricClusterProps = {
  typography: TypographyContext;
  /** metrics[0] 是主指标,其余为次级。至少要有一项 */
  metrics: Metric[];
  /** 0–1,整簇的入场进度。会被钳到 0–1 */
  progress: number;
  /** 强调色,必须是 hex。只染主数字 + 规则线(坑 5) */
  accent: string;
  /** 给了就用它的墨色阶梯;不给按深色画面的默认墨色 */
  palette?: ScenePalette;
  /** 'stack' 主指标在上、次级在下(竖版默认);'row' 主指标在左、次级在右 */
  layout?: 'stack' | 'row';
  /** 主数字字号。默认 'hero';画面还要放别的东西时降到 'h1' */
  heroSize?: 'hero' | 'h1';
  /** 不给则由内容撑开。并排成组时给固定值才对得齐 */
  width?: number;
  style?: React.CSSProperties;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 把整体 progress 切成 n 段带重叠的子进度(第 i 项自己的 0–1)。 */
const windowed = (p: number, i: number, n: number, span = 0.55) => {
  const step = n > 1 ? (1 - span) / (n - 1) : 0;
  return interpolate(p, [i * step, i * step + span], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });
};

// 状态色。**不是系列色**,不参与图表配色(design-principles §5)。
// 下跌用 oklch 现算而不是手写 hex:明度要和 good(#0ca30c)对齐,
// 否则一列涨跌里"红比绿深"会读成"跌比涨严重"。
const TREND_COLOR: Record<NonNullable<Metric['trend']>, string> = {
  up: good,
  down: oklch(0.58, 0.18, 27),
  flat: oklch(0.62, 0.01, 90),
};

const TREND_GLYPH: Record<NonNullable<Metric['trend']>, string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

const Delta: React.FC<{
  typography: TypographyContext;
  metric: Metric;
  size: 'label' | 'caption';
}> = ({typography, metric, size}) => {
  if (!metric.delta) return null;
  const trend = metric.trend ?? 'flat';
  return (
    <span
      style={{
        ...textStyle(typography, size),
        fontFamily: typography.families.mono,
        fontWeight: 600,
        // 坑 1:涨跌数字也在列里,一样要等宽
        fontVariantNumeric: 'tabular-nums',
        color: TREND_COLOR[trend],
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
      }}
    >
      {/* 坑 4:方向箭头是第二编码通道,不能只靠颜色 */}
      <span style={{fontSize: '0.72em'}}>{TREND_GLYPH[trend]}</span>
      {metric.delta}
    </span>
  );
};

export const MetricCluster: React.FC<MetricClusterProps> = ({
  typography,
  metrics,
  progress,
  accent,
  palette,
  layout = 'stack',
  heroSize = 'hero',
  width,
  style,
}) => {
  const p = clamp01(progress);
  const primary = palette?.ink ?? inkDark.primary;
  const secondary = palette?.inkSecondary ?? inkDark.secondary;
  const muted = palette?.inkMuted ?? inkDark.muted;

  const hero = metrics[0];
  const rest = metrics.slice(1);
  // 主指标先落,次级指标随后交错;主指标单独占一档,不和次级混在同一个 stagger 序列里,
  // 否则次级项一多,主指标的入场就被挤成一瞬间
  const heroP = interpolate(p, [0, 0.45], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });
  const restBase = interpolate(p, [0.3, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  if (!hero) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: layout === 'row' ? 'row' : 'column',
        alignItems: layout === 'row' ? 'flex-start' : 'stretch',
        gap: layout === 'row' ? 72 : 44,
        width,
        ...style,
      }}
    >
      {/* ---- 主指标 ---- */}
      <div
        style={{
          opacity: heroP,
          transform: `translateY(${(1 - heroP) * 26}px)`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            ...textStyle(typography, 'caption'),
            color: muted,
            marginBottom: 12,
            whiteSpace: 'nowrap',
          }}
        >
          {hero.label}
        </div>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 14}}>
          <span
            style={{
              ...textStyle(typography, heroSize),
              fontFamily: typography.families.data,
              // 坑 1
              fontVariantNumeric: 'tabular-nums',
              fontFeatureSettings: `'tnum' 1`,
              // 坑 5:强调色在这一处,面积就是这一个数字
              color: accent,
              whiteSpace: 'nowrap',
            }}
          >
            {hero.value}
          </span>
          {hero.unit ? (
            <span
              style={{
                ...textStyle(typography, 'h2'),
                color: secondary,
                whiteSpace: 'nowrap',
              }}
            >
              {hero.unit}
            </span>
          ) : null}
        </div>
        {hero.delta ? (
          <div style={{marginTop: 10}}>
            <Delta typography={typography} metric={hero} size="label" />
          </div>
        ) : null}
      </div>

      {/* ---- 次级指标:Grid,数值列自动对齐(坑 2) ---- */}
      {rest.length > 0 ? (
        <div
          style={{
            display: 'grid',
            // label 吃剩余宽度,value / unit / delta 三列各取所有行的最大宽度 →
            // 数值天然右对齐成一列。这就是"表格式对齐"
            gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
            columnGap: 20,
            rowGap: 0,
            alignItems: 'baseline',
            flex: layout === 'row' ? 1 : undefined,
            minWidth: 0,
          }}
        >
          {rest.map((m, i) => {
            const mp = windowed(restBase, i, rest.length);
            const cell: React.CSSProperties = {
              opacity: mp,
              transform: `translateY(${(1 - mp) * 14}px)`,
              paddingTop: 18,
              paddingBottom: 18,
              // 坑 5:分隔用发丝线,不用色块。第一行不画上线
              borderTop: i === 0 ? 'none' : `1px solid ${alpha(accent, 0.18)}`,
            };
            return (
              <React.Fragment key={m.id}>
                <div
                  style={{
                    ...cell,
                    ...textStyle(typography, 'label'),
                    color: secondary,
                    // 长 label 收缩而不是撑破 grid
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.label}
                </div>
                <div
                  style={{
                    ...cell,
                    ...textStyle(typography, 'data'),
                    fontSize: 52,
                    // 坑 1 + 坑 5:次级数字用墨色,不上强调色
                    color: primary,
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.value}
                </div>
                <div
                  style={{
                    ...cell,
                    ...textStyle(typography, 'caption'),
                    color: muted,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.unit ?? ''}
                </div>
                <div style={{...cell, textAlign: 'right'}}>
                  <Delta typography={typography} metric={m} size="caption" />
                </div>
              </React.Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
