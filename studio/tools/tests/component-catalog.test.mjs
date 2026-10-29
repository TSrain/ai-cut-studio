// tools/tests/component-catalog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {validateCatalog, filterComponents, requiresGuidance} from '../lib/component-catalog.mjs';

// 数字是**闸门不是记录**:目录只应该在"抽了新组件并渲了样张"时增长。
// 对不上就去看是谁加的、有没有走完登记流程(缩略图 + verified + 样品册摆位),
// 而不是顺手把数字改大。2026-08-10 从 51 → 55:新增三个前景叠加层组件
// (film-grain / vignette-layer / shimmer-text)与其对应目录条目。
// 2026-08-14 从 57 → 58:新增口播模板 preset-bullet-run(列点推进)。
// 2026-08-16 从 58 → 60:新增 preset-step-flow(流程推进)与 preset-trend-chart(趋势图表)。
// 2026-08-19 从 60 → 61:补记 preset-screen-push(网页推进+批注)。这条是**补记不是新增**——
// 它的组件、缩略图、样例片、docs/presets/screen-push/ 早就在位,只是闸门数字当时漏抬,
// 于是测试红了三天。同日把 5 个一直挂着 verified:false 的 preset 条目
// (card-swarm / screen-push / bullet-run / step-flow / trend-chart)看图确认后翻成 true:
// 它们是口播快车道天天在用的模板,而规矩是「verified:false 不许进生产镜头」——
// 规则和现实对不上时,要么补验收要么停用,不能长期挂着装看不见。
// 2026-08-19 从 61 → 74:补登记 src/components/ 下 13 个表达型组件
// (ken-burns / contrast-columns / skeleton-card / keyword-highlight / number-ticker /
//  line-chart-reveal / text-reveal / semantic-icon / sticker-chip / metal-coin /
//  hesitant-cursor / stalled-progress / dot-field)。
// 它们**一直存在并在生产中使用**,只是从来没进过这份 JSON —— 而 dispatch 的
// Component shortlist 正是从这里算的,于是最常用的一批组件在机器路径上完全隐身,
// 「写镜头前先查 shortlist」这条规矩长期形同虚设。缩略图由新增的 CatalogThumb 合成渲出
// (node tools/build-catalog-thumbs.mjs),13 张逐张看过才翻的 verified。
// 2026-08-20 从 74 → 83:新增 8 条镜头配方(kind:"recipe")与 1 个组件 TitleDemote。
// 配方 = 几个组件按什么时序凑成一个具名手法,是「散文品味」和「可 import 组件」之间缺的那一层;
// 它们走 dispatch 的独立 Recipe shortlist(与 Component shortlist 分开取上限,免得互相挤掉)。
// 另有 152 张外部卡在 docs/catalog/recipes-external/ —— 那是**索引层**,只能浏览和挑,
// 不进这份 JSON、不进 dispatch,挑中后本地化才登记。
// 2026-08-20 从 83 → 84:新增 PageCam(2.5D 页面相机),移植自 video-shotcraft 并按竖屏重算透视。
// 它是网页镜头链路的落地端:tools/capture-page.mjs 采集 → layout.json 给真实坐标 → PageCam 运镜。
// 2026-08-26 从 85 → 97:8/21 移植的 9 个 preset 条目(当时漏改本测试)+ 本批 3 个
// (space-steps / timeline-travel / text-mask)。
// 2026-08-31 从 97 → 100:新增 glass-pill / flying-words / phone-ripple 三个横竖双档模板;
// 2026-09-04 补齐 8/21 那 9 个 preset 的 params / pitfalls,关闭当时明确留下的目录欠账。
// 2026-08-20 从 84 → 85:新增 DepthCam(分层运镜)。运镜从 4 式(KenBurns 的平面推拉摇)
// 扩到 9 式:急推撞停 / 斜角滚正 / 多层视差 / dolly-zoom / 冻结环绕。
// 后三式**必须分层**,KenBurns 的单图 2D 模型装不下 —— 那三式的说服力全来自
// 『不同深度的东西动得不一样』。分层素材走 tools/matte.swift。
// 2026-09-07 从 100 → 101：SC-0030 D 章节导航提炼为可编辑透明模板。
// 2026-10-10: +1 标题素材展示，原生背景墙与可替换图片/视频。
test('catalog has 102 reviewed entries and one draft presenter template', async () => {
  const entries = JSON.parse(await readFile('docs/catalog/components.json', 'utf8'));
  const result = validateCatalog(entries);
  assert.deepEqual(result, {ok: true, errors: []});
  assert.equal(entries.length, 103);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 103);
  assert.equal(entries.filter((entry) => entry.engine === 'remotion').length, 75);
  assert.equal(entries.filter((entry) => entry.engine === 'hyperframes').length, 28);
});

