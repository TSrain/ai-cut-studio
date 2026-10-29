import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/FlyingWordsShot.tsx —— 关键词隧道 preset(docs/presets/flying-words/preset.json)
//
// 复刻来源:src/shotcraft/FlyingWords.tsx(video-shotcraft 逐帧验证版,2026-08-20)
// 配方卡:docs/catalog/recipes-external/typography/flying-words.md
//
// 画面:关键词在透视深处生成(小、糊、暗),沿 z 轴加速掠过相机,近处大而糊、
// 擦身而过;多词按相位错开循环。finale 存在时末段隧道能量收敛,finale 句从深处
// 推到画面中央定格(英雄帧);不存在则最后一批词淡出收尾。
//
// 横版 demo(480×270)→ 1080×1920 竖版的重标定,系数一律 ×2.25(=1080/480):
//   perspective 1100→2475 · z 行程 [-1750,800]→[-3940,1800] · 近端模糊系数 26→58
//   散布椭圆:demo 是 y×0.6 压扁(横版);竖版反过来 y×1.42 拉高——半径 185–555px,
//   纵向最远 ≈±790px(半高 960 内),横向最远 ≈±555px(drift>1 时甩出画外,彼时已透明)
//
// 时序性格与 demo 一致但改为「单词过镜恒速」:每词一趟 TRAVEL=3.0s(demo 180f/2 圈),
// 时长 4–8s 伸缩时只改圈数不改速度(preset 的 timing is frozen 用在这里 = 速度冻结)。
//
// 确定性:一切由 useCurrentFrame 推导;伪随机内联 rand(种子=词序号),无 Math.random。
// 已知坑(from 配方卡):词元素全程挂在 DOM 里只改 transform/opacity,不按帧增删节点;
// 生命曲线中段压到 0.5 是给前景让位的,别拉满;中文词宽是英文两倍,字号上限压到 82。
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {CALM, ENTER} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetFlyingWordsProps = {
  durationSeconds: number;
  variant?: Record<string, never>;
  slots: {words: string[]; finale?: string};
  /** 打磨旋钮(Studio 试玩用):调到满意把值发给主 agent,固化进皮肤/preset 升版本 */
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    x?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

// ---------------------------------------------------------------------------
// 常量(demo 值 ×2.25 重标定,理由见文件头)
// ---------------------------------------------------------------------------
const PERSPECTIVE = 2475;
const Z_FAR = -3940; // 词的出生深度(再远词小到认不出,配方卡:起点 < -2500 设计px 即过远)
const Z_NEAR = 1800; // 终点必须过 0(穿过相机平面)才有"擦身",不是"飞到脸前停住"
const TRAVEL_SEC = 3.0; // 单词一趟的恒定时长(demo:180f/2圈 = 3s)
const FINALE_LEAD_SEC = 2.1; // finale 相位总长(从片尾倒数,绝对秒)
const FINALE_PUSH_SEC = 1.15; // finale 句从深处推到中央的时长

// 确定性伪随机(内联,种子=词序号;等价 shotcraft/Motion 的 rand,不引 Math.random)
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// 生命周期透明曲线,形状同 demo 的 [0,1,0.5,0.2,0] @ [0,0.25,0.6,0.85,1](分段线性)。
// 与配方卡的两处偏差(理由):
// ① 中段 0.5 → 0.7:原卡压到 0.5 是"给前景让位"(demo 是背景层);本 preset 里
//    词就是主角、没有前景,0.5 让任意静帧都读作"画面太素";
// ② 峰值 0.25 → 0.3、平台拖到 0.72:demo 里峰值亮度出现在词还在 z≈-2500(投影
//    只有半大)的时刻,画面里永远没有"既大又亮"的词——峰值后移让词在更近、
//    更大的位置保持满亮,静帧才有主次
const OP = [0, 1, 0.7, 0.26, 0];
const OT = [0, 0.3, 0.72, 0.9, 1];
const lifeCurve = (u: number) => {
  for (let k = 0; k < 4; k++) {
    if (u <= OT[k + 1]) {
      const p = (u - OT[k]) / (OT[k + 1] - OT[k]);
      return OP[k] + (OP[k + 1] - OP[k]) * p;
    }
  }
  return 0;
};

const Inner: React.FC<PresetFlyingWordsProps> = ({slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width, height} = useVideoConfig();
  const landscape = width > height;
  const {P, T} = useBaseline();
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const cx = width / 2 + (tune?.x ?? 0);
  const cy = (landscape ? height * 0.49 : 960) + (tune?.y ?? 0);

  const words = slots.words;
  const N = Math.max(1, words.length);
  const hasFinale = Boolean(slots.finale && slots.finale.trim() !== '');
  const durSec = durationInFrames / fps;
  const t = frame / fps;

  // 每词静态属性:全部由 rand(词序号) 派生,跨帧/跨渲染恒定
  const items = useMemo(
    () =>
      words.map((w, i) => {
        // 铺位:黄金角 + 抖动避免规律感;半径避开正中(finale 的落点)
        const a = i * 2.39996 + rand(i * 7 + 1) * 0.8;
        const r = 185 + rand(i * 13 + 2) * 370;
        // 冷暖/明暗层次从皮肤 accentHue 派生(oklch):
        //   色相在 accentHue−34°…+58° 的带内散布——同族里偏冷偏暖各占一半,
        //   demo 的 200–330°(蓝→紫)正是 abyss(accent 252)代入后的这条带;
        //   明度 L 0.72–0.88 / 彩度 C 0.10–0.16 错开,深底上有层次不脏
        const hue = P.accentHue - 34 + rand(i * 11) * 92;
        const L = 0.72 + rand(i + 9) * 0.16;
        const C = 0.1 + rand(i + 5) * 0.06;
        // demo 20–36 设计px ×2.25 ≈ 45–81;中文词是主角层再提一档(52–92),
        // 字号随机差是层次感来源(配方卡:全同号读作贴图)
        const size = Math.round((52 + rand(i + 3) * 40) * tuneScale);
        return {
          text: w,
          // 中文词宽 ≈ 英文两倍(配方卡坑位),fit 兜底:超宽词缩字号,不许溢出
          fontSize: fitFontSize(w, {fontSize: size, maxWidthPx: 620, shrinkFloorPx: 24}),
          color: oklch(L, C, hue),
          glow: alpha(oklch(0.66, 0.17, hue), 0.4),
          x: Math.cos(a) * r * (landscape ? 1.5 : 1),
          // 竖版重标定:demo 横版 y×0.6 压扁;1080×1920 里纵向空间是横向的 1.78 倍,
          // 反向拉高 ×1.42(最远 ≈±790px,半高 960 内)
          y: Math.sin(a) * r * (landscape ? 0.62 : 1.42),
          rz: (rand(i + 21) - 0.5) * 14,
          ph: i / N,
        };
      }),
    [words, N, P.accentHue, tuneScale, landscape],
  );

  // 隧道收尾:有 finale → 从 finaleStart 起 0.75s 内词退散;无 finale → 末段 0.7s 淡出
  const finaleStartSec = durSec - FINALE_LEAD_SEC;
  const wordsOut = hasFinale
    ? interpolate(t, [finaleStartSec, finaleStartSec + 0.75], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : interpolate(t, [durSec - 0.9, durSec - 0.2], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });

  // finale 推进:z 从 -2600 → 0(CALM,大元素落位),同帧带 0→1 淡入与 16→0 px 去糊;
  // 唯一弹簧名额 = 定格瞬间 1.5% 过冲(springAccents=1,与 KeyConcept 同参)
  const finaleFrom = finaleStartSec * fps;
  const finaleT = interpolate(frame, [finaleFrom, finaleFrom + FINALE_PUSH_SEC * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });
  const finaleZ = interpolate(finaleT, [0, 1], [-2600, 0]);
  const finaleOpacity = interpolate(finaleT, [0, 0.55], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const finaleBlur = interpolate(finaleT, [0, 0.85], [16, 0], {extrapolateRight: 'clamp'});
  const finaleSpring = spring({
    frame: frame - Math.round(finaleFrom + FINALE_PUSH_SEC * fps * 0.55),
    fps,
    config: {damping: 16, stiffness: 130, mass: 0.9},
  });
  // 定格后的锚点细线:落定才生长(ENTER,小元素轻快)
  const ruleIn = interpolate(
    frame,
    [finaleFrom + FINALE_PUSH_SEC * fps, finaleFrom + (FINALE_PUSH_SEC + 0.4) * fps],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ENTER},
  );

  const finaleSize = hasFinale
    ? fitFontSize(slots.finale as string, {
        fontSize: Math.round(118 * tuneScale),
        maxWidthPx: landscape ? width - 240 : 900,
        shrinkFloorPx: 56,
        letterSpacingEm: -0.03,
      })
    : 0;

  // 中心光晕:呼吸周期 = TRAVEL_SEC(与词过镜节奏对齐,不打拍);finale 到场时增亮托底
  const glowBreath = 0.62 + 0.12 * Math.sin((t / TRAVEL_SEC) * Math.PI * 2);
  const glowOpacity = hasFinale ? glowBreath + 0.22 * finaleT : glowBreath;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* 隧道纵深底:中心比四周亮一档(demo 的 radial #131a2c→#05060b 的令牌版),
          第 0 帧就在——首帧不黑 */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(58% 40% at 50% 47%, ${alpha(P.surfaceRaised, 0.7)} 0%, ${alpha(P.surface, 0.28)} 46%, transparent 74%)`,
        }}
      />
      {/* 透视场景:相机不动、元素动 */}
      <div style={{position: 'absolute', inset: 0, perspective: PERSPECTIVE, overflow: 'hidden'}}>
        <div
          style={{
            position: 'absolute',
            left: cx,
            top: cy,
            width: 0,
            height: 0,
            transformStyle: 'preserve-3d',
          }}
        >
          {items.map((it, i) => {
            // 恒速循环:u∈[0,1) 是本词这一趟的生命进度,相位 i/N 均分错开
            const u = (t / TRAVEL_SEC + it.ph) % 1;
            const z = Z_FAR + (Z_NEAR - Z_FAR) * u;
            // 远处收拢在中心、越近越向外甩,与 z 推进叠成真透视
            const drift = 0.5 + u * 1.35 + (hasFinale ? wordsOut * 0.6 : 0);
            // 深处出生:糊(u<0.16 反向模糊)+ 暗(生命曲线前段);近端擦身:糊(u>0.86)
            const blur =
              u > 0.86 ? (u - 0.86) * 58 : u < 0.16 ? (0.16 - u) * 30 : 0;
            return (
              <EditableText as="div" part={`word-${i}`}
                key={`${it.text}-${i}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transformOrigin: '50% 50%',
                  whiteSpace: 'nowrap',
                  ...textStyle(T, 'h1'),
                  ...(tuneFont ? {fontFamily: tuneFont} : {}),
                  fontSize: it.fontSize,
                  lineHeight: 1,
                  color: it.color,
                  textShadow: `0 0 24px ${it.glow}`,
                  // 以字块中心为原点(近似):水平半宽 ≈ 1.1em,垂直半高 0.5em
                  margin: '-0.5em 0 0 -1.1em',
                  transform: `translate3d(${it.x * drift}px, ${it.y * drift}px, ${z}px) rotateZ(${it.rz}deg)`,
                  opacity: lifeCurve(u) * (1 - wordsOut),
                  filter: blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : 'none',
                }}
              >
                {it.text}
              </EditableText>
            );
          })}
          {/* finale:从深处推到中央定格(英雄帧)。挂在同一透视场里,z 轴语义一致 */}
          {hasFinale ? (
            <div
              style={{
                position: 'absolute',
                left: -width / 2,
                top: 0,
                width,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transform: `translate3d(0px, 0px, ${finaleZ}px) translateY(-50%) scale(${0.985 + 0.015 * finaleSpring})`,
                opacity: finaleOpacity,
                filter: finaleBlur > 0.1 ? `blur(${finaleBlur.toFixed(2)}px)` : 'none',
              }}
            >
              <EditableText as="div" part="finale"
                style={{
                  ...textStyle(T, 'hero'),
                  ...(tuneFont ? {fontFamily: tuneFont} : {}),
                  fontSize: finaleSize,
                  lineHeight: 1.12,
                  color: P.ink,
                  textAlign: 'center',
                  textShadow: `0 0 46px ${alpha(P.accent, 0.32)}`,
                  maxWidth: landscape ? width - 240 : 940,
                }}
              >
                {slots.finale}
              </EditableText>
              <div
                style={{
                  width: 176,
                  height: 5,
                  marginTop: 38,
                  borderRadius: 3,
                  background: P.accent,
                  transform: `scaleX(${ruleIn})`,
                  opacity: ruleIn,
                }}
              />
            </div>
          ) : null}
        </div>
        {/* 隧道尽头光晕(DOM 序在词语之后 → 叠上层):颜色从 accent 派生,呼吸对齐过镜节奏 */}
        <div
          style={{
            position: 'absolute',
            left: cx - 250,
            top: cy - 250,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha(P.accent, 0.2)} 0%, transparent 66%)`,
            filter: 'blur(14px)',
            opacity: glowOpacity,
          }}
        />
      </div>
      <Foreground />
    </EditorScene>
  );
};

export const PresetFlyingWords: React.FC<PresetFlyingWordsProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
