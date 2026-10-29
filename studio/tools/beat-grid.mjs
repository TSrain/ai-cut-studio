#!/usr/bin/env node
// BGM 节拍网格测定 —— 求**真实** BPM 与相位,产出 beats.json 供分镜按拍号写时间线。
//
// 为什么不用现成的 tempo 数字:上游实测,检测器报 129.2 BPM 而真值是 131.97,偏差 2%+。
// 2% 在 30 秒的片子末尾会累出接近一拍的漂移 —— 拼完就和原声对不上,而这在抽帧自查里看不见。
// 解法是**不信标量,信序列**:检测出逐个瞬态时刻,再对时刻序列做最小二乘等距网格拟合。
//
// 为什么是纯 JS:本机 Python 3.14 没有 numpy/librosa,装 librosa 在 3.14 上很折腾;
// 而这条链路只需要「解 PCM + 能量包络 + 峰值挑选 + 直线拟合」,ffmpeg 加几十行 JS 就够。
// 少一个 Python 依赖,这条链路才在别的机器上也跑得起来。
//
// 用法:
//   node tools/beat-grid.mjs <音频或视频> [--fps 30] [--out beats.json] [--bpm-range 70,180]
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {basename} from 'node:path';

const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
if (!input) {
  console.error('用法: node tools/beat-grid.mjs <音频或视频> [--fps 30] [--out beats.json] [--bpm-range 70,180]');
  process.exit(2);
}
const FPS = Number(opt('fps', 30));
const OUT = opt('out', 'beats.json');
const [BPM_MIN, BPM_MAX] = String(opt('bpm-range', '70,180')).split(',').map(Number);

// —— 1. 解成单声道 PCM ——
// 22050Hz 单声道够用:节拍分析看的是能量包络,不是音色。
const SR = 22050;
const raw = execFileSync(
  'ffmpeg',
  ['-v', 'error', '-i', input, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'],
  {maxBuffer: 1 << 28, encoding: 'buffer'},
);
const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
const duration = pcm.length / SR;

// —— 2. 能量包络 + 一阶差分(onset strength)——
// HOP 512 @22050 ≈ 23ms/帧,足够分辨 180BPM(333ms/拍)的鼓点。
const HOP = 512;
const nFrames = Math.floor(pcm.length / HOP);
const rms = new Float32Array(nFrames);
for (let i = 0; i < nFrames; i++) {
  let s = 0;
  for (let j = i * HOP; j < (i + 1) * HOP; j++) s += pcm[j] * pcm[j];
  rms[i] = Math.sqrt(s / HOP);
}
// 只取上升沿:鼓点是能量突然变大,变小不是事件
const onset = new Float32Array(nFrames);
for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, rms[i] - rms[i - 1]);

// —— 3. 自适应阈值挑峰 ——
// 固定阈值在动态范围大的曲子上必挂(前奏轻、副歌重),所以用局部均值 + k×局部标准差。
const WIN = 43; // ≈1s
const peaks = [];
for (let i = 2; i < nFrames - 2; i++) {
  const a = Math.max(0, i - WIN);
  const b = Math.min(nFrames, i + WIN);
  let mean = 0;
  for (let j = a; j < b; j++) mean += onset[j];
  mean /= b - a;
  let vr = 0;
  for (let j = a; j < b; j++) vr += (onset[j] - mean) ** 2;
  const sd = Math.sqrt(vr / (b - a));
  const thr = mean + 1.4 * sd;
  if (onset[i] > thr && onset[i] >= onset[i - 1] && onset[i] > onset[i + 1]) {
    peaks.push({t: (i * HOP) / SR, strength: onset[i]});
  }
}
if (peaks.length < 8) {
  console.error(`FAIL: 只检测到 ${peaks.length} 个瞬态,这段音频没有可用的节拍结构 —— 不要给它卡点。`);
  process.exit(1);
}

// —— 4. 周期估计:对瞬态间隔做自相关 ——
// 直接取"最常见的间隔"会被切分音带偏,所以在 BPM 区间内扫描周期,
// 用"每个瞬态到最近网格点的距离"打分,取分最高的那个周期。
const score = (period) => {
  let s = 0;
  for (const p of peaks) {
    const phase = p.t / period;
    const d = Math.abs(phase - Math.round(phase)); // 0 = 正好落在网格上
    s += p.strength * Math.max(0, 1 - 4 * d);
  }
  return s;
};
// **不要只取粗扫的第一名**:实测 tonight-hiphop 的粗扫最高分在 131 BPM(相位误差 0.26 ≈ 随机),
// 而真正立得住的网格在 144 BPM(误差 0.148)。打分函数的局部最优和"网格对不对"不是一回事,
// 而且倍频关系(×2 / ÷2 / ×1.5)天然同分——只取第一名等于把选择权交给噪声。
// 所以粗扫收集候选,逐个精修 + 按相位误差评判,最后取误差最小的那个。
// 早期版本要用户手填 --bpm-range 才救得回来,那是把工具的问题转嫁给用户。
const localMaxima = [];
{
  const scan = [];
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.05) scan.push({bpm, s: score(60 / bpm)});
  for (let i = 1; i < scan.length - 1; i++) {
    if (scan[i].s >= scan[i - 1].s && scan[i].s > scan[i + 1].s) localMaxima.push(scan[i]);
  }
  localMaxima.sort((a, b) => b.s - a.s);
}
const candidates = new Set();
for (const c of localMaxima.slice(0, 8)) {
  for (const mult of [1, 2, 0.5, 1.5, 2 / 3]) {
    const bpm = c.bpm * mult;
    if (bpm >= BPM_MIN * 0.5 && bpm <= BPM_MAX * 2) candidates.add(Math.round(bpm * 20) / 20);
  }
}

