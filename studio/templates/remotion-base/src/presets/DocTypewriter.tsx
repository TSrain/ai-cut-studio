import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/DocTypewriter.tsx —— 文档自书写 preset(docs/presets/doc-typewriter/preset.json)
//
// 复刻来源:src/shotcraft/DocumentTypewriterReveal.tsx(横版 1920×1080,动效词汇已对照
// 原片逐帧验证)。配方卡:docs/catalog/recipes-external/typography/document-typewriter-reveal.md。
//
// 竖版重排决策:1080×1920 没有左右侧栏的空间——原「历史条目落进左栏」改为
// **文档卡下方一条横向历史带**,条目仍从上方逐条落下(几何换了,动效词汇一个没删)。
// 历史条目做成无文字的骨架小卡(折角纸 + 两条灰度条):preset 的 slots 里没有历史
// 内容槽,伪造日期/标题会违反事实正确,骨架卡读作「之前还有几期」正好够用。
//
// 动效词汇(与配方卡逐项对应):
// ① 内容块两两一组被"写出":纸色遮罩右锚左→右擦开,强调色 caret 骑在书写前沿,
//    永远只有一个"笔尖",写完 2f 内熄灭(多 caret 同屏立刻穿帮——配方卡原话)
// ② 相机从 docTitle 特写缓缓拉到整卡:zoom 1.25→1.0 一条 bezier(0.33,0,0.15,1)
// ③ kicker 等宽小字在顶部戳入(屏幕空间,不吃相机变换)
// ④ variant history='show':4 条历史条目从上方逐条落进历史带,bezier(0.2,1.15,0.3,1)
//    轻过冲落地 + 空中投影随高度衰减
// ⑤ @成员名擦出后 4f,强调色底纹从左长出(高亮晚于写入才读作"重点被标出")
//
// 颜色零 hex:纸面/墨色全部 oklch(L, skin.neutralChroma·k, P.hue) 派生,强调件用 P.accent。
// 纸就是纸:即便在暗皮肤下卡面也是浅色(P.mode 只影响纸的白度与投影深浅),
// 深色底上一张被打光的纸,正是"文档是真的"这一镜说服力的来源。
//
// 时长伸缩:行数多时两两一组的 stagger 自动压缩(step 3.5f 起、压不进预算时降到 2f),
// 历史条目同理;伸缩余量全部落在末段静止——3.5s 和 8s 的版本前段性格一致。
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {useBaseline, Backdrop, Foreground, textStyle, alpha} from '../style/baseline';
import {oklch} from '../lib/color';
import {estimateTextWidth, fitFontSize} from '../style/fit';
import {TuneSkin} from '../style/tune';
import {TUNE_FONTS} from './KeyConcept';

