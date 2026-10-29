// tools/tests/frame-audit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const ffmpeg = (args) => spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], {encoding: 'utf8'});
const audit = (args) => spawnSync('node', ['tools/frame-audit.mjs', ...args], {encoding: 'utf8'});

// 画一张 270×480 的合成帧:box 参数是 x:y:w:h,填白。不用 drawtext(本机 ffmpeg 没编译它)。
const synth = (path, boxes) => {
  const filters = boxes.map(([x, y, w, h]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=white:t=fill`);
  const chain = ['color=c=black:s=270x480', ...filters].join(',');
  const result = ffmpeg(['-f', 'lavfi', '-i', chain, '-frames:v', '1', path]);
  assert.equal(result.status, 0, result.stderr);
};

test('reports empty and dense frames without creative density gates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-audit-'));
  const empty = join(dir, 'end.png');
  const dense = join(dir, 'dense-end.png');
  synth(empty, []);
  synth(dense, [[0, 0, 270, 240]]); // 上半幅填白 → 墨量约 50%

  const emptyRun = audit([empty]);
  assert.equal(emptyRun.status, 0, emptyRun.stdout);
  assert.match(emptyRun.stdout, /墨量 0\.0%/);
  assert.match(emptyRun.stdout, /PASS/);

  const denseRun = audit([dense]);
  assert.equal(denseRun.status, 0, denseRun.stdout);
  assert.match(denseRun.stdout, /PASS/);

  await rm(dir, {recursive: true});
});

test('legacy --min-ink does not reintroduce density enforcement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-audit-'));
  const sparse = join(dir, 'end.png');
  synth(sparse, [[100, 220, 70, 40]]); // 约 2% 墨量,退让镜量级
  assert.equal(audit([sparse]).status, 0);
  assert.equal(audit([sparse, '--min-ink', '1']).status, 0);
  await rm(dir, {recursive: true});
});

test('labels entry and exit frames without density thresholds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-audit-'));
  const start = join(dir, 'start.png');
  const end = join(dir, 'end.png');
  synth(start, [[0, 0, 270, 80]]); // 约 17%:过首帧下限 10%,不过尾帧下限 20%
  synth(end, [[0, 0, 270, 80]]);
  assert.match(audit([start]).stdout, /首帧描述/);
  assert.equal(audit([start]).status, 0);
  assert.equal(audit([end]).status, 0);
  await rm(dir, {recursive: true});
});

test('reports imbalance and emits machine-readable json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-audit-'));
  const lopsided = join(dir, 'end.png');
  synth(lopsided, [[0, 0, 90, 480]]); // 全部墨量堆在左三分之一
  const run = audit([lopsided, '--json']);
  const report = JSON.parse(run.stdout);
  assert.equal(report.frames.length, 1);
  assert.ok(report.frames[0].metrics.balance.leftShare > 0.9);
  assert.ok(report.frames[0].notes.some((note) => note.includes('左右不平衡')));
  await rm(dir, {recursive: true});
});

test('says so when the contract palette carries no parseable hex', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-audit-'));
  const frame = join(dir, 'end.png');
  synth(frame, [[0, 0, 270, 240]]);
  const prose = join(dir, 'prose.json');
  const hex = join(dir, 'hex.json');
  await writeFile(prose, JSON.stringify({density: {occupancyMin: 0.6}, palette: {accent: ['琥珀橙,面积 20–35%']}}));
  await writeFile(hex, JSON.stringify({density: {occupancyMin: 0.6}, palette: {dominant: '#000000', accent: ['#ffffff']}}));
  assert.match(audit([frame, '--contract', prose]).stdout, /没有可解析的 hex/);
  assert.match(audit([frame, '--contract', hex]).stdout, /强调色面积 5[0-9]\.\d%/);
  await rm(dir, {recursive: true});
});

test('rejects bad arguments and missing files', async () => {
  assert.equal(audit([]).status, 2);
  assert.equal(audit(['x.png', '--as', 'middle']).status, 2);
  assert.equal(audit(['/nope/missing.png']).status, 1);
});
