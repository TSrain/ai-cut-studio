import {EditableText, EditorScene} from '../editor/preset-editing';
// presets/CardSwarm.tsx —— 卡片群收束 preset(docs/presets/card-swarm/preset.json)
//
// 定位:口播讲「东西很多 → 真正有用的很少」时的画面。这是本项目历史上**被手搓最多次**的
// 一种镜头(SC-0020 Shot2 / SC-0025 Shot3·Shot5·Shot6,四次),候选登记簿点名 CardFlowGrid。
// 固化的是它每次都一样的那三拍,不是某一次的具体内容:
//
//   ① 铺满 —— 卡片按「离中心由近及远」依次弹入,填满网格。快 stagger(历史实测 1.15 帧/张)
//   ② 收束 —— 该走的走:dedup 模式是被最近的留存卡吸走(局部塌缩),filter 模式是变暗下滑出画
//   ③ 留下 —— 少数幸存卡重排到画面中心,accent 描边 + 微光;末段留 ~1.5s 静止读取
//
// ============ 为什么是这三拍,不是五拍 ============
//
// 历史上做过五阶段版(涌入/去重/过滤/打分/精选,13 秒),用户反馈「精简两拍版没有第一版好」,
// 但返工后的结论是:**多的那两拍值钱的是"演完整",不是"分得细"**。所以这里保留三拍的骨架,
// 中间那拍用 `mode` 切换语义(吸入 or 刷掉),要更细的分阶段就该走 custom 镜,不该塞进模板。
// (taste.md 2026-07-31 Shot5/Shot6 两条记录)
//
// ============ 踩过的坑 ============
//
// 1. **棋盘布局**:被吸走的卡要"每张都被留存卡包围",吸入路径才短、局部塌缩才读得清。
//    随机指定谁留谁走 → 会出现一大片同时飞向很远的一张卡,读作"乱"而不是"合并"。
//    这里用 `nearestKeep` 纯函数按网格距离算,同 seed 逐位可复现。
// 2. **不许首帧淡入**:插片是硬切进来的,第 0 帧必须已经有东西(哪怕只有底和眉题),
//    否则和上一镜之间闪一下黑。
// 3. **末段必须静止**:动作在 82% 处全部停住,留出读取时间。口播还在说话时画面已经安静,
//    这是插片和"动画演示"的区别。
// 4. 卡片尺寸随列数算,不写死 —— 5 列和 6 列的视觉密度差很多,写死一套值换列数就崩。

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {Backdrop, Eyebrow, Foreground, useBaseline} from '../style/baseline';
import {textStyle, alpha} from '../lib/theme';
import {TUNE_FONTS} from './KeyConcept';
import {TuneSkin} from '../style/tune';
import {ENTER, MOVE} from '../lib/anim';
import {fitFontSize} from '../style/fit';

