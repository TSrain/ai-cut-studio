import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {createTypography, textStyle, palette, alpha} from '../lib/theme';
import {ENTER, progress} from '../lib/anim';
import {LottieClip} from '../components/LottieClip';

// Lottie 在真实口播场景里的四种用法。样品册(LottieCatalog)回答"有哪些元素",
// 这一份回答"哪类镜头该放在哪个位置、多大、什么时候进"——挑元素容易,摆位置才是会翻车的地方。
//
//   npx remotion still LottieInScene --frame=80  review/scene-1.png   锚点位:关键概念
//   npx remotion still LottieInScene --frame=170 review/scene-2.png   度量位:数字趋势
//   npx remotion still LottieInScene --frame=260 review/scene-3.png   判据位:左右对照
//   npx remotion still LottieInScene --frame=350 review/scene-4.png   主体位:退让/停滞
//
// 四条通用规则(从这四张图里能直接看出来的):
// 1. 图标**永远晚于文字入场**——它是给已经出现的意思盖个章,不是自己当主角。delay ≥ 8 帧。
// 2. 尺寸跟着角色走:眉题旁的锚点 64–88,和大字并列的度量 96–120,当主体时 200+。
// 3. 一个画面**只放一个强调色**。图标吃了 accent,文字就不许再吃(第 3 张就是这么分的)。
// 4. 循环型(waiting/loop/signal)只在"这个状态还在持续"时用;叙事型播完停住就好,不要循环。

const typography = createTypography('impact');
const p = palette;

const PAGE = 90;

const Label: React.FC<{text: string; note: string}> = ({text, note}) => (
  <div style={{position: 'absolute', left: 96, bottom: 90}}>
    <div
      style={{
        ...textStyle(typography, 'caption'),
        fontFamily: typography.families.mono,
        color: p.accent,
        letterSpacing: '0.16em',
      }}
    >
      {text}
    </div>
    <div style={{...textStyle(typography, 'caption'), color: p.inkMuted, marginTop: 8}}>
      {note}
    </div>
  </div>
);

// ① 锚点位:图标贴在眉题旁,小、安静,只负责给这句话定性(这是个"风险"话题)
const SceneAnchor: React.FC = () => {
  const f = useCurrentFrame();
  const t = progress(f, 0, 16, ENTER);
  return (
    <AbsoluteFill style={{background: p.bg, padding: '220px 96px'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 20, opacity: t}}>
        <LottieClip name="risk" size={72} color={p.accent} durationInFrames={40} delay={10} />
        <div
          style={{
            ...textStyle(typography, 'label'),
            color: p.accent,
            letterSpacing: '0.14em',
          }}
        >
          代价 · COST
        </div>
      </div>
      <div
        style={{
          ...textStyle(typography, 'hero'),
          fontSize: 150,
          color: p.ink,
          marginTop: 48,
          opacity: progress(f, 6, 18, ENTER),
        }}
      >
        免费的
        <br />
        最贵
      </div>
      <div
        style={{
          ...textStyle(typography, 'body'),
          color: p.inkSecondary,
          marginTop: 44,
          maxWidth: 760,
          opacity: progress(f, 16, 18, ENTER),
        }}
      >
        你没付钱,不代表没付出——付的是注意力。
      </div>
      <Label text="ANCHOR / 锚点位  size 72  delay 10" note="贴眉题,给整句话定性;不抢大字" />
    </AbsoluteFill>
  );
};