// —— 5. 最小二乘拟合 t_i = t0 + i·T ——
// **这一步才是这个工具存在的理由**:粗扫的分辨率有限,
// 用落在网格附近的瞬态整体拟合一条直线,把 BPM 和相位一起精修。
const refine = (period) => {
  const pts = [];
  for (const p of peaks) {
    const i = Math.round(p.t / period);
    if (Math.abs(p.t - i * period) < period * 0.12) pts.push({i, t: p.t, w: p.strength});
  }
  if (pts.length < 6) return null;
  let sw = 0, si = 0, st = 0, sii = 0, sit = 0;
  for (const p of pts) {
    sw += p.w; si += p.w * p.i; st += p.w * p.t;
    sii += p.w * p.i * p.i; sit += p.w * p.i * p.t;
  }
  const den = sw * sii - si * si;
  if (Math.abs(den) < 1e-9) return null;
  const T = (sw * sit - si * st) / den;   // 精修后的周期
  const t0 = (st * sii - si * sit) / den; // 相位
  return {T, t0, used: pts.length};
};

// 强瞬态 = 强度前 40%。弱瞬态里混着切分音和噪声,拿它们判网格会把好网格判死。
const sorted = [...peaks].sort((a, b) => b.strength - a.strength);
const strong = sorted.slice(0, Math.max(8, Math.round(sorted.length * 0.4)));

// **验收指标改了三次,都记在这儿,免得下次再绕一遍**:
//
// 第一版:覆盖率(网格点里有多少个附近有瞬态)。2 首 hip-hop 被判死——
//   hip-hop 常常只在 1、3 拍下鼓,网格是对的,只是音乐不在每一拍上敲。那是召回率,对稀疏节奏天然不利。
// 第二版:贴合率(强瞬态里有多少个落在**四分音符**格上)。连 tech-house 都被判死——
//   强瞬态里有大量八分/十六分的 hi-hat,落在拍与拍之间,是真实音乐事件但不在四分格上。
// 第三版(现在):量强瞬态到**八分音符格**的**加权平均相位误差**。
//   0 = 每个重音精确贴格;**均匀随机分布的期望是 0.25**;<0.15 = 明显不随机 = 网格立得住。
//   这个判据对曲风中立,也不依赖拍子敲得满不满。
const phaseErrorOf = (f) => {
  const half = f.T / 2;
  let e = 0;
  let w = 0;
  for (const p of strong) {
    const ph = (p.t - f.t0) / half;
    e += p.strength * Math.abs(ph - Math.round(ph));
    w += p.strength;
  }
  return w ? e / w : 0.25;
};

// **相位误差天然偏爱更细的网格** —— 格子越密越容易贴上,所以纯取最小误差会一路滑向倍频:
// 实测 tech-house 被判成 248 BPM(124 的两倍),数字"更好"但那不是这首歌的拍子,
// 按它分镜每一拍都会切在八分音符上,片子会碎。
//
// 解法不是加一个 margin 去比大小(试过,124 的误差 0.144 对 248 的 0.094,差 0.05,
// 多大的 margin 都是拍脑袋),而是**倍频折半修正**:
// 从误差最小的那个开始,只要"减半之后的网格自己也能通过验收",就取更慢的那个,一直折到不能折。
// 判据用的是同一个验收线(<0.15),不是新造的阈值 —— 能独立通过验收的更慢网格,
// 就是这首歌真正的拍子。
const ACCEPT = 0.15;
const fits = [];
for (const bpm of candidates) {
  let f = refine(60 / bpm);
  if (!f) continue;
  f = refine(f.T) ?? f; // 再收敛一次:第一次的网格偏了会拉进错的点
  fits.push({f, err: phaseErrorOf(f), bpm: 60 / f.T});
}
let fit = null;
let meanPhaseError = 0.25;
if (fits.length) {
  let pick = fits.slice().sort((a, b) => a.err - b.err)[0];
  for (let guard = 0; guard < 4; guard++) {
    const halfBpm = pick.bpm / 2;
    if (halfBpm < BPM_MIN) break;
    let hf = refine(60 / halfBpm);
    if (!hf) break;
    hf = refine(hf.T) ?? hf;
    const herr = phaseErrorOf(hf);
    if (herr >= ACCEPT) break; // 减半后自己都过不了验收,说明那不是拍子
    pick = {f: hf, err: herr, bpm: 60 / hf.T};
  }
  fit = pick.f;
  meanPhaseError = pick.err;
}
if (!fit) {
  console.error('FAIL: 落在网格附近的瞬态太少,拟合不出等距网格 —— 这首歌可能有变速或自由段,不该卡点。');
  process.exit(1);
}

