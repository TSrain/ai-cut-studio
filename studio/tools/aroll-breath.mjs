#!/usr/bin/env node
// Purpose-driven talking-head reframing. A v2 shot plan contains editorial events;
// this CLI validates them, compiles them into a continuous zoom track, and renders
// without touching the source duration or audio stream.
//
//   node tools/aroll-breath.mjs check <video> <shot-plan.json>
//   node tools/aroll-breath.mjs apply <video> <shot-plan.json> [--out <file>] [--codec hevc|h264]

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {
  DEFAULT_ANCHOR,
  DEFAULT_LEVELS,
  compileShotPlan,
  buildCameraFilter,
  validateShotPlan,
} from './lib/aroll-shot-plan.mjs';

const die = (message) => {
  console.error('[aroll-breath] ' + message);
  process.exit(1);
};

const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, fallback) => {
  const index = args.indexOf('--' + name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const r2 = (value) => Math.round(value * 100) / 100;

const usage = '用法: check <视频> <shot-plan.json> | apply <视频> <shot-plan.json> [--out 文件] [--codec hevc|h264]';

const probe = (video) => {
  const output = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    video,
  ], {encoding: 'utf8'});
  const parsed = JSON.parse(output);
  const stream = parsed.streams?.[0] ?? {};
  const [numerator, denominator] = String(stream.r_frame_rate || '30/1').split('/').map(Number);
  return {
    w: stream.width,
    h: stream.height,
    fps: numerator / (denominator || 1),
    dur: Number(parsed.format?.duration) || 0,
  };
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    die(`读不懂镜头计划 ${path}: ${error.message}`);
  }
};

const validateV2 = (plan, info) => {
  const report = validateShotPlan(plan, {duration: info.dur});
  if (report.errors.length) die('镜头计划没过校验:\n- ' + report.errors.join('\n- '));
  for (const warning of report.warnings) console.warn(`[aroll-breath] ${warning}`);
  return report;
};

const loadTimeline = (path, info, {allowLegacy = false} = {}) => {
  const plan = readJson(path);
  if (plan.version === 2) {
    const report = validateV2(plan, info);
    return {
      plan,
      report,
      segments: compileShotPlan(plan, {duration: info.dur}),
      anchor: {...DEFAULT_ANCHOR, ...(plan.anchor ?? {})},
    };
  }

  if (!allowLegacy) die('只接受 version=2 的有目的镜头计划；旧版按段落自动推拉已停用');
  if (!Array.isArray(plan.segments) || !plan.segments.length) die('旧版 markers.json 里没有 segments');
  console.error('[aroll-breath] ⚠️ 正在兼容渲染旧版段落推拉；新项目必须使用 version=2 shot-plan.json');
  return {
    plan,
    report: null,
    segments: plan.segments,
    anchor: DEFAULT_ANCHOR,
  };
};

if (mode === 'check') {
  const [, video, planPath] = args;
  if (!video || !planPath || !existsSync(video) || !existsSync(planPath)) die(usage);
  const info = probe(video);
  if (!info.w || !info.h) die('探测不到视频尺寸');
  const {plan, report} = loadTimeline(planPath, info);
  console.log(`[aroll-breath] PASS · ${plan.events.length} 个事件 / ${report.stats.changeCount} 次实际变化`);
  console.log(`全片平均 ${report.stats.changesPerMinute.toFixed(2)}/min · 滚动60秒峰值 ${report.stats.maxChangesIn60Seconds}（仅统计，不限次数）`);
  console.log(`完整镜头轨：基础全景 ${report.stats.baseCoveragePct}% · 近景停留 ${report.stats.closeHoldCoveragePct}% · 推拉过程 ${report.stats.movementCoveragePct}%（不推断 B-roll 遮挡）`);
  const levels = {...DEFAULT_LEVELS, ...plan.levels};
  console.log(`A/B/C ${levels.A}/${levels.B}/${levels.C} · anchor ${plan.anchor?.x ?? 0.5},${plan.anchor?.y ?? 0.5}`);
  for (const item of plan.events) {
    const at = item.transition === 'slow' ? `${item.from}–${item.toTime}` : item.at;
    console.log(`${String(at).padStart(12)}  ${item.transition.padEnd(4)} → ${item.to}  [${item.purpose}] ${item.cue}`);
  }
} else if (mode === 'apply') {
  const [, video, planPath] = args;
  if (!video || !planPath || !existsSync(video) || !existsSync(planPath)) die(usage);
  const info = probe(video);
  if (!info.w || !info.h) die('探测不到视频尺寸');

  const {segments, anchor, report} = loadTimeline(planPath, info, {allowLegacy: true});
  if (segments.length > 120) console.warn('[aroll-breath] 长时间轴：编译段较多，关注渲染资源；不按次数删减镜头');

  const codec = opt('codec', 'hevc');
  const out = opt('out', video.replace(/(\.[^.]+)$/, '') + `.shots${extname(video) || '.mp4'}`);
  if (resolve(out) === resolve(video)) die('拒绝原地覆盖源视频，请给 --out 新文件');

  const filters = buildCameraFilter(segments, {width: info.w, height: info.h, fps: info.fps, anchor});
  const encoder = codec === 'h264'
    ? ['-c:v', 'libx264', '-crf', '12', '-preset', 'slow']
    : ['-c:v', 'hevc_videotoolbox', '-q:v', '65', '-tag:v', 'hvc1'];

  const summary = report
    ? `${report.stats.changeCount} 次有目的变化 · ${report.stats.changesPerMinute}/min`
    : `${segments.length} 个旧版标记段`;
  console.log(`[aroll-breath] ${info.w}x${info.h} ${r2(info.dur)}s · ${summary} · 编码 ${codec} · 原音轨复制`);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', video,
    '-vf', filters,
    ...encoder,
    '-c:a', 'copy',
    '-movflags', '+faststart',
    out,
  ], {stdio: 'inherit', maxBuffer: 1 << 28});

  const rendered = probe(out);
  const drift = Math.abs(rendered.dur - info.dur);
  console.log(`\n交付  ${out}`);
  console.log(`时长 ${r2(rendered.dur)}s（源 ${r2(info.dur)}s，漂移 ${r2(drift)}s）${drift <= 0.1 ? ' ✅' : ' ❌ 时长漂了，别交付'}`);
  if (drift > 0.1) process.exitCode = 1;
} else if (mode === 'plan') {
  die('按字幕段落自动推拉已停用。请按语义编写 version=2 shot-plan.json，再运行 check');
} else {
  die(usage);
}
