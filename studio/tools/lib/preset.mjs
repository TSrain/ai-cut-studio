import {rangeRuns, normalizeRanges} from '../../templates/remotion-base/src/presets/recede-controls.mjs';
// tools/lib/preset.mjs —— preset 定义加载/校验 + 槽位校验(含估宽硬门)+ 合同展开
//
// preset 镜 = 数据不是代码:合同里只写 {preset:{id,version}, presetProps},本模块负责
// ①读 docs/presets/<id>/preset.json 并做结构校验;②校验槽位(类型/必填/估宽/enum/图片存在);
// ③把 preset 展开成完整合同字段(engine/tags/objective/anchors/durationSeconds)与 props.json。
//
// ⚠️ 估宽系数与 templates/remotion-base/src/style/fit.ts 是同一组数字的两份手抄
// (TS 组件用/JS 展开器用,无法互相 import)。改任何数字必须两边同改,
// tools/tests/preset.test.mjs 里的期望宽度样例会拦住单边漂移。
//
// 估宽门的语义与渲染期 shrink-to-fit 完全同构(两道防线一个口径):
//   声明字号装得下(≤ maxWidthPx×0.92)→ 原样;
//   缩到 shrinkFloorPx 能装下 → 通过,提示实际渲染字号;
//   下限仍装不下 → 硬失败,报"该槽最多约 N 个字"。

import {readFile, mkdir, writeFile, copyFile, access} from 'node:fs/promises';
import {join, basename} from 'node:path';

export const FIT_COEFF = {
  cjk: 1.0,
  latin: 0.52,
  digit: 0.6,
  space: 0.3,
  mixedLatinBoost: 1.06,
};

const CJK_RE = /[⺀-⻿　-〿㇀-㇯㈀-鿿豈-﫿︰-﹏＀-｠￠-￦]/;

const hasCjk = (text) => CJK_RE.test(text);

export const estimateTextWidth = (text, fontSize, letterSpacingEm = 0) => {
  const boost = hasCjk(text) ? FIT_COEFF.mixedLatinBoost : 1;
  let em = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === ' ') em += FIT_COEFF.space;
    else if (ch >= '0' && ch <= '9') em += FIT_COEFF.digit * boost;
    else if (CJK_RE.test(ch)) em += FIT_COEFF.cjk;
    else em += FIT_COEFF.latin * boost;
  }
  const chars = Array.from(text).length;
  if (chars > 1) em += letterSpacingEm * (chars - 1);
  return em * fontSize;
};

// ---------------------------------------------------------------------------
// 折行 + 主焦点排版(recede v2 起用;与 fit.ts 的 TS 手抄份同构)
//
// 一个槽可以声明 wrap:true —— 文字不再是「一行装不下就缩字」,而是先折行、行数超上限
// 才缩字。声明 emphasisSlot 时,另一个槽的值(必须是本槽文字的子串)被放大成主焦点,
// 其余降一档,一句话内部因此有主次。两边(展开器 / 组件)必须算出同一个版式,
// 所以算法写死在这两份手抄里,不许任何一边"就地估一个"。
// ---------------------------------------------------------------------------

export const EMPHASIS_RATIO_DEFAULT = 1.6;
/** 折行的保险余量:估宽是近似,统一在 layoutEmphasisText 内部收窄,展开器与组件因此永远算出同一版式 */
export const WRAP_SAFETY = 0.92;
/** 无 hero 时为「少占一行」愿意缩到的字号比例;缩过头才折行(保住 v1 的 shrink-to-fit 手感) */
export const SHRINK_TOLERANCE = 0.78;
/** 避头标点:不许出现在行首。命中时把前一行末尾的最后一个单元一起带到下一行(只会让行变窄,不会溢出) */
export const NO_LINE_START = '，。、；：！？）》」』】,.;:!?)]}';

const unitWidth = (text, fontSize, boost) => {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === '　') em += FIT_COEFF.space;
    else if (ch >= '0' && ch <= '9') em += FIT_COEFF.digit * boost;
    else if (CJK_RE.test(ch)) em += FIT_COEFF.cjk;
    else em += FIT_COEFF.latin * boost;
  }
  return em * fontSize;
};

