import {EditableText, EditorScene, useTransparentBackground} from '../editor/preset-editing';
// presets/PhoneRipple.tsx —— 波纹手机芯片 preset(docs/presets/phone-ripple/preset.json)
//
// 定位:移动端产品的"这就是它"定格镜——同心波纹负责氛围呼吸,手机屏内自动滚动
// 负责证明"里面有内容在跑",两侧功能芯片负责点出卖点名。三层动作各自极慢,
// 叠起来才不显得静止(配方卡 docs/catalog/recipes-external/effects/radial-ripple-phone-chips.md)。
//
// 复刻来源:src/shotcraft/RadialRipplePhoneChips.tsx(video-shotcraft 逐帧验证版)。
// 横版 480×270 demo 重排为 1080×1920 竖版:手机放大到 560 宽居中(中心 y≈830),
// 芯片错落贴两侧,caption 落 ~y1600。所有像素值按竖版画布直接标定,不走 DesignStage。
//
// ============ 从配方卡搬来的手感(改前先读) ============
// - 波纹是**实色圆叠放**(不是描边环),必须由大到小 append,顺序反了只剩最大一层;
//   错相(相邻 1.7rad)是"水波"而非"整体缩放"的关键;呼吸幅度 ±0.05 已near上限,
//   到 0.1 就读作"脉冲动画"。频率按**绝对秒**定(0.27Hz),4s 和 8s 的版本性格一致。
// - 屏内滚动**匀速无缓动**(t 0.08→0.98):加 ease 立刻读作"有人在滑",匀速才是自动播放。
// - chip pop 用 outBack 的过冲,那是"弹出"的全部质感;左右先后错开(0.5s)才有
//   "一个一个说"的节奏;pop 完悬浮 ±6px 渐渐介入,不是一落位就开始飘。
// - chip 锚在 calc(50% ± CHIP_ANCHOR):改手机宽度必须同步改 CHIP_ANCHOR,否则压屏。
// - 换真实截图滚动时,内容总高必须 > 滚动距离 + 屏高,否则滚到底露白——这里对
//   scrollDist 做了 min(可滚上限, 1.15 屏高) 双保险。
//
// ============ 颜色(零 hex) ============
// 波纹/手机壳/屏内骨架全部用 oklch(L, skin.neutralChroma, P.hue) 从皮肤中性系派生:
// 暗皮肤下波纹从 bg(L0.17)向上逐层提亮(外暗内亮=光从中心荡开),亮皮肤(paper)
// 反向压暗。芯片是**亮面**(L0.96 近白):暗皮肤下它就是画面里的高光点,和亮屏一个
// 材质家族——这是配方原片"白 chip"的正确移植,不要改成暗底芯片。
// 强调色只出现在骨架流缩略图渐变里(alpha(P.accent)),面积天然 <10%。
import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {TUNE_FONTS} from './KeyConcept';
import {CALM, ENTER} from '../lib/anim';

