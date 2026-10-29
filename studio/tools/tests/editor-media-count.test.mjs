import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultMediaProps} from '../../templates/remotion-base/src/editor/media-layout.mjs';
const m=await import('../editor/media-count.mjs').catch(()=>({}));
test('count grows to six and nine preserving existing media and IDs',()=>{
 const p=defaultMediaProps('media-stack');p.items[0].media={publicPath:'keep.png'};
 const six=m.setMediaCount('media-stack',p,6);assert.equal(six.items.length,6);assert.deepEqual(six.items[0],p.items[0]);
 const nine=m.setMediaCount('media-stack',six,9);assert.equal(new Set(nine.items.map(i=>i.id)).size,9);assert.equal(p.items.length,3);
 assert.equal(m.setMediaCount('media-stack',nine,1).items.length,1);assert.throws(()=>m.setMediaCount('media-stack',p,10));
});
test('sequence resize preserves old timing and appends valid later events',()=>{
 const p={...defaultMediaProps('media-split'),mode:'sequence',durationSeconds:12};p.items[0].enterSeconds=0;p.items[1].enterSeconds=4;
 const four=m.setMediaCount('media-split',p,4);assert.equal(four.items[1].enterSeconds,4);assert.equal(four.items.length,4);
 assert.ok(four.items[2].enterSeconds>4);assert.ok(four.items[3].enterSeconds>four.items[2].enterSeconds);assert.ok(four.items[3].enterSeconds<12);
 assert.throws(()=>m.setMediaCount('media-split',p,5));
});
test('mode switches schedule legal events and reordering retains slot timing',()=>{
 const p={...defaultMediaProps('media-split'),mode:'simultaneous',durationSeconds:8};p.items[0].enterSeconds=2;
 const seq=m.setMediaMode(p,'sequence');assert.equal(seq.items[0].enterSeconds,0);assert.ok(seq.items[1].enterSeconds>0);
 const four=m.setMediaCount('media-split',seq,4),times=four.items.map(i=>i.enterSeconds);
 const moved=m.moveMediaItem(four,four.items[3].id,0);assert.deepEqual(moved.items.map(i=>i.enterSeconds),times);assert.equal(moved.items[0].id,four.items[3].id);
 assert.equal(m.setMediaMode(m.setMediaCount('media-split',seq,1),'simultaneous').items.length,2);
});
import {planMediaBatch} from '../editor/media-batch.mjs';
test('batch appends sequence videos after user edited event times',()=>{
 const p={...defaultMediaProps('media-split'),mode:'sequence',durationSeconds:12};p.items[1].enterSeconds=6;
 p.items.forEach(i=>{i.media={kind:'video',publicPath:'keep.mp4'}});
 const result=planMediaBatch(p,['third.mp4','fourth.mp4'],4);
 assert.equal(result.props.items.length,4);assert.ok(result.props.items[2].enterSeconds>6);assert.ok(result.props.items[3].enterSeconds>result.props.items[2].enterSeconds);
});
test('count uses actual trimmed duration and avoids colliding frame events',()=>{
 const p={...defaultMediaProps('media-split'),mode:'sequence',durationSeconds:3};p.items[1].enterSeconds=2;
 const four=m.setMediaCount('media-split',p,4,{fps:30});assert.ok(four.items[3].enterSeconds<3);
 p.items[1].enterSeconds=89/30;assert.throws(()=>m.setMediaCount('media-split',p,4,{fps:30}),/时间/);
});
test('sequence entry reset clamps into legal frame range',()=>{
 const p={...defaultMediaProps('media-split'),mode:'sequence',durationSeconds:6};
 const r=m.setMediaEntry(p,p.items[1].id,0,30);assert.equal(r.items[1].enterSeconds,1/30);
 assert.equal(m.setMediaEntry(p,p.items[1].id,6,30).items[1].enterSeconds,179/30);
});
