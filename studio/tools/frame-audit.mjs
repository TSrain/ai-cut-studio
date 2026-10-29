#!/usr/bin/env node
// tools/frame-audit.mjs — 单张关键帧的**数字自查**(与 check-density.sh 互补)
//
// 为什么需要这个:
//   本项目要求「渲关键帧并亲眼检查」,于是每张 1080×1920 的帧都被原样读进模型。
//   全分辨率读一张图约 1844 tokens(长边先降到 1568,再按像素面积/750 计),
//   一个 20 镜批次光看图就 20 万 tokens。但那里面有一大半判断**根本不需要眼睛**:
//   墨量够不够、强调色面积是不是在 10%–35%、画面有没有堆在一侧、安全区里压没压着东西、
//   有没有跑到合同 palette 之外的颜色 —— 这些都是能算出来的数,一次约 80 tokens。
//
//   所以分工是:**能被数字判定的以数字为准,眼睛只用在数字判不了的地方**——
//   首尾锚点对不对、语义成不成立、构图好不好看。这条分工和 memory 里那条
//   「规则执行错了先想能不能脚本量出来」是同一件事。
//
// 量什么(全部在 270px 宽的缩略尺度上算,和 check-density.sh 同一口径,数字可以互相对照):
//   ink              墨量%。底色取全帧众数色,chebyshev 距离 >12 记为有内容。
//   luminanceBands   明度层数。8 级量化后占比 >0.5% 的档数,粗略反映表面层级。
//   balance          墨量质心 + 左右/上下分布。对应「信息不要堆一侧」。
//   edgeDetail       安全区外缘带里的硬边缘占比。文字/图形边缘局部对比高,平滑渐变背景不高,
//                    所以它能区分「背景铺到边」和「文字压到边」。这是**提示去看图**的信号,不是判决。
//   offPalette       离合同 palette 所有声明色最近距离仍 >40 的像素占比(合同没写 palette 就跳过)。
//   accentShare      最近色落在 palette.accent 上的像素占比,对照 quality-checklist 的 10%–35%。
//
// 墨量和明度层数仅作描述，不设首尾帧下限。真实观看判断入场、退场与留白。
// 缺图、解码失败、必要 review 副本缺失和显式 strict 色彩检查仍失败。
//
// 用法:
//   node tools/frame-audit.mjs <图片...> [--contract <visual-contract.json>] [--profile <名>]
//                              [--as first|tail] [--min-ink 20] [--safe-margin 0.05] [--strict] [--json]
//   --as 不给时按文件名推断:名字里含 start/first/0 → 首帧描述,其余 → 尾帧描述。
//
// 退出码: 0 = 过; 1 = 有硬性项不过; 2 = 参数错; 127 = 缺依赖
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {basename} from 'node:path';

const PROFILES = new Set(['visual-max', 'brand-energy', 'data-cinematic', 'editorial-luxe', 'keynote-calm']);

const SAMPLE_WIDTH = 270;
const INK_DISTANCE = 12;   // 与 check-density.sh 同值
const DETAIL_THRESHOLD = 24;
const PALETTE_DISTANCE = 40;
const ACCENT_BAND = [10, 35]; // quality-checklist:强调面积 10%–35%

const usage = () => {
  console.error(
    '用法: node tools/frame-audit.mjs <图片...> [--contract <json>] [--profile <名>]\n' +
      '                                [--as first|tail] [--min-ink 20] [--safe-margin 0.05] [--strict] [--json]',
  );
  process.exit(2);
};

const argv = process.argv.slice(2);
if (argv.length === 0) usage();

const files = [];
const opts = {contract: '', profile: '', as: '', minInk: null, safeMargin: 0.05, strict: false, json: false};
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  switch (arg) {
    case '--contract': opts.contract = argv[++i] ?? ''; break;
    case '--profile': opts.profile = argv[++i] ?? ''; break;
    case '--as': opts.as = argv[++i] ?? ''; break;
    case '--min-ink': opts.minInk = Number(argv[++i]); break;
    case '--safe-margin': opts.safeMargin = Number(argv[++i]); break;
    case '--strict': opts.strict = true; break;
    case '--json': opts.json = true; break;
    default:
      if (arg.startsWith('--')) usage();
      files.push(arg);
  }
}
if (files.length === 0) usage();
if (opts.as && !['first', 'tail'].includes(opts.as)) usage();
if (opts.minInk !== null && !(opts.minInk >= 0 && opts.minInk <= 100)) usage();
if (!(opts.safeMargin >= 0 && opts.safeMargin < 0.5)) usage();

