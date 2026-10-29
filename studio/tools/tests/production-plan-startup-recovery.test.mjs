import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import {setImmediate as nextTurn, setTimeout as delay} from 'node:timers/promises';
import {createDocument, saveDocument, loadDocument} from '../lib/editor-store.mjs';
import {createProductionPlanService} from '../lib/production-plan-jobs.mjs';
import {productionPlanService} from '../lib/production-plan-api.mjs';

async function fixture(kind = 'package') {
  const root = fs.mkdtempSync(join(tmpdir(), 'plan-startup-recovery-'));
  const options = {
    root, rootDir: join(root, 'index'), artifactRoot: join(root, 'artifacts'),
    assetSourceRoot: root, autoStart: false,
  };
  fs.mkdirSync(join(root, 'templates/remotion-base/public'), {recursive: true});
  const document = saveDocument(createDocument({
    id: 'p', name: 'Manual project',
    canvas: {width: 1280, height: 720, fps: {num: 30, den: 1}, durationFrames: 300},
    productionPlan: {shots: [{id: 's', title: 'Keep manual timing', timing: {
      manual: true, status: 'manual', ranges: [{id: 'r', startFrame: 30, durationFrames: 60}],
    }}]},
  }), options);
  const service = createProductionPlanService(options);
  const {job} = await service.createJob({
    projectId: 'p', revision: document.revision, kind,
    ...(kind === 'broll' ? {scope: {footage: false}} : {}),
    ...(kind === 'revise' ? {shotId: 's', instructions: 'Keep manual timing'} : {}),
  });
  service.close();
  const jobPath = join(dirname(job.snapshotPath), 'job.json');
  function updateJob(patch) {
    const stored = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    fs.writeFileSync(jobPath, JSON.stringify({...stored, ...patch}));
  }
  return {options, job, jobPath, updateJob};
}

function observeOutputReads(outputDir) {
  const calls = [], originals = new Map();
  for (const name of ['existsSync', 'readdirSync', 'readFileSync']) {
    const original = fs[name];
    originals.set(name, original);
    fs[name] = function(path, ...args) {
      if (typeof path === 'string' &&
          (resolve(path) === outputDir || resolve(path).startsWith(outputDir + sep))) {
        calls.push({name, path});
      }
      return original.call(this, path, ...args);
    };
  }
  syncBuiltinESMExports();
  return {calls, restore() {
    for (const [name, original] of originals) fs[name] = original;
    syncBuiltinESMExports();
  }};
}

for (const [kind, status] of [['package', 'complete'], ['broll', 'partial'], ['revise', 'plan_only']]) {
  test(`startup can skip historical ${kind}/${status}, while explicit recovery still scans it`, async () => {
    const x = await fixture(kind);
    x.updateJob({status, stage: 'Saved historical state'});
    fs.writeFileSync(join(x.job.outputDir, 'manifest.json'), JSON.stringify({state: status}));
    fs.writeFileSync(join(x.job.outputDir, 'status.json'), JSON.stringify({state: status, stage: 'Recovered history'}));
    const beforeJob = fs.readFileSync(x.jobPath, 'utf8');
    const beforeDocument = loadDocument('p', x.options);
    const observation = observeOutputReads(x.job.outputDir);
    const service = createProductionPlanService({...x.options, autoStart: true, recoverCompleted: false});
    try {
      await nextTurn();
      assert.deepEqual(observation.calls, [], 'startup must not touch historical output, including cloud placeholders');
      assert.equal(fs.readFileSync(x.jobPath, 'utf8'), beforeJob);
      assert.deepEqual(loadDocument('p', x.options), beforeDocument);
      await service.recover();
      assert.ok(observation.calls.some(call => call.name === 'readFileSync'));
      assert.equal(service.getJob(x.job.id).stage, 'Recovered history');
      assert.deepEqual(loadDocument('p', x.options), beforeDocument);
    } finally {
      service.close();
      observation.restore();
    }
  });
}

test('API service skips completed history by default on startup', async () => {
  const x = await fixture();
  x.updateJob({status: 'complete'});
  fs.writeFileSync(join(x.job.outputDir, 'manifest.json'), JSON.stringify({state: 'complete'}));
  const observation = observeOutputReads(x.job.outputDir);
  const service = productionPlanService({...x.options, autoStart: true});
  try {
    await nextTurn();
    assert.deepEqual(observation.calls, []);
  } finally {
    service.close();
    observation.restore();
  }
});

async function eventually(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('recovery did not reach the expected state');
}

test('skipping history still adopts and polls an existing live worker', async () => {
  const x = await fixture();
  x.updateJob({status: 'running', pid: process.pid, ownerPid: 99999999});
  fs.writeFileSync(join(x.job.outputDir, 'status.json'), JSON.stringify({state: 'running', stage: 'Existing worker'}));
  const service = createProductionPlanService({...x.options, autoStart: true, recoverCompleted: false, pollMs: 10});
  try {
    await eventually(() => service.getJob(x.job.id).stage === 'Existing worker');
    assert.equal(service.getJob(x.job.id).pid, process.pid);
    fs.writeFileSync(join(x.job.outputDir, 'status.json'), JSON.stringify({state: 'complete', stage: 'Existing worker finished'}));
    await eventually(() => service.getJob(x.job.id).stage === 'Existing worker finished');
    assert.equal(service.getJob(x.job.id).status, 'complete');
    assert.equal(service.getJob(x.job.id).pid, process.pid);
  } finally { service.close(); }
});

test('skipping history still recovers an interrupted active job', async () => {
  const x = await fixture();
  x.updateJob({status: 'running', pid: 99999999});
  const service = createProductionPlanService({...x.options, autoStart: true, recoverCompleted: false});
  try {
    await eventually(() => service.getJob(x.job.id).status === 'interrupted');
    assert.equal(service.getJob(x.job.id).pid, null);
  } finally { service.close(); }
});

test('skipping history still launches a queued job', async () => {
  const x = await fixture();
  const workerPath = join(x.options.root, 'worker.cjs');
  fs.writeFileSync(workerPath, `const fs = require('node:fs');
const path = require('node:path');
const output = process.argv[process.argv.indexOf('--output-dir') + 1];
fs.writeFileSync(path.join(output, 'status.json'), JSON.stringify({state: 'complete', stage: 'Queued worker finished'}));\n`);
  const service = createProductionPlanService({
    ...x.options, autoStart: true, recoverCompleted: false,
    python: process.execPath, workerPath, contentRoot: x.options.root, pollMs: 10,
  });
  try {
    await eventually(() => service.getJob(x.job.id).status === 'complete');
    assert.equal(service.getJob(x.job.id).stage, 'Queued worker finished');
  } finally { service.close(); }
});