// ── 参数表棘轮 ──────────────────────────────────────────────────────────────
// 目录条目光有 id 和 tags,worker 拿到 shortlist 也不知道**怎么调**这个组件,
// 于是照旧手搓。params(参数 / 典型值 / 调节手感)与 pitfalls(踩过的坑)补上这一层。
//
// 存量 33 条还没写,列在这里豁免。**这份名单只许变短。**
// 往里加名字 = 又欠了一笔,不是通过了检查;新增条目一律现写现补,不许进名单。
const LEGACY_WITHOUT_GUIDANCE = new Set([
    "annotation-mark",
    "background-system",
    "chart-stage",
    "connection-map",
    "device-mockup",
    "film-grain",
    "hero-frame",
    "image-collage",
    "kinetic-text",
    "logo-cloud",
    "lottie-clip",
    "metadata-rail",
    "metric-cluster",
    "node-chip",
    "preset-bullet-run",
    "preset-card-swarm",
    "preset-contrast-pair",
    "preset-key-concept",
    "preset-number-beat",
    "preset-quote-card",
    "preset-recede",
    "preset-screen-push",
    "preset-step-flow",
    "preset-trend-chart",
    "screenshot-stage",
    "shimmer-text",
    "stage-layers",
    "state-toggle",
    "status-strip",
    "surface-panel",
    "three-stage",
    "transition-bridge",
    "vignette-layer"
  ]);

test('new catalog entries must carry params and pitfalls (ratchet)', async () => {
  const entries = JSON.parse(await readFile('docs/catalog/components.json', 'utf8'));
  const missing = entries
    .filter(requiresGuidance)
    .filter((entry) => !(entry.params?.length > 0 && entry.pitfalls?.length > 0))
    .map((entry) => entry.id)
    .filter((id) => !LEGACY_WITHOUT_GUIDANCE.has(id));
  assert.deepEqual(
    missing,
    [],
    `这些条目缺 params / pitfalls:${missing.join(', ')}。` +
      '目录要回答的是"怎么调这个组件",不是"有没有这个组件"——补上,不要加进豁免名单。',
  );
});

test('ratchet list only shrinks: no stale or already-fixed ids', async () => {
  const entries = JSON.parse(await readFile('docs/catalog/components.json', 'utf8'));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const stale = [...LEGACY_WITHOUT_GUIDANCE].filter((id) => !byId.has(id));
  assert.deepEqual(stale, [], `豁免名单里有已不存在的 id:${stale.join(', ')}`);
  const fixed = [...LEGACY_WITHOUT_GUIDANCE].filter((id) => {
    const entry = byId.get(id);
    return entry?.params?.length > 0 && entry?.pitfalls?.length > 0;
  });
  assert.deepEqual(
    fixed,
    [],
    `这些条目已经补齐了参数表,请从豁免名单里删掉:${fixed.join(', ')}`,
  );
});

test('verified entries point to real thumbnails', {skip: process.env.STUDIO_ASSET_TESTS !== '1' && 'Generated previews are not distributed'}, async () => {
  const entries = JSON.parse(await readFile('docs/catalog/components.json', 'utf8'));
  for (const entry of entries.filter((item) => item.verified)) await access(entry.thumbnail);
});

test('filters by engine and all requested tags without exceeding max', () => {
  const entries = [
    {id: 'a', engine: 'remotion', tags: ['data', 'chart']},
    {id: 'b', engine: 'hyperframes', tags: ['data', 'chart', 'shader']},
  ];
  assert.deepEqual(filterComponents(entries, {engine: 'hyperframes', tags: ['data'], max: 1}).map((x) => x.id), ['b']);
});

// ── 配方的两层不变量 ─────────────────────────────────────────────────────────
// 本地层(components.json 里 kind:"recipe")必须有卡、有缩略图;
// 索引层(recipes-external)不许混进 components.json —— 混进去就等于让 152 条外部卡
// 涌进 dispatch 的 shortlist,信噪比当场垮掉,两层分设就白设了。
test('local recipes have a card file and a thumbnail', async () => {
  const entries = JSON.parse(await readFile('docs/catalog/components.json', 'utf8'));
  for (const entry of entries.filter((item) => item.kind === 'recipe')) {
    assert.match(entry.source, /^docs\/recipes\/.+\.md$/, `${entry.id}.source 必须指向 docs/recipes/ 下的卡`);
    await access(entry.source);
    if (process.env.STUDIO_ASSET_TESTS === '1') await access(entry.thumbnail);
  }
});

test('externalRef points at a real entry in the external index', async () => {
  const entries = JSON.parse(await readFile('docs/catalog/components.json', 'utf8'));
  const index = JSON.parse(await readFile('docs/catalog/recipes-external.json', 'utf8'));
  const keys = new Set(index.recipes.map((item) => item.key));
  for (const entry of entries.filter((item) => item.externalRef)) {
    assert.ok(keys.has(entry.externalRef), `${entry.id}.externalRef=${entry.externalRef} 在索引层里不存在`);
  }
  // 索引里标了 localizedAs 的,本地必须真的有那条 —— 否则索引会一直把它显示成"已本地化"
  const localIds = new Set(entries.map((item) => item.id));
  for (const item of index.recipes.filter((r) => r.localizedAs)) {
    assert.ok(localIds.has(item.localizedAs), `索引说 ${item.key} 已本地化为 ${item.localizedAs},但目录里没有这条`);
  }
});