const have = (bin) => spawnSync(bin, ['-version'], {stdio: 'ignore'}).status === 0;
if (!have('ffmpeg') || !have('ffprobe')) {
  console.error('缺少 ffmpeg / ffprobe');
  process.exit(127);
}

const hexToRgb = (hex) => {
  const value = String(hex).trim().replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const chebyshev = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

// —— 合同色板与 profile 元数据（不派生墨量门槛） ——
const resolveFloors = async () => {
  let palette = null;
  let profile = opts.profile;
  if (opts.contract) {
    let contract;
    try { contract = JSON.parse(await readFile(opts.contract, 'utf8')); }
    catch (error) { console.error(`合同读取失败: ${error.message}`); process.exit(2); }
    palette = contract.palette ?? null;
    profile ||= contract.profile || contract.style || contract.styleProfile || '';
  }
  if (profile && !PROFILES.has(profile)) {
    console.error(`未知 profile「${profile}」`); process.exit(2);
  }
  // 保留旧 CLI 参数兼容，但不再将其转为门禁或默认创作要求。
  return {source: '墨量描述（不设首尾帧下限）', palette};
};

// —— 采样:缩到 270px 宽再量。抗噪、快,且和人眼在缩略尺度上的感受一致 ——
const sample = (file) => {
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file],
    {encoding: 'utf8'},
  );
  if (probe.status !== 0) return null;
  const [srcW, srcH] = probe.stdout.trim().split('x').map(Number);
  if (!srcW || !srcH) return null;

  const width = Math.min(SAMPLE_WIDTH, srcW);
  const height = Math.max(1, Math.round((width * srcH) / srcW));
  const out = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${width}:${height},format=rgb24`, '-f', 'rawvideo', '-'],
    {maxBuffer: 1 << 28},
  );
  if (out.status !== 0 || out.stdout.length < width * height * 3) return null;

  const px = new Array(width * height);
  for (let i = 0; i < px.length; i += 1) {
    const o = i * 3;
    px[i] = [out.stdout[o], out.stdout[o + 1], out.stdout[o + 2]];
  }
  return {px, width, height, srcW, srcH};
};

const audit = (frame, palette) => {
  const {px, width, height} = frame;
  const total = px.length;

  // 底色 = 全帧众数色
  const counts = new Map();
  for (const p of px) {
    const key = (p[0] << 16) | (p[1] << 8) | p[2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bgKey = 0;
  let bgCount = -1;
  for (const [key, count] of counts) if (count > bgCount) [bgKey, bgCount] = [key, count];
  const bg = [(bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255];

  const lum = px.map((p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);

  // 墨量 + 质心 + 左右上下分布
  let inkCount = 0;
  let sumX = 0;
  let sumY = 0;
  let left = 0;
  let top = 0;
  const isInk = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    if (chebyshev(px[i], bg) <= INK_DISTANCE) continue;
    isInk[i] = 1;
    inkCount += 1;
    const x = i % width;
    const y = (i / width) | 0;
    sumX += x;
    sumY += y;
    if (x < width / 2) left += 1;
    if (y < height / 2) top += 1;
  }

  // 明度层数:8 级量化后占比 >0.5% 的档数
  const bands = new Map();
  for (const value of lum) {
    const band = Math.round(value / 8);
    bands.set(band, (bands.get(band) ?? 0) + 1);
  }
  const luminanceBands = [...bands.values()].filter((count) => count > total * 0.005).length;

  // 安全区外缘带里的硬边缘占比:和右/下邻居的明度差之和 > 阈值即视为边缘
  const margin = opts.safeMargin;
  const mx = Math.floor(width * margin);
  const my = Math.floor(height * margin);
  let edgePixels = 0;
  let edgeDetail = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const inMargin = x < mx || y < my || x >= width - mx || y >= height - my;
      if (!inMargin) continue;
      edgePixels += 1;
      const i = y * width + x;
      const detail = Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + width]);
      if (detail > DETAIL_THRESHOLD) edgeDetail += 1;
    }
  }

  const result = {
    ink: (inkCount / total) * 100,
    luminanceBands,
    balance: {
      centroidX: inkCount ? sumX / inkCount / width : 0.5,
      centroidY: inkCount ? sumY / inkCount / height : 0.5,
      leftShare: inkCount ? left / inkCount : 0.5,
      topShare: inkCount ? top / inkCount : 0.5,
    },
    edgeDetailShare: edgePixels ? edgeDetail / edgePixels : 0,
    background: `#${bg.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
  };

  // palette 合规:按最近声明色归类。抗锯齿像素会被算进最近的那一档,所以是近似量。
  // 合同的 palette 字段常写成散文(「accent 琥珀橙, 面积 20–35%」),那里面没有 hex 就量不了——
  // 这时不静默跳过,而是明说「合同没给可解析的 hex」,让缺口显形。
  if (palette) {
    const named = [];
    for (const [role, value] of Object.entries(palette)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item !== 'string') continue;
        const direct = hexToRgb(item);
        if (direct) {
          named.push({role, hex: item, rgb: direct});
          continue;
        }
        for (const found of item.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? []) {
          const rgb = hexToRgb(found);
          if (rgb) named.push({role, hex: found, rgb});
        }
      }
    }
    if (named.length === 0) {
      result.palette = {declared: 0, unparseable: true};
    } else {
      let off = 0;
      let accent = 0;
      for (const p of px) {
        let best = null;
        let bestDistance = Infinity;
        for (const entry of named) {
          const distance = chebyshev(p, entry.rgb);
          if (distance < bestDistance) [best, bestDistance] = [entry, distance];
        }
        if (bestDistance > PALETTE_DISTANCE) off += 1;
        else if (best.role === 'accent') accent += 1;
      }
      result.palette = {
        declared: named.length,
        hasAccent: named.some((entry) => entry.role === 'accent'),
        offPaletteShare: (off / total) * 100,
        accentShare: (accent / total) * 100,
      };
    }
  }

  return result;
};

