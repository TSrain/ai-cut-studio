#!/usr/bin/env node
/**
 * 按字幕脚本实际用到的字符,把中文字体子集化。
 *
 *   node tools/subset-caption-font.mjs <脚本.json> [--out <目录>] [--font <字体>]
 *
 * 为什么必须做:思源宋体 Bold 是 12MB。Remotion 整片渲染会开多个浏览器标签页,
 * 每页都要重新 fetch 一遍这个字体;标签页在长片里还会反复重启。
 * 实测 89 秒片子随机在第 1973 / 2136 帧撞 delayRender 超时,
 * 191 秒片子把 concurrency 降到 3、timeout 提到 120 秒**依然失败**。
 * 降并发和加超时都是拖延,子集化才是根治:一支片子通常只用 300 来个字。
 *
 * 输出 <out>/caption-subset.otf,并打印压缩比。
 */
import {readFileSync, mkdirSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {basename, dirname, join, resolve} from 'node:path';

const args = process.argv.slice(2);
const script = args[0];
if (!script) {
  console.error('用法: node tools/subset-caption-font.mjs <脚本.json> [--out 目录] [--font 字体路径]');
  process.exit(2);
}
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const font = argOf('--font', join(ROOT, 'templates/remotion-base/public/fonts/NotoSerifSC-Bold.otf'));
const outDir = argOf('--out', join(dirname(resolve(script)), 'fonts'));
const name = argOf('--name', basename(resolve(script)).replace(/\.json$/, ''));
const out = join(outDir, `${name}.otf`);

const s = JSON.parse(readFileSync(script, 'utf8'));
const chars = new Set();
for (const b of s.blocks ?? []) for (const l of b.lines ?? []) for (const r of l.runs ?? []) {
  for (const ch of r.t) chars.add(ch);
}
// 常用标点和数字一并带上:改一版文案不用每次重新子集化
for (const ch of '0123456789%·、,。：；？！—－()（）「」《》.,:;?!+-=/ ') chars.add(ch);

if (!chars.size) {
  console.error('脚本里没有任何文字');
  process.exit(1);
}

mkdirSync(outDir, {recursive: true});
const text = [...chars].join('');
execFileSync(
  join(ROOT, 'workspace/.venv-fonttools/bin/pyftsubset'),
  [
    font,
    `--text=${text}`,
    `--output-file=${out}`,
    '--layout-features=*',
    '--no-hinting',
    '--desubroutinize',
    '--drop-tables+=DSIG',
  ],
  {stdio: ['ignore', 'inherit', 'inherit']},
);

const before = statSync(font).size;
const after = statSync(out).size;
console.log(`字符 ${chars.size} 个`);
console.log(`${(before / 1024 / 1024).toFixed(1)}MB → ${(after / 1024).toFixed(0)}KB`
  + `  (压到 ${(after / before * 100).toFixed(2)}%)`);
console.log(out);
console.log(`\n把这一行加进脚本 JSON 顶层,渲染器才会用子集(不加就用完整字体):`);
console.log(`  "fontFile": "fonts/subset/${name}.otf"`);
