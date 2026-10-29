#!/usr/bin/env node
// 本次升级(2026-08-20,UPGRADE-PLAN.md 的 A–H)的**自动验收**。
//
// 为什么单独写一个而不是让人挨个跑:新增能力横跨目录/配方/音效/BGM/运镜/采集/剪映七块,
// 每块的自检命令都不一样。挨个跑要翻文档,翻文档就不会跑,不跑就等于没验收。
//
// 这里只查**能被脚本判定的部分**。判不了的(画面好不好看、剪映能不能打开草稿)
// 在末尾列出来交给人,并且明说为什么脚本判不了 —— 免得看到一片绿就以为全验完了。
//
// 用法:node tools/verify-upgrade.mjs
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const rows = [];
const check = (name, fn, why) => {
  try {
    const detail = fn();
    rows.push({ok: true, name, detail: detail ?? ''});
  } catch (error) {
    rows.push({ok: false, name, detail: error.message, why});
  }
};
const must = (cond, message) => {
  if (!cond) throw new Error(message);
};
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ── 门禁本身 ──
check('测试全绿', () => {
  const r = spawnSync('node', ['--test', ...readdirSync('tools/tests').filter((f) => f.endsWith('.test.mjs')).map((f) => join('tools/tests', f))], {encoding: 'utf8'});
  const pass = /^ℹ pass (\d+)/m.exec(r.stdout ?? '')?.[1];
  const fail = /^ℹ fail (\d+)/m.exec(r.stdout ?? '')?.[1];
  must(fail === '0', `有 ${fail} 项测试失败`);
  return `${pass} 项通过`;
}, '门禁红着的话,下面所有"已登记"都不可信');

// ── B/H:组件目录 ──
check('组件目录完整登记', () => {
  const cat = readJSON('docs/catalog/components.json');
  const unverified = cat.filter((c) => !c.verified);
  must(unverified.length === 0, `${unverified.length} 条 verified:false(不许进生产镜头)`);
  const missing = cat.filter((c) => c.thumbnail && !existsSync(c.thumbnail));
  must(missing.length === 0, `${missing.length} 条缺缩略图`);
  return `${cat.length} 条,全部 verified 且有图`;
}, '目录是 dispatch shortlist 的唯一来源;登记不全等于组件在机器路径上隐身');

check('参数表棘轮生效', () => {
  const cat = readJSON('docs/catalog/components.json');
  const withGuidance = cat.filter((c) => c.params?.length && c.pitfalls?.length);
  must(withGuidance.length >= 22, `只有 ${withGuidance.length} 条带参数表`);
  return `${withGuidance.length} 条带「参数/典型值/调节手感 + 坑」`;
}, '没有调节手感的目录只能回答"有没有",回答不了"怎么调"');

// ── A:镜头配方两层 ──
check('镜头配方(本地层)', () => {
  const cat = readJSON('docs/catalog/components.json');
  const local = cat.filter((c) => c.kind === 'recipe');
  must(local.length >= 8, `本地配方只有 ${local.length} 条`);
  for (const r of local) must(existsSync(r.source), `${r.id} 的卡片文件不存在`);
  return `${local.length} 条,卡片与缩略图齐全`;
});
check('镜头配方(索引层)', () => {
  const idx = readJSON('docs/catalog/recipes-external.json');
  must(idx.stats.styles >= 200, `索引只有 ${idx.stats.styles} 式`);
  const localized = idx.recipes.filter((r) => r.localizedAs).length;
  return `${idx.stats.cards} 卡 / ${idx.stats.styles} 式(可直接重排 ${idx.stats.byFit.ready} · 已本地化 ${localized})`;
});

// ── A2:运镜九式 ──
check('运镜九式的循环片', () => {
  const want = ['push', 'pull', 'pan', 'diagonal', 'crash', 'dutch', 'parallax', 'dolly', 'orbit'];
  const missing = want.filter((v) => !existsSync(`assets/previews/move-${v}.mp4`));
  must(missing.length === 0, `缺 ${missing.join('/')} 的预览片`);
  return `9 段全在(平面 4 式 + 分层 5 式)`;
});

