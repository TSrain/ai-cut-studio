// brand-ink-open 复刻:抽自 video-shotcraft template/src/aifl/live/SceneOpen.tsx 帧 0–83 段。
// 墨色十字被无形笔画出 → 字标逐字凸版戳印(带琥珀下划闪光)→ mono kicker 打字机 →
// 整组静置约 1s → 上浮缩小溶出。83f@30fps,1920×1080。
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, Easing} from 'remotion';

const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const INK = 'oklch(18% 0.006 82)';
const AMBER = 'oklch(52% 0.115 65)';
const INK2 = 'oklch(50% 0.006 82)';

const WORDMARK = 'AI Foundation Lab';
const KICKER = 'TEAM RESEARCH CONSOLE';

export const BrandInkOpen: React.FC = () => {
  const frame = useCurrentFrame();

  const vDraw = interpolate(frame, [0, 9], [100, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const hDraw = interpolate(frame, [8, 18], [100, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.linear,
  });
  const crossFade = interpolate(frame, [24, 34], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const perChar = 0.7;
  const kickStart = 28;
  const kickChars = Math.floor(Math.max(0, frame - kickStart) / perChar);
  const kickDone = kickStart + KICKER.length * perChar;
  const cursorOn = (() => {
    if (frame < kickStart) return false;
    if (frame < kickDone) return true;
    if (frame > 74) return false;
    const b = frame - kickDone;
    return Math.floor(b / 2) % 2 === 0;
  })();

  const brandOut = interpolate(frame, [76, 83], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.5, 1),
  });
  const brandOpacity = 1 - brandOut;
  const groupY = -brandOut * 40;
  const groupScale = 1 - brandOut * 0.12;

  return (
    <AbsoluteFill style={{backgroundColor: '#faf7f2'}}>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity: brandOpacity}}>
        <div
          style={{
            textAlign: 'center',
            transform: `translateY(${groupY}px) scale(${groupScale})`,
            transformOrigin: 'center center',
          }}
        >
          <svg width={64} height={64} viewBox="0 0 64 64" style={{display: 'block', margin: '0 auto 34px', opacity: crossFade}}>
            <line x1={32} y1={2} x2={32} y2={62} stroke={AMBER} strokeWidth={5} strokeLinecap="round"
              pathLength={100} strokeDasharray={100} strokeDashoffset={vDraw} />
            <line x1={2} y1={32} x2={62} y2={32} stroke={AMBER} strokeWidth={5} strokeLinecap="round"
              pathLength={100} strokeDasharray={100} strokeDashoffset={hDraw} />
          </svg>

          <div
            style={{
              fontFamily: SERIF, fontSize: 132, fontWeight: 600, color: INK,
              letterSpacing: '-0.01em', lineHeight: 1, whiteSpace: 'pre',
              display: 'inline-flex', alignItems: 'flex-end',
            }}
          >
            {WORDMARK.split('').map((ch, i) => {
              const delay = 10 + i * 3;
              const t = interpolate(frame, [delay, delay + 12], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0.7, 0.25, 1),
              });
              const glintCenter = delay + 12;
              const glint = interpolate(frame, [glintCenter - 4, glintCenter, glintCenter + 4], [0, 1, 0], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });
              return (
                <span
                  key={i}
                  style={{
                    position: 'relative', display: 'inline-block', opacity: t,
                    transform: `scale(${1.6 - 0.6 * t})`, transformOrigin: 'center bottom',
                    filter: `blur(${(1 - t) * 6}px)`,
                  }}
                >
                  {ch === ' ' ? ' ' : ch}
                  <span
                    style={{
                      position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)',
                      width: `${glint * 100}%`, height: 2, background: AMBER, opacity: glint, borderRadius: 2,
                    }}
                  />
                </span>
              );
            })}
          </div>

          <div
            style={{
              fontFamily: MONO, fontSize: 26, letterSpacing: '0.14em', color: INK2,
              marginTop: 30, textTransform: 'uppercase', height: 30,
              display: 'flex', justifyContent: 'center', alignItems: 'center',
            }}
          >
            <span style={{whiteSpace: 'pre'}}>{KICKER.slice(0, kickChars)}</span>
            <span style={{display: 'inline-block', width: 14, height: 24, marginLeft: 4, background: AMBER, opacity: cursorOn ? 0.85 : 0}} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
