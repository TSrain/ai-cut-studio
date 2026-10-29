import {rangeRuns, type TextRange} from '../presets/recede-controls.mjs';
// style/fit.ts —— 文字估宽 + 确定性 shrink-to-fit
//
// 这是「字数上限是推导值不是存值」的渲染期防线:preset 组件用它把槽位文字
// 缩进 fit.maxWidthPx;缩到 shrinkFloorPx 仍放不下就 throw——宁可 render-queue
// 红灯,不出溢出画面。展开期防线在 tools/lib/preset.mjs(P1 落地)。
//
// ⚠️ 系数两份:这里(TS,组件用)和 tools/lib/preset.mjs(JS,展开器用)。
// 两边无法互相 import,靠 tools/tests/preset.test.mjs 用同一组中英混排样例对拍。
// 改任何一个数字,必须两边同改 + 跑测试。
//
// 系数口径:以 fontSize 为 1em 的宽度比。
// - CJK 全角(含全角标点)≈ 1.00
// - 拉丁字母 ≈ 0.52(Inter/Archivo 平均;比 Helvetica 宽,见 taste.md A8)
// - 数字 ≈ 0.60(tabular-nums 下更接近 0.6 而不是 0.52)
// - 空格 ≈ 0.30
// - 中西混排时西文段 ×1.06(对齐 lib/fonts.ts 的 latinInline 补偿)
// 估算是近似 → 展开器侧留 8% 保险余量;本模块只负责"绝不溢出"。

export const FIT_COEFF = {
  cjk: 1.0,
  latin: 0.52,
  digit: 0.6,
  space: 0.3,
  mixedLatinBoost: 1.06,
} as const;

const CJK_RE =
  /[⺀-⻿　-〿㇀-㇯㈀-鿿豈-﫿︰-﹏＀-｠￠-￦]/;

const hasCjk = (text: string): boolean => CJK_RE.test(text);

/** 估算单行文字宽度(px)。letterSpacingEm 传 textStyle 里的字距(如 -0.03)。 */
export const estimateTextWidth = (
  text: string,
  fontSize: number,
  letterSpacingEm = 0,
): number => {
  const boost = hasCjk(text) ? FIT_COEFF.mixedLatinBoost : 1;
  let em = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === ' ') em += FIT_COEFF.space;
    else if (ch >= '0' && ch <= '9') em += FIT_COEFF.digit * boost;
    else if (CJK_RE.test(ch)) em += FIT_COEFF.cjk;
    else em += FIT_COEFF.latin * boost;
  }
  const chars = Array.from(text).length;
  if (chars > 1) em += letterSpacingEm * (chars - 1);
  return em * fontSize;
};

export type FitSpec = {
  fontSize: number;
  maxWidthPx: number;
  /** 缩到这个字号仍放不下 → throw。 */
  shrinkFloorPx: number;
  letterSpacingEm?: number;
};

/**
 * 确定性 shrink-to-fit:不用 DOM 测量(保确定性,且与展开器口径一致)。
 * 返回实际该用的字号;槽位文字在 floor 字号下仍超宽时抛错。
 */
export const fitFontSize = (text: string, spec: FitSpec): number => {
  const {fontSize, maxWidthPx, shrinkFloorPx, letterSpacingEm = 0} = spec;
  const width = estimateTextWidth(text, fontSize, letterSpacingEm);
  if (width <= maxWidthPx) return fontSize;
  const scaled = Math.floor((fontSize * maxWidthPx) / width);
  if (scaled >= shrinkFloorPx) return scaled;
  throw new Error(
    `[fit] 文字「${text}」在 ${shrinkFloorPx}px(下限)仍超出 ${maxWidthPx}px——` +
      `该槽装不下这么多字,请缩短文案(估宽 ${Math.round(width)}px @ ${fontSize}px)`,
  );
};

// ---------------------------------------------------------------------------
// 折行 + 主焦点排版(recede v2 起用)
//
// ⚠️ 与 tools/lib/preset.mjs 的 layoutEmphasisText 是同一算法的两份手抄(TS 组件用 /
// JS 展开器用,无法互相 import)。改任何一边必须两边同改,tools/tests/preset.test.mjs
// 会对拍常量与行为。
//
// 规则:①\n 是硬断行;②折行单元 = 每个汉字一个 / 西文连写一个 / 空格是可丢的分隔符;
// ③emphasis(hero)整段不拆,除非它自己就超过一行宽;④避头标点不许在行首;
// ⑤行数超上限才逐档缩字,缩到 shrinkFloorPx 仍排不下就抛;
// ⑥定行数后二分目标宽度做均衡,避免"一行满一行一个字"的孤字尾行。
// ---------------------------------------------------------------------------

