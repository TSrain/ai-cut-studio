import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildChapterPrompt,
  createDocument,
  hashAssetSources,
  listDocuments,
  loadDocument,
  mapChapterSummary,
  parseSrt,
  saveDocument,
  validateChapters,
  validateDocument,
} from '../lib/editor-store.mjs';

const fps = { num: 30000, den: 1001 };

function root() {
  return mkdtempSync(join(tmpdir(), 'editor-store-'));
}

function document(overrides = {}) {
  return createDocument({
    id: 'demo',
    name: 'Demo',
    canvas: { width: 1920, height: 1080, fps, durationFrames: 300 },
    source: { path: 'media/talk.mp4', startFrame: 0 },
    styleReference: {
      contractPath: 'contracts/visual.json',
      styleframePath: 'styleframes/approved.png',
      allowedOverrides: { accent: '#ff5500' },
    },
    instances: [{
      id: 'intro-number', assetId: 'number-beat', assetVersion: 1,
      startFrame: 20, durationFrames: 60, zIndex: 2,
      props: { value: 42, labelStyle: { color: '#fff' } },
    }],
    ...overrides,
  });
}

test('createDocument builds a validated version 1 document', () => {
  const value = document();
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.revision, 0);
  assert.equal(validateDocument(value), value);
  assert.equal(document({ instances: [{ ...value.instances[0], assetVersion: 'v3' }] }).instances[0].assetVersion, 'v3');
});

test('document allowlist comes from the complete preset catalog', () => {
  const value = document({instances: [{...document().instances[0], assetId: 'title-reveal'}]});
  assert.equal(value.instances[0].assetId, 'title-reveal');
});

test('validateDocument rejects invalid paths, duplicate instances, times and numbers', () => {
  const cases = [
    { source: { path: '../escape.mp4', startFrame: 0 } },
    { instances: [document().instances[0], document().instances[0]] },
    { instances: [{ ...document().instances[0], startFrame: 290, durationFrames: 20 }] },
    { canvas: { width: 1920, height: 1080, fps: { num: 30, den: 0 }, durationFrames: 300 } },
    { instances: [{ ...document().instances[0], props: { value: Infinity } }] },
    { instances: [{ ...document().instances[0], assetId: 'unknown' }] },
  ];
  for (const overrides of cases) {
    assert.throws(() => document(overrides));
  }
});

