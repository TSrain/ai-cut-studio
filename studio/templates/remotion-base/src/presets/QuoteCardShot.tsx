import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/QuoteCardShot.tsx —— 引用卡 preset(docs/presets/quote-card/preset.json)
//
// 定位:引用原话上屏(推文/访谈/论文句)。原句逐字上屏不改写;来源与"作者换算"类
// 小字条层级明确弱于原句。卡片几何(微旋 -1.6°/圆角/描边/大引号水印)由皮肤冻结。
// 时序(绝对秒):0s 底+卡 30% 已在(无黑帧)→ 卡上浮 0.5s → 引文逐行 stagger 0.12s
// → 1.0s 小字条入场 → hold 静止。
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {
  useBaseline,
  Backdrop,
  QuoteCard,
  AuthorNote,
  Foreground,
  textStyle,
} from '../style/baseline';
import {ENTER} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';

export type PresetQuoteCardProps = {
  durationSeconds: number;
  variant?: {tone?: 'warm' | 'cool'};
  slots: {
    quote: string;
    source?: string;
    note?: string;
    noteTag?: string;
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

const Inner: React.FC<PresetQuoteCardProps> = ({variant, slots, tune}) => {
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const {P, T} = useBaseline();
  const cool = variant?.tone === 'cool';

  const cardIn = seg(frame, 0, 0.5, fps);
  const noteIn = seg(frame, 1.0, 0.4, fps);
  const lines = slots.quote.split('\n');

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop cool={cool} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.3 + 0.7 * cardIn,
          transform: `translateY(${28 * (1 - cardIn) + (tune?.y ?? 0)}px)`,
        }}
      >
        <QuoteCard top={landscape ? height * .22 : 540} minHeight={landscape ? height * .44 : undefined} source={slots.source} cool={cool}>
          <EditableText as="div" part="quote" style={{...textStyle(T, 'body'), ...(tuneFont ? {fontFamily: tuneFont} : {}), fontSize: Math.round((landscape ? 56 : 41) * (tune?.scale ?? 1)), lineHeight: 1.58, color: cool ? P.inkSecondary : P.ink}}>
            {lines.map((line, i) => {
              const lineIn = seg(frame, 0.33 + 0.12 * i, 0.33, fps);
              return (
                <div key={line} style={{opacity: lineIn, transform: `translateY(${12 * (1 - lineIn)}px)`}}>
                  {line}
                </div>
              );
            })}
          </EditableText>
        </QuoteCard>
      </div>
      {slots.note ? (
        <div style={{opacity: noteIn, transform: `translateX(${-14 * (1 - noteIn)}px)`}}>
          <AuthorNote top={landscape ? height * .81 : 1180} text={slots.note} tag={slots.noteTag ?? '作者换算'} />
        </div>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetQuoteCard: React.FC<PresetQuoteCardProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
