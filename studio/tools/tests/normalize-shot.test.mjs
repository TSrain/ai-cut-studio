// tools/tests/normalize-shot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, {encoding: 'utf8'});

test('normalizes two mismatched clips and concatenates them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-normalize-'));
  const a = join(dir, 'a.mp4');
  const b = join(dir, 'b.mp4');
  const na = join(dir, 'na.mp4');
  const nb = join(dir, 'nb.mp4');
  const final = join(dir, 'final.mp4');
  assert.equal(run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=1', '-r', '24', a]).status, 0);
  assert.equal(run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=720x1280:d=1', '-r', '30', b]).status, 0);
  assert.equal(run('tools/normalize-shot.sh', [a, na, '1080', '1920', '30', 'none']).status, 0);
  assert.equal(run('tools/normalize-shot.sh', [b, nb, '1080', '1920', '30', 'none']).status, 0);
  assert.equal(run('tools/concat-shots.sh', [final, na, nb]).status, 0);
  const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt,r_frame_rate', '-of', 'json', final]);
  const stream = JSON.parse(probe.stdout).streams[0];
  assert.deepEqual(stream, {width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30/1'});
  await rm(dir, {recursive: true});
});

test('already-compliant clip takes the stream-copy path and still concats with an encoded one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-normalize-copy-'));
  const compliant = join(dir, 'compliant.mp4');
  const odd = join(dir, 'odd.mp4');
  const nc = join(dir, 'nc.mp4');
  const no = join(dir, 'no.mp4');
  const final = join(dir, 'final.mp4');
  // 合规输入:h264 / yuv420p / 1080x1920 / 30fps —— Remotion 按合同渲出来就是这个样子
  assert.equal(
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=1080x1920:d=1', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', compliant]).status,
    0,
  );
  assert.equal(run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=1', '-r', '24', odd]).status, 0);
  const copyRun = run('tools/normalize-shot.sh', [compliant, nc, '1080', '1920', '30', 'none']);
  assert.equal(copyRun.status, 0);
  assert.match(copyRun.stdout, /stream copy/, '合规输入必须走免转码路径');
  const encodeRun = run('tools/normalize-shot.sh', [odd, no, '1080', '1920', '30', 'none']);
  assert.equal(encodeRun.status, 0);
  assert.doesNotMatch(encodeRun.stdout, /stream copy/, '不合规输入必须走转码路径');
  assert.equal(run('tools/concat-shots.sh', [final, nc, no]).status, 0);
  const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt,r_frame_rate', '-of', 'json', final]);
  const stream = JSON.parse(probe.stdout).streams[0];
  assert.deepEqual(stream, {width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30/1'});
  await rm(dir, {recursive: true});
});
