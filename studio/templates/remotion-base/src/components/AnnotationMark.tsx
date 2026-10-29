import React from 'react';
import {useCurrentFrame} from 'remotion';
import {MOVE, progress} from '../lib/anim';

// 批注笔迹:在一个矩形目标上"当场画"出人手批注——红笔下划线 / 荧光笔描字 / 手绘圈 / 方框。
// 典型用法是挂在 KenBurns 的 overlay 里,给截图上的关键字做勾选(ScreenPush preset 就是这么用的)。
//
// 三条硬约束,违反哪条都会毁掉这个手法:
// 1. **笔迹必须画出来**(strokeDashoffset 从 1 走到 0),不是淡入一张已经画好的批注。
//    观众要看到"有人拿笔划了这里"的动作,那才是勾选的意义。
// 2. **手绘感靠确定性抖动**,全部来自固定相位的 sin 叠加(seed 可调),没有 Math.random——
//    任意一帧可独立算出,重渲逐帧一致(设计原则 §9)。
// 3. **坐标不许目测**。box 是目标的像素矩形,来源必须是 docs/locate-protocol.md 的网格法
//    (tools/locate.mjs),目测平均误差 6.5%,画出来的线会骑到别的字上。
//
// 踩过的坑:
// - dashoffset=1 时 round linecap 会在起点留一个圆点,像还没画就滴了一滴墨——
//   所以 frame < delay 时直接不渲染,而不是渲一个"进度为 0"的路径。
// - marker(荧光笔)用 mixBlendMode:'multiply':白底上是经典荧光笔效果(文字透出来),
//   即使混合失效也只是 50% 透明色带,文字仍可读。深色截图上荧光笔本来就不成立,
//   深底请用 underline / circle / box(红笔系),或换 ink 颜色。
// - 笔迹粗细跟着目标高度走(strokeWidth 默认由 box.h 换算),组件放进 KenBurns 的
//   图像坐标系后会随镜头缩放——这是对的:推近时字变大,笔迹也该成比例变粗。

export type AnnotationMarkStyle = 'underline' | 'marker' | 'circle' | 'box';

/** 批注墨色是"戏中物"(纸上真实笔迹),不是 UI 配色令牌——与 KeywordHighlight 的默认记号笔色同一性质。 */
export const ANNOTATION_INK = {
  red: 'rgba(224, 49, 38, 0.92)',
  yellow: 'rgba(255, 208, 51, 0.5)',
} as const;

type Box = {x: number; y: number; w: number; h: number};

const fmt = (n: number) => n.toFixed(1);

/**
 * 红笔下划线:一笔**近直线**——整条只允许一个极浅的弓 + 收笔轻微下坠。
 * 第一版抖动给到 ±0.54sw、双频叠加,用户一眼看出"笔不直、七拐八绕"(2026-08-19 反馈)。
 * 手感来自"不完美的直",不是来自波浪;振幅超过 ±0.2sw 就开始读成波浪线。
 */
const buildUnderline = (w: number, h: number, sw: number, seed: number): string => {
  const n = 10;
  const y0 = h + sw * 1.1;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y =
      y0 +
      Math.sin(t * Math.PI) * sw * 0.12 +
      Math.sin(t * 5.3 + seed) * sw * 0.07 +
      t * sw * 0.18;
    pts.push(`${i === 0 ? 'M' : 'L'}${fmt(t * w)} ${fmt(y)}`);
  }
  return pts.join(' ');
};

/**
 * 荧光笔:一道贯穿目标的粗扫,微倾 + 中段轻微下弓。粗细由调用方给(≈ 目标高)。
 * 端点要向内收掉**笔帽半径**(round cap 会在路径端点外再伸出 sw/2,不收的话
 * 色带左右各多描约一个字——2026-08-19 样品册里当场看出来的)。
 */
const buildMarker = (w: number, h: number, sw: number, seed: number): string => {
  const yMid = h * 0.52;
  const cap = sw / 2;
  const x0 = Math.min(-h * 0.14 + cap, w * 0.25);
  const x1 = Math.max(w + h * 0.14 - cap, w * 0.75);
  const y0 = yMid - h * 0.05 + Math.sin(seed) * h * 0.03;
  const y1 = yMid + h * 0.06;
  return `M${fmt(x0)} ${fmt(y0)} Q${fmt(w * 0.5)} ${fmt(yMid + h * 0.1)} ${fmt(x1)} ${fmt(y1)}`;
};