const bpm = 60 / fit.T;
const beatCount = Math.floor((duration - fit.t0) / fit.T);

// —— 6. 网格填充率(参考值,不是判据)——
// 填充率低说明这首歌的拍子稀疏(hip-hop 常见),不代表网格错。判据是上面的相位误差。
const TOL = 0.05; // 50ms ≈ 1.5 帧 @30fps
let covered = 0;
for (let i = 0; i < beatCount; i++) {
  const t = fit.t0 + i * fit.T;
  if (peaks.some((p) => Math.abs(p.t - t) < TOL)) covered += 1;
}
const coverage = beatCount > 0 ? covered / beatCount : 0;

const grid = [];
for (let i = 0; i < beatCount; i++) {
  const t = fit.t0 + i * fit.T;
  const near = peaks.filter((p) => Math.abs(p.t - t) < TOL).sort((a, b) => b.strength - a.strength)[0];
  grid.push({
    beat: i,
    t: Math.round(t * 1000) / 1000,
    frame: Math.round(t * FPS),
    // 真实瞬态的时刻(有就用它钉,别钉网格插值点)
    onsetT: near ? Math.round(near.t * 1000) / 1000 : null,
    onsetFrame: near ? Math.round(near.t * FPS) : null,
    strength: near ? Math.round(near.strength * 1e4) / 1e4 : 0,
  });
}
const strengths = grid.map((g) => g.strength).filter(Boolean).sort((a, b) => b - a);
const accentFloor = strengths.length ? strengths[Math.floor(strengths.length * 0.25)] : 0;

const result = {
  note:
    'BPM 与相位来自最小二乘等距网格拟合,不是检测器的 tempo 标量(那个实测偏差 2%+)。' +
    '时间线用 beatF(n) 写不要用帧号;稀疏重音钉 onsetFrame(真实瞬态)不要钉 frame(网格点)。' +
    '渲完必须跑 tools/verify-beat-sync.mjs 回测,误差 ≤3 帧才算过。',
  input: basename(input),
  durationSeconds: Math.round(duration * 1000) / 1000,
  fps: FPS,
  bpm: Math.round(bpm * 100) / 100,
  beatPeriod: Math.round(fit.T * 1e5) / 1e5,
  phaseSeconds: Math.round(fit.t0 * 1000) / 1000,
  framesPerBeat: Math.round((fit.T * FPS) * 100) / 100,
  onsetsDetected: peaks.length,
  fittedFrom: fit.used,
  coverage: Math.round(coverage * 1000) / 1000,
  meanPhaseError: Math.round(meanPhaseError * 1e4) / 1e4,
  phaseErrorNote: '强瞬态到八分音符格的加权平均相位误差。0 = 完美贴格,均匀随机的期望是 0.25,判据 <0.15',
  strongOnsets: strong.length,
  accepted: meanPhaseError < ACCEPT,
  accentFloor: Math.round(accentFloor * 1e4) / 1e4,
  grid,
};
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

console.log(`节拍网格  ${basename(input)}  ${result.durationSeconds}s @${FPS}fps`);
console.log(`  BPM ${result.bpm}(周期 ${result.beatPeriod}s = ${result.framesPerBeat} 帧)· 相位 ${result.phaseSeconds}s`);
console.log(`  瞬态 ${peaks.length} 个,其中 ${fit.used} 个参与拟合 · 网格 ${beatCount} 拍`);
console.log(
  `  相位误差 ${meanPhaseError.toFixed(3)}(随机=0.25,判据<${ACCEPT},${strong.length} 个强瞬态)· 网格填充率 ${(coverage * 100).toFixed(1)}%` +
    `  ${result.accepted ? '✓ 通过,可以按这个网格分镜' : '✗ 不通过'}`,
);
if (!result.accepted) {
  console.log('  相位误差接近随机 = 强重音没有落在等距网格上,这首歌有变速或自由段。');
  console.log('  **不要给它卡点** —— 跟着一个不存在的拍子剪,比不卡点更糟。');
} else if (coverage < 0.55) {
  console.log('  ⚠ 填充率偏低:网格是对的,但这首歌的拍子稀疏(常见于 hip-hop 只在 1、3 拍下鼓)。');
  console.log('  分镜时别指望每一拍都有声音可卡,切点挑 onsetFrame 非空的那些拍。');
}
console.log(`  → ${OUT}`);
process.exit(result.accepted ? 0 : 1);
