// 点阵底纹。**画面底不该是纯色**——纯色底在视频里会读作"没做完",
// 而可见的网格线又会读作"工程图纸"。点阵是这两者之间的那一档:有肌理,不抢焦点。
//
// 参数来自实测(docs/reference/INDEX.md,所长林超《超指数分化世界》1280×720 源):
//
//   底色 rgb(0,3,9)  ← **不是纯黑**,带一点冷蓝
//   点间距 13–15px @1280 宽  → 换算 1080 宽画布 ≈ 12px
//   点径   1–2px(连通簇 1–4 像素) → ≈ 1.5px
//   点色   rgb(2,6,12) ~ rgb(10,14,20),比底色亮 **+3 ~ +11**(0–255 标度)
//   覆盖率 纯背景区 1.51% 像素高于底色
//
// **这一层的全部要点是"几乎看不见"。** 亮度差个位数;做成能看清的点就变装饰了,
// 那就撞上 design-principles §8 的氛围装饰禁令。调参时唯一的判据:
// 缩略图测试(缩到 320px 宽)时它应该完全消失,全尺寸下只贡献"底子不空"的感觉。
//
// 用 SVG <pattern> 而不是几千个 <circle>:点数在 1080×1920 下是 90×160=14400 个,
// 逐个渲染会拖慢每一帧;pattern 由浏览器平铺,成本恒定。
import React from 'react';

export const DotField: React.FC<{
  /** 画布宽高。取 useVideoConfig() 的值传进来 */
  width: number;
  height: number;
  /** 点色。默认取比底色亮几点的中性色;想跟随主色相时传 palette.line */
  color?: string;
  /** 点间距(px)。1080 宽画布默认 12;画布更大时按比例放大,别让点变稀 */
  gap?: number;
  /** 点半径(px)。默认 0.75(直径 1.5) */
  radius?: number;
  /**
   * 不透明度。**默认 0.55 已经是上限区**——实测原片亮度差只有 +3~+11,
   * 调到 1.0 会让点清晰可见,那就不是肌理是装饰了。
   */
  opacity?: number;
  /** 相位偏移(px)。多层叠加时错开,避免摩尔纹 */
  offsetX?: number;
  offsetY?: number;
  /** 唯一 id 前缀。同一帧里放多个 DotField 时必须给不同值,否则 pattern id 撞车 */
  id?: string;
}> = ({
  width,
  height,
  color = 'rgba(190, 214, 255, 0.09)',
  gap = 12,
  radius = 0.75,
  opacity = 0.55,
  offsetX = 0,
  offsetY = 0,
  id = 'dotfield',
}) => {
  const pid = `${id}-pattern`;
  return (
    <svg
      width={width}
      height={height}
      style={{position: 'absolute', left: 0, top: 0, opacity, pointerEvents: 'none'}}
      aria-hidden
    >
      <defs>
        <pattern
          id={pid}
          x={offsetX}
          y={offsetY}
          width={gap}
          height={gap}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={gap / 2} cy={gap / 2} r={radius} fill={color} />
        </pattern>
      </defs>
      <rect width={width} height={height} fill={`url(#${pid})`} />
    </svg>
  );
};

/**
 * 四角框(corner brackets)。参考片里**每一个 b-roll 帧都有这一层**——
 * 一个成本近乎为零的元素,把全片插片缝成一个整体。
 * 这就是 visual-language.md §2 说的"签名元素"该长的样子:不抢戏,但一眼认得出是同一支片子。
 *
 * 注意:它是**画面边框**不是内容框,所以要贴在安全区外沿,别和内容抢位置。
 */
export const CornerBrackets: React.FC<{
  width: number;
  height: number;
  /** 到画布边的内缩(px) */
  inset?: number;
  /** 每个角的臂长(px) */
  arm?: number;
  color?: string;
  strokeWidth?: number;
  opacity?: number;
}> = ({
  width,
  height,
  inset = 28,
  arm = 46,
  color = 'currentColor',
  strokeWidth = 2.5,
  opacity = 1,
}) => {
  const l = inset;
  const r = width - inset;
  const t = inset;
  const b = height - inset;
  const d = [
    `M ${l} ${t + arm} L ${l} ${t} L ${l + arm} ${t}`, // 左上
    `M ${r - arm} ${t} L ${r} ${t} L ${r} ${t + arm}`, // 右上
    `M ${l} ${b - arm} L ${l} ${b} L ${l + arm} ${b}`, // 左下
    `M ${r - arm} ${b} L ${r} ${b} L ${r} ${b - arm}`, // 右下
  ];
  return (
    <svg
      width={width}
      height={height}
      style={{position: 'absolute', left: 0, top: 0, opacity, pointerEvents: 'none', color}}
      aria-hidden
    >
      {d.map((path) => (
        <path
          key={path}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="square"
        />
      ))}
    </svg>
  );
};