/** 手绘圈:绕目标一圈多一点(起止重叠),半径带抖动并轻微外旋,像真的一笔圈出来。 */
const buildCircle = (w: number, h: number, sw: number, seed: number): string => {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 + h * 0.42 + sw;
  const ry = h / 2 + h * 0.42 + sw;
  const n = 44;
  const start = Math.PI * 0.82;
  const sweep = Math.PI * 2.22;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + t * sweep;
    const wobble = 1 + 0.05 * Math.sin(t * 7.3 + seed) + 0.025 * Math.sin(t * 15.1 + seed * 1.7);
    const drift = t * h * 0.07;
    pts.push(
      `${i === 0 ? 'M' : 'L'}${fmt(cx + Math.cos(a) * (rx * wobble + drift))} ${fmt(
        cy + Math.sin(a) * (ry * wobble + drift),
      )}`,
    );
  }
  return pts.join(' ');
};

/** 方框:从左上角顺时针一笔框住,每条边一段轻弧,收笔略过起点。 */
const buildBox = (w: number, h: number, sw: number, seed: number): string => {
  const m = sw * 1.4 + h * 0.12;
  const b = sw * 0.6; // 边中点的弧度偏移
  const j = (k: number) => Math.sin(seed * 3.1 + k) * sw * 0.3; // 角点的手抖
  const x0 = -m;
  const y0 = -m;
  const x1 = w + m;
  const y1 = h + m;
  return [
    `M${fmt(x0 + j(1))} ${fmt(y0 + j(2))}`,
    `Q${fmt((x0 + x1) / 2)} ${fmt(y0 - b)} ${fmt(x1 + j(3))} ${fmt(y0 + j(4))}`,
    `Q${fmt(x1 + b)} ${fmt((y0 + y1) / 2)} ${fmt(x1 + j(5))} ${fmt(y1 + j(6))}`,
    `Q${fmt((x0 + x1) / 2)} ${fmt(y1 + b)} ${fmt(x0 + j(7))} ${fmt(y1 + j(8))}`,
    `Q${fmt(x0 - b)} ${fmt((y0 + y1) / 2)} ${fmt(x0 + j(1) * 0.5)} ${fmt(y0 + sw * 1.2)}`,
  ].join(' ');
};

export const AnnotationMark: React.FC<{
  /** 目标矩形,**父容器像素坐标**(挂进 KenBurns overlay 时即源图像素坐标)。用网格法量,不许目测。 */
  box: Box;
  markStyle?: AnnotationMarkStyle;
  /** 墨色。默认:marker 用荧光黄,其余用笔红(ANNOTATION_INK)。 */
  color?: string;
  /**
   * 起笔帧。挂在 KenBurns 的图像坐标系里时**可以边运镜边画**(笔迹跟着镜头走,
   * ScreenPush 就是同步画的——先移动后勾选的两段式拖节奏,用户不要);
   * 只有笔迹**不**随画面变换时(直接叠在屏幕坐标上)才必须等画面安定再下笔。
   */
  delay: number;
  /** 画完用时(帧)。建议 14–30f:太快像盖章,太慢拖节奏。 */
  dur?: number;
  /** 换一个数字就换一套抖动相位,同屏多个批注别用同一个 seed。 */
  seed?: number;
  strokeWidth?: number;
  blend?: React.CSSProperties['mixBlendMode'];
}> = ({box, markStyle = 'underline', color, delay, dur = 22, seed = 1, strokeWidth, blend}) => {
  const frame = useCurrentFrame();
  if (frame < delay) return null; // 见坑注:避免起点墨滴
  const p = progress(frame, delay, dur, MOVE);

  const sw =
    strokeWidth ??
    (markStyle === 'marker'
      ? box.h * 1.15
      : Math.min(16, Math.max(3, box.h * (markStyle === 'underline' ? 0.16 : 0.13))));
  const ink = color ?? (markStyle === 'marker' ? ANNOTATION_INK.yellow : ANNOTATION_INK.red);
  const mix = blend ?? (markStyle === 'marker' ? 'multiply' : 'normal');

  const d =
    markStyle === 'underline'
      ? buildUnderline(box.w, box.h, sw, seed)
      : markStyle === 'marker'
        ? buildMarker(box.w, box.h, sw, seed)
        : markStyle === 'circle'
          ? buildCircle(box.w, box.h, sw, seed)
          : buildBox(box.w, box.h, sw, seed);

  // 画布四周留出手绘越界的余量(圈和方框都会超出目标框)
  const pad = box.h * 1.2 + sw * 2;
  return (
    <svg
      width={box.w + pad * 2}
      height={box.h + pad * 2}
      viewBox={`${-pad} ${-pad} ${box.w + pad * 2} ${box.h + pad * 2}`}
      style={{
        position: 'absolute',
        left: box.x - pad,
        top: box.y - pad,
        overflow: 'visible',
        mixBlendMode: mix,
        pointerEvents: 'none',
      }}
    >
      <path
        d={d}
        pathLength={1}
        fill="none"
        stroke={ink}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={1}
        strokeDashoffset={1 - p}
      />
    </svg>
  );
};
