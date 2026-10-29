import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {createTypography, textStyle, palette} from '../lib/theme';
import {ENTER, progress} from '../lib/anim';
import {LottieClip, ICON_META, type LottieIconName} from '../components/LottieClip';

// Lottie 图标样品册:24 个外来动效重着色后摆一屏,用来渲帧目视验收。
// 改了 public/lottie/ 或 LottieClip.tsx 就渲这两页看一眼:
//   npx remotion still LottieCatalog --frame=80  review/lottie-a.png
//   npx remotion still LottieCatalog --frame=170 review/lottie-b.png
//
// **每页 90 帧不是随手定的**:最后一个格子的延迟是 23*2=46 帧,加上 45 帧动画 = 91 帧。
// 页长必须 ≥ 这个数,否则末几个图标在抽帧时还没播完,样品册里看到的是残图
// (第一版页长 60,`spread` 和 `revise` 就是这么变成两根断线的)。抽帧点取页尾。

const typography = createTypography('modern');
const p = palette;

const PAGE_A: LottieIconName[] = [
  'confirm', 'exclude', 'discard',
  'approve', 'risk', 'alert',
  'question', 'waiting', 'loop',
  'signal', 'tune', 'up',
];

const PAGE_B: LottieIconName[] = [
  'down', 'next', 'search',
  'explore', 'reveal', 'save',
  'spread', 'schedule', 'locked',
  'revise', 'rate', 'like',
];

// 有实心填充区域的几个:填充走强调色能做出"描边中性 + 内核强调"的双色。
// 其余图标是纯描边,给了 fillColor 也没有落点。
const ACCENT_FILL = new Set<LottieIconName>(['approve', 'save', 'rate', 'like']);

const Cell: React.FC<{name: LottieIconName; index: number}> = ({name, index}) => {
  const frame = useCurrentFrame();
  const appear = progress(frame, index * 2, 12, ENTER);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        opacity: appear,
      }}
    >
      <div
        style={{
          width: 240,
          height: 200,
          borderRadius: 20,
          background: p.surface,
          border: `1px solid ${p.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LottieClip
          name={name}
          size={112}
          color={p.ink}
          fillColor={ACCENT_FILL.has(name) ? p.accent : p.ink}
          durationInFrames={45}
          delay={index * 2}
        />
      </div>
      <div
        style={{
          ...textStyle(typography, 'caption'),
          color: p.inkSecondary,
          textAlign: 'center',
          lineHeight: 1.4,
        }}
      >
        {ICON_META[name].means}
      </div>
      <div
        style={{
          ...textStyle(typography, 'caption'),
          fontSize: 19,
          color: p.inkMuted,
          fontFamily: typography.families.mono,
        }}
      >
        {name}
        {ICON_META[name].reverse ? ' ↺' : ''}
      </div>
    </div>
  );
};

const Page: React.FC<{names: LottieIconName[]; title: string}> = ({names, title}) => (
  <AbsoluteFill style={{background: p.bg, padding: '150px 60px'}}>
    <div
      style={{
        ...textStyle(typography, 'label'),
        color: p.accent,
        letterSpacing: '0.18em',
        marginBottom: 44,
      }}
    >
      {title}
    </div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        rowGap: 44,
        columnGap: 20,
      }}
    >
      {names.map((n, i) => (
        <Cell key={n} name={n} index={i} />
      ))}
    </div>
    <div
      style={{
        ...textStyle(typography, 'caption'),
        fontSize: 20,
        color: p.inkMuted,
        marginTop: 'auto',
      }}
    >
      ↺ = 默认倒放(原素材是 toggle,正放会停在语义的反面)
    </div>
  </AbsoluteFill>
);

export const LottieCatalog: React.FC = () => (
  <AbsoluteFill style={{background: p.bg}}>
    <Sequence durationInFrames={90}>
      <Page names={PAGE_A} title="LOTTIE · 判断 / 状态 / 趋势" />
    </Sequence>
    <Sequence from={90} durationInFrames={90}>
      <Page names={PAGE_B} title="LOTTIE · 方向 / 检索 / 留存 / 评价" />
    </Sequence>
  </AbsoluteFill>
);