/** 切成折行单元:每个汉字一个,西文/数字连写一个,空格单独一个(行首行尾会被丢掉) */
const tokenize = (text, em) => {
  const units = [];
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

const buildUnits = (segment, emphasis, atomic) => {
  if (!emphasis) return tokenize(segment, true);
  const idx = segment.indexOf(emphasis);
  if (idx < 0) return tokenize(segment, false);
  return [
    ...tokenize(segment.slice(0, idx), false),
    ...(atomic ? [{text: emphasis, em: true, space: false}] : tokenize(emphasis, true)),
    ...tokenize(segment.slice(idx + emphasis.length), false),
  ];
};

const lineWidth = (line) => line.reduce((sum, u) => sum + u.w, 0);

/** 贪心折行到 target 宽度;\n 是硬断行。确定性:同输入永远同输出。 */
const greedyWrap = (unitsBySegment, sizes, target) => {
  const lines = [];
  for (const units of unitsBySegment) {
    let cur = [];
    let curW = 0;
    const dropTrailingSpace = () => {
      while (cur.length > 0 && cur[cur.length - 1].space) curW -= cur.pop().w;
    };
    for (const u of units) {
      const w = unitWidth(u.text, u.em ? sizes.em : sizes.base, sizes.boost);
      const unit = {...u, w};
      if (u.space) {
        if (cur.length === 0) continue;
        cur.push(unit);
        curW += w;
        continue;
      }
      if (cur.length > 0 && curW + w > target) {
        let carry = [];
        if (NO_LINE_START.includes(u.text)) {
          dropTrailingSpace();
          if (cur.length > 1) {
            const last = cur.pop();
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

const mergeRuns = (line) => {
  const runs = [];
  for (const u of line) {
    const last = runs[runs.length - 1];
    if (last && last.em === u.em) last.text += u.text;
    else runs.push({text: u.text, em: u.em});
  }
  return runs;
};

/**
 * 折行 + 主焦点排版。返回 null = 缩到下限仍排不下(调用方自己决定报错还是抛)。
 * spec: {fontSize(基准档), maxWidthPx, maxLines, shrinkFloorPx, emphasis?, emphasisRatio?}
 * 返回 {baseSize, emphasisSize, lines:[[{text,em}]], maxLineWidthPx, lineCount}
 */
export const layoutEmphasisText = (text, spec) => {
  const {
    fontSize,
    maxWidthPx: declaredWidth,
    maxLines = 1,
    shrinkFloorPx,
    emphasis,
    emphasisRanges,
    emphasisRatio = EMPHASIS_RATIO_DEFAULT,
  } = spec;
  const maxWidthPx = declaredWidth * WRAP_SAFETY;
  const source = String(text);
  if (!source.trim()) return {baseSize: fontSize, emphasisSize: Math.round(fontSize * emphasisRatio), lines: [], maxLineWidthPx: 0, lineCount: 0};
  const boost = hasCjk(source) ? FIT_COEFF.mixedLatinBoost : 1;
  // hero 不逐字出现在 line 里时按「无 hero」处理(整句同一字号),校验层会先把它拦下来
  const emph = emphasis && source.includes(emphasis) ? emphasis : undefined;
  const segments = source.split('\n');

  const attempt = (base, lineBudget) => {
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
    // 均衡:行数不变的前提下把最宽的一行压到最小(二分目标宽度),避免孤字尾行
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

  // 字号与行数谁让谁,取决于有没有 hero:
  // - 无 hero(整句一个字号,v1 的情形):优先少占行,允许缩到 SHRINK_TOLERANCE 再折行,
  //   于是「最慢的生产资料」照旧是缩字的一行,不会被折成「最慢的生 / 产资料」;
  // - 有 hero:主焦点的绝对大小就是这一镜的重点,先满字号折行,不够再缩。
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
  return null;
};

// video:视频素材槽(build/public/footage/ 下的本地文件;控制台装载时 ffprobe 自动填
// srcW/srcH/srcDur 之类 derivedFrom 槽)。2026-08-31 aspect-embed 首用
const SLOT_TYPES = new Set(['text', 'number', 'image', 'enum', 'list', 'video', 'ranges']);
const ENGINES = new Set(['remotion', 'hyperframes', 'hybrid']);
const SIGNAL_NAMES = [
  'framePrecision', 'dataBinding', 'continuity', 'captions', 'audioSync',
  'webUi', 'shader3d', 'kineticType', 'registryFit', 'remotionRisk', 'hyperframesRisk',
];

/** preset.json 的结构校验(手写检查,风格与 visual-contract.mjs 一致,不引依赖) */
export const validatePresetDef = (def) => {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!def || typeof def !== 'object' || Array.isArray(def)) return {ok: false, errors: ['preset must be an object']};
  req(Number.isInteger(def.version) && def.version >= 1, 'version must be a positive integer');
  req(typeof def.id === 'string' && def.id.trim() !== '', 'id is required');
  req(typeof def.name === 'string' && def.name.trim() !== '', 'name is required');
  req(ENGINES.has(def.engine), 'engine must be remotion, hyperframes, or hybrid');
  req(typeof def.compositionId === 'string' && def.compositionId.trim() !== '', 'compositionId is required');
  req(['draft', 'verified'].includes(def.status), 'status must be draft or verified');
  req(Number.isInteger(def.baselineVersion) && def.baselineVersion >= 1, 'baselineVersion must be a positive integer');
  const d = def.duration ?? {};
  req(d.min > 0 && d.max >= d.min && d.default >= d.min && d.default <= d.max,
    'duration.min/max/default must satisfy 0 < min <= default <= max');
  req(Array.isArray(def.tags) && def.tags.length > 0 && def.tags.every((t) => typeof t === 'string' && t.trim() !== ''),
    'tags must be a non-empty array of non-blank strings');
  const signals = def.signals ?? {};
  for (const name of SIGNAL_NAMES) {
    req(Number.isInteger(signals[name]) && signals[name] >= 0 && signals[name] <= 2, `signals.${name} must be 0/1/2`);
  }
  req(def.slots && typeof def.slots === 'object' && !Array.isArray(def.slots) && Object.keys(def.slots).length > 0,
    'slots must be a non-empty object');
  for (const [key, slot] of Object.entries(def.slots ?? {})) {
    const p = `slots.${key}`;
    if (!slot || typeof slot !== 'object') { errors.push(`${p} must be an object`); continue; }
    req(SLOT_TYPES.has(slot.type), `${p}.type must be one of ${[...SLOT_TYPES].join('/')}`);
    if ((slot.type === 'text' || slot.type === 'list') && !slot.measuredIn) {
      const fit = slot.fit ?? {};
      req(fit.maxWidthPx > 0 && fit.shrinkFloorPx > 0 && fit.shrinkFloorPx <= (slot.fontSize ?? Infinity),
        `${p}.fit.maxWidthPx/shrinkFloorPx are required (shrinkFloorPx <= fontSize)`);
      req(slot.fontSize > 0, `${p}.fontSize is required`);
    }
    // measuredIn:本槽的宽度由承载槽统一估算(如 recede 的 hero 是 line 的子串),不单独设 fit
    if (slot.measuredIn) {
      req(typeof slot.measuredIn === 'string' && Boolean((def.slots ?? {})[slot.measuredIn]),
        `${p}.measuredIn must name an existing slot`);
    }
    if (slot.emphasisSlot !== undefined) {
      req(Boolean((def.slots ?? {})[slot.emphasisSlot]), `${p}.emphasisSlot must name an existing slot`);
      req(slot.wrap === true, `${p}.emphasisSlot requires wrap: true`);
      req(slot.emphasisRatio === undefined || slot.emphasisRatio > 1,
        `${p}.emphasisRatio must be > 1`);
    }
    if (slot.type === 'enum') {
      req(Array.isArray(slot.values) && slot.values.length > 0, `${p}.values is required for enum`);
    }
  }
  for (const [key, v] of Object.entries(def.variants ?? {})) {
    req(v && v.type === 'enum' && Array.isArray(v.values) && v.values.length > 0 && v.values.includes(v.default),
      `variants.${key} must be an enum with values containing default`);
  }
  req(def.anchors && typeof def.anchors.start === 'string' && typeof def.anchors.end === 'string',
    'anchors.start/end are required');
  req(typeof def.objectiveTemplate === 'string' && def.objectiveTemplate.trim() !== '', 'objectiveTemplate is required');
  return {ok: errors.length === 0, errors};
};

export const loadPreset = async (rootDir, id) => {
  const path = join(rootDir, 'docs', 'presets', id, 'preset.json');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`preset「${id}」不存在(${path})——查 docs/presets/MENU.md 或目录名拼写`);
  }
  const def = JSON.parse(raw);
  const result = validatePresetDef(def);
  if (!result.ok) throw new Error(`preset「${id}」定义不合法:\n${result.errors.join('\n')}`);
  return def;
};

// 模板插值:`{key}` 直接替换(未知 key 原样留着,当拼写错误的信号);
// `{key?…}` 是可选段——key 有值才输出整段,否则整段消失。可选槽(如 recede 的 hero)
// 没传时不能在 objective 里留下「{hero}」或「」这种空壳,那会被下游当成真的画面要求。
const interpolate = (template, values) => {
  const filled = template.replace(
    /\{(\w+)\?((?:[^{}]|\{\w+\})*)\}/g,
    (m, key, body) => (values[key] === undefined || values[key] === '' ? '' : body),
  );
  return filled.replace(/\{(\w+)\}/g, (m, key) => (values[key] === undefined ? m : String(values[key])));
};

/** 单条文字的估宽门。返回 {ok, fontSize, error} */
const fitText = (text, slot, slotName) => {
  const {fontSize, maxLines = 1, fit} = slot;
  const budget = fit.maxWidthPx * 0.92; // 8% 保险余量:估算是近似
  const lines = String(text).split('\n');
  if (lines.length > maxLines) {
    return {ok: false, error: `槽「${slotName}」最多 ${maxLines} 行,收到 ${lines.length} 行`};
  }
  let used = fontSize;
  for (const line of lines) {
    const wDeclared = estimateTextWidth(line, fontSize);
    if (wDeclared <= budget) continue;
    const wFloor = estimateTextWidth(line, fit.shrinkFloorPx);
    if (wFloor <= budget) {
      used = Math.min(used, Math.floor((fontSize * budget) / wDeclared));
      continue;
    }
    const maxChars = Math.max(1, Math.floor(budget / fit.shrinkFloorPx));
    return {
      ok: false,
      error:
        `槽「${slotName}」文字「${line}」太长:最小字号 ${fit.shrinkFloorPx}px 下仍超宽 ` +
        `(估 ${Math.round(wFloor)}px > ${Math.round(budget)}px)。该槽最多约 ${maxChars} 个中文字,请缩短文案`,
    };
  }
  return {ok: true, fontSize: used};
};

/**
 * wrap 槽的估宽门:先折行,行数超上限才缩字;缩到下限仍排不下 → 硬失败。
 * 与渲染期 layoutEmphasisText 同一套算法,展开期只多留 8% 保险余量(失败朝"更严"偏)。
 */
const fitWrapped = (text, slot, slotName, allSlots) => {
  const {fontSize, maxLines = 1, fit, emphasisSlot, emphasisRatio} = slot;
  const budget = fit.maxWidthPx * WRAP_SAFETY; // 只用于报错文案;真实收窄在 layoutEmphasisText 内
  const emphasis = allSlots.emphasisRanges === undefined && emphasisSlot ? allSlots[emphasisSlot] : undefined;
  if (emphasis !== undefined && emphasis !== null && emphasis !== '') {
    if (typeof emphasis !== 'string') {
      return {ok: false, error: `槽「${emphasisSlot}」必须是字符串`};
    }
    if (!String(text).includes(emphasis)) {
      return {
        ok: false,
        error: `槽「${emphasisSlot}」的「${emphasis}」必须逐字出现在槽「${slotName}」的「${text}」里(它是要放大的那一段子串)`,
      };
    }
  }
  const layout = layoutEmphasisText(text, {
    fontSize,
    maxWidthPx: fit.maxWidthPx,
    maxLines,
    shrinkFloorPx: fit.shrinkFloorPx,
    ...(emphasis ? {emphasis} : {}),
    ...(emphasisRatio ? {emphasisRatio} : {}),
    ...(slot.emphasisSlot && (allSlots.emphasisRanges !== undefined || allSlots.fontSize !== undefined || allSlots.emphasisRatio !== undefined) ? {
      emphasisRanges: allSlots.emphasisRanges,
      fontSize: allSlots.fontSize ?? fontSize,
      shrinkFloorPx: Math.min(fit.shrinkFloorPx, allSlots.fontSize ?? fontSize),
      emphasisRatio: allSlots.emphasisRatio ?? emphasisRatio ?? EMPHASIS_RATIO_DEFAULT,
    } : {}),
  });
  if (!layout) {
    const ratio = emphasis ? 1 : (emphasisRatio ?? EMPHASIS_RATIO_DEFAULT);
    const perLine = Math.max(1, Math.floor(budget / (fit.shrinkFloorPx * ratio)));
    return {
      ok: false,
      error:
        `槽「${slotName}」文字「${String(text).replace(/\n/g, '⏎')}」排不下:` +
        `最小字号 ${fit.shrinkFloorPx}px、最多 ${maxLines} 行仍装不下。` +
        `该槽最多约 ${perLine * maxLines} 个中文字,请缩短文案`,
    };
  }
  return {ok: true, fontSize: layout.baseSize, layout};
};

/**
 * 校验 presetProps 并归一化。ctx.projectDir 用于 image 槽的文件存在性检查。
 * 返回 {ok, errors, normalized:{durationSeconds, variant, slots}, notes[]}
 */
export const validateProps = async (def, presetProps = {}, ctx = {}) => {
  const errors = [];
  const notes = [];
  const normalized = {durationSeconds: def.duration.default, variant: {}, slots: {}};

  const dur = presetProps.durationSeconds ?? def.duration.default;
  if (typeof dur !== 'number' || !(dur > 0)) errors.push('durationSeconds must be a positive number');
  else if (dur < def.duration.min || dur > def.duration.max) {
    errors.push(`durationSeconds ${dur} 超出 preset「${def.id}」允许区间 [${def.duration.min}, ${def.duration.max}]`);
  } else normalized.durationSeconds = dur;

  for (const [key, v] of Object.entries(def.variants ?? {})) {
    const got = presetProps.variant?.[key] ?? v.default;
    if (!v.values.includes(got)) errors.push(`variant.${key} 必须是 ${JSON.stringify(v.values)} 之一,收到 ${JSON.stringify(got)}`);
    else normalized.variant[key] = got;
  }
  for (const key of Object.keys(presetProps.variant ?? {})) {
    if (!(def.variants ?? {})[key]) errors.push(`variant.${key} 不是 preset「${def.id}」的档位`);
  }

  const slots = presetProps.slots ?? {};
  for (const [key, slot] of Object.entries(def.slots)) {
    const value = slots[key];
    const required = slot.required !== false;
    if (value === undefined || value === null || value === '') {
      if (required) errors.push(`缺少必填槽「${key}」`);
      continue;
    }
    switch (slot.type) {
      case 'text': {
        if (typeof value !== 'string') { errors.push(`槽「${key}」必须是字符串`); break; }
        if (slot.measuredIn) { normalized.slots[key] = value; break; } // 宽度由承载槽一起算
        const fitr = slot.wrap ? fitWrapped(value, slot, key, slots) : fitText(value, slot, key);
        if (!fitr.ok) errors.push(fitr.error);
        else {
          if (fitr.fontSize < slot.fontSize) notes.push(`槽「${key}」将以 ${fitr.fontSize}px 渲染(声明 ${slot.fontSize}px,缩字装下)`);
          if (fitr.layout) {
            notes.push(
              `槽「${key}」排成 ${fitr.layout.lineCount} 行:${fitr.layout.lines.map((l) => l.map((r) => r.text).join('')).join(' / ')}`,
            );
          }
          normalized.slots[key] = value;
        }
        break;
      }
      case 'ranges': {
        if (!Array.isArray(value) || value.length > 1000 || value.some(r => !Number.isInteger(r?.start) || !Number.isInteger(r?.end) || r.start < 0 || r.end <= r.start || r.end > String(slots.line ?? '').length)) errors.push(`槽「${key}」必须是有效文字位置区间`);
        else normalized.slots[key] = normalizeRanges(String(slots.line ?? ''), value);
        break;
      }
      case 'number': {
        const n = typeof value === 'number' ? value : Number(String(value).replace(/[,$\s]/g, ''));
        if (!Number.isFinite(n)) errors.push(`槽「${key}」必须能解析为数字,收到 ${JSON.stringify(value)}`);
        else if ((slot.min !== undefined && n < slot.min) || (slot.max !== undefined && n > slot.max)) errors.push(`槽「${key}」超出允许范围`);
        else normalized.slots[key] = value;
        break;
      }
      case 'enum': {
        if (!slot.values.includes(value)) errors.push(`槽「${key}」必须是 ${JSON.stringify(slot.values)} 之一`);
        else normalized.slots[key] = value;
        break;
      }
      case 'image': {
        if (typeof value !== 'string') { errors.push(`槽「${key}」必须是素材路径`); break; }
        const abs = value.startsWith('/') ? value : join(ctx.projectDir ?? '.', value);
        try {
          await access(abs);
          normalized.slots[key] = abs;
        } catch {
          errors.push(`槽「${key}」的素材不存在:${abs}(素材必须先落进批次 assets/)`);
        }
        break;
      }
      case 'list': {
        if (!Array.isArray(value)) { errors.push(`槽「${key}」必须是数组`); break; }
        const min = slot.minItems ?? 1;
        const max = slot.maxItems ?? Infinity;
        if (value.length < min || value.length > max) {
          errors.push(`槽「${key}」需要 ${min}–${max === Infinity ? '∞' : max} 项,收到 ${value.length}`);
          break;
        }
        let ok = true;
        value.forEach((item, i) => {
          // splitOn:一条 item 里用分隔符带了第二段(bullet-run 的「主句 | 小注」)。
          // 组件把两段渲成两行、第二行只有 noteRatio 倍字号,所以**必须分开量**——
          // 整串按主句字号量会把本来排得下的文案判成超宽(初版就是这么误报的)。
          const segs = slot.splitOn ? String(item).split(slot.splitOn) : [String(item)];
          const noteSize = Math.round(slot.fontSize * (slot.noteRatio ?? 0.46));
          // 小注在组件里是**会折行的**(普通 div,不是 nowrap),而主句是单行 shrink-to-fit。
          // 拿单行预算去量一段会折行的话,任何超过一行的说明句都会被误判成"太长"。
          // 这里按 noteMaxLines 放大预算近似折行——偏严的方向(真实折行还能多塞一点),
          // 所以不会放过真正排不下的文案。
          const noteLines = slot.noteMaxLines ?? 2;
          // 缩字下限也要跟着降:留着主句的 34px 下限去量一个 33px 的小注,
          // 等于宣布"下限比声明字号还大",fitText 会算出反向的缩放
          const noteSlot = {
            ...slot,
            fontSize: noteSize,
            fit: {
              maxWidthPx: slot.fit.maxWidthPx * noteLines,
              shrinkFloorPx: Math.min(slot.fit.shrinkFloorPx, noteSize),
            },
          };
          segs.forEach((seg, si) => {
            const text = seg.trim();
            if (text === '') return;
            const fitr = fitText(text, si === 0 ? slot : noteSlot, `${key}[${i}]${si === 0 ? '' : '·小注'}`);
            if (!fitr.ok) { errors.push(fitr.error); ok = false; }
          });
        });
        if (ok) normalized.slots[key] = value;
        break;
      }
      default:
        errors.push(`槽「${key}」类型未知:${slot.type}`);
    }
  }
  for (const key of Object.keys(slots)) {
    if (!def.slots[key]) errors.push(`槽「${key}」不是 preset「${def.id}」的槽位(slot mismatch——这镜可能不该走 preset,降级为 custom)`);
  }

  return {ok: errors.length === 0, errors, notes, normalized};
};

/**
 * 展开一镜:回填合同字段 + 生成 props / signals。image 槽会被拷进 build/public/assets/
 * 并把 props 里的路径改写为 staticFile 相对路径(渲染期零网络)。
 */
export const expandShot = async (def, shot, {projectDir}) => {
  const {ok, errors, notes, normalized} = await validateProps(def, shot.presetProps, {projectDir});
  if (!ok) return {ok, errors, notes};

  const slotsForRender = {...normalized.slots};
  for (const [key, slot] of Object.entries(def.slots)) {
    if (slot.type !== 'image' || slotsForRender[key] === undefined) continue;
    const src = slotsForRender[key];
    const destDir = join(projectDir, 'build', 'public', 'assets');
    await mkdir(destDir, {recursive: true});
    const dest = join(destDir, basename(src));
    await copyFile(src, dest);
    slotsForRender[key] = `assets/${basename(src)}`;
  }

  const vars = {...normalized.slots, ...normalized.variant, durationSeconds: normalized.durationSeconds};
  const contractPatch = {
    engine: def.engine,
    tags: def.tags,
    durationSeconds: normalized.durationSeconds,
    objective: interpolate(def.objectiveTemplate, vars),
    startAnchor: interpolate(def.anchors.start, vars),
    endAnchor: interpolate(def.anchors.end, vars),
  };
  const props = {
    presetId: def.id,
    presetVersion: def.version,
    compositionId: def.compositionId,
    durationSeconds: normalized.durationSeconds,
    variant: normalized.variant,
    slots: slotsForRender,
  };
  return {ok: true, errors: [], notes, contractPatch, props, signals: def.signals};
};

/** 供菜单生成与快车道判定使用 */
export const isFastlaneEligible = (def) =>
  def.status === 'verified' &&
  Object.values(def.slots).every((s) => s.type !== 'image');
