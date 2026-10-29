import React from 'react';
import {interpolate} from 'remotion';
import type {ScenePalette, TypographyContext} from '../../lib/theme';
import {alpha, textStyle} from '../../lib/theme';
import {MOVE} from '../../lib/anim';

// 背景系统:一个镜头的**第一层空间**。
//
// 解决什么问题:`tools/lint-shot.mjs` 把「零渐变 / 零阴影 / 零抬升表面」判为 error,
// `tools/check-density.sh` 要求首帧墨量 ≥10%。这两条的正面答案就是这个组件——
// 纯色底板永远过不了,而每个镜头现搓一层网格/噪点又是过去最大的一块重复劳动。
// visual-max 要求「背景不能是纯色板,至少给一层结构」(docs/styles/visual-max.md §材质),
// 这里把那四种结构做成了 variant。
//
// 何时用:几乎每一镜。放在 StageLayers 的 background 槽里。
// 何时不用:主体是别人的截图/实拍且要占满全屏时(visual-max §什么时候不该用它)——
//   这种镜背景本来就被内容盖住,再叠一层只是白烧渲染时间;
//   以及 `intensity` 需要压到 0.1 以下才不干扰主体时——那说明该换 profile,不是该调参。
//
// 踩过的坑:
//
// 1. **运动必须有限。** 所有 variant 的漂移都是 `frame → [0, driftFrames]` 的一次性
//    ramp,走完就停在终点,不是 `sin(frame)` 的无限循环。原因有二:确定性抽帧自查要求
//    任意一帧能独立算出(design-principles §9,`sin` 也满足);但**无限循环的背景在成片里
//    读成"页面在 loading"**,而一次性漂移读成"镜头在推进"。第二个才是我们要的。
// 2. **`grain` 的噪点必须用 SVG `feTurbulence` 的 `seed` 属性,不能用 Math.random 画点。**
//    feTurbulence 的 seed 是规范里定义的确定性输入,同 seed 同图案,重渲一致。
//    但 **filter 的 id 必须按 seed+variant 拼**:同一帧里放两个 BackgroundSystem 时
//    id 撞了会让后一个静默套用前一个的滤镜(不报错,只是图案一样,极难查)。
// 3. **`grain` 的噪点层不要开 `mixBlendMode:'overlay'` 之外的模式。** normal 模式下
//    噪点是一层灰纱,把底下的渐变全压平;overlay 才是"胶片颗粒打在光上"。
// 4. **网格必须带 mask 衰减。** 满幅等亮度的网格线是"技术图纸",四周衰减掉之后才是
//    "空间深度"。衰减用 radial-gradient mask,不是整层降 opacity——后者连中心也一起弱了。
// 5. **aurora 的光斑要 `filter: blur()`,不能只靠 radial-gradient 的软边。** 渐变软边在
//    H.264 压缩后会出现色带(banding),blur 之后的高频抖动反而把色带打散了。
// 6. `palette` 的颜色都是 hex(scenePalette() 的输出),`alpha()` 只吃 hex——
//    传 'red' / 'rgb(...)' 会 `parseInt` 出 NaN,那一层直接不显示。
// 7. **本组件只能放进 StageLayers 的 `background` 槽,不能当前景叠加层。**
//    四个 variant 都会先铺一层**不透明**的底场(field),放进 foreground 会把整个主体
//    盖得一干二净——渲出来是一张只有渐变的空图,而且不报任何错(实测踩过)。
//    要前景颗粒请单独写一层 `mixBlendMode:'overlay'` 的噪点,不要复用这个组件。
//
// 1080×1920 安全区行为:
//   本组件**不放任何需要阅读的信息**,所以它不受安全区约束,四边一律出血到画布边缘。
//   反过来它要为安全区服务:四个 variant 都在边缘做了压暗(mask / vignette / 渐变收口),
//   让落在安全区(top 220 / bottom 320 / x 96,见 theme.safeVertical)里的文字始终有对比度。
//   `ghost-type` 的巨字**故意被裁出画面**——它是肌理不是标题,完整可读的巨字会和 HeroFrame
//   抢焦点。所以它的字号按画布高度算,溢出交给 overflow:hidden。

export type BackgroundVariant = 'grid' | 'grain' | 'aurora' | 'ghost-type';

type BackgroundCommon = {
  /** 场景配色。颜色只从这里消费,组件内部不造色。 */
  palette: ScenePalette;
  /** 当前帧。所有运动从它推导,组件内不碰时钟。 */
  frame: number;
  /** 0–1 强度。控制结构层的不透明度与光斑亮度,会被钳到 0–1。 */
  intensity: number;
  /** 整数种子。所有伪随机(光斑位置、噪点图案)只从它推导,同 seed 同画面。 */
  seed: number;
  /** 漂移在第几帧走完并停住。默认 240(30fps 下 8 秒)。见坑 1。 */
  driftFrames?: number;
};

