import assert from 'node:assert/strict';
import test from 'node:test';
import {editorAssetBackgroundMode} from '../lib/preset-catalog.mjs';

test('editor background mode follows documented alphaWhen and enhanced overlays', () => {
  assert.equal(editorAssetBackgroundMode('chapter-progress'), 'transparent');
  assert.equal(editorAssetBackgroundMode('number-beat', {variant: {layout: 'side'}}), 'transparent');
  assert.equal(editorAssetBackgroundMode('number-beat', {variant: {celebrate: 'confetti'}}), 'opaque');
  assert.equal(editorAssetBackgroundMode('pill-stack', {variant: {bg: 'transparent'}}), 'transparent');
  assert.equal(editorAssetBackgroundMode('pill-stack', {}), 'transparent');
  assert.equal(editorAssetBackgroundMode('pill-stack', {variant: {bg: 'scene'}}), 'opaque');
  assert.equal(editorAssetBackgroundMode('word-cascade', {variant: {bg: 'aurora'}}), 'opaque');
  assert.equal(editorAssetBackgroundMode('title-reveal', {}), 'opaque');
  assert.throws(() => editorAssetBackgroundMode('missing', {}), /unknown editor asset/i);
});
