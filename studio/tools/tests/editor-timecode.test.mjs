import test from 'node:test';import assert from 'node:assert/strict';
const m=await import('../editor/timecode.mjs').catch(()=>({}));
test('输入时间码支持秒与分秒帧，拒绝非法帧',()=>{assert.equal(typeof m.parseTimecode,'function');assert.equal(m.parseTimecode('01:02:15',30),1875);assert.equal(m.parseTimecode('12.5',30),375);assert.equal(m.parseTimecode('1:02',30),1860);assert.equal(m.parseTimecode('00:00:30',30),null);assert.equal(m.parseTimecode('-1',30),null);});
