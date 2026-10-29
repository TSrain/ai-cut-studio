// tools/tests/knowledge-router.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {routeKnowledge} from '../lib/knowledge-router.mjs';

const entries = [
  {id: 'core', resource: 'docs/visual-first.md', engines: ['both'], tags: ['core'], priority: 100, always: true},
  {id: 'remotion-chart', resource: 'docs/design-principles.md', engines: ['remotion'], tags: ['data', 'chart'], priority: 80, always: false},
  {id: 'hf-shader', resource: 'skill:hyperframes-animation', engines: ['hyperframes'], tags: ['shader', '3d'], priority: 90, always: false},
  {id: 'generic-data', resource: 'docs/color.md', engines: ['both'], tags: ['data'], priority: 40, always: false},
];

test('always includes core and routes by engine/tag', () => {
  const result = routeKnowledge(entries, {engine: 'hyperframes', tags: ['shader'], maxDynamic: 4});
  assert.deepEqual(result.map((x) => x.id), ['core', 'hf-shader']);
});

test('never returns more than four dynamic resources', () => {
  const many = Array.from({length: 8}, (_, i) => ({id: `x${i}`, resource: `x${i}`, engines: ['both'], tags: ['ui'], priority: i, always: false}));
  const result = routeKnowledge([...entries.slice(0, 1), ...many], {engine: 'remotion', tags: ['ui'], maxDynamic: 4});
  assert.equal(result.length, 5);
  assert.deepEqual(result.slice(1).map((x) => x.id), ['x7', 'x6', 'x5', 'x4']);
});

test('requiredTags gate: entry routes only when shot tags contain ALL of them', () => {
  const captions = {id: 'captions', resource: 'skill:captions', engines: ['remotion'], tags: ['caption', 'type'], requiredTags: ['caption'], priority: 95, always: false};
  // type 标签重合但没有 caption → 不路由(这就是「字幕 skill 被塞进无字幕镜头」的修复)
  const without = routeKnowledge([...entries.slice(0, 1), captions], {engine: 'remotion', tags: ['type'], maxDynamic: 4});
  assert.deepEqual(without.map((x) => x.id), ['core']);
  const withCaption = routeKnowledge([...entries.slice(0, 1), captions], {engine: 'remotion', tags: ['caption'], maxDynamic: 4});
  assert.deepEqual(withCaption.map((x) => x.id), ['core', 'captions']);
});

test('token budget packs by priority and skips oversized entries instead of truncating', () => {
  const budgeted = [
    entries[0],
    {id: 'big', resource: 'big', engines: ['both'], tags: ['ui'], priority: 90, always: false, estimatedTokens: 5000},
    {id: 'huge', resource: 'huge', engines: ['both'], tags: ['ui'], priority: 80, always: false, estimatedTokens: 6000},
    {id: 'small', resource: 'small', engines: ['both'], tags: ['ui'], priority: 70, always: false, estimatedTokens: 1000},
  ];
  // 预算 6500:big(5000)装入 → huge(6000)装不下被跳过 → small(1000)仍装入
  const result = routeKnowledge(budgeted, {engine: 'remotion', tags: ['ui'], maxDynamic: 4, maxContextTokens: 6500});
  assert.deepEqual(result.map((x) => x.id), ['core', 'big', 'small']);
});

// 风格卡按标签路由,一个 layout,brand,type 的镜会同时匹配 brand-energy 和 visual-max,
// 两份卡的密度/留白阈值不同,worker 会拿到互相打架的两套数字。exclusiveKinds 保证最多一条。
const profiles = [
  {id: 'core', resource: 'docs/visual-first.md', engines: ['both'], tags: ['core'], priority: 100, always: true},
  {id: 'p-brand', kind: 'profile', resource: 'docs/styles/brand-energy.md', engines: ['both'], tags: ['brand'], priority: 85, always: false, estimatedTokens: 1100},
  {id: 'p-max', kind: 'profile', resource: 'docs/styles/visual-max.md', engines: ['both'], tags: ['layout'], priority: 85, always: false, estimatedTokens: 1300},
  {id: 'r-type', kind: 'rule', resource: 'docs/typography.md', engines: ['both'], tags: ['type'], priority: 87, always: false, estimatedTokens: 900},
];

test('exclusiveKinds keeps at most one profile, highest priority wins', () => {
  const result = routeKnowledge(profiles, {
    engine: 'remotion', tags: ['brand', 'layout', 'type'], maxDynamic: 4, exclusiveKinds: ['profile'],
  });
  assert.deepEqual(result.map((x) => x.id), ['core', 'r-type', 'p-brand']);
});

test('exclusiveKinds defaults to off so existing manifests are unaffected', () => {
  const result = routeKnowledge(profiles, {engine: 'remotion', tags: ['brand', 'layout', 'type'], maxDynamic: 4});
  assert.deepEqual(result.map((x) => x.id), ['core', 'r-type', 'p-brand', 'p-max']);
});
