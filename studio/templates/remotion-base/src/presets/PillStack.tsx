import {EditorScene, EditorBackground} from '../editor/preset-editing';
// presets/PillStack.tsx —— 胶囊标签堆叠 preset(docs/presets/pill-stack/preset.json)
//
// 学习来源:高高lindsey VZ8qrng2nIo t10.7(参考帧 docs/reference/text-overlay/lindsey-pill-stack.jpg):
// 口播讲到第几条,左侧就浮出第几个白胶囊标签——比切独立 b-roll 自然,因为人一直在场。
//
// 形态是**双通道 overlay**:默认透明底,渲成带 alpha 的 hevc.mov 后用户在剪映里
// 叠到自己的口播上、自己挪位置躲开人脸。所以这里有两条别的 preset 没有的纪律:
// - bg=transparent 时**不渲 Foreground/Backdrop**(颗粒和暗角会把用户的实拍压脏);
// - 胶囊配色不走皮肤的暗色面板,而是「白胶囊 + 深强调色字」——它要叠在未知画面上,
//   白底深字是对任何实拍都成立的组合(Lindsey 原片同款)。色相仍从 skin.accentHue 派生。
// - preview=true(控制台预览通道传入)时垫一层深灰演播室底,不然 mp4 预览是死黑。
//
// 槽位 items 每条:「标签文字」或「标签文字 | 出现秒数」。没写秒数的按 BEAT(0.9s)接力。
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER, CALM, progress, BEAT} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';
import type {ElementStyle} from '../editor/types';

export type PresetPillStackProps = {
  durationSeconds: number;
  /** "1080x1920"(默认)| "1920x1080"。Root 的 calculateMetadata 据此定画布 */
  canvas?: string;
  /** 控制台预览通道传 true:透明底垫深灰演播室底,别的场合不要传 */
  preview?: boolean;
  variant?: {align?: 'left' | 'right'; bg?: 'transparent' | 'scene'};
  slots: {items: string[]; title?: string};
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    x?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
  elements?: Record<string, ElementStyle>;
};

const editorBoxStyle = (style?: ElementStyle): React.CSSProperties => {
  if (!style) return {};
  const css: React.CSSProperties = {};
  for (const key of ['width', 'backgroundColor', 'borderRadius', 'padding'] as const) if (style[key] !== undefined) (css as any)[key] = style[key];
  if (style.x !== undefined || style.y !== undefined) css.translate = `${style.x ?? 0}px ${style.y ?? 0}px`;
  return css;
};

const editorTextStyle = (style?: ElementStyle): React.CSSProperties => {
  if (!style) return {};
  const css: React.CSSProperties = {};
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'color'] as const) if (style[key] !== undefined) (css as any)[key] = style[key];
  if (style.fontFamily === 'Inter' || style.fontFamily === 'Archivo') css.fontFamily = `${style.fontFamily}, "Noto Sans SC"`;
  return css;
};

/** 「标签 | 秒」→ {text, at}。秒数解析不出就 undefined(走默认接力) */
const parseItem = (raw: string): {text: string; at?: number} => {
  const m = /^(.*?)\s*\|\s*([\d.]+)\s*$/.exec(raw);
  if (m && Number.isFinite(Number(m[2]))) return {text: m[1], at: Number(m[2])};
  return {text: raw};
};

