import React from 'react';
import {Img, interpolate} from 'remotion';
import {alpha} from '../../lib/theme';
import {ENTER} from '../../lib/anim';
import {mulberry32} from './BackgroundSystem';

// 编辑式拼贴:几张真实图片的重叠、裁切、遮罩与纵深。
//
// 解决什么问题:一张图铺满画面 = 壁纸,读不出观点;
// 三四张图**互相压着**排出来 = 版面,读得出"这几件事是一组的"。
// 这是 Editorial Cinematic 方向的主力手法(docs/visual-first.md §Three Real Styleframes),
// 也是"密度不靠堆装饰"的正解:密度来自素材之间的空间关系,不是来自额外图形。
//
// 何时用:氛围铺陈、案例集合、时间线切片、章节封面。
// 何时不用:某一张图必须被看清所有细节时(重叠必然遮掉一部分)——那种用 ScreenshotStage;
//   以及只有一张图时——一张图的"拼贴"就是一张歪着的图,不如老实铺满。
//
// **素材约束:`src` 只能是 `staticFile(...)` 或 import 的资源,渲染期绝不 fetch。**
// 网络素材先下载进项目 `assets/` 再引本地路径(否则重渲/离线会 404)。
//
// **确定性纵深:z 序 = 数组顺序,永远不随机。**
// 位置/旋转/遮罩形状由 `seed` 决定(mulberry32,见 BackgroundSystem),
// 但**谁压着谁由调用方的数组顺序决定**——后面的压前面的。
// 这条是刻意的:随机 z 序会让"重点那张"每次重渲跑到别人下面去。
//
// 踩过的坑:
//
// 1. **旋转角必须小(±4°)且从 seed 来。** 超过 5° 读成"图掉了",而不是"随手一摆";
//    每次重渲换一个角度则会让抽帧自查失效。
// 2. **每张图必须有边框或投影,把自己和下面那张分开。** 两张同色调的照片直接叠,
//    交界处糊成一片,读不出"两张"。一条 hairline 白边(实体照片的相纸边)最省事。
// 3. **`clip-path` 遮罩和 `borderRadius` 不能同时用。** clip-path 会把圆角裁没,
//    结果是"圆角只在没被 clip 的那几条边上",看着像渲染错误。
//    所以这里 `mask` 形态的卡片显式关掉圆角。
// 4. **入场必须错峰,而且方向要一致。** 三张图各飞各的方向读成"炸开";
//    统一从同一侧位移进入(这里是按 seed 定一个统一方向)读成"一叠东西被放下"。
// 5. **`objectFit:'cover'` + 固定卡片比例,不要让原图比例决定卡片形状。** 素材来源杂,
//    比例从 1:1 到 16:9 都有,让原图说了算的话版面永远排不齐。
// 6. **不要给每张图加 `filter: blur()` 做景深。** 1080×1920 下几张大图各自 blur
//    会让每帧慢几十毫秒;要景深就用透明度和尺寸做(远的更小更淡),那是零成本的。
// 7. `accent` **必须是 hex**:边框走 `alpha()`,传别的格式会算出 NaN,边框直接消失。
//
// 1080×1920 安全区行为:
//   组件按 `width`/`height` 渲染,自己不定位。所有卡片的中心点被钳在
//   [0.18, 0.82] 的归一化范围内、尺寸不超过组件的 62%,**卡片可以越出组件边界一点点
//   (那正是拼贴的出血感),但越界量始终 < 卡片尺寸的 20%**。
//   因此:组件放在安全区内时,出血最多蹭到安全区外沿,不会有主体内容被平台 UI 吃掉;
//   要真正的满幅出血拼贴,把 width/height 给到 1080×1920 并接受四边被裁。

export type CollageItem = {
  /** `staticFile(...)` 或 import 的本地资源。不接受远程 URL。 */
  src: string;
  /** 素材说明。必填:它是 assets.md 里的身份,也是 alt 文本。 */
  name: string;
  /** 相对权重 0–1,默认 0.5。大的卡片更大更靠前(视觉上更近)。 */
  weight?: number;
};

