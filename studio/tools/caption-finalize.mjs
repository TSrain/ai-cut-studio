#!/usr/bin/env node
/**
 * 字幕层**定稿出片** —— 只在接触印张过目之后跑一次。
 *
 *   node tools/caption-finalize.mjs <项目名> [--project-dir /absolute/path] [--tag v7] [--scale 1] [--keep-master]
 *
 * 画幅由脚本顶层的 `canvas` 决定(不写 = 竖屏 1080×1920;横屏写 1920×1080)。
 * --scale 1 就是原尺寸,要 4K 传 --scale 2,但那是 3–4 倍的渲染时间,
 * 成片导出 1080 的话没有任何画质收益。
 *
 * 产物两个(而不是三个):
 *   <tag>-hevc.mov  ← 交付。HEVC 带 alpha,拖进剪映用这个
 *   <tag>-preview.mp4 ← 深灰底 + 原声,不开剪辑软件过一遍
 * ProRes 只作**中间物**(HEVC 带 alpha 必须从它转),转完即删 —— 2026-08-19 那次每轮都留一份
 * 2.5GB 母版,六轮写了 14.5GB 盘,而用户实际用的只有 HEVC。真要留传 --keep-master。
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {captionSpec, lintScript, viewOf, CAPTION_ENGINE} from './lib/caption-spec.mjs';
import {ROOT} from './lib/panel-scan.mjs';

const args = process.argv.slice(2);
const name = args[0];
if (!name) { console.error('用法: node tools/caption-finalize.mjs <项目名> [--tag v7] [--scale 1] [--keep-master]'); process.exit(2); }
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TAG = argOf('--tag', 'final');
const SCALE = Number(argOf('--scale', 1));
const KEEP = args.includes('--keep-master');
/** 中间物还在就不重渲 —— 转码步骤失败时不必再等一次整片渲染 */
const REUSE = args.includes('--reuse-master');

const projectDir = argOf('--project-dir', null);
const dir = projectDir ? resolve(projectDir) : join(ROOT, 'projects', name);
const script = join(dir, 'caption-script.json');
if (!existsSync(script)) { console.error(`没找到 ${script}`); process.exit(2); }
const out = join(dir, 'out'); mkdirSync(out, {recursive: true});
const audioDir = join(dir, 'audio');
const audio = existsSync(audioDir)
  ? readdirSync(audioDir).filter((f) => /\.(wav|mp3|m4a|aac|flac)$/i.test(f)).map((f) => join(audioDir, f))[0]
  : null;

const s = JSON.parse(readFileSync(script, 'utf8'));
const spec = await captionSpec();
const {errs} = lintScript(spec, s, null);
if (errs.length) { console.error(`❌ 脚本没过校验(${errs.length} 条),不出片。先跑 caption-iterate。`); process.exit(1); }

// 画幅从脚本读:顶层没有 canvas 就是竖屏 1080×1920(历史脚本全靠这个默认值)
const view = viewOf(spec, s);
const W = Math.round(view.width * SCALE), H = Math.round(view.height * SCALE);
const master = join(out, `.${TAG}-master.mov`);
const hevc = join(out, `${TAG}-hevc.mov`);
const preview = join(out, `${TAG}-preview.mp4`);
const MB = (p) => (statSync(p).size / 1048576).toFixed(0) + ' MB';
const step = (label, fn) => { const t = Date.now(); const r = fn(); console.log(`  ${label} · ${((Date.now() - t) / 1000).toFixed(0)}s`); return r; };

