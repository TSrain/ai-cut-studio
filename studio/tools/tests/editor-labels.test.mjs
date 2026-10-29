import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(resolve('templates/remotion-base/package.json'));
const out = join(mkdtempSync(join(tmpdir(), 'editor-labels-')), 'labels.mjs');
await require('esbuild').build({entryPoints: ['tools/editor/labels.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm'});
const {labelForField, labelForOption, FONT_OPTIONS} = await import(out);
const source = readFileSync('templates/remotion-base/src/editor/preset-catalog.generated.ts', 'utf8');
const assets = JSON.parse(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1));

test('全部 preset 字段和枚举值都有可见中文标签', () => {
  const missing = [];
  for (const asset of assets) {
    for (const [key, spec] of Object.entries(asset.slots)) if (!/[\u3400-\u9fff]/.test(labelForField(asset.id, `slots.${key}`, spec.label))) missing.push(`${asset.id}:slots.${key}`);
    for (const [key, spec] of Object.entries(asset.variants)) {
      if (!/[\u3400-\u9fff]/.test(labelForField(asset.id, `variant.${key}`, spec.label))) missing.push(`${asset.id}:variant.${key}`);
      for (const value of spec.values ?? []) if (!/[\u3400-\u9fff]/.test(labelForOption(asset.id, key, value))) missing.push(`${asset.id}:${key}=${value}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('章节字段、字体显示名与实际 fontFamily 分离', () => {
  for (const key of ['thickness','gap','showLabels','completedColor','activeColor','futureColor']) assert.match(labelForField('chapter-progress', key), /[\u3400-\u9fff]/);
  assert.equal(FONT_OPTIONS.find((x) => x.value === 'Noto Serif SC')?.label, '思源宋体');
  assert.equal(FONT_OPTIONS.find((x) => x.value === 'LXGW WenKai')?.label, '霞鹜文楷');
  assert.equal(labelForField('doc-typewriter', 'variant.history'), '历史记录');
  assert.equal(labelForField('title-reveal', 'variant.style'), '动画风格');
});
