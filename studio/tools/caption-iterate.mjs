#!/usr/bin/env node
/**
 * 字幕层的**快速迭代**回合 —— 改完脚本跑这一条,不要碰 4K。
 *
 *   node tools/caption-iterate.mjs <项目名> [--scale 0.5] [--cols 5]
 *
 * 一轮做四件事:
 *   ① 机械校验(和控制台/linter 同一份判据)
 *   ② 低分辨率整片渲染一次(h264,无 alpha,只用来量和看)
 *   ③ 逐块抽帧、逐行量真实像素 —— 安全区 / 整块偏心 / 两行同侧
 *   ④ 拼一张**全片接触印张**(每块一格,只裁字幕带,画中线)给用户过目
 *
 * 为什么必须是这条而不是渲 4K:2026-08-19 那次做字幕层,6 次 4K 渲染里 5 次是版式返工,
 * 光渲染就烧掉 84 分钟。这条整片跑一次约 4 分钟,能验出当时全部问题。
 * 另外**不要用 `npx remotion still` 逐帧抽**:实测单张 49 秒,其中约 45 秒是重新打包工程;
 * 从这里的 sweep.mp4 里 ffmpeg 抽 30 帧只要几秒。
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {captionSpec, lintScript, viewOf, CAPTION_ENGINE} from './lib/caption-spec.mjs';
import {ROOT} from './lib/panel-scan.mjs';

const args = process.argv.slice(2);
const name = args[0];
if (!name) { console.error('用法: node tools/caption-iterate.mjs <项目名> [--scale 0.5] [--cols 5]'); process.exit(2); }
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SCALE = Number(argOf('--scale', 0.5));

const dir = join(ROOT, 'projects', name);
const script = join(dir, 'caption-script.json');
if (!existsSync(script)) { console.error(`没找到 ${script}`); process.exit(2); }
const review = join(dir, 'review');
mkdirSync(review, {recursive: true});

const s = JSON.parse(readFileSync(script, 'utf8'));
const spec = await captionSpec();

/* ── ① 机械校验 ── */
const {errs, warns, stats} = lintScript(spec, s, null);
console.log(`${stats.blocks} 块 / ${stats.lines} 行 / 到 ${stats.end.toFixed(1)}s · 琥珀 ${stats.amberPct.toFixed(0)}%`);
if (errs.length) {
  console.log(`\n❌ 校验不过,先改脚本(${errs.length} 条):`);
  errs.slice(0, 12).forEach((e) => console.log('   ' + (e.bi < 0 ? '' : `块${e.bi + 1}${e.li >= 0 ? `行${e.li + 1}` : ''} `) + e.msg));
  process.exit(1);
}
if (warns.length) console.log(`⚠️ ${warns.length} 条提醒(不阻塞)`);

