import {EditorScene} from '../editor/preset-editing';
// presets/NumberBeat.tsx —— 数字强调 preset(docs/presets/number-beat/preset.json)
//
// 定位:一个数字承担整个节拍。全帧唯一被放大的元素就是这个数字(taste.md:
// "$2,000 是全帧唯一被放大的数字"),滚动到位 + 落定时变强调色 + accent 底线扫入。
// 数字用 tabular-nums(滚动不抖宽)。唯一弹簧名额:落定瞬间 1.5% 过冲。
// 时序(绝对秒):0s 底+标签已在(无黑帧)→ 数字滚动 0.8s(前快后慢)→ 0.8s 落定
// 变色+过冲 → 0.9s 底线扫入 0.4s → 1.0s 说明句上浮 → hold 静止。
//
// v3 新增 variant.celebrate='confetti'(源自 shotcraft counter-confetti 融合):
// 落定前约 5 帧「抢拍」从数字两端两簇爆出 52 片纸屑,重力弧线 + 自转 + 着地前淡出;
// 数字共用原 landSpring 名额补一次 ~1.04 轻 punch。默认 'none' 与 v2 逐帧一致。
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, interpolateColors, spring, Easing} from 'remotion';
import {
  useBaseline,
  Backdrop,
  Eyebrow,
  Foreground,
  textStyle,
} from '../style/baseline';
import {oklch} from '../lib/color';
import {numeric} from '../lib/fonts';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';
import {fitFontSize} from '../style/fit';
import {ENTER} from '../lib/anim';
import type {ElementStyle} from '../editor/types';

export type PresetNumberBeatProps = {
  durationSeconds: number;
  /** celebrate='confetti':落定拍纸屑爆开(计数撞停庆祝);缺省/'none' 与 v2 行为逐帧一致 */
  variant?: {celebrate?: 'none' | 'confetti'; layout?: 'scene' | 'side'; align?: 'left' | 'right'; bg?: 'scene' | 'transparent'};
  slots: {
    value: number;
    prefix?: string;
    suffix?: string;
    label: string;
    eyebrow?: string;
  };
  /** 打磨旋钮(Studio 试玩用,生产合同不写) */
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    x?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
  elements?: Record<string, ElementStyle>;
};

