import {useManagedPresetExit} from '../presets/PresetExit';
import {presetExit} from '../presets/preset-exit.mjs';
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {createTypography, textStyle} from '../lib/fonts';
import {TuneSkin, type SkinTune} from '../style/tune';
import {useBaseline} from '../style/baseline';
import {fitFontSize} from '../style/fit';
import {TUNE_FONTS} from '../presets/KeyConcept';
import type {ElementStyle} from './types';

/** Extracted from SC-0030 D Navigation: fixed rows, overview→current title, local alpha panel. */
export type ChapterNavigationProps = {
  durationSeconds: number;
  canvas?: string;
  preview?: boolean;
  slots: {title?: string; items: string[]; activeIndex: number; activateAt: number};
  variant?: {align?: 'left' | 'right'; bg?: 'transparent' | 'scene'};
  tune?: SkinTune & {font?: keyof typeof TUNE_FONTS; scale?: number; x?: number; y?: number};
  elements?: Record<string, ElementStyle>;
};
const T = createTypography('modern');
const C = {bg: '#101214', line: '#41484f', ink: '#f2f4f5', muted: '#a6adb5', accent: '#90aac3'};
const ease = (value: number) => {const p = Math.max(0, Math.min(1, value)); return p * p * (3 - 2 * p);};
const numeral = (index: number) => ['一', '二', '三', '四', '五', '六', '七', '八'][index] ?? String(index + 1);
const elementStyle = (style: ElementStyle = {}): React.CSSProperties => {
  const {x, y, ...css} = style;
  return {...css, ...(style.fontFamily === 'Inter' || style.fontFamily === 'Archivo' ? {fontFamily: `${style.fontFamily}, "Noto Sans SC"`} : {}), ...(x !== undefined || y !== undefined ? {translate: `${x ?? 0}px ${y ?? 0}px`} : {})};
};
const Inner: React.FC<ChapterNavigationProps> = ({durationSeconds, preview, slots, variant, tune, elements}) => {
  const managedExit = useManagedPresetExit();
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const {P} = useBaseline();
  const time = frame / fps;
  const items = slots.items;
  if (!items.length || items.length > 8 || !Number.isInteger(slots.activeIndex) || slots.activeIndex < 0 || slots.activeIndex >= items.length) throw new Error('章节导航需要 1–8 条章节，当前章节索引必须在列表内');
  const enter = ease((time - .12) / .4), exit = presetExit(frame, fps, durationSeconds).progress, change = ease((time - slots.activateAt) / .44);
  const tuned = Boolean(tune?.skin || tune?.accentHue !== undefined || tune?.neutralHue !== undefined);
  const palette = tuned ? {bg: P.bg, line: P.line, ink: P.ink, muted: P.inkSecondary, accent: P.accent} : C;
  const panelHeight = 182 + items.length * 70;
  const fit = Math.min(width / 1920, height / 1080);
  const unitScale = width > height ? fit : width / 1080;
  const scale = unitScale * (tune?.scale ?? 1);
  const left = (width > height ? 100 * fit : 64 * unitScale) + (tune?.x ?? 0);
  const top = (width > height ? 174 * fit : 174 * unitScale) + (tune?.y ?? 0);
  const font = TUNE_FONTS[tune?.font ?? 'skin'];
  const display: React.CSSProperties = {...textStyle(T, 'h1'), ...(font ? {fontFamily: font} : {}), position: 'absolute', left: 30, top: 30, width: 480, lineHeight: 1.12, letterSpacing: '-.025em', fontWeight: 750, color: palette.ink};
  const currentTitle = `${numeral(slots.activeIndex)}、${items[slots.activeIndex]}`;
  const title = slots.title ?? `${items.length} 类任务`;
  const titleSize = fitFontSize(title, {fontSize: 94, maxWidthPx: 480, shrinkFloorPx: 30});
  const currentSize = fitFontSize(currentTitle, {fontSize: 66, maxWidthPx: 480, shrinkFloorPx: 30});
  const panelEdit = elements?.panel ?? {};
  return <AbsoluteFill style={{background: variant?.bg === 'scene' || preview ? palette.bg : 'transparent', pointerEvents: 'none'}}>
    <div data-editor-part="panel" style={{position: 'absolute', ...(variant?.align === 'right' ? {right: left - 2 * (tune?.x ?? 0)} : {left}), top: top + (24 * (1 - enter) - 8 * exit) * unitScale, width: 540, height: panelHeight, background: 'rgba(16,20,25,.76)', border: '1px solid rgba(220,232,241,.18)', borderRadius: 18, boxShadow: '0 12px 28px rgba(0,0,0,.32)', transform: `scale(${scale})`, transformOrigin: `${variant?.align ?? 'left'} top`, pointerEvents: 'auto', ...elementStyle(panelEdit), opacity: enter * (managedExit ? 1 : 1 - exit) * (panelEdit.opacity ?? 1)}}>
      <div data-editor-part="title" style={{...display, fontSize: titleSize, ...elementStyle(elements?.title), opacity: (1 - change) * (elements?.title?.opacity ?? 1), transform: `translateY(${-18 * change}px)`}}>{title}</div>
      <div data-editor-part="currentTitle" style={{...display, fontSize: currentSize, top: 44, ...elementStyle(elements?.currentTitle), opacity: change * (elements?.currentTitle?.opacity ?? 1), transform: `translateY(${18 * (1 - change)}px)`}}>{currentTitle}</div>
      <div style={{position: 'absolute', left: 30, top: 143, width: 480, height: 1, background: palette.line}} />
      {items.map((name, index) => {
        const active = index === slots.activeIndex ? change : 0;
        const entry = ease((time - (.4 + index * .1)) / .35);
        const edit = elements?.[`item-${index}`] ?? {};
        const rowSize = fitFontSize(`${numeral(index)}　${name}`, {fontSize: 44, maxWidthPx: 450, shrinkFloorPx: 24});
        return <div key={index} style={{position: 'absolute', left: 24, top: 161 + index * 70 + 8 * (1 - entry), width: 492, height: 64, opacity: entry}}>
          <div style={{position: 'absolute', inset: 0, borderRadius: 8, background: palette.accent, opacity: .12 * active}} />
          <div style={{position: 'absolute', left: 0, top: 16, width: 3, height: 32, background: palette.accent, opacity: active}} />
          <div data-editor-part={`item-${index}`} style={{...textStyle(T, 'body'), ...(font ? {fontFamily: font} : {}), position: 'absolute', left: 22, top: 6, fontSize: rowSize, fontWeight: 550, lineHeight: 1.15, color: palette.muted, ...elementStyle(edit)}}>{numeral(index)}　{name}<span aria-hidden style={{position: 'absolute', inset: 0, color: edit.color ?? palette.ink, opacity: active}}>{numeral(index)}　{name}</span></div>
        </div>;
      })}
    </div>
  </AbsoluteFill>;
};
export const ChapterNavigation: React.FC<ChapterNavigationProps> = (props) => <TuneSkin tune={props.tune}><Inner {...props} /></TuneSkin>;
