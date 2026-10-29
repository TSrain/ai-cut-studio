import test from 'node:test';
import assert from 'node:assert/strict';
import {presetExit} from '../../templates/remotion-base/src/presets/preset-exit.mjs';
import {readdirSync, readFileSync, existsSync} from 'node:fs';
const root = new URL('../../docs/presets/', import.meta.url);
for (const name of readdirSync(root)) {
 const file = new URL(`${name}/preset.json`, root);
 if (!existsSync(file)) continue;
 const spec = JSON.parse(readFileSync(file));
 test(`${name}: minimum/default/maximum durations finish smoothly at 24/30/60fps`, () => {
  for (const fps of [24, 30, 60]) for (const sec of [spec.duration.min, spec.duration.default, spec.duration.max]) {
   const last = Math.round(sec * fps) - 1;
   const state = presetExit(0, fps, sec);
   assert.equal(state.opacity, 1);
   assert.equal(presetExit(state.start, fps, sec).opacity, 1);
   assert.equal(presetExit(last, fps, sec).opacity, 0);
   let previous = 1;
   for (let f = state.start; f <= last; f++) {
    const a = presetExit(f, fps, sec).opacity;
    assert.ok(a >= 0 && a <= previous);
    if (last >= 12) assert.ok(previous - a < .25, 'no one-frame disappearance');
    previous = a;
   }
  }
 });
}
test('local clip endpoint is independent of surrounding movie length', () => {
 assert.equal(presetExit(110, 30, 3.7).opacity, 0);
 assert.equal(presetExit(111, 30, 3.7).opacity, 0);
 assert.equal(presetExit(-1, 30, 3.7).opacity, 1);
});

test('fading opaque scenes reveal the still-mounted source video', async () => {
 const {coversSource} = await import('../../templates/remotion-base/src/editor/source-occlusion.mjs');
 const clip = {startFrame: 30, durationFrames: 75, assetId: 'segmented-thumb', props: {sceneBackground: {type: 'solid'}}};
 const asset = {exportBackground: {mode: 'opaque'}};
 for (const frame of [90, 99, 104]) {
  const opacity = presetExit(frame - clip.startFrame, 30, 2.5).opacity;
  assert.equal(coversSource(clip, asset, true, frame, opacity), opacity === 1);
 }
});