// 三个无文字 variant **必须各写一条**,不能合并成 `variant: 'grid' | 'grain' | 'aurora'`:
// 判别式是联合字面量时 TS 无法在 `if (props.variant === 'grid') return` 之后把该成员剔除,
// 于是走到 ghost-type 分支时 `props.typography` 会报 TS2339(实测踩过)。
export type BackgroundSystemProps =
  | (BackgroundCommon & {variant: 'grid'})
  | (BackgroundCommon & {variant: 'grain'})
  | (BackgroundCommon & {variant: 'aurora'})
  | (BackgroundCommon & {
      variant: 'ghost-type';
      /** 巨字用的字体套装。文字组件不许内部暗选字体,所以这里必填。 */
      typography: TypographyContext;
      /** 巨字内容。必须是真词(主题词、品牌名、数字),不是 Lorem。 */
      text: string;
    });

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * mulberry32:32 位整数种子的确定性伪随机数发生器,返回 [0,1)。
 * 选它是因为实现只有五行、无状态外泄、同 seed 逐位可复现——
 * 满足 design-principles §9「任意一帧必须能独立算出来」。
 *
 * **禁止在渲染路径里用 `Math.random()`**:它每次重渲都换一套布局,
 * 抽帧自查看到的画面和成片对不上,自查就失去意义。
 *
 * 用法必须是「组件顶部建一次,按固定顺序取值」——取值顺序即布局,
 * 中途插一个 `rnd()` 会把后面所有元素的位置全部平移一位。
 *
 * 从这里导出而不是各文件抄一份:同一套发生器保证 BackgroundSystem / LogoCloud /
 * ImageCollage 在同 seed 下的随机序列一致,调参时心里有数。
 */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** 边缘压暗:让安全区里的文字始终压得住背景(见顶部安全区说明) */
const VIGNETTE =
  'radial-gradient(120% 78% at 50% 46%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.44) 100%)';

