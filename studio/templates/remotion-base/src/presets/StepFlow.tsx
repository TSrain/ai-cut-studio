import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/StepFlow.tsx —— 流程推进 preset(docs/presets/step-flow/preset.json)
//
// 定位:口播讲「先 A,再 B,最后 C」「输入进去,中间发生了什么,输出出来」时的画面。
// 讲工作流、讲机制、讲"这东西怎么运作的"。
//
// ============ 它和列点推进的区别是"有向性",不是"有序号" ============
//
// 这两个模板长得像,做的时候最大的风险就是做出第二个 bullet-run。判据是:
// **把步骤顺序打乱,画面还成立吗?**
//   - 列点推进:成立(三个原因谁先谁后无所谓)→ 那就该用 bullet-run
//   - 流程推进:不成立(第二步是第一步的结果)→ 才该用这个
//
// 所以有向性必须画出来,不能只靠序号暗示。三处一起承载:
//   ① **脊线逐段画出来** —— 上一步的产物"流"到下一步,线走到哪,进度就在哪
//   ② **当前步是大的**(不只是亮的)—— 尺寸差比亮度差更能说"现在在这里"
//   ③ **一次只有一句说明在屏上** —— 只有当前步展开它的说明句,其余收成一行名字
//
// ============ 规格来自 taste.md,不是现编的 ============
//
// SC-0025 Shot5/Shot6 手搓过两次漏斗流水线,当时写下的可复用结论是:
// 「多阶段流水线用『每阶段一个顶部标签 + 焦点逐段转移』承载,规避单镜多焦点的混乱」。
// 这个模板就是那句话的固化——只是把"顶部标签"改成了"脊线上的当前节点",
// 竖版里顶部标签会和题目打架。
//
// ============ 踩过的坑 ============
//
// 1. **槽位间距必须按最大的那个块算**,不能按平均。当前步是"名字 + 说明句"两行,
//    其余步是一行;按一行的高度排间距,当前步一展开就撞到下一条。
// 2. 脊线的未走段不能省。第 0 帧就要看得见"一共几步、还有多远",
//    从零长出来的流程图观众不知道自己在哪。

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {Backdrop, Eyebrow, Foreground, useBaseline} from '../style/baseline';
import {textStyle, alpha, numeric} from '../lib/theme';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';
import {CALM, BEAT} from '../lib/anim';
import {fitFontSize} from '../style/fit';

export type PresetStepFlowProps = {
  durationSeconds: number;
  variant?: {emphasis?: 'focus' | 'even'; marker?: 'number' | 'dot'};
  slots: {
    steps: string[];
    title?: string;
    eyebrow?: string;
  };
  tune?: {
    font?: 'skin' | 'smiley' | 'archivo' | 'serif' | 'wenkai' | 'noto-serif';
    scale?: number;
    y?: number;
    skin?: 'abyss' | 'ember' | 'slate' | 'paper';
    accentHue?: number;
    neutralHue?: number;
  };
};

// 相位切点。timing is frozen。
// 第一步等到 16%:硬切进来先给观众半秒看清"一共几步";最后一步落在 70%,尾段 30% 静止。
const PHASE = {firstAt: 0.16, lastAt: 0.7};

const CANVAS = {w: 1080, h: 1920};
const PAD = 100;
const SPINE_X = 196;
const LABEL_X = 292;
const LABEL_W = CANVAS.w - LABEL_X - PAD;
const BAND = {top: 620, bottom: 1580};

/** 步数 → 当前步的名字字号。步数多就降档 */
const ACTIVE_SIZE = (n: number) => (n <= 3 ? 72 : n === 4 ? 64 : 56);
const REST_SIZE = (n: number) => Math.round(ACTIVE_SIZE(n) * 0.56);

