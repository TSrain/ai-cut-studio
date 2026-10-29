import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {ENTER, progress} from '../lib/anim';
import type {TypographyContext} from '../lib/theme';

// 程序化金属圆盘(硬币/徽章/奖章),零素材。
//
// 金属质感的四件套,缺一件就塌成"一个黄色圆圈":
// 1. **齿边**:repeating-conic-gradient 明暗小齿,一眼认出是硬币边缘。
// 2. **径向渐变偏心高光**:圆心偏左上(38% 30%),符合顶光。正中的渐变会显得很假。
// 3. **inset 双环**:内盘一圈略深描边 + 上明下暗的 inset 阴影,做出厚度。
// 4. **一次性斜向反光扫过**:入场时掠过一次就停。持续扫是装饰性循环闪光(§8 禁止)。
//
// 币面只放"表意"的符号(¥ / ★ / 数字),不要写具体信息——信息交给旁边的文字,
// 币面写字会和文字冗余(实拍教训:币面写「5角」+ 旁边写「不到5毛」= 重复)。

export type CoinTone = 'gold' | 'silver' | 'copper';

const TONES: Record<CoinTone, {edge: [string, string]; face: string; ring: string; glyph: string; glyphShadow: string}> = {
  gold: {
    edge: ['#e7c874', '#9a6c26'],
    face: 'radial-gradient(circle at 38% 30%, #fff2c8 0%, #f4ca5e 32%, #dca23e 60%, #ac7a2c 86%, #855c22 100%)',
    ring: '#b9862f',
    glyph: '#fbe28c',
    glyphShadow:
      '0 2px 1px rgba(86,56,16,0.75), 0 3px 4px rgba(60,38,10,0.45), 0 -1px 0 rgba(255,250,225,0.6)',
  },
  silver: {
    edge: ['#e4e6e9', '#83888f'],
    face: 'radial-gradient(circle at 38% 30%, #ffffff 0%, #dfe3e8 32%, #b9bfc7 60%, #8f959d 86%, #6f757c 100%)',
    ring: '#9aa1a9',
    glyph: '#f2f5f8',
    glyphShadow:
      '0 2px 1px rgba(50,55,62,0.7), 0 3px 4px rgba(40,44,50,0.4), 0 -1px 0 rgba(255,255,255,0.65)',
  },
  copper: {
    edge: ['#e0a173', '#8a4f24'],
    face: 'radial-gradient(circle at 38% 30%, #ffd9ba 0%, #e8a978 32%, #c8804c 60%, #9c5f31 86%, #7a4826 100%)',
    ring: '#a96a3a',
    glyph: '#ffd7b3',
    glyphShadow:
      '0 2px 1px rgba(80,44,20,0.75), 0 3px 4px rgba(60,32,14,0.45), 0 -1px 0 rgba(255,240,225,0.55)',
  },
};

export const MetalCoin: React.FC<{
  /** 字体套装,必填。币面符号用 display 角色,那是它该有的重量。 */
  typography: TypographyContext;
  /** 直径(px)。 */
  size: number;
  tone?: CoinTone;
  /** 币面符号,表意即可(¥ / $ / ★ / 1)。留空则是素面。 */
  face?: React.ReactNode;
  /** 反光扫过的起始帧。给 null 则不扫。 */
  sweepStart?: number | null;
  sweepDur?: number;
  style?: React.CSSProperties;
}> = ({
  typography,
  size,
  tone = 'gold',
  face,
  sweepStart = 0,
  sweepDur = 12,
  style,
}) => {
  const frame = useCurrentFrame();
  const t = TONES[tone];
  const r = size / 2;

  const sweep = sweepStart === null ? 0 : progress(frame, sweepStart, sweepDur, ENTER);
  const sweepX = interpolate(sweep, [0, 1], [-size * 1.13, size * 1.13]);
  // sin 包络:扫到中间最亮,两端为 0——避免高光在边缘生硬地出现/消失
  const sweepOpacity = sweepStart === null ? 0 : Math.sin(Math.min(1, sweep) * Math.PI) * 0.7;

  return (
    <div
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: '50%',
        position: 'relative',
        overflow: 'hidden',
        background: `repeating-conic-gradient(from 0deg, ${t.edge[0]} 0deg 5deg, ${t.edge[1]} 5deg 10deg)`,
        boxShadow:
          'inset 0 3px 6px rgba(255,255,255,0.4), inset 0 -6px 10px rgba(70,46,14,0.6), 0 6px 16px rgba(0,0,0,0.4)',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '9%',
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: t.face,
          boxShadow: `inset 0 0 0 3px ${t.ring}, inset 0 4px 10px rgba(255,255,255,0.35), inset 0 -10px 16px rgba(90,60,18,0.55)`,
        }}
      >
        {face !== undefined && face !== null ? (
          <span
            style={{
              fontFamily: typography.families.display,
              fontSize: r * 1.15,
              fontWeight: 900,
              lineHeight: 1,
              color: t.glyph,
              textShadow: t.glyphShadow,
              transform: 'translateY(-2%)',
            }}
          >
            {face}
          </span>
        ) : null}
        {/* 静态高光斑:金属才有的漫反射亮点,位置与径向渐变高光一致 */}
        <div
          style={{
            position: 'absolute',
            left: '18%',
            top: '12%',
            width: '34%',
            height: '24%',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 70%)',
            filter: 'blur(3px)',
          }}
        />
      </div>
      {sweepOpacity > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '-30%',
            left: '50%',
            width: '38%',
            height: '160%',
            transform: `translateX(${sweepX}px) rotate(20deg)`,
            background:
              'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 100%)',
            opacity: sweepOpacity,
            filter: 'blur(4px)',
          }}
        />
      )}
    </div>
  );
};