export const EMPHASIS_RATIO_DEFAULT = 1.6;
/** 折行的保险余量:估宽是近似,统一在 layoutEmphasisText 内部收窄,展开器与组件因此永远算出同一版式 */
export const WRAP_SAFETY = 0.92;
/** 无 hero 时为「少占一行」愿意缩到的字号比例;缩过头才折行(保住 v1 的 shrink-to-fit 手感) */
export const SHRINK_TOLERANCE = 0.78;
/** 避头标点:不许出现在行首 */
export const NO_LINE_START = '，。、；：！？）》」』】,.;:!?)]}';

type Unit = {text: string; em: boolean; space: boolean};
type MeasuredUnit = Unit & {w: number};
export type TextRun = {text: string; em: boolean};

const unitWidth = (text: string, fontSize: number, boost: number): number => {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === '　') em += FIT_COEFF.space;
    else if (ch >= '0' && ch <= '9') em += FIT_COEFF.digit * boost;
    else if (CJK_RE.test(ch)) em += FIT_COEFF.cjk;
    else em += FIT_COEFF.latin * boost;
  }
  return em * fontSize;
};

const tokenize = (text: string, em: boolean): Unit[] => {
  const units: Unit[] = [];
  let buf = '';
  const flush = () => {
    if (buf !== '') {
      units.push({text: buf, em, space: false});
      buf = '';
    }
  };
  for (const ch of text) {
    if (ch === ' ' || ch === '　') {
      flush();
      units.push({text: ch, em, space: true});
    } else if (CJK_RE.test(ch)) {
      flush();
      units.push({text: ch, em, space: false});
    } else buf += ch;
  }
  flush();
  return units;
};

const buildUnits = (segment: string, emphasis: string | undefined, atomic: boolean): Unit[] => {
  if (!emphasis) return tokenize(segment, true);
  const idx = segment.indexOf(emphasis);
  if (idx < 0) return tokenize(segment, false);
  return [
    ...tokenize(segment.slice(0, idx), false),
    ...(atomic ? [{text: emphasis, em: true, space: false}] : tokenize(emphasis, true)),
    ...tokenize(segment.slice(idx + emphasis.length), false),
  ];
};

const lineWidth = (line: MeasuredUnit[]): number => line.reduce((sum, u) => sum + u.w, 0);

const greedyWrap = (
  unitsBySegment: Unit[][],
  sizes: {base: number; em: number; boost: number},
  target: number,
): MeasuredUnit[][] => {
  const lines: MeasuredUnit[][] = [];
  for (const units of unitsBySegment) {
    let cur: MeasuredUnit[] = [];
    let curW = 0;
    const dropTrailingSpace = () => {
      while (cur.length > 0 && cur[cur.length - 1].space) curW -= (cur.pop() as MeasuredUnit).w;
    };
    for (const u of units) {
      const w = unitWidth(u.text, u.em ? sizes.em : sizes.base, sizes.boost);
      const unit: MeasuredUnit = {...u, w};
      if (u.space) {
        if (cur.length === 0) continue;
        cur.push(unit);
        curW += w;
        continue;
      }
      if (cur.length > 0 && curW + w > target) {
        let carry: MeasuredUnit[] = [];
        if (NO_LINE_START.includes(u.text)) {
          dropTrailingSpace();
          if (cur.length > 1) {
            const last = cur.pop() as MeasuredUnit;
            curW -= last.w;
            carry = [last];
          }
        }
        dropTrailingSpace();
        if (cur.length > 0) lines.push(cur);
        cur = carry;
        curW = lineWidth(carry);
      }
      cur.push(unit);
      curW += w;
    }
    dropTrailingSpace();
    if (cur.length > 0) lines.push(cur);
  }
  return lines;
};

const mergeRuns = (line: MeasuredUnit[]): TextRun[] => {
  const runs: TextRun[] = [];
  for (const u of line) {
    const last = runs[runs.length - 1];
    if (last && last.em === u.em) last.text += u.text;
    else runs.push({text: u.text, em: u.em});
  }
  return runs;
};

