import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterTemplates} from '../editor/studio-state.mjs';

const generated = readFileSync(new URL('../../templates/remotion-base/src/editor/preset-catalog.generated.ts', import.meta.url), 'utf8');
const catalog = JSON.parse(generated.slice(generated.indexOf('=') + 1, generated.lastIndexOf('as const')).trim());
const assets = [{id:'media-stack',name:'截图堆叠'},{id:'media-split',name:'双素材分屏'},{id:'source-pip',name:'主轨同步小窗'},{id:'chapter-progress',name:'章节进度'}, ...catalog];

test('seven purpose categories cover the actual catalog exactly once without stale ids', async () => {
  const {TEMPLATE_CATEGORIES, TEMPLATE_USES} = await import('../editor/template-categories.mjs');
  assert.equal(TEMPLATE_CATEGORIES.length, 7);
  assert.deepEqual(Object.keys(TEMPLATE_USES).sort(), assets.map(a=>a.id).sort());
  const ids = TEMPLATE_CATEGORIES.map(c=>c.id);
  assert.equal(new Set(ids).size,7);
  for(const use of Object.values(TEMPLATE_USES)) {
    assert.ok(ids.includes(use.category));
    assert.ok(use.purpose.length > 4 && use.purpose.length <= 26);
  }
  const grouped = ids.flatMap(id=>filterTemplates(assets,'',id).map(a=>a.id));
  assert.deepEqual(grouped.sort(), assets.map(a=>a.id).sort());
});

test('purpose search matches common creator vocabulary within the chosen category', () => {
  assert.ok(filterTemplates(assets,'百分比','data').some(a=>a.id==='number-beat'));
  assert.ok(filterTemplates(assets,'录屏','demo').some(a=>a.id==='aspect-embed'));
  assert.deepEqual(filterTemplates(assets,'','navigation').map(a=>a.id).sort(), ['chapter-navigation','chapter-progress']);
  assert.equal(filterTemplates(assets,'百分比','navigation').length,0);
  assert.ok(filterTemplates(assets,'关键词','emphasis').some(a=>a.id==='key-concept'));
  assert.ok(filterTemplates(assets,'前后对比','compare').some(a=>a.id==='contrast-pair'));
});

test('all includes future templates and search remains case insensitive', () => {
  const future = {id:'future-template',name:'未来模板'};
  assert.deepEqual(filterTemplates([future]),[future]);
  assert.equal(filterTemplates(assets,' NUMBER-BEAT ').length,1);
  assert.equal(filterTemplates(assets,'没有这种用途').length,0);
});
