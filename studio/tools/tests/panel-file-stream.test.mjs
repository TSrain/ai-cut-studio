import assert from 'node:assert/strict';
import {mkdtempSync, openSync, closeSync, ftruncateSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, request} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';

import {pipePanelFile} from '../lib/panel-file-stream.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'panel-stream-'));
  const file = join(dir, 'large.mp4');
  const fd = openSync(file, 'w');
  ftruncateSync(fd, 64 * 1024 * 1024);
  closeSync(fd);
  const smallFile = join(dir, 'small.mp4');
  const smallBody = Buffer.from('a small complete media response');
  writeFileSync(smallFile, smallBody);
  const streams = [];
  const server = createServer((req, res) => {
    const range = req.headers.range;
    const size = req.url === '/small' ? smallBody.length : 64 * 1024 * 1024;
    const [start, end] = range ? range.slice(6).split('-') : [];
    const options = range ? {start: Number(start), end: end ? Number(end) : size - 1} : undefined;
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': options ? options.end - options.start + 1 : size,
      'Accept-Ranges': 'bytes',
      ...(options ? {'Content-Range': `bytes ${options.start}-${options.end}/${size}`} : {}),
    });
    const stream = pipePanelFile(req, res, req.url === '/missing' ? join(dir, 'missing') : req.url === '/small' ? smallFile : file, options);
    if (stream) streams.push(stream);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const stream of streams) stream.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, {recursive: true, force: true});
  });
  return {server, streams, smallBody, port: server.address().port};
}

function get(port, {method = 'GET', headers = {}, path = '/', abort = false} = {}) {
  return new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path, method, headers, agent: false}, res => {
      const chunks = [];
      res.on('error', reject);
      res.on('data', chunk => {
        if (abort) {
          res.destroy();
          resolve();
        } else chunks.push(chunk);
      });
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitClosed(streams) {
  const deadline = Date.now() + 1500;
  while (streams.some(stream => !stream.closed) && Date.now() < deadline) await delay(10);
}

test('repeated aborted video requests release every source file', async t => {
  const {port, streams} = await fixture(t);
  for (let i = 0; i < 32; i++) {
    await get(port, {abort: true, headers: i % 2 ? {Range: 'bytes=1048576-'} : {}});
  }
  await waitClosed(streams);
  assert.equal(streams.length, 32);
  assert.equal(streams.filter(stream => !stream.closed).length, 0, 'aborted requests must not leave paused file streams open');
});

test('range response preserves status, headers and requested bytes', async t => {
  const {port, streams} = await fixture(t);
  const response = await get(port, {headers: {Range: 'bytes=17-48'}});
  assert.equal(response.status, 206);
  assert.equal(response.headers['content-range'], 'bytes 17-48/67108864');
  assert.equal(response.body.length, 32);
  assert.deepEqual(response.body, Buffer.alloc(32));
  await waitClosed(streams);
  assert.ok(streams.every(stream => stream.closed));
});

test('HEAD sends headers without opening or reading a media stream', async t => {
  const {port, streams} = await fixture(t);
  const response = await get(port, {method: 'HEAD'});
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-length'], '67108864');
  assert.equal(response.body.length, 0);
  assert.equal(streams.length, 0);
});

test('missing file terminates the request without an uncaught stream error', async t => {
  const {port, streams} = await fixture(t);
  await assert.rejects(get(port, {path: '/missing'}), /socket hang up|aborted|reset/i);
  await waitClosed(streams);
  assert.ok(streams.every(stream => stream.closed));
});

test('full response preserves its bytes and closes the source', async t => {
  const {port, streams, smallBody} = await fixture(t);
  const response = await get(port, {path: '/small'});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, smallBody);
  await waitClosed(streams);
  assert.ok(streams.every(stream => stream.closed));
});
