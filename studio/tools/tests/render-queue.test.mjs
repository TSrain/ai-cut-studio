// tools/tests/render-queue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

test('runs command arrays with a maximum concurrency of two', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'render-queue-'));
  const worker = join(dir, 'worker.mjs');
  await writeFile(worker, `
    import {appendFile, writeFile} from 'node:fs/promises';
    const [log,out,id] = process.argv.slice(2);
    await appendFile(log, 'start '+id+' '+Date.now()+'\\n');
    await new Promise(r => setTimeout(r, 150));
    await writeFile(out, id);
    await appendFile(log, 'end '+id+' '+Date.now()+'\\n');
  `);
  const log = join(dir, 'events.log');
  const queue = [0, 1, 2].map((id) => ({
    id: `q${id}`,
    cwd: dir,
    command: ['node', worker, log, join(dir, `out${id}`), String(id)],
    expectedOutput: join(dir, `out${id}`),
  }));
  const queuePath = join(dir, 'queue.json');
  await writeFile(queuePath, JSON.stringify(queue));
  const child = spawn('node', ['tools/render-queue.mjs', queuePath, '--concurrency', '2']);
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  const lines = (await readFile(log, 'utf8')).trim().split('\n');
  assert.equal(lines.filter((line) => line.startsWith('start')).length, 3);
  assert.equal(lines.filter((line) => line.startsWith('end')).length, 3);
  assert(lines.findIndex((line) => line.startsWith('end')) < 3, 'third item must wait until a slot finishes');
  await rm(dir, {recursive: true});
});

test('log is visible while a worker waits for release, and flushed before results', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'render-queue-live-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const worker = join(dir, 'worker.mjs');
  const release = join(dir, 'release');
  const output = join(dir, 'output');
  await writeFile(worker, `
    import {access, writeFile} from 'node:fs/promises';
    console.log('Rendered 1/10');
    while (!(await access(process.argv[2]).then(() => true, () => false))) {
      await new Promise(r => setTimeout(r, 20));
    }
    console.error('Encoded 10/10');
    await writeFile(process.argv[3], 'done');
  `);
  const queuePath = join(dir, 'queue.json');
  await writeFile(queuePath, JSON.stringify([{id:'live', cwd:dir, command:[process.execPath,worker,release,output], expectedOutput:output}]));
  const child = spawn(process.execPath, ['tools/render-queue.mjs', queuePath]);
  const done = new Promise(resolve => child.once('close', resolve));
  let contents = '';
  const deadline = Date.now() + 10000;
  try {
    while (Date.now() < deadline) {
      contents = await readFile(join(dir, 'queue.logs/live.log'), 'utf8').catch(() => '');
      if (contents.includes('Rendered 1/10')) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.match(contents, /Rendered 1\/10/);
    assert.equal(child.exitCode, null);
  } finally {
    await writeFile(release, 'release');
    await done;
  }
  assert.equal(child.exitCode, 0);
  assert.match(await readFile(join(dir, 'queue.logs/live.log'), 'utf8'), /Encoded 10\/10/);
});
