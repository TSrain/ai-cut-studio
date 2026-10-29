import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/TrendChart.tsx —— 趋势图表镜 preset(docs/presets/trend-chart/preset.json)
//
// 定位:口播念到「从 X 涨到 Y」「三年翻了四倍」「这里拐弯了」时的画面。
// 能力报告把「信息类」判为本项目核心甜区,而八个模板里一张图表都没有——这是最刺眼的空位。
//
// ============ 主角是结论句,不是图 ============
//
// `docs/chart-rules.md` 按观看场景分了三档,口播插片是第一档:
// **「结论与表现力优先,最大字号承担当前节拍的信息,图表只负责作证,不上审计信息」**。
// 所以这一镜的版面是:结论句(最大)→ 图(中)→ 注解与来源(最小),
// 而不是"一张完整报表 + 一行标题"。轴刻度能省则省,图例单系列时不出现。
//
// ============ 正确性:结构上做不到违反 ============
//
// §2 坐标比例诚信、§4 动画图表的坑属于**技术硬门槛层**,连选中的 Styleframe 也不能覆盖。
// 这里靠两件事保证,不靠调用方自觉:
//
//   - **单轴 / 系列色固定 / 不用彩虹 / 文字不穿系列色** —— 全部由 `ChartStage` 结构性保证,
//     本文件不自己画图元。这也是"复用+调参,不手搓"那条规矩的正例。
//   - **零基线是默认**,`yScale: 'tight'` 才收紧,而收紧时**必须画断轴符号**(见 AxisBreak)。
//     折线可以不从零起(它表达变化率),但截断且不标记比脚注冗余严重得多。
//     柱图无论如何都从零起——长度即数值,截断长度就是骗人;`ChartStage` 对 bar 强制含 0。
//
// ============ 数字是不是真的,不归这里管 ============
//
// 示意数据必须在合同里写 `facts.mode: "illustrative"`。模板不校验真实性,
// 但**终值必须是真值**:绘制进度只走 0→1,不许冲过头再回落(那是在显示一个从未存在的数值)。
//
// ============ 踩过的坑 ============
//
// 1. **values 用逗号分隔的字符串,不用数组槽。** 控制台表单里「2, 5, 12, 28, 61」
//    一行打完最顺手;做成一行一个数的多行框,填五个数要按四次回车。
// 2. **xLabels 数量和 values 对不上时宁可不画 x 刻度**,不要补空字符串——
//    补出来的空刻度会让人以为那一格没数据。
// 3. 绘制方向必须是时间方向(左→右)。ChartStage 的 progress 就是左→右,别反过来喂。

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {Backdrop, Eyebrow, Foreground, useBaseline} from '../style/baseline';
import {textStyle, alpha} from '../lib/theme';
import {ChartStage} from '../components/visual/ChartStage';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';
import {CALM, BEAT} from '../lib/anim';
import {fitFontSize} from '../style/fit';

