import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as shots from '../lib/aroll-shot-plan.mjs';

const sampleExpression = (segments, amount = 0.06) => {
  assert.equal(typeof shots.buildZoomExpression, 'function');
  const expression = shots.buildZoomExpression(segments).replace(/\bt\b/g, 'T');
  const filter = `nullsrc=s=16x16:r=10:d=8,format=gray,geq=lum='255*((${expression})-1)/${amount}'`;
  const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', filter, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {maxBuffer: 1e6});
  assert.equal(result.status, 0, String(result.stderr));
  return Array.from({length: result.stdout.length / 256}, (_, i) => result.stdout[i * 256]);
};

test('actual FFmpeg curve has steady middle, softened ends, no overshoot and continuous return', () => {
  const pixels = sampleExpression([
    {from: 0, to: 1, zoomFrom: 1, zoomTo: 1},
    {from: 1, to: 5, zoomFrom: 1, zoomTo: 1.06, easing: 'ramped'},
    {from: 5, to: 6, zoomFrom: 1.06, zoomTo: 1.06},
    {from: 6, to: 7, zoomFrom: 1.06, zoomTo: 1, easing: 'ramped'},
    {from: 7, to: 8, zoomFrom: 1, zoomTo: 1},
  ]);
  for (const [i, value] of [[0,0],[10,0],[14,14],[30,127],[46,240],[50,255],[60,255],[65,127],[70,0]]) {
    assert.ok(Math.abs(pixels[i] - value) <= 1, `frame ${i}: ${pixels[i]} vs ${value}`);
  }
  for (let i = 11; i <= 50; i++) assert.ok(pixels[i] >= pixels[i-1]);
  for (let i = 61; i <= 70; i++) assert.ok(pixels[i] <= pixels[i-1]);
  const increments = [20,25,30,35,40].map(i => pixels[i+1] - pixels[i]);
  assert.ok(Math.max(...increments) - Math.min(...increments) <= 1);
});

test('sub-percent moves are preserved rather than rounded to a frozen frame', () => {
  const pixels = sampleExpression([{from:0,to:8,zoomFrom:1,zoomTo:1.004,easing:'ramped'}], 0.004);
  assert.ok(pixels[75] > 245);
});

test('linear opening pull starts immediately and reaches baseline in 0.3 seconds', () => {
 const pixels=sampleExpression([{from:0,to:.3,zoomFrom:1.06,zoomTo:1,easing:'linear'},{from:.3,to:8,zoomFrom:1,zoomTo:1}]);
 assert.ok(Math.abs(pixels[1]-170)<=1,`first step ${pixels[1]}`);
 assert.ok(Math.abs(pixels[2]-85)<=1);
 assert.equal(pixels[3],0);
 const report=shots.validateShotPlan({version:2,duration:8,levels:{A:1,B:1.04,C:1.06},events:[{at:0,to:'C',transition:'cut',purpose:'hook',cue:'开头',reason:'用户指定近景开场'},{from:0,toTime:.3,to:'A',transition:'slow',easing:'linear',purpose:'hook',cue:'开头',reason:'用户指定干脆拉远'}]});
 assert.deepEqual(report.errors,[]);
});
