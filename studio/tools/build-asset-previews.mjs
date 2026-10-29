#!/usr/bin/env node
// 渲染资产面板要用的循环预览片(运镜 / 文字出场 / 底纹)。
//
// 为什么需要它:字体可以在浏览器里直接 @font-face 渲出来看,图标是 SVG、音效是 wav,
// 都能自己发声自己显形。**只有"运动"没有静态形态**——它只存在于 tsx 代码里,
// 用户打开文件看到的是 interpolate 和 easing 曲线。这个脚本把每种运动渲成一段
// 2.5 秒的小 MP4,面板里自动循环播放,于是"运镜"变成能指着说"要这个"的东西。
//
// 同一个道理适用于**镜头模板**:模板的价值一半在版式、一半在时序,
// 而缩略图只能证明版式。所以这里也把每个 preset 用它自己的 sample 文案渲一段循环片,
// 面板里滚到就自动播 —— 以前那是点一次「预览动效」现渲一次,每次 15–40 秒、
// 而且渲的是同一段东西。**预渲一次存盘,之后所有人都是零等待**;
// 「预览动效」按钮留着,它渲的是**你自己填的字**,和这里的样例片不是一回事。
//
// 用法:node tools/build-asset-previews.mjs [--only text|move|bg|presets] [--force]
// 产物:assets/previews/<group>-<variant>.mp4
//      assets/previews/presets/<preset-id>.mp4(已存在则跳过,除非 --force)
//
// 渲完记得跑 node tools/build-asset-browser.mjs 重新生成面板。

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'templates/remotion-base');
const OUT = join(ROOT, 'assets/previews');
const PRESET_OUT = join(OUT, 'presets');

/** 面板上的分组与条目。中文说明会被 build-asset-browser.mjs 读走当卡片文案,
 *  所以改这里等于改面板——不要在两处各写一份。 */
export const PREVIEWS = [
  {
    group: 'move',
    title: '运镜',
    intro:
      '前四式是 KenBurns 一个组件的参数表达(平面推拉摇);后五式要 DepthCam,因为它们的说服力全来自「不同深度的东西动得不一样」——那是平面裁窗做不到的。静图想"活"过来靠这些;所有插片默认应该带一点,画面才不像 PPT。',
    items: [
      {variant: 'push', name: '慢推', desc: '焦点不动只放大。最安全的一种——画面活着但不抢戏,不知道用哪个就用它。'},
      {variant: 'pull', name: '慢拉', desc: '从局部退到全景。用在"先看细节,再交代这是哪儿"。'},
      {variant: 'pan', name: '横移', desc: '焦点左右走、缩放几乎不变。用在"顺着一条线读过去"(时间轴、流程、长图)。'},
      {variant: 'diagonal', name: '对角推', desc: '边移边放大,最有摄影机在走的感觉,也最容易过头。一支片里别超过一次。'},
      {variant: 'crash', name: '急推撞停', desc: '一拍之内推到底、落位那一下震屏。用来"点名"——把观众视线一把按到目标上。动作必须短(<15 帧),长了就不是撞是推。'},
      {variant: 'dutch', name: '斜角滚正', desc: '画框带着倾角进来再转正。情绪是"纠偏""落定"。起手角度别超过 10°,再多读成失误不是风格。'},
      {variant: 'parallax', name: '多层视差', desc: '同一次横移,三层走三个速度,纵深就长出来了。**需要抠出前景层**(tools/matte.swift)。层间速度差别贪心,差太大会读成两张图各自在滑。'},
      {variant: 'dolly', name: 'dolly-zoom', desc: '主体尺寸钉死、背景压过来。戏剧性蓄力时刻用,**一支片最多一次**,用两次第二次就没有了。同样需要前景层。'},
      {variant: 'orbit', name: '冻结环绕', desc: '观众绕着主体走半步。层带 z 偏移在透视里扫角度。适合给一个静止的主体做"特写巡视"。'},
    ],
  },
  {
    group: 'text',
    title: '文字出场',
    intro:
      '"这句话本身就是画面"时才用。正文说明、字幕不要用——逐字动画会让人读不下去。以后你可以直接说"用砸下来那种"。',
    items: [
      {variant: 'mask', name: '擦出(mask)', desc: '一句话被擦出来。最克制、几乎不会出错,章节标题和跟旁白同步的句子默认用它。'},
      {variant: 'slam', name: '砸下(slam)', desc: '字从大砸到位。短促的强调词、数字结论、节奏点用;必须配硬切或音效,不然像单纯缩放。'},
      {variant: 'split', name: '拆合(split)', desc: '字拆开再合拢。片头、品牌名用;字数超过 8 个就散了。'},
      {variant: 'morph', name: '换词(morph)', desc: '一句话变成另一句("成本"→"投资")。做概念替换的专用手法,别当普通淡入用。'},
    ],
  },
  {
    group: 'bg',
    title: '底纹质感',
    intro:
      '底色不能是一块死掉的纯色——这是"看着专业"和"看着像 PPT"最容易被忽略的一层。四种都压了一行字,看的是它压不压得住内容。',
    items: [
      {variant: 'grid', name: '网格', desc: '双层格线,给密度也给尺度感。技术/数据类内容的默认底,当前皮肤 abyss 用的就是它。'},
      {variant: 'grain', name: '颗粒', desc: '胶片颗粒。"这画面是拍出来的"的质感信号,叠在任何底上都能去掉塑料感。'},
      {variant: 'aurora', name: '极光', desc: '大面积柔光色团。情绪/品牌类画面用;信息密度高时会抢戏。'},
      {variant: 'ghost-type', name: '巨字水印', desc: '主题词放大到出血当底纹。一层免费的信息层,同时把画面撑满。'},
    ],
  },
];

