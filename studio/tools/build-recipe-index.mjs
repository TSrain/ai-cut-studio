#!/usr/bin/env node
// 生成 docs/catalog/recipes-external.json —— **索引层**的机器可读清单。
//
// 索引层 = 可以浏览、可以挑,但**不能直接用**的外部镜头配方(152 卡 / 209 式,来自 video-shotcraft)。
// 它刻意不进 dispatch:shortlist 按标签重合度取前 10,152 条外部卡涌进去会把信噪比冲垮。
// 挑中一张之后才本地化成 docs/recipes/ 的本地层条目,那时才进 shortlist、才谈得上 verified。
// 分层理由与本地化步骤见 docs/catalog/recipes-external/README.md。
//
// 输入:docs/catalog/recipes-external/_library.json(上游 gallery/api/library.json 的副本)
// 用法:node tools/build-recipe-index.mjs
import {readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs/catalog/recipes-external');
const POSTERS = join(ROOT, 'docs/catalog/thumbnails/recipes-external');
const OUT = join(ROOT, 'docs/catalog/recipes-external.json');
const GALLERY = 'https://vincentwei1021.github.io/video-shotcraft/library.html';

// 竖屏可用性分档。**这一列是本项目自己的判断,不是上游的元数据。**
// 上游全部是 1920×1080 产品宣传片语境;本项目默认 1080×1920 中文口播。
// camera / interaction 里大量镜头依赖真实网页截图与页面空间坐标,
// 在页面采集链路(UPGRADE-PLAN 条目 G)做完之前无从实现——标出来,免得反复挑到做不了的卡。
const FIT_BY_CATEGORY = {
  typography: 'ready',
  effects: 'ready',
  rhythm: 'ready',
  data: 'ready',
  opening: 'rework',
  outro: 'rework',
  'ui-entrance': 'rework',
  transition: 'rework',
  camera: 'needs-capture',
  interaction: 'needs-capture',
};
const FIT_NOTE = {
  ready: '竖屏可直接重排(改版心与字号阶梯即可)',
  rework: '需要重新编排才成立(横版构图/多栏版式)',
  'needs-capture': '依赖真实网页截图与页面空间坐标,先做 UPGRADE-PLAN 条目 G',
};

const library = JSON.parse(readFileSync(join(DIR, '_library.json'), 'utf8'));
const posters = new Set(existsSync(POSTERS) ? readdirSync(POSTERS) : []);

// 已本地化的卡:本地层条目里用 externalRef 声明自己源出哪张外部卡。
// 这样索引里能标出"这张已经有本地实现了",不会被重复本地化。
const catalog = JSON.parse(readFileSync(join(ROOT, 'docs/catalog/components.json'), 'utf8'));
const localized = new Map(
  catalog.filter((entry) => entry.kind === 'recipe' && entry.externalRef).map((entry) => [entry.externalRef, entry.id]),
);

const recipes = [];
for (const card of library.cards) {
  const cardPath = `docs/catalog/recipes-external/${card.category}/${card.name}.md`;
  for (const style of card.styles) {
    const poster = posters.has(`${style.key}.jpg`)
      ? `docs/catalog/thumbnails/recipes-external/${style.key}.jpg`
      : null;
    const fit = FIT_BY_CATEGORY[card.category] ?? 'rework';
    recipes.push({
      key: style.key,
      card: card.name,
      title: style.label,
      category: card.category,
      tags: card.tags ?? [card.category],
      summary: style.description || card.summary,
      use: card.use,
      duration: card.duration,
      energy: card.energy,
      fit,
      fitNote: FIT_NOTE[fit],
      poster,
      cardPath: existsSync(join(ROOT, cardPath)) ? cardPath : null,
      gallery: `${GALLERY}#${style.key}`,
      localizedAs: localized.get(style.key) ?? null,
    });
  }
}
recipes.sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key));

const byFit = recipes.reduce((acc, r) => ({...acc, [r.fit]: (acc[r.fit] ?? 0) + 1}), {});
const index = {
  note:
    '索引层:可浏览、可挑,**不可直接用于生产镜头**。挑中后按 docs/catalog/recipes-external/README.md 本地化,' +
    '本地条目登记进 components.json(kind:"recipe")才进 dispatch。本文件由 tools/build-recipe-index.mjs 生成,不要手改。',
  upstream: {
    repo: 'https://github.com/Vincentwei1021/video-shotcraft',
    license: 'Apache-2.0',
    gallery: GALLERY,
    libraryRevision: library.revision ?? null,
  },
  stats: {cards: library.cards.length, styles: recipes.length, withPoster: recipes.filter((r) => r.poster).length, byFit},
  recipes,
};
writeFileSync(OUT, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(
  `PASS recipe index: ${index.stats.cards} 卡 / ${index.stats.styles} 式` +
    `(有缩略图 ${index.stats.withPoster};竖屏可直接重排 ${byFit.ready ?? 0} / 需重编 ${byFit.rework ?? 0} / 需页面采集 ${byFit['needs-capture'] ?? 0})` +
    `,已本地化 ${recipes.filter((r) => r.localizedAs).length} 式 → ${OUT.replace(`${ROOT}/`, '')}`,
);
