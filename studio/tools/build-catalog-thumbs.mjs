#!/usr/bin/env node
// 渲染 docs/catalog/thumbnails/remotion/<id>.png —— 目录条目的验收样张。
//
// 为什么有这个工具:目录规矩是「没有实际渲出来的缩略图,verified 不许为 true;
// verified:false 不许进生产镜头」。过去 src/components/ 下的表达型组件没有一条能按 id
// 单独渲图,于是 13 个组件干脆连条目都没登记 —— 而 dispatch 的 Component shortlist
// 正是从那份 JSON 算的,它们因此在机器路径上完全隐身。
//
// 默认只渲**缺的**那几张(渲一张约 5 秒),--force 重渲全部。
// 渲完必须**主 agent 亲眼看图**才能把 verified 翻 true(docs/catalog/README.md 第 3 条):
// 没看过图的人翻这个字段,等于把"验证"降级成"填了个字段"。
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'templates/remotion-base');
const OUT = join(ROOT, 'docs/catalog/thumbnails/remotion');
const FRAME = 60; // 与 CatalogThumb.THUMB_FRAME 一致:入场已落位、尚未进入静止段

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// id 清单从合成源码里**解析**出来,不是在这儿再写一份。
//
// 不要试图 import 那个 .tsx —— node 跑不了 TSX,import 必然抛错然后静默落到兜底清单上。
// 2026-08-20 就是这么白渲了一轮:新加的 8 个配方样品一个都没渲,工具却报"跳过 13 张已存在",
// 看起来完全正常。**兜底清单是最坏的一种兜底:它让失败长得像成功。**
// 所以这里改成正则扫 SAMPLES 的键名,扫不到就报错退出,不兜底。
const sampleSrc = readFileSync(join(BUILD, 'src/demo/CatalogThumb.tsx'), 'utf8');
const samplesBody = sampleSrc.slice(sampleSrc.indexOf('> = {'), sampleSrc.indexOf('export const CATALOG_THUMB_IDS'));
const IDS = [...samplesBody.matchAll(/^ {2}'([a-z0-9-]+)':\s*\{$/gm)].map((m) => m[1]);
if (IDS.length === 0) {
  console.error('FAIL: 没能从 CatalogThumb.tsx 解析出任何样品 id —— 是不是 SAMPLES 的写法变了?');
  process.exit(1);
}

mkdirSync(OUT, {recursive: true});
let rendered = 0;
let skipped = 0;
for (const id of IDS) {
  if (only && id !== only) continue;
  const out = join(OUT, `${id}.png`);
  if (existsSync(out) && !force) {
    skipped += 1;
    continue;
  }
  process.stdout.write(`渲 ${id} … `);
  execFileSync(
    'npx',
    [
      'remotion', 'still', 'CatalogThumb',
      `--frame=${FRAME}`,
      `--props=${JSON.stringify({id})}`,
      out,
    ],
    {cwd: BUILD, stdio: ['ignore', 'ignore', 'inherit']},
  );
  rendered += 1;
  console.log('done');
}
console.log(`\n缩略图:渲 ${rendered} 张,跳过 ${skipped} 张(已存在)。`);
console.log('下一步:亲眼看图 → 目录里把 verified 翻 true。没看过不许翻。');