/* ── ② 低分辨率整片渲染 ── */
const sweep = join(review, 'sweep.mp4');
console.log(`\n渲低分辨率整片(scale=${SCALE})…`);
const t0 = Date.now();
const r = spawnSync(process.execPath, [join(ROOT,'tools/remotion-export-cached.mjs'),'--cwd',CAPTION_ENGINE,'--','remotion', 'render', 'CaptionFromProps', `--props=${script}`,
  '--codec=h264', `--scale=${SCALE}`, '--concurrency=6', '--timeout=120000', sweep],
  {cwd: CAPTION_ENGINE, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8'});
if (r.status !== 0) { console.error('渲染失败:\n' + (r.stderr || '').slice(-1200)); process.exit(1); }
// 画幅从脚本读(不写 canvas 就是竖屏 1080×1920)。横屏的接触印张换成 3 列、每格更宽,
// 否则 16:9 的字幕带缩到 360px 宽只剩 50 来像素高,等于没得看。
const view = viewOf(spec, s);
const W = Math.round(view.width * SCALE), H = Math.round(view.height * SCALE);
const LAND = view.width > view.height;
const COLS = Number(argOf('--cols', LAND ? 3 : 5));
const CELL_W = LAND ? 560 : 360;
// 安全区跟着版式走(竖屏 10%/90%、横屏 7%/93%),量像素和画参考线共用这一对
const SL = view.layout.sideMargin - 0.01, SR = 1 - SL;
console.log(`  ${W}×${H} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

/* ── ③ 逐块抽帧量像素 ── */
const bandOf = (px) => {                     // 灰度阈值取墨,返回每一"行"的 [左,右]
  const bands = []; let cur = null;
  for (let y = 0; y < H; y++) {
    let n = 0, lo = W, hi = -1;
    for (let x = 0; x < W; x++) if (px[y * W + x] > 90) { n++; if (x < lo) lo = x; if (x > hi) hi = x; }
    if (n > 2) { cur ??= {y0: y, lo: W, hi: -1}; cur.lo = Math.min(cur.lo, lo); cur.hi = Math.max(cur.hi, hi); cur.y1 = y; }
    else if (cur) { if (cur.y1 - cur.y0 > 4) bands.push(cur); cur = null; }
  }
  if (cur && cur.y1 - cur.y0 > 4) bands.push(cur);
  return bands;
};
const grab = (t) => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', sweep,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {maxBuffer: 1 << 28});
  return bandOf(raw);
};
const shots = s.blocks.map((b) => Math.min(b.out - 0.12, Math.max(...b.lines.map((l) => l.in)) + 0.45));
const bad = {safe: [], off: [], same: [], count: []};
shots.forEach((t, bi) => {
  const bands = grab(t);
  const b = s.blocks[bi];
  const txt = b.lines.map((l) => l.runs.map((x) => x.t).join('')).join(' / ');
  if (bands.length !== b.lines.length) { bad.count.push(`块${bi + 1} 抽到 ${bands.length} 行,脚本 ${b.lines.length} 行  ${txt}`); return; }
  const ls = bands.map((x) => x.lo / W), rs = bands.map((x) => (x.hi + 1) / W);
  const cs = bands.map((x, i) => (ls[i] + rs[i]) / 2);
  const lo = Math.min(...ls), hi = Math.max(...rs);
  const off = (lo + hi) / 2 - 0.5;
  if (lo < SL || hi > SR) bad.safe.push(`块${bi + 1} 墨迹 ${(lo * 100).toFixed(1)}%–${(hi * 100).toFixed(1)}%  ${txt}`);
  if (Math.abs(off) > 0.03) bad.off.push(`块${bi + 1} 整块偏${off > 0 ? '右' : '左'} ${(Math.abs(off) * 100).toFixed(1)}%  ${txt}`);
  if (cs.length > 1 && (cs.every((c) => c > 0.52) || cs.every((c) => c < 0.48)))
    bad.same.push(`块${bi + 1} ${cs.length} 行全部偏${cs[0] > 0.5 ? '右' : '左'}  ${txt}`);
  s.blocks[bi]._m = {lo, hi, off};
});

/* ── ④ 全片接触印张:每块一格,只裁字幕带,画中线 ── */
const cells = join(review, 'cells');
rmSync(cells, {recursive: true, force: true}); mkdirSync(cells, {recursive: true});
// 字幕带的裁切窗口跟着 baseline 走:上留 3 行的高度,下留一点降部
const bandTop = Math.round(H * (view.layout.baseline - 0.22)), bandH = Math.round(H * 0.27);
shots.forEach((t, i) => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(3), '-i', sweep, '-frames:v', '1',
    '-vf', `crop=${W}:${bandH}:0:${bandTop},drawbox=x=${Math.round(W / 2)}:y=0:w=1:h=${bandH}:color=red@0.45:t=1,`
      + `drawbox=x=${Math.round(W * SL)}:y=0:w=1:h=${bandH}:color=cyan@0.30:t=1,`
      + `drawbox=x=${Math.round(W * SR)}:y=0:w=1:h=${bandH}:color=cyan@0.30:t=1,scale=${CELL_W}:-2`,
    join(cells, `c${String(i + 1).padStart(3, '0')}.png`)]);
});
const rows = Math.ceil(shots.length / COLS);
const sheet = join(review, 'contact-sheet.png');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(cells, 'c%03d.png'),
  '-vf', `tile=${COLS}x${rows}:padding=6:color=0x101010`, '-frames:v', '1', sheet]);
rmSync(cells, {recursive: true, force: true});
writeFileSync(join(review, 'contact-sheet.md'),
  shots.map((t, i) => `${i + 1}. ${t.toFixed(2)}s  ${s.blocks[i].lines.map((l) => l.runs.map((x) => x.t).join('')).join(' / ')}`).join('\n'), 'utf8');

/* ── 结论(只打结论,不刷明细) ── */
const offs = s.blocks.filter((b) => b._m).map((b) => Math.abs(b._m.off)).sort((a, c) => a - c);
console.log(`\n量了 ${offs.length}/${s.blocks.length} 块 · 整块偏心 中位 ${(offs[offs.length >> 1] * 100).toFixed(2)}% / 最大 ${(offs.at(-1) * 100).toFixed(2)}%`);
const total = bad.safe.length + bad.off.length + bad.same.length + bad.count.length;
if (total === 0) console.log('✅ 安全区 / 整块居中 / 两行不同侧 —— 全片通过');
else {
  for (const [k, label] of [['safe', '越出安全区'], ['off', '整块偏心>3%'], ['same', '两行同侧'], ['count', '抽帧行数对不上']]) {
    if (!bad[k].length) continue;
    console.log(`\n❌ ${label} ${bad[k].length} 块:`);
    bad[k].slice(0, 8).forEach((x) => console.log('   ' + x));
    if (bad[k].length > 8) console.log(`   …还有 ${bad[k].length - 8} 块`);
  }
}
console.log(`\n接触印张 → ${sheet}  (${COLS}×${rows},红线=画幅中线,青线=安全区 ${(SL*100).toFixed(0)}%/${(SR*100).toFixed(0)}%)`);
console.log(`对照清单 → ${join(review, 'contact-sheet.md')}`);
console.log(total === 0 ? '过目没问题就跑:node tools/caption-finalize.mjs ' + name : '先改脚本,再跑一次这条');
