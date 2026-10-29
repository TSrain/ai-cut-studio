// 字幕版式常数的**唯一出口**。
//
// 这些数字来自 workspace/learn/dy-7543853957756489003 的逐帧像素测量,真身在
// `projects/2026-08-17-caption-layer/build/src/caption/spec.ts`(渲染器直接 import 它)。
// 问题是另外两个地方也要用同一批数字:linter 要估行宽、控制台的浏览器预览要画字。
// 抄一份过去就等于埋一个静默漂移——改了 spec.ts 而没同步,linter 会放过实际超宽的行,
// 预览会和成片长得不一样,而且**两种错都不报错**。
//
// 所以这里不抄,直接把 spec.ts 转译出来读。spec.ts 没有任何 import(只有常量和一个正则),
// 所以可以整份丢给 esbuild 剥掉类型,再当 data: URL 动态 import ——不落临时文件。
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {ROOT, TPL} from './panel-scan.mjs';

/** 字幕渲染器工程。所有字幕项目共用这一个引擎,脚本跟着内容项目走 */
export const CAPTION_ENGINE = join(ROOT, 'projects/2026-08-17-caption-layer/build');
const SPEC_TS = join(CAPTION_ENGINE, 'src/caption/spec.ts');
/** 预览用的**完整**字体:子集只含已出片的字,预览里刚打的新字会变方框 */
export const FULL_FONT_REL = 'projects/2026-08-17-caption-layer/build/public/fonts/NotoSerifSC-Bold.otf';

let cached = null;

/** 读出 spec.ts 的全部常数(带缓存)。返回值可直接 JSON 化发给浏览器 */
export async function captionSpec() {
  if (cached) return cached;
  const require = createRequire(join(TPL, 'package.json'));
  const {transformSync} = require('esbuild');
  const {code} = transformSync(readFileSync(SPEC_TS, 'utf8'), {loader: 'ts', format: 'esm', target: 'es2022'});
  const m = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  cached = {
    LAYOUT: m.LAYOUT_PORTRAIT,
    LAYOUT_LANDSCAPE: m.LAYOUT_LANDSCAPE,
    INK: m.INK,
    INK_RATIO_CJK: m.INK_RATIO_CJK,
    INK_RATIO_LATIN: m.INK_RATIO_LATIN,
    BASELINE_SHIFT: m.BASELINE_SHIFT,
    CENTER: m.CENTER,
    COLOR: m.COLOR,
    SHADOW_OFFSET: m.SHADOW_OFFSET,
    ENTER: m.ENTER,
    EXIT: m.EXIT,
    fontFamily: m.fontFamily,
    canvas: {width: 1080, height: 1920, fps: 30},
    roles: Object.keys(m.INK),
    enters: Object.keys(m.ENTER),
  };
  return cached;
}

/** 让转译结果失效(改了 spec.ts 之后不用重启服务) */
export const forgetCaptionSpec = () => (cached = null);

// ─────────────────────────── 校验(linter 与控制台共用) ───────────────────────────

const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ]/;
const isCJK = (ch) => CJK_RE.test(ch);

/**
 * 估算一行的显示宽度(占画幅宽的比例)。
 *
 * 系数来自思源宋体 Bold 的真实 advance width(fontTools 量的,2026-08-19):
 * 汉字/全角标点 1.0,拉丁与数字**平均 0.608**(不是原来写的 0.55),空格 **0.25**(不是 0.35)。
 *
 * ⚠️ 字号必须按**这一行的字形**选墨高比值,和 spec.ts 的 inkRatioForText 一致。
 *    原来这里恒用 INK_RATIO_CJK,于是纯拉丁行(「DeepSeek Harness」这种)的字号被算小 22%,
 *    叠上拉丁系数偏低的 10%,合计低估 35%——实测那一行渲出来 79% 宽,这里只报 58%,
 *    linter 因此**放过了会冲出安全区的行**,而且不报错。两处一起改才算修好。
 */
