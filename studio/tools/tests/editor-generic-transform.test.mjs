import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../templates/remotion-base/src/editor/EditorComposition.tsx', import.meta.url), 'utf8');

test('generic preset wrapper owns saved position and scale without double applying them', () => {
  assert.match(source, /const savedTune = common\.tune/);
  assert.match(source, /x: defaultTune\.x \?\? 0, y: defaultTune\.y \?\? 0, scale: defaultTune\.scale \?\? 1/);
  assert.match(source, /fitScale \* tuneScale/);
  assert.match(source, /translate\(\$\{x\}px, \$\{y\}px\)/);
});

test('generic preset root exposes only the honest whole-asset selection target', () => {
  assert.match(source, /data-editor-part="asset"/);
  assert.match(source, /if \(instance\.assetId === 'number-beat'\)/);
  assert.match(source, /if \(instance\.assetId === 'pill-stack'\)/);
});
