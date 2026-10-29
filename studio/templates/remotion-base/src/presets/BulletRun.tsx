import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/BulletRun.tsx —— 列点推进 preset(docs/presets/bullet-run/preset.json)
//
// 定位:口播说「有三个原因 / 四个特征 / 五件事」时的画面。b-roll 里最高频的一种,
// 也是最容易做丑的一种——做成 PPT 项目符号列表就废了。
//
// ============ v2 重做:对标发布会大屏,不是幻灯片 ============
//
// v1 是"信息面板"路线:眉题 + 题目 + 补充句 + 右上角 01/03 计数 + 三块卡片底板 +
// 序号 + 主句 + 小注 + 分隔横线。每一件都能说出用处,合起来就是一屏九种元素。
// 用户 2026-08-15 的原话:「元素太多…这些表达太多了,口播就要设计的和乔布斯的 ppt 一样,
// 简单直接高级;字体不好看,画框占比太大留白过少,动画过于着急」。
//
// v2 把能删的全删了,只留三件事:**题目、几条内容、光走到哪条**。
//
//   删掉 —— 计数器 01/03、补充句 kicker、卡片底板、分隔横线、大号序号
//   留下 —— 一根 4px 的 accent 竖条,标记当前这条。就这一个标记。
//
// ============ 三条不能退的规矩 ============
//
// 1. **不许飞进来。** 所有条目第 0 帧就在场(0.16 不透明度),动的只有"光"——
//    当前条亮起、其余留暗。元素位移只剩 10px 的抬升。会飞的列表读作动画演示,
//    不会飞的列表读作有人在讲话。
// 2. **一拍 0.9 秒,缓动用 CALM 不用 ENTER。** ENTER 前 30% 跑完 80% 距离,
//    放在 80px 的大字上就是"甩"。慢到能看清它怎么停下来,才叫稳。
// 3. **留白是内容的一部分。** 列表块垂直居中在画面中段,上下各留一大片空;
//    行距是字号的两倍。挤满的画面没有"高级"这个选项。
//
// ============ 一条 item 可以带小注 ============
//
// items 每项可用 ` | ` 隔开主句与小注:「先跑通 | 别管好不好看」。
// 但**默认样例不填小注**——小注是第二级信息,口播镜头里九成用不上,
// 填了就又往"信息面板"那边滑一步。

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {Backdrop, Eyebrow, Foreground, useBaseline} from '../style/baseline';
import {textStyle, alpha, numeric} from '../lib/theme';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';
import {CALM, BEAT} from '../lib/anim';
import {fitFontSize} from '../style/fit';

