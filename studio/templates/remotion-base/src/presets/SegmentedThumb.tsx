import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/SegmentedThumb.tsx —— 分段开关特写 preset(docs/presets/segmented-thumb/preset.json)
//
// 复刻来源:src/shotcraft/SegmentedThumbHero.tsx(video-shotcraft 逐帧验证版,2026-08-20)
// 配方卡:docs/catalog/recipes-external/interaction/segmented-thumb-hero.md
//
// 画面:胶囊分段控件放大拍特写(控件即舞台,无页面上下文)。因果链四拍缺一不可:
// 光标滑入(有人来了)→ 按下+涟漪(做了决定)→ 滑块弹跳到目标段(世界响应)
// → 标签主次交换+强调点弹出(新身份确立)。caption 底部淡入作一句注脚。
//
// 横版 demo(控件 1080×220)→ 1080×1920 竖版重标定:控件 880×184 居中于 (540, 860),
// 特写感靠控件占满安全区宽度;caption 落 y≈1560。
//
// 时序(timing is frozen,绝对秒;伸缩全部落在末段 hold):
//   0.00  底+Backdrop 第 0 帧已在(首帧不黑);控件自下 180px CALM 浮入 0.6s
//   0.67  光标从目标侧画外滑入 0.8s,Easing.out(cubic)(recipe:<14f 或 linear 读作"被扔进来")
//   1.60  按下:光标 scale 1→0.86→1(3f 下 4f 回)+ 控件轻微 press 0.985 + 涟漪 12f 从点击点扩散
//   1.73  滑块弹簧滑向目标段(**唯一弹簧名额** damping 13/stiffness 210,带过冲;
//         demo 的 8f ease-out 手感由这组弹簧参数复现——快速到位 + 一次轻微回弹)。
//         标签主次交换与强调点弹出都由同一根弹簧驱动(一个名额,多处消费)
//   2.00  caption 底部上浮淡入 0.4s
//   之后  hold 静置;最后约 0.35s 随统一 PresetExit 溶出,控件下移 24px 并回收 2.5%
//   最短版本压缩交互时间,caption 完成后至少留 0.25s 再开始退场
//
// 已知坑(from 配方卡,落进实现的):
// - 涟漪圆心锁点击点(光标笔尖),不跟 thumb 走——跟着走就成了拖尾,语义变错;
// - 强调点收起时 width 与 scale 同步归零让文字回流,只 scale 会留"幽灵缝";
// - 滑块过冲限幅 ≤10px:胶囊内滑块贴边,弹簧原始过冲(~秒8%×426px)会顶出轨道,
//   限幅后读作"撞到边界弹了一下",不失手感也不破几何;
// - 标签**不做字重交换**:minimal 皮肤 weightCap 500,绕过 textStyle 手写 fontWeight
//   会触发合成粗体(fonts.ts 明令禁止)。主次交换由颜色 crossfade + 尺寸 + 强调点承担。
//
// 颜色零 hex(阴影的纯黑 alpha 与 baseline.tsx 同一惯例):
// - 槽底 = P.surfaceRaised + P.line 描边(比底亮一档的"轨道");
// - 滑块 = P.ink:暗皮肤下就是亮面胶囊(iOS 分段控件的白 thumb),亮皮肤(paper)下
//   自然反转为深色胶囊——两个方向都成立,这是用 ink 而不是写死白色的原因;
// - 滑块上的活性标签 = P.bg(与滑块天然满对比),槽底上的非活性标签 = alpha(P.ink, 0.5);
// - 涟漪与强调点 = P.accent(全镜唯一强调色,面积极小)。
import React from 'react';
import {presetExit} from './preset-exit.mjs';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  interpolateColors,
  spring,
  Easing,
} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {CALM, ENTER} from '../lib/anim';
import {TUNE_FONTS} from './KeyConcept';

