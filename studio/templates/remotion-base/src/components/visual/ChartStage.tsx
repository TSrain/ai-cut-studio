import React from 'react';
import {EditableText} from '../../editor/preset-editing';
import {interpolate} from 'remotion';
import type {ScenePalette, TypographyContext} from '../../lib/theme';
import {alpha, seriesDark, seriesLight, textStyle} from '../../lib/theme';
import {ENTER, MOVE} from '../../lib/anim';

// 图表舞台:坐标轴 + 网格 + 折线/面积/柱 + **选择性**标签。
// 是 `src/components/LineChartReveal.tsx` 的通用化——那个只画单条折线、
// 轴和刻度都是写死的,任何"要个 Y 轴刻度 / 要柱状 / 要两条线"的镜头都得另起炉灶。
//
// **何时用**:任何要让观众读出数值关系的画面(趋势、对比、构成)。
// **何时不用**:
// - 只想表达"涨了很多"而不需要读数 → 用 MetricCluster 出结论数字,别画图;
// - 一条线 + 一个端点标签就够 → LineChartReveal 更轻;
// - 类别没有可比的量纲 → 那不是图表,是列表。
//
// ============ 保留下来的图表正确性规则(硬,不随合同放宽) ============
//
// `facts.mode: illustrative` 放宽的是"数字是不是真的",**不放宽"图会不会被读错"**。
// 以下五条在本组件里是**结构上做不到违反**,不是靠调用方自觉:
//
// A. **单轴。** 组件只有一个 y 值域(`yDomain`),所有系列共用。永远不提供第二个 Y 轴
//    ——双轴图的两个标度对齐方式是任意的,会凭空造出一个数据里没有的相关性。
//    两个量纲不同的指标 → 两个 ChartStage,或指数化到同一基准后再进来。
// B. **系列色固定顺序、不循环、不按排名重排。** 颜色按 `series` 数组下标从
//    theme 的 `seriesDark`/`seriesLight` 取(那套色已过色觉无障碍验证,相邻 CVD ΔE≥8)。
//    筛掉一个系列后,幸存系列不换色——所以调用方过滤数据时应保持数组位置,
//    或显式给 `color` 钉死。**超过 4 个系列直接抛错**,不发明第 5 种颜色。
// C. **不用彩虹渐变映射数值。** 面积填充是系列色本身的低透明度版,一个色相到底。
// D. **文字穿墨色,不穿系列色。** 数值、轴标签、图例文字全部走 palette 的 ink 阶梯;
//    身份由文字旁边的**色块**承载。浅色系列色(黄)当文字在任何底上都读不清。
// E. **标签是选择性的。** 组件不提供"给每个点都标数字"的开关;要标哪个点由
//    `labels` 显式列出(默认只在单系列时自动标末点)。≥2 系列必有图例,单系列不放图例
//    ——只有一个颜色时图例只是把标题又说了一遍。
//
// ============ 踩过的坑 ============
//
// 1. **绝不在渲染期取数。** 数据全部走 typed props。组件里没有 fetch、没有
//    `staticFile` 读 JSON、没有 `Date.now()`。任意一帧必须能独立算出来。
// 2. **各系列 `values` 长度必须一致,不一致直接抛错。** 曾经"短的那条按自己的
//    下标铺满整个 x 轴",于是两条线的同一个 x 位置代表不同的时间点——
//    这是最隐蔽的读错方式,静默兼容比报错危险得多。
// 3. **折线的绘制进度用 `strokeDasharray`,长度解析计算,不测 DOM。**
//    `getTotalLength()` 在渲染进程里要等布局,抽帧会拿到 0。
// 4. **面积的揭示用 `clipPath` 矩形,不用 `scaleX`。** scaleX 会把描边一起拉细,
//    左边的线比右边粗,一眼假。clipPath 的 id 走 `useId()`——同屏两张图硬编码
//    同一个 id 时,第二张会吃掉第一张的裁剪区。
// 5. **柱子必须从基线长出来,不是从画布底部。** 值域跨 0 时基线在中间,
//    负值柱向下长;不处理的话负数柱会画到轴外面。
// 6. **网格线是实线发丝级。** 虚线网格读起来像"预测值"或"阈值线",那是别的意思。
// 7. **y 刻度取整到好看的数(1/2/5×10ⁿ)。** 直接把 min/max 均分会出现
//    "3.7143" 这种刻度,观众读不动。
// 8. `palette` 的颜色必须是 hex(`alpha()` 内部 `parseInt(hex,16)`)。
//    `scenePalette()` 的输出都满足。