// ② 度量位:图标和数字并排,承担"方向"这一份信息,数字只说大小
const SceneMetric: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: p.bg,
        padding: '220px 96px',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          ...textStyle(typography, 'label'),
          color: p.inkMuted,
          letterSpacing: '0.16em',
          opacity: progress(f, 0, 14, ENTER),
        }}
      >
        关键数字 · KEY NUMBER
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          marginTop: 36,
          opacity: progress(f, 6, 16, ENTER),
        }}
      >
        <LottieClip name="up" size={108} color={p.accent} durationInFrames={50} delay={12} />
        <div style={{...textStyle(typography, 'hero'), fontSize: 210, color: p.ink}}>
          3.4<span style={{fontSize: 96, color: p.inkSecondary}}> 倍</span>
        </div>
      </div>
      <div
        style={{
          ...textStyle(typography, 'body'),
          color: p.inkSecondary,
          marginTop: 40,
          maxWidth: 800,
          opacity: progress(f, 20, 18, ENTER),
        }}
      >
        同一条内容,配图版本的完播率
      </div>
      <Label text="METRIC / 度量位  size 108  loop" note="图标承担「方向」,数字只承担「大小」" />
    </AbsoluteFill>
  );
};

// ③ 判据位:左右各一个,把"哪边好"从文字里挪到图形上,观众 0.3 秒就分清
const SceneVerdict: React.FC = () => {
  const f = useCurrentFrame();
  const side = (
    label: string,
    text: string,
    icon: 'exclude' | 'confirm',
    good: boolean,
    delay: number,
  ) => (
    <div
      style={{
        flex: 1,
        padding: '52px 40px',
        borderRadius: 28,
        background: good ? alpha(p.accent, 0.1) : p.surface,
        border: `1px solid ${good ? p.accent : p.line}`,
        opacity: progress(f, delay, 16, ENTER),
      }}
    >
      <LottieClip
        name={icon}
        size={80}
        color={good ? p.accent : p.inkMuted}
        durationInFrames={36}
        delay={delay + 10}
      />
      <div
        style={{
          ...textStyle(typography, 'label'),
          color: good ? p.accent : p.inkMuted,
          marginTop: 26,
          letterSpacing: '0.12em',
        }}
      >
        {label}
      </div>
      <div style={{...textStyle(typography, 'h2'), color: p.ink, marginTop: 16}}>{text}</div>
    </div>
  );
  return (
    <AbsoluteFill
      style={{background: p.bg, padding: '220px 96px', justifyContent: 'center'}}
    >
      <div
        style={{
          ...textStyle(typography, 'label'),
          color: p.inkMuted,
          letterSpacing: '0.16em',
          marginBottom: 44,
          opacity: progress(f, 0, 14, ENTER),
        }}
      >
        对照 · CONTRAST
      </div>
      <div style={{display: 'flex', gap: 28, alignItems: 'stretch'}}>
        {side('旧做法', '每条都从零写', 'exclude', false, 4)}
        {side('新做法', '模板改参数', 'confirm', true, 14)}
      </div>
      <Label text="VERDICT / 判据位  size 80  双色" note="强调色只给「对」的一侧,错的一侧压成 muted" />
    </AbsoluteFill>
  );
};

// ④ 主体位:整个画面只有图标,用在口播说"这里要等/卡住了"的那两三秒
const SceneSubject: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: p.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 56,
      }}
    >
      <div style={{opacity: progress(f, 0, 18, ENTER)}}>
        <LottieClip
          name="waiting"
          size={240}
          color={p.inkSecondary}
          durationInFrames={60}
          delay={6}
        />
      </div>
      <div
        style={{
          ...textStyle(typography, 'h1'),
          color: p.ink,
          textAlign: 'center',
          opacity: progress(f, 18, 20, ENTER),
        }}
      >
        然后就没有然后了
      </div>
      <Label text="SUBJECT / 主体位  size 240  loop" note="退让镜:全屏只此一件事,图标本身就是画面" />
    </AbsoluteFill>
  );
};

export const LottieInScene: React.FC = () => (
  <AbsoluteFill style={{background: p.bg}}>
    <Sequence durationInFrames={PAGE}>
      <SceneAnchor />
    </Sequence>
    <Sequence from={PAGE} durationInFrames={PAGE}>
      <SceneMetric />
    </Sequence>
    <Sequence from={PAGE * 2} durationInFrames={PAGE}>
      <SceneVerdict />
    </Sequence>
    <Sequence from={PAGE * 3} durationInFrames={PAGE}>
      <SceneSubject />
    </Sequence>
  </AbsoluteFill>
);