const floorFor = (file) => {
  if (opts.as) return opts.as;
  return /(^|[^a-z])(start|first)([^a-z]|$)|-0+\./i.test(basename(file)) ? 'first' : 'tail';
};

// —— 0.4 自查副本硬检查(只针对 keyframes/ 目录) ——
// 2026-08-04 预生产批次的教训:13 镜只渲了全分辨率交付帧,导演逐张全分辨率 Read,
// 一个环节多花约 18k tokens。规则(「自查看 0.4,别 Read 全分辨率」)写在角色合同里没被执行,
// 所以在这里落成脚本失败:keyframes/ 下超过 REVIEW_COPY_MAX_WIDTH 的帧必须有 <名>.review.png 副本。
// 豁免 recheck-*(它就是"起疑后补渲的全分辨率复核帧",本来就该被全分辨率 Read)。
const REVIEW_COPY_MAX_WIDTH = 700; // 0.4 帧 432px,留出非 1080 画布的余量;1080 全分辨率帧必超
const reviewCopyIssue = (file, srcW) => {
  if (!/[\\/]keyframes[\\/]/.test(file)) return null;
  const name = basename(file);
  if (/^recheck/i.test(name)) return null;
  if (/\.review\.png$/i.test(name)) {
    return srcW > REVIEW_COPY_MAX_WIDTH
      ? `${name} 名字是 .review 副本却有 ${srcW}px 宽——副本必须是 0.4 缩放,重新生成`
      : null;
  }
  if (srcW <= REVIEW_COPY_MAX_WIDTH) return null;
  const copy = file.replace(/\.png$/i, '.review.png');
  if (existsSync(copy)) return null;
  return (
    `全分辨率关键帧(${srcW}px 宽)缺 0.4 自查副本 ${basename(copy)}。` +
    '渲的时候加 --scale=0.4,或 `ffmpeg -i <原帧> -vf "scale=iw*0.4:ih*0.4" <名>.review.png`;' +
    '自查与评审 Read 的必须是副本(~442 tokens),不是这张原图(~1844 tokens)。' +
    '原图只作交付/复核留档,或改名 recheck-*.png 表示确要全分辨率复核。'
  );
};

const {source, palette} = await resolveFloors();
// The selected contract outranks profile defaults. A semantic accent may occupy 0%.
const accentBand = palette?.accentShareRange ?? ACCENT_BAND;
if (!Array.isArray(accentBand) || accentBand.length !== 2 ||
    accentBand.some((value) => !Number.isFinite(value)) ||
    accentBand[0] < 0 || accentBand[1] > 100 || accentBand[0] > accentBand[1]) {
  console.error('palette.accentShareRange must be [min,max] within 0–100');
  process.exit(2);
}