export function estWidth(spec, text, role, view = PORTRAIT_VIEW) {
  const inkRatio = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/.test(text)
    ? spec.INK_RATIO_CJK
    : spec.INK_RATIO_LATIN;
  const em = ((spec.INK[role] ?? spec.INK.narration) * view.inkScale) / inkRatio / view.ratio;
  let units = 0;
  for (const ch of text) units += isCJK(ch) ? 1 : ch === ' ' ? 0.25 : 0.608;
  return units * em;
}

/**
 * 一份脚本的"画幅视角":宽高比 + 该比例下的版式常数。
 *
 * 脚本顶层不写 `canvas` 就是竖屏 1080×1920 —— 历史脚本全靠这个默认值,不能改。
 * 写了 `{"canvas":{"width":1920,"height":1080}}` 就切到横屏那套(字号整体放大、
 * 单行更窄、底边更低),和渲染器 `layoutFor()` 用的是同一份 spec.ts,不会漂。
 */
export function viewOf(spec, script) {
  const width = script?.canvas?.width ?? 1080;
  const height = script?.canvas?.height ?? 1920;
  const layout = width > height ? spec.LAYOUT_LANDSCAPE : spec.LAYOUT;
  return {width, height, ratio: width / height, layout, inkScale: layout.inkScale ?? 1};
}

const PORTRAIT_VIEW = {width: 1080, height: 1920, ratio: 1080 / 1920, inkScale: 1};

export const MAX_LINE_WIDTH = 0.78;
export const MAX_LINES_PER_BLOCK = 3;

/**
 * 安全区:任何一行的墨迹左右边界都必须落在这之间(占画幅宽)。
 * 实测原片 x 最小 10.8% / 最大 88.5%,这里取整到 10%–90%。
 */
export const SAFE_L = 0.10;
export const SAFE_R = 0.90;
/**
 * **整块**(一块里所有行的并集包围盒)的中心允许偏离画幅中心的最大值。
 *
 * 为什么需要这一条:逐行检查全过、整块照样偏。上下行做对角错位时两行宽度常常差一大截
 * (「应用能力」27% vs「足够大的终端分发」55%),各自绕 0.5±0.085 摆,并集就落到 28%–86%,
 * 左留白是右留白的两倍——肉眼读出来就是"字幕整体偏右"。2026-08-19 用户连着两版指出这个,
 * 第一版是逐行越界,第二版逐行全合规、块仍偏 4–7%。**逐行合规不蕴含整块居中,必须分开查。**
 *
 * 排版侧的做法:先按目标错位量摆,再整体平移让并集居中,越界就按比例收窄错位量。
 */
export const MAX_BLOCK_OFFCENTER = 0.03;

/**
 * 一块里的多行**不许全部站在中线同一侧**。
 *
 * 用户的原话:「不要两行都没道理的在右边,导致视觉上不好看」。
 * 注意这和 MAX_BLOCK_OFFCENTER 不是同一件事:并集可以正对 0.5,两行却仍然一起偏右
 * (上行窄、下行宽时,把并集拉回中心的平移会把两行一起推过中线)。
 * 正确的形状是**一左一右各站一边**:上行中心 ≤ 0.5 ≤ 下行中心。
 * 全部精确居中(所有行 = 0.5)也放行 —— 那是"不错开",不是"同侧堆"。
 */
export const MIN_STRADDLE = 0.004;

/**
 * 机械校验。**errs 是硬性错误(不许渲),warns 是提醒。**
 * 每一条都带 bi/li 定位,控制台据此把红框画在出问题的那一行上——
 * 一张错误清单要人自己回去找是哪一行,等于把成本又推回给人。
 */
