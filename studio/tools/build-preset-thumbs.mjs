#!/usr/bin/env node
// 渲染 docs/catalog/thumbnails/remotion/preset-<id>.png —— 每个口播模板的验收缩略图。
//
// 为什么补这个工具:这批缩略图过去**没有生成器**,是历次加模板时手工渲的。
// 于是 2026-08-21 一次加 9 个模板时,preset-registration 测试直接红了 9 条,
// 而"该跑哪条命令"没有任何地方写着 —— 控制台的模板墙、MENU.md 的能力菜单
// 都靠这张图,缺了就是一个个灰格子。**没有生成器的产物等于没有产物。**
//
// 用法:
//   node tools/build-preset-thumbs.mjs                 # 缺哪张渲哪张
//   node tools/build-preset-thumbs.mjs --force         # 全部重渲(改了皮肤/组件后)
//   node tools/build-preset-thumbs.mjs --only <id>     # 只渲一个
//
// 渲完**必须亲眼看图**才算数(docs/catalog/README.md 第 3 条):
// 没看过图就把 status 翻 verified,等于把"验证"降级成"填了个字段"。
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(ROOT, 'templates/remotion-base');
const OUT = join(ROOT, 'docs/catalog/thumbnails/remotion');
const FPS = 30;

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// 英雄帧:入场全部完成、进入 hold 相位的那一帧。与 StyleBible.tsx / build-look-thumbs.mjs
// 的 HERO 表同源 —— 改一个记得改另外两个(三处共用同一批取值,尚未抽成单一来源)。
const HERO = {
  PresetRecede: 75,
  PresetKeyConcept: 60,
  PresetQuoteCard: 70,
  PresetContrastPair: 55,
  PresetNumberBeat: 50,
  PresetCardSwarm: 140,
  PresetScreenPush: 110,
  PresetBulletRun: 150,
  PresetStepFlow: 200,
  PresetTrendChart: 225,
  PresetTitleReveal: 75,
  PresetBrandOpen: 80,
  PresetFlyingWords: 96, // 隧道满屏那一拍:finale 定格帧(词已散尽)在模板墙上认不出这是什么模板
  PresetCardShowcase: 150,
  PresetCubeNav: 175,
  PresetDocTypewriter: 120,
  PresetGlassPill: 60,
  PresetPhoneRipple: 140,
  PresetSegmentedThumb: 95,
  // ==== 2026-08-26 shotcraft 第二批 ====
  PresetSpaceSteps: 185,
  PresetTimelineTravel: 150,
  PresetTextMask: 60,
};

const defs = readdirSync(join(ROOT, 'docs/presets'))
  .filter((d) => existsSync(join(ROOT, 'docs/presets', d, 'preset.json')))
  .map((d) => JSON.parse(readFileSync(join(ROOT, 'docs/presets', d, 'preset.json'), 'utf8')))
  .filter((p) => p.compositionId && p.sample?.slots)
  .filter((p) => !only || p.id === only);

mkdirSync(OUT, {recursive: true});
let rendered = 0;
let skipped = 0;
for (const p of defs) {
  const out = join(OUT, `preset-${p.id}.png`);
  if (!force && existsSync(out) && statSync(out).size > 0) {
    skipped += 1;
    continue;
  }
  // 没进 HERO 表的模板落到「默认时长的 78%」—— hold 相位里的一帧,
  // 对所有"入场完就静止"的模板都成立;不对的那个请进表,不要改这个兜底。
  const frame = HERO[p.compositionId] ?? Math.round((p.duration?.default ?? 3) * FPS * 0.78);
  const props = {
    durationSeconds: p.duration?.default ?? 3,
    ...(p.sample.variant ? {variant: p.sample.variant} : {}),
    slots: p.sample.slots,
  };
  process.stdout.write(`渲 ${p.name}(${p.id})@f${frame} … `);
  try {
    execFileSync(
      'npx',
      ['remotion', 'still', p.compositionId, `--frame=${frame}`, `--props=${JSON.stringify(props)}`, out],
      {cwd: TPL, stdio: ['ignore', 'ignore', 'inherit']},
    );
    rendered += 1;
    console.log('ok');
  } catch (e) {
    console.log(`失败:${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`[build-preset-thumbs] 渲 ${rendered} 张,跳过 ${skipped} 张 → ${OUT}`);
if (rendered > 0) {
  console.log('提醒:渲完的图**必须亲眼看过**才算验收通过;之后跑 tools/build-thumb-smalls.sh 压小图。');
}
