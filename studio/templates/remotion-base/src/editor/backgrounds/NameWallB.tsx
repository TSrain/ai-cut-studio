import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

export type NameWallBProps = {
  name: string;
  color: string;
  ink: string;
  strength: number;
  blur: number;
  speed: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/**
 * Ink-plane candidate: gently inclined print with a defocused, distant echo.
 * All distances use the short edge / 1080. SVG pattern translation is periodic
 * in its exact tile width, so long compositions cannot run out of repeated text.
 * The host owns font loading; the fallback explicitly covers Chinese glyphs.
 */
export const NameWallB: React.FC<NameWallBProps> = ({
  name,
  color,
  ink,
  strength,
  blur,
  speed,
}) => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const id = `name-wall-b-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const unit = Math.min(width, height) / 1080;
  const amount = clamp(strength, 0, 1);
  const seconds = (frame / fps) * clamp(speed, 0, 2);
  const softness = clamp(blur, 0, 20) * unit;
  const label = name.trim();
  // Approximate optical advance, then give the cell generous breathing room.
  // textLength fixes the repetition width independent of font fallback metrics.
  const emLength = Array.from(label).reduce((length, glyph) => {
    if (/\s/u.test(glyph)) return length + 0.32;
    return length + (/[^\u0000-\u007f]/u.test(glyph) ? 1 : 0.59);
  }, 0);
  const fontSize = 116 * unit;
  const textWidth = Math.max(fontSize, emLength * fontSize);
  const tileWidth = textWidth + 102 * unit;
  const rowHeight = 164 * unit;
  const tileHeight = rowHeight * 4;
  const margin = Math.max(width, height) * 0.55;
  const layers = [
    {key: 'far', size: 1.43, opacity: 0.115, velocity: -9, y: -0.7 * rowHeight, soft: softness + 5.5 * unit},
    {key: 'print', size: 1, opacity: 0.43, velocity: 19, y: 0, soft: softness},
  ];

  return (
    <AbsoluteFill style={{backgroundColor: color, overflow: 'hidden', pointerEvents: 'none'}}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-quiet`} cx="50%" cy="49%" r="64%">
            <stop offset="0%" stopColor="white" stopOpacity={0.23} />
            <stop offset="35%" stopColor="white" stopOpacity={0.43} />
            <stop offset="76%" stopColor="white" stopOpacity={0.94} />
            <stop offset="100%" stopColor="white" stopOpacity={0.62} />
          </radialGradient>
          <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
            <rect width={width} height={height} fill={`url(#${id}-quiet)`} />
          </mask>
          <radialGradient id={`${id}-light`} cx="19%" cy="13%" r="80%">
            <stop offset="0%" stopColor={ink} stopOpacity={0.04 * amount} />
            <stop offset="65%" stopColor={ink} stopOpacity={0.008 * amount} />
            <stop offset="100%" stopColor={ink} stopOpacity={0} />
          </radialGradient>
          {layers.map((layer) => (
            <pattern
              key={layer.key}
              id={`${id}-${layer.key}`}
              width={tileWidth}
              height={tileHeight}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${(seconds * layer.velocity * unit) % (tileWidth * layer.size)} ${layer.y}) scale(${layer.size})`}
            >
              {[0, 1, 2, 3].map((row) => {
                const stagger = [0, 0.47, 0.14, 0.62][row] * tileWidth;
                return [-1, 0, 1].map((column) => (
                  <text
                    key={`${row}-${column}`}
                    x={column * tileWidth + stagger}
                    y={row * rowHeight + 125 * unit}
                    fill={ink}
                    opacity={[0.86, 0.63, 1, 0.72][row]}
                    fontFamily={'Archivo, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'}
                    fontSize={fontSize}
                    fontWeight={800}
                    textLength={textWidth}
                    lengthAdjust="spacingAndGlyphs"
                  >
                    {label}
                  </text>
                ));
              })}
            </pattern>
          ))}
        </defs>
        <rect width={width} height={height} fill={`url(#${id}-light)`} />
        <g mask={`url(#${id}-mask)`}>
          {layers.map((layer) => (
            <g key={layer.key} opacity={layer.opacity * amount} style={{filter: `blur(${layer.soft}px)`}}>
              <rect
                x={-margin}
                y={-margin}
                width={width + margin * 2}
                height={height + margin * 2}
                fill={`url(#${id}-${layer.key})`}
                transform={`rotate(-7 ${width / 2} ${height / 2})`}
              />
            </g>
          ))}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
