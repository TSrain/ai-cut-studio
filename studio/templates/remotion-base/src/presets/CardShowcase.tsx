import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/CardShowcase.tsx —— 卡片列阵 preset(docs/presets/card-showcase/preset.json)
//
// 复刻来源:src/shotcraft/CardStack.tsx(fan 档)+ Carousel3D.tsx(carousel 档),
// video-shotcraft 逐帧验证版(2026-08-20)。配方卡:docs/catalog/recipes-external/
// ui-entrance/card-stack.md · ui-entrance/carousel-3d.md。横版 480×270 demo 重标定为
// 1080×1920 竖版(几何 ×2.25 后再按竖版画框收拢:轨道横向半径 ≤440)。
//
// 时序(timing is frozen,绝对秒;durationSeconds 伸缩全部落在末段定格):
//   carousel(默认):0.00s 底已在(首帧不黑);卡片 0.04s/张 stagger 缩放浮现(0.5s/张);
//     圆环 0→3.6s 自转**恰好 360°**(MOVE 缓起缓收,末帧与排布起点重合、0 号卡正对镜头);
//     3.0s caption 底部淡入;3.6s 起整体定格。
//   fan:0.05s 起 0.13s/张从画框下方 deal 弹入(0.55s/张,本镜唯一弹簧名额);
//     短暂齐整(牌堆带确定性微乱);1.7→2.6s 整摞展开成 3D 扇形(MOVE);
//     2.4s caption 淡入;2.6s 起定格在扇形英雄帧。
//
// 复刻要点与坑(配方卡逐条核对):
// - carousel 防镜像(配方卡点名):每卡正反两层**同向**贴图 + backface-visibility:hidden,
//   环转到背面看到的是 back 层的正读文字——任何一帧不出现镜像/倒置。卡只绕 Y 公转,
//   永不绕 X/Z;相机全程固定(浅俯角),运动全部来自环的自转。
// - carousel 背面卡压暗:按世界方位角的 cos 算深度,卡面上叠一层黑纱(背面 ≈0.6)。
// - fan 两层运动分离叠加:deal(每张自己的 spring 进度)与扇形(全员共享一条展开进度);
//   transform-origin 50% 130% 让卡绕"手腕"转开;末张 deal 结束(n=8 时 ≈1.51s)早于
//   展开起点 1.7s——不出现配方卡警告的"还在飞就开始转"。
// - 卡色从皮肤 accentHue 派生一圈邻近色相(±16°/张,oklch 同明度同彩度,换色相不跳明度),
//   不写死紫红 hex;骨架线宽度用确定性 rand(种子=卡序号),同 seed 逐位可复现。
// - 弹簧名额:fan 档的 deal 落位是唯一弹簧(闭式阻尼余弦,手抄自 shotcraft/Motion.tsx 的
//   E.spring——**禁止 import src/shotcraft**);carousel 档零弹簧。
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {TUNE_FONTS} from './KeyConcept';
import {ENTER, MOVE} from '../lib/anim';

export type PresetCardShowcaseProps = {
  durationSeconds: number;
  variant?: {mode?: 'fan' | 'carousel'};
  slots: {cards: string[]; caption?: string};
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
// 几何常数(1080×1920 竖版标定)
// ---------------------------------------------------------------------------
const CARD_W = 250; // 参考实现 110×150 / 92×124 ×2.25 后统一到一副牌的尺寸
const CARD_H = 340;
const RING_Y = 840; // 圆环/牌堆的画面纵心(caption 在 1560,互不侵入)
const STACK_Y = 880;
const CAPTION_TOP = 1560;

// carousel 时间窗(绝对秒)
const REV_END = 3.6; // 0→3.6s 恰好一整圈
const CAROUSEL_CAP_START = 3.0;
// fan 时间窗(绝对秒)
const DEAL_START = 0.05;
const DEAL_STAGGER = 0.13; // ≈4 帧:配方卡"一串"手感(≥8f 读作点名,≤2f 读作一团)
const DEAL_DUR = 0.55;
const FAN_START = 1.7; // 必须晚于末张 deal 结束(n=8 → 1.51s),配方卡点名的坑
const FAN_END = 2.6;
const FAN_CAP_START = 2.4;

/** 闭式阻尼弹簧(手抄 src/shotcraft/Motion.tsx E.spring,bounce=0.3 一次可见回弹) */
const springE = (t: number, bounce = 0.3) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const w = 8 + 8 * (1 - bounce);
  return 1 - Math.exp(-6 * t) * Math.cos(w * t * bounce * 2.2);
};

