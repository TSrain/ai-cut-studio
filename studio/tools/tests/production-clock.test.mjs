// tools/tests/production-clock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {activeMilliseconds, productionGate} from '../lib/production-clock.mjs';

test('excludes styleframe selection wait from active time', () => {
  const events = [
    {type: 'start', at: 0},
    {type: 'pause-selection', at: 10 * 60_000},
    {type: 'resume-selection', at: 70 * 60_000},
  ];
  assert.equal(activeMilliseconds(events, 80 * 60_000), 20 * 60_000);
});

test('returns advisory progress and budget states', () => {
  assert.equal(productionGate(45 * 60_000), 'progress-advisory');
  assert.equal(productionGate(50 * 60_000), 'progress-advisory');
  assert.equal(productionGate(60 * 60_000), 'budget-advisory');
});
