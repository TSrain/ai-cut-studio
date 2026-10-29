import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require = createRequire(new URL('../../templates/remotion-base/package.json', import.meta.url));
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = await readFile(new URL('../editor/ExportProgress.tsx', import.meta.url),'utf8');
const code = require('esbuild').transformSync(source, {loader:'tsx',format:'cjs'}).code;
const module = {exports:{}};
new Function('require','module','exports',code)(require,module,module.exports);
const render = item => renderToStaticMarkup(React.createElement(module.exports.ExportProgress,{item}));
test('queued retry hides stale telemetry and has indeterminate progress', () => {
  const html = render({status:'queued', telemetry:{stage:'rendering',progress:0.9,elapsedSeconds:10,etaSeconds:2}});
  assert.match(html,/排队中/);
  assert.doesNotMatch(html,/value=|90%|预计/);
});
test('running bar names its stage and displays measured counters and ETA', () => {
  const html = render({status:'rendering',telemetry:{stage:'rendering',progress:0.5,completed:50,total:100,elapsedSeconds:12,etaSeconds:10}});
  assert.match(html,/渲染画面/);
  assert.match(html,/50\/100 帧/);
  assert.match(html,/预计本阶段剩余 10 秒/);
  assert.match(html,/value="0.5"/);
});
test('unverified worker complete remains indeterminate verification', () => {
  const html = render({status:'rendering',telemetry:{stage:'complete',progress:1,elapsedSeconds:12}});
  assert.match(html,/校验文件/);
  assert.doesNotMatch(html,/value=|· 100%/);
});
test('legacy server frame progress remains visible during a rolling update', () => {
  const html=render({status:'rendering',progress:0.67,durationFrames:7191});
  assert.match(html,/渲染画面/);
  assert.match(html,/67%/);
  assert.match(html,/value="0.67"/);
});

test('planning detail is visible without inventing a percentage or ETA',()=>{
 const html=render({status:'rendering',telemetry:{stage:'preparing',detail:'复杂区间 2/4 · 复用视觉缓存',elapsedSeconds:2}});
 assert.match(html,/复杂区间 2\/4 · 复用视觉缓存/);assert.doesNotMatch(html,/value=|预计/);
});