export type PresetSegmentedThumbProps = {
  durationSeconds: number;
  variant?: {land?: 'left' | 'right'};
  slots: {leftLabel: string; rightLabel: string; caption?: string};
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
// 几何(竖版特写重标定;recipe:控件宽 <600 就不是特写了)
// ---------------------------------------------------------------------------
const CW = 880; // 控件宽
const CH = 184; // 控件高
const PAD = 14; // 滑块内缩
const SEGW = (CW - PAD * 2) / 2; // 单段宽 426
const THUMB_H = CH - PAD * 2;
const OVERSHOOT_CAP = 10; // 滑块过冲限幅(px),理由见文件头坑位

// 时间轴(绝对秒,frozen)
const T_ENTER = 0;
const D_ENTER = 0.6;
const T_CURSOR = 0.67;
const D_CURSOR = 0.8;
const T_CLICK = 1.6;
const T_SLIDE = 1.73;
const T_CAPTION = 2.0;
const D_CAPTION = 0.4;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 超大描边箭头光标(demo 同款路径;tip 在 viewBox 的 (4,2) ≈ 15.4%/6.7% 处) */
const ArrowCursor: React.FC<{
  tipX: number;
  tipY: number;
  press: number;
  fill: string;
  stroke: string;
}> = ({tipX, tipY, press, fill, stroke}) => {
  const W = 112;
  const H = 129;
  return (
    <svg
      width={W}
      height={H}
      viewBox="0 0 26 30"
      style={{
        position: 'absolute',
        left: tipX - W * 0.154,
        top: tipY - H * 0.067,
        transform: `scale(${1 - press * 0.14})`,
        transformOrigin: '15.4% 6.7%',
        filter: `drop-shadow(0 8px 16px ${alpha('#000000', 0.35)})`,
      }}
    >
      <path
        d="M4 2 L4 24 L9.5 18.5 L13 27 L16.8 25.4 L13.3 17 L21 17 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
};

const Inner: React.FC<PresetSegmentedThumbProps> = ({durationSeconds, variant, slots, tune}) => {
  const localFrame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const outro = presetExit(localFrame, fps, durationSeconds);
  // Reserve caption completion and a readable hold before the exit at minimum duration.
  const contentScale = Math.min(1, Math.max(.1, (outro.start / fps - .25) / (T_CAPTION + D_CAPTION)));
  const frame = localFrame / contentScale;
  const landscape = width > height;
  const CW = landscape ? Math.min(1360, width - 280) : 880;
  const CH = landscape ? 204 : 184;
  const SEGW = (CW - PAD * 2) / 2;
  const THUMB_H = CH - PAD * 2;
  const {P, T, pad} = useBaseline();
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const land = variant?.land ?? 'right';
  const dir = land === 'right' ? 1 : -1; // 滑块行进方向(+1 右 / -1 左)

  // ---- 控件浮入(CALM,大元素落位;弹簧名额留给滑块) ----
  const enterT = interpolate(frame, [T_ENTER * fps, (T_ENTER + D_ENTER) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });
  const ctrlY = 180 * (1 - enterT);
  const ctrlOpacity = Math.min(1, enterT * 1.8);

  // ---- 光标滑入(从目标侧画外) ----
  const curT = interpolate(frame, [T_CURSOR * fps, (T_CURSOR + D_CURSOR) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  // 目标段中心(组坐标系,原点=控件中心):±(PAD + 1.5*SEGW − CW/2) = ±213
  const targetCX = dir * (PAD + 1.5 * SEGW - CW / 2);
  const tipTargetX = targetCX + dir * 18;
  const tipTargetY = 26;
  const tipX = interpolate(curT, [0, 1], [dir * 640, tipTargetX]);
  const tipY = interpolate(curT, [0, 1], [640, tipTargetY]);

  // ---- 按下(3f 下 4f 回)+ 控件 press + 涟漪 ----
  const clickF = Math.round(T_CLICK * fps);
  const press = interpolate(frame, [clickF, clickF + 3, clickF + 7], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ctrlPress = interpolate(frame, [clickF, clickF + 3, clickF + 9], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rippleT = interpolate(frame, [clickF, clickF + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });

  // ---- 滑块:唯一弹簧名额(过冲限幅 ≤10px) ----
  const spr = spring({
    frame: frame - Math.round(T_SLIDE * fps),
    fps,
    config: {damping: 13, stiffness: 210, mass: 0.7},
  });
  const dist = dir * SEGW; // 起始段 → 目标段的位移
  const cappedProg =
    spr <= 1 ? spr : 1 + Math.min((spr - 1) * Math.abs(dist), OVERSHOOT_CAP) / Math.abs(dist);
  const startX = land === 'right' ? PAD : PAD + SEGW;
  const thumbX = startX + dist * cappedProg;

  // 标签主次交换与强调点:同一根弹簧驱动(一个名额,多处消费)
  const swapT = interpolate(spr, [0.35, 0.75], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // 目标段强调点:弹簧尾段映射,保留过冲 → "落位奖励"的 pop
  const targetDotS = Math.max(0, (spr - 0.55) / 0.45);
  // 起始段强调点:滑动一起步就塌缩(width 与 scale 同步归零,文字自然回流)
  const startDotS =
    1 -
    interpolate(frame, [Math.round(T_SLIDE * fps), Math.round(T_SLIDE * fps) + 6], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.in(Easing.cubic),
    });

  // ---- caption ----
  const captionIn = interpolate(frame, [T_CAPTION * fps, (T_CAPTION + D_CAPTION) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });

  // ---- 颜色令牌(理由见文件头) ----
  const trackBg = P.surfaceRaised;
  const thumbFace = P.ink; // 暗皮肤=亮面胶囊,亮皮肤自然反转为深胶囊
  const onThumb = P.bg; // 活性标签:与滑块面天然满对比
  const idleInk = alpha(P.ink, 0.5); // 非活性标签:槽底上的降灰

  // 每段的活性度:起始段 1→0,目标段 0→1
  const leftActive = land === 'right' ? 1 - swapT : swapT;
  const rightActive = land === 'right' ? swapT : 1 - swapT;
  const leftDotS = land === 'right' ? startDotS : targetDotS;
  const rightDotS = land === 'right' ? targetDotS : startDotS;

  const labelSize = (text: string) =>
    fitFontSize(text, {fontSize: 60, maxWidthPx: 340, shrinkFloorPx: 32, letterSpacingEm: -0.02});

  const segment = (text: string, activeT: number, dotS: number, part: string) => {
    const dotVisible = dotS > 0.05;
    return (
      <div
        style={{
          width: SEGW,
          height: THUMB_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <EditableText as="div" part={part}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...textStyle(T, 'h1'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: labelSize(text),
            lineHeight: 1,
            color: interpolateColors(activeT, [0, 1], [idleInk, onThumb]),
            transform: `scale(${0.97 + 0.06 * activeT})`,
          }}
        >
          {/* 强调点:落位奖励。收起时 width 同步归零让文字回流(配方卡坑位) */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              width: dotVisible ? 34 : 0,
              overflow: 'visible',
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                background: P.accent,
                transform: `scale(${dotS})`,
              }}
            />
          </span>
          {text}
        </EditableText>
      </div>
    );
  };

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />
      {/* 舞台组:原点=控件中心 (540, 860+tune.y),tune.scale 整组缩放 */}
      <div
        style={{
          position: 'absolute',
          left: (landscape ? width / 2 : 540) + (tune?.x ?? 0),
          top: (landscape ? height * .44 : 860) + (tune?.y ?? 0),
          width: 0,
          height: 0,
          transform: `translateY(${24 * outro.progress}px) scale(${tuneScale * (1 - .025 * outro.progress)})`,
        }}
      >
        {/* 分段控件 */}
        <div
          style={{
            position: 'absolute',
            left: -CW / 2,
            top: -CH / 2,
            width: CW,
            height: CH,
            borderRadius: CH / 2,
            background: trackBg,
            border: `3px solid ${P.line}`,
            boxShadow: `0 ${30 - 14 * enterT}px ${96 - 32 * enterT}px ${alpha('#000000', P.mode === 'light' ? 0.2 : 0.5)}, inset 0 4px 18px ${alpha('#000000', P.mode === 'light' ? 0.06 : 0.32)}`,
            transform: `translateY(${ctrlY}px) scale(${1 - 0.015 * ctrlPress})`,
            opacity: ctrlOpacity,
            display: 'flex',
            alignItems: 'center',
            padding: PAD,
            boxSizing: 'border-box',
          }}
        >
          {/* 滑块(暗皮肤下的亮面胶囊) */}
          <div
            style={{
              position: 'absolute',
              left: thumbX,
              top: PAD,
              width: SEGW,
              height: THUMB_H,
              borderRadius: THUMB_H / 2,
              background: `linear-gradient(180deg, ${thumbFace} 0%, ${alpha(thumbFace, 0.92)} 100%)`,
              boxShadow: `0 8px 26px ${alpha('#000000', 0.4)}`,
              zIndex: 1,
            }}
          />
          {segment(slots.leftLabel, leftActive, leftDotS, 'leftLabel')}
          {segment(slots.rightLabel, rightActive, rightDotS, 'rightLabel')}
        </div>
        {/* 点击涟漪:圆心锁点击点(光标笔尖),zIndex 在滑块之上;跟 thumb 走=语义变错 */}
        {rippleT > 0 && rippleT < 1 ? (
          <div
            style={{
              position: 'absolute',
              left: tipTargetX - 120 * rippleT,
              top: tipTargetY - 120 * rippleT,
              width: 240 * rippleT,
              height: 240 * rippleT,
              borderRadius: '50%',
              border: `4px solid ${alpha(P.accent, 0.85)}`,
              opacity: 1 - rippleT,
              zIndex: 3,
            }}
          />
        ) : null}
        <ArrowCursor
          tipX={tipX}
          tipY={tipY}
          press={press}
          fill={P.ink}
          stroke={alpha(P.bg, 0.9)}
        />
      </div>
      {/* caption:底部注脚 */}
      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            top: landscape ? height * .73 : 1560,
            left: pad,
            right: pad,
            textAlign: 'center',
            ...textStyle(T, 'body'),
            ...(tuneFont ? {fontFamily: tuneFont} : {}),
            fontSize: fitFontSize(slots.caption, {fontSize: 44, maxWidthPx: landscape ? width - 240 : 900, shrinkFloorPx: 30}),
            color: P.inkSecondary,
            opacity: captionIn,
            transform: `translateY(${18 * (1 - captionIn) + 16 * outro.progress}px)`,
          }}
        >
          {slots.caption}
        </EditableText>
      ) : null}
      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;比稿场景可用 Provider 覆盖
export const PresetSegmentedThumb: React.FC<PresetSegmentedThumbProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
