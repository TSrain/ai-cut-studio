import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import {EXIT} from '../lib/anim';
import {createTypography, ink, seriesDark, surface, type} from '../lib/theme';
import {LineChartReveal} from '../components/LineChartReveal';
import {NumberTicker} from '../components/NumberTicker';
import {TextReveal} from '../components/TextReveal';

// 演示合成:8 秒数据解释动画,同时充当模板自检
// 场 1 (0-3s): 主数字滚动 —— 结论先行
// 场 2 (3-8s): 折线展开解释增长来源

const HERO_END = 90;

// 数据解释片:数字是主角,用 tech-data(data 角色落到 JetBrains Mono)。
const typography = createTypography('tech-data');

const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [HERO_END - 12, HERO_END], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EXIT,
  });
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: 1 - out,
        transform: `scale(${1 + out * 0.05})`,
      }}
    >
      <TextReveal delay={6}>
        <div
          style={{
            fontFamily: typography.families.body,
            fontSize: type.label,
            color: ink.muted,
            letterSpacing: 8,
          }}
        >
          2025 年度
        </div>
      </TextReveal>
      <div
        style={{
          fontFamily: typography.families.data,
          fontSize: type.hero,
          fontWeight: 700,
          color: ink.primary,
          lineHeight: 1.1,
        }}
      >
        <NumberTicker
          to={240}
          delay={12}
          dur={42}
          format={(n) => `+${Math.round(n)}%`}
        />
      </div>
      <TextReveal delay={42}>
        <div
          style={{
            fontFamily: typography.families.body,
            fontSize: type.h2,
            color: ink.secondary,
          }}
        >
          收入增长
        </div>
      </TextReveal>
    </AbsoluteFill>
  );
};

const ChartScene: React.FC = () => {
  return (
    <AbsoluteFill
      style={{justifyContent: 'center', alignItems: 'center', gap: 48}}
    >
      <TextReveal delay={4}>
        <div
          style={{
            fontFamily: typography.families.display,
            fontSize: type.h1,
            fontWeight: 650,
            color: ink.primary,
          }}
        >
          增长来自入口业务
        </div>
      </TextReveal>
      <LineChartReveal
        typography={typography}
        data={[3.2, 3.4, 3.9, 4.6, 5.8, 7.4, 9.9, 10.9]}
        width={1280}
        height={480}
        color={seriesDark[0]}
        delay={14}
        dur={50}
        label="¥10.9 亿"
      />
      <TextReveal delay={80}>
        <div
          style={{
            fontFamily: typography.families.body,
            fontSize: type.body,
            color: ink.secondary,
          }}
        >
          入口便利性,比单纯的模型能力更重要
        </div>
      </TextReveal>
    </AbsoluteFill>
  );
};

export const DataExplainer: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{backgroundColor: surface.dark, fontFamily: typography.families.body}}
    >
      <Sequence durationInFrames={HERO_END}>
        <Hero />
      </Sequence>
      <Sequence
        from={HERO_END - 2}
        premountFor={interpolate(frame, [228], [0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp"
        })}>
        <ChartScene />
      </Sequence>
    </AbsoluteFill>
  );
};