export type PresetCardSwarmProps = {
  durationSeconds: number;
  variant?: {mode?: 'dedup' | 'filter'; cols?: 4 | 5 | 6};
  slots: {
    total: number;
    keep: number;
    eyebrow?: string;
    caption?: string;
    keepLabel?: string;
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

// 三拍的相位切点(占总时长的比例)。**这是 timing is frozen 的那部分**,
// 改它等于改这个模板的性格,要改就升 preset 版本、重渲样张。
// **settle 要和 cull 重叠**,这是这个模板最容易做错的一处:
// 如果等"走的全走完"再开始"留的聚拢",中间会出现一段死画面——非留存卡已经消失,
// 留存卡还散在原位且没高亮,观众看到的是几张孤零零的暗卡。
// 让留存卡在吸入进行到一半时就开始移动+点亮,"吸走"和"聚拢"读作同一个动作的两面。
const PHASE = {cullStart: 0.4, cullEnd: 0.68, settleStart: 0.52, settleEnd: 0.8, capStart: 0.62, capEnd: 0.84};
const FILL_STEP_FRAMES = 1.15; // 历史实测值:再慢就拖,再快就读不出"一张张来"

const CANVAS = {w: 1080, h: 1920};
const GRID_TOP = 520;
const GRID_H = 980;

/** mulberry32:确定性伪随机。同 seed 逐位可复现(design-principles §9) */
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Cell = {i: number; col: number; row: number; x: number; y: number; d: number; keep: boolean};

/**
 * 把 total 张卡摆成网格,并决定谁留下。
 *
 * 留存卡**均匀撒开**而不是随机挑:随机会撞出"两张留存卡挨在一起、另一角一张都没有"的局面,
 * 被吸走的卡就得横穿半个画面,读作乱飞。均匀撒 = 每张走卡身边都有留存卡可去。
 */
const layout = (total: number, keep: number, cols: number, canvasW = CANVAS.w, gridTop = GRID_TOP, gridH = GRID_H): Cell[] => {
  const rows = Math.ceil(total / cols);
  const cw = (canvasW - 120) / cols;
  const ch = gridH / rows;
  const cx = canvasW / 2;
  const cy = gridTop + gridH / 2;
  const cells: Cell[] = [];
  // 均匀撒:按 total/keep 的步长取,再用 seed 做一点点抖动避免摆成一条直线
  const step = total / Math.max(1, keep);
  const jit = rng(7);
  const keepSet = new Set<number>();
  for (let k = 0; k < keep; k++) {
    const base = Math.floor(k * step + step / 2);
    const off = Math.floor((jit() - 0.5) * Math.min(2, step - 1));
    keepSet.add(Math.max(0, Math.min(total - 1, base + off)));
  }
  // 抖动可能撞车,补齐到 keep 张
  for (let i = 0; keepSet.size < keep && i < total; i++) keepSet.add(i);
  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 60 + col * cw + cw / 2;
    const y = gridTop + row * ch + ch / 2;
    cells.push({i, col, row, x, y, d: Math.hypot(x - cx, y - cy), keep: keepSet.has(i)});
  }
  return cells;
};

/** 被吸走的卡去哪儿:网格距离最近的那张留存卡(纯函数,不依赖渲染顺序) */
const nearestKeep = (c: Cell, cells: Cell[]) => {
  let best = cells.find((x) => x.keep) ?? c;
  let bd = Infinity;
  for (const k of cells) {
    if (!k.keep) continue;
    const d = Math.hypot(k.col - c.col, k.row - c.row);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
};

const Inner: React.FC<PresetCardSwarmProps> = ({durationSeconds, variant, slots, tune}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width > height;
  const canvasW = landscape ? width : CANVAS.w;
  const gridTop = landscape ? height * 0.18 : GRID_TOP;
  const gridH = landscape ? height * 0.54 : GRID_H;
  const {P, T, pad} = useBaseline();
  const total = Math.max(4, Math.min(48, Math.round(slots.total)));
  const keep = Math.max(1, Math.min(total - 1, Math.round(slots.keep)));
  const cols = landscape ? Math.min(total, Math.max(6, Math.round((variant?.cols ?? 5) * 1.6))) : variant?.cols ?? 5;
  const mode = variant?.mode ?? 'dedup';
  const tuneFont = TUNE_FONTS[tune?.font ?? 'skin'];
  const tuneScale = tune?.scale ?? 1;

  const dur = durationSeconds * fps;
  const p = (a: number, b: number, easing = MOVE) =>
    interpolate(frame, [a * dur, b * dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});

  const cells = layout(total, keep, cols, canvasW, gridTop, gridH);
  const rows = Math.ceil(total / cols);
  const cw = (canvasW - 120) / cols;
  const ch = gridH / rows;
  const cardW = cw * 0.87;
  const cardH = Math.min(ch * 0.78, cardW * 0.72);

  const cull = p(PHASE.cullStart, PHASE.cullEnd);
  const settle = p(PHASE.settleStart, PHASE.settleEnd, ENTER);
  const capIn = p(PHASE.capStart, PHASE.capEnd, ENTER);

  // 留存卡收束后的落位:居中一行(或两行),比原网格小一号——"少而精"要在尺寸上也说出来
  const keepCells = cells.filter((c) => c.keep);
  const kCols = Math.min(keep, landscape ? 6 : 4);
  const kRows = Math.ceil(keep / kCols);
  const kw = cardW * 1.04;
  const kh = cardH * 1.04;
  const kGapX = kw * 1.24;
  const kGapY = landscape ? Math.min(kh * 1.34, gridH / (kRows + 0.5)) : kh * 1.34;

  return (
    <EditorScene style={{backgroundColor: P.bg, overflow: 'hidden', fontFamily: tuneFont}}>
      <Backdrop />
      {slots.eyebrow ? <Eyebrow text={slots.eyebrow} top={landscape ? 80 : 220} /> : null}

      {cells.map((c) => {
        // ① 铺满:由内向外,离中心越近越先来
        const order = [...cells].sort((a, b) => a.d - b.d).findIndex((x) => x.i === c.i);
        const startF = order * FILL_STEP_FRAMES;
        const inT = interpolate(frame, [startF, startF + fps * 0.22], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: ENTER,
        });

        let x = c.x;
        let y = c.y;
        let op = inT;
        let sc = 0.82 + 0.18 * inT;

        if (c.keep) {
          // ③ 留下的:收束到中心区,放大一点点 + accent 描边
          const ki = keepCells.findIndex((k) => k.i === c.i);
          const kc = ki % kCols;
          const kr = Math.floor(ki / kCols);
          const tx = canvasW / 2 + (kc - (kCols - 1) / 2) * kGapX;
          const ty = gridTop + gridH / 2 + (kr - (kRows - 1) / 2) * kGapY;
          x = c.x + (tx - c.x) * settle;
          y = c.y + (ty - c.y) * settle;
          sc = sc * (1 + 0.1 * settle);
        } else if (mode === 'dedup') {
          // ② dedup:被最近的留存卡吸走,末段缩没
          const k = nearestKeep(c, cells);
          x = c.x + (k.x - c.x) * cull;
          y = c.y + (k.y - c.y) * cull;
          sc = sc * (1 - 0.72 * cull);
          op = inT * (1 - cull);
        } else {
          // ② filter:变暗 + 下滑出画
          y = c.y + 260 * cull * cull;
          op = inT * (1 - cull) * 0.85;
          sc = sc * (1 - 0.1 * cull);
        }

        const accent = c.keep && settle > 0.02;
        return (
          <div
            key={c.i}
            style={{
              position: 'absolute',
              left: x - cardW / 2,
              top: y - cardH / 2,
              width: cardW,
              height: cardH,
              transform: `scale(${sc})`,
              opacity: op,
              borderRadius: 10,
              background: accent
                ? `linear-gradient(160deg, ${alpha(P.accent, 0.24)} 0%, ${alpha(P.accent, 0.1)} 100%)`
                : P.surfaceRaised,
              border: `1.5px solid ${accent ? alpha(P.accent, 0.85) : alpha(P.line, 0.7)}`,
              boxShadow: accent ? `0 0 ${26 * settle}px ${alpha(P.accent, 0.42 * settle)}` : 'none',
            }}
          >
            {/* 卡内两条骨架线:让它读作"一张有内容的卡",而不是一个色块。
                不放真文字——三十张卡上的真文字没人看得完,只会把画面变脏 */}
            <div
              style={{
                position: 'absolute',
                left: cardW * 0.12,
                top: cardH * 0.3,
                width: cardW * 0.62,
                height: 4,
                borderRadius: 2,
                background: alpha(accent ? P.accent : P.inkMuted, accent ? 0.8 : 0.32),
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: cardW * 0.12,
                top: cardH * 0.5,
                width: cardW * 0.4,
                height: 4,
                borderRadius: 2,
                background: alpha(P.inkMuted, accent ? 0.5 : 0.22),
              }}
            />
          </div>
        );
      })}

      {/* 留下那批的标签:跟着收束一起出现,贴在中心区上方 */}
      {slots.keepLabel ? (
        <EditableText as="div" part="keepLabel"
          style={{
            position: 'absolute',
            left: pad,
            right: pad,
            top: gridTop + gridH / 2 - kRows * kGapY * 0.5 - 96,
            textAlign: 'center',
            ...textStyle(T, 'label'),
            color: P.accent,
            opacity: settle,
            transform: `translateY(${12 * (1 - settle)}px)`,
          }}
        >
          {slots.keepLabel}
        </EditableText>
      ) : null}

      {slots.caption ? (
        <EditableText as="div" part="caption"
          style={{
            position: 'absolute',
            left: pad,
            right: pad,
            top: landscape ? height * 0.83 : 1560,
            textAlign: landscape ? 'center' : undefined,
            ...textStyle(T, 'h2'),
            fontSize: Math.round(
              fitFontSize(slots.caption, {fontSize: 60, maxWidthPx: landscape ? width - pad * 2 : 936, shrinkFloorPx: 40}) * tuneScale,
            ),
            color: P.ink,
            lineHeight: 1.35,
            opacity: capIn,
            transform: `translateY(${(tune?.y ?? 0) + 18 * (1 - capIn)}px)`,
          }}
        >
          {slots.caption.split('\n').map((l, i) => (
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
export const PresetCardSwarm: React.FC<PresetCardSwarmProps> = (props) => (
  <TuneSkin tune={props.tune}>
    <Inner {...props} />
  </TuneSkin>
);