const seg = (frame: number, fromSec: number, durSec: number, fps: number) =>
  interpolate(frame, [fromSec * fps, (fromSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

const ROLL_SECONDS = 0.8;

const formatNumber = (n: number) => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// celebrate='confetti' 的纸屑物理(参考 src/shotcraft/CounterConfetti.tsx,
// 配方卡 docs/catalog/recipes-external/data/counter-confetti.md;坐标换算到
// 1080×1920 全幅画布)。全部参数由静态种子表决定,渲染期零随机。
// ---------------------------------------------------------------------------

// 内联确定性伪随机(等价 Remotion random(seed):同种子跨帧/跨渲染可复现)。
// 不 import shotcraft/Motion —— preset 不依赖实验目录。
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// 抢拍:纸屑比计数落定(0.8s)早 0.16s(30fps 下约 5 帧)爆开——庆祝先于结果半拍。
// 配方卡:提前 0–0.02(归一化)读作同拍,>0.08 像"别人的庆祝";这里取中间值。
const CONFETTI_BURST_SEC = ROLL_SECONDS - 0.16;
// 名义弧线时长(秒):位移永远按 life = u × T0 计。durationSeconds 短时只压缩
// 播放窗口(u 走得快 = 初速与重力等比放大),弧线形状不变,且必在片内落完——
// 这就是配方卡"改 dur 后重力体感会变,需重调 g/vy"那个坑的规避方式。
const CONFETTI_T0 = 2.0;
// 每片错峰上限(占窗口的比例);窗口末端预留同样余量保证最晚那片也走完
const CONFETTI_MAX_STAGGER = 0.08;

type ConfettiBit = {
  w: number;
  h: number;
  isRect: boolean;
  hueOff: number; // 相对皮肤 accentHue 的色相偏移(±36°,邻近色相内收敛)
  L: number;
  C: number;
  x0: number;
  y0: number;
  vx: number; // px/s(名义时间尺度 T0 下)
  vy: number;
  g: number; // px/s²
  spin: number; // deg/s
  d: number; // 错峰(占窗口比例,0–0.08)
};

// 52 片、两簇:偶数片从数字左端(x≈300)、奇数片从右端(x≈780)爆出,
// 初速带向外偏置(两簇向两侧上抛),重力拉回走抛物线。
// g≈2×|vy| 保证弧线顶点落在画面上 1/3 附近(配方卡的重力/初速比条款,按竖版换算)。
const CONFETTI_BITS: ConfettiBit[] = Array.from({length: 52}, (_, i) => {
  const side = i % 2 ? 1 : -1; // -1=左簇 / 1=右簇
  const isRect = rand(i * 3) > 0.4;
  const w = 10 + rand(i + 2) * 14;
  return {
    w,
    h: isRect ? 14 + rand(i + 5) * 12 : w,
    isRect,
    // 颜色不用固定 hex 彩虹:色相 = 皮肤 accentHue ± ≤36°(邻近色相),
    // 明度 0.66–0.86 保证深底上读得出,彩度 0.13–0.19(oklch 超 sRGB 自动降 C)
    hueOff: (rand(i + 7) - 0.5) * 72,
    L: 0.66 + rand(i + 11) * 0.2,
    C: 0.13 + rand(i + 13) * 0.06,
    x0: (side < 0 ? 300 : 780) + (rand(i + 21) - 0.5) * 120,
    y0: 860 + (rand(i + 30) - 0.5) * 80, // 数字(top 760 + 字高/2)附近
    vx: side * (80 + rand(i * 5 + 1) * 260) + (rand(i + 17) - 0.5) * 160,
    vy: -(1050 + rand(i * 7 + 3) * 650), // 上抛
    g: 1950 + rand(i + 60) * 1050, // 重力拉回
    spin: (rand(i + 90) - 0.5) * 1440,
    d: rand(i + 120) * CONFETTI_MAX_STAGGER,
  };
});

const editorStyle = (style?: ElementStyle): React.CSSProperties => {
  if (!style) return {};
  const css: React.CSSProperties = {};
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'width', 'color', 'opacity', 'backgroundColor', 'borderRadius', 'padding'] as const) if (style[key] !== undefined) (css as any)[key] = style[key];
  if (style.fontFamily === 'Inter' || style.fontFamily === 'Archivo') css.fontFamily = `${style.fontFamily}, "Noto Sans SC"`;
  if (style.x !== undefined || style.y !== undefined) css.translate = `${style.x ?? 0}px ${style.y ?? 0}px`;
  return css;
};

const Inner: React.FC<PresetNumberBeatProps> = ({durationSeconds, variant, slots, tune, elements}) => {
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const {P, T, pad, skin} = useBaseline();
  const celebrate = variant?.celebrate ?? 'none';

  // 纸屑颜色从当前皮肤 accentHue 派生(tune.accentHue 调色相时纸屑跟着走)。
  // 'none' 时不算——不为用不上的层花一行。
  const confettiColors = useMemo(
    () =>
      celebrate === 'confetti'
        ? CONFETTI_BITS.map((b) => oklch(b.L, b.C, skin.accentHue + b.hueOff))
        : [],
    [celebrate, skin.accentHue],
  );

  // 滚动:前快后慢(cubic out),数值从 0 滚到 value
  const roll = interpolate(frame, [0, ROLL_SECONDS * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const landed = frame >= ROLL_SECONDS * fps;
  // 唯一弹簧名额:落定过冲
  const landSpring = spring({frame: frame - Math.round(ROLL_SECONDS * fps), fps, config: {damping: 15, stiffness: 140, mass: 0.8}});
  const color = interpolateColors(
    interpolate(frame, [(ROLL_SECONDS - 0.1) * fps, (ROLL_SECONDS + 0.15) * fps], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    [0, 1],
    [P.ink, P.accent],
  );
  const barIn = seg(frame, 0.9, 0.4, fps);
  const labelIn = seg(frame, 1.0, 0.4, fps);

  const finalText = `${slots.prefix ?? ''}${formatNumber(slots.value)}${slots.suffix ?? ''}`;
  const rollingText = `${slots.prefix ?? ''}${formatNumber(slots.value * roll)}${slots.suffix ?? ''}`;
  // 用最终文案定字号(最长态),滚动过程用同一字号,tabular-nums 保证不抖
  const fontSize = fitFontSize(finalText, {fontSize: 210, maxWidthPx: landscape ? width * 0.48 : 936, shrinkFloorPx: 110});

  // 落定 scale:'none' 路径与 v2 表达式逐字符一致(向后兼容硬要求);
  // 'confetti' 时共用**同一根** landSpring(不开第二个弹簧名额),在原有
  // 0.985→1 落定之上叠加过冲分量 ×0.9 → 峰值 ≈1.04 的一次轻 punch,随弹簧衰减归 1。
  const numScale = landed
    ? celebrate === 'confetti'
      ? 0.985 + 0.015 * landSpring + Math.max(0, landSpring - 1) * 0.9
      : 0.985 + 0.015 * landSpring
    : 1;

  // 纸屑播放窗口:从抢拍点到落完必须整个装进 durationSeconds(末端留 0.1s 干净帧)。
  // 时长短(min 2.5s)时窗口被压到 ~1.7s,u 走得快 = 初速/重力等比放大,弧线形状不变。
  const confettiWindowSec = Math.min(
    CONFETTI_T0,
    Math.max(0.9, durationSeconds - CONFETTI_BURST_SEC - 0.1),
  );
  const sec = frame / fps;
  const unitEdits = elements?.unit;
  const hasUnitEdits = Boolean(unitEdits && Object.keys(unitEdits).length > 0);
  const {translate: _labelTranslate, ...sceneLabelStyle} = editorStyle(elements?.label);

  if (variant?.layout === 'side') {
    if (celebrate === 'confetti') throw new Error("NumberBeat side layout does not support celebrate='confetti'; use scene layout or celebrate='none'.");
    const align = variant.align ?? 'left';
    const side = landscape ? 88 : 64;
    return <EditorScene style={{overflow: 'hidden', backgroundColor: variant.bg === 'scene' ? P.bg : undefined}}>
      {variant.bg === 'scene' ? <Backdrop /> : null}
      <div style={{position: 'absolute', top: landscape ? '38%' : '43%', ...(align === 'left' ? {left: side + (tune?.x ?? 0)} : {right: side - (tune?.x ?? 0)}), translate: `0 ${tune?.y ?? 0}px`, scale: tune?.scale ?? 1, transformOrigin: `${align} center`, textAlign: align}}>
        <div style={{display: 'flex', alignItems: 'baseline', justifyContent: align === 'left' ? 'flex-start' : 'flex-end', color}}>
          <div data-editor-part="number" style={{...textStyle(T, 'hero'), ...numeric(true), ...(tuneFont ? {fontFamily: tuneFont} : {}), fontSize: landscape ? 132 : 118, lineHeight: 1, scale: numScale, ...editorStyle(elements?.number)}}>{slots.prefix ?? ''}{formatNumber(slots.value * roll)}</div>
          {slots.suffix ? <div data-editor-part="unit" style={{...textStyle(T, 'body'), fontSize: landscape ? 58 : 52, marginLeft: 12, color, ...editorStyle(elements?.unit)}}>{slots.suffix}</div> : null}
        </div>
        <div style={{height: 6, width: `${barIn * 100}%`, maxWidth: landscape ? 390 : 340, marginTop: 20, marginLeft: align === 'right' ? 'auto' : undefined, background: P.accent, borderRadius: 4}} />
        <div data-editor-part="label" style={{...textStyle(T, 'body'), marginTop: 22, color: P.inkSecondary, maxWidth: landscape ? 480 : 390, ...editorStyle(elements?.label), opacity: labelIn * (elements?.label?.opacity ?? 1), translate: `${elements?.label?.x ?? 0}px ${16 * (1 - labelIn) + (elements?.label?.y ?? 0)}px`}}>{slots.label}</div>
      </div>
      {variant.bg === 'scene' ? <Foreground quiet /> : null}
    </EditorScene>;
  }

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* 眉题一律「不填就不显示」。**不许给它兜底文案** —— 「关键概念 · KEY CONCEPT」
          这类词是在向观众解释这一镜是什么,而观众看一眼就知道。
          用户 2026-08-15:「这些表达太多了…要像乔布斯的 ppt,简单直接高级」 */}
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 100 : 220} /> : null}
      {/* 纸屑层:渲在数字**之下**(先画),爆点在数字两端但永远不遮数字。
          'none' 时整段短路——一行都不多渲(向后兼容硬要求)。 */}
      {celebrate === 'confetti' ? (
        <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
          {CONFETTI_BITS.map((b, i) => {
            // 每片自己的归一化进度:错峰启动,窗口末端留 MAX_STAGGER 余量,
            // 保证最晚那片也在窗口内走完(= 片内落完)
            const u = Math.min(
              1,
              Math.max(
                0,
                (sec - CONFETTI_BURST_SEC - b.d * confettiWindowSec) /
                  (confettiWindowSec * (1 - CONFETTI_MAX_STAGGER)),
              ),
            );
            if (u <= 0 || u >= 0.95) return null; // 未爆/已落定:不渲,末帧干净
            const life = u * CONFETTI_T0; // 名义秒:弧线形状与窗口长短无关
            const x = (landscape ? width * 0.28 + (b.x0 - 540) : b.x0) + b.vx * life;
            const y = (landscape ? height * 0.46 + (b.y0 - 860) : b.y0) + (b.vy * life + 0.5 * b.g * life * life) * (landscape ? 0.55 : 1); // 上抛+重力
            const fadeIn = Math.min(1, u * 10);
            const fadeOut = 1 - Math.min(1, Math.max(0, (u - 0.7) / 0.25)); // 着地前淡出
            return (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: b.w,
                  height: b.h,
                  background: confettiColors[i],
                  borderRadius: b.isRect ? 2 : '50%',
                  opacity: fadeIn * fadeOut,
                  transform: `translate(${x - b.w / 2}px, ${y - b.h / 2}px) rotate(${b.spin * life}deg) scale(${0.85 + (1 - u) * 0.3})`,
                }}
              />
            );
          })}
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          top: (landscape ? height * 0.39 : 760) + (tune?.y ?? 0),
          left: pad + (tune?.x ?? 0),
          right: (landscape ? width * 0.47 : pad) - (tune?.x ?? 0),
          transform: `scale(${numScale})`,
          transformOrigin: 'left center',
        }}
      >
        {hasUnitEdits && slots.suffix ? <div style={{display: 'flex', alignItems: 'baseline'}}>
          <span data-editor-part="number" style={{...textStyle(T, 'hero'), ...numeric(true), ...(tuneFont ? {fontFamily: tuneFont} : {}), fontSize: Math.round(fontSize * (tune?.scale ?? 1)), color, lineHeight: 1, ...editorStyle(elements?.number)}}>{slots.prefix ?? ''}{formatNumber(slots.value * roll)}</span>
          <span data-editor-part="unit" style={{...textStyle(T, 'body'), marginLeft: 12, color, ...editorStyle(unitEdits)}}>{slots.suffix}</span>
        </div> : <div data-editor-part="number" style={{...textStyle(T, 'hero'), ...numeric(true), ...(tuneFont ? {fontFamily: tuneFont} : {}), fontSize: Math.round(fontSize * (tune?.scale ?? 1)), color, lineHeight: 1, ...editorStyle(elements?.number)}}>
          {rollingText}
        </div>}
        <div
          style={{
            marginTop: 34,
            width: `${barIn * 46}%`,
            height: 8,
            background: P.accent,
            borderRadius: 4,
          }}
        />
      </div>
      <div data-editor-part="label"
        style={{
          position: 'absolute',
          top: landscape ? height * 0.43 : 1430,
          left: landscape ? width * 0.6 : pad,
          right: pad,
          ...textStyle(T, 'body'),
          color: P.inkSecondary,
          lineHeight: 1.6,
          ...sceneLabelStyle,
          opacity: labelIn * (elements?.label?.opacity ?? 1),
          transform: `translate(${elements?.label?.x ?? 0}px, ${20 * (1 - labelIn) + (elements?.label?.y ?? 0)}px)`,
        }}
      >
        {slots.label.split('\n').map((l, i) => (
          <React.Fragment key={l}>
            {i > 0 ? <br /> : null}
            {l}
          </React.Fragment>
        ))}
      </div>
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetNumberBeat: React.FC<PresetNumberBeatProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