const Inner: React.FC<PresetStepFlowProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const {P, T} = useBaseline();
  const emphasis = variant?.emphasis ?? 'focus';
  const marker = variant?.marker ?? 'number';
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const tuneScale = tune?.scale ?? 1;

  const raw = (slots.steps ?? []).filter((s) => String(s).trim() !== '').slice(0, 6);
  const n = Math.max(1, raw.length);
  const columnW = landscape ? Math.min(440, (width - 200) / n - 30) : LABEL_W;
  const rowY = height * .43;
  const xOf = (i: number) => n === 1 ? width / 2 : 100 + columnW / 2 + i * (width - 200 - columnW) / (n - 1);
  const dur = durationSeconds * fps;
  const beatFrames = BEAT * fps;

  const steps = raw.map((s) => {
    const [head, ...rest] = String(s).split('|');
    return {head: head.trim(), note: rest.join('|').trim()};
  });

  const beatOf = (i: number) =>
    n === 1 ? PHASE.firstAt * dur : (PHASE.firstAt + ((PHASE.lastAt - PHASE.firstAt) * i) / (n - 1)) * dur;

  const activeBase = ACTIVE_SIZE(n);
  const restBase = REST_SIZE(n);
  // 全表统一字号:逐条各自 fit 会大小不一,流程图立刻读作排版坏了
  const activeSize = Math.round(
    Math.min(...steps.map((s) => fitFontSize(s.head, {fontSize: activeBase, maxWidthPx: columnW, shrinkFloorPx: 34}))) *
      tuneScale,
  );
  const restSize = Math.round(restBase * tuneScale);
  const noteSize = Math.round(activeSize * 0.56);

  // 坑 1:间距按"当前步展开后"的高度算,不是按一行名字算
  const yTop = BAND.top;
  const pitch = n > 1 ? (BAND.bottom - BAND.top) / (n - 1) : 0;
  const yOf = (i: number) => yTop + pitch * i;

  const titleSize = slots.title
    ? Math.round(fitFontSize(slots.title, {fontSize: 62, maxWidthPx: landscape ? width - 200 : CANVAS.w - PAD * 2, shrinkFloorPx: 40}) * tuneScale)
    : 0;

  const openIn = interpolate(frame, [0, beatFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden', fontFamily: tuneFont}}>
      <Backdrop />
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 70 : 250} /> : null}

      {/* 题目是上下文不是主角:字号只有当前步的 0.86,颜色压到 0.62。
          这一镜的主角是"现在在第几步" */}
      {slots.title ? (
        <EditableText as="div" part="title"
          style={{
            position: 'absolute',
            left: PAD,
            right: PAD,
            top: landscape ? 160 : 400,
            ...textStyle(T, 'h2'),
            fontSize: titleSize,
            color: alpha(P.ink, 0.62),
            lineHeight: 1.2,
            opacity: 0.5 + 0.5 * openIn,
          }}
        >
          {slots.title}
        </EditableText>
      ) : null}

      {/* 脊线的未走段:第 0 帧就全在。观众要先知道"一共几步、还有多远"(坑 2) */}
      {n > 1 ? (
        <div
          style={{
            position: 'absolute',
            left: landscape ? xOf(0) : SPINE_X - 1,
            top: landscape ? rowY : yOf(0),
            width: landscape ? xOf(n - 1) - xOf(0) : 2,
            height: landscape ? 2 : pitch * (n - 1),
            background: alpha(P.line, 0.5),
            opacity: 0.5 + 0.5 * openIn,
          }}
        />
      ) : null}

      {steps.map((step, i) => {
        const beat = beatOf(i);
        // 到达:节点点亮。比脊线段晚一点点落位,读作"线走到了,这一步才亮"
        const arrive = interpolate(frame, [beat - beatFrames * 0.35, beat + beatFrames * 0.65], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: CALM,
        });
        const nextBeat = i < n - 1 ? beatOf(i + 1) : 0;
        const isLast = i === n - 1;
        // 交棒:下一步到了,这一步收成"走过的"
        const handOff =
          isLast
            ? 0
            : interpolate(frame, [nextBeat - beatFrames * 0.35, nextBeat + beatFrames * 0.65], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: CALM,
              });
        const active = arrive * (1 - handOff);
        const done = handOff; // 已走过
        const y = yOf(i);

        // ① 脊线段:从上一个节点画到这一个。**这是有向性的载体**
        const drawn =
          i === 0
            ? 0
            : interpolate(frame, [beatOf(i - 1) + beatFrames * 0.3, beat], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: CALM,
              });

        // ② 当前步是大的,不只是亮的
        const size = emphasis === 'even' ? activeSize : Math.round(restSize + (activeSize - restSize) * active);
        const nodeR = 9 + 15 * active;

        return (
          <React.Fragment key={`${step.head}-${i}`}>
            {i > 0 ? (
              <div
                style={{
                  position: 'absolute',
                  left: landscape ? xOf(i - 1) : SPINE_X - 2,
                  top: landscape ? rowY : yOf(i - 1),
                  width: landscape ? (xOf(i) - xOf(i - 1)) * drawn : 4,
                  height: landscape ? 4 : pitch * drawn,
                  borderRadius: 2,
                  background: P.accent,
                  opacity: 0.9,
                }}
              />
            ) : null}

            {/* 节点 */}
            <div
              style={{
                position: 'absolute',
                left: landscape ? xOf(i) - nodeR : SPINE_X - nodeR,
                top: (landscape ? rowY : y) - nodeR,
                width: nodeR * 2,
                height: nodeR * 2,
                borderRadius: nodeR,
                background: active > 0.5 ? P.accent : done > 0.5 ? alpha(P.accent, 0.55) : P.bg,
                border: `2px solid ${
                  active > 0.2 || done > 0.2 ? alpha(P.accent, 0.9) : alpha(P.line, 0.8)
                }`,
                boxShadow: active > 0.4 ? `0 0 ${34 * active}px ${alpha(P.accent, 0.4 * active)}` : 'none',
                opacity: 0.5 + 0.5 * openIn,
              }}
            />
            {marker === 'number' ? (
              <div
                style={{
                  position: 'absolute',
                  left: landscape ? xOf(i) - 40 : 72,
                  top: landscape ? rowY - 80 : y - 20,
                  width: 80,
                  textAlign: landscape ? 'center' : 'right',
                  ...textStyle(T, 'label'),
                  ...numeric(),
                  fontSize: 30,
                  color: active > 0.4 ? P.accent : alpha(P.inkMuted, 0.5),
                  opacity: 0.5 + 0.5 * openIn,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
            ) : null}

            {/* 名字。走过的保持可读(0.45),没到的压到 0.2 */}
            <EditableText as="div" part={`step-${i}-head`}
              style={{
                position: 'absolute',
                left: landscape ? xOf(i) - columnW / 2 : LABEL_X,
                width: columnW,
                textAlign: landscape ? 'center' : undefined,
                top: landscape ? rowY + 70 : y - size * 0.66,
                ...textStyle(T, 'h2'),
                fontSize: size,
                lineHeight: 1.2,
                color: P.ink,
                opacity: (0.2 + 0.25 * done + 0.55 * active) * (0.5 + 0.5 * openIn),
                transform: `translateY(${(tune?.y ?? 0) + 8 * (1 - arrive)}px)`,
              }}
            >
              {step.head}
            </EditableText>

            {/* ③ 一次只有一句说明在屏上 —— 只有当前步展开 */}
            {step.note ? (
              <EditableText as="div" part={`step-${i}-note`}
                style={{
                  position: 'absolute',
                  left: landscape ? xOf(i) - columnW / 2 : LABEL_X,
                  width: columnW,
                  textAlign: landscape ? 'center' : undefined,
                  top: landscape ? rowY + 170 : y + size * 0.66,
                  ...textStyle(T, 'body'),
                  fontSize: noteSize,
                  lineHeight: 1.45,
                  color: alpha(P.inkMuted, P.mode === 'light' ? 0.95 : 0.8),
                  opacity: active,
                }}
              >
                {step.note}
              </EditableText>
            ) : null}
          </React.Fragment>
        );
      })}
      <Foreground />
    </EditorScene>
  );
};

export const PresetStepFlow: React.FC<PresetStepFlowProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
