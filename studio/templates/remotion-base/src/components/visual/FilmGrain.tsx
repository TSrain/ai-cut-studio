import React from 'react';
import {useCurrentFrame} from 'remotion';
import {mulberry32} from './BackgroundSystem';

// 前景胶片颗粒:盖在**任意内容之上**的一层噪点(素材、截图、图表、其它组件都行)。
//
// 与 BackgroundSystem 的 `grain` variant 是两件事:那个会先铺一层不透明底场,
// 只能进 StageLayers 的 background 槽(见它的坑 7,那里点名说"要前景颗粒请单独写一层")。
// 这个不铺底,只出噪点,所以能当 foreground 用。
//
// 移植自 HyperFrames registry 的 `grain-overlay` component,但**动画方式重写了**:
// 原版是 `animation: hf-grain-noise 0.5s steps(1) infinite` 平移一张噪声图——
// CSS 动画是墙钟驱动的,在 Remotion 里重渲结果不一致、抽帧自查失去意义(design-principles §9)。
// 这里改成每帧从 `frame` 推导 feTurbulence 的 `seed`:同一帧永远算出同一张颗粒,
// 而且换的是**噪声本身**而不是平移一张图,更像真胶片(真颗粒是逐格重新分布的,不是滑动的)。
//
// 踩过的坑:
// 1. **filter 的 id 必须带 frame 和实例 seed。** 同一帧里放两层 FilmGrain,id 撞了会让
//    后一层静默套用前一层的滤镜——不报错,只是两层颗粒一模一样、叠出来是双倍密度。
// 2. **暗底上 `overlay` 等于没加,必须换 `soft-light` 或 `normal`。** 这条是实测撞出来的:
//    overlay 在底色明度 <0.5 时算的是 `2 × base × blend`,底色接近黑(本项目深色画面
//    bg 明度只有 0.17)时结果仍然接近黑 —— 颗粒被自己的混合模式吃掉了,渲出来和没加一样。
//    所以 `blend` 默认给 `soft-light`(暗底亮底都留得住),亮底/中间调想要更"打在光上"
//    的感觉再手动切 `overlay`。**判断方法是渲一张对照图,不是看代码觉得应该有效。**
// 3. **`opacity` 别超过 0.2。** 视频压缩最吃高频噪声,颗粒太重会让码率全花在噪点上,
//    人脸和文字反而糊掉。0.06–0.14 是安全区间。
//
// 用法: <FilmGrain intensity={0.1} />                 // 铺满父容器
//       <FilmGrain intensity={0.12} coarse={1.2} />   // 更粗的颗粒

export type FilmGrainProps = {
  /** 噪点强度 0–0.2。默认 0.1;>0.2 会吃掉码率(坑 3) */
  intensity?: number;
  /**
   * 颗粒粗细倍数,默认 1。
   * 内部基频 0.65 是 256px 噪声图的常用值;调大→颗粒更细,调小→更粗更"脏"。
   */
  coarse?: number;
  /** 静态颗粒(不逐帧换 seed)。做定格/海报感时用,默认 false */
  frozen?: boolean;
  /** 实例区分种子。同帧放多层时必须给不同值(坑 1) */
  seed?: number;
  /**
   * 混合模式,默认 `soft-light`。
   * 暗底(本项目深色画面)一律 soft-light 或 normal;overlay 在暗底上会被吃掉(坑 2)。
   */
  blend?: 'soft-light' | 'overlay' | 'normal';
  style?: React.CSSProperties;
};

export const FilmGrain: React.FC<FilmGrainProps> = ({
  intensity = 0.1,
  coarse = 1,
  frozen = false,
  seed = 1,
  blend = 'soft-light',
  style,
}) => {
  const frame = useCurrentFrame();
  // frozen 时锁在第 0 帧,否则逐帧换 seed —— 两种都只依赖 frame,任意一帧可独立算出
  const tick = frozen ? 0 : frame;
  const rnd = mulberry32(seed * 7919 + tick);
  const turbSeed = Math.floor(rnd() * 10000);
  const freq = (0.65 * coarse).toFixed(3);
  const id = `fg-grain-${seed}-${tick}`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        ...style,
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          inset: 0,
          mixBlendMode: blend, // 坑 2:暗底别用 overlay
          opacity: intensity,
        }}
      >
        <filter id={id} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={freq}
            numOctaves={3}
            seed={turbSeed}
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </svg>
    </div>
  );
};
