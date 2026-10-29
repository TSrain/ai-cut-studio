import React from 'react';
import {useCurrentFrame} from 'remotion';
import {MOVE, progress} from '../../lib/anim';

// 扫光:一道高光斜着扫过被包住的元素。用在"这个词/这个数字是重点"的那一下。
//
// 移植自 HyperFrames registry 的 `shimmer-sweep` component。原版靠 GSAP 补间
// CSS 变量 `--shimmer-pos`,这里改成 `frame` 推导——同一帧永远算出同一个位置。
//
// 什么时候**不要**用它:
// 整段文字都在扫、或者一个镜头里扫两次以上。扫光是"一次性强调",不是装饰纹理;
// 用多了就变成商城促销横幅。一镜最多一次,而且要落在文字已经安定之后
// (和 KeywordHighlight 的"色带后扫"是同一条道理)。
//
// 踩过的坑:
// 1. **`mixBlendMode: 'overlay'` 在纯黑底上几乎看不见。** overlay 是按底色明度调制的,
//    底越暗高光越弱。深色画面上要么把 `color` 调到接近纯白且提高 alpha,
//    要么改用 `blend='screen'`(screen 在暗底上最亮)。默认给 screen 就是这个原因。
// 2. **被包元素必须自己有尺寸。** 高光层是 `position:absolute; inset:0`,
//    父级塌成 0 高时整层不显示。所以外层写死了 `display:inline-block`,不要覆盖成 inline。
// 3. **别对整块卡片扫。** 面积一大,那道光就从"强调"变成"反光贴纸"。扫单行文字最好看。
// 4. **渐变的透明停靠点不能写 `transparent`。** CSS 里 `transparent` 就是 `rgba(0,0,0,0)`,
//    从它插值到白色高光会**经过一片深灰** —— 渲出来高光周围裹着一个发暗的方框,
//    边界还是硬的(实测在第 62 帧一眼看见)。必须用**同色零透明度**的停靠点
//    (白光就写 `rgba(255,255,255,0)`),下面 `fade()` 就是干这个的。
//    这条对所有"淡出到透明"的渐变都成立,不只是扫光。
//
// 用法: <ShimmerSweep delay={30}><span style={textStyle(t,'hero')}>3.4 倍</span></ShimmerSweep>

export type ShimmerSweepProps = {
  children: React.ReactNode;
  /** 起扫帧,默认 0。文字入场之后再扫 */
  delay?: number;
  /** 扫过用多少帧,默认 36(1.2 秒) */
  duration?: number;
  /** 高光颜色,默认接近纯白 */
  color?: string;
  /** 高光带宽度(百分比),默认 20 */
  width?: number;
  /** 扫过角度,默认 120deg */
  angle?: string;
  /** 混合模式。深色画面用 screen,浅色画面用 overlay(坑 1)。仅 mode='box' 有效 */
  blend?: 'screen' | 'overlay';
  /**
   * `text`(默认)= 高光只走**字形内部**,用 background-clip:text 裁出来;
   * `box` = 高光走整个矩形覆盖层(原 HyperFrames 版的做法)。
   *
   * **默认给 text 是因为 box 看起来是错的**(坑 5):覆盖层是个矩形,screen 混合会把
   * 整个矩形一起提亮,渲出来是"一块亮方块扫过文字",而不是"文字自己在反光"。
   * 只有想让一整块面板/卡片反光时才用 box。
   */
  mode?: 'text' | 'box';
  style?: React.CSSProperties;
};

/**
 * 把任意颜色变成"同色但全透明",用作渐变的淡出停靠点(坑 4)。
 * 认 `rgba()/rgb()` 和 `#rgb/#rrggbb`;认不出来时**退回白色透明**而不是 `transparent`,
 * 因为退回 transparent 正是这条坑本身。
 */
const fade = (c: string): string => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((v) => v.trim());
    return `rgba(${r}, ${g}, ${b}, 0)`;
  }
  const h = c.trim().replace('#', '');
  if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) {
    const full =
      h.length === 3
        ? h
            .split('')
            .map((x) => x + x)
            .join('')
        : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
  }
  return 'rgba(255, 255, 255, 0)';
};

/**
 * 坑 6:`background-clip:text` 要求**文字元素本身**是透明色,但 children 通常自带
 * `color`(textStyle 就带),内联样式覆盖不了子元素 → 那层复制文字渲成实心,
 * 把渐变整个盖住,看起来就是"扫光没生效"。必须用一条带 `!important` 的类规则,
 * 而 React 的 style 对象写不了 !important,所以只能注入 <style>。
 */
const CLIP_CLASS = 'hf-shimmer-clip';
const CLIP_CSS = `.${CLIP_CLASS}, .${CLIP_CLASS} * { color: transparent !important; }`;

export const ShimmerSweep: React.FC<ShimmerSweepProps> = ({
  children,
  delay = 0,
  duration = 36,
  color = 'rgba(255,255,255,0.75)',
  width = 20,
  angle = '120deg',
  blend = 'screen',
  mode = 'text',
  style,
}) => {
  const frame = useCurrentFrame();
  const k = progress(frame, delay, duration, MOVE);
  // -20% → 120%:两端都跑到画面外,保证起止时画面上没有半道光
  const pos = -20 + 140 * k;
  const half = width / 2;

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block', // 坑 2
        ...style,
      }}
    >
      {mode === 'text' ? <style>{CLIP_CSS}</style> : null}
      {children}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          // 坑 4:淡出停靠点用 fade(color),不是 transparent
          background: `linear-gradient(${angle}, ${fade(color)} 0%, ${fade(color)} ${
            pos - half
          }%, ${color} ${pos}%, ${fade(color)} ${pos + half}%, ${fade(color)} 100%)`,
          ...(mode === 'text'
            ? {WebkitBackgroundClip: 'text', backgroundClip: 'text'}
            : {mixBlendMode: blend}),
        }}
        className={mode === 'text' ? CLIP_CLASS : undefined}
      >
        {mode === 'text' ? children : null}
      </span>
    </span>
  );
};
