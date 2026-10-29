import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/KeyConcept.tsx —— 关键概念强调卡 preset(docs/presets/key-concept/preset.json)
//
// 定位:口播提到关键概念时的固定出场画面(用户点名的第一模板)。
// 画面 = 深色渐变底(网格点质感)+ 深色强调色板承托 + 关键词大字 + 西文小标 + 一句带
// 记号笔高亮的解释。所有颜色/字体从风格皮肤(style/baseline.tsx)取,组件零 hex。
//
// 时序(timing is frozen,绝对秒):
//   0.00s  底+色板已在(首帧不淡入,无黑帧)
//   0.07s  关键词上浮入场 0.4s,唯一弹簧名额:入场收尾 1.5% 过冲(springAccents=1)
//   0.33s  西文小标左滑淡入 0.33s
//   0.60s  解释句上浮淡入 0.4s
//   0.87s  记号笔色带从左到右扫过高亮词 0.47s
//   之后 hold 静止(克制;时长伸缩全部落在 hold)
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {
  useBaseline,
  Backdrop,
  AccentSlab,
  Eyebrow,
  Foreground,
  textStyle,
  alpha,
} from '../style/baseline';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER} from '../lib/anim';

export type PresetKeyConceptProps = {
  durationSeconds: number;
  variant?: Record<string, never>;
  slots: {
    term: string;
    en?: string;
    sentence?: string;
    highlight?: string;
    eyebrow?: string;
  };
  /** 打磨旋钮(Studio 试玩用):调到满意把值发给主 agent,固化进皮肤/preset 升版本。
   *  生产合同里**不写**这个字段——风格统一靠皮肤,不靠逐镜手调。 */
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    x?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

/** 字体库速查(assets/library + public/fonts 的 8 款里适合当标题的 6 种组合) */
export const TUNE_FONTS: Record<string, string | undefined> = {
  skin: undefined, // 皮肤默认(当前 kit 的 display 栈)
  smiley: `'Smiley Sans', 'Noto Sans SC', sans-serif`, // 得意黑:8° 斜切,冲劲
  archivo: `'Archivo', 'Noto Sans SC', sans-serif`, // 干净硬朗的现代无衬线
  serif: `'Instrument Serif', 'Noto Serif SC', serif`, // 西文衬线 + 宋体
  wenkai: `'LXGW WenKai', 'Noto Serif SC', serif`, // 霞鹜文楷:手写楷体,人味
  'noto-serif': `'Noto Serif SC', serif`, // 思源宋体:正统编辑感
};

const seg = (frame: number, fromSec: number, durSec: number, fps: number) =>
  interpolate(frame, [fromSec * fps, (fromSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

/** 解释句:highlight 是 sentence 的子串时,拆三段给中间上记号笔色带 */
const Sentence: React.FC<{sentence: string; highlight?: string; band: number}> = ({
  sentence,
  highlight,
  band,
}) => {
  const {P} = useBaseline();
  const idx = highlight ? sentence.indexOf(highlight) : -1;
  if (!highlight || idx < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, idx)}
      <span
        style={{
          color: P.ink,
          background: `linear-gradient(0deg, ${alpha(P.accent, 0.38)} 0%, ${alpha(P.accent, 0.38)} 100%) no-repeat 0 72%`,
          backgroundSize: `${band * 100}% 0.42em`,
          padding: '0 0.12em',
        }}
      >
        {highlight}
      </span>
      {sentence.slice(idx + highlight.length)}
    </>
  );
};

const Inner: React.FC<PresetKeyConceptProps> = ({slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const {P, T, pad, slab} = useBaseline();
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  const termIn = seg(frame, 0.07, 0.4, fps);
  // 唯一弹簧名额:关键词入场的 1.5% 过冲
  const termSpring = spring({frame: frame - Math.round(0.07 * fps), fps, config: {damping: 16, stiffness: 130, mass: 0.9}});
  const enIn = seg(frame, 0.33, 0.33, fps);
  const sentenceIn = seg(frame, 0.6, 0.4, fps);
  const band = seg(frame, 0.87, 0.47, fps);

  const termLines = slots.term.split('\n');
  const termSize = Math.min(
    ...termLines.map((line) => fitFontSize(line, {fontSize: 185, maxWidthPx: landscape ? width * 0.45 : 936, shrinkFloorPx: 120})),
  );

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* 色板从 640 高收到 400。原来它占了画面的 1/3、转 8° 之后视觉上接近半屏,
          于是"画框比内容大"——用户 2026-08-15 点名的就是这一块。
          色板的作用是给关键词一个承托,不是给画面刷一层漆:它只需要包住关键词那两行。 */}
      <AccentSlab top={landscape ? height * 0.33 : 690} height={landscape ? 350 : 460} {...(landscape ? {left: 54, width: width * 0.49} : {})} />
      {/* 眉题一律「不填就不显示」。**不许给它兜底文案** —— 「关键概念 · KEY CONCEPT」
          这类词是在向观众解释这一镜是什么,而观众看一眼就知道。
          用户 2026-08-15:「这些表达太多了…要像乔布斯的 ppt,简单直接高级」 */}
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 100 : 220} /> : null}
      <div
        style={{
          position: 'absolute',
          top: (landscape ? height * 0.39 : 766) + (tune?.y ?? 0),
          left: pad + (tune?.x ?? 0),
          paddingLeft: '0.14em',
          opacity: 0.2 + 0.8 * termIn,
          transform: `translateY(${36 * (1 - termIn)}px) scale(${0.985 + 0.015 * termSpring})`,
          transformOrigin: 'left center',
        }}
      >
        <EditableText as="div" part="term"
          style={{
            ...textStyle(T, 'hero'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: Math.round(termSize * tuneScale),
            color: slab.ink,
            lineHeight: 1.04,
          }}
        >
          {termLines.map((line, i) => (
            <React.Fragment key={line}>
              {i > 0 ? <br /> : null}
              {line}
            </React.Fragment>
          ))}
        </EditableText>
      </div>
      {slots.en ? (
        <EditableText as="div" part="en"
          style={{
            position: 'absolute',
            top: landscape ? height * 0.79 : 1215,
            left: pad + 8,
            ...textStyle(T, 'label'),
            color: alpha(slab.ink, 0.82),
            opacity: enIn,
            transform: `translateX(${-16 * (1 - enIn)}px)`,
          }}
        >
          {slots.en}
        </EditableText>
      ) : null}
      {slots.sentence ? (
        <EditableText as="div" part="sentence"
          style={{
            position: 'absolute',
            top: landscape ? height * 0.39 : 1420,
            left: landscape ? width * 0.56 : pad,
            right: pad,
            ...textStyle(T, 'body'),
            color: P.inkSecondary,
            lineHeight: 1.6,
            opacity: sentenceIn,
            transform: `translateY(${20 * (1 - sentenceIn)}px)`,
          }}
        >
          {slots.sentence.split('\n').map((line, i) => (
            <React.Fragment key={line}>
              {i > 0 ? <br /> : null}
              <Sentence sentence={line} highlight={slots.highlight} band={band} />
            </React.Fragment>
          ))}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetKeyConcept: React.FC<PresetKeyConceptProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
