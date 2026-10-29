import React, {createContext, useContext} from 'react';
import {AbsoluteFill} from 'remotion';
import type {ElementStyle} from './types';

type Editing = {elements?: Record<string, ElementStyle>; background?: 'original' | 'transparent'};
const Context = createContext<Editing>({});

/** Editor-only overrides travel through the same React tree in Player and render. */
export const PresetEditingProvider: React.FC<Editing & {children: React.ReactNode}> = ({elements, background, children}) => (
  <Context.Provider value={{elements, background}}>{children}</Context.Provider>
);
export const useTransparentBackground = () => useContext(Context).background === 'transparent';
export const useElementEdits = () => useContext(Context).elements ?? {};
export const useElementEdit = (part: string) => useContext(Context).elements?.[part];

export const mergeElementStyle = (base: React.CSSProperties = {}, edit?: ElementStyle): React.CSSProperties => {
  if (!edit || !Object.keys(edit).length) return base;
  const result = {...base};
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'width', 'color', 'backgroundColor', 'borderRadius', 'padding'] as const) {
    if (edit[key] !== undefined) (result as any)[key] = edit[key];
  }
  if (edit.fontFamily === 'Inter' || edit.fontFamily === 'Archivo') result.fontFamily = `${edit.fontFamily}, "Noto Sans SC"`;
  if (edit.opacity !== undefined) result.opacity = Number(base.opacity ?? 1) * edit.opacity;
  if (edit.x !== undefined || edit.y !== undefined) {
    // Independent CSS translate composes with the existing animated transform.
    if (base.translate && base.translate !== 'none') result.transform = `translate(${edit.x ?? 0}px, ${edit.y ?? 0}px) ${base.transform ?? ''}`.trim();
    else result.translate = `${edit.x ?? 0}px ${edit.y ?? 0}px`;
  }
  return result;
};

type TextProps = {as?: 'div' | 'span' | 'text'; part: string; style?: React.CSSProperties; children?: React.ReactNode; [key: string]: any};
/** This is the actual DOM/SVG text node, not a post-render selector or mutation. */
export const EditableText: React.FC<TextProps> = ({as = 'div', part, style, children, ...rest}) => {
  const edit = useElementEdit(part);
  const base = edit?.opacity !== undefined && style?.opacity === undefined && rest.opacity !== undefined ? {...style, opacity: rest.opacity} : style;
  const css = mergeElementStyle(base, edit);
  if (as === 'span' && edit && (edit.x !== undefined || edit.y !== undefined) && (!css.display || css.display === 'inline')) css.display = 'inline-block';
  return React.createElement(as, {...rest, 'data-editor-part': part || undefined, style: css}, children);
};

/** Only scene decoration is removed; callers keep card fills, images and video. */
export const EditorBackground: React.FC<{children: React.ReactNode}> = ({children}) => useTransparentBackground() ? null : <>{children}</>;
export const EditorScene: React.FC<React.ComponentProps<typeof AbsoluteFill>> = ({style, ...props}) => {
  const transparent = useTransparentBackground();
  return <AbsoluteFill {...props} style={transparent ? {...style, background: 'transparent', backgroundColor: 'transparent', backgroundImage: 'none'} : style} />;
};
