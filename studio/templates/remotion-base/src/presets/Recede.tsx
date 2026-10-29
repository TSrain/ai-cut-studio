// presets/Recede.tsx —— 退让镜 preset(docs/presets/recede/preset.json)
//
// 定位:全片情绪最低点。纯净底 + 一块大字 + 单次极简动作,亮度与信息量全片最低档。
// 硬约束:禁 AccentSlab/Backdrop/装饰;整块同一字族;首帧不淡入(底从第 0 帧就在,
// 文字首帧已有 25% 可见度,不出现黑帧)。
// 时序(timing is frozen):enter 0.5s 绝对秒(上浮 24px + 淡入),hold 弹性伸缩(亮度呼吸 ±3%,周期 4s)。
//
// v2 相对 v1 的变化(见 preset.json changelog):
// - `line` 从单行 hero 槽变成**可折行**槽(最多 3 行),不再是「装不下就一路缩到 96px」;
// - 新增可选槽 `hero`:`line` 里的一段子串,放大成主焦点,其余降一档字号 + 一档墨色;
// - 版式工艺(视觉居中 / 多行收紧行距 / 左缘锚点细线)全部在皮肤层的 RecedeBlock 里,
//   所以下批所有退让镜自动是同一手感,不需要逐镜调。
// 不传 `hero` 时整段仍是一个字号、满墨色,并优先缩字保住单行 —— 老合同的样子不变。
import React from 'react';
import {recedeMotion, type RecedeSlots} from './recede-controls.mjs';
import {useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {RecedeStage, RecedeBlock} from '../style/baseline';
import {TUNE_FONTS} from './KeyConcept';
import {layoutEmphasisText} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {ENTER} from '../lib/anim';
import {useElementEdit} from '../editor/preset-editing';

export type PresetRecedeProps = {
  durationSeconds: number;
  variant?: {level?: 1 | 2 | 3 | 4};
  slots: RecedeSlots;
  /** 打磨旋钮(Studio 试玩用,生产合同不写):font 见 KeyConcept 的 TUNE_FONTS */
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

const ENTER_SECONDS = 0.5;
const BREATH_PERIOD_SECONDS = 4;
const BREATH_AMPLITUDE = 0.03;

/** Manual color/opacity must remain steady during hold; entrance still animates. */
export const recedeBreathOpacity = (frame:number,fps:number,explicitTextStyle:boolean) =>
  explicitTextStyle || frame <= ENTER_SECONDS * fps ? 1 :
    1 - BREATH_AMPLITUDE * (1 - Math.cos((2 * Math.PI * (frame - ENTER_SECONDS * fps)) / (BREATH_PERIOD_SECONDS * fps)));

/** 槽位排版参数:与 docs/presets/recede/preset.json 的 slots.line 一致(两处都改) */
const LINE_FIT = {fontSize: 94, maxWidthPx: 936, maxLines: 3, shrinkFloorPx: 60};

const Inner: React.FC<PresetRecedeProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const enterFrames = ENTER_SECONDS * fps;

  const t = interpolate(frame, [0, enterFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER,
  });
  const motion = recedeMotion(frame, fps, durationSeconds, slots);
  const legacyEnter = slots.enterFx === undefined;
  const rise = legacyEnter ? 24 * (1 - t) : motion.y;
  const appear = (legacyEnter ? 0.25 + 0.75 * t : 1) * motion.opacity;
  const explicitSizing = slots.emphasisRanges !== undefined || slots.fontSize !== undefined || slots.emphasisRatio !== undefined;
  // hold:亮度呼吸(确定性,由帧推导;enter 结束时相位为 0,无跳变)
  const textEdit = useElementEdit('line');
  const breath = recedeBreathOpacity(frame,fps,slots.enterFx !== undefined || explicitSizing || textEdit?.color !== undefined || textEdit?.opacity !== undefined);
  const baseSize = textEdit?.fontSize ?? slots.fontSize ?? (landscape ? 120 : LINE_FIT.fontSize);

  const scale = tune?.scale ?? 1;
  const layout = layoutEmphasisText(slots.line, {
    ...LINE_FIT,
    ...(landscape ? {fontSize: 120, maxWidthPx: width - 280, maxLines: 2} : {}),
    ...(slots.hero ? {emphasis: slots.hero} : {}),
    ...(explicitSizing ? {fontSize: baseSize, shrinkFloorPx: Math.min(60, baseSize), emphasisRatio: slots.emphasisRatio ?? 1.6, emphasisRanges: slots.emphasisRanges} : {}),
  });
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  return (
    <RecedeStage level={variant?.level ?? 2}>
      <div
        style={{
          transform: `translateY(${rise + (legacyEnter ? motion.y : 0) + (tune?.y ?? 0)}px) scale(${motion.scale})`,
          opacity: appear * breath,
          width: '100%',
          height: '100%',
        }}
      >
        <RecedeBlock
          lines={layout.lines}
          baseSize={Math.round(layout.baseSize * scale)}
          emphasisSize={Math.round(layout.emphasisSize * scale)}
          maxLineWidthPx={Math.round(layout.maxLineWidthPx * scale)}
          level={variant?.level ?? 2}
          enter={legacyEnter ? t : motion.enter}
          fitted={explicitSizing}
          evenInk={slots.emphasisRanges !== undefined}
          fontFamily={tuneFont}
        />
      </div>
    </RecedeStage>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetRecede: React.FC<PresetRecedeProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
