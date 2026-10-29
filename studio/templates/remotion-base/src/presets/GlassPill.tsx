import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/GlassPill.tsx —— 玻璃胶囊打字 preset(docs/presets/glass-pill/preset.json)
//
// 复刻来源:src/shotcraft/GlassPillDictationTyping.tsx(video-shotcraft 逐帧验证版,2026-08-20)
// 配方卡:docs/catalog/recipes-external/interaction/glass-pill-dictation-typing.md
//
// 与参考复刻的三处刻意偏差(其余时序性格照搬):
// - 参考版用 useLayoutEffect 实测文本宽度定胶囊定宽——渲染期 DOM 测量在并行渲染下
//   首帧可能拿到兜底值,这里换成 style/fit.ts 的 estimateTextWidth(确定性,与展开器同口径)。
// - 参考版的光"随打字熄灭到底"(收尾成中性玻璃条);preset 版收到 55% 后保住游走辉光——
//   竖版画面只有这一条胶囊,光全灭之后画面墨量撑不住,也失去"AI 待命"的语义。
// - 强调色不再是写死的紫(ACCENT_RGB):辉光色相从 skin.accentHue 走 oklch 派生,
//   换皮肤/调 accentHue 旋钮时光跟着走。
//
// 时序(绝对秒;打字窗口随 durationSeconds 伸缩,其余相位冻结):
//   0.00s  底 + Backdrop 已在(首帧不黑)
//   0.00s  胶囊弹入:scale 1.16→1(唯一弹簧名额,轻过冲一次)+ blur 14→0 收敛 0.3s
//   0.20s  光标先行淡入(输入框已就绪的信号,早于第一个字)
//   0.35s  打字开始:逐字**匀速**铺完(加 ease 会读作"有人在犹豫"——配方卡)
//          结束于 durationSeconds−0.6s → 静置恒 ≥0.5s
//   0.55s  caption 下方上浮淡入 0.4s
//   打完   光标转为慢闪,辉光收到 55% 继续慢速游走,右端图标轻微呼吸
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {fitFontSize, estimateTextWidth} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetGlassPillProps = {
  durationSeconds: number;
  variant?: {icon?: 'mic' | 'search' | 'sparkle'};
  slots: {text: string; caption?: string};
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

// —— 胶囊几何(1080 竖版;参考复刻 480 设计系 ×2.25 后取整微调)——
const PH = 104; // 胶囊高
const ICON = 64; // 右端图标方块
const PAD_L = 42;
const PAD_R = 18;
const CARET_ZONE = 11; // 光标宽 5 + 左边距 6
const AIR = 112; // 定宽富余:胶囊要比文字宽一截才读作"输入条"而不是 chip(配方卡)
const PILL_MAX = 888;
const TEXT_MAX = 640; // = PILL_MAX − PAD_L − PAD_R − ICON − CARET_ZONE − AIR
const FONT_BASE = 46;
const PILL_CENTER_Y = 900;
const CAPTION_TOP = 1560;

const seg = (frame: number, fromSec: number, durSec: number, fps: number) =>
  interpolate(frame, [fromSec * fps, (fromSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

/** 匀速版 seg:打字进度专用(配方卡:加 ease 就读作"有人在犹豫") */
const linSeg = (frame: number, fromSec: number, toSec: number, fps: number) =>
  interpolate(frame, [fromSec * fps, toSec * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/** 右端图标(内联 SVG,描边色走令牌)。mic=听写 / search=搜索 / sparkle=AI */
const PillIcon: React.FC<{kind: 'mic' | 'search' | 'sparkle'; stroke: string}> = ({kind, stroke}) => {
  const common = {
    width: 34,
    height: 34,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'search') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6.4" />
        <path d="M15.7 15.7 L20.3 20.3" />
      </svg>
    );
  }
  if (kind === 'sparkle') {
    return (
      <svg {...common}>
        <path d="M12 3.2 L13.9 10.1 L20.8 12 L13.9 13.9 L12 20.8 L10.1 13.9 L3.2 12 L10.1 10.1 Z" />
        <path d="M18.6 3.4 L19.2 5.6 L21.4 6.2 L19.2 6.8 L18.6 9 L18 6.8 L15.8 6.2 L18 5.6 Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="9" y="2.8" width="6" height="11" rx="3" />
      <path d="M5.6 11.2 a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.6 V20.8" />
    </svg>
  );
};

const Inner: React.FC<PresetGlassPillProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const pillMax = landscape ? Math.min(width - 192, 1400) : PILL_MAX;
  const textMax = landscape ? pillMax - 248 : TEXT_MAX;
  const {P, T, pad, skin} = useBaseline();
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const icon = variant?.icon ?? 'mic';
  const sec = frame / fps;

  // —— 辉光色:从皮肤的 accentHue 走 oklch 派生(不写死 hex,换皮肤/调旋钮时光跟着走)——
  // glowCore 比 P.accent(L 0.72)亮一档:它演的是"发光体"不是"涂了色的面"
  const glowCore = oklch(0.78, 0.17, skin.accentHue);
  // 同色相低彩度铺底,负责胶囊内左暗右亮的渐层
  const glowSoft = oklch(0.6, 0.12, skin.accentHue);

  // —— 定宽:估宽替代 DOM 测量(确定性;字太长先缩字号,缩到 30px 仍超宽则硬失败)——
  const fontSize = Math.round(
    fitFontSize(slots.text, {fontSize: landscape ? 60 : FONT_BASE, maxWidthPx: textMax, shrinkFloorPx: 30}) * tuneScale,
  );
  const textW = estimateTextWidth(slots.text, fontSize);
  const PW = Math.min(pillMax, Math.max(landscape ? 780 : 480, Math.round(textW + PAD_L + PAD_R + ICON + CARET_ZONE + AIR)));

  // —— 弹入:唯一弹簧名额。1.16→1,damping 12 给一次 ~0.5% 的轻过冲(落过头再回来)——
  const spr = spring({frame, fps, config: {damping: 12, stiffness: 140, mass: 0.9}});
  const scale = 1 + 0.16 * (1 - spr);
  const pillIn = seg(frame, 0, 0.1, fps);
  const blurPx = 14 * (1 - seg(frame, 0, 0.3, fps));

  // —— 打字:0.35s 起匀速,结束于 durationSeconds−0.6(静置恒 ≥0.5s);速度按字数自适应 ——
  const chars = Array.from(slots.text);
  const typeStart = 0.35;
  const typeEnd = Math.max(typeStart + 0.4, durationSeconds - 0.6);
  const typeProg = linSeg(frame, typeStart, typeEnd, fps);
  // epsilon 防止末字符在整点因浮点误差不出现(配方卡点名的坑,别删)
  const shown = chars.slice(0, Math.floor(typeProg * chars.length + 1e-6)).join('');
  const typed = typeProg >= 1;

  // —— 光标:0.2s 先行出现(早于第一个字=「输入框已就绪」);打完转慢闪(0.8s 方波)——
  const caretIn = seg(frame, 0.2, 0.1, fps);
  const blink = typed ? ((frame - Math.round(typeEnd * fps)) % 24 < 15 ? 1 : 0.1) : 1;
  const caretO = caretIn * blink;

  // —— 辉光能级:打完收到 55%(向配方卡"光让位给文字"点头,但不全灭——
  //    竖版全画面只有这条胶囊,光全灭墨量撑不住)——
  const glowLevel = 1 - 0.45 * seg(frame, typeEnd, 0.4, fps);
  // 游走:辉光中心沿胶囊长轴慢速往返(周期 3.2s,确定性正弦;起相 +0.55 让首帧光在右侧,
  // 与参考复刻"左暗右亮"的第一印象一致)
  const glowX = PW * (0.62 + 0.24 * Math.sin(sec * ((Math.PI * 2) / 3.2) + 0.55));
  const glowW = PW * 0.62;

  // —— 图标呼吸:极轻(scale ±3.5%);幅度再大就成了"正在录音",与"待命"矛盾(配方卡)——
  const breath = 1 + 0.035 * Math.sin(sec * 2.1);

  const capIn = seg(frame, 0.55, 0.4, fps);

  // 玻璃高光的"白":dark 模式 P.ink 就是近白;light 模式 ink 是深色,换 surfaceRaised(纯白)
  const sheen = P.mode === 'light' ? P.surfaceRaised : P.ink;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* —— 玻璃胶囊 —— */}
      <div
        style={{
          position: 'absolute',
          top: (landscape ? height * 0.46 : PILL_CENTER_Y) - PH / 2 + (tune?.y ?? 0),
          left: (width - PW) / 2 + (tune?.x ?? 0),
          width: PW,
          height: PH,
          borderRadius: PH / 2,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${PAD_R}px 0 ${PAD_L}px`,
          overflow: 'hidden',
          opacity: pillIn,
          transform: `scale(${scale})`,
          filter: blurPx > 0.15 ? `blur(${blurPx}px)` : undefined,
          // 玻璃感 = 半透明填充(上亮下暗)+ 内外双描边 + 顶部高光 + 外侧强调色泛光
          background: `linear-gradient(180deg, ${alpha(sheen, 0.1)} 0%, ${alpha(sheen, 0.03)} 55%, ${alpha(sheen, 0.06)} 100%)`,
          boxShadow: [
            `inset 0 0 0 1.5px ${alpha(sheen, 0.3)}`, // 内描边(玻璃棱)
            `0 0 0 1px ${alpha(sheen, 0.09)}`, // 外描边(轮廓再压一圈)
            `inset 0 22px 34px ${alpha(sheen, 0.06)}`, // 顶部内高光
            `0 0 ${Math.round(46 * glowLevel)}px ${alpha(glowCore, 0.28 * glowLevel)}`, // 强调色泛光
            `0 26px 60px ${alpha('#000000', P.mode === 'light' ? 0.16 : 0.45)}`, // 落影
          ].join(', '),
        }}
      >
        {/* 底层渐层:左暗右亮的强调色铺底(光在胶囊内部,不是外部光晕——配方卡) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `linear-gradient(90deg, transparent 0%, ${alpha(glowSoft, 0.14 * glowLevel)} 42%, ${alpha(glowCore, 0.3 * glowLevel)} 100%)`,
          }}
        />
        {/* 游走辉光:一团柔和的径向光沿长轴慢速往返 */}
        <div
          style={{
            position: 'absolute',
            left: glowX - glowW / 2,
            top: -PH * 0.65,
            width: glowW,
            height: PH * 2.3,
            pointerEvents: 'none',
            background: `radial-gradient(closest-side, ${alpha(glowCore, 0.36 * glowLevel)} 0%, transparent 72%)`,
          }}
        />
        {/* 打字文本 */}
        <EditableText as="div" part="text"
          style={{
            position: 'relative',
            ...textStyle(T, 'body'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize,
            lineHeight: 1,
            color: P.ink,
            whiteSpace: 'pre',
            flex: 'none',
          }}
        >
          {shown}
        </EditableText>
        {/* 光标 */}
        <div
          style={{
            position: 'relative',
            width: 5,
            height: Math.round(fontSize * 1.1),
            borderRadius: 2.5,
            background: P.ink,
            marginLeft: 6,
            flex: 'none',
            opacity: caretO,
          }}
        />
        {/* 右端图标方块(轻微呼吸) */}
        <div
          style={{
            position: 'relative',
            marginLeft: 'auto',
            width: ICON,
            height: ICON,
            borderRadius: 20,
            boxSizing: 'border-box',
            border: `2px solid ${alpha(sheen, 0.45)}`,
            background: alpha(sheen, 0.05),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
            transform: `scale(${breath})`,
            boxShadow: `0 0 18px ${alpha(glowCore, 0.1 + 0.14 * glowLevel)}`,
          }}
        >
          <PillIcon kind={icon} stroke={alpha(P.ink, 0.92)} />
        </div>
      </div>
      {/* caption:下方一行说明,上浮淡入 */}
      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            top: landscape ? height * 0.68 : CAPTION_TOP,
            left: pad,
            right: pad,
            textAlign: 'center',
            ...textStyle(T, 'label'),
            color: P.inkSecondary,
            opacity: capIn,
            transform: `translateY(${18 * (1 - capIn)}px)`,
          }}
        >
          {slots.caption}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;TuneSkin 只在旋钮生效时包 Provider
export const PresetGlassPill: React.FC<PresetGlassPillProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