export type PresetPhoneRippleProps = {
  durationSeconds: number;
  variant?: Record<string, never>;
  slots: {chips: string[]; screenshot?: string; imgW?: number; imgH?: number; caption?: string};
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
// 版式常量(1080×1920 直接标定)
// ---------------------------------------------------------------------------
const CX = 540;
const CY = 830; // 波纹与手机的共同中心
const PHONE = {w: 560, h: 1120, r: 92, bezel: 26}; // border-box;屏 = 内缩 bezel
const SCREEN = {w: PHONE.w - PHONE.bezel * 2, h: PHONE.h - PHONE.bezel * 2, r: 68};
/** chip 锚:calc(50% ± CHIP_ANCHOR) 是 chip 靠手机那侧的边缘。
 *  手机半宽 280,锚 240 → chip 尖端压在 bezel 上(阴影负责和亮屏分开)。
 *  改 PHONE.w 必须同步改这里(配方卡已知坑 #1)。 */
const CHIP_ANCHOR = 240;
/** 波纹直径,由大到小(顺序即层序,不许倒)。最大 1560 在 1080 宽下两侧被裁,
 *  竖版里读作"波充满画面";最内 680 比手机宽 120px,两侧各露 60px 弧。 */
const RIPPLE_SIZES = [1560, 1240, 940, 680];
const RIPPLE_FREQ = 0.27; // Hz,绝对秒——伸缩时长不改呼吸性格(≈5.6s 走 1.5 周期)
const FLOAT_FREQ = 0.36; // Hz,chip 悬浮
const CAPTION_TOP = 1600;

// 确定性伪随机(等价 Remotion random(seed);不 import shotcraft,内联一份)
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// outBack:chip pop 的过冲缓动(纯函数,配方卡点名——换 outCubic 就平了)
const outBack = (t: number) => {
  const s = 1.70158;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

const seg = (
  frame: number,
  fromSec: number,
  durSec: number,
  fps: number,
  easing: (t: number) => number = ENTER,
) =>
  interpolate(frame, [fromSec * fps, (fromSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });

const Inner: React.FC<PresetPhoneRippleProps> = ({slots, tune}) => {
  const frame = useCurrentFrame();
  const transparentBackground = useTransparentBackground();
  const {fps, durationInFrames, width, height} = useVideoConfig();
  const landscape = width > height;
  const cx = landscape ? width / 2 : CX;
  const cy = landscape ? height * 0.47 : CY;
  const phone = landscape ? {w: 360, h: 720, r: 60, bezel: 17} : PHONE;
  const screen = landscape ? {w: phone.w - phone.bezel * 2, h: phone.h - phone.bezel * 2, r: 44} : SCREEN;
  const chipAnchor = landscape ? phone.w / 2 + 38 : CHIP_ANCHOR;
  const rippleSizes = landscape ? [1800, 1400, 1000, 600] : RIPPLE_SIZES;
  const {P, T, skin} = useBaseline();
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const sec = frame / fps;

  // ---- 皮肤派生色(全部 oklch/alpha,零 hex 字面量) ----
  const nC = skin.neutralChroma;
  const light = P.mode === 'light';
  // 波纹:暗皮肤从 bg 向上提亮(外→内),亮皮肤从 bg 向下压暗;都只动 L 不动色相
  const rippleL = light ? [0.885, 0.912, 0.938, 0.958] : [0.205, 0.235, 0.267, 0.3];
  const rippleColors = rippleL.map((L, i) =>
    // 最内层轻轻染一点 accent 色相(低彩度),像波心透出的光;外三层纯中性
    i === rippleSizes.length - 1 ? oklch(L, nC * 2.2, P.accentHue) : oklch(L, nC * 1.5, P.hue),
  );
  const shadowTint = oklch(0.06, nC, P.hue); // 投影用染色黑,不用纯 #000
  const shell = oklch(0.14, nC * 1.2, P.hue); // 手机壳:两种模式都是近黑(戏中物)
  const screenBg = oklch(0.975, nC * 0.5, P.hue); // 亮屏:暗皮肤下的光源
  const cardBg = oklch(0.945, nC * 0.8, P.hue);
  const bar1 = oklch(0.8, nC * 1.2, P.hue);
  const bar2 = oklch(0.87, nC, P.hue);
  const chipBg = oklch(0.965, nC * 0.6, P.hue); // 亮面芯片(见文件头注)
  const chipInk = oklch(0.24, nC * 1.4, P.hue);

  // ---- 手机落位:0→0.55s 上浮 36px + scale 0.965→1(CALM,大元素不许甩) ----
  const phoneIn = seg(frame, 0, 0.55, fps, CALM);

  // ---- 屏内滚动:全片 8%→98% 匀速(linear 是刻意的,不许加 ease) ----
  const scrollP = interpolate(
    frame,
    [0.08 * durationInFrames, 0.98 * durationInFrames],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // ---- 屏内内容:给了截图滚真实页面,没给滚骨架流 ----
  const hasShot = Boolean(slots.screenshot);
  let screenContent: React.ReactNode;
  if (hasShot && slots.screenshot) {
    const imgW = Math.max(1, slots.imgW ?? 1080);
    const imgH = Math.max(1, slots.imgH ?? 1920);
    const scaledH = screen.w * (imgH / imgW);
    // 双保险:可滚上限(不露白)与 1.15 屏高(长图不许滚成快进)取小
    const scrollDist = Math.min(Math.max(0, scaledH - screen.h), screen.h * 1.15);
    // 路径约定与 ScreenPush 一致:含 / 视为 public/ 完整相对路径,裸文件名补 screens/
    const src = slots.screenshot.includes('/') ? slots.screenshot : `screens/${slots.screenshot}`;
    screenContent = (
      <Img
        src={/^(https?:|data:|blob:|\/)/.test(src) ? src : staticFile(src)}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: screen.w,
          height: scaledH,
          transform: `translateY(${-scrollDist * scrollP}px)`,
        }}
      />
    );
  } else {
    // 骨架流:8 张占位卡(渐变缩略图 + 两条 rand 定宽灰条),种子内联、跨渲染一致。
    // 尺寸 = 原 demo × 4.3(屏宽 508/原屏 118);总高 ≈2650px > 滚动 640 + 屏高 1068,不露白
    const cards = Array.from({length: 8}, (_, i) => ({
      grad: `linear-gradient(120deg, ${alpha(P.accent, 0.5 - i * 0.04)}, ${alpha(P.accent, 0.8 - i * 0.05)})`,
      l1w: `${62 + rand(i) * 28}%`,
      l2w: `${34 + rand(i + 40) * 30}%`,
    }));
    screenContent = (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          transform: `translateY(${-640 * scrollP}px)`,
        }}
      >
        {cards.map(({grad, l1w, l2w}, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} style={{margin: '34px 34px 0', padding: 30, borderRadius: 34, background: cardBg}}>
            <div style={{height: 146, borderRadius: 22, background: grad}} />
            <div style={{marginTop: 26, height: 21, width: l1w, borderRadius: 12, background: bar1}} />
            <div style={{marginTop: 17, height: 21, width: l2w, borderRadius: 12, background: bar2}} />
          </div>
        ))}
      </div>
    );
  }

  // ---- 功能芯片:左右交替、自上而下,1.0s 起每 0.5s 一个,outBack pop 后渐入悬浮 ----
  const chips = slots.chips.slice(0, 5);
  const n = chips.length;
  const chipYTop = landscape ? height * 0.22 : 500;
  const chipYSpan = n > 1 ? (landscape ? height * 0.47 : 700) / (n - 1) : 0;
  const caption = slots.caption;

  const capIn = seg(frame, 1.7, 0.5, fps, ENTER);
  const capSize = caption
    ? Math.round(fitFontSize(caption, {fontSize: 54, maxWidthPx: landscape ? width - 240 : 936, shrinkFloorPx: 34}) * tuneScale)
    : 0;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: skin.id === 'graphite' ? 'visible' : 'hidden'}}>
      <Backdrop />
      {/* tune.x/y 平移整个"波纹+手机+芯片"组,caption 不跟着走(它锚在底部安全区) */}
      <div style={{position: 'absolute', inset: 0, transform: `translate(${tune?.x ?? 0}px, ${(tune?.y ?? 0)}px)`}}>
        {/* 同心波纹:实色圆由大到小叠放,错相呼吸(第 0 帧就有,首帧不黑不空) */}
        {rippleSizes.map((size, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div
            key={i}
            style={{
              position: 'absolute',
              left: cx - size / 2,
              top: cy - size / 2,
              width: size,
              height: size,
              borderRadius: '50%',
              background: transparentBackground ? 'transparent' : rippleColors[i],
              border: transparentBackground ? `2px solid ${alpha(P.accent, 0.16)}` : undefined,
              boxSizing: 'border-box',
              transform: `scale(${1 + 0.05 * Math.sin(sec * Math.PI * 2 * RIPPLE_FREQ + i * 1.7)})`,
            }}
          />
        ))}

        {/* 手机 mockup:落地投影是"浮在波上"的唯一依据,不许去掉 */}
        <div
          style={{
            position: 'absolute',
            left: cx - phone.w / 2,
            top: cy - phone.h / 2,
            width: phone.w,
            height: phone.h,
            borderRadius: phone.r,
            background: shell,
            padding: phone.bezel,
            boxSizing: 'border-box',
            boxShadow: `0 64px 140px ${alpha(shadowTint, light ? 0.35 : 0.55)}`,
            opacity: 0.5 + 0.5 * phoneIn,
            transform: `translateY(${36 * (1 - phoneIn)}px) scale(${0.965 + 0.035 * phoneIn})`,
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              borderRadius: screen.r,
              background: screenBg,
              overflow: 'hidden',
            }}
          >
            {screenContent}
          </div>
        </div>

        {/* 芯片:pop(outBack 过冲=唯一弹簧名额)→ 0.75s 内渐入 ±6px 悬浮 */}
        {chips.map((text, i) => {
          const t0 = 1.0 + i * 0.5;
          const pop = seg(frame, t0, 0.55, fps, outBack);
          const fade = seg(frame, t0, 0.25, fps, ENTER);
          const floatIn = seg(frame, t0 + 0.55, 0.75, fps, ENTER);
          const floatY = Math.sin(sec * Math.PI * 2 * FLOAT_FREQ + i * 1.8) * 6 * floatIn;
          const left = i % 2 === 0; // 左起交替(配方:左先右后)
          const jitter = Math.round(rand(i * 7 + 3) * 36 - 18); // 错落,不排成直线
          const size = Math.round(
            fitFontSize(text, {fontSize: landscape ? 48 : 40, maxWidthPx: landscape ? 440 : 210, shrinkFloorPx: 24}) * tuneScale,
          );
          return (
            <EditableText as="div" part={`chip-${i}`}
              key={text}
              style={{
                position: 'absolute',
                top: chipYTop + i * chipYSpan + jitter,
                ...(left
                  ? {right: `calc(50% + ${chipAnchor}px)`}
                  : {left: `calc(50% + ${chipAnchor}px)`}),
                padding: '16px 34px',
                borderRadius: 999,
                background: chipBg,
                whiteSpace: 'nowrap',
                boxShadow: `0 20px 52px ${alpha(shadowTint, light ? 0.24 : 0.45)}`,
                opacity: fade,
                transform: `scale(${0.8 + 0.2 * pop}) translateY(${floatY}px)`,
                ...textStyle(T, 'label'),
                ...(tuneFont ? {fontFamily: tuneFont} : {}),
                fontSize: size,
                color: chipInk,
              }}
            >
              {text}
            </EditableText>
          );
        })}
      </div>

      {/* caption:底部淡入上浮,居中 */}
      {caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            top: landscape ? height * 0.88 : CAPTION_TOP,
            left: 72,
            right: 72,
            textAlign: 'center',
            ...textStyle(T, 'h2'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: capSize,
            color: P.ink,
            lineHeight: 1.4,
            opacity: capIn,
            transform: `translateY(${20 * (1 - capIn)}px)`,
          }}
        >
          {caption}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetPhoneRipple: React.FC<PresetPhoneRippleProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
