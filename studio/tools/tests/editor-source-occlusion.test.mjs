import assert from 'node:assert/strict';
import test from 'node:test';

test('opaque full-frame presets hide the video only while covering it', async () => {
  const {coversSource} = await import('../../templates/remotion-base/src/editor/source-occlusion.mjs');
  const asset = {exportBackground: {mode: 'opaque'}};
  const instance = {startFrame: 100, durationFrames: 90, props: {tune: {scale: 1, x: 0, y: 0}}};
  assert.equal(coversSource(instance, asset, true, 99), false);
  assert.equal(coversSource(instance, asset, true, 100), true);
  assert.equal(coversSource(instance, asset, true, 189), true);
  assert.equal(coversSource(instance, asset, true, 190), false);
  for (const tune of [{scale: .99}, {x: 1}, {y: -1}]) {
    assert.equal(coversSource({...instance, props:{tune}}, asset, true, 120), false);
  }
  assert.equal(coversSource(instance, asset, false, 120), false);
});

test('transparent and conditional backgrounds preserve the underlying video', async () => {
  const {coversSource} = await import('../../templates/remotion-base/src/editor/source-occlusion.mjs');
  const instance = {startFrame: 0, durationFrames: 90, props: {}};
  assert.equal(coversSource(instance, {exportBackground:{mode:'transparent'}}, true, 20), false);
  assert.equal(coversSource({...instance,props:{editorBackground:'transparent'}}, {exportBackground:{mode:'opaque'}}, true, 20), false);
  const asset = {exportBackground:{mode:'conditional',variantKey:'bg',value:'transparent'}};
  assert.equal(coversSource({...instance,props:{variant:{bg:'transparent'}}},asset,true,20),false);
  assert.equal(coversSource({...instance,props:{variant:{bg:'scene'}}},asset,true,20),true);
  assert.equal(coversSource(instance,undefined,true,20),false);
});