export type ImageCollageProps = {
  items: CollageItem[];
  /** 0–1 归一化进度。会被钳到 0–1;卡片按数组顺序错峰进入。 */
  progress: number;
  /** 'stack' 层叠中心、'fan' 斜向散开、'mosaic' 网格式咬合。 */
  layout: 'stack' | 'fan' | 'mosaic';
  /** 整数种子:位置、旋转、遮罩形状全部由它推导。同 seed 同版面。 */
  seed: number;
  width: number;
  height: number;
  /** 强调色(hex):卡片边框的染色。不给则用中性白边。 */
  accent?: string;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 斜切遮罩:编辑版面里"被裁掉一角"的那种形状。和圆角互斥(坑 3)。 */
const MASKS = [
  'polygon(0% 0%, 100% 0%, 100% 88%, 0% 100%)',
  'polygon(0% 0%, 100% 6%, 100% 100%, 0% 100%)',
  'polygon(6% 0%, 100% 0%, 94% 100%, 0% 100%)',
];

export const ImageCollage: React.FC<ImageCollageProps> = ({
  items,
  progress,
  layout,
  seed,
  width,
  height,
  accent,
}) => {
  const p = clamp01(progress);
  const n = items.length;
  if (n === 0) return null;

  const rnd = mulberry32(seed);
  // 坑 4:统一入场方向,由 seed 定一次(不是每张各定各的)
  const dirAngle = rnd() * Math.PI * 2;
  const dirX = Math.cos(dirAngle) * 70;
  const dirY = Math.sin(dirAngle) * 70 - 30; // 略偏下:落下比飘上更像"放下一叠东西"

  // 每张卡片固定消费 4 个随机数,顺序即版面(中途别插新的)
  const cards = items.map((item, i) => {
    const r1 = rnd();
    const r2 = rnd();
    const r3 = rnd();
    const r4 = rnd();
    const w = item.weight ?? 0.5;

    // 基准位置:三种 layout 用同一组随机数,只是映射不同
    let cx: number;
    let cy: number;
    if (layout === 'stack') {
      cx = 0.5 + (r1 - 0.5) * 0.3;
      cy = 0.5 + (r2 - 0.5) * 0.3;
    } else if (layout === 'fan') {
      // 沿一条对角线铺开,再加抖动 —— 读成"摊开的一叠"
      const s = n === 1 ? 0.5 : i / (n - 1);
      cx = 0.24 + s * 0.52 + (r1 - 0.5) * 0.1;
      cy = 0.26 + s * 0.48 + (r2 - 0.5) * 0.1;
    } else {
      // mosaic:两列咬合,行内交错
      const col = i % 2;
      const row = Math.floor(i / 2);
      const rowsN = Math.max(1, Math.ceil(n / 2));
      cx = (col === 0 ? 0.32 : 0.7) + (r1 - 0.5) * 0.06;
      cy = (row + 0.5) / rowsN + (r2 - 0.5) * 0.06;
    }

    return {
      item,
      // 安全区约束:中心钳在 [0.18, 0.82],越界量因此始终小于卡片尺寸的 20%
      cx: clamp(cx, 0.18, 0.82),
      cy: clamp(cy, 0.18, 0.82),
      // 尺寸:权重决定近远,上限 62%(见安全区说明)
      size: clamp(0.34 + w * 0.28, 0.28, 0.62),
      // 坑 1:±4°,来自 seed
      rot: (r3 - 0.5) * 8,
      // 三分之一的卡片走斜切遮罩,其余走圆角(坑 3 决定二者互斥)
      masked: r4 > 0.66,
      maskShape: MASKS[i % MASKS.length],
    };
  });

  return (
    <div style={{position: 'relative', width, height}}>
      {cards.map((c, i) => {
        // 坑 4:错峰但同向
        const d = Math.min(0.5, i * 0.09);
        const t = interpolate(p, [d, d + 0.42], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: ENTER,
        });

        const cardW = width * c.size;
        // 坑 5:卡片比例固定 4:5(竖版编辑版面的标准比例),不由原图决定
        const cardH = cardW * 1.25;
        // 坑 6:景深靠尺寸和透明度,不靠 blur
        const depth = 0.72 + c.size * 0.45;

        return (
          <div
            key={`${c.item.name}-${i}`}
            style={{
              position: 'absolute',
              left: c.cx * width,
              top: c.cy * height,
              width: cardW,
              height: cardH,
              marginLeft: -cardW / 2,
              marginTop: -cardH / 2,
              // 纵深 = 数组顺序,永不随机(见顶部说明)
              zIndex: i + 1,
              boxSizing: 'border-box',
              overflow: 'hidden',
              // 坑 3:遮罩与圆角互斥
              borderRadius: c.masked ? 0 : 10,
              clipPath: c.masked ? c.maskShape : undefined,
              // 坑 2:相纸白边 + 投影,把自己和下面那张分开
              border: `3px solid ${accent ? alpha(accent, 0.42) : 'rgba(255,255,255,0.5)'}`,
              boxShadow: '0 22px 54px rgba(0,0,0,0.5), 0 3px 8px rgba(0,0,0,0.36)',
              transform:
                `translate(${(1 - t) * dirX}px, ${(1 - t) * dirY}px) ` +
                `rotate(${c.rot}deg) scale(${interpolate(t, [0, 1], [0.92, 1])})`,
              opacity: t * Math.min(1, depth),
            }}
          >
            <Img
              src={c.item.src}
              alt={c.item.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover', // 坑 5
                display: 'block',
              }}
            />
            {/* 每张图压一层极淡的向下渐变:让重叠处仍分得出上下 */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.28) 100%)',
                pointerEvents: 'none',
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
