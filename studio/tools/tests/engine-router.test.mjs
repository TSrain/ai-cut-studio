// tools/tests/engine-router.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {routeShot} from '../lib/engine-router.mjs';

const blank = {
  framePrecision: 0, dataBinding: 0, continuity: 0, captions: 0, audioSync: 0,
  webUi: 0, shader3d: 0, kineticType: 0, registryFit: 0,
  remotionRisk: 0, hyperframesRisk: 0,
};

test('routes caption and data precision to Remotion', () => {
  const result = routeShot({...blank, framePrecision: 2, dataBinding: 2, captions: 2});
  assert.equal(result.engine, 'remotion');
});

test('routes UI and shader spectacle to HyperFrames', () => {
  const result = routeShot({...blank, webUi: 2, shader3d: 2, registryFit: 2});
  assert.equal(result.engine, 'hyperframes');
});

test('routes exact captions over shader visuals to Hybrid', () => {
  const result = routeShot({...blank, framePrecision: 2, captions: 2, webUi: 2, shader3d: 2});
  assert.equal(result.engine, 'hybrid');
});

test('risk can break an otherwise close score', () => {
  const result = routeShot({...blank, framePrecision: 1, webUi: 1, remotionRisk: 2});
  assert.equal(result.engine, 'hyperframes');
});

test('rejects signals outside 0..2', () => {
  assert.throws(() => routeShot({...blank, webUi: 3}), /integer from 0 to 2/);
});
