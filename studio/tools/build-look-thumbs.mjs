#!/usr/bin/env node
// 给每个「装饰预设(look)」× 每个模板渲一张缩略图,供控制台的观感选择用。
//
// ============ 为什么是「每个模板都渲一遍」============
//
// 初版偷懒:六张观感图统一用关键概念卡渲。结果你在控制台里选了「卡片群收束」,
// 下面六张还是关键概念卡的样子 —— 等于没告诉你这套观感**用在当前模板上**长什么样,
// 而那正是你要看的。观感是"皮肤 × 版式"的乘积,只给一个版式的样子就是只给了一半。
//
// 代价是 7×6=42 张图、约一分半钟渲染。换来的是选观感时所见即所得。
//
// 用法:
//   node tools/build-look-thumbs.mjs [--force] [--preset <compositionId>]
// 产物:docs/catalog/thumbnails/looks/<compositionId>--<lookId>.png

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(ROOT, 'templates/remotion-base');
const OUT = join(ROOT, 'docs/catalog/thumbnails/looks');

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--preset') ? args[args.indexOf('--preset') + 1] : null;

const {looks} = JSON.parse(readFileSync(join(ROOT, 'docs/presets/looks.json'), 'utf8'));

// 每个模板用它自己 preset.json 里的 sample 当内容 —— 和控制台表单的初值同一份,
// 所以缩略图和你点开表单看到的第一眼是一致的
const presets = readdirSync(join(ROOT, 'docs/presets'))
  .filter((d) => existsSync(join(ROOT, 'docs/presets', d, 'preset.json')))
  .map((d) => JSON.parse(readFileSync(join(ROOT, 'docs/presets', d, 'preset.json'), 'utf8')))
  .filter((p) => p.compositionId && p.sample)
  .filter((p) => !only || p.compositionId === only);

mkdirSync(OUT, {recursive: true});

// 英雄帧:和 StyleBible 用同一套(hold 相位内、入场全部完成后的一帧)
const HERO = {
  PresetRecede: 75,
  PresetKeyConcept: 60,
  PresetQuoteCard: 70,
  PresetContrastPair: 55,
  PresetNumberBeat: 50,
  PresetCardSwarm: 140,
  PresetScreenPush: 110,
  PresetSpaceSteps: 185,
  PresetTimelineTravel: 150,
  PresetTextMask: 60,
};

let n = 0;
let skipped = 0;
for (const p of presets) {
  for (const look of looks) {
    const out = join(OUT, `${p.compositionId}--${look.id}.png`);
    if (!force && existsSync(out) && statSync(out).size > 0) {
      skipped++;
      continue;
    }
    process.stdout.write(`渲 ${p.name} × ${look.name} … `);
    const props = {
      durationSeconds: p.duration?.default ?? 3,
      ...(p.sample.variant ? {variant: p.sample.variant} : {}),
      slots: p.sample.slots,
      tune: {scale: 1, x: 0, y: 0, ...look.tune},
    };
    try {
      execFileSync(
        'npx',
        [
          'remotion',
          'still',
          p.compositionId,
          `--frame=${HERO[p.compositionId] ?? 60}`,
          // 0.3 缩放:下拉里就显示这么大,42 张全分辨率纯属浪费
          '--scale=0.3',
          `--props=${JSON.stringify(props)}`,
          out,
        ],
        {cwd: TPL, stdio: ['ignore', 'ignore', 'inherit']},
      );
      console.log('ok');
      n++;
    } catch (e) {
      console.log('失败(跳过)');
    }
  }
}
console.log(`\n观感缩略图:新渲 ${n} 张,跳过 ${skipped} 张 · ${presets.length} 模板 × ${looks.length} 观感 → ${OUT}`);
