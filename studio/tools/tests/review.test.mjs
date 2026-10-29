// tools/tests/review.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreReview} from '../lib/review.mjs';

const good = {
  scores: {composition: 9, typography: 8, density: 8, motion: 8, distinctiveness: 8, clarity: 9, continuity: 8},
  heroFrame: 8,
  technical: {contract: true, output: true, fonts: true, assets: true, thumbnail: true},
};

test('passes a strong technically correct review', () => {
  const result = scoreReview(good);
  assert.equal(result.passed, true);
  assert(result.total >= 80);
});

test('fails a polished review with one weak dimension', () => {
  const weak = structuredClone(good);
  weak.scores.typography = 5;
  assert.equal(scoreReview(weak).passed, false);
});

test('fails visual excellence with a technical defect', () => {
  const broken = structuredClone(good);
  broken.technical.output = false;
  assert.equal(scoreReview(broken).passed, false);
});