console.log(`定稿出片 ${name} · ${W}×${H}`);
if (REUSE && existsSync(master)) console.log('  复用已有中间物,跳过渲染');
else step('渲 ProRes 4444(中间物)', () => {
  const r = spawnSync(process.execPath, [join(ROOT,'tools/remotion-export-cached.mjs'),'--cwd',CAPTION_ENGINE,'--','remotion', 'render', 'CaptionFromProps', `--props=${script}`,
    '--codec=prores', '--prores-profile=4444', '--image-format=png', '--pixel-format=yuva444p10le',
    `--scale=${SCALE}`, '--concurrency=4', '--timeout=120000', master],
    {cwd: CAPTION_ENGINE, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8'});
  if (r.status !== 0) { console.error((r.stderr || '').slice(-1200)); process.exit(1); }
});
const ff = (a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], {maxBuffer: 1 << 28});
// 空音轨在这一步顺手 -an 掉,不再单开一趟 copy —— 那趟的临时文件叫 .tmp,
// ffmpeg 认不出容器格式会直接报 "Unable to choose an output format"。
step('转 HEVC 带 alpha(顺带剥空音轨)', () => ff(['-i', master, '-map', '0:v:0', '-an',
  '-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.95', '-q:v', '65',
  '-tag:v', 'hvc1', '-pix_fmt', 'bgra', hevc]));
const dur = Math.max(...s.blocks.map((b) => b.out)) + 1.4;
step('带音预览', () => {
  const a = ['-f', 'lavfi', '-i', `color=c=0x141414:s=${view.width}x${view.height}:r=30:d=${dur.toFixed(2)}`, '-i', hevc];
  if (audio) a.push('-i', audio);
  a.push('-filter_complex', `[1]scale=${view.width}:${view.height}[c];[0][c]overlay=format=auto[v]`, '-map', '[v]');
  if (audio) a.push('-map', '2:a', '-c:a', 'aac', '-b:a', '128k');
  a.push('-c:v', 'h264_videotoolbox', '-b:v', '4M', '-pix_fmt', 'yuv420p', '-shortest', preview);
  ff(a);
});

/* alpha 必须验:HEVC 带 alpha 时 ffprobe 会报 yuv420p,看不出来。叠品红底数颜色才作数。
 *
 * 取样方式有两个坑,都踩过:
 *   ① **不要用第二个 `-ss` 做精确定位** —— 写成 `-ss A -i 片 -ss B -f lavfi -i color` 时,
 *      B 会被当成**后面那个输入的**选项,实际取样点仍是 A,短块会取到块外的空隙里,
 *      于是报出"没有 alpha"的假警报。
 *   ② 块与块之间**本来就有约 2 帧全空**(排版把 out 收到下一块 in 前 0.06s,是参考片的
 *      "段落切换清空"),单点取样撞上就是空帧。
 * 所以:解一小段连续帧,取墨量最高的那一帧作数。
 */
const inkRun = (t) => {
  const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', Math.max(0, t - 0.4).toFixed(2), '-i', hevc,
    '-f', 'lavfi', '-i', `color=c=magenta:s=${W}x${H}`,
    '-filter_complex', '[1][0]overlay,scale=270:480', '-frames:v', '12',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 27});
  const FS = 270 * 480 * 3;
  let best = {mag: 100, ink: 0};
  for (let k = 0; k + FS <= px.length; k += FS) {
    let mag = 0;
    for (let i2 = k; i2 < k + FS; i2 += 3) if (px[i2] > 200 && px[i2 + 2] > 200 && px[i2 + 1] < 60) mag++;
    const pct = mag / (FS / 3) * 100;
    if (100 - pct > best.ink) best = {mag: pct, ink: 100 - pct};
  }
  return best;
};
const best = [0.25, 0.5, 0.75]
  .map((f) => inkRun(s.blocks[Math.floor(s.blocks.length * f)].out - 0.3))
  .reduce((a, b) => (b.ink > a.ink ? b : a));
const magPct = best.mag;

if (!KEEP) rmSync(master, {force: true});
console.log(`\n交付  ${hevc}  ${MB(hevc)}`);
console.log(`预览  ${preview}  ${MB(preview)}`);
if (KEEP) console.log(`母版  ${master}  ${MB(master)}`);
console.log(`alpha 品红透出 ${magPct.toFixed(1)}% / 墨 ${best.ink.toFixed(1)}% `
  + (magPct > 80 && best.ink > 0.3 ? '✅' : '❌ 没有 alpha 或抽到空帧,别交付'));
