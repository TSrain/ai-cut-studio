import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {compileShotPlan, validateShotPlan} from '../lib/aroll-shot-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const event = (fields) => ({
  transition: 'cut',
  purpose: 'emphasis',
  cue: '真实字幕短语',
  reason: '信息权重在这里发生变化',
  ...fields,
});

const validPlan = () => ({
  version: 2,
  duration: 180,
  levels: {A: 1, B: 1.18, C: 1.28},
  anchor: {x: 0.57, y: 0.32},
  events: [
    event({at: 0, to: 'B', purpose: 'hook'}),
    event({at: 30, to: 'A', purpose: 'topic-shift'}),
    event({at: 60, to: 'B', purpose: 'argument'}),
    event({transition: 'slow', from: 90, toTime: 105, to: 'C', purpose: 'argument'}),
    event({at: 135, to: 'A', purpose: 'tension-release'}),
  ],
});

test('validates and compiles a purposeful A/B/C plan', () => {
  const plan = validPlan();
  const report = validateShotPlan(plan, {duration: 180});
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.changeCount, 4);
  assert.equal(report.stats.changesPerMinute, 1.33);
  assert.equal(report.stats.slowCoveragePct, 8.33);

  assert.deepEqual(compileShotPlan(plan, {duration: 180}), [
    {from: 0, to: 30, zoomFrom: 1.18, zoomTo: 1.18, transition: 'hold'},
    {from: 30, to: 60, zoomFrom: 1, zoomTo: 1, transition: 'hold'},
    {from: 60, to: 90, zoomFrom: 1.18, zoomTo: 1.18, transition: 'hold'},
    {
      from: 90,
      to: 105,
      zoomFrom: 1.18,
      zoomTo: 1.28,
      transition: 'slow',
      purpose: 'argument',
      cue: '真实字幕短语',
      reason: '信息权重在这里发生变化',
    },
    {from: 105, to: 135, zoomFrom: 1.28, zoomTo: 1.28, transition: 'hold'},
    {from: 135, to: 180, zoomFrom: 1, zoomTo: 1, transition: 'hold'},
  ]);
});

test('rejects a shot change without an editorial purpose', () => {
  const plan = validPlan();
  delete plan.events[1].purpose;
  assert.match(validateShotPlan(plan).errors.join('\n'), /purpose/);
});

test('warns about a small hard cut without forcing a larger crop', () => {
  const plan = validPlan();
  plan.events = [event({at: 0, to: 'B'}), event({at: 10, to: 'C'})];
  plan.levels.C = 1.25;
  assert.deepEqual(validateShotPlan(plan).errors, []);
  assert.match(validateShotPlan(plan).warnings.join('\n'), /hard cut/i);
});

test('allows a visible continuous scale change within safe levels', () => {
  const plan = validPlan();
  plan.events = [event({at: 0, to: 'A'}), event({transition: 'slow', from: 10, toTime: 20, to: 'B'})];
  assert.deepEqual(validateShotPlan(plan).errors, []);
});

test('counts changes without imposing a frequency quota', () => {
  const plan = validPlan();
  plan.events = [
    event({at: 0, to: 'A'}),
    event({at: 5, to: 'B'}),
    event({at: 12, to: 'C'}),
    event({at: 24, to: 'A'}),
    event({at: 36, to: 'B'}),
    event({at: 50, to: 'C'}),
  ];
  assert.deepEqual(validateShotPlan(plan).errors, []);
});

test('flags repeated oscillation for editorial review', () => {
  const plan = validPlan();
  plan.events = [
    event({at: 0, to: 'A'}),
    event({at: 2, to: 'B'}),
    event({at: 5, to: 'A'}),
    event({at: 8, to: 'B'}),
    event({at: 11, to: 'A'}),
  ];
  assert.match(validateShotPlan(plan).warnings.join('\n'), /oscillation.*12/i);
});

