// tools/tests/preset-registration.test.mjs
//
// 「新模板登记齐了没」的闸门。
//
// 加一个 preset 要落七样东西:组件 / preset.json / PRESET.md / Studio 注册 /
// 目录条目 / 缩略图 / **面板循环片**。前六样漏了会当场看出来(渲不出、页面缺卡),
// 第七样不会——模板卡会安静地退化成一张静图,不报错、不缺东西,只是那个模板**不会动了**。
// 而模板一半的价值就在时序,静图证明不了入场生不生硬、末段静止够不够。
//
// 2026-08-16 用户发现流程推进和趋势图表在控制台里不播,才暴露出这个缺口。
// 修法分两层:build-asset-browser.mjs 每次重建自动补渲(治),这个测试守住(防)。
// 光写进文档"记得跑一下"是最弱的一层,不算数。

import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const PRESET_DIR = 'docs/presets';

const presets = readdirSync(PRESET_DIR)
  .filter((id) => existsSync(join(PRESET_DIR, id, 'preset.json')))
  .map((id) => ({id, def: JSON.parse(readFileSync(join(PRESET_DIR, id, 'preset.json'), 'utf8'))}));

test('every preset has a loop preview so its card auto-plays in the console', {skip: process.env.STUDIO_ASSET_TESTS !== '1' && 'Generated previews are not distributed'}, () => {
  assert.ok(presets.length >= 10, `preset 数量异常:${presets.length}`);
  const missing = presets
    .filter(({id}) => {
      const p = join('assets/previews/presets', `${id}.mp4`);
      return !existsSync(p) || statSync(p).size === 0;
    })
    .map(({id}) => id);
  assert.deepEqual(
    missing,
    [],
    `这些模板在控制台里不会动(缺循环片):${missing.join(', ')}\n` +
      `补渲:node tools/build-asset-previews.mjs --only presets`,
  );
});

test('every preset has a thumbnail, PRESET.md and a sample to render them from', () => {
  for (const {id, def} of presets) {
    assert.ok(existsSync(join(PRESET_DIR, id, 'PRESET.md')), `${id} 缺 PRESET.md`);
    if (process.env.STUDIO_ASSET_TESTS === '1') assert.ok(
      existsSync(join('docs/catalog/thumbnails/remotion', `preset-${id}.png`)),
      `${id} 缺缩略图 docs/catalog/thumbnails/remotion/preset-${id}.png`,
    );
    // sample 是缩略图和循环片共用的那份文案 —— 没有它,两者都渲不出来,
    // 而且控制台表单也没有初值,点开模板是一片空白输入框
    assert.ok(def.sample?.slots, `${id} 的 preset.json 缺 sample.slots`);
  }
});

test('every preset is registered in the component catalog', () => {
  const catalog = JSON.parse(readFileSync('docs/catalog/components.json', 'utf8'));
  const ids = new Set(catalog.map((c) => c.id));
  for (const {id} of presets) {
    assert.ok(ids.has(`preset-${id}`), `${id} 没登记进 docs/catalog/components.json(应为 preset-${id})`);
  }
});
