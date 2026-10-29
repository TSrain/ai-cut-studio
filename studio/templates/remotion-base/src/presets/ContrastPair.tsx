import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/ContrastPair.tsx —— 左右对照 preset(docs/presets/contrast-pair/preset.json)
//
// 定位:「旧 vs 新 / 不值得 vs 值得」。语义靠色承载:左=退灰(不值得),右=点亮(值得),
// 四变量同向叠加(灰/亮 + 缩 0.97/1 + 弱字/实字 + 无饰/accent 下划线)。
// 竖版双列律(taste.md C2):中线两侧各 40px 留白,左列右对齐、右列左对齐。
// 节奏律(taste.md C7,最高频复用):**对照两侧逐个出**——左 0.07s → 中线 0.4s →
// 中缝符号 0.63s(缩放无弹跳)→ 右 0.83s,绝不同时淡入。springAccents=0。
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {
  useBaseline,
  Backdrop,
  Eyebrow,
  Foreground,
  textStyle,
  alpha,
} from '../style/baseline';
import {fitFontSize} from '../style/fit';
import {ENTER} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';

export type PresetContrastPairProps = {
  durationSeconds: number;
  variant?: {symbol?: '≠' | '→' | 'VS'};
  slots: {
    leftLabel: string;
    leftText: string;
    rightLabel: string;
    rightText: string;
    eyebrow?: string;
  };
  /** 打磨旋钮(Studio 试玩用,生产合同不写) */
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

const seg = (frame: number, fromSec: number, durSec: number, fps: number) =>
  interpolate(frame, [fromSec * fps, (fromSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

const GAP = 80; // 中线两侧留白。taste.md C2 原律 40px,这里加宽到 80:中缝圆盘(半径 62)要在中线上 knockout,40px 会压住列文字
const CENTER = 540;

const Column: React.FC<{
  side: 'left' | 'right';
  label: string;
  text: string;
  progress: number;
  dim: boolean;
  tuneScale?: number;
  tuneFont?: string;
}> = ({side, label, text, progress, dim, tuneScale = 1, tuneFont}) => {
  const {P, T} = useBaseline();
  const {width, height} = useVideoConfig();
  const landscape = width > height;
  const center = width / 2;
  const gap = landscape ? 100 : GAP;
  const columnW = landscape ? center - gap - 96 : CENTER - GAP;
  const left = side === 'left';
  const textSize = Math.min(
    ...text.split('\n').map((l) => fitFontSize(l, {fontSize: 96, maxWidthPx: columnW - 48, shrinkFloorPx: 52})),
  );
  return (
    <div
      style={{
        position: 'absolute',
        top: landscape ? height * 0.34 : 800,
        left: left ? (landscape ? 96 : 0) : center + gap,
        width: columnW,
        display: 'flex',
        flexDirection: 'column',
        alignItems: left ? 'flex-end' : 'flex-start',
        textAlign: left ? 'right' : 'left',
        paddingLeft: left ? 48 : 0,
        paddingRight: left ? 0 : 48,
        gap: 26,
        opacity: progress,
        transform: `translateX(${(left ? -22 : 22) * (1 - progress)}px) scale(${dim ? 0.97 : 1})`,
        transformOrigin: left ? 'right center' : 'left center',
      }}
    >
      <EditableText as="div" part={`${side}Label`} style={{...textStyle(T, 'label'), color: dim ? P.inkMuted : P.accent}}>{label}</EditableText>
      <EditableText as="div" part={`${side}Text`}
        style={{
          ...textStyle(T, 'h2'),
          ...(tuneFont ? {fontFamily: tuneFont} : {}),
          fontSize: Math.round(textSize * tuneScale),
          lineHeight: 1.3,
          color: dim ? P.inkMuted : P.ink,
        }}
      >
        {text.split('\n').map((l, i) => (
          <React.Fragment key={l}>
            {i > 0 ? <br /> : null}
            {l}
          </React.Fragment>
        ))}
      </EditableText>
      {dim ? null : (
        <div style={{width: 120, height: 6, background: P.accent, borderRadius: 3, marginTop: 6}} />
      )}
    </div>
  );
};

const Inner: React.FC<PresetContrastPairProps> = ({variant, slots, tune}) => {
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const tuneScale = tune?.scale ?? 1;
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const center = width / 2;
  const {P, T} = useBaseline();
  const symbol = variant?.symbol ?? '≠';

  const leftIn = seg(frame, 0.07, 0.4, fps);
  const lineIn = seg(frame, 0.4, 0.4, fps);
  const discIn = seg(frame, 0.63, 0.33, fps);
  const rightIn = seg(frame, 0.83, 0.4, fps);

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop cool />
      {/* 眉题一律「不填就不显示」。**不许给它兜底文案** —— 「关键概念 · KEY CONCEPT」
          这类词是在向观众解释这一镜是什么,而观众看一眼就知道。
          用户 2026-08-15:「这些表达太多了…要像乔布斯的 ppt,简单直接高级」 */}
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 100 : 220} /> : null}
      <div style={{position: 'absolute', inset: 0, transform: `translateY(${tune?.y ?? 0}px)`}}>
      <Column side="left" label={slots.leftLabel} text={slots.leftText} progress={leftIn} dim tuneScale={tuneScale} tuneFont={tuneFont} />
      {/* 中线:自上而下画出(scaleY,transform-origin top) */}
      <div
        style={{
          position: 'absolute',
          top: landscape ? height * 0.18 : 640,
          left: center - 1,
          width: 2,
          height: landscape ? height * 0.64 : 640,
          background: alpha(P.line, 0.9),
          transform: `scaleY(${lineIn})`,
          transformOrigin: 'center top',
        }}
      />
      {/* 中缝符号:深底圆盘 knockout 遮住交叉处,缩放入场无弹跳(taste.md C6) */}
      <div
        style={{
          position: 'absolute',
          top: landscape ? height / 2 - 62 : 900,
          left: center - 62,
          width: 124,
          height: 124,
          borderRadius: '50%',
          background: P.surface,
          border: `1.5px solid ${P.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${0.6 + 0.4 * discIn})`,
          opacity: discIn,
        }}
      >
        <div style={{...textStyle(T, 'h2'), fontSize: symbol === 'VS' ? 40 : 62, color: P.accent}}>{symbol}</div>
      </div>
      <Column side="right" label={slots.rightLabel} text={slots.rightText} progress={rightIn} dim={false} tuneScale={tuneScale} tuneFont={tuneFont} />
      </div>
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetContrastPair: React.FC<PresetContrastPairProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