export type PresetDocTypewriterProps = {
  durationSeconds: number;
  variant?: {history?: 'show' | 'none'};
  slots: {docTitle: string; meta?: string; lines: string[]; kicker?: string};
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
// 行语法解析:`## `=小标题 / `- `=列点 / `@`开头=成员名 / 其余=正文段
// ---------------------------------------------------------------------------

type Kind = 'title' | 'meta' | 'h2' | 'member' | 'li' | 'p';

const parseLine = (raw: string): {kind: Kind; text: string} => {
  if (raw.startsWith('## ')) return {kind: 'h2', text: raw.slice(3)};
  if (raw.startsWith('- ')) return {kind: 'li', text: raw.slice(2)};
  if (raw.startsWith('@')) return {kind: 'member', text: raw};
  return {kind: 'p', text: raw};
};

// 版式常数(卡内坐标)。估宽走 style/fit 的同一套系数,和展开器口径一致。
const CARD_W = 888;
const CARD_X = (1080 - CARD_W) / 2; // 96
const PAD_X = 64;
const PAD_TOP = 68;
const PAD_BOTTOM = 60;
const CONTENT_W = CARD_W - PAD_X * 2; // 760

const SPEC: Record<Kind, {size: number; lh: number; gap: number; indent: number; floor: number}> = {
  title: {size: 58, lh: 76, gap: 0, indent: 0, floor: 34},
  meta: {size: 26, lh: 40, gap: 12, indent: 0, floor: 18},
  h2: {size: 38, lh: 58, gap: 30, indent: 0, floor: 22},
  member: {size: 32, lh: 50, gap: 26, indent: 0, floor: 20},
  li: {size: 29, lh: 46, gap: 8, indent: 34, floor: 20},
  p: {size: 29, lh: 46, gap: 14, indent: 0, floor: 20},
};

type Block = {kind: Kind; text: string; x: number; y: number; w: number; lh: number; size: number};

const layoutBlocks = (slots: PresetDocTypewriterProps['slots'], contentW = CONTENT_W, landscape = false): Block[] => {
  const items: {kind: Kind; text: string}[] = [{kind: 'title', text: slots.docTitle}];
  if (slots.meta) items.push({kind: 'meta', text: slots.meta});
  for (const raw of slots.lines.slice(0, 10)) items.push(parseLine(raw));
  let y = PAD_TOP;
  const headerCount = slots.meta ? 2 : 1;
  const columns = landscape && slots.lines.length > 6 ? 2 : 1;
  const rowsPerColumn = Math.ceil(Math.min(slots.lines.length, 10) / columns);
  let bodyTop = PAD_TOP;
  const columnY = [0, 0];
  return items.map((it, index) => {
    const s = SPEC[it.kind];
    const body = index >= headerCount;
    const column = body ? Math.floor((index - headerCount) / Math.max(1, rowsPerColumn)) : 0;
    const columnW = body ? (contentW - (columns - 1) * 64) / columns : contentW;
    if (landscape && body) y = bodyTop + columnY[column];
    y += s.gap;
    const maxW = columnW - s.indent;
    // 单行 shrink-to-fit:装不下就缩,缩到 floor 仍装不下由 fitFontSize 抛错(宁红灯不溢出)
    const size = fitFontSize(it.text, {fontSize: s.size, maxWidthPx: maxW, shrinkFloorPx: s.floor});
    const w = Math.min(maxW, Math.round(estimateTextWidth(it.text, size)) + 6);
    const block: Block = {kind: it.kind, text: it.text, x: PAD_X + s.indent + column * (columnW + 64), y, w, lh: s.lh, size};
    y += s.lh;
    if (landscape && body) columnY[column] = y - bodyTop;
    if (!body) bodyTop = y;
    return block;
  });
};

// 书写节奏(配方卡:两两一组,cue = CUE0 + 组号 × step,每块 wipe 8f)
const CUE0 = 6;
const WIPE = 8;
const REVEAL_EASE = Easing.bezier(0.4, 0, 0.6, 1);
const CAM_EASE = Easing.bezier(0.33, 0, 0.15, 1);
const CAM_END = 66;
const DROP_EASE = Easing.bezier(0.2, 1.15, 0.3, 1); // 历史条目落地的 1.15 过冲
const WASH_EASE = Easing.bezier(0.3, 0, 0.2, 1);

// 历史带(竖版重排:横向一条,4 张骨架小卡)
const HIST_N = 4;
const HIST_GAP = 24;
const HIST_TOP_GAP = 36;
const HIST_H = 168;
const HIST_W = (CARD_W - HIST_GAP * (HIST_N - 1)) / HIST_N; // 204

const Inner: React.FC<PresetDocTypewriterProps> = ({slots, variant, tune}) => {
  const frame = useCurrentFrame();
  const {durationInFrames: F, width, height} = useVideoConfig();
  const landscape = width > height;
  const cardW = landscape ? Math.round(width * 0.66) : CARD_W;
  const histW = landscape ? Math.round(width * 0.13) : HIST_W;
  const histH = landscape ? 140 : HIST_H;
  const {P, T, skin} = useBaseline();
  const showHistory = (variant?.history ?? 'show') === 'show';
  const tuneScale = tune?.scale ?? 1;
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];

  // ---- 纸面令牌(零 hex:全部由皮肤的 neutralChroma / hue 派生) ----
  const nC = skin.neutralChroma;
  const light = P.mode === 'light';
  const paper = light ? oklch(0.99, nC * 0.5, P.hue) : oklch(0.955, nC * 0.7, P.hue);
  const paperEdge = oklch(light ? 0.88 : 0.84, nC * 1.2, P.hue);
  const inkDoc = oklch(0.26, nC * 1.4, P.hue); // 纸上主墨
  const inkDocSoft = oklch(0.4, nC * 1.5, P.hue); // 纸上正文
  const inkDocMuted = oklch(0.56, nC * 1.6, P.hue); // 纸上弱字(meta/圆点)
  const histPaper = light ? oklch(0.965, nC * 0.6, P.hue) : oklch(0.925, nC * 0.8, P.hue);
  const shadowInk = oklch(0.08, nC, P.hue); // 投影基色(带皮肤色相的近黑,不用纯黑 hex)

  // ---- 布局 ----
  const blocks = layoutBlocks(slots, cardW - PAD_X * 2, landscape);
  const cardH = Math.max(...blocks.map((block) => block.y + block.lh)) + PAD_BOTTOM;
  const totalW = cardW + (landscape && showHistory ? 40 + histW : 0);
  const totalH = landscape ? Math.max(cardH, showHistory ? HIST_N * (histH + HIST_GAP) - HIST_GAP : 0) : cardH + (showHistory ? HIST_TOP_GAP + HIST_H : 0);
  const cardX = landscape ? (width - totalW) / 2 : CARD_X;
  const groupTop = Math.max(landscape ? 128 : 300, Math.round((height - totalH) / 2) - 24);

  // ---- 书写节奏:行数多时 stagger 自动压缩,伸缩余量落在末段静止 ----
  const pairs = Math.ceil(blocks.length / 2);
  const writeBudget = Math.min(60, Math.max(30, Math.round(F * 0.42)));
  const step =
    pairs <= 1 ? 3.5 : Math.min(3.5, Math.max(2, (writeBudget - CUE0 - WIPE - 14) / (pairs - 1)));
  const cueFor = (i: number) => CUE0 + Math.floor(i / 2) * step;
  const writeEnd = cueFor(blocks.length - 1) + WIPE + 14; // 含 @ 底纹长出

  // 历史条目 cue:排在书写完成后;塞不进时长时压缩间隔(永远在 F-8 前落地)
  let histStep = 5;
  let histStart = Math.max(writeEnd + 4, 52);
  if (histStart + (HIST_N - 1) * histStep + 9 > F - 8) {
    histStep = 3;
    histStart = Math.min(histStart, Math.max(writeEnd + 2, F - 17 - (HIST_N - 1) * histStep));
  }

  // ---- 相机:docTitle 特写 → 整卡,一条 bezier ----
  const title = blocks[0];
  const focusX0 = cardX + title.x + Math.min(title.w, 520) / 2;
  const focusY0 = groupTop + title.y + title.lh / 2 + 46;
  const zoom = interpolate(frame, [0, CAM_END], [landscape ? 1.12 : 1.25, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: CAM_EASE,
  });
  const fx = interpolate(frame, [0, CAM_END], [focusX0, width / 2], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: CAM_EASE,
  });
  const fy = interpolate(frame, [0, CAM_END], [focusY0, height / 2], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: CAM_EASE,
  });

  // 永远只有一个"笔尖":最新处于书写窗口内的块
  let caretIdx = -1;
  blocks.forEach((_, i) => {
    if (frame >= cueFor(i) && frame <= cueFor(i) + WIPE + 2) caretIdx = i;
  });

  const kick = interpolate(frame, [6, 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const styleFor = (b: Block): React.CSSProperties => {
    switch (b.kind) {
      case 'title':
        return {
          ...textStyle(T, 'quote'),
          ...(tuneFont ? {fontFamily: tuneFont} : {}),
          fontSize: b.size,
          letterSpacing: '-0.01em',
          color: inkDoc,
        };
      case 'meta':
        return {...textStyle(T, 'body'), fontSize: b.size, color: inkDocMuted};
      case 'h2':
        return {...textStyle(T, 'h2'), fontSize: b.size, color: inkDoc};
      case 'member':
        return {...textStyle(T, 'h2'), fontSize: b.size, color: inkDoc};
      default:
        return {...textStyle(T, 'body'), fontSize: b.size, color: inkDocSoft};
    }
  };

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden'}}>
      <Backdrop />

      {/* 相机空间(页面 1080×1920) */}
      <div
        style={{
          position: 'absolute',
          width,
          height,
          transform: `translate(${width / 2 - fx * zoom}px, ${height / 2 - fy * zoom}px) scale(${zoom})`,
          transformOrigin: 'top left',
        }}
      >
        {/* 卡组(文档卡 + 历史带);tune 的 x/y/scale 只动这一组 */}
        <div
          style={{
            position: 'absolute',
            left: cardX + (tune?.x ?? 0),
            top: groupTop + (tune?.y ?? 0),
            width: totalW,
            height: totalH,
            transform: `scale(${tuneScale})`,
            transformOrigin: '50% 0%',
          }}
        >
          {/* 纸质文档卡:第 0 帧已在(首帧不黑),内容从纸色遮罩后擦出 */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: cardW,
              height: cardH,
              background: paper,
              borderRadius: 26,
              border: `1px solid ${alpha(paperEdge, 0.9)}`,
              boxShadow: `0 32px 90px ${alpha(shadowInk, light ? 0.16 : 0.5)}, 0 2px 10px ${alpha(shadowInk, light ? 0.08 : 0.3)}`,
            }}
          />

          {blocks.map((b, i) => {
            const cue = cueFor(i);
            const coverT = interpolate(frame, [cue, cue + WIPE], [1, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: REVEAL_EASE,
            });
            // 遮罩向左多盖列点圆点(配方卡:烤入的排版细节都要这样排查)
            const bx = b.x - (b.kind === 'li' ? 30 : 6);
            const bw = b.w + (b.kind === 'li' ? 38 : 12);
            const caretX = bx + bw * (1 - coverT);
            const caretH = Math.min(Math.round(b.size * 0.92), b.lh - 8);
            // ⑤ @成员名:擦出后 4f 补一条强调色底纹从左长出
            const washCue = cue + WIPE + 4;
            const wash =
              b.kind === 'member'
                ? interpolate(frame, [washCue, washCue + 8], [0, 1], {
                    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: WASH_EASE,
                  })
                : 0;
            return (
              <div key={`b${i}`}>
                {wash > 0 ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: b.x - 12,
                      top: b.y + 2,
                      width: (b.w + 24) * wash,
                      height: b.lh - 4,
                      background: alpha(P.accent, 0.2),
                      borderLeft: `4px solid ${P.accent}`,
                      borderRadius: 6,
                    }}
                  />
                ) : null}
                <EditableText as="div" part={b.kind === "title" ? "docTitle" : b.kind === "meta" ? "meta" : `line-${i - 1 - (slots.meta ? 1 : 0)}`}
                  style={{
                    position: 'absolute',
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.lh,
                    ...styleFor(b),
                    lineHeight: `${b.lh}px`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.kind === 'li' ? (
                    <span style={{position: 'absolute', left: -24, color: inkDocMuted}}>·</span>
                  ) : null}
                  {b.text}
                </EditableText>
                {/* ① 纸色遮罩右锚,左→右擦开 */}
                {coverT > 0 ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: bx,
                      top: b.y - 3,
                      width: bw,
                      height: b.lh + 6,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: `${coverT * 100}%`,
                        background: paper,
                      }}
                    />
                  </div>
                ) : null}
                {/* 强调色 caret 骑在书写前沿;写完 2f 内熄灭 */}
                {i === caretIdx ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: caretX,
                      top: b.y + (b.lh - caretH) / 2,
                      width: 3,
                      height: caretH,
                      background: P.accent,
                      opacity:
                        coverT > 0
                          ? 1
                          : interpolate(frame, [cue + WIPE, cue + WIPE + 2], [1, 0], {
                              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                            }),
                    }}
                  />
                ) : null}
              </div>
            );
          })}

          {/* ④ 历史带:4 条骨架条目从上方逐条落卡(1.15 过冲落地 + 空中投影) */}
          {showHistory
            ? Array.from({length: HIST_N}, (_, i) => {
                const cue = histStart + i * histStep;
                if (frame < cue) return null;
                const t = interpolate(frame, [cue, cue + 9], [0, 1], {
                  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: DROP_EASE,
                });
                const appear = interpolate(frame, [cue, cue + 3], [0, 1], {
                  extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                });
                const air = Math.max(0, 1 - t);
                return (
                  <div
                    key={`h${i}`}
                    style={{
                      position: 'absolute',
                      left: landscape ? cardW + 40 : i * (HIST_W + HIST_GAP),
                      top: landscape ? i * (histH + HIST_GAP) : cardH + HIST_TOP_GAP,
                      width: histW,
                      height: histH,
                      transform: `translateY(${-56 * air}px)`,
                      opacity: appear,
                      background: histPaper,
                      borderRadius: 18,
                      border: `1px solid ${alpha(paperEdge, 0.8)}`,
                      boxShadow:
                        air > 0.02
                          ? `0 ${10 + 14 * air}px ${24 + 22 * air}px ${alpha(shadowInk, 0.14 + 0.2 * air)}`
                          : `0 10px 24px ${alpha(shadowInk, light ? 0.1 : 0.32)}`,
                      padding: '20px 18px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* 折角纸图标 + 两条灰度骨架条(不伪造往期标题/日期,只表意"之前还有几期") */}
                    <div
                      style={{
                        position: 'relative',
                        width: 34,
                        height: 42,
                        border: `2px solid ${alpha(inkDoc, 0.3)}`,
                        borderRadius: 5,
                        background: paper,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          right: -2,
                          top: -2,
                          width: 0,
                          height: 0,
                          borderLeft: '12px solid transparent',
                          borderTop: `12px solid ${alpha(inkDoc, 0.3)}`,
                          borderTopRightRadius: 4,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        marginTop: 22,
                        width: '78%',
                        height: 9,
                        borderRadius: 5,
                        background: alpha(inkDoc, 0.22),
                      }}
                    />
                    <div
                      style={{
                        marginTop: 10,
                        width: '52%',
                        height: 9,
                        borderRadius: 5,
                        background: alpha(inkDoc, 0.12),
                      }}
                    />
                  </div>
                );
              })
            : null}
        </div>
      </div>

      {/* ③ kicker:屏幕空间等宽小字,顶部戳入(scale 1.35→1 的"盖章") */}
      {slots.kicker ? (
        <EditableText as="div" part="kicker"
          style={{
            position: 'absolute',
            top: landscape ? 54 : 148,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: T.families.mono,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: P.inkMuted,
            opacity: kick,
            transform: `scale(${1.35 - 0.35 * kick})`,
            transformOrigin: '50% 50%',
          }}
        >
          {slots.kicker}
        </EditableText>
      ) : null}

      <Foreground />
    </EditorScene>
  );
};

// 不自带 Provider:无 Provider 时 useBaseline 落到默认皮肤;StyleBible 比稿时可用 Provider 覆盖
export const PresetDocTypewriter: React.FC<PresetDocTypewriterProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
