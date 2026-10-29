import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readExportProgress} from '../lib/editor-export-progress.mjs';

const fixture = async (t, text) => {
  const dir = await mkdtemp(join(tmpdir(), 'export-progress-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const path = join(dir, 'item.log');
  await writeFile(path, text);
  return path;
};
const clock = {startedAt:1000, now:11000, durationFrames:100};
test('CLI stages and carriage returns use the latest complete observation', async t => {
  const path = await fixture(t, '\x1b[32mBundling 50%\x1b[0m\rRendered 20/100\rRendered 35/100\rEncoded 10/100\nEXPORT_PROGRESS {"stage":');
  const result = await readExportProgress(path, clock);
  assert.deepEqual(result, {stage:'encoding', progress:0.1,completed:10,total:100,elapsedSeconds:10});
});
test('missing logs are preparing and missing start means queued without stale progress', async t => {
  const path = await fixture(t, 'Rendered 100/100\n');
  assert.deepEqual(await readExportProgress(path, {now:11000}), {stage:'queued',elapsedSeconds:0});
  assert.deepEqual(await readExportProgress(path + '-missing', clock), {stage:'preparing',elapsedSeconds:10});
});
test('worker completion is verification, not verified success; counts are stage local', async t => {
  const path = await fixture(t, 'EXPORT_PROGRESS {"stage":"rendering","completed":100,"total":100}\nEXPORT_PROGRESS {"stage":"complete"}\n');
  assert.deepEqual(await readExportProgress(path, clock), {stage:'verifying',elapsedSeconds:10});
});
test('timestamped counters yield a measured stage ETA and discard pre-retry events', async t => {
  const path = await fixture(t, [
    {stage:'rendering',completed:95,total:100,timestamp:500},
    {stage:'rendering',completed:10,total:100,timestamp:2000},
    {stage:'rendering',completed:50,total:100,timestamp:10000},
  ].map(e => 'EXPORT_PROGRESS '+JSON.stringify(e)+'\n').join(''));
  const result = await readExportProgress(path, clock);
  assert.equal(result.progress, 0.5);
  assert.equal(result.etaSeconds, 10);
  assert.equal((await readExportProgress(path, {...clock,startedAt:10500})).stage,'preparing');
});
test('parallel item files are independent and percentages cannot report global completion', async t => {
  const a = await fixture(t, 'Bundling 40%\n');
  const b = await fixture(t, 'Rendered 100/100\n');
  const [one,two] = await Promise.all([readExportProgress(a,clock),readExportProgress(b,clock)]);
  assert.equal(one.stage,'bundling');
  assert.equal(one.progress,0.4);
  assert.equal(two.stage,'rendering');
  assert.equal(two.progress,1);
  assert.equal(two.etaSeconds,undefined);
});

test('worker planning detail survives log polling',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'export-detail-'));try{
  const log=join(root,'progress.log'),startedAt=Date.now()-200;
  await writeFile(log,'EXPORT_PROGRESS '+JSON.stringify({stage:'preparing',detail:'复杂区间 1/3',timestamp:Date.now()})+'\n');
  assert.equal((await readExportProgress(log,{startedAt})).detail,'复杂区间 1/3');
 }finally{await rm(root,{recursive:true,force:true});}
});
