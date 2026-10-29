import test from 'node:test';
import assert from 'node:assert/strict';
import {previewFrame, buildJobs} from '../preset-preview.mjs';
import {sheetLayout} from '../lib/contact-sheet.mjs';
import {assertPreviewConfirmed} from '../render-queue.mjs';
import {mkdtemp, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('preview frame lands at 0.4 of the shot and never past the last frame', () => {
  assert.equal(previewFrame(3, 30), 36); // 0.4 × 3s × 30fps
  assert.equal(previewFrame(3.5, 30), 42);
  assert.equal(previewFrame(2, 30, 0.5), 30);
  // 0.99 时刻不许越过末帧(remotion still 会直接报错)
  assert.equal(previewFrame(2, 30, 0.99), 59);
  assert.equal(previewFrame(1, 30), 12);
});

test('contact sheet stays near-square instead of one long strip', () => {
  const portrait = {tileW: 260, tileH: 462};
  assert.equal(sheetLayout(1, portrait).columns, 1);
  assert.equal(sheetLayout(5, portrait).columns, 3);
  assert.equal(sheetLayout(12, portrait).columns, 5);
  assert.equal(sheetLayout(40, portrait).columns, 6); // maxColumns 封顶

  const l = sheetLayout(5, portrait);
  assert.equal(l.rows, 2);
  assert.equal(l.cells.length, 5);
  assert.equal(l.cells[0].x, 16);
  assert.equal(l.cells[3].y, 16 + 462 + 16); // 第 4 格换行
  assert.equal(l.width, 16 + 3 * (260 + 16));
});

test('render queue refuses to start until the preview sheet is confirmed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preset-preview-'));
  const path = join(dir, 'preview-manifest.json');

  await writeFile(path, JSON.stringify({status: 'pending', sheet: 'contact-sheet.png'}));
  await assert.rejects(() => assertPreviewConfirmed(path), /预览未确认/);

  await writeFile(path, JSON.stringify({status: 'confirmed', confirmedAt: '2026-08-11T00:00:00Z', decision: 'ok'}));
  const manifest = await assertPreviewConfirmed(path);
  assert.equal(manifest.decision, 'ok');

  await assert.rejects(() => assertPreviewConfirmed(join(dir, 'nope.json')), /读不到预览清单/);
});


test('preview refuses stale props from a different composition', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stale-preset-props-'));
  await mkdir(join(dir, 'shots', 'shot-001'), {recursive:true});
  await writeFile(join(dir, 'shots', 'shot-001', 'props.json'), JSON.stringify({presetId:'recede', presetVersion:2, compositionId:'WrongComposition', durationSeconds:3}));
  await assert.rejects(() => buildJobs(dir, {canvas:{fps:30},shots:[{id:'shot-001',preset:{id:'recede',version:2}}]}, {time:0.4}), /preset identity mismatch/);
});
