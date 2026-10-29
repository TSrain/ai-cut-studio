#!/usr/bin/env node
// 卡点回测 —— 从**成片**里量画面切点与节拍网格的偏差,闭环验收。
//
// 为什么必须从成片量,而不是相信分镜表:分镜写的是意图,成片才是事实。
// 中间任何一步(某镜时长改了、normalize 时长取整、拼接顺序调了)都会让切点漂,
// 而这类漂移**在抽帧自查里完全看不见** —— 画面每一帧都对,只是和音乐错开了。
//
// 两种误差分开报,别混为一谈:
//   · 网格误差 —— 拟合网格与真实瞬态的偏差(音乐本身的问题,beat-grid 已经报过)
//   · 对齐误差 —— **画面切点与网格的偏差(我们的问题,这个工具量的就是它)**
//
// 用法:
//   node tools/verify-beat-sync.mjs <成片.mp4> <beats.json> [--tolerance 3] [--threshold <自适应>]
import {spawnSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {basename} from 'node:path';

const argv = process.argv.slice(2);
const [video, beatsPath] = argv.filter((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
if (!video || !beatsPath) {
  console.error('用法: node tools/verify-beat-sync.mjs <成片.mp4> <beats.json> [--tolerance 3] [--threshold <自适应>]');
  process.exit(2);
}
if (!existsSync(video) || !existsSync(beatsPath)) {
  console.error(`FAIL: 文件不存在(${!existsSync(video) ? video : beatsPath})`);
  process.exit(2);
}
const TOL_FRAMES = Number(opt('tolerance', 3));

const beats = JSON.parse(readFileSync(beatsPath, 'utf8'));
const FPS = beats.fps ?? 30;

// —— 1. 找画面切点 ——
//
// **不要用 `select='gt(scene,0.3)'`**:那个 0.3 是老版本 ffmpeg 的经验值,
// 本机 ffmpeg 8.1 上 `scene` 的数值尺度完全不同(实测硬切处只有 0.001 量级),
// 于是阈值 0.3 一个切点都检不出来,而工具会平静地报告"这片子没有硬切"——
// 又一个**失败长得像成功**的坑。改用专门的 `scdet` 滤镜,它逐帧给 `lavfi.scd.score`。
//
// 阈值也不写死:实测合成样片里两处真实硬切得分 2.41 / 1.43,噪声底约 0.35,
// 但这三个数字完全跟着内容走(慢镜头的底噪更低,快剪的更高)。
// 所以取**自适应判据**:中位数的 6 倍,且不低于绝对下限 0.5。--threshold 可覆盖。
// 用 spawnSync 而不是 execFileSync:`metadata=print` 把分数写在 **stderr**,
// 而 execFileSync 的返回值是 stdout —— 命令成功时反而一个字都拿不到
// (第一版就是这样,报"没有输出任何分数",看起来像 ffmpeg 缺滤镜,其实是拿错了流)。
const proc = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'info', '-i', video, '-vf', 'scdet=threshold=0,metadata=print', '-an', '-f', 'null', '-'],
  {encoding: 'utf8', maxBuffer: 1 << 28},
);
let out = `${proc.stderr ?? ''}${proc.stdout ?? ''}`;


const frames = [];
{
  let t = null;
  for (const line of out.split('\n')) {
    const mt = line.match(/pts_time:([\d.]+)/);
    if (mt) t = Number(mt[1]);
    const ms = line.match(/lavfi\.scd\.score=([\d.]+)/);
    if (ms && t !== null) frames.push({t, score: Number(ms[1])});
  }
}
if (frames.length === 0) {
  console.error('FAIL: scdet 没有输出任何分数 —— 视频解不开,或这台 ffmpeg 没有 scdet 滤镜。');
  process.exit(2);
}
const sortedScores = frames.map((f) => f.score).sort((a, b) => a - b);
const median = sortedScores[Math.floor(sortedScores.length / 2)];
const THRESH = opt('threshold', null) !== null ? Number(opt('threshold', 0)) : Math.max(0.5, median * 6);
const cuts = frames.filter((f) => f.score >= THRESH).map((f) => f.t);

if (cuts.length === 0) {
  console.log(`卡点回测  ${basename(video)}`);
  console.log(`  没检测到硬切(自适应阈值 ${THRESH.toFixed(2)},中位分 ${median.toFixed(3)})。`);
  console.log('  整支片子没有硬切就没有卡点可言 —— 这不是失败,是不适用。');
  process.exit(0);
}

// —— 2. 每个切点到最近网格点的距离 ——
const gridTimes = beats.grid.map((g) => (g.onsetT ?? g.t));
const rows = cuts.map((t) => {
  let bestIdx = 0;
  let bestD = Infinity;
  gridTimes.forEach((gt, i) => {
    const d = Math.abs(gt - t);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  });
  return {
    cutT: Math.round(t * 1000) / 1000,
    cutFrame: Math.round(t * FPS),
    beat: beats.grid[bestIdx].beat,
    errFrames: Math.round((t - gridTimes[bestIdx]) * FPS * 10) / 10,
  };
});

const abs = rows.map((r) => Math.abs(r.errFrames));
const maxErr = Math.max(...abs);
const meanErr = abs.reduce((a, b) => a + b, 0) / abs.length;
const bad = rows.filter((r) => Math.abs(r.errFrames) > TOL_FRAMES);

console.log(`卡点回测  ${basename(video)}  @${FPS}fps  BPM ${beats.bpm}`);
console.log(`  检测到 ${cuts.length} 个硬切 · 平均偏差 ${meanErr.toFixed(2)} 帧 · 最大 ${maxErr.toFixed(1)} 帧(判据 ≤${TOL_FRAMES})`);
for (const r of bad) {
  console.log(`  ✗ ${r.cutT}s(第 ${r.cutFrame} 帧)偏离第 ${r.beat} 拍 ${r.errFrames > 0 ? '+' : ''}${r.errFrames} 帧`);
}
if (bad.length === 0) {
  console.log('  PASS —— 所有切点都在容差内');
  process.exit(0);
}
console.log(`  FAIL —— ${bad.length} / ${cuts.length} 个切点超出容差`);
console.log('  修法:时间线用拍号 beatF(n) 重写那几镜,不要手动挪帧号 —— 手动挪的下次改动又会漂。');
process.exit(1);