export type EmphasisSpec = {
  /** 基准档字号(非主焦点部分) */
  fontSize: number;
  maxWidthPx: number;
  maxLines: number;
  shrinkFloorPx: number;
  /** 要放大的子串;不传或不逐字命中 = 整句都是主焦点(等同 v1 单字号) */
  emphasis?: string;
  /** Explicit ranges override legacy hero; [] means ordinary text. */
  emphasisRanges?: TextRange[];
  emphasisRatio?: number;
};

export type EmphasisLayout = {
  baseSize: number;
  emphasisSize: number;
  lines: TextRun[][];
  maxLineWidthPx: number;
  lineCount: number;
};

export const layoutEmphasisText = (text: string, spec: EmphasisSpec): EmphasisLayout => {
  const {
    fontSize,
    maxWidthPx: declaredWidth,
    maxLines,
    shrinkFloorPx,
    emphasis,
    emphasisRanges,
    emphasisRatio = EMPHASIS_RATIO_DEFAULT,
  } = spec;
  const maxWidthPx = declaredWidth * WRAP_SAFETY;
  const source = String(text);
  if (!source.trim()) return {baseSize: fontSize, emphasisSize: Math.round(fontSize * emphasisRatio), lines: [], maxLineWidthPx: 0, lineCount: 0};
  const boost = hasCjk(source) ? FIT_COEFF.mixedLatinBoost : 1;
  const emph = emphasis && source.includes(emphasis) ? emphasis : undefined;
  const segments = source.split('\n');

  const attempt = (base: number, lineBudget: number): EmphasisLayout | null => {
    const sizes = {base, em: Math.round(base * emphasisRatio), boost};
    const atomic = emph ? unitWidth(emph, sizes.em, boost) <= maxWidthPx : false;
    let offset = 0;
    const unitsBySegment = segments.map((s) => {
      if (emphasisRanges === undefined) return buildUnits(s, emph, atomic);
      const runs = rangeRuns(s, emphasisRanges.map(r => ({start: r.start - offset, end: r.end - offset})));
      offset += s.length + 1;
      return runs.flatMap(run => run.em && !/\s/.test(run.text) && unitWidth(run.text, sizes.em, boost) <= maxWidthPx
        ? [{text: run.text, em: true, space: false}] : tokenize(run.text, run.em));
    });
    let lines = greedyWrap(unitsBySegment, sizes, maxWidthPx);
    if (lines.length > lineBudget) return null;
    if (Math.max(...lines.map(lineWidth)) > maxWidthPx) return null;
    let lo = 1;
    let hi = Math.ceil(maxWidthPx);
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (greedyWrap(unitsBySegment, sizes, mid).length <= lines.length) hi = mid;
      else lo = mid + 1;
    }
    const balanced = greedyWrap(unitsBySegment, sizes, hi);
    if (balanced.length <= lines.length && Math.max(...balanced.map(lineWidth)) <= maxWidthPx) {
      lines = balanced;
    }
    return {
      baseSize: base,
      emphasisSize: sizes.em,
      lines: lines.map(mergeRuns),
      maxLineWidthPx: Math.round(Math.max(...lines.map(lineWidth))),
      lineCount: lines.length,
    };
  };

  // 无 hero:优先少占行,允许缩到 SHRINK_TOLERANCE 再折行(保住 v1 手感);
  // 有 hero:主焦点的绝对大小是重点,先满字号折行,不够再缩。
  const declared = Math.round(fontSize);
  const tolFloor = (emph || emphasisRanges !== undefined)
    ? declared
    : Math.max(shrinkFloorPx, Math.round(declared * SHRINK_TOLERANCE));
  for (let n = 1; n <= maxLines; n += 1) {
    for (let base = declared; base >= tolFloor; base -= 1) {
      const layout = attempt(base, n);
      if (layout) return layout;
    }
  }
  for (let base = tolFloor - 1; base >= shrinkFloorPx; base -= 1) {
    const layout = attempt(base, maxLines);
    if (layout) return layout;
  }
  throw new Error(
    `[fit] 文字「${source.replace(/\n/g, '⏎')}」在 ${shrinkFloorPx}px(下限)、${maxLines} 行内仍排不下 ` +
      `${maxWidthPx}px——请缩短文案`,
  );
};
