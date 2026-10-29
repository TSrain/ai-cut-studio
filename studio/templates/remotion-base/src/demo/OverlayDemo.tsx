import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {createTypography, textStyle, palette} from '../lib/theme';
import {ENTER, progress} from '../lib/anim';
import {FilmGrain} from '../components/visual/FilmGrain';
import {Vignette} from '../components/visual/Vignette';
import {ShimmerSweep} from '../components/visual/ShimmerSweep';

// 三个前景叠加层的对照样张。改了 FilmGrain / Vignette / ShimmerSweep 就渲它:
//   npx remotion still OverlayDemo --frame=70 review/overlay.png
//
// 上下同一张素材,只有下半张加了 Vignette + FilmGrain。
// 这张图存在的意义是**证明差异看得出来**——叠加层最容易犯的错是"加了等于没加",
// 参数调到看不见就不如不写这层。

const typography = createTypography('modern');
const p = palette;

const Half: React.FC<{top: number; label: string; children?: React.ReactNode}> = ({
  top,
  label,
  children,
}) => (
  <div style={{position: 'absolute', top, left: 0, width: 1080, height: 700, overflow: 'hidden'}}>
    <Img
      src={staticFile('sample-wide.png')}
      style={{width: '100%', height: '100%', objectFit: 'cover'}}
    />
    {children}
    <div
      style={{
        position: 'absolute',
        left: 32,
        bottom: 26,
        zIndex: 120,
        ...textStyle(typography, 'caption'),
        fontFamily: typography.families.mono,
        color: '#ffffff',
        letterSpacing: '0.14em',
        textShadow: '0 2px 12px rgba(0,0,0,0.9)',
      }}
    >
      {label}
    </div>
  </div>
);

export const OverlayDemo: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: p.bg}}>
      <div
        style={{
          position: 'absolute',
          top: 54,
          left: 32,
          ...textStyle(typography, 'label'),
          color: p.accent,
          letterSpacing: '0.18em',
          opacity: progress(frame, 0, 12, ENTER),
        }}
      >
        前景叠加层 · 对照
      </div>

      <Half top={120} label="RAW — 无叠加层" />

      <Half top={860} label="+ VIGNETTE 0.8 + FILM GRAIN 0.18 soft-light">
        {/* 坑 3:Vignette 在下、FilmGrain 在上——颗粒要打在已经压暗的画面上 */}
        <Vignette strength={0.8} size="38%" />
        {/* 坑 2:暗底必须 soft-light,overlay 在这张黑底素材上等于没加(实测) */}
        <FilmGrain intensity={0.18} coarse={0.8} seed={3} blend="soft-light" />
      </Half>

      {/* 扫光单独一栏:只扫一行字,不扫整块;放在浅色条上才看得见高光 */}
      <div
        style={{
          position: 'absolute',
          top: 1620,
          left: 0,
          width: 1080,
          height: 230,
          background: p.surfaceRaised,
          borderTop: `1px solid ${p.line}`,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 40,
          opacity: progress(frame, 20, 16, ENTER),
        }}
      >
        <ShimmerSweep delay={40} duration={40} width={34} color="rgba(255,255,255,0.98)">
          <span style={{...textStyle(typography, 'h1'), color: p.accent}}>扫光强调 3.4 倍</span>
        </ShimmerSweep>
      </div>
    </AbsoluteFill>
  );
};
