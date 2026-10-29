#!/usr/bin/env node
/**
 * 字幕脚本机械校验 —— 在渲染之前拦掉肉眼看不出来的错。
 *
 *   node tools/lint-caption-script.mjs <脚本.json> [--duration 190.8]
 *
 * 判据来自 workspace/learn/dy-7543853957756489003/STUDY.md 的实测:
 *   行宽 ≤78% 画幅(汉字按 1 个字宽估、拉丁按 0.55 估)、一块 ≤3 行、
 *   line.in 必须落在块区间内、块之间不许时间倒置、时间轴要覆盖到音频结尾。
 *
 * 判据本身在 `tools/lib/caption-spec.mjs`,和控制台「改字幕」区共用同一份。
 * 早先这里自己抄了一张 INK 表,那是个静默漂移源:改了 spec.ts 而没同步,
 * 这个 linter 会**放过实际超宽的行**,而且不报错。
 *
 * 退出码 1 = 有硬性错误,不许渲。
 */
import {readFileSync} from 'node:fs';
import {captionSpec, lintScript} from './lib/caption-spec.mjs';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('用法: node tools/lint-caption-script.mjs <脚本.json> [--duration 秒]');
  process.exit(2);
}
const durIdx = rest.indexOf('--duration');
const audioDur = durIdx >= 0 ? Number(rest[durIdx + 1]) : null;

const s = JSON.parse(readFileSync(file, 'utf8'));
const spec = await captionSpec();
const {errs, warns, stats} = lintScript(spec, s, audioDur);

const where = (x) => (x.bi < 0 ? '' : `块#${x.bi + 1}${x.li >= 0 ? ` 行${x.li + 1}` : ''} `);

if (stats) {
  console.log(`块 ${stats.blocks} 个 / 行 ${stats.lines} 条 / 时长 ${stats.end.toFixed(1)}s`);
  console.log(`平均每块 ${stats.avgBlock.toFixed(2)}s  (实测原片 1.69s)`);
  console.log(`带琥珀的行 ${stats.amberPct.toFixed(0)}%  (实测原片按秒计 37%)`);
  console.log('角色分布:', Object.entries(stats.byRole).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('入场分布:', Object.entries(stats.byEnter).map(([k, v]) => `${k}=${v}`).join('  '));
}
if (warns.length) {
  console.log(`\n⚠️  ${warns.length} 条提醒:`);
  warns.forEach((w) => console.log('   ' + where(w) + w.msg));
}
if (errs.length) {
  console.log(`\n❌ ${errs.length} 条硬性错误:`);
  errs.forEach((e) => console.log('   ' + where(e) + e.msg));
  console.log('\n(这些也能在控制台「改字幕」区里直接改:node tools/build-asset-browser.mjs --serve)');
  process.exit(1);
}
console.log('\n✅ PASS');