export type ChartMark = 'line' | 'area' | 'bar';

export type ChartSeries = {
  id: string;
  /** 系列名。用于图例和直接标签,不允许留空 */
  name: string;
  /** 数据点。各系列长度必须一致(坑 2) */
  values: number[];
  /** 默认 'line' */
  mark?: ChartMark;
  /** 覆盖固定顺序系列色。必须是 hex。品牌色替换系列 1 时用它 */
  color?: string;
};

/** 选择性标签:显式点名要标哪个点(规则 E)。 */
export type ChartPointLabel = {
  seriesId: string;
  /** 数据点下标。负数从末尾数(-1 = 末点) */
  index: number;
  /** 不给则用 yFormat(值) */
  text?: string;
};

export type ChartStageProps = {
  /** Opt into the editor's real SVG label targets without changing chart geometry. */
  editorParts?: boolean;
  typography: TypographyContext;
  series: ChartSeries[];
  /** 0–1,整图的绘制进度。会被钳到 0–1 */
  progress: number;
  palette: ScenePalette;
  /** 组件总宽高(含标题/图例行)。plot 区是剩下的部分 */
  width: number;
  height: number;
  /** x 轴刻度文字。长度应与 values 一致;不给则不画 x 刻度 */
  xLabels?: string[];
  /** y 网格线条数(不含基线)。默认 4 */
  yTicks?: number;
  /** y 值域。不给则从数据算(柱图强制含 0) */
  yDomain?: [number, number];
  /** 数值格式化。默认千分位整数 */
  yFormat?: (v: number) => string;
  labels?: ChartPointLabel[];
  /** 标题。单系列时标题就是系列名(规则 E) */
  title?: string;
  /** 线宽,1080p 尺度默认 6(design-principles §4) */
  strokeWidth?: number;
  style?: React.CSSProperties;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const defaultFormat = (v: number) =>
  Math.abs(v) >= 1000
    ? Math.round(v).toLocaleString('en-US')
    : String(Math.round(v * 100) / 100);

/** 坑 7:把步长吸到 1/2/5×10ⁿ。 */
const niceStep = (raw: number) => {
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
};

const TITLE_H = 78;
const LEGEND_H = 56;

export const ChartStage: React.FC<ChartStageProps> = ({
  editorParts = false,
  typography,
  series,
  progress,
  palette,
  width,
  height,
  xLabels,
  yTicks = 4,
  yDomain,
  yFormat = defaultFormat,
  labels,
  title,
  strokeWidth = 6,
  style,
}) => {
  const clipId = React.useId().replace(/[:]/g, '');
  const p = clamp01(progress);

  // ---- 规则 B:超过 4 个系列不发明第 5 种颜色,直接拦下 ----
  if (series.length === 0) {
    throw new Error('ChartStage: series 为空,没有可画的东西');
  }
  if (series.length > 4) {
    throw new Error(
      `ChartStage: 收到 ${series.length} 个系列。分类系列色只有 4 档(色觉无障碍验证过的那 4 个),` +
        '超过就必须合并为"其他"、拆分画面或改用小倍数图——不发明第 5 种颜色。',
    );
  }
  // ---- 坑 2:长度不一致直接抛错,不静默按各自下标铺满 ----
  const n = series[0].values.length;
  for (const s of series) {
    if (s.values.length !== n) {
      throw new Error(
        `ChartStage: 系列 "${s.id}" 有 ${s.values.length} 个点,而 "${series[0].id}" 有 ${n} 个。` +
          '各系列必须共用同一条 x 轴,长度不一致会让同一个 x 位置代表不同的时间点。',
      );
    }
  }
  if (n < 2 && series.some((s) => (s.mark ?? 'line') !== 'bar')) {
    throw new Error('ChartStage: 折线/面积至少要 2 个点;单个点请用 MetricCluster');
  }

  // ---- 规则 B:固定顺序取色 ----
  const ramp = palette.mode === 'light' ? seriesLight : seriesDark;
  const colorOf = (s: ChartSeries, i: number) => s.color ?? ramp[i % ramp.length];

  const hasBar = series.some((s) => (s.mark ?? 'line') === 'bar');
  const showLegend = series.length >= 2;

  // ---- 版面 ----
  const padTop = (title ? TITLE_H : 0) + (showLegend ? LEGEND_H : 0) + 16;
  const padLeft = 132; // y 刻度文字占位
  const padRight = 56;
  const padBottom = xLabels ? 76 : 34;
  const plotW = Math.max(1, width - padLeft - padRight);
  const plotH = Math.max(1, height - padTop - padBottom);

  // ---- 规则 A:唯一一个 y 值域,所有系列共用 ----
  const flat = series.flatMap((s) => s.values);
  let lo = yDomain ? yDomain[0] : Math.min(...flat);
  let hi = yDomain ? yDomain[1] : Math.max(...flat);
  if (!yDomain) {
    if (hasBar) {
      // 坑 5:柱图的值域必须含 0,否则柱长不再和数值成比例
      lo = Math.min(0, lo);
      hi = Math.max(0, hi);
    }
    const span = hi - lo || Math.abs(hi) || 1;
    if (!hasBar) {
      lo -= span * 0.08;
      hi += span * 0.08;
    } else {
      hi += span * 0.06;
    }
  }
  const step = niceStep((hi - lo) / Math.max(1, yTicks));
  const tickVals: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    tickVals.push(Math.round(v / step) * step);
  }

  const band = plotW / n;
  // 有柱时点落在带中心(柱要占满带),没柱时铺满整个 plot 宽度
  const sx = (i: number) =>
    hasBar ? padLeft + band * (i + 0.5) : padLeft + (i / (n - 1)) * plotW;
  const sy = (v: number) =>
    padTop + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const baselineV = lo <= 0 && hi >= 0 ? 0 : lo;
  const baselineY = sy(baselineV);

  const barSeries = series.filter((s) => (s.mark ?? 'line') === 'bar');
  // 每根柱不填满带:留气(dataviz mark spec)。组内再留 2px 的表面色间隙
  const groupW = band * 0.62;
  const barW = Math.max(
    4,
    (groupW - 2 * Math.max(0, barSeries.length - 1)) / Math.max(1, barSeries.length),
  );

  const axisText: React.CSSProperties = {
    ...textStyle(typography, 'caption'),
    fontFamily: typography.families.mono,
    fontVariantNumeric: 'tabular-nums',
  };

  // ---- 规则 E:默认只在单系列时自动标末点 ----
  const effLabels: ChartPointLabel[] =
    labels ?? (series.length === 1 ? [{seriesId: series[0].id, index: -1}] : []);

  return (
    <div style={{width, height, position: 'relative', ...style}}>
      {title ? (
        <div
          style={{
            ...textStyle(typography, 'h2'),
            color: palette.ink,
            position: 'absolute',
            left: 0,
            top: 0,
            width,
            height: TITLE_H,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {title}
        </div>
      ) : null}

      {/* 图例:≥2 系列必有(规则 E)。色块承载身份,文字穿墨色(规则 D) */}
      {showLegend ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: title ? TITLE_H : 0,
            height: LEGEND_H,
            display: 'flex',
            alignItems: 'center',
            gap: 36,
          }}
        >
          {series.map((s, i) => (
            <div key={s.id} style={{display: 'flex', alignItems: 'center', gap: 12}}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  background: colorOf(s, i),
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  ...textStyle(typography, 'label'),
                  color: palette.inkSecondary,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <svg width={width} height={height} style={{position: 'absolute', inset: 0}}>
        <defs>
          {/* 坑 4:面积/柱的揭示走矩形裁剪,id 由 useId 保证同屏唯一 */}
          <clipPath id={`${clipId}-wipe`}>
            <rect
              x={padLeft - band}
              y={padTop - 40}
              width={(plotW + band) * p}
              height={plotH + 80}
            />
          </clipPath>
        </defs>

        {/* 网格:实线发丝级,压在数据之下(坑 6) */}
        {tickVals.map((v) => (
          <line
            key={`g${v}`}
            x1={padLeft}
            x2={padLeft + plotW}
            y1={sy(v)}
            y2={sy(v)}
            stroke={palette.line}
            strokeWidth={1.5}
          />
        ))}
        {/* 基线比网格重一档:它是"零",不是刻度 */}
        <line
          x1={padLeft}
          x2={padLeft + plotW}
          y1={baselineY}
          y2={baselineY}
          stroke={alpha(palette.ink, 0.34)}
          strokeWidth={2}
        />

        {/* y 刻度文字:墨色弱档(规则 D) */}
        {tickVals.map((v) => (
          <EditableText as="text" part={editorParts ? 'y-labels' : ''}
            key={`t${v}`}
            x={padLeft - 24}
            y={sy(v) + 9}
            textAnchor="end"
            fill={palette.inkMuted}
            style={axisText}
          >
            {yFormat(v)}
          </EditableText>
        ))}

        {/* x 刻度文字 */}
        {xLabels
          ? xLabels.slice(0, n).map((t, i) => (
              <EditableText as="text" part={editorParts ? `xLabel-${i}` : ''}
                key={`x${i}`}
                x={sx(i)}
                y={padTop + plotH + 44}
                textAnchor="middle"
                fill={palette.inkMuted}
                style={axisText}
              >
                {t}
              </EditableText>
            ))
          : null}

        {/* ---- 柱 ---- */}
        {barSeries.map((s, bi) => {
          const gi = series.indexOf(s);
          const color = colorOf(s, gi);
          return (
            <g key={`bar-${s.id}`}>
              {s.values.map((v, i) => {
                // 逐柱交错生长:柱图的入场是"一根一根立起来",不是整体拉伸
                const bp = interpolate(
                  p,
                  [(i / n) * 0.7, (i / n) * 0.7 + 0.3],
                  [0, 1],
                  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ENTER},
                );
                const yv = sy(v);
                const full = Math.abs(yv - baselineY);
                const h = Math.max(0, full * bp);
                // 坑 5:从基线长出去,负值向下
                const top = v >= baselineV ? baselineY - h : baselineY;
                const x =
                  sx(i) - groupW / 2 + bi * (barW + 2); // 组内 2px 表面色间隙
                return (
                  <rect
                    key={`${s.id}-${i}`}
                    x={x}
                    y={top}
                    width={barW}
                    height={h}
                    // 数据端圆角、基线端直角:圆角在基线上会让"零"看着悬空
                    rx={Math.min(6, barW / 2)}
                    fill={color}
                  />
                );
              })}
            </g>
          );
        })}

        {/* ---- 面积 + 折线 ---- */}
        {series.map((s, i) => {
          const mark = s.mark ?? 'line';
          if (mark === 'bar') return null;
          const color = colorOf(s, i);
          const pts = s.values.map((v, k) => [sx(k), sy(v)] as const);
          const d = pts
            .map(([x, y], k) => `${k === 0 ? 'M' : 'L'} ${x} ${y}`)
            .join(' ');
          // 坑 3:折线长度解析算出来,不问 DOM
          const total = pts
            .slice(1)
            .reduce(
              (acc, [x, y], k) => acc + Math.hypot(x - pts[k][0], y - pts[k][1]),
              0,
            );
          const areaD = `${d} L ${pts[pts.length - 1][0]} ${baselineY} L ${pts[0][0]} ${baselineY} Z`;
          return (
            <g key={`line-${s.id}`}>
              {mark === 'area' ? (
                // 规则 C:填充是系列色本身的低透明版,一个色相到底,不是渐变映射
                <path
                  d={areaD}
                  fill={alpha(color, 0.16)}
                  clipPath={`url(#${clipId}-wipe)`}
                />
              ) : null}
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
            </g>
          );
        })}

        {/* ---- 选择性标签(规则 E):端点圆点 + 表面色描边环 + 墨色数值 ---- */}
        {effLabels.map((L, li) => {
          const si = series.findIndex((s) => s.id === L.seriesId);
          if (si < 0) return null;
          const s = series[si];
          const idx = L.index < 0 ? s.values.length + L.index : L.index;
          if (idx < 0 || idx >= s.values.length) return null;
          const color = colorOf(s, si);
          const x = sx(idx);
          const y = sy(s.values[idx]);
          // 标签在该点被画到之后才出现:先有点,才有对这个点的注解
          const reach = hasBar ? (idx + 0.5) / n : idx / Math.max(1, n - 1);
          const lp = interpolate(p, [reach * 0.92, reach * 0.92 + 0.12], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: MOVE,
          });
          if (lp <= 0) return null;
          const right = x > padLeft + plotW * 0.7;
          return (
            <g key={`lab-${li}`} opacity={lp}>
              <circle
                cx={x}
                cy={y}
                r={13}
                fill={color}
                stroke={palette.bg}
                strokeWidth={5}
              />
              <EditableText as="text" part={editorParts ? 'value-labels' : ''}
                x={right ? x - 30 : x + 30}
                y={y - 26}
                textAnchor={right ? 'end' : 'start'}
                // 规则 D:数值穿墨色,身份靠旁边那个色点
                fill={palette.ink}
                style={{
                  ...textStyle(typography, 'body'),
                  fontFamily: typography.families.data,
                  fontWeight: 650,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {L.text ?? yFormat(s.values[idx])}
              </EditableText>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
