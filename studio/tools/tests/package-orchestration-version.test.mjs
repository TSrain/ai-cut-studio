import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {createDocument, saveDocument} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
import {finalizeAnimationReceipt, verifyCompletePackageReceipt} from '../lib/animation-package-receipt.mjs';

const retired = 'packageOrchestrationVersion=1 已下线（见 git tag v1-final），请新建 v2 package 任务';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'package-version-'));
  mkdirSync(join(root, 'templates/remotion-base/public'), {recursive: true});
  const workerPath = join(root, 'worker.mjs');
  writeFileSync(workerPath, 'process.exit(0);');
  const options = {root, rootDir: join(root, 'index'), artifactRoot: join(root, 'artifacts'), assetSourceRoot: root, autoStart: false, contentRoot: root, workerPath, python: process.execPath};
  saveDocument(createDocument({id: 'p', name: 'P', canvas: {width: 320, height: 180, fps: {num: 30, den: 1}, durationFrames: 300}}), options);
  const service = createProductionPlanService(options);
  t.after(() => service.close());
  const request = extra => ({kind: 'package', projectId: 'p', revision: service.read('p').document.revision, ...extra});
  return {service, request};
}
async function storedJob(f, version, status = 'failed') {
  const {job} = await f.service.createJob(f.request({packageOrchestrationVersion: 2}));
  const snapshot = JSON.parse(readFileSync(job.snapshotPath));
  if (version === undefined) delete snapshot.packageOrchestrationVersion;
  else snapshot.packageOrchestrationVersion = version;
  writeFileSync(job.snapshotPath, JSON.stringify(snapshot));
  const saved = {...job, status, packageOrchestrationVersion: version, snapshotHash: createHash('sha256').update(readFileSync(job.snapshotPath)).digest('hex')};
  writeFileSync(join(dirname(job.snapshotPath), 'job.json'), JSON.stringify(saved));
  return saved;
}
test('unversioned package freezes v2 and all v2 setup, including explicit execution options', async t => {
  const f = fixture(t);
  for (const execution of [undefined, {streamingApply: true, reusePolicy: 'same-run'}]) {
    const {job} = await f.service.createJob(f.request(execution ? {packageExecution: execution} : {}));
    const snapshot = JSON.parse(readFileSync(job.snapshotPath));
    assert.equal(job.packageOrchestrationVersion, 2);
    assert.equal(snapshot.packageOrchestrationVersion, 2);
    assert.equal(snapshot.bgmExecutionVersion, 1);
    assert.equal(job.bgmExecutionVersion, 1);
    assert.equal(snapshot.editReconciliationVersion, 1);
    assert.deepEqual(snapshot.packageExecution, execution ?? {streamingApply: true, reusePolicy: 'same-run'});
    assert.deepEqual(job.packageExecution, snapshot.packageExecution);
  }
});
test('new explicit v1 package rejects with retirement message before changing project or jobs', async t => {
  const f = fixture(t), before = f.service.read('p');
  await assert.rejects(f.service.createJob(f.request({packageOrchestrationVersion: 1})), {message: retired});
  assert.deepEqual(f.service.read('p'), before);
});
test('stored v1 and unversioned packages remain readable and listable without rewriting snapshots', async t => {
  const f = fixture(t);
  for (const version of [1, undefined]) {
    const job = await storedJob(f, version), bytes = readFileSync(job.snapshotPath, 'utf8');
    assert.equal(f.service.getJob(job.id).packageOrchestrationVersion, version);
    assert.ok(f.service.jobs('p').some(j => j.id === job.id));
    assert.ok(f.service.read('p').jobs.some(j => j.id === job.id));
    assert.equal(readFileSync(job.snapshotPath, 'utf8'), bytes);
  }
});
test('stored v1 cannot resume, retry, or ingest even when request claims v2', async t => {
  const f = fixture(t), job = await storedJob(f, 1), before = f.service.read('p');
  for (const version of [undefined, 2]) {
    await assert.rejects(f.service.createJob(f.request({resumeJobId: job.id, ...(version === undefined ? {} : {packageOrchestrationVersion: version})})), {message: retired});
  }
  await assert.rejects(f.service.retry(job.id), {message: retired});
  await assert.rejects(f.service.ingest({projectId: 'p', jobId: job.id, results: [], status: 'complete'}), {message: retired});
  assert.deepEqual(f.service.read('p'), before);
});
test('queued stored v1 fails before starting a worker', async t => {
  const f = fixture(t), job = await storedJob(f, 1, 'queued');
  await f.service.pump();
  const saved = f.service.getJob(job.id);
  assert.equal(saved.status, 'failed');
  assert.equal(saved.error, retired);
  assert.equal(saved.pid, null);
});
test('unversioned stored package can ingest and resume as v2 without rewriting original snapshot', async t => {
  const f = fixture(t), job = await storedJob(f, undefined), bytes = readFileSync(job.snapshotPath, 'utf8');
  await f.service.ingest({projectId: 'p', jobId: job.id, results: [], status: 'failed'});
  const next = await f.service.retry(job.id);
  assert.equal(JSON.parse(readFileSync(next.job.snapshotPath)).packageOrchestrationVersion, 2);
  assert.equal(readFileSync(job.snapshotPath, 'utf8'), bytes);
});
test('package receipts reject explicit v1 in manifest or frozen snapshot', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'package-version-receipt-'));
  const job = {id: 'j', kind: 'package', projectId: 'p', outputDir};
  const manifest = {workflowMode: 'semantic-template-v1', fullPackageVersion: 1, outputs: {}, files: []};
  for (const verify of [finalizeAnimationReceipt, verifyCompletePackageReceipt]) {
    assert.throws(() => verify(job, {id: 'p'}, {...manifest, packageOrchestrationVersion: 1}), {message: retired});
    const snapshotPath = join(outputDir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify({kind: 'package', packageOrchestrationVersion: 1}));
    const snapshotHash = createHash('sha256').update(readFileSync(snapshotPath)).digest('hex');
    assert.throws(() => verify({...job, snapshotPath, snapshotHash}, {id: 'p'}, {...manifest, packageOrchestrationVersion: 2}), {message: retired});
  }
});