test('saveDocument writes atomically, increments revision and retains history', () => {
  const rootDir = root();
  const sourceRoot = join(rootDir, 'asset-src');
  mkdirSync(sourceRoot);
  writeFileSync(join(sourceRoot, 'number.mjs'), 'export const version = 1;\n');

  const first = saveDocument(document(), {
    rootDir,
    expectedRevision: 0,
    assetSourcePaths: ['number.mjs'],
    assetSourceRoot: sourceRoot,
  });
  assert.equal(first.revision, 1);
  assert.match(first.assetSourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(loadDocument('demo', { rootDir }), first);

  const second = saveDocument({ ...first, name: 'Renamed' }, {
    rootDir,
    expectedRevision: 1,
    assetSourcePaths: ['number.mjs'],
    assetSourceRoot: sourceRoot,
  });
  assert.equal(second.revision, 2);
  assert.equal(JSON.parse(readFileSync(join(rootDir, 'demo/history/1.json'), 'utf8')).revision, 1);
  assert.deepEqual(listDocuments({ rootDir }), [
    { id: 'demo', name: 'Renamed', revision: 2, assetSourceHash: second.assetSourceHash, updatedAt: statSync(join(rootDir,'demo/document.json')).mtime.toISOString() },
  ]);
});

test('saveDocument enforces optimistic locking and source hash snapshot checks', () => {
  const rootDir = root();
  const sourceRoot = join(rootDir, 'assets');
  mkdirSync(sourceRoot);
  writeFileSync(join(sourceRoot, 'asset.mjs'), 'v1');
  const first = saveDocument(document(), {
    rootDir, expectedRevision: 0, assetSourceRoot: sourceRoot, assetSourcePaths: ['asset.mjs'],
  });
  assert.throws(() => saveDocument(first, { rootDir, expectedRevision: 0 }), /revision conflict/i);
  assert.throws(() => loadDocument('demo', { rootDir, expectedAssetSourceHash: '0'.repeat(64) }), /asset source hash/i);
  writeFileSync(join(sourceRoot, 'asset.mjs'), 'v2');
  assert.throws(() => saveDocument(first, {
    rootDir, expectedRevision: 1, expectedAssetSourceHash: first.assetSourceHash,
    assetSourceRoot: sourceRoot, assetSourcePaths: ['asset.mjs'],
  }), /asset source hash/i);
  assert.throws(() => saveDocument(first, {
    rootDir, expectedRevision: 1, assetSourceRoot: sourceRoot, assetSourcePaths: ['../escape.mjs'],
  }), /path/i);
});

test('saveDocument accepts an identical pre-existing history snapshot and rejects a conflicting one', () => {
  const rootDir = root();
  const first = saveDocument(document(), { rootDir, expectedRevision: 0 });
  const historyDir = join(rootDir, 'demo/history');
  mkdirSync(historyDir);
  writeFileSync(join(historyDir, '1.json'), `${JSON.stringify(first, null, 2)}\n`);
  const second = saveDocument({ ...first, name: 'retry-safe' }, { rootDir, expectedRevision: 1 });
  assert.equal(second.revision, 2);

  writeFileSync(join(historyDir, '2.json'), `${JSON.stringify({ ...second, name: 'conflict' }, null, 2)}\n`);
  assert.throws(
    () => saveDocument({ ...second, name: 'must-not-save' }, { rootDir, expectedRevision: 2 }),
    /history snapshot conflict/i,
  );
  assert.equal(loadDocument('demo', { rootDir }).name, 'retry-safe');
});

test('document ids cannot escape the injected root', () => {
  assert.throws(() => loadDocument('../outside', { rootDir: root() }), /id/i);
  assert.throws(() => createDocument({ id: '/tmp/outside', name: 'x' }), /id/i);
});

test('validateDocument rejects sparse arrays and enumerable non-index array properties', () => {
  const sparse = [];
  sparse[1] = 'value';
  assert.throws(
    () => document({ instances: [{ ...document().instances[0], props: { items: sparse } }] }),
    /dense JSON array/i,
  );

  const decorated = ['value'];
  decorated.extra = true;
  assert.throws(
    () => document({ instances: [{ ...document().instances[0], props: { items: decorated } }] }),
    /array properties/i,
  );
});

test('validateDocument rejects symbol properties and JSON accessors', () => {
  const markedObject = { value: 1 };
  markedObject[Symbol('hidden')] = true;
  assert.throws(
    () => document({ instances: [{ ...document().instances[0], props: { markedObject } }] }),
    /JSON properties/i,
  );

  const markedArray = ['value'];
  markedArray[Symbol('hidden')] = true;
  assert.throws(
    () => document({ instances: [{ ...document().instances[0], props: { markedArray } }] }),
    /array properties/i,
  );

  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  assert.throws(
    () => document({ instances: [{ ...document().instances[0], props: { accessor } }] }),
    /data properties/i,
  );
});

test('document and asset source symlinks cannot escape their injected roots', () => {
  const rootDir = root();
  const outside = root();
  mkdirSync(join(outside, 'linked-doc'));
  writeFileSync(join(outside, 'linked-doc/document.json'), JSON.stringify(document({ id: 'linked' })));
  symlinkSync(join(outside, 'linked-doc'), join(rootDir, 'linked'));
  assert.throws(() => loadDocument('linked', { rootDir }), /root|path/i);

  writeFileSync(join(outside, 'asset.mjs'), 'outside');
  symlinkSync(join(outside, 'asset.mjs'), join(rootDir, 'asset.mjs'));
  assert.throws(() => hashAssetSources(['asset.mjs'], rootDir), /root|path/i);
});

test('parseSrt preserves cue ids, text and real frame timing', () => {
  const cues = parseSrt(`1\n00:00:01,001 --> 00:00:02,002\n第一行\n第二行\n\ncue-b\n00:00:03.003 --> 00:00:04.004\n结尾`, { fps, durationFrames: 300 });
  assert.deepEqual(cues, [
    { id: '1', startFrame: 30, endFrame: 60, text: '第一行\n第二行' },
    { id: 'cue-b', startFrame: 90, endFrame: 120, text: '结尾' },
  ]);
  assert.throws(() => parseSrt('1\n00:00:02,000 --> 00:00:01,000\nbad', { fps, durationFrames: 300 }), /timing/i);
  assert.throws(() => parseSrt('1\n00:00:20,000 --> 00:00:21,000\nlate', { fps, durationFrames: 300 }), /duration/i);
});

test('mapChapterSummary uses source cue boundaries and covers leading/trailing silence', () => {
  const cues = [
    { id: '1', startFrame: 30, endFrame: 70, text: 'a' },
    { id: '2', startFrame: 90, endFrame: 120, text: 'b' },
    { id: '3', startFrame: 180, endFrame: 220, text: 'c' },
  ];
  const chapters = mapChapterSummary([
    { title: '开场', sourceCueIds: ['1', '2'] },
    { title: '结尾', sourceCueIds: ['3'] },
  ], cues, { durationFrames: 300 });
  assert.deepEqual(chapters, [
    { id: 'chapter-1', title: '开场', startFrame: 0, endFrame: 180, sourceCueIds: ['1', '2'] },
    { id: 'chapter-2', title: '结尾', startFrame: 180, endFrame: 300, sourceCueIds: ['3'] },
  ]);
  assert.equal(validateChapters(chapters, { durationFrames: 300, cues }), chapters);
});

test('chapter mapping rejects omitted, repeated and reordered cue sources', () => {
  const cues = ['1', '2', '3'].map((id, index) => ({ id, startFrame: index * 30, endFrame: index * 30 + 20, text: id }));
  for (const summary of [
    [{ title: 'x', sourceCueIds: ['1', '3'] }],
    [{ title: 'x', sourceCueIds: ['1', '2'] }, { title: 'y', sourceCueIds: ['2', '3'] }],
    [{ title: 'x', sourceCueIds: ['2', '1', '3'] }],
  ]) {
    assert.throws(() => mapChapterSummary(summary, cues, { durationFrames: 100 }), /source cue/i);
  }
});

test('validateChapters rejects boundaries that do not come from source cue starts', () => {
  const cues = [
    { id: '1', startFrame: 20, endFrame: 40, text: 'a' },
    { id: '2', startFrame: 80, endFrame: 100, text: 'b' },
  ];
  const chapters = [
    { id: 'chapter-1', title: 'a', startFrame: 0, endFrame: 70, sourceCueIds: ['1'] },
    { id: 'chapter-2', title: 'b', startFrame: 70, endFrame: 120, sourceCueIds: ['2'] },
  ];
  assert.throws(() => validateChapters(chapters, { durationFrames: 120, cues }), /source cue timing/i);
});

test('buildChapterPrompt asks for sourced semantic JSON with every cue', () => {
  const prompt = buildChapterPrompt([
    { id: '1', startFrame: 0, endFrame: 30, text: '你好' },
  ], { fps: { num: 30, den: 1 }, durationFrames: 60 });
  assert.match(prompt, /sourceCueIds/);
  assert.match(prompt, /"id":"1"/);
  assert.match(prompt, /不要遗漏/);
});

test('manual chapters may have no cue ids but sourced summaries still require them', () => {
  const manual = [{id:'manual',title:'自定章节',startFrame:0,endFrame:120,sourceCueIds:[]}];
  assert.equal(validateChapters(manual,{durationFrames:120}),manual);
  assert.throws(()=>validateChapters(manual,{durationFrames:120,cues:[{id:'1',startFrame:0,endFrame:120,text:'字幕'}]}));
});

 test('project listing uses most recent save, not ID, and opening does not reorder it',()=>{
  const rootDir=root();
  for(const id of ['a-old','z-new']){mkdirSync(join(rootDir,id));writeFileSync(join(rootDir,id,'document.json'),JSON.stringify(document({id})));}
  utimesSync(join(rootDir,'a-old/document.json'),new Date('2026-10-09T10:00:00Z'),new Date('2026-10-09T10:00:00Z'));
  utimesSync(join(rootDir,'z-new/document.json'),new Date('2026-10-10T10:00:00Z'),new Date('2026-10-10T10:00:00Z'));
  assert.deepEqual(listDocuments({rootDir}).map(d=>d.id),['z-new','a-old']);
  loadDocument('a-old',{rootDir});
  assert.deepEqual(listDocuments({rootDir}).map(d=>d.id),['z-new','a-old']);
 });