export function lintScript(spec, s, audioDuration) {
  const errs = [];
  const warns = [];
  // 竖屏 / 横屏两套判据:单行宽上限、安全区都跟着画幅比例走。
  // 安全区比 sideMargin 松 1 个百分点 —— 竖屏历来是 10% 对 11%,横屏照同一条关系推。
  const view = viewOf(spec, s);
  const MAXW = view.layout.maxLineWidth;
  const SL = +(view.layout.sideMargin - 0.01).toFixed(3);
  const SR = +(1 - SL).toFixed(3);
  const push = (arr, bi, li, msg) => arr.push({bi, li, msg});

  if (!Array.isArray(s?.blocks) || !s.blocks.length) {
    push(errs, -1, -1, 'blocks 为空');
    return {errs, warns, stats: null};
  }

  let prevOut = -Infinity;
  let maxOut = 0;
  s.blocks.forEach((b, bi) => {
    const at = `块#${bi + 1} @${Number(b.in).toFixed(2)}s`;
    if (typeof b.in !== 'number' || typeof b.out !== 'number') return push(errs, bi, -1, `${at} in/out 不是数字`);
    if (b.out <= b.in) push(errs, bi, -1, `${at} 结束时间 ≤ 开始时间`);
    if (b.in < prevOut - 0.001) push(errs, bi, -1, `${at} 和上一块时间重叠(上一块到 ${prevOut.toFixed(2)}s)`);
    prevOut = b.out;
    maxOut = Math.max(maxOut, b.out);

    if (!Array.isArray(b.lines) || !b.lines.length) return push(errs, bi, -1, `${at} 一行都没有`);
    if (b.lines.length > MAX_LINES_PER_BLOCK)
      push(errs, bi, -1, `${at} ${b.lines.length} 行 —— 实测原片最多 ${MAX_LINES_PER_BLOCK} 行`);

    b.lines.forEach((l, li) => {
      if (!spec.INK[l.role]) push(errs, bi, li, `未知档位「${l.role}」`);
      if (typeof l.in !== 'number') return push(errs, bi, li, '缺出现时刻');
      if (l.in < b.in - 0.001) push(errs, bi, li, `出现时刻 ${l.in.toFixed(2)}s 早于块开始 ${b.in.toFixed(2)}s`);
      if (l.in > b.out + 0.001) push(errs, bi, li, `出现时刻 ${l.in.toFixed(2)}s 晚于块结束 ${b.out.toFixed(2)}s`);
      const text = (l.runs ?? []).map((r) => r.t).join('');
      if (!text) return push(errs, bi, li, '这一行没有字');
      const w = estWidth(spec, text, l.role, view);
      if (w > MAXW)
        push(errs, bi, li, `估算宽 ${(w * 100) | 0}% > ${MAXW * 100}% —— 该拆句,不是缩字号`);
      else if (w > MAXW - 0.06) push(warns, bi, li, `宽 ${(w * 100) | 0}%,接近上限`);
      (l.runs ?? []).forEach((r, k) => {
        if (r.in !== undefined && (r.in < b.in - 0.001 || r.in > b.out + 0.001))
          push(errs, bi, li, `第 ${k + 1} 段的出现时刻不在本块区间内`);
      });
    });

    // ── 安全区 + 整块居中 ──(逐行合规不蕴含整块居中,见 MAX_BLOCK_OFFCENTER 的注释)
    let uLo = 1, uHi = 0;
    b.lines.forEach((l, li) => {
      const text = (l.runs ?? []).map((r) => r.t).join('');
      if (!text) return;
      const w = estWidth(spec, text, l.role, view);
      const c = l.center ?? spec.CENTER[l.role] ?? 0.5;
      const lo = c - w / 2, hi = c + w / 2;
      uLo = Math.min(uLo, lo); uHi = Math.max(uHi, hi);
      if (lo < SL - 0.005 || hi > SR + 0.005)
        push(errs, bi, li, `墨迹 ${(lo * 100) | 0}%–${(hi * 100) | 0}% 越出安全区 ${SL * 100}%–${SR * 100}%`);
    });
    // 多行块:不许全部站在中线同一侧
    if (b.lines.length > 1) {
      const cs = b.lines
        .filter((l) => (l.runs ?? []).some((r) => r.t))
        .map((l) => l.center ?? spec.CENTER[l.role] ?? 0.5);
      const allRight = cs.every((c) => c > 0.5 + MIN_STRADDLE);
      const allLeft = cs.every((c) => c < 0.5 - MIN_STRADDLE);
      if (allRight || allLeft)
        push(errs, bi, -1, `${at} ${cs.length} 行全部偏${allRight ? '右' : '左'}`
          + `(中心 ${cs.map((c) => (c * 100).toFixed(0) + '%').join(' / ')}) —— 应一左一右各站一边`);
    }

    if (uHi > uLo) {
      const off = (uLo + uHi) / 2 - 0.5;
      if (Math.abs(off) > MAX_BLOCK_OFFCENTER)
        push(errs, bi, -1, `${at} 整块偏${off > 0 ? '右' : '左'} ${(Math.abs(off) * 100).toFixed(1)}% `
          + `(并集 ${(uLo * 100).toFixed(1)}%–${(uHi * 100).toFixed(1)}%,上限 ±${MAX_BLOCK_OFFCENTER * 100}%)`);
    }

    /**
     * ⚠️ 这里曾经有一条「每一行都该居中(0.50)」的提醒,是 2026-08-19 我**理解错**用户意见加的。
     *
     * 用户当时说的是"还是有很多无缘无故的右偏",我据此把对角错位整个取消、全部居中,
     * 他的更正是:「不是每一行都居中,你理解错了,而是不要两行都没道理的在右边」。
     * **错开本身是好看的,要挡的是"两行一起堆到同一侧"** —— 那条规则在上面的
     * MIN_STRADDLE(一左一右各站一边)+ MAX_BLOCK_OFFCENTER(整块并集正对 0.5),两条一起才够。
     * 别再加"必须居中"的检查,那是把用户的意见听窄了。
     */

    // 这里原来有一条「标签+术语两行中心没差够 0.08 就警告」,依据是参考片的 0.41/0.56。
    // 2026-08-19 删掉:用户连着两版判定对角错位读起来就是"整体偏右",项目已改成每行都居中。
    // 留着它等于在劝人把刚修好的问题改回去 —— 过期的规则比没有规则更贵。
    // 真正要守的是上面那条 MAX_BLOCK_OFFCENTER(整块并集必须居中),它对错位与否都成立。
  });

  if (audioDuration) {
    const gap = audioDuration - maxOut;
    if (gap > 2.0) push(errs, s.blocks.length - 1, -1, `时间轴只到 ${maxOut.toFixed(1)}s,音频 ${audioDuration.toFixed(1)}s —— 结尾漏了 ${gap.toFixed(1)} 秒`);
    else if (gap > 0.6) push(warns, s.blocks.length - 1, -1, `结尾距音频末端还差 ${gap.toFixed(1)} 秒`);
    if (gap < -0.5) push(warns, s.blocks.length - 1, -1, `时间轴超出音频 ${(-gap).toFixed(1)} 秒`);
  }

  const lines = s.blocks.flatMap((b) => b.lines ?? []);
  const amber = lines.filter((l) => (l.runs ?? []).some((r) => r.c === 'amber')).length;
  const covered = s.blocks.reduce((a, b) => a + (b.out - b.in), 0);
  const byRole = {};
  const byEnter = {};
  for (const l of lines) {
    byRole[l.role] = (byRole[l.role] ?? 0) + 1;
    byEnter[l.enter ?? 'cut'] = (byEnter[l.enter ?? 'cut'] ?? 0) + 1;
  }
  return {
    errs,
    warns,
    stats: {
      blocks: s.blocks.length,
      lines: lines.length,
      end: maxOut,
      avgBlock: covered / s.blocks.length,
      amberPct: lines.length ? (amber / lines.length) * 100 : 0,
      byRole,
      byEnter,
    },
  };
}