export type PresetTrendChartProps = {
  durationSeconds: number;
  variant?: {mark?: 'line' | 'area' | 'bar'; yScale?: 'zero' | 'tight'};
  slots: {
    headline: string;
    values: string;
    seriesName: string;
    xLabels?: string;
    unit?: string;
    note?: string;
    source?: string;
    eyebrow?: string;
  };
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

// 相位:结论句先立住(0–14%),图从 20% 画到 72%,尾段 28% 静止读数。
// chart-rules §4:图表画完必须静止足够久读完,数字按 1 秒/个位数计
const PHASE = {chartFrom: 0.2, chartTo: 0.72};

const CANVAS = {w: 1080, h: 1920};
const PAD = 100;
const PLOT = {top: 780, w: 880, h: 620};

/** 「2, 5, 12」→ [2,5,12]。中英文逗号、顿号、空格都收 */
const parseNums = (s: string): number[] =>
  String(s ?? '')
    .split(/[,，、\s]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

const parseLabels = (s?: string): string[] =>
  String(s ?? '')
    .split(/[,，、]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * 断轴符号。**只在 yScale='tight' 时出现,而且是强制的**——
 * chart-rules §2:折线可以不从零起,但必须有可感知的断轴符号。
 * 只把最低刻度标成非零数字不算"可感知":观众读的是形状,不是刻度。
 * 画两道斜杠横跨轴脚,是这个符号最通用的写法。
 */
const AxisBreak: React.FC<{x: number; y: number; color: string}> = ({x, y, color}) => (
  <svg width={34} height={40} viewBox="0 0 34 40" style={{position: 'absolute', left: x - 17, top: y - 20}}>
    <line x1="6" y1="30" x2="26" y2="12" stroke={color} strokeWidth={3} strokeLinecap="round" />
    <line x1="6" y1="38" x2="26" y2="20" stroke={color} strokeWidth={3} strokeLinecap="round" />
  </svg>
);

const Inner: React.FC<PresetTrendChartProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const CANVAS = {w: landscape ? width : 1080, h: landscape ? height : 1920};
  const PLOT = landscape ? {top: height * .2, w: width * .55, h: height * .57} : {top: 780, w: 880, h: 620};
  const plotLeft = landscape ? width - PLOT.w - 80 : (CANVAS.w - PLOT.w) / 2;
  const {P, T} = useBaseline();
  const mark = variant?.mark ?? 'line';
  // 柱图强制零基线:长度即数值(chart-rules §2)。这里先短路掉,不给调用方犯错的机会
  const yScale = mark === 'bar' ? 'zero' : variant?.yScale ?? 'zero';
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const tuneScale = tune?.scale ?? 1;

  const dur = durationSeconds * fps;
  const values = parseNums(slots.values);
  const xRaw = parseLabels(slots.xLabels);
  // 坑 2:对不上就不画 x 刻度,不补空串
  const xLabels = xRaw.length === values.length ? xRaw : undefined;

  const progress = interpolate(frame, [PHASE.chartFrom * dur, PHASE.chartTo * dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });
  const headIn = interpolate(frame, [0, BEAT * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });
  const tailIn = interpolate(frame, [PHASE.chartTo * dur - BEAT * fps * 0.5, PHASE.chartTo * dur + BEAT * fps * 0.5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });

  const headSize = Math.round(
    Math.min(
      ...slots.headline
        .split('\n')
        .map((l) => fitFontSize(l, {fontSize: 88, maxWidthPx: landscape ? width * .32 : CANVAS.w - PAD * 2, shrinkFloorPx: 52})),
    ) * tuneScale,
  );

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  const yDomain: [number, number] =
    yScale === 'zero' ? [Math.min(0, lo), hi + span * 0.12] : [lo - span * 0.25, hi + span * 0.18];

  const fmt = (v: number) => {
    const s = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10);
    return slots.unit ? `${s}${slots.unit}` : s;
  };

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden', fontFamily: tuneFont}}>
      <Backdrop />
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 90 : 250} /> : null}

      {/* 主角:结论句。最大字号承担当前节拍的信息(chart-rules 口播档) */}
      <EditableText as="div" part="headline"
        style={{
          position: 'absolute',
          left: PAD,
          right: PAD,
          top: landscape ? 220 : 400,
          width: landscape ? width * .32 : undefined,
          ...textStyle(T, 'h1'),
          fontSize: headSize,
          lineHeight: 1.18,
          color: P.ink,
          opacity: 0.55 + 0.45 * headIn,
          transform: `translateY(${(tune?.y ?? 0) + 10 * (1 - headIn)}px)`,
        }}
      >
        {slots.headline.split('\n').map((l, i) => (
          <React.Fragment key={l}>
            {i > 0 ? <br /> : null}
            {l}
          </React.Fragment>
        ))}
      </EditableText>

      {/* 图只负责作证。轴/网格由 ChartStage 在 progress=0 时就画好
          (chart-rules §4:轴和网格先于数据出现,否则前几帧的点没有参照系) */}
      <div style={{position: 'absolute', left: plotLeft, top: PLOT.top}}>
        <ChartStage
          editorParts
          typography={T}
          palette={P}
          series={[{id: 'main', name: slots.seriesName, values, mark}]}
          progress={progress}
          width={PLOT.w}
          height={PLOT.h}
          {...(xLabels ? {xLabels} : {})}
          yDomain={yDomain}
          yFormat={fmt}
          yTicks={3}
          strokeWidth={7}
        />
      </div>
      {yScale === 'tight' ? (
        <AxisBreak x={plotLeft + 26} y={PLOT.top + PLOT.h - 52} color={alpha(P.inkMuted, 0.85)} />
      ) : null}

      {slots.note ? (
        <EditableText as="div" part="note"
          style={{
            position: 'absolute',
            left: PAD,
            right: PAD,
            top: landscape ? height * .65 : 1560,
            width: landscape ? width * .32 : undefined,
            ...textStyle(T, 'body'),
            fontSize: 46,
            lineHeight: 1.45,
            color: alpha(P.ink, 0.78),
            opacity: tailIn,
          }}
        >
          {slots.note}
        </EditableText>
      ) : null}
      {slots.source ? (
        <EditableText as="div" part="source"
          style={{
            position: 'absolute',
            left: PAD,
            right: PAD,
            top: landscape ? height - 100 : 1760,
            ...textStyle(T, 'caption'),
            fontSize: 26,
            color: alpha(P.inkMuted, 0.6),
            opacity: tailIn,
          }}
        >
          {slots.source}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

export const PresetTrendChart: React.FC<PresetTrendChartProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