// PREVIEWS 会被 build-asset-browser.mjs import 走当文案源,所以渲染动作必须
// 只在**直接执行本文件**时发生——否则每次生成面板都会顺带跑一遍渲染。
if (resolve(process.argv[1] ?? '') !== fileURLToPath(import.meta.url)) {
  // 被 import:只导出数据,什么都不做
} else {
  render();
}

function render() {
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const force = args.includes('--force');

mkdirSync(OUT, {recursive: true});

let rendered = 0;
let skipped = 0;

// ── 镜头模板的样例循环片 ──
// 用 preset.json 自己的 sample 文案渲(和缩略图同一份文案,面板上图和片才对得上)。
// --scale=0.5:面板里那张卡只有 96px 宽,半分辨率已经绰绰有余,时间省一半。
if (!only || only === 'presets') {
  mkdirSync(PRESET_OUT, {recursive: true});
  for (const id of readdirSync(join(ROOT, 'docs/presets')).sort()) {
    const def = join(ROOT, 'docs/presets', id, 'preset.json');
    if (!existsSync(def)) continue;
    const p = JSON.parse(readFileSync(def, 'utf8'));
    const slots = p.sample?.slots;
    if (!p.compositionId || !slots) {
      console.log(`跳过 ${id}:没有 compositionId 或 sample.slots`);
      continue;
    }
    const out = join(PRESET_OUT, `${id}.mp4`);
    if (!force && existsSync(out) && statSync(out).size > 0) {
      skipped++;
      continue;
    }
    process.stdout.write(`渲染 模板/${id} … `);
    // **variant 必须一起带上**。漏了它,带档位的模板(卡片群的 dedup/filter、
    // 趋势图的 line/bar、流程的 focus/even)全都按 zod 默认值渲,
    // 于是面板上那支循环片演的不是 sample 声明的那个档位——图和片对不上,而且不报错。
    const props = {durationSeconds: p.duration?.default ?? 3, slots, ...(p.sample?.variant ? {variant: p.sample.variant} : {})};
    execFileSync(
      'npx',
      ['remotion', 'render', p.compositionId, `--props=${JSON.stringify(props)}`,
        '--scale=0.5', '--color-space=bt709', out],
      {cwd: BUILD, stdio: ['ignore', 'ignore', 'inherit']},
    );
    console.log('ok');
    rendered++;
  }
}

for (const g of PREVIEWS) {
  if (only && g.group !== only) continue;
  for (const it of g.items) {
    const out = join(OUT, `${g.group}-${it.variant}.mp4`);
    if (!force && existsSync(out) && statSync(out).size > 0) {
      skipped++;
      continue;
    }
    process.stdout.write(`渲染 ${g.group}/${it.variant} … `);
    execFileSync(
      'npx',
      [
        'remotion',
        'render',
        'AssetLoop',
        `--props=${JSON.stringify({group: g.group, variant: it.variant})}`,
        // bt709 出限范围 yuv420p,和生产队列同一套,面板里看到的颜色即成片颜色
        '--color-space=bt709',
        out,
      ],
      {cwd: BUILD, stdio: ['ignore', 'ignore', 'inherit']},
    );
    console.log('ok');
    rendered++;
  }
}
console.log(`\n预览片:新渲 ${rendered} 个,跳过 ${skipped} 个 → ${OUT}`);
}