const Inner: React.FC<PresetPillStackProps> = ({durationSeconds, preview, variant, slots, tune, elements}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const {P, T, skin} = useBaseline();
  const landscape = width > height;
  const align = variant?.align ?? 'left';
  const bg = variant?.bg ?? 'transparent';
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  // 白胶囊 + 深强调色字(叠在任何实拍上都成立;色相跟 accentHue 旋钮走)
  const pillBg = oklch(0.985, 0.004, skin.accentHue);
  const pillInk = oklch(0.42, 0.13, skin.accentHue);

  const items = (slots.items ?? []).map(parseItem);
  // 默认时间轴:0.4s 起每 BEAT 一条;写了秒数的条目用自己的
  const times = items.map((it, i) => it.at ?? 0.4 + i * BEAT);

  const fontSize = Math.round((landscape ? 46 : 44) * tuneScale);
  const maxTextW = landscape ? 480 : 420;
  const pillH = Math.round(fontSize * 2.0);
  const gap = Math.round(pillH * 0.34);
  const padX = Math.round(fontSize * 0.85);

  // 逐条估宽定字号(超宽先缩,缩到 26 仍超宽则硬失败——宁可红灯不出溢出)
  const sized = items.map((it) => ({
    ...it,
    size: Math.round(fitFontSize(it.text, {fontSize, maxWidthPx: maxTextW, shrinkFloorPx: 26})),
  }));

  const stackH = items.length * pillH + (items.length - 1) * gap + (slots.title ? pillH : 0);
  const top = Math.round(height / 2 - stackH / 2) + (tune?.y ?? 0);
  const sideBase = landscape ? 96 : 72;
  const sidePad = sideBase + (tune?.x ?? 0);

  const titleIn = progress(frame, 0, Math.round(0.3 * fps), ENTER);

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <EditorBackground>{bg === 'scene' ? (
        <EditorScene style={{backgroundColor: P.bg}}>
          <Backdrop />
        </EditorScene>
      ) : preview ? (
        // 透明底的预览垫层:深灰演播室底 + 中心微光,提示「这里将是你的画面」
        <AbsoluteFill
          style={{
            background: `radial-gradient(90% 60% at 50% 45%, #232329 0%, #141417 100%)`,
          }}
        />
      ) : null}</EditorBackground>

      <div
        style={{
          position: 'absolute',
          top,
          ...(align === 'left' ? {left: sidePad} : {right: sidePad}),
          display: 'flex',
          flexDirection: 'column',
          alignItems: align === 'left' ? 'flex-start' : 'flex-end',
          gap,
        }}
      >
        {slots.title ? (
          <div data-editor-part="title"
            style={{
              ...textStyle(T, 'caption'),
              ...(tuneFont ? {fontFamily: tuneFont} : {}),
              color: pillBg,
              textShadow: `0 2px 14px ${alpha('#000000', 0.5)}`,
              marginBottom: Math.round(gap * 0.4),
              opacity: titleIn * (elements?.title?.opacity ?? 1),
              transform: `translateY(${8 * (1 - titleIn)}px)`, ...editorBoxStyle(elements?.title), ...editorTextStyle(elements?.title),
            }}
          >
            {slots.title}
          </div>
        ) : null}
        {sized.map((it, i) => {
          const itemEdit = elements?.[`item-${i}`];
          const flexibleText = itemEdit?.width !== undefined || itemEdit?.fontSize !== undefined || itemEdit?.lineHeight !== undefined;
          const startF = Math.round(times[i] * fps);
          // 透明度先到(0.25s),位移稳稳落(0.3s CALM),配一点点 scale——
          // 只做「浮现」,不做弹跳:标签是旁白的注脚,不是主角
          const o = progress(frame, startF, Math.round(0.25 * fps), ENTER);
          const m = progress(frame, startF, Math.round(0.3 * fps), CALM);
          return (
            <div data-editor-part={`item-${i}`}
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={{
                height: flexibleText ? 'auto' : pillH,
                minHeight: pillH,
                borderRadius: pillH / 2,
                background: pillBg,
                display: 'flex',
                alignItems: 'center',
                padding: `0 ${padX}px`,
                boxSizing: 'border-box',
                // 落影是 overlay 与实拍的分界线:没有它白胶囊会「印」在画面上而不是「浮」在画面前
                boxShadow: `0 ${Math.round(pillH * 0.12)}px ${Math.round(pillH * 0.4)}px ${alpha('#000000', 0.22)}`,
                opacity: o * (itemEdit?.opacity ?? 1),
                transform: `translateY(${16 * (1 - m)}px) scale(${0.97 + 0.03 * m})`, ...editorBoxStyle(itemEdit),
              }}
            >
              <div
                style={{
                  ...textStyle(T, 'label'),
                  ...(tuneFont ? {fontFamily: tuneFont} : {}),
                  fontSize: it.size,
                  lineHeight: 1,
                  color: pillInk,
                  whiteSpace: flexibleText ? 'normal' : 'pre',
                  overflowWrap: flexibleText ? 'anywhere' : undefined,
                  ...editorTextStyle(itemEdit),
                }}
              >
                {it.text}
              </div>
            </div>
          );
        })}
      </div>
      {bg === 'scene' ? <Foreground quiet /> : null}
    </AbsoluteFill>
  );
};

export const PresetPillStack: React.FC<PresetPillStackProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
