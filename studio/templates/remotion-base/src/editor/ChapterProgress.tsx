import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {useBaseline, alpha, textStyle} from '../style/baseline';
import type {ElementStyle} from './types';

export type EditorChapter = {id: string; title: string; startFrame: number; endFrame: number; sourceCueIds: string[]};
export type ChapterProgressProps = {
  chapters: EditorChapter[];
  hiddenIntervals?: {startFrame: number; endFrame: number}[];
  thickness?: number;
  showLabels?: boolean;
  gap?: number;
  completedColor?: string;
  activeColor?: string;
  futureColor?: string;
  variant?: {align?: 'left' | 'right'; bg?: 'scene' | 'transparent'};
  tune?: {x?: number; y?: number; scale?: number};
  elements?: Record<string, ElementStyle>;
  globalFrame?: number;
};

const elementCss = (style?: ElementStyle): React.CSSProperties => {
  if (!style) return {};
  const css: React.CSSProperties = {};
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'width', 'color', 'opacity', 'backgroundColor', 'borderRadius', 'padding'] as const) if (style[key] !== undefined) (css as any)[key] = style[key];
  if (style.fontFamily === 'Inter' || style.fontFamily === 'Archivo') css.fontFamily = `${style.fontFamily}, "Noto Sans SC"`;
  if (style.x !== undefined || style.y !== undefined) css.translate = `${style.x ?? 0}px ${style.y ?? 0}px`;
  return css;
};

export const ChapterProgress: React.FC<ChapterProgressProps> = ({chapters, hiddenIntervals = [], thickness = 8, showLabels = true, gap = 6, completedColor = '#697386', activeColor = '#f2a93b', futureColor = '#303746', variant, tune, elements, globalFrame}) => {
  const localFrame = useCurrentFrame();
  const frame = globalFrame ?? localFrame;
  const {P, T} = useBaseline();
  if (!chapters.length || hiddenIntervals.some((span) => frame >= span.startFrame && frame < span.endFrame)) return null;
  const total = Math.max(1, chapters.reduce((sum, chapter) => sum + Math.max(0, chapter.endFrame - chapter.startFrame), 0));
  const align = variant?.align ?? 'left';
  return <AbsoluteFill style={{pointerEvents: 'none', backgroundColor: variant?.bg === 'scene' ? alpha(P.bg, 0.94) : undefined}}>
    <div style={{position: 'absolute', left: align === 'left' ? 64 : 180, right: align === 'right' ? 64 : 180, bottom: 72 + (tune?.y ?? 0), translate: `${tune?.x ?? 0}px 0`, scale: tune?.scale ?? 1, transformOrigin: `${align} bottom`, pointerEvents: 'auto'}}>
      {showLabels ? <div style={{display: 'flex', gap, marginBottom: 12}}>{chapters.map((chapter) => {
        const duration = Math.max(0, chapter.endFrame - chapter.startFrame);
        const edited = elements?.[chapter.id];
        return <div key={chapter.id} style={{flex: `${duration} 1 0`, minWidth: 0}}><div data-editor-part={chapter.id} style={{...textStyle(T, 'caption'), color: frame >= chapter.startFrame ? P.ink : P.inkSecondary, overflow: edited?.width === undefined ? 'hidden' : 'visible', textOverflow: edited?.width === undefined ? 'ellipsis' : undefined, whiteSpace: edited?.width === undefined ? 'nowrap' : 'normal', overflowWrap: edited?.width === undefined ? undefined : 'anywhere', ...elementCss(edited)}}>{chapter.title}</div></div>;
      })}</div> : null}
      <div data-editor-part="bar" style={{display: 'flex', gap, height: thickness, ...elementCss(elements?.bar)}}>{chapters.map((chapter) => {
        const duration = Math.max(0, chapter.endFrame - chapter.startFrame);
        const progress = Math.max(0, Math.min(1, (frame - chapter.startFrame) / Math.max(1, duration)));
        return <div key={chapter.id} style={{position: 'relative', flex: `${duration / total} 1 0`, borderRadius: thickness, overflow: 'hidden', background: futureColor}}><div style={{position: 'absolute', inset: 0, width: `${progress * 100}%`, background: frame >= chapter.endFrame ? completedColor : activeColor}} /></div>;
      })}</div>
    </div>
  </AbsoluteFill>;
};