export const BackgroundSystem: React.FC<BackgroundSystemProps> = (props) => {
  const {palette: P, frame, intensity, seed, driftFrames = 240} = props;
  const k = clamp01(intensity);
  // 坑 1:一次性 ramp,走完停住;不是循环
  const drift = interpolate(frame, [0, Math.max(1, driftFrames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: MOVE,
  });

  // 所有 variant 共用的底场:一层带方向的渐变,而不是一块纯色。
  // 光从上方来(和 SurfacePanel 的顶部高光同一个光源假设),所以上亮下暗。
  const field =
    P.mode === 'dark'
      ? `radial-gradient(140% 90% at 50% -10%, ${alpha(P.accentSoft, 0.5)} 0%, rgba(0,0,0,0) 62%),` +
        `linear-gradient(180deg, ${P.surface} 0%, ${P.bg} 58%, ${P.bg} 100%)`
      : `radial-gradient(140% 90% at 50% -10%, ${alpha(P.accentSoft, 0.62)} 0%, rgba(255,255,255,0) 62%),` +
        `linear-gradient(180deg, ${P.surfaceRaised} 0%, ${P.bg} 58%, ${P.bg} 100%)`;

  const shell: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden', // ghost-type 的巨字靠它裁出血
    background: field,
  };

  if (props.variant === 'grid') {
    // 双层网格:细格给密度,粗格给尺度感。只有一层时读作"方格纸"。
    const cell = 60;
    const line = alpha(P.line, 0.55 * k + 0.12);
    const lineBold = alpha(P.accent, 0.16 * k);
    const dy = drift * cell; // 有限位移:恰好一个格,走完看不出接缝
    return (
      <div style={shell}>
        <div
          style={{
            position: 'absolute',
            inset: -cell,
            backgroundImage:
              `repeating-linear-gradient(0deg, ${line} 0 1px, rgba(0,0,0,0) 1px ${cell}px),` +
              `repeating-linear-gradient(90deg, ${line} 0 1px, rgba(0,0,0,0) 1px ${cell}px),` +
              `repeating-linear-gradient(0deg, ${lineBold} 0 2px, rgba(0,0,0,0) 2px ${cell * 5}px),` +
              `repeating-linear-gradient(90deg, ${lineBold} 0 2px, rgba(0,0,0,0) 2px ${cell * 5}px)`,
            backgroundPosition: `0 ${dy}px, 0 0, 0 ${dy}px, 0 0`,
            // 坑 4:mask 衰减,不是整层降 opacity
            maskImage:
              'radial-gradient(105% 70% at 50% 38%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage:
              'radial-gradient(105% 70% at 50% 38%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0) 100%)',
          }}
        />
        <div style={{position: 'absolute', inset: 0, background: VIGNETTE}} />
      </div>
    );
  }

  if (props.variant === 'grain') {
    // 坑 2:id 必须按 seed 拼,同帧多实例才不会互相顶掉
    const id = `bg-grain-${seed >>> 0}`;
    const rnd = mulberry32(seed);
    // 基频也从 seed 推导:同 seed 同颗粒粗细
    const freq = (0.62 + rnd() * 0.5).toFixed(3);
    const sweepX = interpolate(drift, [0, 1], [30, 70]);
    return (
      <div style={shell}>
        {/* 有限漂移的柔光扫过:给静态颗粒一个"镜头在动"的理由 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(70% 46% at ${sweepX}% 32%, ${alpha(
              P.accent,
              0.16 * k,
            )} 0%, rgba(0,0,0,0) 70%)`,
          }}
        />
        <svg
          width="100%"
          height="100%"
          style={{
            position: 'absolute',
            inset: 0,
            // 坑 3:overlay,不是 normal
            mixBlendMode: 'overlay',
            opacity: 0.28 + 0.42 * k,
          }}
        >
          <filter id={id} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={freq}
              numOctaves={2}
              seed={seed >>> 0}
              stitchTiles="stitch"
            />
            {/*
              去色成灰阶噪点(彩色噪点在压缩后会变成脏色块),alpha 恒为 1。
              **不要写成"颜色恒定 0.5、alpha 跟着噪点变"**——overlay 混合模式下
              0.5 灰是恒等元,那样噪点会一点效果都没有(渲图实测:画面完全干净)。
              有效的写法是**亮度必须随噪点变**,alpha 恒定,由 CSS opacity 控总强度。
            */}
            <feColorMatrix
              type="matrix"
              values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1"
            />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${id})`} />
        </svg>
        <div style={{position: 'absolute', inset: 0, background: VIGNETTE}} />
      </div>
    );
  }

  if (props.variant === 'aurora') {
    const rnd = mulberry32(seed);
    // 固定 4 团:少于 3 团读作"一个光斑"(氛围灯),多于 5 团糊成一片
    const blobs = Array.from({length: 4}, (_, i) => {
      // 取值顺序即布局,不要在中间插新的 rnd() —— 会把后面全体挪位
      const x = 0.1 + rnd() * 0.8;
      const y = 0.08 + rnd() * 0.78;
      const r = 0.34 + rnd() * 0.34;
      const dx = (rnd() - 0.5) * 0.16;
      const dy = (rnd() - 0.5) * 0.14;
      const tone = [P.accent, P.accentSoft, P.accent, P.surfaceRaised][i % 4];
      return {x, y, r, dx, dy, tone};
    });
    return (
      <div style={shell}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            mixBlendMode: P.mode === 'dark' ? 'screen' : 'multiply',
          }}
        >
          {blobs.map((b, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${(b.x + b.dx * drift) * 100}%`,
                top: `${(b.y + b.dy * drift) * 100}%`,
                width: `${b.r * 100}%`,
                height: `${b.r * 88}%`,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: `radial-gradient(closest-side, ${alpha(
                  b.tone,
                  (0.34 + 0.3 * k) * (i === 0 ? 1 : 0.72),
                )} 0%, rgba(0,0,0,0) 100%)`,
                // 坑 5:blur 打散色带
                filter: `blur(${70 + i * 14}px)`,
              }}
            />
          ))}
        </div>
        <div style={{position: 'absolute', inset: 0, background: VIGNETTE}} />
      </div>
    );
  }

  // ghost-type:巨字当肌理。字号按画布高度的比例给不了(组件不知道画布多高),
  // 所以用 hero 令牌的 2 倍——1080×1920 下约 450px,一行放 3 个中文字,左右各出血一点。
  // **2.6 倍试过,太大**:三个字里只剩中间一个字的局部在画面里,读成随机线条而不是字。
  const {typography, text} = props;
  const hero = textStyle(typography, 'hero');
  const ghostSize = (hero.fontSize as number) * 2;
  const shiftX = interpolate(drift, [0, 1], [-2, -7]); // 有限横移,单位 %
  return (
    <div style={shell}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            ...hero,
            fontSize: ghostSize,
            lineHeight: 0.86,
            whiteSpace: 'nowrap',
            transform: `translateX(${shiftX}%)`,
            // 巨字是肌理:靠描边而不是实心填充,实心会直接和标题抢焦点。
            // 描边宽度跟着字号走(约 1/90),写死 3px 在 450px 的字上细得看不见——
            // 渲图实测过,那时它读成"画面上有几根随机的线"。
            color: 'transparent',
            WebkitTextStroke: `${Math.max(3, ghostSize / 90)}px ${alpha(P.ink, 0.07 + 0.11 * k)}`,
            // 得意黑一类斜切字体的首字左下会出血,容器补一点左内边距
            paddingLeft: '0.14em',
          }}
        >
          {text}
        </div>
      </div>
      {/* 描边巨字在暗底上容易糊,再补一层同字的极淡实心,拉出"厚度" */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${alpha(P.accentSoft, 0.26 * k)} 0%, rgba(0,0,0,0) 55%)`,
        }}
      />
      <div style={{position: 'absolute', inset: 0, background: VIGNETTE}} />
    </div>
  );
};