export type PresetBulletRunProps = {
  durationSeconds: number;
  variant?: {flow?: 'walk' | 'stack'; marker?: 'none' | 'number' | 'dot' | 'check'};
  slots: {
    items: string[];
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

// 相位切点(占总时长的比例)。timing is frozen——改它等于改这个模板的性格。
// 第一条要等到 18%:硬切进来先给观众半秒读题目,再开始点条目。
// 最后一条落在 62%,后面 38% 全是静止 —— 6 秒的镜头就是 2.3 秒不动,这是刻意的。
const PHASE = {firstAt: 0.18, lastAt: 0.62};

const CANVAS = {w: 1080, h: 1920};
const PAD = 100;
// 列表块在这个区间里**垂直居中**,而不是铺满它。上下留白就是从这来的
const BAND = {top: 700, bottom: 1520};
const TEXT_X = PAD + 44; // 竖条占着 PAD,文字让开 44px
const TEXT_W = CANVAS.w - TEXT_X - PAD;

/** 条目数 → 基准字号。条目多就降档,不靠压行距硬塞 */
const BASE_SIZE = (n: number) => (n <= 2 ? 92 : n === 3 ? 84 : n === 4 ? 70 : 58);
/** 行间距 = 字号 × 这个系数。2.0 很松,松是故意的 */
const PITCH_RATIO = (n: number) => (n <= 3 ? 2.15 : n === 4 ? 1.85 : 1.62);

const Inner: React.FC<PresetBulletRunProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const textX = landscape ? width * 0.49 : TEXT_X;
  const textW = landscape ? width - textX - PAD : TEXT_W;
  const band = landscape ? {top: height * 0.18, bottom: height * 0.84} : BAND;
  const {P, T} = useBaseline();
  const flow = variant?.flow ?? 'walk';
  const marker = variant?.marker ?? 'none';
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const tuneScale = tune?.scale ?? 1;

  const items = (slots.items ?? []).filter((s) => String(s).trim() !== '').slice(0, 6);
  const n = Math.max(1, items.length);
  const dur = durationSeconds * fps;
  const beatFrames = BEAT * fps;

  const beatOf = (i: number) =>
    n === 1 ? PHASE.firstAt * dur : (PHASE.firstAt + ((PHASE.lastAt - PHASE.firstAt) * i) / (n - 1)) * dur;

  // 主句 / 小注 拆分(` | ` 隔开,小注可省)
  const parts = items.map((raw) => {
    const [head, ...rest] = String(raw).split('|');
    return {head: head.trim(), note: rest.join('|').trim()};
  });

  // 全表统一字号:取所有主句 fit 结果的最小值。逐条各自 fit 会大小不一,列表立刻读坏
  const base = BASE_SIZE(n);
  const size = Math.round(
    Math.min(...parts.map((p) => fitFontSize(p.head, {fontSize: base, maxWidthPx: textW, shrinkFloorPx: 34}))) *
      tuneScale,
  );
  const noteSize = Math.round(size * 0.42);
  const hasNote = parts.some((p) => p.note);

  // 块居中:算出总高再放到 BAND 的正中间。**不是铺满 BAND**
  const pitch = size * PITCH_RATIO(n) + (hasNote ? noteSize * 1.6 : 0);
  const blockH = pitch * (n - 1);
  const firstY = (band.top + band.bottom) / 2 - blockH / 2;

  const titleSize = slots.title
    ? Math.round(fitFontSize(slots.title, {fontSize: 96, maxWidthPx: landscape ? width * 0.34 : CANVAS.w - PAD * 2, shrinkFloorPx: 56}) * tuneScale)
    : 0;

  // 开场:整块从 0.55 亮到 1 并抬 10px。**不是从 0 淡入**——硬切进来第 0 帧必须有东西
  const openIn = interpolate(frame, [0, beatFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: CALM,
  });

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden', fontFamily: tuneFont}}>
      <Backdrop />
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 100 : 250} /> : null}

      {slots.title ? (
        <EditableText as="div" part="title"
          style={{
            position: 'absolute',
            left: PAD,
            right: landscape ? width * 0.59 : PAD,
            top: landscape ? height * 0.37 : 420,
            ...textStyle(T, 'h1'),
            fontSize: titleSize,
            color: P.ink,
            lineHeight: 1.18,
            opacity: 0.55 + 0.45 * openIn,
            transform: `translateY(${10 * (1 - openIn)}px)`,
          }}
        >
          {slots.title}
        </EditableText>
      ) : null}

      {parts.map((item, i) => {
        const beat = beatOf(i);
        // 点亮:这是这一镜**唯一**的动作
        const lit = interpolate(frame, [beat, beat + beatFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: CALM,
        });
        // walk:光走过去,讲过的退回暗处(仍可读);stack:亮了就不再灭。
        // 最后一条没有"下一拍",不能拿 Infinity 去喂 interpolate(它只收有限数,
        // 会直接抛 inputRange must contain only finite numbers)——直接短路成 0
        const isLast = i === n - 1;
        const nextBeat = isLast ? 0 : beatOf(i + 1);
        const passed =
          flow === 'stack' || isLast
            ? 0
            : interpolate(frame, [nextBeat, nextBeat + beatFrames], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: CALM,
              });
        const focus = lit * (1 - 0.62 * passed);
        const cy = firstY + pitch * i;

        return (
          <React.Fragment key={`${item.head}-${i}`}>
            {/* 唯一的标记:一根 4px 的 accent 竖条。它只在当前这条身上,长度跟着点亮长出来 */}
            <div
              style={{
                position: 'absolute',
                left: textX - 44,
                top: cy - size * 0.52 * lit,
                width: 4,
                height: size * 1.04 * lit,
                borderRadius: 2,
                background: P.accent,
                // 只标当前这条。讲过的连竖条一起收掉——留一堆半透明的条
                // 等于同时标了三条,那个标记就不再是标记了
                opacity: lit * (1 - passed),
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: textX,
                width: textW,
                top: cy - size * 0.66,
                opacity: (0.16 + 0.84 * focus) * (0.55 + 0.45 * openIn),
                transform: `translateY(${10 * (1 - openIn)}px)`,
                display: 'flex',
                alignItems: 'baseline',
                gap: marker === 'none' ? 0 : 22,
              }}
            >
              {marker === 'none' ? null : (
                <div
                  style={{
                    ...textStyle(T, 'label'),
                    ...numeric(),
                    fontSize: Math.round(size * 0.34),
                    color: P.accent,
                    flexShrink: 0,
                    opacity: 0.55 + 0.45 * focus,
                  }}
                >
                  {marker === 'number' ? String(i + 1).padStart(2, '0') : marker === 'check' ? '✓' : '—'}
                </div>
              )}
              <div>
                <EditableText as="div" part={`item-${i}-head`} style={{...textStyle(T, 'h2'), fontSize: size, lineHeight: 1.22, color: P.ink}}>{item.head}</EditableText>
                {item.note ? (
                  <EditableText as="div" part={`item-${i}-note`}
                    style={{
                      ...textStyle(T, 'body'),
                      fontSize: noteSize,
                      marginTop: Math.round(size * 0.2),
                      color: alpha(P.inkMuted, P.mode === 'light' ? 0.95 : 0.78),
                    }}
                  >
                    {item.note}
                  </EditableText>
                ) : null}
              </div>
            </div>
          </React.Fragment>
        );
      })}
      <Foreground />
    </EditorScene>
  );
};

export const PresetBulletRun: React.FC<PresetBulletRunProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
