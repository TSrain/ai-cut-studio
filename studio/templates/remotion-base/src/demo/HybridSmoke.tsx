import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame} from 'remotion';
import {createTypography, textStyle} from '../lib/fonts';
import {alpha, scenePalette} from '../lib/color';
import {safeVertical} from '../lib/theme';
import {ENTER, EXIT, progress} from '../lib/anim';

/**
 * Hybrid 桥接的烟雾镜头(docs/hybrid-bridge.md)。
 *
 * 它演示的是**分工**,不是效果:
 *   - 景观层(渐变、网格、辉光、环弧)由 HyperFrames 渲染,规范化后落到 public/hybrid-bg.mp4;
 *   - 精确层(文字、数据、时间)由 Remotion 在上面叠,帧号驱动、可逐帧求值。
 *
 * 坑 1:背景视频必须走 `OffthreadVideo`,不是 `<Video>`。`<Video>` 在渲染进程里靠
 *       HTMLVideoElement 的 seek,长镜头会漂帧;OffthreadVideo 由 ffmpeg 按帧号取帧,
 *       和 useCurrentFrame() 严格对齐——Hybrid 的整个前提就是这个对齐。
 * 坑 2:`objectFit: 'cover'` 必须显式写。OffthreadVideo 默认按原始像素铺,
 *       背景比合成大一点点就会露出错位的边,而这种偏移在单帧上很难看出来。
 * 坑 3:合成的 durationInFrames 不能超过背景视频的帧数,超出的部分背景会定格在最后一帧
 *       (画面不会报错,只是突然不动了)。这里 150 帧 = 5.0s,与 HyperFrames 侧一致。
 * 坑 4:背景是别人的画面,亮度不可控。文字底下必须有一层自己的压暗(scrim),
 *       否则换一版背景就可能把标题吃掉——这是 Hybrid 最常见的返工原因。
 */

// 字体套装显式选择:短视频标题要硬,用 impact(中文走得意黑 Smiley Sans)。
const typography = createTypography('impact');

// 配色跟着 HyperFrames 层走:蓝色中性 + 琥珀强调,两层才像同一张图而不是两张贴一起。
const palette = scenePalette(65, 'dark', {neutralHue: 250});

// 揭示窗口:12→32 帧全部出完,一直保持到 130 帧,之后退场。
const REVEAL_IN = 12;
const HOLD_UNTIL = 130;
const EXIT_DUR = 18;

/** 一行文字的帧驱动揭示:上移 + 自下而上开幕 + 淡入,130 帧后统一淡出。 */
const RevealLine: React.FC<{
  frame: number;
  delay: number;
  dur: number;
  style: React.CSSProperties;
  children: React.ReactNode;
}> = ({frame, delay, dur, style, children}) => {
  const p = progress(frame, delay, dur, ENTER);
  const out = progress(frame, HOLD_UNTIL, EXIT_DUR, EXIT);
  return (
    <div
      style={{
        ...style,
        opacity: p * (1 - out),
        // clip-path 自下而上开幕:比单纯淡入更"锐",不会有半透明的糊感
        clipPath: `inset(0% 0% ${(1 - p) * 100}% 0%)`,
        transform: `translateY(${(1 - p) * 36}px)`,
        willChange: 'transform, opacity',
      }}
    >
      {children}
    </div>
  );
};

export const HybridSmoke: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: palette.bg}}>
      {/* ——— 景观层:HyperFrames 出的成片,满幅铺底 ——— */}
      <OffthreadVideo
        src={staticFile('hybrid-bg.mp4')}
        style={{width: '100%', height: '100%', objectFit: 'cover'}}
      />

      {/* ——— 压暗层:只压顶部 0–32%,保证精确层的对比度 ———
          渐变必须在背景自己的内容开始之前(y≈595,即 31%)归零。
          压过头会把 HyperFrames 的画面一起洗灰——第一版就是这么翻车的:
          背景的白色主标题被压成了灰色,两层看着都脏。 */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${alpha(palette.bg, 0.9)} 0%, ${alpha(
            palette.bg,
            0.72,
          )} 20%, ${alpha(palette.bg, 0)} 32%)`,
        }}
      />

      {/* ——— 精确层:Remotion 出的文字,全部由帧号推导 ———
          右上角对齐,不是随便摆的:HyperFrames 那一层的重量全压在中下偏左,
          精确层放右上才是对角平衡;跟着一起挤左上会变成两摞标题打架(第一版的实际问题)。
          可用竖向空间只有 220(安全区)→ 555(背景自己的标题开始),
          所以这里只放两级:label + hero。塞第三级必然压到背景的字上。 */}
      <AbsoluteFill
        style={{
          paddingTop: safeVertical.top + 20,
          paddingLeft: safeVertical.x,
          paddingRight: safeVertical.x,
          alignItems: 'flex-end',
          textAlign: 'right',
        }}
      >
        <RevealLine
          frame={frame}
          delay={REVEAL_IN}
          dur={10} /* 12 → 22 帧 */
          style={{
            ...textStyle(typography, 'label'),
            color: palette.accent,
            marginBottom: 18,
            textShadow: `0 2px 18px ${alpha(palette.bg, 0.9)}`,
          }}
        >
          REMOTION · 文字 / 数据 / 时间
        </RevealLine>

        <RevealLine
          frame={frame}
          delay={REVEAL_IN + 6}
          dur={14} /* 18 → 32 帧,整块揭示恰好落在 12–32 窗口内 */
          style={{
            ...textStyle(typography, 'hero'),
            color: palette.ink,
            textShadow: `0 6px 40px ${alpha(palette.bg, 0.92)}`,
          }}
        >
          精确层
        </RevealLine>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