/** 确定性伪随机(手抄 shotcraft/Motion.tsx rand,种子=卡序号,跨帧跨渲染可复现) */
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const seg = (frame: number, fromSec: number, durSec: number, fps: number, easing = ENTER) =>
  interpolate(frame, [fromSec * fps, (fromSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });

type CardDatum = {title: string; note?: string; hue: number};

/** 每条 `标题 | 小注` 拆两段;卡色 = accentHue 为中心的邻近色相环(±16°/张) */
const parseCards = (cards: string[], accentHue: number): CardDatum[] => {
  const n = Math.max(1, cards.length);
  return cards.map((raw, i) => {
    const [title, note] = raw.split(/\s*\|\s*/);
    return {
      title: (title ?? '').trim() || raw.trim(),
      note: note?.trim() || undefined,
      // 邻近色相:整圈落在 accentHue±(n-1)*8° 内,始终读作"一家人",不会撞出撞色
      hue: accentHue + (i - (n - 1) / 2) * 16,
    };
  });
};

const Inner: React.FC<PresetCardShowcaseProps> = ({variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const cardW = landscape ? 320 : CARD_W;
  const cardH = landscape ? 400 : CARD_H;
  const ringY = landscape ? height * 0.46 : RING_Y;
  const stackY = landscape ? height * 0.43 : STACK_Y;
  const {P, T, pad, skin} = useBaseline();
  const light = P.mode === 'light';
  const mode = variant?.mode ?? 'carousel';
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const tuneScale = tune?.scale ?? 1;

  const cards = parseCards(slots.cards, P.accentHue);
  const n = cards.length;

  // -------------------------------------------------------------------------
  // 卡面(两档共用):序号 + 标题字 + 可选小注 + 两条骨架线(宽度确定性随机)
  // dim:carousel 背面压暗用;fan 恒 0
  // align:fan 扇形里中心卡压顶,左侧卡只露左条、右侧卡只露右条——文字贴到各自
  //       露出的那一侧才保证扇形定格(英雄帧)里每张卡的标题都读得到
  // -------------------------------------------------------------------------
  const renderFace = (d: CardDatum, i: number, dim: number, align: 'left' | 'right' = 'left') => {
    // fan 档标题压到 36:扇形里翼侧卡只露 ~145px 宽的条,4 字标题 36px(144px)恰好整字可读
    const titleSize = fitFontSize(d.title, {
      fontSize: landscape ? 46 : mode === 'fan' ? 36 : 42,
      maxWidthPx: cardW - 62,
      shrinkFloorPx: 24,
    });
    const ink = oklch(0.97, 0.012, d.hue);
    const inkSoft = oklch(0.84, 0.045, d.hue);
    const barA = alpha(oklch(0.86, 0.06, d.hue), 0.55);
    const barB = alpha(oklch(0.86, 0.06, d.hue), 0.28);
    const flexAlign = align === 'right' ? 'flex-end' : 'flex-start';
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: 26,
          display: 'flex',
          flexDirection: 'column',
          alignItems: flexAlign,
          textAlign: align,
        }}
      >
        <div style={{...textStyle(T, 'caption'), fontSize: 20, color: alpha(inkSoft, 0.8)}}>
          {String(i + 1).padStart(2, '0')}
        </div>
        <EditableText as="div" part={`card-${i}-title`}
          style={{
            ...textStyle(T, 'h2'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: titleSize,
            lineHeight: 1.16,
            color: ink,
            marginTop: 30,
          }}
        >
          {d.title}
        </EditableText>
        {d.note ? (
          <EditableText as="div" part={`card-${i}-note`}
            style={{
              ...textStyle(T, 'caption'),
              fontSize: 19,
              lineHeight: 1.45,
              color: alpha(inkSoft, 0.92),
              marginTop: 12,
            }}
          >
            {d.note}
          </EditableText>
        ) : null}
        <div style={{flex: 1}} />
        {/* 骨架线:让它读作"一张有内容的卡"(复刻 CardStack 卡面构成);宽度 rand 确定性 */}
        <div
          style={{
            width: (0.42 + rand(i) * 0.3) * 198,
            height: 7,
            borderRadius: 4,
            background: barA,
          }}
        />
        <div
          style={{
            width: (0.24 + rand(i + 9) * 0.26) * 198,
            height: 7,
            borderRadius: 4,
            background: barB,
            marginTop: 15,
            marginBottom: 18,
          }}
        />
        {/* 背面压暗纱(dim=0 时不可见);盖住整卡含边框内侧 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 22,
            background: alpha('#000000', dim),
            pointerEvents: 'none',
          }}
        />
      </div>
    );
  };

  const faceBase = (d: CardDatum): React.CSSProperties => ({
    position: 'absolute',
    inset: 0,
    borderRadius: 22,
    boxSizing: 'border-box',
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    background: skin.id === 'graphite' ? `linear-gradient(165deg, ${P.surfaceRaised}, ${P.surface})` : `linear-gradient(165deg, ${oklch(0.42, 0.1, d.hue)} 0%, ${oklch(0.27, 0.08, d.hue - 12)} 100%)`,
    border: `1.5px solid ${skin.id === 'graphite' ? P.line : alpha(oklch(0.75, 0.1, d.hue), 0.45)}`,
    boxShadow: `0 18px 60px ${alpha('#000000', light ? 0.28 : 0.55)}, inset 0 1px 0 ${alpha(
      oklch(0.9, 0.05, d.hue),
      0.28,
    )}`,
  });

  // -------------------------------------------------------------------------
  // carousel:圆轨自转一整圈。半径按卡数重标定,横向半径 ≤440(竖版画框约束)
  // -------------------------------------------------------------------------
  const renderCarousel = () => {
    // 弦距 ≈ 1.35 × 卡宽:配方卡"半径/卡宽 <1.5 时背面卡从缝里挤出来"的安全侧
    const radius = Math.min(landscape ? width * 0.35 : 440, Math.max(landscape ? 540 : 340, ((n * cardW) / (2 * Math.PI)) * 1.35));
    const spin = 360 * seg(frame, 0, REV_END, fps, MOVE); // 恰好 1 圈:末帧 0 号卡正对镜头
    return (
      <div style={{position: 'absolute', inset: 0, perspective: 2000}}>
        {/* 相机全程固定:浅俯角,轨道投成椭圆;所有运动来自环的自转 */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: ringY,
            width: 0,
            height: 0,
            transformStyle: 'preserve-3d',
            transform: 'translateZ(-260px) rotateX(-10deg)',
          }}
        >
          {/* 地面反光盘:给环一个落地参照,没有它环像悬空(复刻 Carousel3D) */}
          <div
            style={{
              position: 'absolute',
              left: -550,
              top: 168,
              width: 1100,
              height: 1100,
              borderRadius: '50%',
              transform: 'rotateX(90deg)',
              background: `radial-gradient(circle, ${alpha(P.accent, light ? 0.1 : 0.13)} 0%, transparent 62%)`,
            }}
          />
          <div style={{position: 'absolute', transformStyle: 'preserve-3d', transform: `rotateY(${spin}deg)`}}>
            {cards.map((d, i) => {
              const base = (i * 360) / n;
              // 世界方位角 → 深度(1 正对镜头 / -1 背面),背面压暗
              const world = (((base + spin) % 360) + 360) % 360;
              const depth = Math.cos((world * Math.PI) / 180);
              const dim = (light ? 0.42 : 0.6) * (1 - depth) * 0.5;
              const inT = seg(frame, 0.04 * i, 0.5, fps, ENTER);
              const face = renderFace(d, i, dim);
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: -cardW / 2,
                    top: -cardH / 2,
                    width: cardW,
                    height: cardH,
                    transformStyle: 'preserve-3d',
                    opacity: inT,
                    // 只绕 Y 公转 + billboard 朝外,永不绕 X/Z(正立的根本保证)
                    transform: `rotateY(${base}deg) translateZ(${radius}px) scale(${0.7 + 0.3 * inT})`,
                  }}
                >
                  {/* 正反两层同向贴图 + backface hidden:环内环外看到的都是正读的同一张卡 */}
                  <div style={faceBase(d)}>{face}</div>
                  <div style={{...faceBase(d), transform: 'rotateY(180deg)'}}>{face}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // fan:下方 deal 弹入成摞 → 短暂齐整 → 展开 3D 扇形定格
  // -------------------------------------------------------------------------
  const renderFan = () => {
    const fan = seg(frame, FAN_START, FAN_END - FAN_START, fps, MOVE);
    // 张角随卡数收缩(配方卡:角度与横移必须同比调,只加一样卡会互相穿插)
    const spread = Math.min(1, 6.5 / (n - 1));
    // 横移 = 相邻卡的错开量,也就是**翼侧卡露出来的那条的宽度** —— 它直接决定
    // 标题读不读得到。定值 88px 时 36px 的标题只露得下 2.4 个字,4 字标题被压掉尾字
    // (2026-08-21 自查帧实锤,5 张和 7 张都一样,说明瓶颈是错开量不是卡数)。
    // 改为吃满画框反推。**旋转甩幅必须算进预算**:卡绕 50% 130% 的"手腕"转开,
    // 转 θ 度会把卡心再向外甩 0.8·CARD_H·sinθ(n=7 时 27° → 123px)——只按 offset+半卡宽
    // 估算,最外两张会被画框切掉半个标题(2026-08-21 首版实锤)。
    const kMax = Math.max(0.5, (n - 1) / 2);
    const rotMaxRad = ((kMax * 9 * spread) * Math.PI) / 180;
    const swing = 0.8 * cardH * Math.sin(rotMaxRad); // 绕腕旋转的横向甩幅
    const halfW = (cardW / 2) * Math.cos(rotMaxRad) + (cardH / 2) * Math.sin(rotMaxRad); // 旋转后的半包围宽
    // 边距 24px:卡可以压出安全区(它是图形不是文字),但不许被画框切
    const offset = Math.max(56, Math.min(landscape ? 250 : 155, (width / 2 - 24 - swing - halfW) / kMax));
    return (
      <div style={{position: 'absolute', inset: 0, perspective: 2000}}>
        {cards.map((d, i) => {
          const k = i - (n - 1) / 2;
          const dealT = seg(
            frame,
            DEAL_START + i * DEAL_STAGGER,
            DEAL_DUR,
            fps,
            (t) => t, // spring 自己带曲线,进度线性喂入
          );
          // 唯一弹簧名额:deal 落位一次可见回弹(闭式,确定性)
          const y0 = (landscape ? height * 0.8 : 1320) * (1 - springE(dealT, 0.3));
          // 牌堆微乱(确定性):齐整段能看出"是一摞"(下层卡的角要露出来),
          // 展开时收干净,终态扇形是纯几何
          const jitterX = (rand(i) - 0.5) * 20 * (1 - fan);
          const jitterY = (rand(i + 31) - 0.5) * 16 * (1 - fan);
          const jitterR = (rand(i + 17) - 0.5) * 7 * (1 - fan);
          const rot = jitterR + k * 9 * spread * fan;
          const tx = jitterX + k * offset * fan;
          const y = jitterY + y0;
          const tz = -22 * Math.abs(k) * fan;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: stackY,
                width: cardW,
                height: cardH,
                marginLeft: -cardW / 2,
                marginTop: -cardH / 2,
                // 旋转轴在卡片下缘之外:扇柄在手里,卡绕"手腕"转开(改 50% 50% 会退化成风车)
                transformOrigin: '50% 130%',
                transform: `translate3d(${tx}px, ${y}px, ${tz}px) rotate(${rot}deg)`,
                opacity: Math.min(1, dealT * 4), // 飞行前 1/4 段吃满:实体运动,不是淡入
                zIndex: 40 - Math.round(Math.abs(k) * 4), // 中心卡压顶,向两侧递退
              }}
            >
              <div style={{...faceBase(d), backfaceVisibility: 'visible', WebkitBackfaceVisibility: 'visible'}}>
                {/* 文字贴各自露出的那一侧:左翼左对齐、中心与右翼右对齐(k=0 露的是整张) */}
                {renderFace(d, i, 0, k > 0.25 ? 'right' : 'left')}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // caption:底部 1560 淡入(carousel 3.0s / fan 2.4s),定格段静止读取
  // -------------------------------------------------------------------------
  const capStart = mode === 'carousel' ? CAROUSEL_CAP_START : FAN_CAP_START;
  const capIn = seg(frame, capStart, 0.5, fps, ENTER);
  const capLines = (slots.caption ?? '').split('\n');
  const capSize = slots.caption
    ? Math.round(
        Math.min(...capLines.map((l) => fitFontSize(l, {fontSize: 56, maxWidthPx: landscape ? width - 192 : 936, shrinkFloorPx: 36}))) *
          tuneScale,
      )
    : 0;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* 卡片列阵整簇挂 tune 的 x/y/scale(caption 不跟着挪,它有自己的版位) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${tune?.x ?? 0}px, ${tune?.y ?? 0}px) scale(${tuneScale})`,
          transformOrigin: '50% 44%',
        }}
      >
        {mode === 'carousel' ? renderCarousel() : renderFan()}
      </div>
      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            left: pad,
            right: pad,
            top: landscape ? height * 0.81 : CAPTION_TOP,
            textAlign: 'center',
            ...textStyle(T, 'h2'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: capSize,
            lineHeight: 1.4,
            color: P.ink,
            opacity: capIn,
            transform: `translateY(${18 * (1 - capIn)}px)`,
          }}
        >
          {capLines.map((l, i) => (
            <React.Fragment key={l}>
              {i > 0 ? <br /> : null}
              {l}
            </React.Fragment>
          ))}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetCardShowcase: React.FC<PresetCardShowcaseProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