const reports = [];
let failed = 0;

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`文件不存在: ${file}`);
    failed = 1;
    continue;
  }
  const frame = sample(file);
  if (!frame) {
    console.error(`抽帧失败: ${file}`);
    failed = 1;
    continue;
  }

  const kind = floorFor(file);
  const metrics = audit(frame, palette);
  const notes = [];
  const errors = [];

  const copyIssue = reviewCopyIssue(file, frame.srcW);
  if (copyIssue) errors.push(copyIssue);

  const {centroidX, centroidY, leftShare, topShare} = metrics.balance;
  if (Math.abs(centroidX - 0.5) > 0.15 || leftShare > 0.7 || leftShare < 0.3) {
    notes.push(`左右不平衡:质心 x=${centroidX.toFixed(2)},左半边占墨量 ${(leftShare * 100).toFixed(0)}%`);
  }
  if (Math.abs(centroidY - 0.5) > 0.2 || topShare > 0.75 || topShare < 0.25) {
    notes.push(`上下不平衡:质心 y=${centroidY.toFixed(2)},上半边占墨量 ${(topShare * 100).toFixed(0)}%`);
  }
  if (metrics.edgeDetailShare > 0.02) {
    notes.push(
      `安全区外缘带里有硬边缘(${(metrics.edgeDetailShare * 100).toFixed(1)}% 的边缘带像素)。` +
        '背景铺到边不会触发这条,文字/图形压到边会——去 Read 这张图确认',
    );
  }
  if (metrics.palette?.unparseable) {
    notes.push('合同 palette 里没有可解析的 hex(写成了散文),离板颜色与强调色面积这两项量不了——这两条只能回到眼睛');
  } else if (metrics.palette) {
    const {offPaletteShare, accentShare, hasAccent} = metrics.palette;
    if (offPaletteShare > 15) {
      const line = `离板颜色 ${offPaletteShare.toFixed(1)}% 的像素不在合同 palette 附近,画面可能绕过了合同自行声明颜色`;
      (opts.strict ? errors : notes).push(line);
    }
    if (hasAccent && (accentShare < accentBand[0] || accentShare > accentBand[1])) {
      const line = `强调色面积 ${accentShare.toFixed(1)}%,不在 ${accentBand[0]}%–${accentBand[1]}% 区间(${palette?.accentShareRange ? '合同显式覆盖' : 'quality-checklist 默认值'})`;
      (opts.strict ? errors : notes).push(line);
    }
  }

  if (errors.length > 0) failed = 1;
  reports.push({file, kind, metrics, notes, errors});
}

if (opts.json) {
  console.log(JSON.stringify({thresholdSource: source, safeMargin: opts.safeMargin, strict: opts.strict, frames: reports}, null, 2));
} else {
  console.log(`关键帧数字自查  ${source}`);
  for (const report of reports) {
    const {metrics} = report;
    const mark = report.errors.length > 0 ? '✗' : '✓';
    console.log(`\n${mark} ${report.file}  (${report.kind === 'first' ? '首' : '尾'}帧描述)`);
    console.log(
      `    墨量 ${metrics.ink.toFixed(1)}%   明度层数 ${metrics.luminanceBands}   底色 ${metrics.background}   ` +
        `质心 (${metrics.balance.centroidX.toFixed(2)}, ${metrics.balance.centroidY.toFixed(2)})   ` +
        `边缘带硬边 ${(metrics.edgeDetailShare * 100).toFixed(1)}%`,
    );
    if (metrics.palette && !metrics.palette.unparseable) {
      console.log(
        `    离板颜色 ${metrics.palette.offPaletteShare.toFixed(1)}%   ` +
          `强调色面积 ${metrics.palette.accentShare.toFixed(1)}%(合同声明 ${metrics.palette.declared} 个色)`,
      );
    }
    for (const error of report.errors) console.log(`    ✗ ${error}`);
    for (const note of report.notes) console.log(`    ⚠ ${note}`);
  }
  console.log(`\n${failed ? 'FAIL' : 'PASS'}  —— 数字判不了的仍要 Read 看图:首尾锚点、语义、构图好看与否`);
}

process.exit(failed);