test('rejects overlapping slow movement and a new cut', () => {
  const plan = validPlan();
  plan.events = [
    event({at: 0, to: 'A'}),
    event({transition: 'slow', from: 10, toTime: 20, to: 'B'}),
    event({at: 15, to: 'C'}),
  ];
  assert.match(validateShotPlan(plan).errors.join('\n'), /overlap/i);
});

test('rejects crop anchors outside normalized frame coordinates', () => {
  const plan = validPlan();
  plan.anchor.x = 1.1;
  assert.match(validateShotPlan(plan).errors.join('\n'), /anchor/i);
});

test('CLI exposes v2 check mode and anchor-aware crop', () => {
  const source = readFileSync(join(ROOT, 'tools/aroll-breath.mjs'), 'utf8');
  assert.match(source, /mode === 'check'/);
  assert.match(source, /buildCameraFilter\(segments,.*anchor/);
  assert.match(source, /validateShotPlan/);

  const cli = spawnSync('node', ['tools/aroll-breath.mjs'], {cwd: ROOT, encoding: 'utf8'});
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /check.*shot-plan\.json/i);
});

const frequencyPlan = (times, duration = 300) => ({
  version: 2, duration,
  events: [event({at: 0, to: 'A'}), ...times.map((at, i) => event({at, to: i % 2 === 0 ? 'B' : 'A'}))],
});

test('reports three changes with a long static tail', () => {
  assert.equal(validateShotPlan(frequencyPlan([10, 25, 40])).stats.maxChangesIn60Seconds, 3);
});

test('reports a burst across a clock-minute boundary', () => {
  assert.equal(validateShotPlan(frequencyPlan([55, 65, 75])).stats.maxChangesIn60Seconds, 3);
});

test('allows two changes in a short clip without extrapolating a full minute', () => {
  const report = validateShotPlan(frequencyPlan([5, 20], 25));
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.maxChangesIn60Seconds, 2);
});

test('uses half-open rolling windows at the exact sixty-second boundary', () => {
  const report = validateShotPlan(frequencyPlan([10, 40, 70]));
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.maxChangesIn60Seconds, 2);
});

test('counts a continuous movement starting at zero and its return', () => {
  const plan = frequencyPlan([], 180);
  plan.events = [
    event({at: 0, to: 'B'}),
    event({transition: 'slow', from: 0, toTime: 5, to: 'C'}),
    event({at: 20, to: 'A'}),
    event({at: 40, to: 'B'}),
  ];
  const report = validateShotPlan(plan);
  assert.equal(report.stats.changeCount, 3);
  assert.deepEqual(report.errors, []);
});

const gentlePlan = () => ({version: 2, duration: 90, levels: {A: 1, B: 1.04, C: 1.06}, events: [
  event({at: 0, to: 'A'}),
  event({transition: 'slow', from: 10, toTime: 14, to: 'B', easing: 'ramped'}),
  event({transition: 'slow', from: 25, toTime: 26, to: 'A', easing: 'ramped'}),
]});

test('accepts small continuous pushes and returns and preserves the chosen easing', () => {
  const plan = gentlePlan();
  assert.deepEqual(validateShotPlan(plan).errors, []);
  const motion = compileShotPlan(plan).filter(s => s.transition === 'slow');
  assert.equal(motion[0].zoomTo, 1.04);
  assert.equal(motion[1].zoomTo, 1);
  assert.equal(motion[0].easing, 'ramped');
});

test('supports two distinct framing levels without requiring a stronger close-up', () => {
  const plan = gentlePlan(); plan.levels.C = plan.levels.B;
  assert.deepEqual(validateShotPlan(plan).errors, []);
});

test('rejects unsafe levels, unknown easing and one-frame continuous moves', () => {
  const plan = gentlePlan(); plan.levels.B = 0.9;
  assert.match(validateShotPlan(plan).errors.join('\n'), /level B/);
  plan.levels.B = 1.04; plan.events[1].easing = 'bounce';
  assert.match(validateShotPlan(plan).errors.join('\n'), /easing/);
  plan.events[1].easing = 'ramped'; plan.events[1].toTime = 10.03;
  assert.match(validateShotPlan(plan).errors.join('\n'), /0.2s/);
});