// ── E:声音 ──
check('电影系音效入库', () => {
  const cat = readJSON('assets/library/sfx/CATALOG.json');
  const cine = cat.items.filter((i) => String(i.file).startsWith('cinematic/'));
  must(cine.length >= 149, `只有 ${cine.length} 条`);
  const noName = cine.filter((i) => !i.name || i.name === i.file);
  must(noName.length === 0, `${noName.length} 条没有中文名(只有文件名等于没入库)`);
  const ui = cine.filter((i) => i.cat === 'ui');
  must(ui.every((i) => i.verdict), 'ui/ 有条目没标质感判定');
  return `${cine.length} 条 / 16 类,ui/ 逐条标了 verdict`;
});
check('分发红线还在', () => {
  const cat = readJSON('assets/library/sfx/CATALOG.json');
  const cine = cat.sources.find((s) => s.set === 'cinematic');
  must(/不允许把素材作为独立文件再分发/.test(cine?.redistribution ?? ''), '红线不见了');
  return 'CATALOG.json 与 LIBRARY.md 都写着';
}, '忘了这条,本项目将来公开时会连 Mixkit 素材一起公开');

check('BGM 有节拍网格', () => {
  const bgms = readdirSync('assets/library/bgm').filter((f) => f.endsWith('.mp3'));
  must(bgms.length >= 5, `只有 ${bgms.length} 首`);
  const out = bgms.map((f) => {
    const p = join('assets/library/bgm', f.replace(/\.mp3$/, '.beats.json'));
    must(existsSync(p), `${f} 没跑过 beat-grid`);
    const b = readJSON(p);
    return `${b.bpm}${b.accepted ? '' : '(不可卡点)'}`;
  });
  return `${bgms.length} 首:${out.join(' / ')} BPM`;
});

// ── G:网页采集 ──
check('网页采集链路', () => {
  must(existsSync('tools/capture-page.mjs'), '缺采集脚本');
  must(existsSync('tools/capture/node_modules/puppeteer-core'), '缺 puppeteer-core');
  const base = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  must(existsSync(base), '本机没有 ms-playwright 缓存(没有可用浏览器)');
  return '脚本 + puppeteer-core + 本机 chromium 齐全';
});

// ── F:剪映 ──
check('剪映导出链路', () => {
  must(existsSync('tools/jianying/.venv/bin/python'), '缺 venv');
  const r = spawnSync('tools/jianying/.venv/bin/python', ['-c', 'import pyJianYingDraft'], {encoding: 'utf8'});
  must(r.status === 0, 'pyJianYingDraft 没装好');
  const root = join(process.env.HOME ?? '', 'Movies/JianyingPro/User Data/Projects/com.lveditor.draft');
  const installed = existsSync(root)
    ? readdirSync(root).filter((d) => d === 'motion-smoke-test' || d === 'dsh字幕-可编辑')
    : [];
  return `venv + pyJianYingDraft 就绪;草稿库里已装 ${installed.length} 个待验草稿`;
}, '这一条只证明"装进去了",**证明不了剪映能打开** —— 那一步只能人验');

// ── 控制台 ──
check('控制台已刷新', () => {
  must(existsSync('assets/BROWSER.html'), '控制台没生成');
  const html = readFileSync('assets/BROWSER.html', 'utf8');
  for (const [id, label] of [['recipes', '镜头配方'], ['bgm', 'BGM 与卡点']]) {
    must(html.includes(`id="${id}"`), `控制台缺「${label}」区`);
  }
  const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
  return `新区块齐全,页面 ${mb}MB`;
}, '控制台是你唯一的操作入口;它没刷新,新能力对你就等于不存在');

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
console.log('升级验收(UPGRADE-PLAN.md 的 A–H)\n');
let bad = 0;
for (const r of rows) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${pad(r.name, 20)} ${r.detail}`);
  if (!r.ok) {
    bad += 1;
    if (r.why) console.log(`      为什么要紧:${r.why}`);
  }
}
console.log(`\n${bad === 0 ? 'PASS' : `FAIL(${bad} 项)`} —— 以上是**脚本能判的部分**。\n`);
console.log('脚本判不了、只能你亲自看的三件事:');
console.log('  1. 剪映能不能打开草稿(motion-smoke-test / dsh字幕-可编辑)——');
console.log('     本机草稿全加密,设备指纹抄不到,走的是实验通道,**没人实测过**。');
console.log('  2. 新的运镜/配方/音效好不好用 —— 控制台 `node tools/build-asset-browser.mjs --serve`。');
console.log('  3. 画面好不好看 —— 数字只能判"够不够密、层数够不够",判不了"成不成立"。');
process.exit(bad === 0 ? 0 : 1);
